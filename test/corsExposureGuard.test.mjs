// CORS 配置安全锁（第 13 轮）
//
// 背景：2026-10-04 实测发现生产 CORS 是 `*`（任意来源都被 echo 允许），
// 且 API 完全没有鉴权 ⇒ 任何人可读全部学生姓名/年级/错题数。
// 根因之一是 server/.env.example 里**根本没写 ALLOWED_ORIGIN**，
// 于是部署时没人知道要配，配错了也不报错（代码兜底是 localhost 白名单，静默降级）。
//
// 本锁守两条底线：
//   ① 代码里的兜底白名单不得包含 `*`（代码永远不该默认全开）
//   ② .env.example 必须记录 ALLOWED_ORIGIN 并写清后果（防止下次部署再漏）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = readFileSync(path.join(ROOT, 'server/index.js'), 'utf8')
const EXAMPLE = readFileSync(path.join(ROOT, 'server/.env.example'), 'utf8')

test('CORS 兜底白名单不得包含 *（代码永远不能默认对全互联网开放）', () => {
  const m = INDEX.match(/allowedOrigins\s*=\s*process\.env\.ALLOWED_ORIGIN[\s\S]{0,400}?\]/)
  assert.ok(m, '未找到 allowedOrigins 定义，结构变了请同步本锁')
  assert.doesNotMatch(m[0], /['"]\*['"]/,
    '代码兜底里出现了 * ⇒ 一旦环境变量缺失/拼错就是全网开放，且不会有任何报错')
})

test('ALLOWED_ORIGIN 未配置时的兜底必须是 localhost 白名单（而非空/全开）', () => {
  const m = INDEX.match(/allowedOrigins\s*=\s*process\.env\.ALLOWED_ORIGIN[\s\S]{0,400}?\]/)
  assert.ok(m)
  assert.match(m[0], /localhost/,
    '兜底必须至少包含 localhost，否则本地开发会被自己的后端 CORS 拦掉')
})

test('.env.example 必须记录 ALLOWED_ORIGIN（2026-10-04 就是漏在这里）', () => {
  assert.match(EXAMPLE, /^\s*#?\s*ALLOWED_ORIGIN\s*=/m,
    '.env.example 里没有 ALLOWED_ORIGIN ⇒ 下次部署仍会漏配，且是静默失败')
})

test('.env.example 的 CORS 段必须写清「配 * 的后果」', () => {
  assert.match(EXAMPLE, /生产必填/,
    'CORS 段缺少「生产必填」标记，容易被当成可选项')
  assert.match(EXAMPLE, /`\*`\s*更糟|对整个互联网开放/,
    '必须明写「配成 * 等于对整个互联网开放」，否则没人知道这条路不能走')
  assert.match(EXAMPLE, /静默降级/,
    '必须说明「不配 ALLOWED_ORIGIN」是静默降级（后端日志全 200 但前端报网络错误），'
    + '这是最难排查的一类故障')
})

test('不得引入「默认全开」的新写法（如 process.env.ALLOWED_ORIGIN \|\| "*"）', () => {
  assert.doesNotMatch(INDEX, /ALLOWED_ORIGIN\s*\|\|\s*['"]\*['"]/,
    '出现了 || "*" 兜底 ⇒ 漏配环境变量时静默变成全网开放')
  assert.doesNotMatch(INDEX, /ALLOWED_ORIGIN\s*\?\?\s*['"]\*['"]/,
    '出现了 ?? "*" 兜底 ⇒ 同上')
})
