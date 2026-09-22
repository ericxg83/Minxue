// 回归测试：结算收尾批量回写 questions.is_correct 的 SQL 类型口径
//
// 事故背景（2026-09-14 错题再测-0911）：
//   `SET is_correct = CASE id WHEN $1::uuid THEN $2 ... END` 中 THEN 分支的参数
//   没有任何类型上下文，PostgreSQL 把它推断成 text，整条语句抛
//     `42804 column "is_correct" is of type boolean but expression is of type text`
//   该语句位于「错题生命周期已推进」与「exam.status 写 graded」之间，异常又被
//   前端 .catch(console.error) 吞掉，于是表现为：
//     老师点「完成复核」→ 提示「试卷复核完成，已保存」→
//     左侧列表仍「待复核」、移动端仍「待完成」、库里 exam.status 永远 ungraded。
//
// 本测试锁定：THEN 分支必须显式 ::boolean；且两处结算函数必须复用同一构造器，
// 不许各自另写一份 CASE（历史上正是分散写法导致同类问题反复出现）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildIsCorrectAssignments } from '../server/services/gradingFinalizer.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const FINALIZER = 'server/services/gradingFinalizer.js'

test('THEN 分支必须显式 ::boolean，WHEN 分支必须是 ::uuid', () => {
  const sql = buildIsCorrectAssignments(['a', 'b'])
  assert.equal(
    sql,
    'WHEN $1::uuid THEN $2::boolean WHEN $3::uuid THEN $4::boolean',
    '占位符编号与类型转换必须严格对位，缺 ::boolean 会让 PG 推断成 text 并抛 42804'
  )
})

test('占位符从 $1 起连续编号，与 flatMap 参数顺序一致', () => {
  const ids = Array.from({ length: 17 }, (_, i) => `id${i}`)
  const sql = buildIsCorrectAssignments(ids)
  const max = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])))
  assert.equal(max, ids.length * 2, '占位符总数必须是 id 数量的 2 倍（id + 布尔值）')
  assert.equal(sql.split('::boolean').length - 1, ids.length, '每个 id 恰好一个 ::boolean')
  assert.equal(sql.split('::uuid').length - 1, ids.length, '每个 id 恰好一个 ::uuid')
})

test('空数组返回空片段（调用方另有 length>0 守卫）', () => {
  assert.equal(buildIsCorrectAssignments([]), '')
})

test('两处结算都必须复用 buildIsCorrectAssignments，不得内联裸 CASE', () => {
  const src = read(FINALIZER)
  const bareThenClauses = src.match(/THEN \$\{[^}]*\}(?!::boolean)/g) || []
  assert.deepEqual(
    bareThenClauses,
    [],
    `发现未加 ::boolean 的 THEN 占位符：${bareThenClauses.join(', ')}`
  )
  const usages = src.match(/CASE id \$\{buildIsCorrectAssignments\(/g) || []
  assert.equal(usages.length, 2, 'finalizeGradingBatch 与 finalizeGeneratedExamResults 各一处')
})

// ── 改判置信度（2026-09-23 P1）────────────────────────────────
// 事故背景：练习册 → 日常 AI 重批（_regrade_workbook_to_ai_0922）把判分改对了，
//   但 finalizeRejudgeResult 只 SET is_correct，不碰 confidence；questions.confidence
//   残留练习册管线写的 0。前端口径「is_correct=true 且 confidence<0.5 → 待复核」
//   （src/utils/reviewDecision.js）于是把「学生答案与参考答案完全一致」的题
//   也打回人工：B=B、一定=一定、AD·BC=AD·BC 都要老师再点一遍确认。
// 锁定：①改判 SQL 必须带置信度分支且显式 ::numeric（缺类型注解同样会被 PG 推断成 text）；
//   ②只抬不降（GREATEST），避免抹掉更高的历史置信度；
//   ③缺省不写（保持旧行为），老师手工改判不能顺带把结论拔成 AI 高置信度；
//   ④isCorrect 为 null（判不出）不抬，让题继续留在待办。
test('改判结算必须同步回写 confidence，且置信度参数显式 ::numeric', () => {
  const src = read(FINALIZER)
  const fnStart = src.indexOf('export const finalizeRejudgeResult')
  assert.ok(fnStart > 0, '未找到 finalizeRejudgeResult')
  const fnBody = src.slice(fnStart, src.indexOf('\n}\n', fnStart))
  assert.ok(
    /confidence = CASE/.test(fnBody),
    '改判必须同步写 confidence：只写 is_correct 会让重批判对的题带着旧管线的 0 继续显示「待复核」'
  )
  assert.ok(
    /\$2::numeric/.test(fnBody),
    '置信度参数必须显式 ::numeric，否则 PG 会把参数推断成 text 抛 42804'
  )
})

test('置信度只抬不降（GREATEST），且判不出（isCorrect=null）时不抬', () => {
  const src = read(FINALIZER)
  const fnStart = src.indexOf('export const finalizeRejudgeResult')
  const fnBody = src.slice(fnStart, src.indexOf('\n}\n', fnStart))
  assert.ok(
    /GREATEST\(COALESCE\(confidence, 0\)/.test(fnBody),
    '必须用 GREATEST(COALESCE(confidence,0), …)：既抬得起旧管线的 0，又不抹掉更高的历史置信度'
  )
  assert.ok(
    /WHEN \$1 IS NULL THEN confidence/.test(fnBody),
    'is_correct 为 null（判不出）时不得抬置信度，否则题会被误移出老师待办'
  )
})

test('缺省不传 confidence 时不写置信度（老师手工改判行为不变）', () => {
  const src = read(FINALIZER)
  const fnStart = src.indexOf('export const finalizeRejudgeResult')
  const sig = src.slice(fnStart, fnStart + 400)
  assert.ok(
    /confidence = null/.test(sig),
    'confidence 必须是默认为 null 的可选参数：历史调用方（pc_rejudge / review_edit）不传则行为不变'
  )
})

test('导出 REJUDGE_CONFIDENCE=0.9，与 worker「AI 敢下结论」同口径', async () => {
  const mod = await import('../server/services/gradingFinalizer.js')
  assert.equal(mod.REJUDGE_CONFIDENCE, 0.9, '重批确证判定的置信度必须高于前端复核阈值 0.5')
})

test('「exam.status=graded」必须在所有题目回写之后，保证结算标记是最后一步', () => {
  const src = read(FINALIZER)
  const fnStart = src.indexOf('export const finalizeGeneratedExamResults')
  assert.ok(fnStart > 0, '未找到 finalizeGeneratedExamResults')
  const fnBody = src.slice(fnStart)
  const questionWrite = fnBody.indexOf('buildIsCorrectAssignments(updateQuestionIds)')
  const examWrite = fnBody.indexOf("SET status = 'graded'")
  assert.ok(questionWrite > 0, '未找到题目回写语句')
  assert.ok(examWrite > 0, '未找到 exam 状态落库语句')
  assert.ok(
    questionWrite < examWrite,
    '题目回写必须先于 exam 状态落库：否则 exam 会被标已结算，而题目正误还停在旧值'
  )
})
