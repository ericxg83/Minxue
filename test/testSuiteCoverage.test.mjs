/**
 * testSuiteCoverage.test.mjs —— 「npm test 到底覆盖了哪些测试」的门禁（r215）
 *
 * ⛔ 背景（本轮实测抓到的静默失效，比假红更危险）：
 *   2026-10-06 之前 `npm test` 的脚本是 `node --test "test/*.test.mjs"`。
 *   而仓库里实际还有 **9 个测试文件在 `server/tests/` 与 `server/utils/` 下**，
 *   它们的命名/位置都不匹配那个 glob ⇒ **从来没有被执行过，一次都没有**。
 *   - `server/utils/aiParseSelfCheck.test.js`（26 条）、`server/utils/answerConsensus.test.js`（28 条）
 *   - `server/tests/` 下 7 个 `.test.mjs`
 *   实测单独跑：8 个全绿（合计 65 条断言成立），1 红（几何赛道见下）。
 *   ⇒ 也就是说，`npm test` 报出的「全绿」里，**有 65 条断言根本没参与计算**。
 *   这类缺口的特征是**假绿**：门禁永远是绿的，因为它压根没在查。
 *
 * ⛔ 第二个坑：`node --test <目录A> <目录B>` 不会递归发现测试
 *   （Node 22 实测把每个目录当成 1 个 entry 跑，报 `not ok 1 - server\\tests`）。
 *   所以「写成两个目录参数」是不行的，必须**显式列出文件**。
 *   ⇒ 显式清单的代价就是：以后往 server/tests 加测试，本锁必须同步。这就是锁它的理由。
 *
 * 已知未纳入（**显式白名单，不是静默漏掉**）：
 *   `server/tests/figureRegionRefiner.test.mjs` —— 实测 18 通过 / 1 失败
 *   （「大框跨到隔壁（保住模型框完整覆盖）」判红）。
 *   该失败命中 `server/utils/figureRegionRefiner.js`，属 **几何配图与重绘管线**赛道
 *   （见 docs/auto/lanes.md 已认领表），本轮只取证未擅改，登记为 backlog 提案 ㊱。
 *   几何赛道修好后应把它加进 MUST_COVER —— 那时本锁会自动要求同时清掉 EXCLUDED（见判据）。
 *
 * ⛔ r216 补的第二层（同一缺陷的复发口，比上面那层更隐蔽）：
 *   r215 的 `auditCoverage()` 只能证明「清单里写的文件确实在清单里」——
 *   **它看不见磁盘上多出来的文件**。也就是说「显式清单」这个修法本身是 fail-open 的：
 *   谁往 `server/tests/` 里加一个 `foo.test.mjs`、忘了同步 `package.json`，
 *   那个文件就永远不跑，而门禁依旧全绿 —— **r215 修掉的那类缺陷可以原样复发。**
 *   本轮补 `auditTestFileDiscovery(pkgText, actualTestFiles)`：拿 fs 扫出来的**真实**清单
 *   去比对，凡是不在 MUST_COVER/EXCLUDED 里的、或 `test/` 下被主 glob 罩不到的，一律判红。
 *   判据形状（`TEST_FILE_RE` / `MAIN_GLOB_RE`）只有一份，扫描侧与审计侧共用，防两边漂移。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MUST_COVER,
  EXCLUDED,
  auditCoverage,
  auditTestFileDiscovery,
  parseTestFiles,
  TEST_FILE_RE,
  MAIN_GLOB,
  MAIN_GLOB_RE
} from './testSuiteCoverageKit.mjs'
import { runNodeScript } from '../server/utils/localSpawn.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgText = readFileSync(path.join(ROOT, 'package.json'), 'utf8')

/**
 * 扫描时**刻意跳过**的目录（每条都要有理由，不许随手加）：
 *  - `node_modules` / `server/node_modules`：第三方自带测试，不属本仓门禁
 *  - `dist` / `dist_nightly_*`：构建产物
 *  - `tmp`：临时目录
 *  - `external`：本机未跟踪的 vendored 第三方包（`git ls-files external` = 0 条）
 *  - `.` 开头（`.git` 等）与 `_` 开头（`_r*_old`、`_r*_bad` 等反向自检临时树）
 */
const SCAN_SKIP_DIR = (name) =>
  name === 'node_modules' ||
  name === 'tmp' ||
  name === 'external' ||
  name === 'dist' ||
  name.startsWith('dist_nightly') ||
  name.startsWith('.') ||
  name.startsWith('_')

function scanTestFiles(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SCAN_SKIP_DIR(ent.name)) continue
      scanTestFiles(path.join(dir, ent.name), out)
    } else if (TEST_FILE_RE.test(ent.name)) {
      out.push(path.relative(ROOT, path.join(dir, ent.name)).replace(/\\/g, '/'))
    }
  }
  return out
}

test('npm test 的覆盖清单必须锁死当前配置（假绿门禁的头号防线）', () => {
  const fails = auditCoverage(pkgText)
  assert.deepEqual(fails, [], '\n- ' + fails.join('\n- '))
})

test('磁盘上真实存在的测试文件，一个都不许漏跑（r216：堵住清单看不见新文件的那层洞）', () => {
  const actual = scanTestFiles(ROOT)
  // 自证钩子：扫描真的扫到东西了，不是空跑判绿（r215 教训：门禁永远是绿的因为它压根没在查）
  assert.ok(
    actual.length >= 200,
    `只扫到 ${actual.length} 个测试文件，明显少于真实规模 —— 扫描逻辑坏了，不许判绿`
  )
  assert.ok(actual.includes('test/testSuiteCoverage.test.mjs'), '扫描结果里没有本文件，扫描范围不对')
  const fails = auditTestFileDiscovery(pkgText, actual)
  assert.deepEqual(fails, [], '\n- ' + fails.join('\n- '))
})

for (const f of MUST_COVER) {
  test(`清单里声明的 ${f} 必须在磁盘上真实存在（改名后不许悄悄失效）`, () => {
    assert.ok(existsSync(path.join(ROOT, f)), `${f} 不在磁盘上，覆盖清单是假的`)
  })
}

test('排除白名单现状：㊱ 已关闭（r268），EXCLUDED 必须为空数组', () => {
  // 2026-10-06 r215 登记的唯一排除项 server/tests/figureRegionRefiner.test.mjs 已于 r268
  // 关闭（纳入套件 + 过期期望按 2026-09-21 产品规则改写）⇒ 白名单清空。
  // 「排除是有意为之」的证明转移到：① 本断言（白名单不许悄悄长出条目）；
  // ② auditTestFileDiscovery 对磁盘上任何未登记文件 fail-closed（上面 r216 用例盯着）；
  // ③ 新增排除必须走 backlog 提案（kit 里 EXCLUDED 的注释写着流程）。
  assert.ok(Array.isArray(EXCLUDED), 'EXCLUDED 必须是数组（r268 起从单字符串改为数组）')
  assert.deepEqual(EXCLUDED, [], '白名单必须为空：figureRegionRefiner 已进 MUST_COVER，不许再退回排除')
})

test('㊱ 闭环锁（r268）：figureRegionRefiner 必须留在覆盖清单里，且三个入口同口径', () => {
  // 防「回退」：任何人把它从 package.json / testFileList / kit 任一处置处，本条约判红。
  assert.ok(MUST_COVER.includes('server/tests/figureRegionRefiner.test.mjs'), '必须留在 MUST_COVER')
  assert.ok(!EXCLUDED.includes('server/tests/figureRegionRefiner.test.mjs'), '不许退回 EXCLUDED 白名单')
  const listed = parseTestFiles(JSON.parse(pkgText).scripts.test)
  assert.ok(listed.includes('server/tests/figureRegionRefiner.test.mjs'), 'package.json test script 里必须有它')
  assert.ok(existsSync(path.join(ROOT, 'server/tests/figureRegionRefiner.test.mjs')), '文件必须在磁盘上真实存在')
})

// ───────────────────────────────────────────────────────────────────────────
// 反向自检（内联合成坏样本，常驻在测试文件里，不依赖 git —— r210/r215 惯例）
// ⛔ 目的：证明这把新锁**既会红也会绿**，而且红的时候能点名到具体文件。
// ───────────────────────────────────────────────────────────────────────────
const REAL = scanTestFiles(ROOT)

test('反向自检：真实清单必须判绿（先证「不误报」）', () => {
  assert.deepEqual(auditTestFileDiscovery(pkgText, REAL), [])
})

test('反向自检：往 server/ 塞一个没登记的新测试文件 ⇒ 必须点名判红', () => {
  const bad = [...REAL, 'server/tests/zzzBrandNewThing.test.mjs']
  const fails = auditTestFileDiscovery(pkgText, bad)
  assert.equal(fails.length, 1, '应恰好报一条：' + JSON.stringify(fails))
  assert.match(fails[0], /zzzBrandNewThing\.test\.mjs/)
})

test('反向自检：test/ 下换了后缀（.test.js）⇒ 必须判红（glob 罩不到）', () => {
  const fails = auditTestFileDiscovery(pkgText, [...REAL, 'test/legacyStyle.test.js'])
  assert.equal(fails.length, 1)
  assert.match(fails[0], /legacyStyle\.test\.js/)
})

test('反向自检：test/ 下塞进子目录 ⇒ 必须判红（glob 只罩直下一层）', () => {
  const fails = auditTestFileDiscovery(pkgText, [...REAL, 'test/nested/deep.test.mjs'])
  assert.equal(fails.length, 1)
  assert.match(fails[0], /test\/nested\/deep\.test\.mjs/)
})

test('反向自检：扫描结果为空时不许判绿（扫描一坏就变永真门禁）', () => {
  assert.ok(auditTestFileDiscovery(pkgText, []).length > 0)
})

test('反向自检：证明 r215 的旧判据看不见「清单外的新文件」（这层洞真实存在）', () => {
  // 同一个坏样本：旧判据（只看清单自身）判绿，新判据判红。
  // 这就是本轮要堵的洞本身 —— 不是推测，是同一份输入下两套判据的分歧。
  const bad = [...REAL, 'server/tests/zzzBrandNewThing.test.mjs']
  assert.deepEqual(auditCoverage(pkgText), [], '旧判据对「清单外新文件」应当毫无反应（这正是缺陷）')
  assert.ok(auditTestFileDiscovery(pkgText, bad).length === 1, '新判据必须能看见它')
})

test('判据形状自证：MAIN_GLOB_RE 必须与 scripts.test 里那个 glob 同口径（r307：排除 _ 前缀探针）', () => {
  // 防「改了 package.json 的 glob 而本锁还在按旧形状判」——glob 与判据必须逐字对齐
  const script = JSON.parse(pkgText).scripts.test
  const m = script.match(/"(test\/[^"]*\.test\.mjs)"/)
  assert.ok(m, 'scripts.test 里必须有用引号包住的主 glob（test/...test.mjs）')
  assert.equal(m[1], MAIN_GLOB, 'scripts.test 里的主 glob 变了，MAIN_GLOB_RE/MAIN_GLOB 必须同步')
  assert.ok(MAIN_GLOB_RE.test('test/a.test.mjs'))
  assert.ok(!MAIN_GLOB_RE.test('test/_a.test.mjs'), '_ 前缀探针必须被排除（r304 探针混进套件三轮的修法）')
  assert.ok(!MAIN_GLOB_RE.test('test/a/b.test.mjs'))
  assert.ok(!MAIN_GLOB_RE.test('test/a.test.js'))
})

// ───────────────────────────────────────────────────────────────────────────
// r307 新增：主 glob 排除 `_` 前缀探针（.gitignore:140 `_*` 约定）
// 背景：r304 探针 test/_probe_mockmodule.test.mjs（gitignored 永不入库）被旧 glob
//   `test/*.test.mjs` 拾进套件，每次 npm test 都 8s 超时红（r305/r306 只读轮实证）。
//   修法 = package.json / testFileList / 本 kit 三处同口径排除 + 行为级实测锁。
// ───────────────────────────────────────────────────────────────────────────

/** 合成 glob 夹具：一个会失败的 _ 探针 + 一个会通过的普通用例（tmp/ 已 gitignore） */
function makeGlobFixture(dirName) {
  const dir = path.join(ROOT, 'tmp', dirName)
  mkdirSync(path.join(dir, 'test'), { recursive: true })
  writeFileSync(
    path.join(dir, 'test', '_probe_x.test.mjs'),
    'import { test } from "node:test"\ntest("probe must not run", () => { throw new Error("picked up") })\n'
  )
  writeFileSync(
    path.join(dir, 'test', 'normal.test.mjs'),
    'import { test } from "node:test"\ntest("normal runs", () => {})\n'
  )
  return dir
}

/**
 * 起子进程 node --test 用的环境（r307 实测）：外层 node --test 会往环境里注入
 * `NODE_TEST_CONTEXT`，子进程继承后以「node:test run() is being called recursively
 * within a test file. skipping running files.」为由**跳过执行所有文件**——status 0、
 * stdout 空，看着像跑过其实一个用例都没跑（比红更危险的假绿）。必须删掉它再起。
 */
function childTestEnv() {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return env
}

test('行为级：package.json 的主 glob 真跑 node --test 时不得拾取 _ 前缀探针（r307）', () => {
  // 这不是源码锁——真起 node 跑真 glob。旧 glob 下这个夹具必红（见下一把反向自检）。
  const dir = makeGlobFixture('_r307_globcheck')
  const glob = JSON.parse(pkgText).scripts.test.match(/"(test\/[^"]*\.test\.mjs)"/)[1]
  const r = runNodeScript(['--test', glob], { cwd: dir, env: childTestEnv() })
  try {
    assert.equal(
      r.status,
      0,
      `主 glob 拾取了 _ 探针（node --test 退出 ${r.status}）：\n${r.stdout}\n${r.stderr}`
    )
    assert.match(String(r.stdout), /normal runs/, '普通用例必须真跑（否则是空转绿）')
    assert.doesNotMatch(String(r.stdout), /probe must not run/, '_ 探针的名字不该出现在输出里')
    assert.doesNotMatch(
      String(r.stderr),
      /recursively within a test file/,
      '子进程被当成递归测试运行而跳过执行（NODE_TEST_CONTEXT 未清）——空 stdout + 退 0 是假绿'
    )
  } finally {
    // 清不掉也不许让用例红（本机 safe-delete 对目录 fail-closed，仓内惯例：tmp/ 不追清理）
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不追责，tmp/ 已 gitignore */ }
  }
})

test('反向自检：旧 glob（test/*.test.mjs）会把 _ 探针拾进套件 ⇒ 必须判红（证明上一把不是空锁）', () => {
  const dir = makeGlobFixture('_r307_globcheck_rev')
  const r = runNodeScript(['--test', 'test/*.test.mjs'], { cwd: dir, env: childTestEnv() })
  try {
    assert.notEqual(r.status, 0, '旧 glob 必须拾取 _ 探并非零退出（否则主断言是空锁）')
    assert.match(String(r.stdout), /probe must not run/, '旧 glob 的输出里必须出现被误拾的探针')
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 同上：清理失败不追责 */ }
  }
})

test('反向自检：旧 glob 文本喂给两处审计都必须判红且点名（r307 修法的结构性一面）', () => {
  const oldPkg = pkgText.replace(MAIN_GLOB, 'test/*.test.mjs')
  assert.notEqual(oldPkg, pkgText, '注入必须被证实生效（旧 glob 替换成功）')
  assert.ok(
    auditCoverage(oldPkg).some((f) => /主套件被挤没了/.test(f)),
    'auditCoverage 必须对旧 glob 判红'
  )
  assert.ok(
    auditTestFileDiscovery(oldPkg, REAL).some((f) => /主套件被挤没了/.test(f)),
    'auditTestFileDiscovery 必须对旧 glob 判红'
  )
})

test('反向自检：_ 前缀文件按约定跳过，不是「漏跑」判红（r307）', () => {
  // 真实磁盘上就有 test/_probe_mockmodule.test.mjs（gitignored 探针）——它流过
  // auditTestFileDiscovery 时必须被跳过而非判红；合成样本同理。
  const fails = auditTestFileDiscovery(pkgText, [...REAL, 'test/_syntheticProbe.test.mjs'])
  assert.deepEqual(fails, [], '_ 前缀探针必须被跳过而非判红：' + JSON.stringify(fails))
})
