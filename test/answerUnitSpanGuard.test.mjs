// 回归测试：单元题号上界闸（2026-10-10「第十八章 实数」假红叉事故）
//
// 事故背景（任务 a7c984ac「第 20 章 二次根式 · 数学」）：
//   卷面第 1 页 13 道题（题号 7~19），标题被 OCR 读成「第十八章 实数」
//   （实际内容全是二次根式，属第 20 章）。答案册 abf39957「八上数学_上海作业」
//   有 52 个单元，同一题号横跨几十个单元 —— 覆盖率判据在题 7~19 上有 15 个
//   单元都能"命中 7~9 题"，无法区分。
//   结果第 1 页被锚到 `20.2(4)`（二次根式的运算(4)），而该单元答案池题号
//   **只到 15**：
//     · 题 16/17/19 查不到键 → 走「答案库无匹配」→ 报「缺少参考答案，无法自动判定」
//       （老师看到的就是"这份试卷有多处没有参考答案"）；
//     · 题 7/11/12/13 查到了键，但那是**另一套卷**的答案：
//         卷面题11「化简 √(12y²/x⁴)」→ 池给 `x=√3/15`，真答案 `2√3y/x²`
//         卷面题12「化简 √(36a²b)」→ 池给 `x>5+√10`，真答案 `-6a√b`
//         卷面题13「计算 (√3-1)/(√3+1)」→ 池给 `-√15/15`，真答案 `2-√3`
//       ⇒ 3 道学生**答对了**的题被判错（假红叉），且 UI 上参考答案有内容、
//         置信度 0.95，老师完全看不出异常。
//   同任务第 2 页（题 20~24）却正确锚到了「第20章测试(一)」—— 两页本属同一单元。
//
// 修复：题号上界越界的单元不是本页的单元。凡是按"覆盖率/答案指纹"竞选单元的
//   通道，一律先过 unitQuestionSpan 的上界检查。
//
// 本测试锁定：
//   ① 上界越界的单元必须被排除，即便它的答案指纹命中数最高；
//   ② 上界够用的单元必须能被正常选中（不许把闸写成"全部拒绝"）；
//   ③ 越界排除不得误伤"题号范围本来就小于本页"的合法场景 ——
//     单元池上界 ≥ 本页最大题号时才需要排除，单元池上界恰好等于本页最大题号必须放行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { searchUnitByStudentAnswers } from '../server/worker.js'

/** 构造 answersByUnit：unitKey → section(Map) → qKey → row */
const buildAnswersByUnit = (spec) => {
  const map = new Map()
  for (const [unitKey, rows] of Object.entries(spec)) {
    const sec = new Map()
    const qMap = new Map()
    for (const [qKey, answer] of Object.entries(rows)) qMap.set(qKey, { answer })
    sec.set('(null)', qMap)
    map.set(unitKey, sec)
  }
  return map
}

/** 事故现场真实数据：第 1 页题 7~19 */
const PAGE_QUESTIONS = [
  { question_number: 7, question_type: 'fill', student_answer: '-3' },
  { question_number: 11, question_type: 'answer', student_answer: '2y√3/x²' },
  { question_number: 12, question_type: 'answer', student_answer: '-6a√b' },
  { question_number: 13, question_type: 'answer', student_answer: '2-√3' },
  { question_number: 19, question_type: 'answer', student_answer: '√5m/5+√5m-5√5m' },
]

test('题号上界越界的单元不得被选为本页单元（事故核心回归）', () => {
  // `20.2(4)`：题号只到 15，但答案内容恰好与学生答案高度相似
  //（模拟"命中数最高但装不下整页"的假象）
  const answersByUnit = buildAnswersByUnit({
    '20.2(4)': {
      '7|': '-3',
      '11|': '2y√3/x²',
      '12|': '-6a√b',
      '13|': '2-√3',
      '15|': '①2 x=-5',
    },
    // 正确答案所在单元：题号 1~26，装得下题 19
    '第20章测试(一)': {
      '7|': '③④',
      '11|': '2√3y/x²',
      '12|': '-6a√b',
      '13|': '2-√3',
      '19|': '-(19/5)√(5m)',
    },
  })

  const hit = searchUnitByStudentAnswers(PAGE_QUESTIONS, answersByUnit, null)
  assert.equal(hit?.unitKey, '第20章测试(一)',
    '题 7~19 的页绝不能被题号只到 15 的 20.2(4) 抢走 —— 那会让 3 道答对的题被判错')
})

test('上界恰好等于本页最大题号时必须放行（不许把闸写成"全部拒绝"）', () => {
  const answersByUnit = buildAnswersByUnit({
    '刚好到19': {
      '7|': '2y√3/x²', '11|': '2y√3/x²', '12|': '-6a√b', '13|': '2-√3', '19|': '-(19/5)√(5m)',
    },
    '只到18': {
      '7|': '2y√3/x²', '11|': '2y√3/x²', '12|': '-6a√b', '13|': '2-√3', '18|': '-(19/5)√(5m)',
    },
  })
  const hit = searchUnitByStudentAnswers(PAGE_QUESTIONS, answersByUnit, null)
  assert.equal(hit?.unitKey, '刚好到19',
    '上界 == 本页最大题号(19) 是合法的；上界 18 < 19 才越界')
})

test('候选白名单与上界闸同时生效', () => {
  const answersByUnit = buildAnswersByUnit({
    '越界但命中高': { '7|': '2y√3/x²', '11|': '2y√3/x²', '12|': '-6a√b', '13|': '2-√3', '15|': '2y√3/x²' },
    '合法但在白名单外': { '7|': '2y√3/x²', '19|': '2y√3/x²' },
    '合法且在白名单内': { '7|': '2y√3/x²', '11|': '2y√3/x²', '12|': '-6a√b', '13|': '2-√3', '19|': '2y√3/x²' },
  })
  const hit = searchUnitByStudentAnswers(
    PAGE_QUESTIONS, answersByUnit, ['越界但命中高', '合法但在白名单外', '合法且在白名单内'])
  assert.equal(hit?.unitKey, '合法且在白名单内')
})

test('全部候选都越界时返回 null（交回待审，绝不静默错挂）', () => {
  const answersByUnit = buildAnswersByUnit({
    '只到15': { '7|': '2y√3/x²', '11|': '2y√3/x²', '12|': '-6a√b', '13|': '2-√3', '15|': '2y√3/x²' },
    '只到18': { '7|': '2y√3/x²', '11|': '2y√3/x²', '12|': '-6a√b', '13|': '2-√3', '18|': '2y√3/x²' },
  })
  const hit = searchUnitByStudentAnswers(PAGE_QUESTIONS, answersByUnit, null)
  assert.equal(hit, null,
    '所有单元都装不下本页时应交回"待人工"通道，而不是硬挑一个最像的')
})
