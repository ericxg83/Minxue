// E2E 验证：workbook 0 道题不再反复入队
// 跑法：cd server && node scripts/test_ocr_blacklist.mjs
import { isValidImageBuffer } from '../utils/imageValidator.js'
import { classifyLastError, NON_RETRYABLE_ERROR_PATTERNS } from '../pendingTaskRecovery.js'
import { RETRY_DELAYS_429, VL_MODELS } from '../config/ai.js'
import { readFileSync } from 'fs'

let pass = 0, fail = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  const mark = ok ? '[PASS]' : '[FAIL]'
  console.log(`  ${mark} ${name}`)
  if (!ok) {
    console.log(`     actual:   ${JSON.stringify(actual)}`)
    console.log(`     expected: ${JSON.stringify(expected)}`)
  }
  if (ok) pass++; else fail++
}

console.log('═══ 1. imageValidator ═══')
const realJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Buffer.alloc(3112)])
check('3116 bytes 真实 JPEG 应 ok=true', isValidImageBuffer(realJpeg).ok, true)
const realHeic = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...Buffer.alloc(3108)])
check('3116 bytes 真实 HEIC 应 ok=true', isValidImageBuffer(realHeic).ok, true)
const ossXml = Buffer.from('<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>'.padEnd(200))
check('OSS XML 错误页应 ok=false', isValidImageBuffer(ossXml).ok, false)
check('500 bytes 应 reason=too_small', isValidImageBuffer(Buffer.alloc(500)).reason, 'too_small')

console.log('\n═══ 2. 黑名单 (workbook 0 道题不反复入队) ═══')
const errors = [
  '1 页识别失败', '3 页识别失败',
  '所有页面识别结果为空', 'OCR 未识别到任何题目',
  '下载图片失败: 返回内容不是图片', '下载图片失败: 下载图片失败: 返回内容不是图片',
  'workbook 任务缺少 worksheetId', '所有魔搭视觉模型当日配额已用尽',
  'rate limit exceeded', 'AI_EMPTY',
]
for (const err of errors) {
  check(`"${err}" 应 skip=true`, classifyLastError(err).skip, true)
}
check('"unrelated error" 应 skip=false', classifyLastError('unrelated error').skip, false)

console.log('\n═══ 3. 429 退避 (从 35s 缩到 8s) ═══')
const total = RETRY_DELAYS_429.reduce((a, b) => a + b, 0)
check('RETRY_DELAYS_429 总等待 ≤ 10s', total <= 10000, true)
check('VL_MODELS 至少 3 个', VL_MODELS.length >= 3, true)

console.log('\n═══ 4. workbook 0 道题重试 (静态检查) ═══')
const worker = readFileSync('./worker.js', 'utf8')
check('含 rotateVLModel() 调用', worker.includes('rotateVLModel()'), true)
check('workbook 0 道题切模型', worker.includes('第 1 轮全 0 道题，切换到下一个视觉模型'), true)
check('workbook 仍 0 道题标 AI_EMPTY', worker.includes("errorType: 'AI_EMPTY'"), true)

console.log(`\n═══ 总计: ${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail > 0 ? 1 : 0)
