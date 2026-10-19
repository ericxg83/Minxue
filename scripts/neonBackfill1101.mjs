/**
 * Neon 11-1 自动回填（2026-10-15 迁移的收尾自动化）
 * ────────────────────────────────────────────────────────────────────────
 * 背景：老 Neon 项目（ep-late-sun）出网流量超限被停机到 11-1。新项目已接管
 * （schema + 10-14 13:00 快照 5 张核心表）。本脚本在老项目恢复后自动完成：
 *   1) 非核心表全量回填（UPSERT by id，新库已有行不覆盖）
 *   2) 5 张核心表差量合并（updated_at 新者胜；重放事故污染过 updated_at 的 6 行强制以老库为准）
 *   3) 窗口期删除行的回收（10-14 快照有、老库现在没有的 id => 从新库删除）
 *   4) 重建外键（定义从老库现场读取）
 *   5) 行数对账 + 赵安迪 6 题状态留档
 *
 * 触发：WorkBuddy 自动化「敏学Neon回填检查」每日调用。
 * 幂等：state 文件标记完成后直接退出；中途失败重跑安全（全 UPSERT）。
 * 用法：
 *   node scripts/neonBackfill1101.mjs            # 只探测老项目是否恢复 + 导出（默认 dry，不写新库）
 *   node scripts/neonBackfill1101.mjs --apply    # 实际回填
 *   FORCE=1 node ... --apply                     # state=done 后强制重跑
 * 退出码：0 = 正常（含「未恢复/已完成」短路）；1 = 失败需人工介入
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// pg 装在 server/node_modules，scripts/ 直接 import 解析不到，从 server 侧解析
const require = createRequire(path.resolve(__dirname, '../server/package.json'))
const pg = require('pg')
const APPLY = process.argv.includes('--apply')
const FORCE = process.env.FORCE === '1'

dotenv.config({ path: path.resolve(__dirname, '../server/.env') })

// 老项目连接串从 .env 备份文件解析（本脚本不硬编码任何密钥）
const envBak = fs.readFileSync(path.resolve(__dirname, '../server/_env_old_neon_backup_1015'), 'utf8')
const mOld = envBak.match(/^NEON_DATABASE_URL=(.+)$/m)
if (!mOld) { console.error('[fatal] 备份文件中找不到 NEON_DATABASE_URL'); process.exit(1) }
const OLD_URL = mOld[1].trim()
const NEW_URL = (process.env.NEON_DATABASE_URL || '').trim()

const STATE_FILE = path.resolve(__dirname, '../server/_neon_backfill_state.json')
const DUMP_DIR = 'D:/Minxue_Backup/neon-backfill-1101'
const SNAPSHOT_DIR = 'D:/Minxue_Backup/2026-10-14'
const ZAD_BAK = path.resolve(__dirname, '../server/_fix_zad_backup_1015.json')
const CORE = ['students', 'tasks', 'questions', 'wrong_questions', 'knowledge_mastery']

const loadState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return { done: false } }
}
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))

const mkPool = (url) => new pg.Pool({
  connectionString: url, max: 4, connectionTimeoutMillis: 20000,
  ssl: { rejectUnauthorized: false }
})

// 从 JSON 行样本推断列类型（自愈新旧 schema 漂移；保守规则，全部记录进报告）
function inferType(values) {
  const nn = values.filter(v => v !== null && v !== undefined)
  if (nn.length === 0) return 'TEXT'
  if (nn.every(v => typeof v === 'boolean')) return 'BOOLEAN'
  if (nn.every(v => typeof v === 'number' && Number.isInteger(v))) return 'INTEGER'
  if (nn.every(v => typeof v === 'number')) return 'NUMERIC'
  if (nn.every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v))) return 'TIMESTAMPTZ'
  if (nn.every(v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))) return 'UUID'
  if (nn.every(v => Array.isArray(v) || (v && typeof v === 'object'))) return 'JSONB'
  return 'TEXT'
}

const quoteIdent = (n) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error('非法标识符: ' + n)
  return '"' + n + '"'
}

async function tableColumns(pool, table) {
  const r = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
    [table])
  return r.rows.map(c => c.column_name)
}

async function main() {
  const state = loadState()
  if (state.done && !FORCE) {
    console.log('回填已完成（state done，' + state.doneAt + '）。如需重跑设 FORCE=1。')
    process.exit(0)
  }
  if (!APPLY) console.log('[dry] 默认只探测+导出，不写新库。自动化确认后带 --apply 执行。')

  // ── 1. 探活老项目 ──
  const oldPool = mkPool(OLD_URL)
  try {
    await oldPool.query('SELECT 1')
    console.log('[ok] 老项目已恢复（额度重置生效），开始回填流程')
  } catch (e) {
    const msg = String(e && e.message || e)
    await oldPool.end().catch(() => {})
    if (/quota|exceeded|limit/i.test(msg)) {
      console.log('老项目仍未恢复（额度未重置或仍停机）：' + msg.slice(0, 120))
      process.exit(0)
    }
    console.error('[fatal] 老项目连接失败（非配额类，需人工看）: ' + msg.slice(0, 200))
    process.exit(1)
  }
  const newPool = mkPool(NEW_URL)
  await newPool.query('SELECT 1')

  fs.mkdirSync(DUMP_DIR, { recursive: true })
  const report = { startedAt: new Date().toISOString(), tables: {}, fks: [], warns: [] }

  // ── 2. 全量导出老库所有表 + 外键定义 ──
  const tblRes = await oldPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'schema_migrations' ORDER BY table_name")
  const allTables = tblRes.rows.map(r => r.table_name)
  console.log('[dump] 老库表数: ' + allTables.length)

  const fkRes = await oldPool.query(
    "SELECT conname, pg_get_constraintdef(oid) AS def, conrelid::regclass::text AS tbl FROM pg_constraint " +
    "WHERE contype='f' AND connamespace='public'::regnamespace")
  fs.writeFileSync(path.join(DUMP_DIR, '_fk_defs.json'), JSON.stringify(fkRes.rows, null, 2))

  for (const table of allTables) {
    const r = await oldPool.query('SELECT * FROM ' + quoteIdent(table))
    fs.writeFileSync(path.join(DUMP_DIR, table + '.json'), JSON.stringify(r.rows))
    report.tables[table] = { old: r.rows.length }
    console.log('[dump] ' + table + ': ' + r.rows.length + ' 行')
  }

  if (!APPLY) {
    console.log('[dry] 探测+导出完成（未写新库）。数据已留 ' + DUMP_DIR + '，确认后带 --apply 重跑（导出会重做，幂等）。')
    await oldPool.end(); await newPool.end()
    process.exit(0)
  }

  // ── 3. 逐表合并 ──
  let forceOldIds = []
  try {
    const zb = JSON.parse(fs.readFileSync(ZAD_BAK, 'utf8'))
    forceOldIds = (zb.questions || []).map(q => String(q.id))
  } catch { /* 备份缺失则跳过特判 */ }

  for (const table of allTables) {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, table + '.json'), 'utf8'))
      const beforeCount = (await newPool.query('SELECT count(*)::int AS n FROM ' + quoteIdent(table))).rows[0].n
      if (rows.length > 0) {
        const oldCols = Object.keys(rows[0])
        // 自愈：老库有而新库无的列（反向 lineage 漂移）
        let newCols = await tableColumns(newPool, table)
        for (const col of oldCols) {
          if (!newCols.includes(col)) {
            const typ = inferType(rows.map(r => r[col]).slice(0, 200))
            try {
              await newPool.query('ALTER TABLE ' + quoteIdent(table) + ' ADD COLUMN ' + quoteIdent(col) + ' ' + typ)
              report.warns.push(table + '.' + col + ' 新增列(' + typ + ')——请复核类型')
              console.log('[col-add] ' + table + '.' + col + ' ' + typ)
            } catch (e) {
              report.warns.push(table + '.' + col + ' 加列失败: ' + e.message)
              console.log('[col-fail] ' + table + '.' + col + ': ' + e.message)
            }
          }
        }
        newCols = await tableColumns(newPool, table)
        const useCols = oldCols.filter(c => newCols.includes(c))
        const hasId = newCols.includes('id') && oldCols.includes('id')
        const isCore = CORE.includes(table)

        // 窗口期删除回收（仅核心表：快照有、老库无 => 新库删）
        let deleted = 0
        if (isCore && hasId) {
          const snapFile = path.join(SNAPSHOT_DIR, table + '.json')
          if (fs.existsSync(snapFile)) {
            const snapIds = JSON.parse(fs.readFileSync(snapFile, 'utf8')).map(r => String(r.id))
            const oldIds = new Set(rows.map(r => String(r.id)))
            const gone = snapIds.filter(id => !oldIds.has(id))
            for (const id of gone) {
              const d = await newPool.query('DELETE FROM ' + quoteIdent(table) + ' WHERE id = $1', [id])
              deleted += d.rowCount
            }
            if (gone.length) console.log('[delta-del] ' + table + ': 回收 ' + deleted + ' 行（窗口期删除）')
          }
        }

        let inserted = 0, updated = 0, kept = 0
        const newIdSet = hasId
          ? new Set((await newPool.query('SELECT id FROM ' + quoteIdent(table))).rows.map(r => String(r.id)))
          : null
        for (const row of rows) {
          const idStr = hasId ? String(row.id) : null
          const exists = hasId ? newIdSet.has(idStr) : false
          if (!exists) {
            const vals = useCols.map(c => {
              let v = row[c]
              if (v !== null && typeof v === 'object') v = JSON.stringify(v)
              return v
            })
            const ph = useCols.map((_, i) => '$' + (i + 1)).join(',')
            try {
              await newPool.query('INSERT INTO ' + quoteIdent(table) + ' (' + useCols.map(quoteIdent).join(',') +
                ') VALUES (' + ph + ')' + (hasId ? ' ON CONFLICT (id) DO NOTHING' : ''), vals)
              inserted++
              if (hasId) newIdSet.add(idStr)
            } catch (e) {
              report.warns.push(table + ' ' + (idStr || '').slice(0, 8) + ' 插入失败: ' + e.message)
              console.log('[ins-fail] ' + table + ' ' + (idStr || '').slice(0, 8) + ': ' + e.message)
            }
          } else if (isCore) {
            const cur = (await newPool.query('SELECT updated_at FROM ' + quoteIdent(table) + ' WHERE id = $1', [row.id])).rows[0]
            const oldU = row.updated_at ? new Date(row.updated_at) : null
            const newU = cur && cur.updated_at ? new Date(cur.updated_at) : null
            const force = forceOldIds.includes(idStr)
            if (force || (oldU && (!newU || oldU > newU))) {
              const setCols = useCols.filter(c => c !== 'id')
              const sets = setCols.map((c, i) => quoteIdent(c) + ' = $' + (i + 1))
              const vals = setCols.map(c => {
                let v = row[c]
                if (v !== null && typeof v === 'object') v = JSON.stringify(v)
                return v
              })
              await newPool.query('UPDATE ' + quoteIdent(table) + ' SET ' + sets.join(',') +
                ' WHERE id = $' + (setCols.length + 1), [...vals, row.id])
              updated++
            } else kept++
          } else kept++
        }
        const afterCount = (await newPool.query('SELECT count(*)::int AS n FROM ' + quoteIdent(table))).rows[0].n
        report.tables[table] = { old: rows.length, before: beforeCount, after: afterCount, merge: { inserted, updated, kept, deleted } }
        console.log('[merge] ' + table + ': +' + inserted + ' ~' + updated + ' =' + kept + ' -' + deleted +
          ' | ' + beforeCount + ' → ' + afterCount + '（老库 ' + rows.length + '）')
      } else {
        report.tables[table] = { old: 0, before: beforeCount, after: beforeCount, merge: {} }
        console.log('[skip] ' + table + ': 老库 0 行')
      }
    } catch (e) {
      report.warns.push(table + ' 合并失败: ' + e.message)
      console.log('[tbl-fail] ' + table + ': ' + String(e.message).slice(0, 140))
    }
  }

  // ── 4. 重建外键（老库现场定义）──
  for (const fk of fkRes.rows) {
    const tbl = fk.tbl.replace(/^public\./, '')
    try {
      await newPool.query('ALTER TABLE ' + quoteIdent(tbl) + ' ADD CONSTRAINT ' + quoteIdent(fk.conname) + ' ' + fk.def)
      report.fks.push(fk.conname + ' ok')
      console.log('[fk-ok] ' + tbl + '.' + fk.conname)
    } catch (e) {
      report.fks.push(fk.conname + ' FAIL: ' + String(e.message).slice(0, 120))
      console.log('[fk-fail] ' + tbl + '.' + fk.conname + ': ' + String(e.message).slice(0, 120))
    }
  }

  // ── 5. 赵安迪 6 题留档（人工复核用）──
  try {
    const zb = JSON.parse(fs.readFileSync(ZAD_BAK, 'utf8'))
    const ids = (zb.questions || []).map(q => String(q.id))
    if (ids.length) {
      const chk = await newPool.query(
        "SELECT id, left(coalesce(student_answer,''),40) AS stu, is_correct, review_status FROM questions WHERE id = ANY($1::text[])", [ids])
      fs.writeFileSync(path.join(DUMP_DIR, '_zad_after_merge.json'), JSON.stringify(chk.rows, null, 2))
      console.log('[verify] 赵安迪 6 题合并后状态已留档 _zad_after_merge.json')
    }
  } catch { /* 无备份文件则跳过 */ }

  // ── 6. 收尾 ──
  state.done = true
  state.doneAt = new Date().toISOString()
  state.report = report
  saveState(state)
  fs.writeFileSync(path.join(DUMP_DIR, '_merge_report.json'), JSON.stringify(report, null, 2))
  console.log('=== 回填完成 === 表 ' + allTables.length + ' 张；警告 ' + report.warns.length + ' 条（详见 ' + DUMP_DIR + '/_merge_report.json）')
  await oldPool.end(); await newPool.end()
  process.exit(report.warns.length > 0 ? 1 : 0)
}

main().catch(e => { console.error('[fatal] ' + (e && e.message || e)); process.exit(1) })
