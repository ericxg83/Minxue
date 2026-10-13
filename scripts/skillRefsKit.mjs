/**
 * skillRefsKit.mjs —— 「技能文档里的引用算不算失效」的**唯一判定实现**
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么单独成 kit（与 testFileList / testSuiteCoverageKit / backupKit 同一规矩）：
 *   判据要被两处使用 —— ① `scripts/check-skill-refs.mjs`（真扫描，带 IO）
 *   ② `test/checkSkillRefsScope.test.mjs`（纯函数真跑 + 反向自检）。
 *   判据只写在脚本里，测试就得复制一份逻辑，两边迟早漂移成「假绿」。
 *
 * ⛔ 本文件修的是什么（r269 实测，不是推理）：
 *   `node scripts/check-skill-refs.mjs` 长期输出 **34 处「错误」并 exit 1**，
 *   逐条核对后其中 **32 处是系统性误报**，真信号被噪声淹没：
 *     ① 25 处是本项目**约定永不入库**的临时/探针文件 —— 巡检纪律原文就写着
 *        「探针放 server/_diag_*.mjs（.gitignore 已排除 server/_*）」，
 *        技能文档里留下的是**历史记录**（「当时跑了这个探针看到…」），
 *        不是「未来会话照抄会失败的路径」。原 PLACEHOLDER 注释其实想到了这一层
 *        （写着「例：_diag_xxx.mjs」），但正则只匹配字面 `xxx`，
 *        真实探针名 `_diag_q456_e2e.mjs` 一个都罩不住。
 *     ② 1 处日期占位符（`backfill-answer-correction-YYYYMMDD.mjs`）——
 *        PLACEHOLDER 已覆盖 `xxx`/`0NN`，却漏了 `YYYYMMDD` 这一模一样的类别。
 *     ③ 5 处**作者标注了、但用词不在 MARKED 词表里**：如
 *        「旧脚本 X 已于 2026-09-11 **删除**；**替代品** Y 只做稽核」、
 *        事实表里明写 `components.json`「**不存在**」「**不生成**」——
 *        文档明明交代过，检查器不认识这些词。
 *     ④ 1 处**同一行就把文件定位在仓库外**（`C:/Users/Administrator/pi-failover/`
 *        里的 `gateway.py`）—— 那压根不是本仓路径。
 *   误报的代价：这份报告从「能用的体检」退化成「永远 34 红的狼来了」，
 *   要么每轮浪费时间逐条排除，要么学会整体无视它 —— 而 r267-P-B 正提议把
 *   healthcheck 家族接进自动化，这类脚本一旦上自动化就是**恒定假红**。
 *
 * ⛔ 这不是「放宽门禁」，是**校准**：门禁的目的是抓「未来会话照抄会失败的真断头路」。
 *   上面四类没有一类属于那个目的。回归锁 `test/checkSkillRefsScope.test.mjs`
 *   同时钉死另一端：**真断头路（未标注的真实缺失文件）必须照样判错**。
 */

/** 占位符 / 刻意示例名，不算失效引用（r269 补日期与时间戳占位符，和 `xxx`/`0NN` 同一类别） */
export const PLACEHOLDER = /xxx|0nn|placeholder|example|yyyymmdd|yyyy-mm-dd|mmdd|hhmmss|<时间戳>|<ts>|<date>/i

/**
 * 行内出现这些词 ⇒ 该引用已被显式交代（不存在 / 是临时件 / 已删除 / 在仓库外…）。
 * r269 扩充词表：原词表只有 7 个词，实测漏掉文档里更自然的写法
 * （「已于…删除」「旧脚本」「替代品」「更名」「不存在」「不生成」「别的项目」…）。
 */
export const MARKED = /已不在仓库|临时件|需重写|已下线|要你新建|待新建|运行时生成|删除|已删|旧脚本|替代品|更名|改名为|曾经|不存在|不生成|别的项目|目标项目|另一台/

/** 行内把文件定位到仓库外（Windows 绝对路径 / home 缩写）⇒ 该行的**裸名**引用不是本仓路径 */
export const EXTERNAL_PATH_LINE = /[A-Za-z]:[\\/]|~\//

/**
 * 按命名约定**永不入库**的临时/探针文件（r269 新增，实现原 PLACEHOLDER 注释的本意）：
 *   ·  basename 以 `_` 开头 —— `_diag_*` / `_tmp_*` / `_repro_*` / `_bench_*` /
 *      `_patch_*` / `_r134_*` / `_head.js`（`git show HEAD:f > _head.js` 的产物）
 *   ·  路径落在生成物/日志目录下 —— `tmp/`（prune-lint.json 等命令输出）、
 *      `deliverables/`（对外产出物）、`logs/`（运行日志）
 * 这些名字在 `git ls-files` 里永远找不到（`.gitignore` 的 `_*` / `tmp/` 规则），
 * 把它们当「失效引用」报错，就是拿约定当缺陷。
 */
export function isEphemeralRef(norm) {
  const base = String(norm).split('/').pop() || ''
  if (base.startsWith('_')) return true
  return /^(tmp|deliverables|logs)\//.test(String(norm))
}

/**
 * 「仓库里找不到」的引用，该不该算错误？
 *
 * ⛔ 仓库外定位这条是四条里最弱的（纯行级启发式），因此刻意收窄：
 *    **只豁免裸文件名**（norm 不含 `/`）。理由 —— 带 `/` 的 token 是对仓库的
 *    显式相对路径声明，必须自己站得住（`server/services/foo.js` 写错了就是写错了，
 *    不能因为同一行顺带提了一句 `C:/tools/` 就免罪）；而裸名本来就无法对着仓库解析，
 *    当它所在行已经明确把文件定位到仓库外时，它大概率属于那个外部上下文
 *    （实测唯一命中：`C:/Users/Administrator/pi-failover/` 里的 `gateway.py`）。
 *
 * @param {object} input
 * @param {string} input.tok       技能文档里反引号包着的原始 token
 * @param {string} input.norm      归一化后的相对路径（去掉开头的 `./`）
 * @param {string} input.line      该 token 所在行全文（用于行级标注与仓库外定位判断）
 * @param {boolean} input.marked   该行是否命中 MARKED 词表
 * @param {boolean} input.markedBaseHas 该 basename 是否已被本技能**某一行**标注过（文件级）
 * @returns {{excuse: boolean, reason: string|null, kind: 'placeholder'|'ephemeral'|'marked'|'external'|'error'}}
 *          excuse=true 表示「不算错误」；kind 让调用方能把「因何豁免」透明地印出来
 *          （⛔ 豁免不许静默：看不见的豁免本身就是新的假绿）。
 */
export function classifyMissingRef({ tok, norm, line, marked, markedBaseHas }) {
  if (PLACEHOLDER.test(tok)) return { excuse: true, kind: 'placeholder', reason: '占位符/示例名（或日期占位符）' }
  if (isEphemeralRef(norm)) return { excuse: true, kind: 'ephemeral', reason: '约定永不入库的临时/探针文件名' }
  if (marked) return { excuse: true, kind: 'marked', reason: '该行已标注（历史/临时/仓库外）' }
  if (markedBaseHas) return { excuse: true, kind: 'marked', reason: '本技能已在另一行标注过该脚本' }
  // 仅裸名：带 / 的相对路径声明不许借「外部」名义蒙混（见上方 JSDoc）
  if (!String(norm).includes('/') && EXTERNAL_PATH_LINE.test(line || '')) {
    return { excuse: true, kind: 'external', reason: '该行把文件定位在仓库外（绝对路径/~），且本 token 是裸名' }
  }
  return { excuse: false, kind: 'error', reason: null }
}
