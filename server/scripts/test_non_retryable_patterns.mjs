/**
 * 验证：
 *   1. NON_RETRYABLE_ERROR_PATTERNS 黑名单只拦截"客观不可恢复"错误
 *      （下载失败、URL 失效、配额耗尽、限流、图片分辨率过低等）
 *   2. AI 偶发拒绝话术（"图片是空白"、"页识别失败"、"所有页面识别结果为空"）
 *      **不再**进黑名单（必须放行让 PendingTaskRecovery 重新入队）
 *   3. isAIRefusalLikely 正确识别 AI 拒绝话术（用于放宽 MAX_AI_REFUSAL_RETRIES）
 *
 * 关键背景：8B 模型在配额紧张时不稳定，同样图一次"图片是空白"、下一次成功 OCR 15+ 道题
 * （实测：worksheet 1c31ee45 taskId 4f4ac1cc(失败) → 9016b0aa(成功)）。
 */
import { NON_RETRYABLE_ERROR_PATTERNS, classifyLastError } from '../pendingTaskRecovery.js'

// 复制 pendingTaskRecovery.js 内部的 isAIRefusalLikely 逻辑（独立函数不可导出，
// 这里复刻同步测试，避免 export 改动扩散）。
function isAIRefusalLikely(lastError) {
  if (!lastError) return false
  return /图片是空白|图片为空白|无法识别|无法看到|Unable to identify|Cannot identify|no text detected|cannot see|看不清|页面内容为空|用户提供的图片是空|所有页面识别结果为空|页识别失败|OCR 未识别到任何题目|AI_EMPTY/i.test(String(lastError))
}

// ── A. 黑名单命中（应 skip）──
const shouldSkip = [
  '下载图片失败: 返回内容不是图片（3116 bytes, unknown_magic_number）',
  '下载图片失败: 连接超时',
  '图片分辨率过低（80×80），请重新上传更清晰的图片',
  '所有视觉模型（魔搭 + Agnes + FreeModel + SenseNova）均不可用：所有魔搭视觉模型当日配额均已用尽',
  '所有魔搭视觉模型当日配额均已用尽',
  'rate limit exceeded',
  'quota exhausted, please try tomorrow',
  '429 Too Many Requests',
  '缺少 worksheetId',
  '所有图片URL无效',
  '文件上传未成功完成',
  'UPLOAD_NOT_COMPLETED',
  'Invalid model id: Qwen3-8B',
  'OSS 错误页',
  'AI returned empty content',
]

// ── B. AI 偶发拒绝话术（应放行，不再进黑名单）──
const shouldNotSkip = [
  '1 页识别失败；AI 提示: "用户提供的图片是空白的，没有任何可见内容..."',
  '3 页识别失败；AI 提示: "图片是空白"',
  '所有页面识别结果为空',
  '所有页面识别结果为空；AI 提示: "Unable to identify any content"',
  '1 页识别失败；AI 提示: "The provided image is blank, no text detected"',
  'OCR 未识别到任何题目',
  'AI_EMPTY',
  '无法识别',
  '页面内容为空',
  'taskId 12345 正常完成',
]

let pass = 0
let fail = 0

console.log('──── A. 黑名单应命中（不可恢复错误） ────')
for (const e of shouldSkip) {
  const r = classifyLastError(e)
  const ok = r.skip === true
  const tag = ok ? '✅' : '❌'
  console.log(`${tag} 黑名单命中: ${e.substring(0, 80)}`)
  if (ok) pass++; else fail++
}

console.log('\n──── B. AI 拒绝话术应放行（可重试） ────')
for (const e of shouldNotSkip) {
  const r = classifyLastError(e)
  const ok = r.skip === false
  const tag = ok ? '✅' : '❌'
  console.log(`${tag} ${r.skip ? '误进黑名单' : '放行'}: ${e.substring(0, 80)}`)
  if (ok) pass++; else fail++
}

console.log('\n──── C. isAIRefusalLikely 判定 ────')
const shouldBeRefusal = shouldNotSkip.filter(e => e !== 'taskId 12345 正常完成' && e !== 'OCR 未识别到任何题目' && e !== 'AI_EMPTY' && e !== '无法识别' && e !== '页面内容为空')
for (const e of shouldBeRefusal) {
  const isRefusal = isAIRefusalLikely(e)
  const tag = isRefusal ? '✅' : '❌'
  console.log(`${tag} AI 拒绝: ${e.substring(0, 80)}`)
  if (isRefusal) pass++; else fail++
}

// 不应该是 AI 拒绝的
const shouldNotBeRefusal = ['taskId 12345 正常完成', '下载图片失败', '图片分辨率过低（80×80）']
for (const e of shouldNotBeRefusal) {
  const isRefusal = isAIRefusalLikely(e)
  const ok = isRefusal === false
  const tag = ok ? '✅' : '❌'
  console.log(`${tag} 非 AI 拒绝: ${e.substring(0, 80)}`)
  if (ok) pass++; else fail++
}

console.log(`\n──── ${pass}/${pass + fail} 通过 ────`)
if (fail > 0) process.exit(1)
