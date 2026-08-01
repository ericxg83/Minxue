/**
 * 验证 getImageResolution / checkImageResolution 在典型场景下行为正确。
 *
 * 关键场景：
 *   1. 600x600 灰色图 → ok（边界值）
 *   2. 80x80 极小图 → too_low_resolution（3116 bytes 这种 AI 必失败的图）
 *   3. 100x100 模糊图 → too_low_resolution
 *   4. 1920x1080 高清图 → ok
 *   5. 异常 buffer → unreadable_resolution
 *
 * 用 sharp 现造图，不依赖网络/文件。
 */
import sharp from 'sharp'
import { getImageResolution, checkImageResolution, MIN_OCR_RESOLUTION } from '../utils/imageValidator.js'

const cases = [
  { name: '高清 1920×1080', w: 1920, h: 1080, expectOk: true },
  { name: '手机拍 1200×1600', w: 1200, h: 1600, expectOk: true },
  { name: '边界 600×600', w: 600, h: 600, expectOk: true },
  { name: '低于阈值 599×599', w: 599, h: 599, expectOk: false },
  { name: 'AI 必失败 80×80（3116 bytes 类）', w: 80, h: 80, expectOk: false },
  { name: '100×100 模糊截图', w: 100, h: 100, expectOk: false },
  { name: '横版小图 800×100', w: 800, h: 100, expectOk: false }, // 短边 100 < 600
  { name: '竖版小图 100×800', w: 100, h: 800, expectOk: false }, // 短边 100 < 600
]

let pass = 0
let fail = 0

for (const c of cases) {
  const buf = await sharp({
    create: { width: c.w, height: c.h, channels: 3, background: { r: 200, g: 200, b: 200 } }
  }).jpeg({ quality: 80 }).toBuffer()

  const res = await getImageResolution(buf)
  const check = await checkImageResolution(buf)
  const got = check.ok
  const ok = got === c.expectOk
  const tag = ok ? '✅' : '❌'
  console.log(`${tag} ${c.name}: ${res.width}×${res.height} (${buf.length} bytes) → ok=${check.ok} reason=${check.reason || '-'}`)
  if (ok) pass++; else fail++
}

// 异常 buffer
const broken = Buffer.from('not a real image at all, just plain text pretending')
const res2 = await getImageResolution(broken)
const check2 = await checkImageResolution(broken)
console.log(`${check2.ok ? '❌' : '✅'} 异常 buffer: ${res2.width}×${res2.height} → ok=${check2.ok} reason=${check2.reason}`)

// 验证 NON_RETRYABLE 黑名单
const { NON_RETRYABLE_ERROR_PATTERNS } = await import('../pendingTaskRecovery.js')
const sampleErr = '图片分辨率过低（80×80），请重新上传更清晰的图片（建议宽度≥1200像素，文件≥100KB）'
const hit = NON_RETRYABLE_ERROR_PATTERNS.some(p => p.test(sampleErr))
console.log(`${hit ? '✅' : '❌'} NON_RETRYABLE 黑名单命中"图片分辨率过低"`)
if (hit) pass++; else fail++

console.log(`\n──── ${pass}/${pass + fail} 通过, MIN_OCR_RESOLUTION=${MIN_OCR_RESOLUTION} ────`)
if (fail > 0) process.exit(1)
