import { test } from 'node:test'
import assert from 'node:assert/strict'

// 复刻 PrintPreview.getRetryTaskUrl 的取址逻辑做纯函数验证
// （App 内 window.location.origin === 'https://localhost' 是本次 bug 根因）
function makeUrl({ origin, envBase, id }) {
  const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
  const base = isLocalOrigin ? (envBase || 'https://minxue.pages.dev') : origin
  return `${base}/retry-task/${id.toUpperCase()}`
}

const UUID = '11111111-2222-3333-4444-555555555555'
const WANT = UUID.toUpperCase()

test('App 内 origin=https://localhost → 回退公网 minxue.pages.dev（核心修复）', () => {
  assert.strictEqual(makeUrl({ origin: 'https://localhost', id: UUID }),
    `https://minxue.pages.dev/retry-task/${WANT}`)
})

test('本地 vite dev localhost:5173 → 回退公网', () => {
  assert.strictEqual(makeUrl({ origin: 'http://localhost:5173', id: UUID }),
    `https://minxue.pages.dev/retry-task/${WANT}`)
})

test('线上真实部署 origin 已是公网 → 保留 origin，不被硬编码覆盖', () => {
  assert.strictEqual(makeUrl({ origin: 'https://minxue.pages.dev', id: UUID }),
    `https://minxue.pages.dev/retry-task/${WANT}`)
})

test('显式配置 VITE_APP_BASE_URL → App 内优先用它', () => {
  assert.strictEqual(makeUrl({ origin: 'https://localhost', envBase: 'https://custom.example', id: UUID }),
    `https://custom.example/retry-task/${WANT}`)
})

test('小写 id 也归一为大写', () => {
  assert.ok(makeUrl({ origin: 'https://localhost', id: UUID.toLowerCase() }).endsWith(WANT))
})
