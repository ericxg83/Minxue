/**
 * 批次 2：修正挂错父节点的知识点（只改 parent_id，不碰任何关联）
 * ⛔ 默认 dry-run，--apply 才写库。
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const { default: pg } = await import('pg')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// [节点名, 目标父节点名, 理由]
const MOVES = [
  ['三元一次方程组的解法', '方程与方程组', '是方程解法，不是「数」'],
  ['两点间的距离', '几何基础', '几何度量'],
  ['关于原点对称的点', '图形变换', '对称变换，不是函数'],
  ['函数模型', '函数', '函数建模，不是综合实践'],
  ['列一元一次方程解应用题', '方程与方程组', '方程应用'],
  ['列方程解应用题（综合类型）', '方程与方程组', '方程应用'],
  ['圆周率', '圆', '圆的内容'],
  ['圆的面积', '圆', '圆的内容'],
  ['多边形内角和', '四边形', '多边形属四边形章节，不在三角形下'],
  ['多边形外角和', '四边形', '同上'],
  ['对称性', '图形变换', '图形变换，不是数'],
  ['抽样的代表性与随机性', '统计与概率', '统计内容'],
  ['方程思想', '方程与方程组', '方程内容'],
  ['方程求解', '方程与方程组', '方程内容'],
  ['正方体体积', '几何基础', '立体图形度量'],
  ['点线面体的关系', '几何基础', '立体图形'],
  ['用一元二次方程解决实际问题', '方程与方程组', '方程应用'],
  ['用公式法分解因式', '数与式', '因式分解属数与式，不属方程'],
  ['用列举法（列表/树状图）求概率', '统计与概率', '概率内容'],
  ['用去括号解方程', '方程与方程组', '方程解法'],
  ['用合并同类项和移项解方程', '方程与方程组', '方程解法'],
  ['用坐标描述简单几何图形', '函数', '坐标系内容'],
  ['用坐标表示地理位置', '函数', '坐标系内容'],
  ['画轴对称图形', '图形变换', '轴对称属图形变换'],
  ['直角三角形全等的判定（HL）', '三角形', '三角形内容'],
  ['立体模型制作', '几何基础', '立体图形'],
  ['等腰三角形的性质与判定', '三角形', '三角形内容'],
  ['等边三角形的性质与判定', '三角形', '三角形内容'],
  ['统计图的选择与绘制', '统计与概率', '统计内容'],
  ['角度关系', '几何基础', '角的内容'],
  ['角度的度量', '几何基础', '角的内容'],
  ['角的大小比较', '几何基础', '角的内容'],
  ['解一元一次方程的完整步骤', '方程与方程组', '方程解法'],
  ['轴对称与轴对称图形', '图形变换', '轴对称属图形变换'],
  ['轴对称变换', '图形变换', '轴对称属图形变换'],
  ['长方体体积计算', '几何基础', '立体图形度量'],
  ['长方形面积计算', '几何基础', '图形度量'],
  ['面积公式', '几何基础', '图形度量，不专属圆'],
  ['面积计算', '几何基础', '图形度量'],
]

// 自动聚类判错 → 不动
const KEEP = [
  ['对称轴', '在函数语境下指抛物线的对称轴（挂 72 次），不是几何的对称轴'],
  ['待定系数法', '求函数表达式的方法，留在函数下合理'],
  ['顶点式', '二次函数的顶点式，留在函数下'],
  ['等式的性质', '解方程的基础，留在方程与方程组可接受'],
  ['系数化为 1', '解一元一次方程的步骤，留在方程下'],
  ['坡角', '解直角三角形的应用，留在锐角三角函数下'],
]

const { rows: kps } = await pool.query(
  `SELECT id, name, parent_id, level FROM knowledge_points WHERE subject = '数学'`)
const byName = new Map(kps.map(r => [r.name, r]))
const byId = new Map(kps.map(r => [r.id, r]))

const out = []
const say = (...a) => { const s = a.join(' '); out.push(s); console.log(s) }

say(`数学知识点 ${kps.length} 个`)
const plan = []
const problems = []
for (const [name, target, why] of MOVES) {
  const node = byName.get(name)
  const parent = byName.get(target)
  if (!node) { problems.push(`找不到节点「${name}」`); continue }
  if (!parent) { problems.push(`找不到目标父节点「${target}」`); continue }
  if (node.id === parent.id) { problems.push(`「${name}」目标是它自己`); continue }
  const cur = node.parent_id ? byId.get(node.parent_id)?.name : '(根)'
  if (cur === target) continue
  plan.push({ id: node.id, name, from: cur, to: target, toId: parent.id, why })
}
say(`待移动 ${plan.length} 个 ｜ 问题 ${problems.length}${problems.length ? '：' + problems.join('；') : ''}`)
say('')
for (const p of plan) say(`  「${p.name}」 ${p.from} -> ${p.to}   〔${p.why}〕`)
say('')
say(`判为自动聚类误报、不动 ${KEEP.length} 个：`)
for (const [n, w] of KEEP) say(`  「${n}」 ${w}`)

if (!APPLY) {
  say('')
  say('── dry-run 结束，未写库 ──')
  fs.writeFileSync(path.resolve(ROOT, '_tmp_kp_reparent_report.txt'), out.join('\n'), 'utf8')
  await pool.end()
  process.exit(0)
}

say('')
say('=== 落库 ===')
const client = await pool.connect()
try {
  await client.query('BEGIN')
  let n = 0
  for (const p of plan) {
    const r = await client.query(`UPDATE knowledge_points SET parent_id = $1, updated_at = NOW() WHERE id = $2`, [p.toId, p.id])
    n += r.rowCount
  }
  await client.query('COMMIT')
  say(`  ✅ 已移动 ${n} 个节点`)
} catch (e) {
  await client.query('ROLLBACK')
  say(`  ❌ 已回滚：${e.message}`)
  client.release(); await pool.end(); process.exit(1)
}
client.release()
const { rows: chk } = await pool.query(`
  SELECT (SELECT count(*)::int FROM knowledge_points WHERE subject='数学') AS kp,
         (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND parent_id IS NULL) AS roots`)
say(`  复核：数学节点 ${chk[0].kp}（应仍为 465）｜ 根节点 ${chk[0].roots}（应仍为 13）`)
fs.writeFileSync(path.resolve(ROOT, '_tmp_kp_reparent_report.txt'), out.join('\n'), 'utf8')
await pool.end()
