/**
 * 回归测试（2026-09-25 修正定稿）：作图题「跳过视觉求解」预判闸。
 *
 * 演进：2026-09-24 首版把「证明/作图/主观」一起拦；2026-09-25 用户指出「证明题也能拿答案」
 * —— 生成参考答案 ≠ 自动判分，模型能写出证明过程当参考，判分链路对主观参考本就自动转人工。
 * ⇒ 本闸收窄为**只拦纯作图题**（答案是一张画在图上的图形、AI 给不出可核对文字参考）。
 *
 * 本测试守死的边界：
 *   · 证明 / 作文 / 解答类必须**放行**（不得再被误拦）；
 *   · 纯作图题（保留作图痕迹 / 不写作法 / 无刻度 / 尺规作图 / drawing 型）必须拦；
 *   · #24 求函数关系式、统计图、含 m=____ 的混合画图题必须放行（宁可漏拦不误伤可算题）；
 *   · 只在带配图（会走视觉）时触发，纯文字题零变化。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  isConstructionQuestion,
  isConstructionSkipEnabled,
  CONSTRUCTION_MANUAL_REASON,
} from '../server/utils/constructionQuestionGuard.js'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..', 'server')
const read = (p) => readFileSync(join(serverDir, p), 'utf8')

const ANSWER = 'answer'

// ──  该拦：纯作图题 ─────────────────────────────────────────────────────────
const construction = {
  question_type: ANSWER,
  parent_stem: '如图，每个小正方形的边长均为1，点A、B、C均在格点上。',
  content: '请仅用无刻度的直尺作线段BC的三等分点E、F.（保留作图痕迹，不写作法）',
}
assert.equal(isConstructionQuestion(construction), true, '作图题（保留作图痕迹/不写作法/无刻度）必须拦')
assert.equal(isConstructionQuestion({ question_type: 'drawing', content: '画出图形' }), true, 'drawing 型直接判作图题')

// ──  该放行：证明 / 作文 / 解答（2026-09-25 纠偏核心）─────────────────────────
const proof = {
  question_type: ANSWER,
  parent_stem: '如图，已知四边形ABCD是平行四边形。',
  content: '求证：△ABE≌△CDF。',
}
assert.equal(isConstructionQuestion(proof), false, '证明题必须放行——AI 能写出证明过程当参考答案')
assert.equal(isConstructionQuestion({ question_type: 'proof', content: '证明下列结论' }), false, 'proof 型不再拦（能产出可参考解答文本）')
assert.equal(isConstructionQuestion({ question_type: 'essay', content: '谈谈你的感想' }), false, 'essay 不再拦（本闸只管作图题）')
assert.equal(isConstructionQuestion({ question_type: 'composition', content: '写一篇短文' }), false, 'composition 不再拦')

// ──  该放行：可算题 / 混合题（宁可漏拦不误伤）────────────────────────────────
const fence = {
  question_type: ANSWER,
  parent_stem: '用长为30m的篱笆，一面靠墙（墙长18m），围成矩形花圃ABCD。',
  content: '设垂直于墙的一边长为 x m，花圃面积为 y m²，求 y 与 x 的函数关系式及自变量取值范围。',
}
const statistics = {
  question_type: ANSWER,
  parent_stem: '下面是六年级某班数学测验成绩的统计图。',
  content: '已知及格人数为36人，求全班人数。',
}
const mixedTable = {
  question_type: ANSWER,
  parent_stem: '上述表格中：m=____。',
  content: '通过分析数据，发现可以用函数刻画 y 与 x 的关系，请画出 y 与 x 的函数图象。',
}
assert.equal(isConstructionQuestion(fence), false, '#24 篱笆题（求函数关系式）绝不能被误拦')
assert.equal(isConstructionQuestion(statistics), false, '统计图求值题有可核对答案，不该拦')
assert.equal(isConstructionQuestion(mixedTable), false, '含 m=____ 可算小问的混合画图题必须放行')

// ──  非 answer 型不做题干关键词判定（零误伤）+ 空对象 ────────────────────────
assert.equal(
  isConstructionQuestion({ question_type: 'fill', content: '以下是用“尺规作图”分割三角形的四种作法，相似的有____（填序号）' }),
  false,
  'fill 型即便含「尺规作图」也不走题干判定（探针 #2 那类可算填空题零误伤）'
)
assert.equal(isConstructionQuestion({ question_type: 'choice', content: '下列正确的是' }), false, 'choice 不拦')
assert.equal(isConstructionQuestion(null), false, '空对象不得抛错')

// ── ⑤ 开关：显式关闭整体放行（回退用）────────────────────────────────────────
{
  const prev = process.env.ANSWER_CONSTRUCTION_SKIP
  process.env.ANSWER_CONSTRUCTION_SKIP = '0'
  assert.equal(isConstructionSkipEnabled(), false, '开关设 0 应关闭本闸')
  assert.equal(isConstructionQuestion(construction), false, '关闭后作图题也不再拦（回退路径）')
  process.env.ANSWER_CONSTRUCTION_SKIP = '1'
  assert.equal(isConstructionSkipEnabled(), true, '默认/设 1 开启')
  if (prev === undefined) delete process.env.ANSWER_CONSTRUCTION_SKIP
  else process.env.ANSWER_CONSTRUCTION_SKIP = prev
}

assert.ok(CONSTRUCTION_MANUAL_REASON && CONSTRUCTION_MANUAL_REASON.includes('作图'), '跳过原因常量必须存在且指明作图题')

// ── ⑥ 集成：两个入口都接了闸（静态断言）──────────────────────────────────────
const workerSrc = read('worker.js')
const indexSrc = read('index.js')

assert.ok(/isConstructionQuestion\(q\)/.test(workerSrc), 'worker.js 必须调用 isConstructionQuestion 做作图题预判')
assert.ok(
  /figUrl && String\(figUrl\)\.trim\(\) && isConstructionQuestion\(q\)/.test(workerSrc),
  'worker 作图闸必须限定「带配图（会走视觉）」才拦，纯文字题零变化'
)
assert.ok(
  /markAnswerException\(q\.id,\s*CONSTRUCTION_MANUAL_REASON\)/.test(workerSrc),
  'worker 跳过时必须写 answer_exception_reason（避免静默空），用 CONSTRUCTION_MANUAL_REASON'
)
// 旧命名不得残留（改名后若还有 isSubjectiveUnverifiable 说明漏改）
assert.equal(/isSubjectiveUnverifiable|SUBJECTIVE_MANUAL_REASON/.test(workerSrc), false, 'worker.js 不得残留旧的 subjective 命名')

{
  const start = indexSrc.indexOf("app.post('/api/questions/:id/recompute-answer'")
  assert.ok(start >= 0, '未找到 recompute-answer 路由')
  const rest = indexSrc.slice(start + 1)
  const next = rest.search(/\napp\.(post|get|put|patch|delete|use)\(/)
  const body = next < 0 ? indexSrc.slice(start) : indexSrc.slice(start, start + 1 + next)
  assert.ok(/hasFigure && isConstructionQuestion\(q\)/.test(body), '重解析接口必须对带配图的作图题预判跳过视觉')
  const gateAt = body.indexOf('isConstructionQuestion(q)')
  const loopAt = body.indexOf('for (const ch of solveChain)')
  assert.ok(gateAt >= 0 && loopAt >= 0 && gateAt < loopAt, '作图闸必须位于求解循环之前，避免仍发起视觉调用')
  assert.ok(
    /error:\s*'ai-declined'/.test(body.slice(gateAt, gateAt + 600)),
    '作图闸必须返回 ai-declined 终态码（前端按 warning 处理，不误导重试）'
  )
  assert.equal(/isSubjectiveUnverifiable/.test(body), false, 'index 路由体不得残留旧的 isSubjectiveUnverifiable 命名')
}

console.log('✓ constructionQuestionGuard: 全部通过（只拦作图题；证明/作文/#24/统计/混合题放行；两入口接线；循环前拦截）')
