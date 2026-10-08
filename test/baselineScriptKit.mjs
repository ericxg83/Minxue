// 反向自检基线快照的「舞台」（2026-10-08 r242 抽）
//
// 背景：体检脚本的反向自检要跑**修复前的旧脚本**，此前做法是
// `git show <提交>:scripts/healthcheck.mjs > scripts/_rNNN_old_healthcheck.mjs`，「跑完即删」。
// ⛔ 那个「跑完即删」害了四条锁：探针文件早就不在磁盘上 ⇒ 对应用例一直 `t.skip`，
// 而 skip 会被当成"验过"（r215 教训）⇒ 这些反向自检连续多轮空转（假绿家族）。
//
// 现在的做法：基线快照**随仓库入库**（test/fixtures/healthcheck-baseline-<提交>.mjs），
// 由本工具 stage 成一个能独立跑的临时目录。
//
// ⛔ 为什么必须 stage、不能直接跑 test/fixtures/ 下那份：这些基线脚本
// `import { resolveDiskState } from './healthDiskState.mjs'` —— 只把快照单独放 fixtures 里会
// MODULE_NOT_FOUND（r242 实测：三条反向自检红在「旧脚本没输出这一项」，而真实病因是脚本压根没起来，
// 错误信息还看不出来）。把 healthDiskState.mjs 一起带进临时目录即可。
//
// ⛔ 也**不能**把基线与 `scripts/` 里的相对依赖放成 `_` 前缀文件：eslint 的 `**/_*` 会整段忽略它，
// 而且下轮巡检会把它当成"一次性排障产物"顺手删掉 ⇒ 又回到 skip。所以基线走 test/fixtures/。

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
/** 基线脚本会 import 的同目录相对依赖（当前基线只有这一个；以后新增基线若换了依赖，这里补） */
const BASELINE_SIBLINGS = ['healthDiskState.mjs']

/**
 * 把一份基线快照 stage 成可执行的脚本路径。
 * @param {string} fixturePath test/fixtures/healthcheck-baseline-<提交>.mjs 的绝对路径
 * @returns {{ scriptPath: string, cleanup: () => void }}
 */
export function stageBaselineScript(fixturePath) {
  const dir = mkdtempSync(join(tmpdir(), 'minxue-baseline-'))
  for (const name of BASELINE_SIBLINGS) {
    cpSync(resolve(ROOT, 'scripts', name), join(dir, name))
  }
  writeFileSync(join(dir, 'healthcheck.mjs'), readFileSync(fixturePath))
  return {
    scriptPath: join(dir, 'healthcheck.mjs'),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}
