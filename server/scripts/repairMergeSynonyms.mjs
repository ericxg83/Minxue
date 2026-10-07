/**
 * 修复：批次 2/3 合并时「同义词逐 drop 覆盖写」造成丢失
 * ═══════════════════════════════════════════════════════════════
 * 事故（2026-10-07 当晚第二轮自查）：
 *   合并脚本的 synonyms 合并写在**每个 drop 的循环里**，而 `keep.synonyms` 是脚本开头
 *   读进内存的**旧值** ⇒ 同一个 keep 有 2 个 drop 时，第二次写覆盖第一次：
 *   批次 3（幂的运算 ← 指数运算 + 指数法则）丢了
 *     「指数运算」「指数运算法则」「分数指数幂的运算」3 条。
 *   后果不是「少了个别名」这么轻：标签「指数运算」不再精确命中「幂的运算」，
 *   掉到同义词含「指数」的「幂与根式」⇒ 全量重算关联时 45 道题的挂载点被改写。
 *
 * 修复口径：以合并前备份里的 drop 行为准，把「drop 的 synonyms + drop 的名字」
 *   并回 keep（幂等；只加不减）。
 *
 * 用法：
 *   node server/scripts/repairMergeSynonyms.mjs            # dry-run
 *   node server/scripts/repairMergeSynonyms.mjs --apply
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const { default: pg } = await import('pg')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const files = fs.readdirSync(path.join(ROOT, 'server'))
  .filter(f => /^_backup_kp_merge_(residual|power_cluster)_.*\.json$/.test(f)).sort()
console.log('备份：' + files.join(' / '))

const parse = (v) => (Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v || '[]') : []))
const want = new Map() // keepName -> Set(synonym)
for (const f of files) {
  const bak = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', f), 'utf8'))
  const kpById = new Map((bak.knowledge_points || []).map(r => [r.id, r]))
  for (const p of bak.pairs || []) {
    const keep = kpById.get(p.keepId)
    const drop = kpById.get(p.dropId)
    if (!keep || !drop) continue
    const set = want.get(keep.name) || new Set(parse(keep.synonyms))
    for (const s of parse(drop.synonyms)) set.add(s)
    set.add(drop.name)
    want.set(keep.name, set)
  }
}

const { rows: cur } = await pool.query(
  `SELECT id, name, synonyms FROM knowledge_points WHERE name = ANY($1::text[]) AND subject='数学'`,
  [[...want.keys()]])
let changed = 0
for (const r of cur) {
  const wantSet = want.get(r.name)
  const curSet = new Set(parse(r.synonyms))
  const missing = [...wantSet].filter(s => !curSet.has(s))
  console.log('')
  console.log(`${r.name}：现有 ${curSet.size} 条`)
  if (!missing.length) { console.log('  ✅ 无缺失'); continue }
  const merged = [...new Set([...curSet, ...wantSet])]
  console.log('  缺失 ' + missing.length + ' 条 → ' + JSON.stringify(missing))
  console.log('  修复后 ' + merged.length + ' 条：' + JSON.stringify(merged))
  if (APPLY) {
    await pool.query(`UPDATE knowledge_points SET synonyms=$1::jsonb, updated_at=now() WHERE id=$2`, [JSON.stringify(merged), r.id])
    changed++
  }
}
if (APPLY) console.log('\n✅ 已修复 ' + changed + ' 个节点的 synonyms')
else console.log('\n── dry-run 结束，未写库 ──')
await pool.end()
