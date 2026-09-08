import { test } from 'node:test'
import assert from 'node:assert/strict'

// 复刻 qrDetectionService.parseRetryExamId 的抽取逻辑做纯函数验证
// 覆盖三种历史二维码：/retry-task/{uuid} URL（大写）、MXG:{uuid}、旧 JSON{generatedExamId}
function parseRetryExamId(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const urlM = raw.match(/\/retry-task\/([0-9a-fA-F-]{36})(?:[/?#]|$)/)
  if (urlM) return urlM[1].toLowerCase()
  const mxgM = raw.match(/^MXG:([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/i)
  if (mxgM) return mxgM[1].toLowerCase()
  try {
    const parsed = JSON.parse(raw)
    const id = parsed?.generatedExamId || parsed?.examId || null
    if (id && /^[0-9a-fA-F-]{36}$/.test(id)) return id.toLowerCase()
  } catch { /* 非 JSON，忽略 */ }
  return null
}

const UUID = '11111111-2222-3333-4444-555555555555'
const LOW = UUID.toLowerCase()

test('/retry-task/{大写UUID} URL → 抽出小写裸 examId', () => {
  assert.strictEqual(parseRetryExamId(`https://minxue.pages.dev/retry-task/${UUID.toUpperCase()}`), LOW)
  assert.strictEqual(parseRetryExamId(`https://minxue.pages.dev/retry-task/${LOW}/`), LOW)
})

test('MXG:{UUID} → 抽出小写裸 examId', () => {
  assert.strictEqual(parseRetryExamId(`MXG:${UUID.toUpperCase()}`), LOW)
})

test('旧 JSON{generatedExamId} → 抽出 examId；{type:grading 无 id} → null', () => {
  assert.strictEqual(parseRetryExamId(JSON.stringify({ type: 'grading', generatedExamId: UUID })), LOW)
  assert.strictEqual(parseRetryExamId(JSON.stringify({ type: 'grading', paperId: UUID })), null)
})

test('无码/普通内容 → null（不会误判为重练）', () => {
  assert.strictEqual(parseRetryExamId(''), null)
  assert.strictEqual(parseRetryExamId('https://example.com/homework'), null)
  assert.strictEqual(parseRetryExamId('随便一段文字'), null)
  assert.strictEqual(parseRetryExamId(null), null)
})
