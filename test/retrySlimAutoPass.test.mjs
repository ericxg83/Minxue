// 回归测试：重练答卷（slim 管线）的「减负两刀」P0 + P1（2026-09-17）
//
// 背景：重练卷要老师复核的原因实测只有一个 —— 主观题（解答题）在 slim 里被无条件转人工。
//   近 45 天 10 份答卷、51 道待人工 100% 出自这一个分支，其中 20 道是
//   ① 学生**根本没写**的解答题（本该落 blank 终态，不进待办）
//   ② 学生写了且用参考答案判等**明确判对**的解答题
//
// P0：把「学生未作答」判定提到「主观题」之前 → 未作答主观题落 blank(false)，
//     与客观题未作答行为对齐（6 态 blank 是终态，不占老师待办）。
// P1：主观题先跑一次 judgeAnswer，**只放行 isCorrect===true**；
//     判错/判不出仍旧转人工 —— 这个不对称是刻意设计的：
//     解答题参考答案是一整段过程，可能本身有误，判错的代价（假红叉 + 误入错题本 +
//     进下一轮重练）远大于判对。谁把这里改成"判错也自动过"，本测试就要拦住他。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const WORKER = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')

const slimBody = (() => {
  const start = WORKER.indexOf('export const processSlimGrading')
  assert.ok(start > -1, '找不到 processSlimGrading')
  const next = WORKER.indexOf('\nexport const ', start + 10)
  return WORKER.slice(start, next > -1 ? next : undefined)
})()

// 判据只认代码（注释里会引用旧写法做事故说明）
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n')

const slimCode = stripComments(slimBody)

const idxBlank = slimCode.indexOf('reason: \'blank\'')
const idxSubjective = slimCode.indexOf('SUBJECTIVE_TYPES.has(qType)')
const idxObjectiveJudge = slimCode.indexOf('const judgment = judgeAnswer(studentAnswer, stored.answer, stored.question_type)')

test('P0：未作答判定必须排在主观题判定之前（否则空白解答题会冒充"待人工"）', () => {
  assert.ok(idxBlank > -1, '找不到 blank 分支')
  assert.ok(idxSubjective > -1, '找不到主观题分支')
  assert.ok(
    idxBlank < idxSubjective,
    '「学生未作答」必须排在「主观题」之前 —— 排在后面时，学生根本没写的解答题会落 ' +
    'reason=subjective 计入 manualCount，整卷不满足全自动、卷子永远停在待复核'
  )
})

test('P0：未作答主观题必须落 blank 终态（is_correct=false + answer_source 走 blank）', () => {
  const block = slimCode.slice(idxBlank - 400, idxBlank + 300)
  assert.match(block, /!studentAnswer/, 'blank 判据必须是 !studentAnswer')
  assert.match(block, /isCorrect: false/, '未作答必须显式写 false')
  assert.match(block, /confidence: 0/, '未作答置信度结构性为 0')
  assert.match(block, /autoCount\+\+/, '未作答属于"已判定"，不能再计入 manualCount')
  assert.ok(!/manualCount\+\+/.test(block), '未作答不得计入 manualCount')
})

test('P1：主观题必须先跑 judgeAnswer 再决定是否转人工', () => {
  assert.ok(idxSubjective > -1 && idxObjectiveJudge > idxSubjective, '找不到主观题分支边界')
  const block = slimCode.slice(idxSubjective, idxObjectiveJudge)
  assert.match(block, /judgeAnswer\(/, '主观题分支里必须真的拿参考答案判一次，而不是直接转人工')
  assert.match(block, /isCorrect === true/, '放行条件必须显式要求 isCorrect === true（单向）')
  assert.match(block, /CONFIDENCE_THRESHOLD/, '必须沿用客观题同一置信度门槛')
  assert.match(block, /reason: 'subjective'/, '判不出/判错时必须保留 subjective 兜底转人工')
})

test('P1：主观题分支内不得出现自动判错（这是不可逆放水）', () => {
  const block = slimCode.slice(idxSubjective, idxObjectiveJudge)
  const bad = block.match(/isCorrect: false/g) || []
  assert.deepEqual(
    bad,
    [],
    '主观题自动判错会把「参考答案本身有误」变成假红叉 + 误入错题本，必须只放行判对'
  )
  assert.ok(
    /isCorrect: null, source: 'manual'/.test(block),
    '判错/判不出必须落 isCorrect=null 转人工'
  )
})

// ── 2026-09-17 第二批：批完即出结果（结算提前 + 统计分桶 + 待确认状态）──
// 用户口径：「和批改任务一样，正确多少错误多少待复核就可以了，不用必须整卷复核了再给结果」。
// 通用作业管线（worker.js 的 finalizeGradingBatch）本来就是批改末尾即结算、不等老师复核，
// 重练卷的 allAuto 门禁才是那个例外。

test('slim 结算不得再依赖 allAuto —— 有结论就该结算（只传有结论的题）', () => {
  const idx = slimCode.indexOf('settledResults')
  assert.ok(idx > -1, '必须构造 settledResults（只含有结论的题）')
  const settleBlock = slimCode.slice(idx, idx + 900)
  assert.match(settleBlock, /filter\(\(r\) => r\.isCorrect !== null\)/, '未判定题不得进结算（要继续留在老师待办里）')
  assert.match(settleBlock, /settledResults\.length > 0/, '结算条件是"有结论的题数 > 0"')
  assert.ok(
    !/if \(allAuto\)/.test(slimCode),
    '不得再用 if (allAuto) 当结算门禁 —— 一道题转人工就锁死整卷，家长端永远出不了结果'
  )
})

test('slim 统计必须按本卷 questionIds 取行，不得按 task_id 查题', () => {
  // 重练答卷在 questions 表里没有本卷题行（题目行是原作业共用行），按 task_id 查恒 0 行
  // ⇒ 四桶全为 0 ⇒ 卡片只能拿整卷题数当"待处理"。
  // 注释里写的是"统计分桶"，因此定位用带注释的原文，断言用去注释版（避免注释里
  // 复述旧写法也能过）。
  const anchor = slimBody.indexOf('统计分桶')
  assert.ok(anchor > -1, '找不到四桶统计段')
  const statsBlock = stripComments(slimBody.slice(anchor, anchor + 1800))
  assert.match(statsBlock, /computeTaskStats/, '必须复用统一四桶口径，不许手写第二套分桶')
  assert.match(statsBlock, /WHERE id = ANY\(\$1::uuid\[\]\)/, '必须按题目 ID 取行')
  assert.ok(
    !/WHERE task_id = \$1/.test(statsBlock),
    '不得按 task_id 查题（重练卷恒 0 行）'
  )
  assert.match(statsBlock, /correctCount/, '必须把 correctCount 一并写入 result（此前丢了）')
})

test('recalculate-stats 对重练答卷必须走本卷题源（否则一点完成复核计数就清零）', async () => {
  const INDEX = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8')
  const start = INDEX.indexOf("app.post('/api/tasks/:taskId/recalculate-stats'")
  assert.ok(start > -1, '找不到 recalculate-stats')
  const end = INDEX.indexOf('// Delete task', start)
  const block = INDEX.slice(start, end > -1 ? end : start + 3000)
  assert.match(block, /GENERATED_EXAMS/, '必须先读答卷任务对应的组卷')
  assert.match(block, /ANY\(\$1::uuid\[\]\)/, '重练答卷必须按 question_ids 取行')
  assert.match(block, /correctCount/, '返回体必须带 correctCount')
  assert.match(block, /WHERE task_id = \$1/, '非重练任务（普通作业）仍按 task_id 查')
})

test('P1 依赖的判等语义：等价才判对，参考不可核对必须返回 null', async () => {
  const { judgeAnswer, detectUnverifiableReference } = await import('../server/services/judgeService.js')

  // 真实库案例：带分数 5+218/999 与假分数 5213/999 等价（赵安迪 重练 q10）
  assert.equal(judgeAnswer('5 218/999', '5213/999', 'answer').isCorrect, true)
  // 真实库案例：22/7 = 3.\overline{142857}（范梓琪 重练 q17）
  assert.equal(judgeAnswer('22/7 = 3.142857', '3.\\overline{142857}', 'answer').isCorrect, true)

  // 参考不可核对（含"略/见解析/答案不唯一"）→ null，绝不能被放行成 true
  assert.equal(detectUnverifiableReference('证明略'), 'unverifiable_reference')
  assert.equal(judgeAnswer('任意', '证明略', 'answer').isCorrect, null)
  assert.equal(judgeAnswer('任意', '见解析', 'answer').isCorrect, null)

  // 学生过程式答案与参考不等价 → false（必须继续转人工，不能被自动放过）
  assert.equal(judgeAnswer('24: 1 2 3 4 6 8 12 24', '应为这些', 'answer').isCorrect, false)
  assert.equal(judgeAnswer('5218.8 = 1000X\n521.8 = 100X\n4697/9', '5213/999', 'answer').isCorrect, false)
})
