/**
 * 组卷预筛的空题闸门 + 字段来源 —— 回归锁（2026-11-22 T0-3）
 *
 * 两件事，都源于同一个真实事实：`wrong_questions.error_type` 被复用了两个语义。
 *
 *  ① 「未作答」不是错因，是**展示标签**。
 *     `server/services/neonService.js` 在写空题时同时写 is_blank=true + error_type='未作答'，
 *     为的是让移动端列表直接显示「未作答」。实测 498 条全部 is_blank=true、error_reason 为 NULL。
 *     统计侧（weeklyReport、teachingSuggestions）早已用 `is_blank IS NOT TRUE` 排除，
 *     但组卷预筛此前认的是 `error_type === scope.errorType` ⇒ 一旦有人构造
 *     `{kind:'error-cause', errorType:'未作答'}`，就会组出一整卷空题。
 *
 *  ② `questions` 表没有 error_type 列（information_schema 实测）。
 *     旧写法 `wq?.error_type || q.error_type` 是永远取不到的死兜底 —— 不会报错，
 *     但会让读代码的人以为「题目表也有错因」，进而去 questions 里找数据。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeWrongItems,
  inScope,
  pickDefaults
} from '../src/workbench/components/diagnosis/retryPaperScope.js'

const blankRow = {
  id: 'wq-blank-1',
  question_id: 'q-1',
  error_type: '未作答',
  is_blank: true,
  content: '第 3 题'
}

const realWrongRow = {
  id: 'wq-real-1',
  question_id: 'q-2',
  error_type: '计算错误',
  is_blank: false,
  content: '第 5 题'
}

test('空题行被标记 isBlank，真错行不会', () => {
  const [blank, real] = normalizeWrongItems([blankRow, realWrongRow])
  assert.equal(blank.isBlank, true)
  assert.equal(real.isBlank, false)
})

test('按错因组卷时排除空题：构造 {errorType:"未作答"} 组不出任何题', () => {
  const items = normalizeWrongItems([blankRow, realWrongRow])
  const scope = { kind: 'error-cause', errorType: '未作答' }
  assert.equal(items.filter((it) => inScope(it, scope)).length, 0, '空题不得进入按错因组的卷')
  assert.deepEqual(pickDefaults(items, scope), [], '默认勾选同样不许带上空题')
})

test('正常错因不受影响（防止闸门开太大把真错题也滤掉）', () => {
  const items = normalizeWrongItems([blankRow, realWrongRow])
  const scope = { kind: 'error-cause', errorType: '计算错误' }
  const hit = items.filter((it) => inScope(it, scope))
  assert.equal(hit.length, 1)
  assert.equal(hit[0].questionId, 'q-2')
})

test('is_blank 缺失（历史数据 NULL）按「非空题」处理，不许误伤', () => {
  const legacy = { id: 'wq-legacy', question_id: 'q-3', error_type: '审题错误', content: '第 7 题' }
  const [item] = normalizeWrongItems([legacy])
  assert.equal(item.isBlank, false, 'is_blank 为 NULL 的历史行必须仍可参与组卷')
  assert.equal(inScope(item, { kind: 'error-cause', errorType: '审题错误' }), true)
})

test('错因只认错题行本身，不吃 questions 表的同名死字段', () => {
  // questions 表没有 error_type 列；这里模拟一个「前端把 q.error_type 也塞进来」的行，
  // 断言归一化后不会采信它 —— 否则口径会随着调用方传什么而漂移。
  const rowWithQuestionCarrier = {
    id: 'wq-x',
    question_id: 'q-x',
    content: '题干',
    question: { content: '题干', error_type: '概念不理解', error_reason: '不该被读到' }
  }
  const [item] = normalizeWrongItems([rowWithQuestionCarrier])
  assert.equal(item.errorType, '', 'questions 表的 error_type 不存在，不得作为兜底来源')
})
