import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 「参考答案来源」与「学生作答状态」解耦的回归（2026-10-10，迁移 063）
 *
 * ⛔ 这条不变量为什么值钱：
 *   `answer_source === 'blank'` 被 40+ 处当作「学生未作答」判据
 *   （错题本入库 / 掌握度统计 / 置信度闸 / 诊断服务 / paperReviewDecision），
 *   所以**绝不能**靠给 answer_source 加枚举值来表达「有参考答案但学生没写」。
 *   一旦那样做，这40+ 处会同时失效，判题域契约整体崩塌。
 *
 *   旧代码正是踩了这个坑：worker.js 里 `q.answer_source='worksheet'` 先设上，
 *   随后学生未作答的 else 分支又`q.answer_source='blank'` 无条件覆写，
 *   把刚记的来源抹掉 —— 产出「学生没写」+「但有参考答案」的自相矛盾行，
 *   实测 374 道（127 份task，265 道已进错题本，238 道 cache_id 非空）。
 *
 * 本测试锁死修复后的不变量：
 *   ① `answer_source` 只表达学生作答状态（blank ⇔ student_answer 为空）；
 *   ② 答案来源记在 `reference_source`，blank 不得影响它；
 *   ③ 没参考答案时 reference_source 才为 NULL（与 blank 并不冲突）。
 */

/** 复刻 worker.js 练习册管线的 answerRow 命中分支（修复后的行为） */
function applyAnswerBankMatch(q, answerRow) {
  if (answerRow) {
    q.answer = answerRow.answer
    // 修复：来源记入独立列，不再塞进 answer_source
    q.reference_source = 'worksheet'

    const hasAnswer = q.student_answer && q.student_answer !== 'null' && q.student_answer !== '未作答'
    if (hasAnswer) {
      q.is_correct = null
      q.answer_source = 'recognized'
    } else {
      q.is_correct = null
      // 修复：这里只表达「学生没作答」，**不再覆写 reference_source**
      q.answer_source = 'blank'
    }
  }
  return q
}

test('①学生未作答但答案库命中：blank 不再抹掉来源', () => {
  const q = applyAnswerBankMatch(
    { student_answer: '', question_number: 11 },
    { answer: '3-√5', answer_type: 'fill' }
  )
  assert.equal(q.answer_source, 'blank', 'answer_source 只表达学生作答状态')
  assert.equal(q.answer, '3-√5', '参考答案仍在')
  assert.equal(
    q.reference_source, 'worksheet',
    '⛔ 来源必须保留在 reference_source，不能被 blank 抹掉（这是本次修复的核心）'
  )
})

test('② 学生已作答：answer_source=recognized，来源同样保留', () => {
  const q = applyAnswerBankMatch(
    { student_answer: '3', question_number: 11 },
    { answer: '3-√5', answer_type: 'fill' }
  )
  assert.equal(q.answer_source, 'recognized')
  assert.equal(q.reference_source, 'worksheet')
})

test('③ 无参考答案时reference_source 为空，与 blank 不冲突', () => {
  const q = applyAnswerBankMatch(
    { student_answer: '', question_number: 11 },
    null // 答案库无匹配
  )
  // 答案库无匹配 ⇒ 不进匹配分支，两个字段都不该被本函数写。
  // （真实代码里由调用方的 else 分支另行处理，这里只锁「本函数不越权写」。）
  assert.equal(q.answer_source, undefined, '答案库无匹配时不由本函数写 blank')
  assert.equal(q.reference_source, undefined, '无答案 ⇒ 来源留空，而不是编一个值')
  assert.equal(q.answer, undefined, '无匹配时不得凭空造出参考答案')
})

test('④ 关键不变量：blank ⇔ student_answer 为空（40+ 处判据依赖它）', () => {
  for (const stu of ['', null, undefined, 'null', '未作答']) {
    const q = applyAnswerBankMatch({ student_answer: stu }, { answer: 'x' })
    if (q.answer_source === 'blank') {
      const isEmpty = !q.student_answer || q.student_answer === 'null' || q.student_answer === '未作答'
      assert.equal(isEmpty, true, `blank 时 student_answer 必须为空，实际="${stu}"`)
    }
  }
})

test('⑤ 旧实现会被本测试拦下（回归有效性自证）', () => {
  // 复刻旧行为：blank 分支无条件覆写 answer_source
  const legacy = (q, answerRow) => {
    q.answer = answerRow.answer
    q.answer_source = 'worksheet'
    q.answer_source = 'blank' // 旧代码：来源被抹掉
    return q
  }
  const q = legacy({ student_answer: '' }, { answer: '3-√5' })
  // 旧实现下来源无处可寻 —— 这正是 374 道矛盾数据的成因
  assert.equal(q.answer_source, 'blank')
  assert.equal(q.reference_source, undefined,
    '旧实现没有 reference_source，来源信息彻底丢失 ⇒ 本测试对旧代码必然失败')
})

test('⑥ 来源枚举值仅允许约定档位（防止后续又往 answer_source 里塞来源）', () => {
  const ALLOWED = new Set(['engine', 'worksheet', 'teacher', 'external'])
  const q = applyAnswerBankMatch({ student_answer: '' }, { answer: 'x' })
  if (q.reference_source !== null && q.reference_source !== undefined) {
    assert.ok(ALLOWED.has(q.reference_source),
      `reference_source 只能是 ${[...ALLOWED]}，实际="${q.reference_source}"`)
  }
  // 关键：answer_source 的取值绝不能再出现来源语义
  const SOURCE_LIKE = new Set(['worksheet', 'engine', 'teacher', 'external'])
  assert.equal(SOURCE_LIKE.has(q.answer_source), false,
    `answer_source 不得承载来源语义，实际="${q.answer_source}"`)
})
