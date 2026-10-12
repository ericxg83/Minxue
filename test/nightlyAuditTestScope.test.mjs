/**
 * r267 回归锁：夜间巡检的「单测全绿」必须跑的是完整清单。
 *
 * 真缺陷（实测取证，非推测，2026-10-12 17:3x）：
 *   `scripts/nightlyAudit.mjs` 的 collectTests 用 `node --test 'test/*.test.mjs'`
 *   —— glob 只展开 `test/` 目录，**漏跑 8 个 server 侧测试文件**：
 *     server/tests/{aiParseSelfCheck,figureBboxSemantics,judgeChoiceAnswer,
 *       normalizeBlockBoxSemantics,repairAIJson,uploadValidatorHeic}.test.mjs
 *     server/utils/{aiParseSelfCheck,answerConsensus}.test.js
 *   同刻对跑（managed node 22.22.2）：
 *     nightlyAudit 口径（仅 glob）      → pass 2367
 *     npm test / patrol 口径（完整清单）→ pass 2432
 *   ⇒ 65 条用例（判题语义 / AI JSON 修复 / 上传校验等核心锁）夜间审计一条都没跑，
 *   「全绿」是假绿（docs/auto/每日巡查报告.md R74 的 2315/0 结论正是被这个缺口骗的）。
 *
 * 修法：清单收敛到全仓唯一实现 `scripts/testFileList.mjs`，nightlyAudit 与
 *   patrol.mjs 都走它（patrol 旧行为本就是完整清单，改为复用后行为不变）；
 *   `npm test` 是开发者手动入口，保持 package.json 原样（被 testSuiteCoverage 锁盯着）。
 *
 * ⛔ 为什么不真跑 nightlyAudit：它是脚本，import 即执行全量 lint+test+build（分钟级）。
 *   所以「清单内容」用真 import 纯函数验证（行为用例），「两个引擎都走了它」用源码
 *   契约验证，反向自检用内联合成坏样本（不 spawnSync 调 git，Windows EBUSY）。
 *
 * r268 追加（关闭 backlog ㊱）：显式清单 8 → 9，纳入
 *   `server/tests/figureRegionRefiner.test.mjs`（2026-09-20 草稿锁，从未被任何入口
 *   执行；唯一过期期望已按 2026-09-21 产品规则改写，详见该文件头部注释与
 *   test/testSuiteCoverageKit.mjs 的 EXCLUDED 说明）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { collectTestFiles, EXTRA_SERVER_TESTS } from '../scripts/testFileList.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 磁盘上 test/ 目录真实的 .test.mjs 清单 */
const diskTestDir = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort()

/**
 * 判据集合：给定巡检引擎源码，返回违规列表。
 * 只认三件事：① import 了唯一清单模块；② 真调用 collectTestFiles(；
 * ③ 不得再出现裸 glob 'test/*.test.mjs'（它只展开 test/ 目录）。
 */
export function collectScopeFailures(src) {
  const bad = []
  if (!/from '(?:\.\/|\.\.\/)testFileList\.mjs'/.test(src)) bad.push('未 import collectTestFiles（清单必须收敛到 scripts/testFileList.mjs）')
  if (!/collectTestFiles\(/.test(src)) bad.push('未调用 collectTestFiles(')
  if (/'test\/\*\.test\.mjs'/.test(src)) bad.push("仍存在裸 glob 'test/*.test.mjs'（只展开 test/ 目录，漏 8 个 server 侧测试文件）")
  return bad
}

test('collectTestFiles 覆盖 EXTRA_SERVER_TESTS 全部 9 个 server 侧测试（且磁盘真实存在）', () => {
  const files = collectTestFiles(ROOT)
  assert.equal(EXTRA_SERVER_TESTS.length, 9, 'EXTRA_SERVER_TESTS 必须是 9 个（r268 起纳入 figureRegionRefiner，与 package.json test script 对齐）')
  for (const f of EXTRA_SERVER_TESTS) {
    assert.ok(files.includes(f), `清单缺少 ${f}`)
    assert.ok(existsSync(join(ROOT, f)), `${f} 在磁盘上不存在（清单指向了幽灵文件）`)
  }
})

test('collectTestFiles 覆盖 test/ 目录每一个 .test.mjs（现扫，新增自动纳入）', () => {
  const files = collectTestFiles(ROOT)
  for (const f of diskTestDir) {
    assert.ok(files.includes('test/' + f), `test/ 下新增的 ${f} 没进清单`)
  }
  assert.equal(files.filter((f) => f.startsWith('test/')).length, diskTestDir.length, 'test/ 部分数量与磁盘不一致')
})

test('collectTestFiles 无重复项（同一文件跑两遍会双计 pass 数、掩盖失败）', () => {
  const files = collectTestFiles(ROOT)
  assert.equal(new Set(files).size, files.length, `清单有重复：${files.filter((f, i) => files.indexOf(f) !== i).join(', ')}`)
})

test('EXTRA_SERVER_TESTS 与 package.json test script 逐字一致（防两侧漂移）', () => {
  const pkg = JSON.parse(readSrc('package.json'))
  const script = pkg.scripts?.test || ''
  for (const f of EXTRA_SERVER_TESTS) {
    assert.ok(script.includes(f), `package.json test script 里没有 ${f}（两侧清单已漂移）`)
  }
})

test('nightlyAudit.mjs 与 patrol.mjs 都必须走唯一清单实现（源码契约）', () => {
  for (const rel of ['scripts/nightlyAudit.mjs', 'scripts/patrol/patrol.mjs']) {
    const bad = collectScopeFailures(readSrc(rel))
    assert.deepEqual(bad, [], `${rel}：${bad.join('；')}`)
  }
})

test('反向自检：旧版 nightlyAudit（裸 glob、无 import）必须被判红', () => {
  const OLD = [
    "import { resolveNightlyVerdict, readTestsRun } from './nightlyAuditVerdict.mjs'",
    'function collectTests() {',
    "  const { code, out } = runNode(null, ['--test', 'test/*.test.mjs'])",
    '}'
  ].join('\n')
  const bad = collectScopeFailures(OLD)
  assert.ok(bad.length >= 2, `旧版应至少判 2 条红（无 import + 裸 glob），实际 ${bad.length} 条：${bad.join('；')}`)
  assert.ok(bad.some((b) => b.includes('testFileList')), '旧版必须因「未 import 唯一清单」判红')
  assert.ok(bad.some((b) => b.includes('glob')), '旧版必须因「裸 glob」判红')
})

test('反向自检：patrol 回退成内联清单必须被判红', () => {
  const REGRESSED = [
    "import { collectLintReport } from './lintReportKit.mjs'",
    'const testFiles = []',
    "for (const f of ['server/tests/aiParseSelfCheck.test.mjs']) testFiles.push(f)",
    "const t = run(process.execPath, ['--env-file=.env', '--test', ...testFiles])"
  ].join('\n')
  const bad = collectScopeFailures(REGRESSED)
  assert.ok(bad.some((b) => b.includes('未 import')), '回退成内联清单必须因「未 import」判红')
})
