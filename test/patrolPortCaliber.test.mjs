/**
 * r293 回归锁：patrol 引擎的端口口径必须单一、且锚定现行本地服务。
 *
 * 真缺陷（实测取证，2026-10-16，r292 只读发现 r292-P-B，r293 落地）：
 *   本地服务 2026-10-13 起重构为「计划任务 MinxueLocalServices 拉起后端 :4000
 *   + 前端 vite dev :3000」（scripts/start-local.cmd 实证；netstat 实测 :3000
 *   PID 4504 / :4000 PID 2588、无 :5173 监听），而 patrol 引擎仍探 2026-10-04
 *   之前的旧移动端 dev 端口 :5173：
 *     - 健康检查恒报 `mobile-dev DOWN(...)`；
 *     - 冒烟恒被跳过（「dev server :5173 未运行（环境未就绪）」）；
 *     - smoke.mjs 单独手跑打一台不存在的服务器。
 *   ⇒ 谁按文档手跑 patrol 都会拿到假信号（假 DOWN / 冒烟假 n/a）。
 *
 * 修法：端口口径收敛到 scripts/patrol/ports.mjs 单一实现（与 scripts/gate/base.mjs
 *   r158 同模式），patrol.mjs / smoke.mjs 都从那里取。
 *
 * ⛔ 为什么不真跑 patrol/smoke：patrol 会触发全量 npm test + vite build（写 dist/，
 *   本机 safe-delete 陷阱区），smoke 要起真 Chromium；全仓 test/ 刻意不依赖
 *   playwright。所以「口径正确」用真 import 行为断言 + 源码契约断言，
 *   反向自检用内联合成坏样本（⛔ 不 spawnSync 调 git，Windows EBUSY）。
 */
/**
 * r294 追加：旧移动端守护家族（keep_mobile_dev + :5173）复活守卫。
 *
 * 真缺陷（实测，2026-10-16，r293 接手提示①）：
 *   `scripts/dev/keep_mobile_dev.mjs` + `start_keep_mobile_dev.vbs` 守护的是
 *   2026-10-04 之前的旧移动端 dev 端口 :5173——本地服务 10-13 起重构为
 *   MinxueLocalServices 计划任务拉起 :4000/:3000 后，这套家族全线死掉：
 *     - 启动文件夹入口已不在（现存只有 minxue_keep_local_services.vbs）；
 *     - 守护日志最后写入 2026-10-08 01:00（204h 前）、pid 文件不存在 ⇒ 进程已死；
 *     - :5173 无监听（netstat 实测；若守护活着它会每 15s 拉起 vite --port 5173）；
 *     - 全仓活引用为零（仅 docs 历史记录 + 并行 WIP keep_local_services.mjs 的
 *       头注模式提及——那是设计渊源说明，不是调用）。
 *   ⇒ r294 删除两文件（A 级死代码清理）。
 *
 * 本守卫盯「别再回来」：scripts/** 下剔注释后不得再出现 keep_mobile_dev /
 * :5173 活引用（ports.mjs / patrol.mjs 头注把 5173 当反面教材是允许的——
 * 注释已剔除）。反向自检用被删文件的真实活代码行（内联合成，不依赖 git）。
 */
/**
 * r295 追加：已退役的本地服务守护家族（keep_backend + patrol daemon 自启）复活守卫。
 *
 * 真缺陷（实测，2026-10-16，r294 接手提示①）：
 *   本地服务 2026-10-13 起重构为「计划任务 MinxueLocalServices → start-local-hidden.vbs
 *   → keep_local_services.mjs 看门狗（15s 探活 :4000/:3000，失败重拉）」后，
 *   更早的两套守护全线死掉：
 *     - `scripts/dev/keep_backend.mjs`（r106 后端守护）+ `start_keep_backend.vbs：
 *       启动文件夹已无 minxue_keep_backend.vbs；pid 文件里的 PID 17236 实测不存在；
 *       日志最后写入 10-12 09:58（4 天前）⇒ 进程已死；:4000 现由看门狗看护
 *       （netstat PID 2588、/api/health ok）⇒ 无守护缺口；
 *     - `scripts/dev/start_patrol_daemon.vbs` → `scripts/patrol/daemon.mjs`：
 *       启动文件夹已无 minxue_patrol_daemon.vbs；patrol_daemon.log 最后写入
 *       10-12 10:42、docs/auto/patrol.md 冻结在 10-12 14:19 ⇒ daemon 停摆 4 天。
 *   ⇒ r295 删除三文件（A 级死代码清理；daemon.mjs 引擎本体保留为手跑工具，
 *     其自启通道随本家族退役）。
 *
 * 本守卫盯「别再回来」：scripts/** 下剔注释后不得再出现 keep_backend /
 * start_patrol_daemon 活引用（keep_local_services.mjs 头注把 keep_backend 当
 * 设计渊源提及是允许的——注释已剔除）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BACKEND_PORT,
  FRONTEND_PORT,
  BACKEND_BASE,
  FRONTEND_BASE,
} from '../scripts/patrol/ports.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATROL_DIR = join(ROOT, 'scripts', 'patrol')
const SCRIPTS_DIR = join(ROOT, 'scripts')

const read = (f) => readFileSync(join(PATROL_DIR, f), 'utf8')

/** 剔注释：注释里会引用「旧端口/旧家族」当反面教材（ports.mjs 头注就有），不能把说明文字判成违规 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/**
 * 判据集合：给定 patrol 引擎脚本源码，返回违规列表。
 * 只认三件事：① 走 ports.mjs 单一口径；② 无 5173 残留；③ 无硬编码 127.0.0.1:<port>。
 */
export function collectPortFailures(src, file) {
  const fails = []
  const body = stripComments(src)

  if (!/from\s+['"]\.\/ports\.mjs['"]/.test(body)) {
    fails.push(`${file} 未从 './ports.mjs' 取端口口径（端口字面量会各自漂移——:5173 正是这么过时的）`)
  }
  if (/5173/.test(body)) {
    fails.push(`${file} 仍探旧移动端 dev 端口 :5173（2026-10-13 起前端 vite dev 在 :3000）`)
  }
  const hard = body.match(/127\.0\.0\.1:\d+/g) || []
  if (hard.length) {
    fails.push(`${file} 仍有硬编码 127.0.0.1:<port> 字面量：${hard.join(', ')}（应收敛到 ports.mjs）`)
  }
  return fails
}

test('ports.mjs 口径锚定现行服务（后端 :4000 / 前端 vite dev :3000）', () => {
  assert.equal(BACKEND_PORT, 4000)
  assert.equal(FRONTEND_PORT, 3000)
  assert.equal(BACKEND_BASE, 'http://127.0.0.1:4000')
  assert.equal(FRONTEND_BASE, 'http://127.0.0.1:3000')
})

test('patrol.mjs 与 smoke.mjs 都走单一端口口径，且无 5173 / 硬编码端口残留', () => {
  const fails = [
    ...collectPortFailures(read('patrol.mjs'), 'patrol.mjs'),
    ...collectPortFailures(read('smoke.mjs'), 'smoke.mjs'),
  ]
  assert.deepEqual(fails, [])
})

test('反向自检：修复前的真实形状（硬编码 5173）必须判红', () => {
  // = bug 本体的行内合成（patrol.mjs 健康检查三元组 + smoke.mjs 默认 BASE）
  const oldPatrol = [
    "import { spawnLocal } from '../../server/utils/localSpawn.js'",
    "for (const [name, path] of [['server', '/api/health'], ['mobile-dev', '/']]) {",
    "  const port = name === 'server' ? 4000 : 5173",
    "  const url = `http://127.0.0.1:${port}${path}`",
    "}",
    "const s = run(process.execPath, ['smoke.mjs', 'http://127.0.0.1:5173'])",
  ].join('\n')
  const oldSmoke = "const BASE = process.argv[2] || 'http://127.0.0.1:5173'"

  const fails = [
    ...collectPortFailures(oldPatrol, 'patrol.mjs(修复前)'),
    ...collectPortFailures(oldSmoke, 'smoke.mjs(修复前)'),
  ]
  // 旧形状两个文件都要判红，且必须点名 5173（否则是空锁）
  assert.ok(fails.length >= 2, `旧形状应至少判 2 条红，实际 ${fails.length} 条：${fails.join(' / ')}`)
  assert.ok(
    fails.some((f) => f.includes('5173')),
    '旧形状的红必须点名 5173（否则判据没盯住缺陷本体）'
  )
})

// ─────────────────────────────────────────────────────────────
// r294：旧移动端守护家族复活守卫（keep_mobile_dev + :5173）
// ─────────────────────────────────────────────────────────────

/** 剔注释扩版：JS 块/行注释 + VBS/CMD 单引号注释 + REM/:: 行（守护脚本三类注释都要覆盖） */
const stripAllComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]*'.*$/gm, '')
    .replace(/^[ \t]*(rem\b|::).*$/gim, '')

/** 活引用候选扩展名（scripts/ 下可能藏旧家族的文件类型） */
const LIVE_EXTS = new Set(['.mjs', '.js', '.cjs', '.vbs', '.cmd', '.json'])

/**
 * 判据集合：给定 [文件, 源码] 列表，返回「旧移动端守护家族活引用」违规列表。
 * 只认两件事：① keep_mobile_dev 令牌；② :5173 端口字面量（剔注释后）。
 */
export function collectStaleFamilyRefs(files) {
  const fails = []
  for (const [file, src] of files) {
    const body = stripAllComments(src)
    if (/keep_mobile_dev/.test(body)) {
      fails.push(`${file} 仍引用已删除的旧移动端守护 keep_mobile_dev（:5173 家族，r294 清理）`)
    }
    if (/5173/.test(body)) {
      fails.push(`${file} 仍有活 :5173 引用（旧移动端 dev 端口；现行前端 vite dev 在 :3000，口径见 scripts/patrol/ports.mjs）`)
    }
    // ── r295：退役守护家族（keep_backend + patrol daemon 自启）──
    // 令牌 keep_backend 同时覆盖 start_keep_backend（子串）。
    // patrol daemon 禁的是**路径形态** patrol/daemon.mjs（两种斜杠）——被删的
    //   start_patrol_daemon.vbs 活代码行正是 `node scripts\patrol\daemon.mjs`；
    // ⚠️ 不能禁裸 patrol_daemon：patrol/daemon.mjs 引擎本体保留（手跑工具），
    //   其活代码行 logs/patrol_daemon.pid 含该子串（daemon.mjs 头注的自述跑法
    //   在块注释里，已被剔除，不误伤）。
    if (/keep_backend/.test(body)) {
      fails.push(`${file} 仍引用已删除的后端守护 keep_backend（r106 家族，r295 清理；现行看门狗 = keep_local_services.mjs）`)
    }
    if (/patrol[\\/]daemon\.mjs/.test(body)) {
      fails.push(`${file} 仍引用已退役的 patrol daemon 目标 scripts/patrol/daemon.mjs（10-12 起停摆，r295 清理其自启 vbs；引擎本体保留为手跑工具，禁的是 scripts/** 里的活引用）`)
    }
  }
  return fails
}

/** 递归枚举 scripts/ 下活引用候选文件，返回 [相对路径, 源码] */
function listScriptFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      listScriptFiles(full, base, out)
      continue
    }
    const dot = entry.name.lastIndexOf('.')
    const ext = dot === -1 ? '' : entry.name.slice(dot)
    if (!LIVE_EXTS.has(ext)) continue
    out.push([full.slice(base.length + 1).replaceAll('\\', '/'), readFileSync(full, 'utf8')])
  }
  return out
}

test('scripts/** 无退役守护家族活引用（keep_mobile_dev / :5173 随 r294，keep_backend / start_patrol_daemon 随 r295 清零）', () => {
  const fails = collectStaleFamilyRefs(listScriptFiles(SCRIPTS_DIR))
  assert.deepEqual(fails, [])
})

test('反向自检：被删守护家族的真实活代码行必须判红', () => {
  // = git show HEAD:scripts/dev/keep_mobile_dev.mjs 的活代码行（2026-10-08 dbc8c1a，r294 删除）
  const oldDaemon = [
    "const HEALTH_URL = 'http://127.0.0.1:5173'",
    "const VITE_CMD = ['node_modules/vite/bin/vite.js', '--port', '5173', '--host']",
    "console.log(`keep_mobile_dev 已在运行（PID ${old}），本实例退出`)",
  ].join('\n')
  const fails = collectStaleFamilyRefs([['keep_mobile_dev.mjs(修复前)', oldDaemon]])
  assert.ok(fails.length >= 2, `旧家族活代码应至少判 2 条红，实际 ${fails.length} 条：${fails.join(' / ')}`)
  assert.ok(
    fails.some((f) => f.includes('keep_mobile_dev')),
    '旧家族的红必须点名 keep_mobile_dev（否则判据没盯住缺陷本体）'
  )
  assert.ok(
    fails.some((f) => f.includes('5173')),
    '旧家族的红必须点名 5173（否则判据没盯住缺陷本体）'
  )
})

// ─────────────────────────────────────────────────────────────
// r295：退役守护家族（keep_backend + patrol daemon 自启）复活守卫
// ─────────────────────────────────────────────────────────────

test('反向自检：r295 被删三文件的真实活代码行必须判红', () => {
  // = git show HEAD: 导出件 logs/_r295_reverse/ 的活代码行（r295 删除）
  //   keep_backend.mjs（r106 后端守护，PID 17236 已死、日志冻结 10-12 09:58）
  const oldKeepBackend = [
    "const LOG = resolve(ROOT, 'server/scripts/logs/keep_backend.log')",
    "const HEALTH_URL = 'http://127.0.0.1:4000/api/health'",
    "const PID_FILE = resolve(ROOT, 'server/scripts/logs/keep_backend.pid')",
  ].join('\n')
  //   start_keep_backend.vbs（开机自启启动器，启动文件夹已无 minxue_keep_backend.vbs）
  const oldStartKeepBackend = [
    'CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\\Minxue_App_V3 && node scripts\\dev\\keep_backend.mjs", 0, False',
  ].join('\n')
  //   start_patrol_daemon.vbs（patrol daemon 自启，停摆 4 天）
  const oldStartPatrolDaemon = [
    'CreateObject("Wscript.Shell").Run "cmd /c cd /d D:\\Minxue_App_V3 && node scripts\\patrol\\daemon.mjs >> logs\\patrol_daemon.log 2>&1", 0, False',
  ].join('\n')

  const fails = collectStaleFamilyRefs([
    ['keep_backend.mjs(修复前)', oldKeepBackend],
    ['start_keep_backend.vbs(修复前)', oldStartKeepBackend],
    ['start_patrol_daemon.vbs(修复前)', oldStartPatrolDaemon],
  ])
  assert.ok(fails.length >= 3, `r295 旧家族活代码应至少判 3 条红，实际 ${fails.length} 条：${fails.join(' / ')}`)
  assert.ok(
    fails.some((f) => f.includes('keep_backend')),
    'r295 旧家族的红必须点名 keep_backend（否则判据没盯住缺陷本体）'
  )
  assert.ok(
    fails.some((f) => f.includes('patrol/daemon.mjs')),
    'r295 旧家族的红必须点名 patrol/daemon.mjs（否则判据没盯住缺陷本体）'
  )
})
