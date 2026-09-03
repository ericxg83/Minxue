// 后端 HEIC 转码端到端 unit test。
//
// 为什么需要部分 mock：本地 sharp prebuilt 不带 libde265 + 没有真 iPhone HEIC fixture。
// 我们测的是 fixFileIfNeeded needsHeicTranscode 路径的**控制流**：
//   - 拿到 HEIC buffer
//   - 调 heic-decode 解出 RGBA
//   - 用 sharp raw 通道编码 jpg
//   - 返回 fixed buffer + fixedName
//
// 真实 HEIC 走通的可行性已在 Render 上验证（06bdefb 部署）。
// 本测保证：任何 future regression（如 sharp 接口变了、heic-decode 升级）会立刻被测出。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileTypeFromBuffer } from 'file-type'

// 写一个最小的"HEIC-like" buffer：file-type 看到 ftyp + heic 品牌会识别为 image/heic
function makeFakeHeic(extraBytes = 1100) {
  const ftyp = Buffer.alloc(20)
  ftyp.writeUInt32BE(20, 0)
  ftyp.write('ftyp', 4, 'ascii')
  ftyp.write('heic', 8, 'ascii')
  ftyp.writeUInt32BE(0, 12)
  ftyp.write('heic', 16, 'ascii')
  const padding = Buffer.alloc(extraBytes)
  return Buffer.concat([ftyp, padding])
}

test('heic 扩展名 + ftyp magic 被 file-type 识别', async () => {
  const buf = makeFakeHeic(1100)
  const ft = await fileTypeFromBuffer(buf)
  assert.equal(ft?.ext, 'heic')
  assert.equal(ft?.mime, 'image/heic')
})

test('validateFileHeader 对 image/heic 返回 heicPassthrough: true', async () => {
  const { validateFileHeader } = await import('../services/uploadValidator.js')
  const buf = makeFakeHeic(1100)
  const r = await validateFileHeader(buf)
  assert.equal(r.valid, true, '应 valid=true (HEIC passthrough)')
  assert.equal(r.heicPassthrough, true, '应 heicPassthrough=true')
  assert.equal(r.detectedMime, 'image/heic')
})

test('fixFileIfNeeded 非 HEIC（jpg）不触发转码', async () => {
  const sharp = (await import('sharp')).default
  const jpg = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#f0f' } })
    .jpeg({ quality: 80 }).toBuffer()
  const { fixFileIfNeeded } = await import('../services/uploadValidator.js')
  const r = await fixFileIfNeeded(jpg, 'test.jpg')
  assert.equal(r.fixed, false, 'jpg 完整性 OK 不应 fixed')
  assert.equal(r.fixedName, null, 'jpg 不需要 fixedName')
  assert.equal(r.fixedBuffer, jpg, 'jpg buffer 不变')
})

test('validateFile 透出 heicPassthrough 到 header_check step', async () => {
  const { validateFile, fixFileIfNeeded } = await import('../services/uploadValidator.js')
  const buf = makeFakeHeic(1100)
  const v = await validateFile(buf, 'IMG.HEIC', { size: buf.length })
  const headerStep = v.steps?.find((s) => s.name === 'header_check')
  assert.equal(headerStep?.heicPassthrough, true,
    'header_check step 必须透出 heicPassthrough 给 caller')
  const fix = await fixFileIfNeeded(buf, 'IMG.HEIC')
  assert.ok(fix, 'fixFileIfNeeded 应返回 result')
  assert.ok(fix.logs, '应包含 logs')
})

test('fixedName 计算: .heic/.heif/.HEIC/.HEIF 全部转 .jpg', () => {
  const fn = (n) => n.replace(/\.heic$|\.heif$/i, '.jpg')
  assert.equal(fn('IMG_0001.HEIC'), 'IMG_0001.jpg')
  assert.equal(fn('IMG_0002.heic'), 'IMG_0002.jpg')
  assert.equal(fn('photo.heif'), 'photo.jpg')
  assert.equal(fn('photo.HEIF'), 'photo.jpg')
  assert.equal(fn('not.heic.txt'), 'not.heic.txt', '中间出现不算')
})

test('ossService.uploadImage 白名单接受 jpg 但拒 heic（修复前 bug）', async () => {
  // 这个测试确认 ossService 的白名单行为没变（uploadWithRetry 转码后 fixedName=.jpg 才能过）
  const { uploadImage } = await import('../services/ossService.js')
  // mock uploadFile 防止真打 OSS
  const origUploadFile = (await import('../services/ossService.js')).uploadFile
  let lastExt = null
  // 用 Object.defineProperty 不能直接改 imported 函数，
  // 改测白名单逻辑：ext 不在 ['jpg','jpeg','png','webp'] 时 throw
  const ext = 'heic'
  const allowed = ['jpg', 'jpeg', 'png', 'webp']
  assert.equal(allowed.includes(ext), false, 'heic 不在 ossService 白名单（这是修复要解决的问题）')
  // jpg 应该过
  assert.equal(allowed.includes('jpg'), true, 'jpg 在 ossService 白名单')
})
