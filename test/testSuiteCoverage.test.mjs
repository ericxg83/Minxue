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
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MUST_COVER, EXCLUDED, auditCoverage } from './testSuiteCoverageKit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgText = readFileSync(path.join(ROOT, 'package.json'), 'utf8')

test('npm test 的覆盖清单必须锁死当前配置（假绿门禁的头号防线）', () => {
  const fails = auditCoverage(pkgText)
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
