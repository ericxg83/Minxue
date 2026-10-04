// 图片抓取必须统一走封装（提案⑲，2026-10-04）
//
// 背景：提案⑱ 的 SSRF 防线要在「统一抓图入口」上加拦截，但 2026-10-04 实测发现
// 有三处**内联复制**了同一段 `axios.get(url, NO_PROXY_DOWNLOAD_OPTS)`：
//   - server/worker.js:950        ← 批改主链路，SSRF 最需要拦的那一步
//   - server/utils/cropAndUpload.js
//   - server/rerunGeometry.js
// 它们不走封装 ⇒ 任何加在封装里的校验（禁代理、SSRF 拦截）都会被绕过。
// 已全部改为调用 `downloadImageBufferNoProxy`（与原内联实现逐字等价，纯重构）。
//
// 本锁防止以后再新增内联副本：直接抓图的点必须为 0（封装函数内部那一个除外）。
// 不靠人记得，靠断言拦。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'server')
const WRAPPER = path.normalize(path.join(SERVER, 'utils/noProxyHttp.js'))

function walk(dir, cb) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'scripts') continue
    const full = path.join(dir, e)
    let st = null
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, cb)
    else if (e.endsWith('.js')) cb(full)
  }
}

/** 找出「用 NO_PROXY 下载选项直接 axios.get」的所有点 */
function findInlineDownloads() {
  const hits = []
  walk(SERVER, (f) => {
    if (path.normalize(f) === WRAPPER) return // 封装函数自身是唯一合法的那一处
    const lines = readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!/axios\.get\(/.test(line)) return
      // 同一条语句内（或紧邻下一行）出现 NO_PROXY_DOWNLOAD_OPTS 即视为内联副本
      if (/NO_PROXY_DOWNLOAD_OPTS/.test(line + (lines[i + 1] || ''))) {
        hits.push(`${path.relative(ROOT, f).split(path.sep).join('/')}:${i + 1}`)
      }
    })
  })
  return hits
}

test('图片抓取不得有内联的 axios 副本（否则绕过统一入口的校验）', () => {
  const hits = findInlineDownloads()
  assert.deepEqual(hits, [],
    '以下位置直接 axios.get + NO_PROXY_DOWNLOAD_OPTS，绕过了统一入口'
    + '（禁代理与 SSRF 拦截都在封装里）：' + hits.join(', ') + '。请改为调用 downloadImageBufferNoProxy()。')
})

test('三处历史内联点必须都已改走封装', () => {
  // 这三条是 2026-10-04 实测存在的内联副本，逐个锁死，防止被改回去
  for (const f of ['server/worker.js', 'server/utils/cropAndUpload.js', 'server/rerunGeometry.js']) {
    const p = path.join(ROOT, f)
    assert.ok(existsSync(p), `${f} 不存在`)
    assert.match(readFileSync(p, 'utf8'), /downloadImageBufferNoProxy/,
      `${f} 不再使用统一封装`)
  }
})

test('worker.js 下载图片后仍必须做魔数校验（OSS 错误页不得喂给视觉模型）', () => {
  // 2026-09-22 事故回归点：改走封装后，错误页拦截这道闸不能丢
  const src = readFileSync(path.join(ROOT, 'server/worker.js'), 'utf8')
  assert.match(src, /isValidImageBuffer/, 'worker.js 缺少图片魔数校验，OSS 的 XML/HTML 错误页会被当图片喂给视觉模型')
})

test('封装函数本身必须带 SSRF 私网/回环/元数据拦截', () => {
  const src = readFileSync(WRAPPER, 'utf8')
  assert.match(src, /assertNotPrivateUrl|isPrivateIP|assertImageUrlAllowed/,
    '统一抓图入口里没有任何私网/回环/元数据拦截 ⇒ 收拢内联副本的意义被浪费，SSRF 重新敞开。'
    + '请在 downloadImageBufferNoProxy 发请求前调用拦截。')
})
