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

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
/**
 * 基线脚本的暂存布局（r248 定）：
 *   <tmp>/probe/healthcheck.mjs          ← 快照本身
 *   <tmp>/probe/healthDiskState.mjs      ← `./healthDiskState.mjs`
 *   <tmp>/server/utils/cjkFontState.js   ← `../server/utils/cjkFontState.js`（**上一级**，不是同级）
 *
 * ⛔ r248 实测踩到：只把同目录那一个兄弟文件带进来不够 —— 2026-10-08 之后的基线还
 *   `import '../server/utils/cjkFontState.js'`，而它是**上一级**路径。
 *   若照「同级」摆法（<tmp>/server/...）⇒ 解析到 `<tmp>/../server` = 临时目录的父目录 ⇒
 *   MODULE_NOT_FOUND，现象是「旧脚本什么都没输出」，真病因完全看不出来（与 r242 那条同款）。
 *   ⇒ 脚本放进 `probe/` 子目录，让「上一级」正好落到临时目录根部，两份依赖各归各位。
 */
const SCRIPT_DIRNAME = 'probe'

/**
 * 基线脚本会 import 的相对依赖（[仓库内路径, stage 后相对路径]）。
 * 现有那几份旧基线不 import 第二个，多拷一个文件进临时目录无副作用。
 */
const BASELINE_SIBLINGS = [
  ['scripts/healthDiskState.mjs', 'probe/healthDiskState.mjs'],
  ['server/utils/cjkFontState.js', 'server/utils/cjkFontState.js']
]

/**
 * 把一份基线快照 stage 成可执行的脚本路径。
 * @param {string} fixturePath test/fixtures/healthcheck-baseline-<提交>.mjs 的绝对路径
 * @returns {{ scriptPath: string, cleanup: () => void }}
 */
export function stageBaselineScript(fixturePath) {
  const dir = mkdtempSync(join(tmpdir(), 'minxue-baseline-'))
  for (const [from, to] of BASELINE_SIBLINGS) {
    const dest = join(dir, to)
    mkdirSync(resolve(dest, '..'), { recursive: true })
    cpSync(resolve(ROOT, from), dest)
  }
  const scriptPath = join(dir, SCRIPT_DIRNAME, 'healthcheck.mjs')
  writeFileSync(scriptPath, readFileSync(fixturePath))
  return {
    scriptPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  }
}
