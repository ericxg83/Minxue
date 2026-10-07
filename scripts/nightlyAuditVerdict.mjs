/**
 * 夜间巡检「当晚通过没」的唯一判定（2026-10-07 r240）
 *
 * 为什么单独抽一个文件：
 *   ⛔ r240 实测 —— 修复前的 `nightlyAudit.mjs` 结尾是
 *   `process.exit(ratchet.status === 'REGRESSED' ? 1 : 0)`，
 *   也就是说**单元测试整晚挂掉，退出码仍然是 0**。
 *   只要哪天把定时任务挂上去（提案 ㊲/⑲ 待拍板），调度器看到的永远是「当晚成功」，
 *   报告文件里躺着「单元测试失败」那一节也没人看 —— 与 r152 那三个 gate 脚本
 *   「全坏也算 exit 0」是同一个缺陷，在脚本从没被执行过时一直没暴露。
 *   另外 `collectTests` 只看 runner 的退出码：这条命令的 glob 万一匹配不到文件，
 *   node --test 会**一条测试都不跑并且 exit 0**（r215 那个「9 个测试文件从没跑过」的同款），
 *   同样会被当成绿灯。
 *
 * 抽成纯函数的好处：这类「该红没红」的判据只靠读主流程看不出来，
 * 必须能让测试直接喂各种组合跑（喂真实计数、喂坏数据都行）。
 *
 * 判定口径（保守：不确定就判不过，绝不当成绿灯 —— 与脚本头部的棘轮原则一致）：
 *   1. 棘轮回退 ⇒ 失败（退出码 1，跟修复前一致）
 *   2. 单测 runner 非 0 退出 ⇒ 失败（退出码 3）
 *   3. 压根没读到「跑了多少条」⇒ 失败（退出码 3）
 *   4. 其余 ⇒ 通过（退出码 0）
 *
 * ⚠️ 退出码 2 已被主流程的「lint 报告出不来 ⇒ 巡检中止」占用，这里不能再占用。
 */

/** 退出码表。改动必须与 `scripts/nightlyAudit.mjs` 头部的用法注释同步。 */
export const NIGHTLY_EXIT = {
  PASS: 0,
  REGRESSED: 1,
  ABORT: 2, // 巡检没跑起来（lint 报告拿不到）
  TESTS_FAILED: 3
}

/**
 * 当晚结论。
 *
 * @param {object} input
 * @param {number} input.testsExitCode  `node --test` 的退出码（0 = runner 自己认为成功）
 * @param {number|null} input.testsRun  从输出里解析出的「跑了多少条」，解析不到就是 null
 * @param {'REGRESSED'|'ok'|'initialized'|null} input.ratchetStatus 棘轮结论
 * @returns {{status: string, exitCode: number, reason: string|null}}
 */
export function resolveNightlyVerdict({ testsExitCode, testsRun, ratchetStatus }) {
  // 棘轮先判：它是「当晚不得合并」的硬闸，优先级最高（沿用修复前的行为）
  if (ratchetStatus === 'REGRESSED') {
    return { status: 'REGRESSED', exitCode: NIGHTLY_EXIT.REGRESSED, reason: 'lint 棘轮回退了，当晚不得合并任何改动' }
  }

  if (testsExitCode !== 0) {
    return {
      status: 'TESTS_FAILED',
      exitCode: NIGHTLY_EXIT.TESTS_FAILED,
      reason: `单元测试挂了（runner 退出码 ${testsExitCode}），当晚不许报成功`
    }
  }

  // ⛔ 关键一条：runner 成功但一条测试都没跑 = 什么都没验过（假绿），
  //    这正是 r215「9 个测试文件从不进套件」那一类的收口。
  if (!Number.isFinite(testsRun) || testsRun <= 0) {
    return {
      status: 'NO_TESTS_RUN',
      exitCode: NIGHTLY_EXIT.TESTS_FAILED,
      reason: '一条单元测都没执行（或没读到执行条数），这一轮等于没验过，不许报成功'
    }
  }

  return { status: 'PASS', exitCode: NIGHTLY_EXIT.PASS, reason: null }
}

/**
 * 判断 `node --test` 的输出里能不能读到「执行了多少条」。
 *
 * Node 的 TAP 汇总行长这样：
 *   `# tests 13` / `# pass 13` / `# fail 0`
 * 第二组 `runOk` 用来区分「真的跑了 0 条」和「压根没这行（换 reporter 了）」，
 * 后者同样不许当绿灯 —— 判据本身也要能被验红。
 *
 * @param {object} counters `collectTests()` 解析出的计数
 * @returns {{ok: boolean, reason: string|null}}
 */
export function readTestsRun(counters) {
  const n = counters ? Number(counters.tests) : NaN
  if (!Number.isFinite(n)) {
    return { ok: false, reason: '没从输出里读到「跑了多少条」，reporter 可能换了，这一轮没验过' }
  }
  if (n <= 0) return { ok: false, reason: '跑是跑了，但一条测试都没执行' }
  return { ok: true, reason: null }
}
