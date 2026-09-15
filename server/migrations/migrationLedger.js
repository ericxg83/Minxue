/**
 * 迁移台账（schema_migrations）
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * server/index.js 的启动回调里有 48 个 `await migrateXxx()`，每次冷启动都会
 * 全量重跑。这些迁移绝大多数是幂等的（`ADD COLUMN IF NOT EXISTS`），跑起来
 * 不报错、日志还打印「已存在，跳过」——但**跳过的是 DDL，不是查询**：
 * 每个迁移先执行一次 ALTER，再查一次 information_schema 校验，即 2 次 DB 往返。
 * 48 个迁移 ≈ 90+ 次串行往返。
 *
 * 而生产环境是 Render 实例在 Oregon、Neon 在 ap-southeast-1（新加坡），
 * 单次往返约 200ms → 仅迁移阶段就要 18 秒左右，全部叠加在用户打开 App 的路径上。
 *
 * 台账把「是否已应用」收敛成启动时的一次查询：稳态 1 次往返，
 * 只跑真正待应用的迁移。
 *
 * ── 不吞迁移的三道保证 ─────────────────────────────────────────────────
 * 1. 版本号 = 迁移键 + **迁移函数源码指纹**。改了迁移文件，指纹变化，
 *    仍会重新执行；不会因为「台账里已有这个键」而永久跳过。
 * 2. **成功才记账**。迁移抛错时不写台账，下次启动自动重试。
 * 3. **台账自身故障时降级**为「全量执行且不记录」。宁可慢，也不能因为
 *    台账建表失败（权限/网络）导致迁移被静默跳过。
 *
 * ── 回滚 ───────────────────────────────────────────────────────────────
 * 删除 `schema_migrations` 表即可回到「每次启动全量重跑」的旧行为，
 * 不影响任何业务数据（本表只记录迁移版本，不参与业务读写）。
 */
import { createHash } from 'crypto'
import { query as defaultQuery } from '../config/neon.js'

const TABLE = 'schema_migrations'

// PostgreSQL: undefined_table —— 台账表还没建
const UNDEFINED_TABLE = '42P01'

/**
 * 计算迁移版本号。
 * 用「键 + 函数源码指纹」而非纯键：迁移文件被修改后指纹变化，
 * 该迁移会重新执行，避免「加了列却没跑」的静默失效。
 *
 * 指纹必须先归一化行尾再算：`.gitattributes` 声明的是 `*.js eol=lf`，但工作区
 * 文件可能仍是 CRLF（编辑器写入、或文件早于 .gitattributes 存在），此时
 * `Function.prototype.toString()` 会带上 `\r`，同一份代码在 Windows 与 Linux
 * 上就得到两个不同指纹。
 * 实测事故：server/migrations/037_add_variant_questions.js 工作区为 CRLF，
 * 未归一化时本地算出 3451587da6dd、线上记账为 4ad056a4ddea，对不上 →
 * 该迁移每次冷启动都被判为「待应用」白跑一次。归一化后可精确复原线上指纹。
 */
export const versionOf = (key, fn) => {
  const source = String(fn).replace(/\r\n/g, '\n')
  const fingerprint = createHash('sha1').update(source).digest('hex').slice(0, 12)
  return `${key}@${fingerprint}`
}

const ensureTable = (runQuery) => runQuery(`
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)

/**
 * 读取已应用的版本集合。
 * 稳态只有 1 次往返（直接查表）；首次运行表不存在（42P01）才建表并返回空集。
 */
export const loadAppliedVersions = async (runQuery = defaultQuery) => {
  try {
    const { rows } = await runQuery(`SELECT version FROM ${TABLE}`)
    return new Set(rows.map((row) => row.version))
  } catch (err) {
    if (err?.code === UNDEFINED_TABLE) {
      await ensureTable(runQuery)
      return new Set()
    }
    throw err
  }
}

const record = (runQuery, version) => runQuery(
  `INSERT INTO ${TABLE} (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
  [version]
)

/**
 * 按台账执行迁移。
 *
 * @param {Array<[string, Function]>} migrations [迁移键, 迁移函数] 列表，顺序即执行顺序
 * @param {{ log?: Console, query?: Function }} options
 *        query 可注入，仅用于测试；生产走 config/neon 的连接池。
 * @returns {Promise<{degraded: boolean, ran: number, failed: number, skipped: number, elapsedMs: number}>}
 *
 * 与改造前的一处行为差异（有意为之）：原先 48 个迁移被同一个 try 包住，
 * 任一失败会导致**其后所有迁移被跳过且永不重试**。这里改为逐个 try：
 * 失败的迁移不记账、下次启动重试，其余迁移照常应用。
 */
export const runMigrations = async (migrations, options = {}) => {
  const { log = console, query: runQuery = defaultQuery } = options
  const startedAt = Date.now()

  let applied
  try {
    applied = await loadAppliedVersions(runQuery)
  } catch (err) {
    log.error(`⚠️ [迁移] 台账不可用（${err.message}），降级为全量执行`)
    let failed = 0
    for (const [key, fn] of migrations) {
      try {
        await fn()
      } catch (e) {
        failed += 1
        log.error(`❌ [迁移] ${key} 失败: ${e.message}`)
      }
    }
    return {
      degraded: true,
      ran: migrations.length - failed,
      failed,
      skipped: 0,
      elapsedMs: Date.now() - startedAt
    }
  }

  const pending = migrations.filter(([key, fn]) => !applied.has(versionOf(key, fn)))
  const skipped = migrations.length - pending.length

  if (pending.length === 0) {
    const elapsedMs = Date.now() - startedAt
    log.log(`📦 [迁移] ${migrations.length} 个迁移均已应用，跳过（${elapsedMs}ms）`)
    return { degraded: false, ran: 0, failed: 0, skipped, elapsedMs }
  }

  log.log(`📦 [迁移] 待应用 ${pending.length}/${migrations.length} 个`)
  let ran = 0
  let failed = 0

  for (const [key, fn] of pending) {
    try {
      await fn()
      // 成功才记账，失败的下次启动会自动重试
      await record(runQuery, versionOf(key, fn))
      ran += 1
    } catch (err) {
      failed += 1
      log.error(`❌ [迁移] ${key} 失败: ${err.message}`)
    }
  }

  const elapsedMs = Date.now() - startedAt
  log.log(`📦 [迁移] 完成：执行 ${ran}，失败 ${failed}，跳过 ${skipped}（${elapsedMs}ms）`)
  return { degraded: false, ran, failed, skipped, elapsedMs }
}
