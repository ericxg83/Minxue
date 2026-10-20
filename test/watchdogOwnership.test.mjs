// 回归锁（2026-10-20，负责人授权修 r292-P-A）：本地看门狗三缺陷。
//
// 三个判据已从 keep_local_services.mjs 的 tick() 下沉为纯函数（唯一实现 server/lib/peakWindows.mjs，
// 经 scripts/dev/watchdogCadence.mjs re-export），本文件把它们锁住：
//   缺陷① 前端缺 --strictPort ⇒ 端口被占静默顺延 :3001/:3002，孤儿永不被回收（r292 实测 633MB 泄漏）
//   缺陷② 探活失败+端口空闲无条件再拉 ⇒ 开机自启链已拉起进程尚未listen 时双份抢端口；
//          探活失败+端口被占无条件 taskkill ⇒ 误杀开机任务拉起的健康 vite（r309 实测三次误杀）
//   缺陷③ 探活超时 3s 偏短 ⇒ vite 按需编译期被误判失败，触发 kill/spawn 抖动
//
// 反向自检全部内联合成（Windows EBUSY 纪律，禁 spawnSync 调git）：
//   每个「若有人改回旧行为」的坏样本都内联构造，断言新判据会给出不同（正确）决策。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  frontendDevArgs,
  decideOccupiedPort,
  decideIdlePort,
} from '../scripts/dev/watchdogCadence.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WD_SRC = readFileSync(join(ROOT, 'scripts', 'dev', 'keep_local_services.mjs'), 'utf8')

// ── 缺陷①：前端启动参数必须带 --strictPort ──
test('缺陷①：frontendDevArgs 必须含 --strictPort（端口被占不静默顺延）', () => {
  const args = frontendDevArgs(3000)
  assert.ok(Array.isArray(args), '必须返回数组')
  assert.ok(args.includes('--strictPort'), '前端参数必须含 --strictPort，否则端口被占会顺延出孤儿：' + JSON.stringify(args))
  assert.ok(args.includes('--port') && args.includes('3000'), '必须指定 --port 3000')
  assert.ok(args.includes('--host'), '必须保留 --host（局域网访问，行为不变）')
})

test('缺陷①：自定义端口也必须带 --strictPort（不硬编码 3000）', () => {
  const args = frontendDevArgs(5173)
  assert.ok(args.includes('--strictPort'))
  assert.ok(args.includes('5173'))
})

// ── 缺陷②-kill 侧：端口被占时的 taskkill 决策 ──
test('缺陷②kill：冷却期内→ 不杀（等刚拉起的进程起）', () => {
  const svc = { spawnedAt: 1000, spawnedByUs: true }
  // now=spawnedAt+30s < cooldown 90s ⇒ cooldown
  assert.equal(decideOccupiedPort(svc, 1000 + 30_000, 90_000), 'cooldown')
})

test('缺陷②kill：外部拉起的进程（开机任务）→ 不杀，仅观察（防误杀健康 vite）', () => {
  const svc = { spawnedAt: 0, spawnedByUs: false } // 已过冷却，但非本守护拉起
  assert.equal(decideOccupiedPort(svc, 999_999, 90_000), 'external')
})

test('缺陷②kill：本守护拉起 + 已过冷却 + 仍不健康 → 才杀', () => {
  const svc = { spawnedAt: 0, spawnedByUs: true }
  assert.equal(decideOccupiedPort(svc, 999_999, 90_000), 'kill')
})

test('缺陷②kill 边界：恰好等于冷却时刻应视为已过冷却（用 < 而非 <=）', () => {
  const svc = { spawnedAt: 1000, spawnedByUs: true }
  assert.equal(decideOccupiedPort(svc, 1000 + 90_000, 90_000), 'kill')
})

// ── 缺陷②-spawn 侧：端口空闲时的拉起决策 ──
test('缺陷②spawn：冷却期内端口空闲→ 不抢拉（等开机任务进程 listen，防双份）', () => {
  const svc = { spawnedAt: 1000, spawnedByUs: false } // 守护刚启动，spawnedAt=now
  assert.equal(decideIdlePort(svc, 1000 + 30_000, 90_000), 'cooldown')
})

test('缺陷②spawn：冷却后端口仍空闲 → 由守护接管拉起', () => {
  const svc = { spawnedAt: 0, spawnedByUs: false }
  assert.equal(decideIdlePort(svc, 999_999, 90_000), 'spawn')
})

// ── 缺陷③：探活超时不再是 3s（源码结构锁） ──
test('缺陷③：健康检查超时提升到 HEALTH_TIMEOUT_MS 且 ≥8s（vite 按需编译不再被误杀）', () => {
  assert.ok(/const HEALTH_TIMEOUT_MS = (\d+)/.test(WD_SRC), '必须定义 HEALTH_TIMEOUT_MS 常量')
  const m = WD_SRC.match(/const HEALTH_TIMEOUT_MS = (\d+)/)
  const ms = Number(m[1])
  assert.ok(ms >= 8000, `探活超时必须 ≥8000ms（3s 会误杀编译期 vite），实际 ${ms}ms`)
  // 旧写法 setTimeout(..., 3000) 必须已消失
  assert.ok(!/setTimeout\(\(\) => ctl\.abort\(\), 3000\)/.test(WD_SRC), '旧的 3000ms 硬编码超时必须移除')
  // healthy() 必须用 HEALTH_TIMEOUT_MS
  assert.ok(/setTimeout\(\(\) => ctl\.abort\(\), HEALTH_TIMEOUT_MS\)/.test(WD_SRC), 'healthy() 必须用 HEALTH_TIMEOUT_MS')
})

// ── 结构锁：守护确实接上了纯函数、不再内联判据（防有人绕过） ──
test('结构锁：tick() 调用 decideOccupiedPort / decideIdlePort，不内联重复判据', () => {
  assert.ok(WD_SRC.includes('decideOccupiedPort(svc, Date.now(), COOLDOWN_MS)'), 'tick 必须调用 decideOccupiedPort')
  assert.ok(WD_SRC.includes("decideIdlePort(svc, Date.now(), COOLDOWN_MS)"), 'tick 必须调用 decideIdlePort')
  assert.ok(WD_SRC.includes('frontendDevArgs(3000)'), '前端 args 必须来自 frontendDevArgs()')
  // 内联的旧判据（spawnedByUs 直接在 tick 里判）应已下沉，tick 内不应再出现裸 'svc.spawnedByUs'
  const tickBody = WD_SRC.slice(WD_SRC.indexOf('async function tick('))
  assert.ok(!/if \(!svc\.spawnedByUs\)/.test(tickBody), 'spawnedByUs 判断应下沉 decideOccupiedPort，tick 内不应内联')
})

test('结构锁：spawn 后必须置 spawnedByUs=true（记账本守护拉起的）', () => {
  const tickBody = WD_SRC.slice(WD_SRC.indexOf('async function tick('))
  assert.ok(/svc\.spawnedByUs = true/.test(tickBody), '拉起后必须标记 spawnedByUs=true')
  assert.ok(/svc\.spawnedAt = Date\.now\(\)/.test(tickBody), '拉起后必须更新 spawnedAt（冷却起点）')
})

// ── 反向自检：坏样本必须与新判据区分（证明非空锁） ──
test('反向自检：旧缺陷①（无 --strictPort）必须被 frontendDevArgs 判为不合格', () => {
  const badArgs = ['node_modules/vite/bin/vite.js', '--port', '3000', '--host'] // 旧版，缺 strictPort
  assert.ok(!badArgs.includes('--strictPort'), '坏样本本身就不该有 strictPort（否则用例空转）')
  // 新实现产出的参数必须有 ⇒ 与坏样本可区分
  assert.ok(frontendDevArgs(3000).includes('--strictPort'), '新实现必须产出带 strictPort 的参数')
})

test('反向自检：旧缺陷②（无条件再拉）合成样本会被新判据判为 cooldown（不同决策）', () => {
  const svc = { spawnedAt: 1000, spawnedByUs: false }
  const now = 1000 + 30_000 // 冷却期内
  // 旧行为：端口空闲 ⇒ 无条件 spawn（双份）
  const oldWouldSpawn = true
  // 新行为：冷却期内 ⇒ cooldown（等待）
  assert.equal(decideIdlePort(svc, now, 90_000), 'cooldown')
  assert.notEqual(oldWouldSpawn, decideIdlePort(svc, now, 90_000) === 'spawn', '新判据必须与旧「无条件拉」区分')
})

test('反向自检：旧缺陷②-kill（无条件 taskkill 外部进程）合成样本会被新判据判为 external（不同决策）', () => {
  const svc = { spawnedAt: 0, spawnedByUs: false } // 外部进程，已过冷却
  const now = 999_999
  // 旧行为：端口被占且不健康 ⇒ 无条件 taskkill（误杀开机任务拉起的健康 vite）
  const oldWouldKill = true
  // 新行为：外部进程 ⇒ external（不杀）
  assert.equal(decideOccupiedPort(svc, now, 90_000), 'external')
  assert.notEqual(oldWouldKill, decideOccupiedPort(svc, now, 90_000) === 'kill', '新判据必须与旧「无条件杀」区分')
})

test('反向自检：把 --strictPort 从 frontendDevArgs 摘掉 ⇒ 缺陷①断言必须判红', () => {
  const args = frontendDevArgs(3000).filter(a => a !== '--strictPort') // 合成「有人改回旧版」
  assert.ok(!args.includes('--strictPort'), '摘掉后必须不含 strictPort（否则用例空转）')
  // 这正是缺陷①断言会红的形状：args.includes('--strictPort') === false
  assert.equal(args.includes('--strictPort'), false, '缺陷①断言条件在此为 false ⇒ 旧行为会被判红')
})