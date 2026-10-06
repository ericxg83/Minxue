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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MUST_COVER,
  EXCLUDED,
  auditCoverage,
  auditTestFileDiscovery,
  TEST_FILE_RE,
  MAIN_GLOB_RE
} from './testSuiteCoverageKit.mjs'

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

test('已知排除项必须真实存在且只登记一条（不允许静默漏掉更多 server 侧测试）', () => {
  assert.ok(EXCLUDED.length > 0, 'EXCLUDED 常量被清空了，无法证明排除是有意为之')
  // 排除项得是真实存在的文件，别写了个不存在的路径当"已登记"
  assert.ok(existsSync(path.join(ROOT, EXCLUDED)), `${EXCLUDED} 在磁盘上不存在，白名单是假的`)
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

test('判据形状自证：MAIN_GLOB_RE 必须与 scripts.test 里那个 glob 逐字一致', () => {
  // 防止有人改了 package.json 的 glob（比如改成 test/**/*.test.mjs）而本锁还在按旧形状判
  const script = JSON.parse(pkgText).scripts.test
  const glob = script.match(/"[^"]*test[^"]*\.test\.mjs"|test\/\*\.test\.mjs/)[0].replace(/"/g, '')
  assert.equal(glob, 'test/*.test.mjs', 'scripts.test 里的主 glob 变了，MAIN_GLOB_RE 必须同步')
  assert.ok(MAIN_GLOB_RE.test('test/a.test.mjs'))
  assert.ok(!MAIN_GLOB_RE.test('test/a/b.test.mjs'))
  assert.ok(!MAIN_GLOB_RE.test('test/a.test.js'))
})
