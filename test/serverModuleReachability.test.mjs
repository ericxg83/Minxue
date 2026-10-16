/**
 * serverModuleReachability.test.mjs —— server 侧模块零引用门禁（r299）
 *
 * ⛔ 背景（本锁要堵的洞）：
 *   `src/` 有模块可达性闸（r94 起），server 侧只有路由级门禁（r219）。
 *   r297 用一次性探针扫出两个自出生起零导入方的死模块（pageRuler /
 *   figureCompleteness，已删）——探针用完即删，同类缺陷可原样复发。
 *   本锁把 r297 探针固化为常驻门禁：server 范围每个模块必须被代码语料引用，
 *   否则必须登记 HAND_RUN（含理由）。
 *
 * 反向自检全部内联合成（不依赖 git，Windows EBUSY 纪律；r210/r215/r216 惯例），
 * 另加两条「真实数据 + 合成坏样本」证明主判据真的会红、且红的时候点名。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HAND_RUN,
  SELF_FILES,
  maskComments,
  extractQuotedStrings,
  resolveSpecifier,
  scanModuleUsage,
  auditModuleUsage
} from './serverModuleReachabilityKit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REAL = scanModuleUsage(ROOT)

test('元判据：扫描真的扫到了东西（不许空跑判绿）', () => {
  // r299 实测基线：modules 187 / corpus 1338 / resolved 4042；阈值留足余量防误红
  assert.ok(REAL.modules.length >= 150, `只扫到 ${REAL.modules.length} 个 server 模块，扫描范围不对`)
  assert.ok(REAL.stats.corpusFiles >= 800, `语料只有 ${REAL.stats.corpusFiles} 个文件，扫描范围不对`)
  assert.ok(REAL.stats.resolvedSpecifiers >= 2000, `只解析出 ${REAL.stats.resolvedSpecifiers} 个路径字符串，扫描逻辑可能坏了`)
  assert.ok(REAL.modules.includes('server/services/neonService.js'), '扫描结果里没有 neonService.js，范围不对')
  assert.ok(!REAL.modules.some((m) => m.startsWith('server/scripts/')), 'server/scripts 存档区不该进候选范围')
  assert.ok(!REAL.modules.some((m) => m.startsWith('server/migrations/')), 'server/migrations 不该进候选范围')
})

test('主判据：server 侧零引用模块必须登记或接线', () => {
  const fails = auditModuleUsage({
    modules: REAL.modules,
    usage: REAL.usage,
    handRun: HAND_RUN,
    selfFiles: SELF_FILES
  })
  assert.deepEqual(fails, [], '\n- ' + fails.join('\n- '))
})

test('登记簿纪律：HAND_RUN 每条都在磁盘上、理由非空、一条一由', () => {
  assert.ok(HAND_RUN.length >= 5, `登记簿只有 ${HAND_RUN.length} 条，与 r299 回验的 9 条手跑件不符`)
  const seen = new Set()
  for (const e of HAND_RUN) {
    assert.ok(existsSync(path.join(ROOT, e.path)), `登记项 ${e.path} 不在磁盘上`)
    assert.ok(typeof e.reason === 'string' && e.reason.trim().length > 0, `登记项 ${e.path} 理由为空`)
    assert.ok(!e.reason.includes('|'), `登记项 ${e.path} 理由含 '|'`)
    assert.ok(!seen.has(e.path), `重复登记：${e.path}`)
    seen.add(e.path)
  }
})

// ────────────────────────────────────────────────────────────────────────────
// 反向自检（合成样本：证明判据既会红也会绿，且红的时候点名）
// ────────────────────────────────────────────────────────────────────────────

test('反向自检：凭空多一个零引用模块 ⇒ 必须点名判红', () => {
  const modules = [...REAL.modules, 'server/services/zzzBrandNewDead.js']
  const usage = new Map(REAL.usage)
  usage.set('server/services/zzzBrandNewDead.js', new Set())
  const fails = auditModuleUsage({ modules, usage, handRun: HAND_RUN, selfFiles: SELF_FILES })
  assert.equal(fails.length, 1, '应恰好报一条：' + JSON.stringify(fails))
  assert.match(fails[0], /zzzBrandNewDead\.js/)
})

test('反向自检：登记项凭空消失 ⇒ 必须判红（登记簿诚实性）', () => {
  const modules = REAL.modules.filter((m) => m !== 'server/migrate.js')
  const fails = auditModuleUsage({ modules, usage: REAL.usage, handRun: HAND_RUN, selfFiles: SELF_FILES })
  assert.ok(fails.some((f) => /server\/migrate\.js/.test(f) && /不在扫描范围/.test(f)), '登记项消失必须判红：' + JSON.stringify(fails))
})

test('反向自检：登记项已被接线 ⇒ 必须判红（stale 登记不许躺平）', () => {
  const usage = new Map(REAL.usage)
  usage.set('server/migrate.js', new Set(['server/index.js']))
  const fails = auditModuleUsage({ modules: REAL.modules, usage, handRun: HAND_RUN, selfFiles: SELF_FILES })
  assert.ok(fails.some((f) => /server\/migrate\.js/.test(f) && /已登记 HAND_RUN 但现在有引用了/.test(f)), 'stale 登记必须判红：' + JSON.stringify(fails))
})

test('反向自检：把登记簿里摘掉一条 ⇒ 该模块立刻判红（证明登记簿真的在兜底）', () => {
  const fails = auditModuleUsage({
    modules: REAL.modules,
    usage: REAL.usage,
    handRun: HAND_RUN.filter((e) => e.path !== 'server/migrate.js'),
    selfFiles: SELF_FILES
  })
  assert.ok(fails.some((f) => /server\/migrate\.js/.test(f) && /零引用且未登记/.test(f)), '摘掉登记必须判红：' + JSON.stringify(fails))
})

test('反向自检：自引用不算使用（模块字符串提自己不算接线）', () => {
  const modules = ['server/services/fakeSelf.js']
  const usage = new Map([['server/services/fakeSelf.js', new Set(['server/services/fakeSelf.js'])]])
  const fails = auditModuleUsage({ modules, usage, handRun: [], selfFiles: SELF_FILES })
  assert.equal(fails.length, 1)
  assert.match(fails[0], /fakeSelf\.js/)
})

test('反向自检：门禁自己的文件不算引用方（否则登记永远 stale）', () => {
  const modules = ['server/services/fakeGate.js']
  const usage = new Map([['server/services/fakeGate.js', new Set(['test/serverModuleReachability.test.mjs', 'test/serverModuleReachabilityKit.mjs'])]])
  const handRun = [{ path: 'server/services/fakeGate.js', reason: '合成样本' }]
  const fails = auditModuleUsage({ modules, usage, handRun, selfFiles: SELF_FILES })
  assert.deepEqual(fails, [], '自文件引用必须被排除：' + JSON.stringify(fails))
})

// ────────────────────────────────────────────────────────────────────────────
// 判据组件单测（掩码与路径解析——假绿家族的老窝：注释提到路径不算「有人调」）
// ────────────────────────────────────────────────────────────────────────────

test('掩码：注释里的路径字符串必须被剥掉（r234：散文引用不算调用）', () => {
  const masked = maskComments("import a from './real.js'\n// import b from './ghost.js'\n/* require('./ghost2.js') */", '.js')
  const strs = extractQuotedStrings(masked)
  assert.ok(strs.includes('./real.js'), '活代码里的引用必须保留')
  assert.ok(!strs.includes('./ghost.js'), '行注释里的路径必须被剥掉')
  assert.ok(!strs.includes('./ghost2.js'), '块注释里的路径必须被剥掉')
})

test('掩码：字符串里的 // 不是注释（URL 必须完整保留）', () => {
  const masked = maskComments('const u = "http://127.0.0.1:3000/a//b" // trailing', '.js')
  assert.ok(masked.includes('http://127.0.0.1:3000/a//b'), '字符串内容必须原样保留')
})

test('掩码：.cmd 的 REM/:: 与 .vbs 的单引号注释必须剥掉', () => {
  assert.ok(!maskComments('REM node server/migrate.js', '.cmd').includes('migrate.js'))
  assert.ok(!maskComments(':: node server/migrate.js', '.cmd').includes('migrate.js'))
  assert.ok(!maskComments("' node server/migrate.js", '.vbs').includes('migrate.js'))
  assert.ok(maskComments('node server/migrate.js', '.cmd').includes('migrate.js'))
})

test('解析：五种路径形态都能落到模块上', () => {
  const testDir = path.join(ROOT, 'test')
  const kit = path.join(ROOT, 'test', 'serverModuleReachabilityKit.mjs')
  // ① 相对带扩展名
  assert.equal(resolveSpecifier('./serverModuleReachabilityKit.mjs', testDir, ROOT), kit)
  // ② 相对无扩展名（CJS require 形态）
  assert.equal(resolveSpecifier('./serverModuleReachabilityKit', testDir, ROOT), kit)
  // ③ 仓库根相对
  assert.equal(resolveSpecifier('test/serverModuleReachabilityKit.mjs', testDir, ROOT), kit)
  // ④ 目录导入解析到 index
  const dslIndex = path.join(ROOT, 'server', 'utils', 'geom', 'dsl', 'index.js')
  assert.equal(resolveSpecifier('server/utils/geom/dsl', testDir, ROOT), dslIndex)
  // ⑤ spawn/CLI 形态：node 前缀 + 反斜杠（.cmd 世界）
  const indexJs = path.join(ROOT, 'server', 'index.js')
  assert.equal(resolveSpecifier('node server/index.js', testDir, ROOT), indexJs)
  assert.equal(resolveSpecifier('node server\\index.js', testDir, ROOT), indexJs)
})

test('解析：包名/node: 前缀/空串不是模块路径', () => {
  const testDir = path.join(ROOT, 'test')
  assert.equal(resolveSpecifier('express', testDir, ROOT), null)
  assert.equal(resolveSpecifier('node:fs', testDir, ROOT), null)
  assert.equal(resolveSpecifier('dotenv/config', testDir, ROOT), null)
  assert.equal(resolveSpecifier('node_modules/foo/bar.js', testDir, ROOT), null)
  assert.equal(resolveSpecifier('', testDir, ROOT), null)
  assert.equal(resolveSpecifier('a\nb.js', testDir, ROOT), null)
})

test('反向自检：真实数据 + 合成死模块（主判据在真实树上会红且点名）', () => {
  const modules = [...REAL.modules, 'server/utils/zzzReverseCheckDead.js']
  const usage = new Map(REAL.usage)
  usage.set('server/utils/zzzReverseCheckDead.js', new Set())
  const fails = auditModuleUsage({ modules, usage, handRun: HAND_RUN, selfFiles: SELF_FILES })
  assert.equal(fails.length, 1, '应恰好报一条：' + JSON.stringify(fails))
  assert.match(fails[0], /zzzReverseCheckDead\.js/)
})
