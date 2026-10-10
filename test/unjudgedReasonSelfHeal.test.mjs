/**
 * 「AI未判定」红条自愈回归（2026-10-10）
 *
 * 背景：`answer_exception_reason` 是**一次性写入的历史快照**，而配图会事后补齐
 * （services/figureRelocateSweep.js 只填空geometry_image_url，不覆盖已有值）。
 * 于是补图后「题干要求配图但本题未采集到配图」仍在展示层原样弹出，
 * 与「图明明就在页面上」自相矛盾（实测全库 11 条该文案有 10 条其实已有图）。
 *
 * 本测试锁定 getUnjudgedReasonText 的三条自愈方向：
 *   ① 缺图文案 + 图已存在 → 改成可行动提示，**不再说"未采集到"**
 *   ② 已下人工结论 + 有答案 → 不显示红条（没有待办事项）
 *   ③ 其他异常文案（主观题/见解析等）→ **原文透传，一字不改**
 *
 * ⛔ 方向③是本测试最关键的负向断言：自愈绝不能顺手改写正当的异常说明，
 *    否则会把 101 道「主观题需人工判定」的正常标注误清。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { getUnjudgedReasonText, REVIEW_STATUS } from '../src/utils/reviewDecision.js'

const MISSING_FIG_REASON = '题干要求配图但本题未采集到配图，已跳过 AI 解析（补图后可重算）'

// exception 态的最小构造：有置信度（判过）但 is_correct 为 null
const excQ = (extra = {}) => ({
  answer_source: 'recognized',
  student_answer: '√2/2',
  is_correct: null,
  confidence: 0.8,
  ...extra
})

test('① 缺图红条 + 配图已补上 → 不再说「未采集到」，改为可行动提示', () => {
  const q = excQ({
    answer_exception_reason: MISSING_FIG_REASON,
    geometry_image_url: 'https://oss/fig.png'
  })
  const text = getUnjudgedReasonText(q)
  assert.ok(text, '仍应显示提示（老师还有重算这件事要做）')
  assert.ok(!text.includes('未采集到配图'), `不得沿用已失真的原文，实际：${text}`)
  assert.ok(text.includes('重解析'), `应给出可执行动作，实际：${text}`)
})

test('①-2 配图确实还没有 → 保留原文（闸门语义正确，不该改）', () => {
  const q = excQ({ answer_exception_reason: MISSING_FIG_REASON, geometry_image_url: null })
  assert.equal(getUnjudgedReasonText(q), MISSING_FIG_REASON)
})

test('①-3 配图是空白字符串 → 视同无图，保留原文', () => {
  const q = excQ({ answer_exception_reason: MISSING_FIG_REASON, geometry_image_url: '   ' })
  assert.equal(getUnjudgedReasonText(q), MISSING_FIG_REASON)
})

test('② 人工已下结论且答案已存在 → 不显示红条（无待办事项）', () => {
  const q = excQ({
    answer_exception_reason: MISSING_FIG_REASON,
    geometry_image_url: 'https://oss/fig.png',
    answer: '√2/2',
    review_status: REVIEW_STATUS.CORRECT
  })
  assert.equal(getUnjudgedReasonText(q), '')
})

test('③ 其他异常文案一律原文透传（自愈不得越界改写正当标注）', () => {
  const cases = [
    '主观题需人工判定',
    '参考答案无法自动核对（含略/见解析/答案不唯一）',
    '缺少参考答案，无法自动判定',
    'AI标记需要人工补充'
  ]
  for (const reason of cases) {
    const q = excQ({ answer_exception_reason: reason, answer: '某答案' })
    assert.equal(getUnjudgedReasonText(q), reason, `原文必须透传：${reason}`)
  }
})

test('③-2 主观题即便有答案，未下结论时仍要显示（老师还得处理）', () => {
  const reason = '主观题需人工判定'
  const q = excQ({ answer_exception_reason: reason, answer: '某答案', review_status: null })
  assert.equal(getUnjudgedReasonText(q), reason)
})

test('未作答（answer_source=blank）不显示原因', () => {
  const q = excQ({
    answer_source: 'blank',
    answer_exception_reason: MISSING_FIG_REASON,
    geometry_image_url: 'https://oss/fig.png'
  })
  assert.equal(getUnjudgedReasonText(q), '')
})

test('非 exception 态不显示原因', () => {
  const q = excQ({
    is_correct: true,
    confidence: 0.95,
    answer_exception_reason: MISSING_FIG_REASON
  })
  assert.equal(getUnjudgedReasonText(q), '')
})

test('无 reason 时返回空串', () => {
  assert.equal(getUnjudgedReasonText(excQ()), '')
  assert.equal(getUnjudgedReasonText(excQ({ answer_exception_reason: '   ' })), '')
})
