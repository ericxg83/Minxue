/**
 * 人工复核 109 条 P2 候选前置关系（对应交接文档待办 ①）
 * ──────────────────────────────────────────────────────────
 * 判据（逐条过 why，任一成立即拒收）：
 *   1. 反向      —— 教材顺序里后学的被当成先修（沪教版五四制）
 *   2. 循环      —— 与已有 confirmed / proposed 边互指，或候选内部互指
 *   3. 包含      —— from 是 to 的上位概括（「幂的运算 → 幂的乘方」这类），不是先修
 *   4. 无依赖    —— why 停留在「涉及 / 有关 / 需要了解」，说不出数学依赖
 *   5. 同义      —— from/to 是同一技能拆出来的近似同义节点
 *   6. 远祖      —— 跨度太大，且 confirmed 里已有更近的链（如 有理数→实数→二次根式）
 *
 * 输出：
 *   _tmp_prereq_fill.json            只留通过的（供 fillPrerequisites.mjs --from-file --apply）
 *   _tmp_prereq_review_decisions.json 109 条全量决策留痕（审计用）
 * 本脚本只读库、只写 _tmp_*，不碰数据库。
 *
 * ── 2026-10-07 执行结果（留痕）──────────────────────────────────
 *   候选 109 条 → 通过 33 / 拒收 76：
 *     反向 20 ｜ 无依赖 26 ｜ 包含 18 ｜ 循环 7 ｜ 同义 4 ｜ 远祖 1
 *   落库后 confirmed 88 → 121（用 fillPrerequisites.mjs --from-file --apply）。
 *   重复跑安全：只写 _tmp_*，不会写库。
 */
import '../loadEnv.js'
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = path.join(ROOT, '_tmp_prereq_fill.json')
const KEPT_OUT = path.join(ROOT, '_tmp_prereq_fill.json')
const DEC_OUT = path.join(ROOT, '_tmp_prereq_review_decisions.json')

const original = JSON.parse(fs.readFileSync(SRC, 'utf8'))
console.log('读入候选：' + original.length + ' 条')

const KEEP = [
  '二次根式的乘法|根式化简',
  '分数的基本性质|分数运算',
  '有理数|无理数',
  '二次根式的性质|二次根式的乘法',
  '二次根式的性质|根式运算',
  '一元二次方程|公式法解一元二次方程',
  '方程的概念|方程求解',
  '单项式乘法|完全平方公式',
  '同类项的概念|合并同类项',
  '分数的基本性质|分数加减法',
  '分式的基本性质|分式加减法',
  '一次函数|与坐标轴交点',
  '二次函数|与坐标轴交点',
  '同底数幂的乘法|同底数幂的除法',
  '分数的基本性质|分数化简',
  '小数与分数的互化|循环小数',
  '分数的基本性质|分数加法',
  '分数的意义|分数应用',
  '面积公式|面积计算',
  '分数的基本性质|约分',
  '乘法运算|除法运算',
  '分数的基本性质|通分',
  '多项式乘法|配方法',
  '同类项合并|配方法',
  '分数的意义|小数与分数的互化',
  '一元一次方程|方程的解法',
  '数的开方|根号下的运算',
  '二次函数|顶点式',
  '分数的意义|分数与小数的互化',
  '单项式|单项式乘法',
  '圆的概念|圆的面积',
  '分数的基本性质|最简分数',
  '长方体体积公式|正方体体积',
]

const REJECT = {
  '反向（后学当前置，与教材顺序相反）': [
    '分数的加减运算|分数乘法',
    '单项式乘法|分数乘法',
    '指数与根式的运算|幂的乘方',
    '数的分解|数的分类',
    '数的开方|数的分类',
    '数的性质|数的分类',
    '指数与根式的运算|幂的运算',
    '最大公因数|整除',
    '分数与小数的互化|小数运算',
    '分数的加减运算|分数除法',
    '数的分解|因数',
    '整数指数幂|整数性质',
    '分数的加减运算|分数的乘除法',
    '指数与根式的运算|同底数幂的除法',
    '质因数分解|合数',
    '因式分解|质因数分解',
    '分数的基本性质|分数的意义',
    '等腰三角形判定|等腰三角形性质',
    '角的度量与角度制|线与角',
    '二次函数与一元二次方程的关系|一般式二次函数的图象和性质',
  ],
  '循环（与已有边互指）': [
    '相似三角形的性质|相似三角形的判定',
    '完全平方公式|平方差公式',
    '平方差公式|完全平方公式',
    '方程的解法|方程',
    '方程的概念|方程',
    '方程思想|方程',
    '分式的乘除法|分式加减法',
  ],
  '包含（上位概括当前置，非先修）': [
    '分数的加减运算|实数的运算',
    '指数与根式的运算|指数运算',
    '幂的乘方|指数运算',
    '幂的运算|指数运算',
    '幂的运算|幂的乘方',
    '幂的乘方|幂的运算',
    '幂的运算|同底数幂的除法',
    '小数运算|循环小数',
    '整式运算|配方法',
    '整式运算|多项式乘法',
    '整式运算|同类项合并',
    '抛物线性质|抛物线对称性',
    '整式乘法|整式运算',
    '分数的加减运算|同分母分数的加减法',
    '整式运算|整式乘法',
    '数的分类|素数',
    '指数与根式的运算|负数指数幂',
    '数的分类|奇数与偶数',
  ],
  '无依赖（why 说不出真实数学依赖，或前提有误）': [
    '数轴|科学记数法',
    '数的分类|实数的运算',
    '乘法运算|完全平方公式',
    '乘法运算|分数乘法',
    '单项式乘法|合并同类项',
    '单项式除以单项式|合并同类项',
    '分数的乘除法|分数加减法',
    '平方差公式|幂的乘方',
    '平方差公式|幂的运算',
    '分数的乘除法|分数化简',
    '分数的加减运算|分数化简',
    '整数性质|整除',
    '分数的加减运算|循环小数',
    '有理数|数的性质',
    '幂的乘方|整数指数幂',
    '最小公倍数|最大公因数',
    '数的分类|倍数',
    '分数的加减运算|百分比计算',
    '方程的解法|实际问题解决',
    '正数和负数的概念|非负性',
    '有理数乘方的概念|新定义运算',
    '有理数乘方的概念|有理数大小比较',
    '有理数|零指数幂',
    '完全平方公式|完全平方数',
    '数轴|最大值与最小值',
    '一元二次方程|待定系数法',
  ],
  '同义（同一技能拆出的近似节点，留一条即可）': [
    '分数的加减运算|分数加减法',
    '分式的概念与基本性质|分式加减法',
    '倍数|因数与倍数',
    '指数运算|指数法则',
  ],
  '远祖（跨度过大，confirmed 链已覆盖）': [
    '有理数|二次根式的性质',
  ],
}

const keepSet = new Set(KEEP)
const rejectMap = new Map()
for (const [cat, arr] of Object.entries(REJECT)) for (const k of arr) rejectMap.set(k, cat)

// ── 完整性校验：KEEP ∪ REJECT 必须正好覆盖 109 条，且互斥 ──
const allKeys = original.map(e => `${e.from}|${e.to}`)
const dupKeys = allKeys.filter((k, i) => allKeys.indexOf(k) !== i)
if (dupKeys.length) { console.log('❌ 候选里有重复键：' + dupKeys.join(', ')); process.exit(1) }
const overlap = [...keepSet].filter(k => rejectMap.has(k))
if (overlap.length) { console.log('❌ 同时被 KEEP 和 REJECT：' + overlap.join(', ')); process.exit(1) }
const missing = allKeys.filter(k => !keepSet.has(k) && !rejectMap.has(k))
if (missing.length) { console.log('❌ 未决策 ' + missing.length + ' 条：'); for (const k of missing) console.log('   ' + k); process.exit(1) }
const phantom = [...keepSet, ...rejectMap.keys()].filter(k => !allKeys.includes(k))
if (phantom.length) { console.log('❌ 决策里有候选文件不存在的键：' + phantom.join(', ')); process.exit(1) }

const kept = original.filter(e => keepSet.has(`${e.from}|${e.to}`))
const decisions = original.map(e => {
  const k = `${e.from}|${e.to}`
  return {
    from: e.from, to: e.to, mounts: e.toMounts, why: e.why,
    decision: keepSet.has(k) ? 'keep' : 'reject',
    category: keepSet.has(k) ? '通过' : rejectMap.get(k),
  }
})

const catCount = {}
for (const d of decisions.filter(d => d.decision === 'reject')) catCount[d.category] = (catCount[d.category] || 0) + 1
console.log('')
console.log('通过 ' + kept.length + ' 条 ｜ 拒收 ' + (original.length - kept.length) + ' 条')
for (const [c, n] of Object.entries(catCount)) console.log('   拒收·' + c + '：' + n)

fs.writeFileSync(KEPT_OUT, JSON.stringify(kept, null, 2), 'utf8')
fs.writeFileSync(DEC_OUT, JSON.stringify({ reviewedAt: new Date().toISOString(), total: original.length, kept: kept.length, catCount, decisions }, null, 2), 'utf8')
console.log('')
console.log('-> _tmp_prereq_fill.json（只留通过项，供 --from-file --apply）')
console.log('-> _tmp_prereq_review_decisions.json（109 条全量留痕）')
