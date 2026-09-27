/**
 * 数轴目测出口安全闸回归测试（2026-09-27）
 *
 * 锁定纪律：只有模型明确 VERDICT: FIX 才回退；判读不出/拼图失败/调用异常一律
 * fail-open 放行（绝不因基础设施抖动误伤正确数轴）。只收紧不放宽。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAxisVerdict, verifyNumberAxisByVision } from '../server/utils/numberAxis/verifyAxis.js'

// ───────────────────── parseAxisVerdict：纯判读 ─────────────────────
test('parseAxisVerdict：明确 FIX 才拦，OK/无法判读一律放行', () => {
  assert.deepEqual(parseAxisVerdict('VERDICT: FIX'), { ok: false, reason: 'fix' })
  assert.equal(parseAxisVerdict('verdict：fix').ok, false, '全角冒号/小写也要识别')
  assert.equal(parseAxisVerdict('VERDICT: OK').ok, true)
  assert.equal(parseAxisVerdict('结论：VERDICT: OK，字母齐全').ok, true)
  // 判读不出结论 → fail-open（不误伤）
  assert.equal(parseAxisVerdict('我觉得这张图还行').ok, true)
  assert.equal(parseAxisVerdict('').ok, true)
  assert.equal(parseAxisVerdict(null).ok, true)
})

// ───────────────── verifyNumberAxisByVision：注入接缝，不触真实渲染/网络 ─────────────────
const fakeCompose = async () => 'data:image/png;base64,AAAA'

test('闭环：模型判 FIX → 回退（缺字母/缺刻度的半张数轴不得入库）', async () => {
  const v = await verifyNumberAxisByVision({
    originalImageDataUrl: 'data:image/png;base64,BBBB',
    renderSvg: '<svg/>',
    content: '实数a、b在数轴上所对应的点如图所示',
    callVision: async () => 'VERDICT: FIX',
    compose: fakeCompose,
  })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'fix')
})

test('闭环：模型判 OK → 放行（正确数轴不误伤）', async () => {
  const v = await verifyNumberAxisByVision({
    originalImageDataUrl: 'data:image/png;base64,BBBB',
    renderSvg: '<svg/>',
    content: '数轴上A、B两点',
    callVision: async () => 'VERDICT: OK',
    compose: fakeCompose,
  })
  assert.equal(v.ok, true)
})

test('闭环：拼图失败（基础设施抖动）→ fail-open 放行', async () => {
  const v = await verifyNumberAxisByVision({
    originalImageDataUrl: 'data:image/png;base64,BBBB',
    renderSvg: '<svg/>',
    content: 'x',
    callVision: async () => 'VERDICT: FIX', // 即使会说 FIX，拼不出图也不该调用、更不该拦
    compose: async () => null,
  })
  assert.equal(v.ok, true)
  assert.equal(v.reason, 'compose_failed')
})

test('闭环：视觉调用抛异常 → fail-open 放行', async () => {
  const v = await verifyNumberAxisByVision({
    originalImageDataUrl: 'data:image/png;base64,BBBB',
    renderSvg: '<svg/>',
    content: 'x',
    callVision: async () => { throw new Error('429 rate limited') },
    compose: fakeCompose,
  })
  assert.equal(v.ok, true)
  assert.match(v.reason, /error:/)
})
