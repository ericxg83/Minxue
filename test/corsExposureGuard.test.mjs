// CORS 白名单安全锁（提案⑰-7，2026-10-04）
//
// 背景：实测生产 CORS 是 `*`（任意来源被 echo 放行，且当天复测两次仍如此），
// 而 API 全站无鉴权 ⇒ 任何人可无凭证读全部学生姓名/年级/错题数/任务文件名。
// 关键根因：`*` 恰好让任何代码兜底都不被走到，所以危险值必须在**代码层**被中和。
//
// 现在是三态：① 配了且非 `*` → 显式配置优先；② 配了 `*` → 视为无效，落安全兜底；
// ③ 没配 → 安全兜底。安全兜底 = 本地 vite 端口 + 已部署的 Cloudflare Pages 根来源。
//
// 本锁守住这些不变量，防止有人日后把 `*` 的效力恢复。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = readFileSync(path.join(ROOT, 'server/index.js'), 'utf8')
const EXAMPLE = readFileSync(path.join(ROOT, 'server/.env.example'), 'utf8')
const RENDER = readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')

test('`*` 必须被判为无效配置并落安全兜底（不得让 `*` 生效）', () => {
  assert.match(INDEX, /_wildcardConfigured\s*=\s*_rawAllowedOrigins\.includes\('\*'\)/,
    '未检测 `*` ⇒ 生产配 `*` 时会继续对全互联网开放')
  assert.match(
    INDEX,
    /allowedOrigins\s*=\s*\(_rawAllowedOrigins\.length\s*>\s*0\s*&&\s*!_wildcardConfigured\)\s*\?\s*_rawAllowedOrigins\s*:\s*SAFE_DEFAULT_ORIGINS/,
    'allowedOrigins 的三态判定被改动了；`*` 必须走 SAFE_DEFAULT 分支，否则等于没修'
  )
})

test('安全兜底必须同时含 localhost 与已部署前端来源', () => {
  const m = INDEX.match(/SAFE_DEFAULT_ORIGINS\s*=\s*\[([\s\S]*?)\]/)
  assert.ok(m, '未找到 SAFE_DEFAULT_ORIGINS')
  assert.match(m[1], /http:\/\/localhost:5173/,
    '兜底缺本地 vite 端口 ⇒ 本地联调会被自己的后端拦掉')
  assert.match(m[1], /https:\/\/minxue\.pages\.dev/,
    '兜底缺已部署的 Cloudflare Pages 根来源 ⇒ 生产网页版会被 CORS 拦（前端报网络错误、后端日志全 200）')
})

test('兜底里不得出现通配符', () => {
  const m = INDEX.match(/SAFE_DEFAULT_ORIGINS\s*=\s*\[([\s\S]*?)\]/)
  assert.ok(m)
  assert.doesNotMatch(m[1], /['"]\*['"]/, 'SAFE_DEFAULT_ORIGINS 里出现了 `*`，等于没修')
})

test('不得引入「默认全开」的其它写法（|| "*" / ?? "*"）', () => {
  assert.doesNotMatch(INDEX, /ALLOWED_ORIGIN\s*(\|\||\?\?)\s*['"]\*['"]/,
    '出现了 `ALLOWED_ORIGIN || "*"` 之类的兜底 ⇒ 漏配时静默变成全网开放')
})

test('cors 中间件不得再判断通配符（避免留下「配 * 就能全开」的错觉）', () => {
  const m = INDEX.match(/app\.use\(cors\(\{[\s\S]*?\}\)\)/)
  assert.ok(m, '未找到 app.use(cors({...}))')
  assert.doesNotMatch(m[0], /includes\(['"]\*['"]\)/,
    'cors 回调里仍有 `includes("*")` 判断，与三态逻辑矛盾且会误导后人')
})

test('显式白名单配置仍优先生效（别把「显式配置」这条能力堵死）', () => {
  assert.match(INDEX, /_rawAllowedOrigins\.length\s*>\s*0/,
    '显式配置优先的判断被移除 ⇒ 将来设了域名也不生效')
  assert.match(INDEX, /使用显式白名单/, '缺少显式白名单的启动日志，配置是否生效将无法一眼看出')
})

test('本机回环放行（r112 为冒烟加的豁免）不得被放宽成任意来源', () => {
  // r112 为冒烟产物（127.0.0.1:523x）放行回环来源是对的：浏览器无法伪造该 Origin。
  // 但必须确认它仍是用精确匹配回环，而不是被顺手改成通配或包含式。
  const m = INDEX.match(/const isLoopbackOrigin = ([^\n]+)/)
  assert.ok(m, '未找到 isLoopbackOrigin')
  assert.match(m[1], /localhost|127/, '回环判定丢了具体匹配字样，可能已被放宽')
  assert.doesNotMatch(m[1], /includes\(|startsWith\(\s*['"]\*|===\s*['"]\*/,
    '回环判定里出现通配/包含式匹配 ⇒ 等于对全互联网放行')
})

test('.env.example 必须记录 ALLOWED_ORIGIN 并说明「配 * 的后果」', () => {
  assert.match(EXAMPLE, /^\s*#?\s*ALLOWED_ORIGIN\s*=/m,
    '.env.example 里没有 ALLOWED_ORIGIN ⇒ 下次部署仍会漏配')
  assert.match(EXAMPLE, /`\*`\s*更糟|对整个互联网开放/,
    '必须明写配 `*` 等于对全互联网开放')
})

test('render.yaml 保留 ALLOWED_ORIGIN 声明与「不要填 *」的指引', () => {
  assert.match(RENDER, /- key: ALLOWED_ORIGIN/,
    'render.yaml 丢了 ALLOWED_ORIGIN 声明，部署契约不再覆盖它')
  assert.match(RENDER, /不要填 `\*`|⛔ 不要填/,
    'render.yaml 的 ALLOWED_ORIGIN 缺少「不要填 *」指引')
})
