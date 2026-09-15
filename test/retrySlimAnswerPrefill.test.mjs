// 回归测试：重练卷（slim 管线）预填 is_correct 的写入语义
//
// 事故背景（2026-09-14 错题再测-0911，学生 赵安迪，12 题）：
//   老师看到 9 条「AI错误」，其中 4 条是解答题——slim 管线**本次根本没判**它们
//   （主观题走 manual 分支，isCorrect=null），但落库 SQL 写的是
//     `is_correct = COALESCE($2, is_correct)`
//   COALESCE 把**原作业的旧判定（false）**留了下来，而 batch 页的 6 态
//   （src/utils/reviewDecision.js）见 is_correct===false 就显示「AI错误」。
//   更刺眼的是这批行的 student_answer 已被本次答卷覆盖 ⇒
//   页面上是「新学生答案 + 旧判定」错配，学生答对了也显示 AI错误。
//
// 口径：questions 行表示「最新一次批改」。本次没结论就写 null（页面落
// exception/AI未判定），绝不继承上一次的结论；confidence 仍 COALESCE（只是线索，
// 缺失时保留旧值让 6 态落在「AI未判定」而不是「处理中」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const WORKER = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')

// 只取 processSlimGrading 函数体，避免误伤主 OCR 管线的其它写法
const slimBody = (() => {
  const start = WORKER.indexOf('export const processSlimGrading')
  assert.ok(start > -1, '找不到 processSlimGrading')
  const next = WORKER.indexOf('\nexport const ', start + 10)
  return WORKER.slice(start, next > -1 ? next : undefined)
})()

// 判据只认代码：注释里会引用旧写法（`is_correct = COALESCE($2, is_correct)`）做事故说明
const slimCode = slimBody
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n')

test('slim 预填 is_correct 不得使用 COALESCE 保留旧判定', () => {
  const bad = slimCode.match(/is_correct = COALESCE\([^)]*\)/g) || []
  assert.deepEqual(
    bad,
    [],
    `发现 COALESCE 兜底（会把原作业旧判定带进重练卷）：${bad.join(', ')}`
  )
})

test('slim 预填必须显式写入本次结果（含 null），且带 ::boolean 类型转换', () => {
  // [2026-09-15 修正] SET 里后来插入了 answer_source 行，正则同步放宽；
  // 锁的意图不变：is_correct 必须带 $2::boolean ——
  // 缺类型转换会让 PG 把参数推断成 text（历史 42804）
  assert.match(
    slimCode,
    /SET student_answer = \$1,\s*\n(?:\s*answer_source = \$\d+,\s*\n)?\s*is_correct = \$2::boolean,/,
    'is_correct 必须显式写 $2::boolean —— 缺类型转换会让 PG 把参数推断成 text（历史 42804）'
  )
  assert.match(
    slimCode,
    /confidence = COALESCE\(\$3, confidence\)/,
    'confidence 保持 COALESCE：它只是 OCR 置信度线索，缺失时保留旧值让 6 态落「AI未判定」'
  )
})

test('预填失败不得静默：必须记录并显式报错', () => {
  assert.ok(slimCode.includes('prefillFailures'), '必须收集失败条目')
  assert.match(slimCode, /批改页状态不可信/, '必须显式提示批改页状态不可信')
})

// 6 态口径的守卫：未判定必须是 exception（有置信度）/ processing（无置信度），
// 不能落成 wrong。这条锁住「null 不被当成 false」。
test('reviewDecision：is_correct=null 不得被判成 wrong', async () => {
  const { getReviewState } = await import('../src/utils/reviewDecision.js')
  assert.equal(getReviewState({ is_correct: null, confidence: 0.95 }), 'exception')
  assert.equal(getReviewState({ is_correct: null, confidence: null }), 'processing')
  assert.equal(getReviewState({ is_correct: false, confidence: 0.95 }), 'wrong')
})
