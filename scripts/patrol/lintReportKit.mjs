/**
 * patrol lint 报告的「本轮数据」判据（r236，落地提案㊽）
 * ─────────────────────────────────────────────────────────────────
 * 为什么需要它（实测，2026-10-07 r223 提出、r236 落地）：
 *   `scripts/patrol/patrol.mjs` 的 E 段跑 `eslint ... -o tmp/prune-lint.json`，
 *   然后直接读这个文件数 errors —— **eslint 自己的退出码/超时整个被丢掉**，
 *   唯一兜底是「parse 失败 ⇒ errCount=-1」。
 *   而 `tmp/prune-lint.json` **跨 tick 持久**（实测 mtime 随每次成功 tick 覆盖）。
 *   于是只要本 tick eslint **没写出报告**（180s 超时被 kill / 配置错 exit 2 / 二进制缺失），
 *   **上一 tick 的陈旧报告还在原地** ⇒ 本 tick 照读 ⇒ 报 `lint=0` 判「全绿」。
 *   ⇒ 与 r198/r218/r220/r221/r233/r235 同一族：「判据没真读到**本轮**数据 ⇒ 悄悄判合格」。
 *
 * 两道闸（互补，任一失效另一道还在）：
 *   ① 调用方在跑 eslint **之前** `fs.rmSync(reportPath, { force: true })` —— 旧报告先清掉；
 *   ② 本模块只认 **mtime ≥ 本轮 startedAt** 的那份（交叉校验，防「删了又被别的进程写回」）。
 *
 * ⛔ 不读退出码当判据：eslint 有 lint 错误时本来就 exit 1（正常），退出码分不出「跑成了」和「没跑成」；
 *    能分出的是「本 tick 有没有写出一份新报告」，所以判据落在**报告的新鲜度**上。
 */

import { readFileSync, statSync } from 'node:fs'

/**
 * 解析 eslint json 报告，数 errors（severity=2）与 no-unused-vars 条数。
 * 纯函数（不碰 fs），便于真跑断言。
 * @param {Array} report eslint `-f json` 输出的数组
 * @returns {{ errCount: number, unusedVars: number }}
 */
export function summarizeLintReport(report) {
  let errCount = 0
  let unusedVars = 0
  for (const f of report || []) {
    for (const m of f.messages || []) {
      if (m.severity === 2) errCount++
      if (m.ruleId === 'no-unused-vars') unusedVars++
    }
  }
  return { errCount, unusedVars }
}

/**
 * 读「本轮」lint 报告。只认本次 tick 写出来的那份。
 * @param {string} reportPath 报告路径
 * @param {number} startedAtMs 本轮 started 的毫秒时间戳（Date.parse(started)）
 * @returns {{ errCount: number, unusedVars: number, reason: 'ok'|'missing'|'stale'|'parse' }}
 *   reason ≠ 'ok' 时 errCount 恒为 -1 —— 调用方必须把它当「没读到」，**不许当 0**。
 */
export function collectLintReport(reportPath, startedAtMs) {
  let raw
  try {
    const st = statSync(reportPath)
    // ② 交叉校验：报告比本轮还旧 ⇒ 是上一 tick 留下的，不认。
    if (startedAtMs && st.mtimeMs < startedAtMs) {
      return { errCount: -1, unusedVars: 0, reason: 'stale' }
    }
    raw = readFileSync(reportPath, 'utf8')
  } catch {
    // ① 文件不在 = 本轮 eslint 没写出报告（或调用方已按纪律先删掉）。
    return { errCount: -1, unusedVars: 0, reason: 'missing' }
  }
  try {
    const { errCount, unusedVars } = summarizeLintReport(JSON.parse(raw))
    return { errCount, unusedVars, reason: 'ok' }
  } catch {
    return { errCount: -1, unusedVars: 0, reason: 'parse' }
  }
}

/** reason → 给负责人看的大白话（体检报告里用，别甩术语）。 */
export function lintReportReasonText(reason) {
  switch (reason) {
    case 'missing': return '本轮 eslint 没写出报告'
    case 'stale': return '读到的报告是上一轮留下的旧文件'
    case 'parse': return '报告内容读不出来（多半是写了一半）'
    default: return ''
  }
}
