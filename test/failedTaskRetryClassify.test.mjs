import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyLastError,
  NON_RETRYABLE_ERROR_PATTERNS,
  TRANSIENT_ERROR_PATTERNS,
  MAX_TRANSIENT_RETRIES
} from '../server/pendingTaskRecovery.js'

/**
 * 2026-09-13 事故：作业「新闵学校"成长·桥"练习 七年级数学第2周周末卷」
 * 9/11 失败后**永久卡在 failed**，自动恢复与前端重试入口双双失效，只能人工调
 * `POST /api/tasks/:id/retry` 才救回来。
 *
 * 库内 last_error（原始快照）：
 *   下载图片失败(第 2/2 页): 下载图片失败: Request failed with status code 400
 *
 * 9/13 复查第 2 页 OSS URL：HTTP 200 / 1.4MB —— 图片一直都在，当时只是 OSS 瞬时的 400。
 * 人工重试一次即成功（30 题 / 6 错题 / 耗时 225s），证明这类错误**会自愈**。
 *
 * 根因：NON_RETRYABLE_ERROR_PATTERNS 里的 /下载图片失败/ 把两种性质相反的错误混为一谈：
 *   ① 瞬时抖动（OSS 4xx/5xx、网络超时）—— 会自愈，且发生在 Step 2/6 尚未调 AI，
 *      重试成本 = 一次 HTTP GET，不消耗配额；
 *   ② 客观不可恢复（分辨率过低、返回内容不是图片 / URL 失效）—— 重试永远无意义。
 * 整体拉黑导致 ① 被永久放弃。
 */

// 事故现场的真实 last_error
const TRANSIENT_400 = '下载图片失败(第 2/2 页): 下载图片失败: Request failed with status code 400'

// 客观不可恢复的两类（同样以"下载图片失败"开头，必须仍能区分出来）
const RESOLUTION_TOO_LOW = '下载图片失败(第 1 页): 下载图片失败: 图片分辨率过低（400×600），请重新上传更清晰的图片（建议宽度≥1200像素，文件≥100KB）'
const NOT_AN_IMAGE = '下载图片失败: 返回内容不是图片（1234 bytes, not jpeg），URL 可能已失效或 OSS 返回了错误页'

test('OSS 瞬时 400 → 判为瞬时可自愈，允许自动重试（本次事故核心用例）', () => {
  const v = classifyLastError(TRANSIENT_400)
  assert.equal(v.skip, false, '瞬时故障不该被跳过')
  assert.equal(v.kind, 'transient')
})

test('瞬时网络错误（超时 / 连接重置 / 5xx）同样判为可自愈', () => {
  for (const msg of [
    '下载图片失败: timeout of 30000ms exceeded',
    '下载图片失败: socket hang up',
    '下载图片失败: Request failed with status code 502',
    'connect ETIMEDOUT 203.0.113.9:443'
  ]) {
    const v = classifyLastError(msg)
    assert.equal(v.kind, 'transient', `${msg} 应判为瞬时可自愈，实际 kind=${v.kind}`)
    assert.equal(v.skip, false)
  }
})

test('分辨率过低 → 客观不可恢复，永久拉黑', () => {
  const v = classifyLastError(RESOLUTION_TOO_LOW)
  assert.equal(v.skip, true)
  assert.equal(v.kind, 'permanent')
})

test('返回内容不是图片（URL 失效 / OSS 错误页）→ 永久拉黑', () => {
  const v = classifyLastError(NOT_AN_IMAGE)
  assert.equal(v.skip, true)
  assert.equal(v.kind, 'permanent')
})

test('配额耗尽 / 限流 → 仍然永久拉黑（不因本次改动被放宽）', () => {
  for (const msg of ['所有魔搭视觉模型配额已用尽', 'Rate limit exceeded', '429 Too Many Requests']) {
    const v = classifyLastError(msg)
    assert.equal(v.kind, 'permanent', `${msg} 应永久拉黑，实际 kind=${v.kind}`)
  }
})

test('数据类错误 → 永久拉黑', () => {
  for (const msg of ['缺少 worksheetId', '所有图片URL无效', '文件上传未成功完成']) {
    assert.equal(classifyLastError(msg).kind, 'permanent', `${msg} 应永久拉黑`)
  }
})

test('AI 偶发拒绝话术既不进永久黑名单也不进瞬时名单（走既有 AI 重试通道）', () => {
  const v = classifyLastError('第 1 页识别失败；AI 提示: 图片是空白')
  assert.equal(v.skip, false)
  assert.equal(v.kind, 'none')
})

test('空 last_error 保守放行', () => {
  for (const msg of [null, undefined, '', '   ']) {
    const v = classifyLastError(msg)
    assert.equal(v.skip, false, `空错误不该被跳过: ${JSON.stringify(msg)}`)
  }
})

test('回归护栏：NON_RETRYABLE 不得整体匹配"下载图片失败"', () => {
  // 一旦有人把 /下载图片失败/ 加回永久黑名单，OSS 抖动的任务会再次被永久卡死。
  assert.equal(
    NON_RETRYABLE_ERROR_PATTERNS.some(p => p.test(TRANSIENT_400)),
    false,
    '永久性黑名单不能整体匹配"下载图片失败"，否则瞬时故障任务再次无法重试'
  )
  // 但客观子类必须仍在永久黑名单里
  assert.ok(NON_RETRYABLE_ERROR_PATTERNS.some(p => p.test(RESOLUTION_TOO_LOW)), '分辨率过低必须永久拉黑')
  assert.ok(NON_RETRYABLE_ERROR_PATTERNS.some(p => p.test(NOT_AN_IMAGE)), '非图片内容必须永久拉黑')
})

test('瞬时名单非空，且重试上限比常规 3 次宽松', () => {
  assert.ok(TRANSIENT_ERROR_PATTERNS.length > 0)
  assert.ok(MAX_TRANSIENT_RETRIES > 3, '下载重试不消耗 AI 配额，额度应比 MAX_AUTO_RETRIES(3) 宽松')
})
