/**
 * 回归测试：题目配图（几何裁片）专用分辨率判据（2026-11-01）
 *
 * 事故背景：老师点「AI 重解析」永远收到「配图不可用：图片分辨率过低（1014×102）」。
 * 根因：配图下载复用了【整页作业照片】的下载闸（最短边 ≥600），而数轴/长条示意图
 * 的正常形态就是高 100~200px 的扁条 —— 实测库内最近 200 张配图 64 张（32%）被误杀。
 * 配图也没法「重新上传」，原提示对配图场景不可执行。
 *
 * 锁定红线：
 *   ① 扁条配图（数轴 1014×102 / 433×93）必须放行 —— 这是修此 bug 的本体；
 *   ② 整页照片阈值 MIN_OCR_RESOLUTION=600 语义不变（页图短边 <600 仍拒）；
 *   ③ 配图真不可用的形态（宽 <300 或 高 <40）仍要拒 —— 不许把闸整个摘掉。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'

const { checkFigureCropResolution, checkImageResolution, MIN_FIGURE_WIDTH, MIN_FIGURE_HEIGHT } =
  await import('../server/utils/imageValidator.js')

const pngOf = async (w, h) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } }).png().toBuffer()

test('★ 红线①：数轴扁条配图放行（事故原图尺寸 1014×102）', async () => {
  const r = await checkFigureCropResolution(await pngOf(1014, 102))
  assert.equal(r.ok, true, JSON.stringify(r))
})

test('★ 红线①：10-30 实测被拒的数轴配图尺寸 433×93 放行', async () => {
  const r = await checkFigureCropResolution(await pngOf(433, 93))
  assert.equal(r.ok, true)
})

test('★ 红线①：昨天补裁的数轴配图尺寸 711×118 / 645×103 放行', async () => {
  assert.equal((await checkFigureCropResolution(await pngOf(711, 118))).ok, true)
  assert.equal((await checkFigureCropResolution(await pngOf(645, 103))).ok, true)
})

test('★ 红线③：宽 <300 拒（数字标注不可辨）', async () => {
  const r = await checkFigureCropResolution(await pngOf(228, 185))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'too_low_resolution')
})

test('★ 红线③：高 <40 拒（只是一条线）', async () => {
  const r = await checkFigureCropResolution(await pngOf(1014, 30))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'too_low_resolution')
})

test('边界：宽 300 / 高 40 恰好放行（下限含边界）', async () => {
  assert.equal((await checkFigureCropResolution(await pngOf(300, 40))).ok, true)
  assert.equal((await checkFigureCropResolution(await pngOf(299, 40))).ok, false)
  assert.equal((await checkFigureCropResolution(await pngOf(300, 39))).ok, false)
})

test('无法读分辨率的 buffer 拒绝', async () => {
  const r = await checkFigureCropResolution(Buffer.from('not an image'))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'unreadable_resolution')
})

test('★ 红线②：整页照片判据语义不变（最短边 <600 仍拒）', async () => {
  assert.equal(MIN_FIGURE_WIDTH, 300)
  assert.equal(MIN_FIGURE_HEIGHT, 40)
  // 1014×102 的扁条在整页判据下仍然拒（它的服务对象是页图，不是配图）
  const page = await checkImageResolution(await pngOf(1014, 102))
  assert.equal(page.ok, false)
  // 正常页图 1650×2200 放行
  assert.equal((await checkImageResolution(await pngOf(1650, 2200))).ok, true)
})
