/**
 * 回归测试：配图补裁 N4 候选谓词（B1，2026-09-27）
 *
 * 锁定红线：
 *   ① 已有配图（含重绘/手补产物）绝不进补裁候选 —— 防覆盖老师/管线已产出的图；
 *   ② 无框题（N1）不放行 —— 补裁只复用现有框，无框属另一类（视觉重定位脚本处理）；
 *   ③ 只放行 image_type='geometry' 的引图题 —— 引图判据与完整性闸同源（含 parent_stem）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { isCroppableMissingRow, isInheritableMissingRow } = await import('../server/utils/figureRecrop.js')

const row = (extra = {}) => ({
  geometry_image_url: null,
  image_type: 'geometry',
  image_bbox: { x: 100, y: 100, width: 200, height: 200 },
  content: '如图，在△ABC中，求阴影面积',
  parent_stem: null,
  ...extra,
})

test('★ N4 有合格框却无图的引图题 → 进补裁候选', () => {
  assert.equal(isCroppableMissingRow(row()), true)
})

test('★ 红线①：已有配图（含重绘/手补）绝不进候选', () => {
  assert.equal(isCroppableMissingRow(row({ geometry_image_url: 'https://oss/x.png' })), false)
})

test('★ 红线②：无框/零尺寸框（N1）不放行', () => {
  assert.equal(isCroppableMissingRow(row({ image_bbox: null })), false)
  assert.equal(isCroppableMissingRow(row({ image_bbox: { x: 1, y: 1, width: 0, height: 100 } })), false)
  assert.equal(isCroppableMissingRow(row({ image_bbox: 'not-json' })), false)
})

test('★ 红线③：非 geometry 题型不放行', () => {
  assert.equal(isCroppableMissingRow(row({ image_type: 'chart' })), false)
  assert.equal(isCroppableMissingRow(row({ image_type: 'none' })), false)
  assert.equal(isCroppableMissingRow(row({ image_type: null })), false)
})

test('引图判据含 parent_stem：拆小问后「如图」只在公共题干也放行', () => {
  assert.equal(isCroppableMissingRow(row({
    content: '(2)求 AF 的长',
    parent_stem: '如图，在△ABC中，D 是 BC 上一点',
  })), true)
})

test('不引图的 geometry 框题不放行（无引图词=本就不需要配图）', () => {
  assert.equal(isCroppableMissingRow(row({ content: '计算 2+3 的值' })), false)
})

test('image_bbox 以 JSON 字符串存也认（DB 现况兼容）', () => {
  assert.equal(isCroppableMissingRow(row({
    image_bbox: JSON.stringify({ x: 10, y: 10, width: 300, height: 300 }),
  })), true)
})

test('空行/缺字段不炸', () => {
  assert.equal(isCroppableMissingRow(null), false)
  assert.equal(isCroppableMissingRow({}), false)
})

// ── N5 兄弟配图继承谓词 ──
test('★ N5：引图无图无 own 框 + 有公共题干 → 可继承', () => {
  assert.equal(isInheritableMissingRow({
    geometry_image_url: null, image_bbox: null, image_type: null,
    parent_stem: '如图，已知抛物线 y=ax²+bx-4', content: '(2)求面积',
  }), true)
})

test('★ 红线：已有配图绝不继承覆盖', () => {
  assert.equal(isInheritableMissingRow({
    geometry_image_url: 'https://oss/x.png', image_bbox: null,
    parent_stem: '如图...', content: '(2)求面积',
  }), false)
})

test('★ 有 own 几何框的题走 N4 补裁，不走 N5 继承', () => {
  assert.equal(isInheritableMissingRow({
    geometry_image_url: null, image_bbox: { x: 1, y: 1, width: 100, height: 100 }, image_type: 'geometry',
    parent_stem: '如图...', content: '(2)求面积',
  }), false)
})

test('★ 无公共题干（parent_stem 空）不继承，防跨题误并', () => {
  assert.equal(isInheritableMissingRow({
    geometry_image_url: null, image_bbox: null, image_type: null,
    parent_stem: null, content: '如图，在△ABC中...',
  }), false)
})

test('不引图的无框题不放行', () => {
  assert.equal(isInheritableMissingRow({
    geometry_image_url: null, image_bbox: null, image_type: null,
    parent_stem: '计算下列各式', content: '(2) 2+3',
  }), false)
})
