/**
 * P1：归档「非考点」节点
 * ═══════════════════════════════════════════════════════════════
 * ⛔ 只归档**叶子**栏目名，绝不碰领域根：
 *   `getKnowledgeTree` 按 parent_id 拼树，父节点被排除（archived）时，
 *   它的子节点会被当成顶层根 → 整棵树被拍平。实测风险极高，必须避开。
 *   领域根（数与式/函数/三角形…）本来就不进打标候选（loadTaggingCandidates 过滤 level>0），
 *   所以它们不需要归档。
 *
 * 默认 dry-run，--apply 才写库。
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import { default as pg } from 'pg'
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const APPLY = process.argv.includes('--apply')

// 教材栏目名 / 伪考点（不是能教能考的原子）
const NON_KP = ['数学活动', '课题学习', '应用专题', '方案设计问题', '图形设计问题', '跨学科实践问题', '未分类']

const { rows: nodes } = await pool.query(`
  SELECT kp.id, kp.name, kp.level,
         (SELECT count(*)::int FROM knowledge_points c WHERE c.parent_id = kp.id) AS children,
         (SELECT count(*)::int FROM question_knowledge qk WHERE qk.kp_id = kp.id) AS mounts
    FROM knowledge_points kp WHERE kp.subject='数学'`)

const plan = [], blocked = []
for (const n of NON_KP) {
  const k = nodes.find(x => x.name === n)
  if (!k) continue
  if (k.children > 0) { blocked.push(`${n}（有 ${k.children} 个子节点，归档会把子节点变成顶层根）`); continue }
  plan.push({ id: k.id, name: n, level: k.level, mounts: k.mounts })
}

console.log('待归档 ' + plan.length + ' 个（全部无子节点）：')
for (const p of plan) console.log(`  ${p.name}  L${p.level}  挂载 ${p.mounts}`)
if (blocked.length) { console.log('\n⛔ 跳过（有子节点）：'); blocked.forEach(b => console.log('  ' + b)) }

if (!APPLY) { console.log('\n── dry-run 结束，未写库 ──'); await pool.end(); process.exit(0) }

const r = await pool.query(`UPDATE knowledge_points SET archived = true, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [plan.map(p => p.id)])
console.log(`\n✅ 已归档 ${r.rowCount} 个`)
const { rows: chk } = await pool.query(`
  SELECT (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND archived=false) AS live,
         (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND parent_id IS NULL AND archived=false) AS roots`)
console.log(`复核：可选考点 ${chk[0].live}｜可见根 ${chk[0].roots}（应仍 14）`)
await pool.end()
