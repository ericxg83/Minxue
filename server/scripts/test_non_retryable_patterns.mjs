/**
 * 验证 NON_RETRYABLE_ERROR_PATTERNS 能匹配 AI 拒绝关键词
 */
import { NON_RETRYABLE_ERROR_PATTERNS, classifyLastError } from '../pendingTaskRecovery.js'

const testErrors = [
  // 用户日志里的实际错误
  '1 页识别失败；AI 提示: "用户提供的图片是空白，无法识别任何内容。"',
  '所有页面识别结果为空',
  '所有视觉模型（魔搭 + Agnes + FreeModel + SenseNova）均不可用：所有魔搭视觉模型当日配额均已用尽，请明日再试或配置其他模型',
  // 模拟修复后 AI 拒绝被 throw 的场景
  '3 页识别失败；AI 提示: "图片是空白"',
  '1 页识别失败；AI 提示: "The provided image is blank, no text detected"',
  '1 页识别失败；AI 提示: "Unable to identify any content in the image"',
  // 不应匹配的（正常任务）
  'taskId 12345 正常完成',
]

let allPass = true
for (const e of testErrors) {
  const r = classifyLastError(e)
  const expectSkip = !e.includes('正常完成')
  const status = r.skip === expectSkip ? '✅' : '❌'
  if (r.skip !== expectSkip) allPass = false
  console.log(`${status} ${r.skip ? '黑名单命中' : '放行'}: ${e.substring(0, 90)}`)
  if (r.skip) console.log(`   原因: ${r.reason}`)
}
console.log(allPass ? '\n所有测试通过' : '\n有测试失败')
