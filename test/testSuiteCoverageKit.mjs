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
  'server/tests/judgeChoiceAnswer.test.mjs',
  'server/tests/normalizeBlockBoxSemantics.test.mjs',
  'server/tests/repairAIJson.test.mjs',
  'server/tests/uploadValidatorHeic.test.mjs',
  'server/utils/aiParseSelfCheck.test.js',
  'server/utils/answerConsensus.test.js'
]

/** 已知排除（真缺陷 + 跨赛道），与 backlog 提案 ㊱ 一一对应 */
export const EXCLUDED = 'server/tests/figureRegionRefiner.test.mjs'

/** 把 test 脚本切成「文件/模式」列表：去引号、去 shell 噪声。 */
export function parseTestFiles(script) {
  if (typeof script !== 'string') return []
  return script
    .trim()
    .split(/\s+/)
    .map((s) => s.replace(/^["']|["']$/g, ''))
    .filter((s) => s && s !== 'node' && s !== '--test')
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

  if (!listed.includes('test/*.test.mjs')) {
    fails.push('scripts.test 里没有 test/*.test.mjs —— 主套件被挤没了')
  }

  for (const f of MUST_COVER) {
    if (!listed.includes(f)) {
      fails.push(`${f} 不在 npm test 的覆盖清单里 —— 它会被静默跳过（不报错，门禁变假绿）`)
    }
  }

  if (!EXCLUDED.length) fails.push('EXCLUDED 常量被清空了，无法证明排除是有意为之')
  if (listed.includes(EXCLUDED)) {
    fails.push(`${EXCLUDED} 已在覆盖清单里 —— 那它就不该留在 EXCLUDED 白名单，请把提案 ㊱ 一并关掉`)
  }
  if (EXCLUDED.includes('|')) {
    fails.push('EXCLUDED 变成了多条 —— 请把它们分别登记成独立的提案，别塞在一个字符串里')
  }
  // 白名单不能和覆盖清单撞车（同一文件既跑又不跑 = 清单自相矛盾）
  if (MUST_COVER.some((f) => f === EXCLUDED)) {
    fails.push('EXCLUDED 同时出现在 MUST_COVER 里')
  }

  return fails
}
