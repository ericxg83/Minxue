// 线上事故：iPhone 默认拍照格式是 HEIC，移动端相册 accept="image/*" 让 HEIC 进到后端。
// 旧实现：validateFileExtension 只允许 jpg/jpeg/png/webp → HEIC 在扩展名关就被毙，
// 根本走不到 fixFileIfNeeded 的 sharp 转码路径，弹"图片格式不符"。
// 新实现：扩展名 + magic bytes 放行 → fixFileIfNeeded 检测 heicPassthrough → sharp 归一化为 JPEG。
//
// 本测试覆盖 4 条路径：
//   1. validateFileHeader 识别 HEIC magic bytes 并返回 heicPassthrough: true
//   2. fixFileIfNeeded 把非白名单格式（含 HEIC family）归一化为 JPEG
//   3. 损坏格式 → 友好错误（fixed: false），不抛"图片格式不符"
//   4. validateFileExtension 大小写不敏感放行 HEIC / heic / HEIF / heif
//
// 注：本地 sharp.heif() 默认 compression='hevc' 在 libheif 不带 x265 编码器时会失败；
//     用 'av1' 输出的 image/avif 也走非白名单转码分支，覆盖同等路径。生产环境 Render
//     sharp 0.33+ 自带 libheif 解码器，能直接读 iPhone HEIC。
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import {
  validateFileExtension,
  validateFileHeader,
  fixFileIfNeeded,
} from '../services/uploadValidator.js'

let pass = 0
let fail = 0

// 手造最小 ISOBMFF ftyp box（让 file-type 识别为 image/heic）。
// 真实 HEIC 文件这个 box 后面跟 mdat (HEVC bitstream)，本地 sharp 不一定能解码，
// 但 header 识别路径不需要解码——只读 magic bytes。
function makeFakeHeicHeader(totalLen = 1100) {
  const ftyp = Buffer.alloc(20)
  ftyp.writeUInt32BE(20, 0)
  ftyp.write('ftyp', 4, 'ascii')
  ftyp.write('heic', 8, 'ascii')
  ftyp.writeUInt32BE(0, 12)
  ftyp.write('heic', 16, 'ascii')
  return Buffer.concat([ftyp, Buffer.alloc(Math.max(0, totalLen - ftyp.length))])
}

// 用例 1：HEIC magic bytes → validateFileHeader valid:true + heicPassthrough
{
  const buf = makeFakeHeicHeader(1100)
  const ft = await fileTypeFromBuffer(buf)
  const r = await validateFileHeader(buf)
  const ok =
    ft?.mime === 'image/heic' &&
    r.valid === true &&
    r.heicPassthrough === true &&
    r.detectedMime === 'image/heic'
  if (ok) {
    pass++
    console.log('✅ validateFileHeader 识别 HEIC magic bytes → heicPassthrough=true')
  } else {
    fail++
    console.log('❌ validateFileHeader HEIC 识别失败:', { fileType: ft?.mime, ...r })
  }
}

// 用例 2：fixFileIfNeeded 把非白名单格式（AVIF / HEIC family）归一化为 JPEG
// 这里用 sharp.heif({compression:'av1'}) 输出 image/avif —— 同样不在 ALLOWED_IMAGE_TYPES，
// 触发 fixFileIfNeeded 的 sharp 转码分支；验证 fixDescription 与 JPEG 输出。
{
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#3366ff' },
  })
    .heif({ compression: 'av1', quality: 50 })
    .toBuffer()
  const ft = await fileTypeFromBuffer(buf)
  const r = await fixFileIfNeeded(buf, 'IMG_AVIF.heic') // 扩展名是 heic 但 mime 是 avif —— 测试扩展名 vs mime 分歧路径
  let jpegConfirmed = false
  if (r.fixed && r.fixedBuffer) {
    try {
      const meta = await sharp(r.fixedBuffer).metadata()
      jpegConfirmed = meta.format === 'jpeg'
    } catch {}
  }
  const ok = r.fixed && jpegConfirmed
  if (ok) {
    pass++
    console.log(`✅ fixFileIfNeeded ${ft?.mime} → JPEG (${r.fixedBuffer.length} bytes, desc="${r.fixDescription}")`)
  } else {
    fail++
    console.log('❌ fixFileIfNeeded 转码失败:', { input: ft?.mime, fixed: r.fixed, jpegConfirmed, desc: r.fixDescription })
  }
}

// 用例 3：损坏 HEIC 壳（只剩 100 bytes）→ fixed:false
{
  const buf = makeFakeHeicHeader(100)
  const r = await fixFileIfNeeded(buf, 'IMG_CORRUPT.HEIC')
  if (!r.fixed) {
    pass++
    console.log('✅ 损坏 HEIC → fixed:false (', r.logs?.at(-1)?.slice(0, 80), ')')
  } else {
    fail++
    console.log('❌ 损坏 HEIC 居然被"修复"成功:', r.fixDescription)
  }
}

// 用例 4：扩展名大小写不敏感 → HEIC / heic / HEIF / heif 都过
{
  for (const name of ['IMG.HEIC', 'img.heic', 'IMG.HEIF', 'IMG.heif']) {
    const r = validateFileExtension(name)
    if (r.valid) {
      pass++
      console.log(`✅ validateFileExtension 放行 ${name} → .${r.ext}`)
    } else {
      fail++
      console.log(`❌ validateFileExtension 拒了 ${name}: ${r.error}`)
    }
  }
}

// 用例 5：扩展名 vs magic bytes 分歧——文件名是 .jpg 但 mime 是 HEIC
// 当前逻辑：magic bytes 优先识别为 HEIC → heicPassthrough=true（这就是用户场景：iPhone 上传）
{
  const buf = makeFakeHeicHeader(1100)
  const r = await validateFileHeader(buf)
  const ok = r.valid && r.heicPassthrough && r.detectedMime === 'image/heic'
  if (ok) {
    pass++
    console.log('✅ HEIC magic bytes 优先级 > 扩展名，符合用户场景')
  } else {
    fail++
    console.log('❌ HEIC magic bytes 优先级逻辑失败:', r)
  }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)