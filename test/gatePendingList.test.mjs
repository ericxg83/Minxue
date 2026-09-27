/**
 * 回归测试：错题「待补入」清单判据（2026-09-27 欠账显性化）
 *
 * 背景：P2 门禁分层（2026-09-23）把系统侧缺项（缺图/缺选项/缺答案/题型未定）的
 * 错题自动记 wrong_no_book 放行、不拦卷，闭环依赖「补全即补入」。但欠账只有一条
 * 瞬时 toast，错过即无人知晓 ⇒ 错题事实上沉底（负责人 2026-09-27 实锤：
 * 「已确认 30/30 但很多题缺图，不知道哪些题要补」）。
 * 现在卷内常驻标识 + 全局待补清单都以 isGateAutoSkippedRow 为唯一谓词。
 *
 * 锁定的红线（与 wrongGateTier.test.mjs 同一族）：
 *   ① 老师手动点的「本次不加入」（无 gateAuto 标记）绝不出现在待补清单 ——
 *      自动拉回老师的明确否决是红线；
 *   ② 已入册的题不挂账（入册后清单必须当场消失）；
 *   ③ skipReason 与 gateAuto 必须同时成立（只认其一会把手动否决当系统放行）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { isGateAutoSkippedRow, REVIEW_STATUS_WRONG_NO_BOOK } =
  await import('../server/utils/wrongGateRequeue.js')
const { WRONG_GATE_AUTO_SKIP_REASON } = await import('../src/domain/wrongGateTier.js')

const row = (extra = {}) => ({
  review_status: REVIEW_STATUS_WRONG_NO_BOOK,
  in_wrong_book: false,
  _gate_skip_reason: WRONG_GATE_AUTO_SKIP_REASON,
  _gate_auto: 'true',
  ...extra,
})

test('★ 系统自动放行且未入册 → 进待补清单', () => {
  assert.equal(isGateAutoSkippedRow(row()), true)
})

test('★ 红线：老师手动「本次不加入」（无 gateAuto）永不进待补清单', () => {
  assert.equal(isGateAutoSkippedRow(row({ _gate_auto: undefined })), false)
  assert.equal(isGateAutoSkippedRow(row({ _gate_auto: null })), false)
  assert.equal(isGateAutoSkippedRow(row({ _gate_auto: 'false' })), false)
})

test('★ 红线：只有 gateAuto 没有 skipReason 也不算（两判据缺一不可）', () => {
  assert.equal(isGateAutoSkippedRow(row({ _gate_skip_reason: null })), false)
  assert.equal(isGateAutoSkippedRow(row({ _gate_skip_reason: 'other_reason' })), false)
})

test('已入册的题不挂账（补入成功后必须从清单消失）', () => {
  assert.equal(isGateAutoSkippedRow(row({ in_wrong_book: true })), false)
})

test('非 wrong_no_book 状态不进清单', () => {
  for (const st of [null, undefined, '', 'wrong', 'correct', 'exclude']) {
    assert.equal(isGateAutoSkippedRow(row({ review_status: st })), false,
      `review_status=${JSON.stringify(st)} 不应出现在待补清单`)
  }
})

test('空行/缺字段不炸（SQL LATERAL 无 judgement 时全为 null）', () => {
  assert.equal(isGateAutoSkippedRow(null), false)
  assert.equal(isGateAutoSkippedRow({}), false)
})
