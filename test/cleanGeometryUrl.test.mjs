/**
 * 干净几何图 URL 发布通道测试。
 *
 * 背景：几何重画只写 questions.clean_geometry_svg（SVG 源码），
 * 而周末课件配图读的是 questions.clean_geometry_image_url（图片 URL），
 * 两个字段不通 ⇒ 重画结果对课件不可见（实测 15 题有 SVG、0 题有 URL）。
 * 本测试覆盖把 SVG 发布成 URL 过程中的全部纯函数判据。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  computeRasterDensity,
  rasterizeCleanSvg,
  isBlankRaster,
  CLEAN_FIGURE_TARGET_WIDTH
} from '../server/utils/geom/cleanGeometryUrl.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'

/**
 * ⚠️ 必须用 server 侧的 sharp。
 *
 * 本仓库同时存在两份 sharp：根 node_modules 是 0.33.5，server/node_modules 是 0.35.4。
 * 测试文件位于根目录，裸 `import 'sharp'` 会解析到 0.33.5；而被测模块
 * cleanGeometryUrl.js 位于 server 下，用的是 0.35.4。
 * 两个版本的 libvips 在同一进程里共存会让 0.33.5 写 PNG 时报
 * `colourspace: parameter space not set` —— 是环境冲突，不是被测代码的问题。
 * 统一从 server 解析即可消除。
 */
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url))
const sharp = serverRequire('sharp')

// ── 画布尺寸解析（决定栅格化放大倍数）──

test('从 width/height 读画布尺寸', () => {
  const d = computeRasterDensity('<svg width="400" height="300" viewBox="0 0 400 300"></svg>', 1200)
  // 72 × 1200 / 400 = 216
  assert.equal(d, 216)
})

test('缺 width/height 时退回 viewBox', () => {
  const d = computeRasterDensity('<svg viewBox="0 0 200 150"></svg>', 1200)
  // 72 × 1200 / 200 = 432
  assert.equal(d, 432)
})

test('两者都没有时不放大（返回下限密度）', () => {
  assert.equal(computeRasterDensity('<svg></svg>', 1200), 72)
})

test('非 SVG 文本不会算出离谱密度', () => {
  assert.equal(computeRasterDensity('not an svg at all', 1200), 72)
})

test('密度上限封顶，避免小画布被放到巨图', () => {
  // 声明宽度 1px 时 72×1200/1 = 86400，必须被压到上限
  const d = computeRasterDensity('<svg width="1" height="1"></svg>', 1200)
  assert.ok(d <= 600, `期望封顶 <= 600，实际 ${d}`)
})

test('默认目标宽度覆盖白板 1920 全屏下的配图宽度（≈1129px）', () => {
  assert.ok(CLEAN_FIGURE_TARGET_WIDTH >= 1129, `期望 >= 1129，实际 ${CLEAN_FIGURE_TARGET_WIDTH}`)
})

// ── 栅格化 ──

const triangle = renderGeometrySvg({
  points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 4, y: 0 }, { label: 'C', x: 0, y: 3 }],
  segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }]
})

test('真实重画 SVG 能栅格化出 PNG', async () => {
  assert.ok(triangle && /<svg/i.test(triangle), '前置：renderGeometrySvg 应产出 SVG')
  const png = await rasterizeCleanSvg(triangle)
  assert.ok(png && png.length > 500, '应产出非空 PNG buffer')
  // PNG magic number
  assert.equal(png.slice(1, 4).toString('ascii'), 'PNG')
})

test('栅格化结果放大到目标宽度量级（不是 400px 小图）', async () => {
  const png = await rasterizeCleanSvg(triangle)
  const meta = await sharp(png).metadata()
  assert.ok(meta.width >= 1100, `期望宽度 >= 1100（覆盖全屏显示），实际 ${meta.width}`)
})

test('空白/非法输入返回 null 而不是抛异常', async () => {
  assert.equal(await rasterizeCleanSvg(''), null)
  assert.equal(await rasterizeCleanSvg(null), null)
  assert.equal(await rasterizeCleanSvg('这是一段题干文本，不是 SVG'), null)
})

test('可渲染但内部为空的 SVG 不会崩，交给空白判定拦下', async () => {
  const empty = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>'
  const png = await rasterizeCleanSvg(empty)
  assert.ok(png, '栅格化本身应成功')
  assert.equal(await isBlankRaster(png), true, '纯空 SVG 应被判为空白，不予发布')
})

// ── 空白图闸门（宁可不出图，也不出空白图）──

test('全白图判为空白', async () => {
  const white = await sharp(
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ffffff"/></svg>')
  ).png().toBuffer()
  assert.equal(await isBlankRaster(white), true)
})

test('纯色非白图也判为空白（没有线条就没有信息）', async () => {
  const solid = await sharp(
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#cccccc"/></svg>')
  ).png().toBuffer()
  assert.equal(await isBlankRaster(solid), true)
})

test('有线条的图不判为空白', async () => {
  const png = await rasterizeCleanSvg(triangle)
  assert.equal(await isBlankRaster(png), false)
})

test('null / 解码失败一律按空白处理（安全方向：不发布）', async () => {
  assert.equal(await isBlankRaster(null), true)
  assert.equal(await isBlankRaster(Buffer.from('not an image')), true)
})

// ── 白底不透明（避免课件里出现透明底黑线看不清）──

test('栅格化结果带白底（alpha 已 flatten）', async () => {
  const png = await rasterizeCleanSvg(triangle)
  const meta = await sharp(png).metadata()
  assert.ok(!meta.hasAlpha, `期望无 alpha 通道（已铺白底），实际 hasAlpha=${meta.hasAlpha}`)
})
