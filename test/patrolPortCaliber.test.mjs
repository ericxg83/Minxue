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
import { readFileSync } from 'node:fs'
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

const read = (f) => readFileSync(join(PATROL_DIR, f), 'utf8')

/** 剔注释：注释里会引用「旧端口」当反面教材（ports.mjs 头注就有），不能把说明文字判成违规 */
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
