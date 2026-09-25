// 回归测试：迁移台账（schema_migrations）的跳过语义与「不吞迁移」保证
//
// 事故背景（2026-09-15）：
//   server/index.js 的启动回调里串行 await 了 48 个迁移，每个迁移 2 次 DB 往返
//   （先 ALTER、再查 information_schema 校验），合计 90+ 次。生产是 Render 实例在
//   Oregon、Neon 在 ap-southeast-1（新加坡），单次往返约 200ms → 迁移阶段约 18 秒。
//   而 Render 免费实例 15 分钟无入站请求就 spin down，用户「过一段时间打开 App」
//   正好落在冷启动窗口里，看到的就是「内容重新加载 + 干等半分钟」。
//
//   台账把稳态成本压到 1 次查询。这个优化最危险的地方不是「不生效」，而是
//   **静默吞掉迁移**：一旦跳过判定写错，本该执行的 ALTER 就永远不跑，
//   且日志显示一切正常。因此本测试逐条锁定跳过语义：
//     · 版本号必须包含迁移源码指纹——改了迁移文件就必须重跑；
//     · 成功才记账——失败的下次启动必须重试；
//     · 台账自身故障必须降级为全量执行，不能因为台账坏了就不跑迁移；
//     · index.js 的迁移清单必须与 import 严格对位，且不允许退回裸 await 写法。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { runMigrations, versionOf, loadAppliedVersions } from '../server/migrations/migrationLedger.js'

const ROOT = resolve(import.meta.dirname, '..')
const INDEX_SRC = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8')
const LEDGER_REL = 'server/migrations/migrationLedger.js'

const silentLog = { log() {}, error() {} }

/** 造一个假的 query：记录调用，并按台账内容回答 SELECT。 */
const makeQuery = ({ applied = [], tableExists = true } = {}) => {
  const calls = []
  let exists = tableExists
  const q = async (sql, params) => {
    calls.push({ sql: sql.trim(), params })
    if (/^SELECT version FROM/.test(sql.trim())) {
      if (!exists) {
        const err = new Error('relation "schema_migrations" does not exist')
        err.code = '42P01'
        throw err
      }
      return { rows: applied.map((version) => ({ version })) }
    }
    if (/^CREATE TABLE IF NOT EXISTS/.test(sql.trim())) {
      exists = true
      return { rows: [] }
    }
    if (/^INSERT INTO/.test(sql.trim())) {
      return { rows: [] }
    }
    throw new Error(`未预期的 SQL: ${sql}`)
  }
  q.calls = calls
  return q
}

const m = (key, fn) => [key, fn]

test('版本号对同一键 + 同一实现稳定，对源码变化敏感', () => {
  const a = async () => {}
  const b = async () => {}
  assert.equal(versionOf('k', a), versionOf('k', a), '同键同实现必须稳定，否则每次都重跑')

  // 模拟「迁移文件被改了」：同名键、不同实现
  const impl1 = async function migrateAddColumn() { await 1 }
  const impl2 = async function migrateAddColumn() { await 1; await 2 }
  assert.notEqual(
    versionOf('migrateAddColumn', impl1),
    versionOf('migrateAddColumn', impl2),
    '迁移实现变了版本号必须变，否则会给旧迁移「加了列却不跑」的静默失效'
  )
})

test('台账命中时全部跳过，且稳态只花 1 次查询', async () => {
  const executed = []
  // 记账与执行必须是同一个函数对象：版本号含源码指纹，
  // 换成包装函数会让指纹对不上，反而触发全量重跑（这正是本机制的设计意图）。
  const migrations = [
    ['a', async () => executed.push('a')],
    ['b', async () => executed.push('b')],
    ['c', async () => executed.push('c')]
  ]
  const applied = migrations.map(([key, fn]) => versionOf(key, fn))
  const q = makeQuery({ applied })

  const result = await runMigrations(migrations, { query: q, log: silentLog })

  assert.deepEqual(executed, [], '已应用的迁移不得再执行')
  assert.equal(result.skipped, 3)
  assert.equal(result.ran, 0)
  assert.equal(q.calls.length, 1, `稳态必须只查一次台账，实际 ${q.calls.length} 次`)
  assert.match(q.calls[0].sql, /^SELECT version FROM/)
})

test('台账为空时全部执行并逐条记账', async () => {
  const migrations = [
    m('a', async () => {}),
    m('b', async () => {})
  ]
  const q = makeQuery({ applied: [] })
  const result = await runMigrations(migrations, { query: q, log: silentLog })

  assert.equal(result.ran, 2)
  assert.equal(result.skipped, 0)
  const inserts = q.calls.filter((c) => /^INSERT INTO/.test(c.sql))
  assert.equal(inserts.length, 2, '每个成功迁移都要记账，否则下次会重复执行')
  assert.deepEqual(
    inserts.map((c) => c.params[0]),
    migrations.map(([key, fn]) => versionOf(key, fn))
  )
})

test('只执行台账里缺失的那一个迁移（增量场景）', async () => {
  const executed = []
  const a = ['a', async () => executed.push('a')]
  const b = ['b', async () => executed.push('b')]
  const c = ['c', async () => executed.push('c')]
  // 用同一批函数对象算版本，模拟「a、b 已应用，c 是这次新增的迁移」
  const q = makeQuery({ applied: [versionOf(a[0], a[1]), versionOf(b[0], b[1])] })

  const result = await runMigrations([a, b, c], { query: q, log: silentLog })

  assert.deepEqual(executed, ['c'], '只有未应用的迁移该跑')
  assert.equal(result.skipped, 2)
  assert.equal(result.ran, 1)
})

test('迁移失败时不记账，保证下次启动会重试', async () => {
  let attempt = 0
  const boom = m('migrateBoom', async () => {
    attempt += 1
    if (attempt === 1) throw new Error('boom')
  })
  const q = makeQuery({ applied: [] })

  const first = await runMigrations([boom], { query: q, log: silentLog })
  assert.equal(first.failed, 1)
  assert.equal(first.ran, 0)
  assert.equal(
    q.calls.filter((c) => /^INSERT INTO/.test(c.sql)).length,
    0,
    '失败绝不能记账，否则该迁移会被永久跳过'
  )

  // 第二次启动：台账仍为空 → 必须重试
  const q2 = makeQuery({ applied: [] })
  const second = await runMigrations([boom], { query: q2, log: silentLog })
  assert.equal(second.ran, 1, '上一次失败的迁移必须在下次启动重试并成功')
  assert.equal(q2.calls.filter((c) => /^INSERT INTO/.test(c.sql)).length, 1)
})

test('台账表不存在时先建表，再按空台账执行（首次部署路径）', async () => {
  const q = makeQuery({ applied: [], tableExists: false })
  const result = await runMigrations([m('a', async () => {})], { query: q, log: silentLog })

  assert.equal(
    q.calls.filter((c) => /^CREATE TABLE IF NOT EXISTS/.test(c.sql)).length,
    1,
    '表不存在（42P01）必须建表'
  )
  assert.equal(result.ran, 1)
  assert.equal(result.degraded, false)
})

test('台账不可用时降级为全量执行，绝不因台账故障跳过迁移', async () => {
  const q = async (sql) => {
    if (/^SELECT version FROM/.test(sql.trim())) {
      const err = new Error('permission denied for table schema_migrations')
      err.code = '42501'
      throw err
    }
    return { rows: [] }
  }

  const executed = []
  const result = await runMigrations(
    [m('a', async () => executed.push('a')), m('b', async () => executed.push('b'))],
    { query: q, log: silentLog }
  )

  assert.deepEqual(executed, ['a', 'b'], '台账故障时必须退回全量执行')
  assert.equal(result.degraded, true, '必须标记降级，便于日志与监控识别')
})

test('loadAppliedVersions 遇到非 42P01 错误必须上抛，不静默吞掉', async () => {
  const q = async () => {
    const err = new Error('connection terminated')
    err.code = '08006'
    throw err
  }
  await assert.rejects(() => loadAppliedVersions(q), /connection terminated/)
})

test('index.js 的迁移清单与 import 严格对位，且不允许退回裸 await 写法', () => {
  const listBlock = INDEX_SRC.match(/await runMigrations\(\[([\s\S]*?)\]\)/)
  assert.ok(listBlock, 'index.js 必须通过 runMigrations 执行迁移')

  const items = [...listBlock[1].matchAll(/\['([^']+)',\s*(\w+)\]/g)]
    .map(([, key, fn]) => ({ key, fn }))

  assert.equal(items.length, 50, `迁移清单必须完整，实际 ${items.length} 项`)

  for (const { key, fn } of items) {
    assert.equal(key, fn, `迁移键与函数名必须一致，发现 ['${key}', ${fn}]`)
    assert.match(
      INDEX_SRC,
      new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '\\./migrations/`),
      `${fn} 必须在 index.js 顶部被 import，否则运行时 ReferenceError`
    )
  }

  const keys = items.map((i) => i.key)
  assert.equal(new Set(keys).size, keys.length, '迁移键不得重复，重复会导致台账互相覆盖')

  // 防回退：清单外的裸 await 会让迁移绕过台账，重新变成每次冷启动全量重跑
  const strayAwaits = [...INDEX_SRC.matchAll(/await (migrate\w+)\(\)/g)].map((m2) => m2[1])
  assert.deepEqual(
    strayAwaits,
    [],
    `迁移必须走台账，发现绕过台账的裸调用: ${strayAwaits.join(', ')}`
  )
})

test('工作区迁移文件不得出现 CRLF（跨平台指纹不一致会让迁移每次冷启动白跑）', () => {
  // 真实事故（2026-09-15）：.gitattributes 声明 `*.js text eol=lf`，但
  // 037_add_variant_questions.js 的 blob 历史上就是 CRLF，于是本地工作区为 CRLF、
  // 线上 checkout 为 LF。Function.prototype.toString() 会带上 \r，同一份代码
  // 因此算出两个指纹：本地 3451587da6dd、线上 4ad056a4ddea。结果线上已记账的
  // 037 在本地被判成「待应用」，每次冷启动都白跑一次。
  //
  // versionOf 已做行尾归一化兜底，这条断言从源头堵住 CRLF 再溜进来。
  const dir = resolve(ROOT, 'server/migrations')
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => readFileSync(resolve(dir, f), 'utf8').includes('\r'))

  assert.deepEqual(
    offenders,
    [],
    `以下迁移文件含 CRLF，必须转为 LF：${offenders.join(', ')}`
  )
})

test('版本号对行尾差异免疫（同一份代码在 LF 与 CRLF 下必须同指纹）', () => {
  // 直接构造同一段源码的两种行尾，验证 versionOf 的归一化生效。
  // 用一个临时模块落地两种行尾再 import，避免依赖文件系统的实际行尾。
  const body = 'async function demo() {\n  await 1\n  await 2\n}'
  const lfFn = new Function(`return (${body})`)()
  const crlfFn = new Function(`return (${body.replace(/\n/g, '\r\n')})`)()

  assert.notEqual(
    String(lfFn),
    String(crlfFn),
    '前置条件：两种行尾的函数源码必须不同，否则这条测试没有意义'
  )
  assert.equal(
    versionOf('demo', lfFn),
    versionOf('demo', crlfFn),
    '行尾差异不得影响指纹，否则 Windows 本地与 Linux 线上会对同一份代码产生两个版本号'
  )
})

test('台账模块路径不得以下划线开头（.gitignore 的 _* 规则会让它进不了仓库）', () => {
  // 真实踩过的坑：台账最初命名 server/migrations/_ledger.js，而仓库 .gitignore
  // 第 137 行有 `_*` 规则（用于忽略本地调试脚本与临时产物），该文件会被静默
  // 排除在提交之外——本地测试全绿、push 也「成功」，但 Render 部署后
  // index.js 的 import 直接 ReferenceError，后端起不来。
  const hasUnderscoreSegment = (p) => p.split('/').some((seg) => seg.startsWith('_'))

  assert.ok(
    !hasUnderscoreSegment(LEDGER_REL),
    `台账模块路径不得含下划线开头的段：${LEDGER_REL}`
  )

  const importMatch = INDEX_SRC.match(/import \{ runMigrations \} from '([^']+)'/)
  assert.ok(importMatch, 'index.js 必须 import runMigrations')
  assert.ok(
    !hasUnderscoreSegment(importMatch[1]),
    `index.js 引用的台账路径不得含下划线开头的段：${importMatch[1]}`
  )
})
