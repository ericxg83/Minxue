/**
 * 复核页定位框「实测」管线的退化输出闸门测试。
 *
 * 判据本体：`server/services/questionBoxMeasure.js` 的 `validateMeasureSegments`。
 *
 * 样本取自库内真实数据（2026-09-20 实测）：
 *   · 卷1 第3页（5636fc30）—— 17、18 两道解答题**左右并排**，模型正确返回
 *     两者 y_top/y_bottom 完全相同（83..206 / 86..205）。**必须放行**。
 *   · 主 OCR 的失效模式 —— 整页 8 题 y 等差恒 150、height 全同，**必须拦下**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMeasureSegments } from '../server/services/questionBoxMeasure.js'

const seg = (no, yTop, yBottom) => ({ no, y_top: yTop, y_bottom: yBottom })

test('并排题共用同一纵向带 → 放行（2026-09-20 卷1第3页真实样本）', () => {
  const segs = [
    seg(17, 86, 205), seg(18, 86, 205),
    seg(19, 205, 438), seg(20, 438, 600), seg(21, 600, 930),
  ]
  const r = validateMeasureSegments(segs, 5)
  assert.equal(r.ok, true)
  assert.equal(r.sorted.length, 5)
  // 17/18 的区间相等，是本次放宽的目的，不能被判成退化
  assert.deepEqual([r.sorted[0].y_top, r.sorted[1].y_top], [86, 86])
})

test('单栏连续分区 → 放行（2026-09-20 卷2第2页真实样本）', () => {
  const segs = [
    seg(13, 48, 125), seg(14, 125, 206), seg(15, 206, 267), seg(16, 267, 339),
    seg(17, 339, 416), seg(18, 416, 502), seg(19, 502, 563), seg(20, 563, 660),
    seg(21, 660, 714), seg(22, 714, 752), seg(23, 752, 818), seg(24, 818, 866),
    seg(25, 866, 914), seg(26, 914, 960),
  ]
  assert.equal(validateMeasureSegments(segs, 14).ok, true)
})

test('段数不符 → 拦下', () => {
  const segs = [seg(1, 100, 200), seg(2, 200, 300)]
  const r = validateMeasureSegments(segs, 3)
  assert.equal(r.ok, false)
  assert.match(r.error, /段数不符：期望 3 实得 2/)
})

test('空/非数组 → 拦下', () => {
  assert.equal(validateMeasureSegments([], 1).ok, false)
  assert.equal(validateMeasureSegments(null, 1).ok, false)
  assert.equal(validateMeasureSegments({ segments: [] }, 1).ok, false)
})

test('坐标非数值 → 拦下', () => {
  const r = validateMeasureSegments([seg(1, 'abc', 200)], 1)
  assert.equal(r.ok, false)
  assert.match(r.error, /非数值/)
})

test('纵向整体乱序 → 拦下（第 2 题排到第 1 题上面）', () => {
  const segs = [seg(1, 400, 500), seg(2, 100, 200), seg(3, 600, 700)]
  const r = validateMeasureSegments(segs, 3)
  assert.equal(r.ok, false)
  assert.match(r.error, /乱序/)
})

test('容差内的轻微逆序 → 放行（模型整数抖动）', () => {
  // 第 2 题比第 1 题高 6（< ORDER_TOLERANCE=8），不算乱序
  const segs = [seg(1, 106, 200), seg(2, 100, 160), seg(3, 300, 400)]
  assert.equal(validateMeasureSegments(segs, 3).ok, true)
})

test('所有题 y_top 完全相同 → 拦下（整页占位失效模式）', () => {
  const segs = Array.from({ length: 8 }, (_, i) => seg(i + 1, 500, 500 + (i + 1) * 20))
  const r = validateMeasureSegments(segs, 8)
  assert.equal(r.ok, false)
  assert.match(r.error, /共用同一纵向带/)
})

test('已知边界：「等差均分」型占位本闸门【拦不住】，是有意为之', () => {
  // 主 OCR 的典型占位产物：8 题 y 等差恒 150、height 全同（2026-09-20 A/B 实测值）。
  // 本闸门**放行**它，因为「数值完全均匀」在两种情形下无法区分：
  //   ① 模型偷懒按题数均分（坏）；② 卷面本身每行一题、行距均匀，正确测量结果就是均匀的（好）。
  // 若强行拦下，会误伤 ② 那类密集单行卷面 → 整页一个框都不出。
  // 所以防御手段是 prompt 本身（短调用会真的去量，见 _probe_measure_v2.mjs），不是这条闸门。
  // 若将来要补，只能引入与数值无关的信号（例如回读页图墨迹核对），不要在这里加阈值。
  const segs = Array.from({ length: 8 }, (_, i) => seg(i + 1, 126 + i * 150, 126 + i * 150 + 150))
  assert.equal(validateMeasureSegments(segs, 8).ok, true)
})

test('题数 < 3 时不套用「共用同一带」闸门（单/双题页无统计意义）', () => {
  const segs = [seg(1, 0, 1000)]
  assert.equal(validateMeasureSegments(segs, 1).ok, true)
  const two = [seg(1, 0, 500), seg(2, 0, 500)]
  assert.equal(validateMeasureSegments(two, 2).ok, true)
})

test('按 no 排序后再判乱序（模型可能乱序返回数组）', () => {
  const segs = [seg(3, 600, 700), seg(1, 100, 200), seg(2, 300, 400)]
  const r = validateMeasureSegments(segs, 3)
  assert.equal(r.ok, true)
  assert.deepEqual(r.sorted.map(s => s.no), [1, 2, 3])
})

// ── [2026-09-20 泛化] 新增闸门：题号连续性 + 逆序容差放宽 ──

test('题号不连续（缺 no:2、两个 no:13）→ 拦下（2026-09-20 590fc5b6 第1页真实样本）', () => {
  // 14 题页模型返回缺 no:2、两个 no:13 —— 段数恰好凑成 14 骗过了旧闸门，
  // 但 sorted[i] 与题目清单无法对齐。必须整页作废。
  const segs = [
    seg(1, 203, 275), seg(3, 275, 346), seg(4, 346, 438), seg(5, 438, 549),
    seg(6, 549, 585), seg(7, 585, 621), seg(8, 621, 668), seg(9, 668, 704),
    seg(10, 704, 740), seg(11, 740, 776), seg(14, 812, 848), seg(12, 848, 884),
    seg(13, 884, 920), seg(13, 776, 812),
  ]
  const r = validateMeasureSegments(segs, 14)
  assert.equal(r.ok, false)
  assert.match(r.error, /题号不连续/)
})

test('题号从 0 开始（兼容整体偏移）→ 放行', () => {
  const segs = [seg(0, 100, 200), seg(1, 200, 300), seg(2, 300, 400)]
  assert.equal(validateMeasureSegments(segs, 3).ok, true)
})

test('相邻小题互换（逆序 29 < 容差 40）→ 放行（2026-09-20 007113e4 第4页真实样本）', () => {
  // q23 被拆成两条记录，模型把两条标反：no:3 给了下面那段(468..507)、no:4 给了上面那段(439..468)。
  // 逆序量 29 < 40 → 放行。两条框仍然各自盖住 23 题的小问区域，没画到别的题。
  const segs = [seg(1, 143, 205), seg(2, 143, 205), seg(3, 468, 507), seg(4, 439, 468), seg(5, 712, 742), seg(6, 742, 770)]
  assert.equal(validateMeasureSegments(segs, 6).ok, true)
})

test('模型整体错乱（逆序 108 > 容差 40）→ 拦下（2026-09-20 590fc5b6 第1页残留形态）', () => {
  // 即使题号连续，但第 13 题的 y_top=884 在第 12 题的 776 之下（差 108）→ 整体错乱，必须拦。
  const segs = [
    seg(1, 203, 275), seg(2, 275, 346), seg(3, 346, 438), seg(4, 438, 549),
    seg(5, 549, 585), seg(6, 585, 621), seg(7, 621, 668), seg(8, 668, 704),
    seg(9, 704, 740), seg(10, 740, 776), seg(11, 776, 812), seg(12, 884, 920),
    seg(13, 776, 812), seg(14, 812, 848),
  ]
  const r = validateMeasureSegments(segs, 14)
  assert.equal(r.ok, false)
  assert.match(r.error, /乱序/)
})
