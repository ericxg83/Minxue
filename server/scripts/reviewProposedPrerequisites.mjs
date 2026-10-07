/**
 * 人工复核 AI 候选前置关系（status='proposed' 的 102 条）—— 交接文档遗留项 ①
 * ═══════════════════════════════════════════════════════════════
 * 背景：这 102 条是「按课标顺序」让模型生成的候选，reason 全是同一句模板
 *   （「教材顺序：X 早于 Y，且是后者的必要基础」），**没有一条讲过具体数学依赖**。
 *   红线是「AI 候选不要直接转 confirmed」⇒ 本轮逐条过，只把讲得通的转 confirmed
 *   （并补写具体理由），讲不通的置 rejected（留痕，不删行）。
 *
 * 判据（与 P2 轮同一套，逐条过）：
 *   反向   —— 教材顺序里后学的被当成先修
 *   包含   —— from 是 to 的上位概括 / to 是 from 的组成部分（不是先修）
 *   同义   —— 两个节点是同一技能的不同写法
 *   重复   —— confirmed 里已有更贴近的先修链，补这条只是稀释「建议先补」列表
 *   无依赖 —— reason 说不出真实数学依赖（模板句不算）
 *
 * ⛔ 默认 dry-run。`--apply` 才写库（写前自动备份 kp_relations）。
 *
 * ── 2026-10-07 执行结果（留痕）──────────────────────────────────
 *   候选 102 条 → 通过 23 / 拒收 79：
 *     反向 12 ｜ 包含 39 ｜ 同义 4 ｜ 重复 14 ｜ 无依赖 10
 *   落库后：confirmed 121 → 144（近义节点合并去重后 143）、proposed 清零、rejected 79。
 *   补掉的重点空档：「二次根式的性质」（268 题挂载，全库最高频）此前没有任何已确认前置。
 *   重复跑安全：proposed 为空时直接退出，不写库。
 *
 * 用法：
 *   node server/scripts/reviewProposedPrerequisites.mjs            # 演练：打印每条决策
 *   node server/scripts/reviewProposedPrerequisites.mjs --apply    # 落库
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

/** 通过：转 confirmed，并补上「讲得通」的具体理由 */
const KEEP = [
  ['二次根式', '二次根式的性质', '性质（√a²=|a|、√(ab)=√a·√b）是对「二次根式」概念的展开：先认清根号下是什么，才谈得上性质。全库最高频考点（268 题挂载）此前没有任何已确认前置。'],
  ['相似三角形', '相似三角形的判定', '判定方法（两角/两边夹角/三边）都建立在相似三角形的定义上（对应角相等、对应边成比例）；且判定之后才是性质。'],
  ['一元一次方程', '一元二次方程', '解一元二次方程靠降次与配方，最终都要化回一元一次方程求解 —— 不会解一元一次方程就断在最后一步。'],
  ['二次根式', '二次根式的加减', '加减要先化成最简二次根式、再合并同类根式，前提是先认识二次根式。'],
  ['平行线的性质', '平行四边形', '平行四边形的判定与性质反复使用平行线的性质（同位角/内错角/同旁内角）。'],
  ['一元一次方程', '代入消元法', '代入消元法把二元方程组化为一元一次方程求解。'],
  ['平行线的性质', '梯形的简单认识', '梯形的两底平行，判定与计算都要用平行线的性质。'],
  ['绝对值', '绝对值方程的解法', '|x|=a 要按 a>0 / a=0 / a<0 分类讨论，依据就是绝对值的定义。'],
  ['解一元一次不等式', '一元一次不等式组', '不等式组的解是两个不等式解集的交集，单个不等式不会解就取不出交集。'],
  ['一元二次方程', '因式分解法解一元二次方程', '因式分解法先整理成一般式再分解求根，前提是认识一元二次方程（与已确认的「公式法」同一口径）。'],
  ['一元一次方程', '三元一次方程组的解法', '三元消元后仍要解一元一次方程，只是多消一轮。'],
  ['几何图形的概念', '三视图的画法与识读', '三视图是几何体在不同方向的投影，先有几何图形的基本概念才能读图。'],
  ['一元一次方程', '列一元一次方程解应用题', '列方程解应用题的落点就是解一元一次方程（与已确认的「一元一次方程 → 利润/行程/工程问题」同族）。'],
  ['二元一次方程组', '列二元一次方程组解应用题', '同上，落点是解二元一次方程组（与已确认的「二元一次方程组 → 实际问题建模」同族）。'],
  ['一元一次方程', '列方程解应用题（综合类型）', '综合类型应用题仍要落到解一元一次方程。'],
  ['一元一次方程', '加减消元法', '加减消元法同样把方程组化回一元一次方程。'],
  ['一元二次方程', '用一元二次方程解决实际问题', '实际问题的落点是列并解一元二次方程。'],
  ['轴对称与轴对称图形', '画轴对称图形', '会画的前提是先认识轴对称图形（对称轴、对应点）。'],
  ['圆的概念', '直径', '直径是圆的基本要素（与已确认的「圆的概念 → 半径」同一口径）。'],
  ['全等三角形', '直角三角形全等的判定（HL）', 'HL 是全等判定在直角三角形上的特例，仍要先掌握全等三角形。'],
  ['等式的性质', '移项法则', '移项的本质是等式两边同加同减，依据就是等式的性质。'],
  ['等式的性质', '系数化为 1', '系数化为 1 是等式两边同乘同除，同样依据等式的性质。'],
  ['一元一次方程', '解一元一次方程的完整步骤', '完整步骤（去分母→去括号→移项→合并→系数化为 1）的对象就是一元一次方程。'],
]

/** 不通过：置 rejected（留痕，不删行） */
const REJECT = {
  '反向（教材顺序里后学的被当成先修）': [
    ['位似变换', '相似三角形'],            // confirmed 已是「相似三角形 → 位似变换」，此边还会成环
    ['等腰三角形判定', '等腰三角形性质'],   // 教材先性质（等边对等角）后判定（等角对等边）
    ['分数与整数混合运算', '分数乘法'],
    ['分数与整数混合运算', '分数除法'],
    ['分数与整数混合运算', '分数的乘除法'],
    ['分数与整数混合运算', '分数乘以分数'],
    ['分式加减法', '分式的乘除法'],
    ['分式加减法', '分式的基本性质'],
    ['分式加减法', '分式的概念与基本性质'],
    ['分式加减法', '分式的乘除运算'],
    ['三角形的概念与分类', '角平分线'],     // 角平分线是更早的几何基础概念
    ['圆周角与圆心角', '弧、弦、圆心角的关系与圆周角定理'], // confirmed 已是反向，互指
  ],
  '包含（上位概括/组成部分当前置）': [
    ['分数与整数混合运算', '分数运算'],
    ['方程', '方程求解'],
    ['方程', '方程的解法'],
    ['方程', '方程的概念'],
    ['方程', '方程的解与解方程'],
    ['方程', '方程思想'],
    ['三角形的概念与分类', '全等三角形'],
    ['三角形的概念与分类', '等腰三角形判定'],
    ['三角形的概念与分类', '等边三角形判定'],
    ['三角形的概念与分类', '三角形内角和定理及证明'],
    ['三角形的概念与分类', '三角形的边的关系'],
    ['三角形的概念与分类', '三角形外角'],
    ['三角形的概念与分类', '三角形的角'],
    ['三角形的概念与分类', '三角形的顶点'],
    ['三角形的概念与分类', '三角形的高'],
    ['三角形的概念与分类', '三角形的稳定性'],
    ['三角形的概念与分类', '三角形的内切圆'],
    ['三角形的概念与分类', '三角形的外接圆'],
    ['等腰三角形判定', '特殊三角形'],
    ['等边三角形判定', '特殊三角形'],
    ['分式加减法', '分式运算'],
    ['锐角三角函数的定义', '三角函数'],
    ['锐角三角函数的定义', '仰角'],
    ['锐角三角函数的定义', '俯角'],
    ['锐角三角函数的定义', '坡度'],
    ['锐角三角函数的定义', '坡角'],
    ['投影的概念', '中心投影'],
    ['投影的概念', '正投影'],
    ['三视图的画法与识读', '主视图'],
    ['三视图的画法与识读', '俯视图'],
    ['三视图的画法与识读', '左视图'],
    ['圆的概念', '半圆'],
    ['圆的概念', '圆周角与圆心角'],
    ['圆的概念', '点与圆的位置关系'],
    ['圆的概念', '切线'],
    ['点与圆的位置关系', '点、直线与圆的位置关系'],
    ['数据描述', '方差与标准差'],
    ['数据描述', '极差'],
    ['分数与整数混合运算', '分数加减混合运算'],
  ],
  '同义（同一技能的不同写法，留一条即可）': [
    ['分数与整数混合运算', '分数与除法'],
    ['分式加减法', '分式的加减运算'],
    ['等腰三角形判定', '等腰三角形的性质与判定'],
    ['等边三角形判定', '等边三角形的性质与判定'],
  ],
  '重复（confirmed 里已有更贴近的先修链，补了只是稀释）': [
    ['圆的概念', '三角形的外接圆'],
    ['一元一次方程', '二元一次方程与方程组的概念'],
    ['比', '位似变换'],
    ['比例', '位似变换'],
    ['半径', '切线'],
    ['圆周角与圆心角', '弧长公式'],
    ['圆的概念', '点、直线与圆的位置关系'],
    ['三视图的画法与识读', '测量问题'],
    ['概率', '用列举法（列表/树状图）求概率'],
    ['概率', '用频率估计概率'],
    ['锐角三角函数的定义', '解直角三角形及实际应用'],
    ['分数与整数混合运算', '分数应用'],
    ['分数加减法', '利润问题'],
    ['分数应用', '利润问题'],
  ],
  '无依赖（reason 说不出真实数学依赖）': [
    ['分数与整数混合运算', '分母有理化'],   // 交接文档点名的经典反例
    ['分数与整数混合运算', '分数与根号比较'],
    ['乘法运算', '二次根式的乘法'],
    ['线段垂直平分线的性质与判定', '中心对称与中心对称图形'],
    ['线段比例', '中心对称与中心对称图形'],
    ['线段的中点', '中心对称与中心对称图形'],
    ['三角形内角和定理及证明', '四边形综合证明'],
    ['三角形外角', '四边形综合证明'],
    ['圆周角与圆心角', '圆的综合证明与计算'],
    ['圆的面积', '圆的综合证明与计算'],
  ],
}

const key = (f, t) => f + '|' + t
const keepMap = new Map(KEEP.map(([f, t, why]) => [key(f, t), why]))
const rejectMap = new Map()
for (const [cat, arr] of Object.entries(REJECT)) for (const [f, t] of arr) rejectMap.set(key(f, t), cat)

const { rows: proposed } = await pool.query(`
  SELECT r.id, f.name AS fname, t.name AS tname
    FROM kp_relations r
    JOIN knowledge_points f ON f.id = r.from_kp_id
    JOIN knowledge_points t ON t.id = r.to_kp_id
   WHERE r.status = 'proposed' ORDER BY t.name, f.name`)

if (proposed.length === 0) {
  console.log('没有待复核的候选（proposed 已清零）—— 本脚本是一次性人工复核的留痕，重复跑是安全的。')
  await pool.end(); process.exit(0)
}

// ── 完整性校验：每条候选都必须有决策，且不重复 ──
const allKeys = proposed.map(r => key(r.fname, r.tname))
const missing = allKeys.filter(k => !keepMap.has(k) && !rejectMap.has(k))
const phantom = [...keepMap.keys(), ...rejectMap.keys()].filter(k => !allKeys.includes(k))
const dup = allKeys.filter((k, i) => allKeys.indexOf(k) !== i)
if (missing.length) { console.log('❌ 未决策 ' + missing.length + ' 条：\n   ' + missing.join('\n   ')); await pool.end(); process.exit(1) }
if (phantom.length) { console.log('❌ 决策里有候选表不存在的键：\n   ' + phantom.join('\n   ')); await pool.end(); process.exit(1) }
if (dup.length) { console.log('❌ 候选里有重复键：' + dup.join(', ')); await pool.end(); process.exit(1) }
const both = [...keepMap.keys()].filter(k => rejectMap.has(k))
if (both.length) { console.log('❌ 同时通过又拒收：' + both.join(', ')); await pool.end(); process.exit(1) }

console.log(`候选 ${proposed.length} 条：通过 ${KEEP.length} ｜ 拒收 ${rejectMap.size}`)
for (const [cat, arr] of Object.entries(REJECT)) console.log(`   · ${cat}：${arr.length}`)
console.log('')
console.log('=== 转 confirmed 的（含补写的理由）===')
for (const r of proposed.filter(r => keepMap.has(key(r.fname, r.tname)))) {
  console.log(`  ${r.fname} → ${r.tname}`)
  console.log(`      ${keepMap.get(key(r.fname, r.tname))}`)
}

if (!APPLY) {
  console.log('')
  console.log('── dry-run 结束，未写库。确认无误后加 --apply ──')
  await pool.end(); process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const bakPath = path.join(ROOT, 'server', `_backup_kp_relations_proposed_${stamp}.json`)
fs.writeFileSync(bakPath, JSON.stringify({
  at: new Date().toISOString(),
  rows: (await pool.query(`SELECT * FROM kp_relations`)).rows,
}, null, 2), 'utf8')
console.log('')
console.log('备份 -> ' + path.basename(bakPath))

const client = await pool.connect()
let promoted = 0, rejected = 0
try {
  await client.query('BEGIN')
  for (const r of proposed) {
    const k = key(r.fname, r.tname)
    if (keepMap.has(k)) {
      const res = await client.query(
        `UPDATE kp_relations SET status='confirmed', basis='数学依赖', reason=$2, updated_at=now() WHERE id=$1`,
        [r.id, keepMap.get(k)])
      promoted += res.rowCount
    } else {
      const res = await client.query(
        `UPDATE kp_relations SET status='rejected', basis='人工复核未通过', reason=$2, updated_at=now() WHERE id=$1`,
        [r.id, '复核不通过：' + rejectMap.get(k)])
      rejected += res.rowCount
    }
  }
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  console.log('❌ 已回滚：' + e.message)
  client.release(); await pool.end(); process.exit(1)
}
client.release()
console.log(`✅ 转 confirmed ${promoted} ｜ 置 rejected ${rejected}`)
const { rows: st } = await pool.query(`SELECT status, count(*)::int AS n FROM kp_relations GROUP BY status ORDER BY status`)
console.log('状态复核：' + st.map(r => r.status + '=' + r.n).join(' ｜ '))

// 无环复核（转 confirmed 后必须仍无环）
const { rows: cyc } = await pool.query(`
  WITH RECURSIVE walk AS (
    SELECT r.from_kp_id AS start, r.to_kp_id AS cur, 1 AS d
      FROM kp_relations r WHERE r.status = 'confirmed'
    UNION ALL
    SELECT w.start, r.to_kp_id, w.d + 1
      FROM walk w JOIN kp_relations r ON r.from_kp_id = w.cur AND r.status = 'confirmed'
     WHERE w.d < 12
  )
  SELECT count(*)::int AS n FROM walk WHERE cur = start`)
console.log('confirmed 图环边：' + cyc[0].n + (cyc[0].n === 0 ? ' ✅' : ' ⛔ 必须回滚'))
const { rows: cov } = await pool.query(`SELECT count(DISTINCT to_kp_id)::int AS n FROM kp_relations WHERE status='confirmed'`)
console.log('confirmed 覆盖考点：' + cov[0].n)
await pool.end()
