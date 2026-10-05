/**
 * r158 回归锁：闸门脚本的「审计目标（BASE）」必须只有一个解析口径。
 *
 * 真缺陷（实测取证，非推测，2026-10-05）：
 *   BASE=http://127.0.0.1:5999 node scripts/gate/overflow_audit.mjs
 *   → 实测仍请求 http://127.0.0.1:5235/...   （漏了 process.env.BASE）
 *   对照组：text_audit / route_sweep 同命令均正确请求 5999。
 * 5235 恰是历史上放陈旧 preview 的端口 ⇒ 「审计了另一台服务器」，
 * 空页面没有横向溢出 ⇒ 打印 0/14 全绿，**假绿**（比假红危险）。
 * 同时 5 个脚本默认端口互不相同（5227 / 5234 / 5235），也是同一个「跑错端口」隐患。
 *
 * 修法：默认值与解析顺序收敛到 `scripts/gate/base.mjs` 一处
 * （argv[2] > env BASE > 统一默认），并回显审计目标。
 *
 * ⛔ 为什么这里不真跑闸门脚本：它们都要起真 Chromium（单脚本 ~35s），
 *   且全仓 `test/` 刻意不依赖 playwright（浏览器检查留在闸门侧）。
 *   所以「解析逻辑」用真 import 纯函数验证（下面的行为用例），
 *   「每个脚本都用了它」用源码契约验证，反向自检用内联合成坏样本（不 spawnSync git，Windows EBUSY）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveBase,
  gateBase,
  DEFAULT_BASE,
  DEFAULT_GATE_PORT,
} from '../scripts/gate/base.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_DIR = join(ROOT, 'scripts/gate')

/** 除 base.mjs 自身外，scripts/gate 下所有闸门脚本 */
const GATE_SCRIPTS = readdirSync(GATE_DIR)
  .filter((f) => f.endsWith('.mjs') && f !== 'base.mjs')
  .sort()

/** 修复前的真实形状（= bug 本身），仅用于反向自检 */
const OLD_OVERFLOW_LINE =
  "/** r108 布局溢出审计 */\nimport { chromium } from 'playwright'\n" +
  "const BASE = process.argv[2] || 'http://127.0.0.1:5235'\n"

/**
 * 判据集合：给定闸门脚本源码，返回违规列表。
 * 只认两件事：① 走统一解析器；② 不得再硬编码 127.0.0.1:<port> 字面量。
 */
export function collectBaseFailures(src) {
  const fails = []
  // 先剔注释：注释里会引用「旧写法」当反面教材（r158 就在 overflow_audit 里留了一行），
  // 不能把说明文字当违规代码 —— r148 / r152 的锁都踩过这个坑。
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  if (!/from\s+['"]\.\/base\.mjs['"]/.test(body)) {
    fails.push("未从 './base.mjs' 引入 BASE 解析器（端口口径会各自漂移）")
  }
  const hard = body.match(/127\.0\.0\.1:\d+/g) || []
  if (hard.length) {
    fails.push(`硬编码了审计地址字面量 ${hard.join(', ')}（应只留在 base.mjs）`)
  }
  return fails
}

// ───────────────────── ① 行为：解析顺序 argv > env > 默认 ─────────────────────

test('argv[2] 优先于 env BASE 与默认值', () => {
  const r = resolveBase(['node', 'x.mjs', 'http://127.0.0.1:6001'], { BASE: 'http://127.0.0.1:6002' })
  assert.equal(r.base, 'http://127.0.0.1:6001')
  assert.equal(r.source, 'argv')
})

test('无 argv 时 env BASE 生效（这正是 overflow_audit 修复前漏掉的那条）', () => {
  const r = resolveBase(['node', 'x.mjs'], { BASE: 'http://127.0.0.1:6002' })
  assert.equal(r.base, 'http://127.0.0.1:6002')
  assert.equal(r.source, 'env BASE')
})

test('argv 与 env 都没有时回落到唯一默认值', () => {
  const r = resolveBase(['node', 'x.mjs'], {})
  assert.equal(r.base, DEFAULT_BASE)
  assert.equal(r.source, '默认值')
  assert.equal(DEFAULT_GATE_PORT, 5227, '统一默认端口应是文档化的 5227')
  assert.equal(DEFAULT_BASE, 'http://127.0.0.1:5227')
})

test('gateBase() 回显审计目标（跑错端口必须一眼可见）', () => {
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  let base
  try {
    base = gateBase(['node', 'x.mjs'], { BASE: 'http://127.0.0.1:6003' })
  } finally {
    console.log = orig
  }
  assert.equal(base, 'http://127.0.0.1:6003')
  assert.equal(logs.length, 1, 'gateBase 必须且只打印一行')
  assert.match(logs[0], /http:\/\/127\.0\.0\.1:6003/, '回显里必须带上实际审计目标')
  assert.match(logs[0], /env BASE/, '回显里必须说明来源')
})

// ───────────────────── ② 源码契约：scripts/gate 下人人走统一解析器 ─────────────────────

test('⛔ scripts/gate 下每个闸门脚本都走 base.mjs，且无硬编码地址（当前树零违规）', () => {
  assert.ok(GATE_SCRIPTS.length >= 5, `闸门脚本数量异常：${GATE_SCRIPTS.length}`)
  for (const f of GATE_SCRIPTS) {
    const p = join(GATE_DIR, f)
    assert.ok(existsSync(p), `${f} 不见了`)
    const fails = collectBaseFailures(readFileSync(p, 'utf8'))
    assert.deepEqual(fails, [], `\nscripts/gate/${f} 端口口径违规：\n` + fails.map((x) => `  - ${x}`).join('\n'))
  }
})

test('锁健全性：五个已知闸门脚本都在清单里（防新增脚本漏检）', () => {
  for (const f of ['cert_probe.mjs', 'render_smoke.mjs', 'route_sweep.mjs', 'text_audit.mjs', 'overflow_audit.mjs']) {
    assert.ok(GATE_SCRIPTS.includes(f), `${f} 不在受检清单里，锁形同虚设`)
  }
})

// ───────────────────── ③ 反向自检（防空锁 / 防永远判红） ─────────────────────

test('锁健全性：判据套「修复前」坏样本必须判红（不依赖 git）', () => {
  const probe = collectBaseFailures(OLD_OVERFLOW_LINE)
  assert.ok(probe.length >= 1, `判据套修复前坏样本应报 ≥1 处，实际 ${probe.length} —— 锁可能是空锁`)
  assert.ok(
    probe.some((x) => /未从 '\.\/base\.mjs'/.test(x)),
    '坏样本必须命中「没走统一解析器」这条判据',
  )
  assert.ok(
    probe.some((x) => /硬编码了审计地址/.test(x)),
    '坏样本必须命中「硬编码地址」这条判据（旧写法确实写死了 5235）',
  )
})

test('锁健全性：判据不得误伤修复后的正确写法（防「永远判红」）', () => {
  const good = "import { gateBase } from './base.mjs'\nconst BASE = gateBase()\n"
  assert.deepEqual(collectBaseFailures(good), [], '正确写法必须判绿')

  // 注释里出现旧写法（当反面教材）不得被误判 —— r158 就是这么写的
  const withComment =
    "import { gateBase } from './base.mjs'\n" +
    "// 原为 process.argv[2] || 'http://127.0.0.1:5235'，漏了 env BASE\n" +
    'const BASE = gateBase()\n'
  assert.deepEqual(collectBaseFailures(withComment), [], '注释里的旧写法不得误伤')
})
