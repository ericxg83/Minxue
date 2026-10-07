/**
 * 同义词清理（打标粒度根治 · 第三刀）
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 为什么必须清：
 *   树里有些节点被灌了大量「复合同义词」。实测「二次函数」挂了 45 个，
 *   含「二次函数图像开口方向」「二次函数对称轴」「二次函数的顶点坐标」…
 *   这些短语里**含着别的具体节点名**。归一化时同义词精确命中得 95 分，
 *   压过具体节点的子串命中（64 分）⇒ 具体考点被大节点吞掉。
 *   症状：一道问「开口方向/对称轴/顶点坐标」的题只挂上「二次函数」一个标签。
 *
 * 规则：删掉「包含了另一个**非根**节点名」的同义词。
 *   - 只比 level>0 的节点（领域根不是考点，不该拿来判定）
 *   - 必须比该同义词短（否则是它自己）
 *   - 删掉后不影响召回：节点名本身还在，标签仍能通过子串命中该节点
 *
 * ⛔ 默认 dry-run，--apply 才写库。
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

const norm = s => String(s || '').replace(/[\s　]+/g, '').replace(/[的之]/g, '').toLowerCase()

// ⛔ 泛化节点名单：它们本身是兜底用的大词，**不能**拿它们去拆同义词。
//   实测不加这条会把正当同义词误删：
//     「算术平方根」含「平方」→ 被删（错，它是 平方根 的同义词）
//     「反比例函数的图像」含「比例」→ 被删（错）
//     「二次函数的性质」含「数的性质」→ 被删（错，只是恰好子串）
const GENERIC = new Set(['数与式', '方程与方程组', '不等式与不等式组', '函数', '几何基础', '图形变换',
  '三角形', '四边形', '圆', '相似', '锐角三角函数、投影与视图', '统计与概率', '综合与实践',
  '平方', '实数', '代数', '比例', '几何', '统计', '数的性质', '面积计算', '实际问题解决',
  '方程', '未分类', '数与代数', '运算', '计算', '数与式'])

const { rows: nodes } = await pool.query(
  `SELECT id, name, level, synonyms FROM knowledge_points WHERE subject='数学' AND archived=false`)
const leafNames = nodes
  .filter(n => n.level > 0 && !GENERIC.has(n.name))
  .map(n => ({ id: n.id, name: n.name, k: norm(n.name) }))
  .filter(x => x.k.length >= 3)   // ⛔ ≥3：2 字的太短，容易在长词里误命中（「数的性质」这类）

const plan = []
for (const n of nodes) {
  const syn = Array.isArray(n.synonyms) ? n.synonyms : JSON.parse(n.synonyms || '[]')
  if (!syn.length) continue
  const nk = norm(n.name)
  const keep = [], drop = []
  for (const s of syn) {
    const sk = norm(s)
    // 只拆「与当前节点无包含关系」的复合词：
    //   「二次函数图像开口方向」含「开口方向」——两者互不包含 ⇒ 拆
    //   「相似三角形的判定定理」含「相似三角形」——「相似三角形」是当前节点的**上位**
    //     （当前节点名包含它）⇒ 不拆，它是正当同义词
    const hit = leafNames.find(o =>
      o.id !== n.id &&
      sk.length > o.k.length &&
      sk.includes(o.k) &&
      !nk.includes(o.k) &&      // 被含节点不是当前节点的上位
      !o.k.includes(nk)         // 当前节点也不是被含节点的上位
    )
    if (hit) drop.push({ synonym: s, contains: hit.name })
    else keep.push(s)
  }
  if (drop.length) plan.push({ id: n.id, name: n.name, before: syn.length, after: keep.length, keep, drop })
}

const totalDrop = plan.reduce((a, p) => a + p.drop.length, 0)
console.log('涉及节点：' + plan.length + '｜待删同义词：' + totalDrop)
console.log('')
for (const p of plan.sort((a, b) => b.drop.length - a.drop.length).slice(0, 20)) {
  console.log(`${p.name}  ${p.before} → ${p.after}`)
  for (const d of p.drop.slice(0, 6)) console.log(`     删「${d.synonym}」（含「${d.contains}」）`)
  if (p.drop.length > 6) console.log(`     … 另 ${p.drop.length - 6} 条`)
}

if (!APPLY) {
  console.log('\n── dry-run 结束，未写库 ──')
  fs.writeFileSync(path.resolve(ROOT, '_tmp_synonym_cleanup.json'), JSON.stringify({ at: new Date().toISOString(), plan }, null, 2), 'utf8')
  await pool.end(); process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const bak = path.resolve(ROOT, `server/_backup_kp_synonyms_${stamp}.json`)
fs.writeFileSync(bak, JSON.stringify({ at: new Date().toISOString(), nodes: nodes.map(n => ({ id: n.id, name: n.name, synonyms: n.synonyms })) }), 'utf8')
console.log('\n✅ 已备份 → ' + bak)

const client = await pool.connect()
try {
  await client.query('BEGIN')
  let n = 0
  for (const p of plan) {
    await client.query(`UPDATE knowledge_points SET synonyms = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(p.keep), p.id])
    n += p.drop.length
  }
  await client.query('COMMIT')
  console.log(`✅ 已清理 ${n} 条同义词（${plan.length} 个节点）`)
} catch (e) {
  await client.query('ROLLBACK')
  console.log('❌ 已回滚：' + e.message)
  client.release(); await pool.end(); process.exit(1)
}
client.release()
const { rows: chk } = await pool.query(`
  SELECT name, jsonb_array_length(synonyms)::int AS n FROM knowledge_points
   WHERE subject='数学' ORDER BY n DESC LIMIT 8`)
console.log('复核（同义词最多的节点）：')
for (const r of chk) console.log('  ' + r.name + '  ' + r.n)
await pool.end()
