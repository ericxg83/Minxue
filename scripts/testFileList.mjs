/**
 * 单元测试文件清单（全仓唯一实现）
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这个（r267，2026-10-12 实测）：
 *   `nightlyAudit.mjs` 的 collectTests 用 node --test 后接裸 glob（只展开 test/ 目录）
 *   **漏掉 8 个 server 侧测试文件**（判题语义 / AI JSON 修复 / 上传校验等 65 条用例）⇒ 夜间审计报「单测全绿」时那 65 条一条都没跑
 *   （实测同刻：nightlyAudit 口径 2367 vs patrol / npm test 口径 2432）。
 *   而 patrol.mjs 与 package.json 的 `npm test` 用的本来就是完整清单 ⇒ 三处口径漂移。
 *   本模块把清单收敛成一处，patrol / nightlyAudit 都走它；`npm test` 是开发者
 *   手动入口，保持 package.json 原样（被 testSuiteCoverage 锁盯着，不反复改）。
 *   ⏳ 后记（2026-10-13，㊲）：nightlyAudit.mjs 本体已随健康脚本家族删除
 *   （负责人批复「取消」），现在本清单的唯一消费者是 patrol.mjs；
 *   本模块保留——它是 r267 假绿事故的产物，也是测试口径的唯一实现。
 *
 * 与磁盘的关系：`test/` 目录每次现扫（新增 .test.mjs 自动纳入）；
 *   9 个 server 侧文件是显式清单（它们在 test/ 之外，glob 表达不了）。
 *   ⚠️ test/ 下只收 `.test.mjs`——与 package.json 的 `test/*.test.mjs` 同口径，
 *   `.test.js` 在 test/ 下没有先例；server 侧那两个 .test.js 在显式清单里点名。
 *
 * r268 变更（关闭 backlog ㊱）：显式清单 8 → 9，纳入
 *   `server/tests/figureRegionRefiner.test.mjs`（2026-09-20 草稿锁，一直没被任何
 *   入口执行；其唯一过期期望已按 2026-09-21 产品规则改写，详见该文件头部注释）。
 */
import fs from 'node:fs'
import path from 'node:path'

/** test/ 目录之外、glob 覆盖不到的 server 侧测试（与 package.json test script 逐字一致） */
export const EXTRA_SERVER_TESTS = [
  'server/tests/aiParseSelfCheck.test.mjs',
  'server/tests/figureBboxSemantics.test.mjs',
  'server/tests/figureRegionRefiner.test.mjs',
  'server/tests/judgeChoiceAnswer.test.mjs',
  'server/tests/normalizeBlockBoxSemantics.test.mjs',
  'server/tests/repairAIJson.test.mjs',
  'server/tests/uploadValidatorHeic.test.mjs',
  'server/utils/aiParseSelfCheck.test.js',
  'server/utils/answerConsensus.test.js'
]

/**
 * 返回完整测试文件清单（相对 root 的 POSIX 风格路径）。
 * 目录读失败时只保留显式清单——与 patrol.mjs 旧行为一致（try/catch 不抛）。
 */
export function collectTestFiles(root) {
  const files = []
  try {
    for (const f of fs.readdirSync(path.join(root, 'test'))) {
      if (f.endsWith('.test.mjs')) files.push('test/' + f)
    }
  } catch {}
  for (const f of EXTRA_SERVER_TESTS) files.push(f)
  return files
}
