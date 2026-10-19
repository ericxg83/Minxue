/**
 * testSuiteCoverageKit.mjs —— 「npm test 覆盖了多少测试」的**唯一判定实现**（r215）
 *
 * 为什么单独成 kit：判据要同时被两处使用 ——
 *   ① `test/testSuiteCoverage.test.mjs`（锁当前配置）
 *   ② 反向自检探针（喂「修复前的旧脚本」，必须逐条判红）
 * 若判据只写在测试文件里，反向自检就得复制一份逻辑，两边迟早漂移成「假绿」。
 * ⛔ 判据只有一份，输入才有意义。
 */

/** npm test 脚本里，除主目录 glob 外的 server 侧测试文件（单一实现，勿在别处抄一份） */
export const MUST_COVER = [
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
 * 已知排除白名单（r268 起为**数组**；此前是单字符串，只容得下一条）。
 * 2026-10-06 r215 曾登记 `server/tests/figureRegionRefiner.test.mjs`（18 过 1 红，
 * 跨几何赛道）⇒ backlog 提案 ㊱。r268 关闭 ㊱：该文件已纳入 MUST_COVER 且唯一过期
 * 期望按 2026-09-21 产品规则改写 ⇒ 白名单清空。
 * ⚠️ 未来再出现「暂时不能进套件的红测试」，流程是：**先在 backlog 登记提案**，再把
 *   文件加进本数组；`auditTestFileDiscovery` 对磁盘上任何未登记文件 fail-closed，
 *   白名单不是「静默漏跑」的通道。每条必须是非空字符串、不含 '|'、不在覆盖清单里。
 */
export const EXCLUDED = []

/** 把 test 脚本切成「文件/模式」列表：去引号、去 shell 噪声。 */
export function parseTestFiles(script) {
  if (typeof script !== 'string') return []
  return script
    .trim()
    .split(/\s+/)
    .map((s) => s.replace(/^["']|["']$/g, ''))
    .filter((s) => s && s !== 'node' && s !== '--test')
}

/** 「什么算测试文件」的唯一判据 —— 扫描侧与审计侧必须用同一个，否则两边迟早漂移 */
export const TEST_FILE_RE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/

/**
 * npm test 的主 glob（单一实现：package.json scripts.test、auditCoverage、
 * auditTestFileDiscovery 与 testSuiteCoverage.test.mjs 的形状自证都引它）。
 *
 * r307 收紧（`test/*.test.mjs` → `test/[^_]*.test.mjs`）：`_` 前缀是 .gitignore:140
 * `_*` 约定的一次性探针/临时产物（git 永不接纳），但 node --test 的 glob 不认这条约定——
 * r304 探针 `test/_probe_mockmodule.test.mjs` 因此混进套件，每次 npm test 都 8s 超时红
 * （r305/r306 两轮只读审计实证，HEAD 产品码无回归，红全部来自这个永不入库的文件）。
 * Node 22 实测：glob 字符类 `[^_]` 由 node --test 原生支持；npm→cmd.exe 引号内 `^`
 * 原样透传（两者都有 isolated 实证，见 r307 报告）。
 */
export const MAIN_GLOB = 'test/[^_]*.test.mjs'

/**
 * `MAIN_GLOB` 这个 glob **实际能罩到**的形状：test/ 直下一层、首字符不是 `_`
 * （探针约定排除）、以 .test.mjs 结尾。
 * ⛔ 别改成更宽松的正则 —— 它描述的是 Node 的 glob 语义，不是我们的期望。
 */
export const MAIN_GLOB_RE = /^test\/[^/_][^/]*\.test\.mjs$/

/** 相对路径归一化（Windows 上 fs 给的是反斜杠，比对前必须统一） */
const toPosix = (p) => String(p).replace(/\\/g, '/')

/**
 * 审计「仓库里真实存在的测试文件」是否真的会被 `npm test` 跑到（r216）。
 *
 * ⛔ 为什么必须单独有这一层：r215 修的正是「9 个 server 侧测试文件从来没被执行过」，
 *   但 r215 的 `auditCoverage()` 只能证明「清单里写的文件在清单里」——
 *   **它看不见磁盘上多出来的文件**。于是同一个缺陷可以原样复发：
 *   谁往 `server/tests/` 里加一个 `foo.test.mjs`、忘了同步 package.json，
 *   那个文件就永远不跑，而门禁依旧全绿。**这是「假绿门禁」的第二层，比第一层更隐蔽。**
 *
 * @param {string} pkgText package.json 全文
 * @param {string[]} actualTestFiles 调用方用 fs 扫出来的真实测试文件（仓库根相对路径）
 * @returns {string[]} 失败原因（空数组 = 通过）
 */
export function auditTestFileDiscovery(pkgText, actualTestFiles) {
  const fails = []
  const pkg = JSON.parse(pkgText)
  const script = pkg.scripts && pkg.scripts.test
  const listed = script ? parseTestFiles(script) : []

  // 元判据 0：扫不出文件时**不许判绿** —— 否则扫描一坏，整把锁就变成永真
  if (!Array.isArray(actualTestFiles) || actualTestFiles.length === 0) {
    fails.push('真实测试文件清单为空（扫描本身失效）—— 扫描失效时必须判红，不能静默判绿')
    return fails
  }
  if (!listed.includes(MAIN_GLOB)) {
    fails.push(`scripts.test 里没有 ${MAIN_GLOB} —— 主套件被挤没了（或 _ 前缀探针混进了套件）`)
  }

  const covered = new Set([...MUST_COVER, ...EXCLUDED])

  for (const raw of actualTestFiles) {
    const f = toPosix(raw)
    // r307：`_` 前缀 = .gitignore:140 约定的一次性探针（永不入库），按约定整体跳过——
    // 它不是「漏跑」，而是设计上不进任何套件（npm test / patrol 同口径）。
    if (f.slice(f.lastIndexOf('/') + 1).startsWith('_')) continue
    if (f.startsWith('test/')) {
      // test/ 下的文件必须被主 glob 罩到；罩不到的（换后缀、塞子目录）会静默不跑
      if (!MAIN_GLOB_RE.test(f)) {
        fails.push(
          `${f} 在 test/ 下但被 "${MAIN_GLOB}" 漏掉 —— 它不会被执行（改成 *.test.mjs 直放 test/，或显式列进 scripts.test）`
        )
      }
      continue
    }
    if (!covered.has(f)) {
      fails.push(`${f} 既不在 MUST_COVER 也不在 EXCLUDED —— 新增测试文件会被静默跳过（门禁假绿）`)
    }
  }

  return fails
}

/**
 * 审计一段 package.json 文本：npm test 是否真的会跑到 server 侧的测试。
 * @param {string} pkgText package.json 全文
 * @returns {string[]} 失败原因（空数组 = 通过）
 */
export function auditCoverage(pkgText) {
  const fails = []
  const pkg = JSON.parse(pkgText)
  const script = pkg.scripts && pkg.scripts.test
  const listed = script ? parseTestFiles(script) : []

  // ⛔ 元判据 0：脚本存在且是 node --test。写错一个字就是"整套门禁没在跑"。
  if (typeof script !== 'string') {
    fails.push('scripts.test 不存在或不是字符串')
    return fails
  }
  if (!script.startsWith('node --test')) {
    fails.push(`scripts.test 不是 node --test：${script}`)
  }

  if (!listed.includes(MAIN_GLOB)) {
    fails.push(`scripts.test 里没有 ${MAIN_GLOB} —— 主套件被挤没了（或 _ 前缀探针混进了套件）`)
  }

  for (const f of MUST_COVER) {
    if (!listed.includes(f)) {
      fails.push(`${f} 不在 npm test 的覆盖清单里 —— 它会被静默跳过（不报错，门禁变假绿）`)
    }
  }

  // 白名单不变量（r268：EXCLUDED 从单字符串改为数组，逐条校验）
  if (!Array.isArray(EXCLUDED)) {
    fails.push('EXCLUDED 必须是数组（r268 起；单字符串形态只容得下一条排除）')
  } else {
    for (const f of EXCLUDED) {
      if (typeof f !== 'string' || !f) fails.push('EXCLUDED 条目必须是非空字符串')
      if (typeof f === 'string' && f.includes('|')) {
        fails.push(`EXCLUDED 条目含 '|'（${f}）—— 请把它们分别登记成独立的提案，别塞在一个字符串里`)
      }
      if (MUST_COVER.includes(f)) fails.push(`EXCLUDED 同时出现在 MUST_COVER 里：${f}（同一文件既跑又不跑 = 清单自相矛盾）`)
      if (listed.includes(f)) {
        fails.push(`${f} 已在覆盖清单里 —— 那它就不该留在 EXCLUDED 白名单，请把对应 backlog 提案一并关掉`)
      }
    }
  }

  return fails
}
