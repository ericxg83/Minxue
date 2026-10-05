/**
 * 闸门脚本统一 BASE 解析（r158）
 * ─────────────────────────────────────────────────────────────────
 * 背景（实测，2026-10-05）：5 个闸门脚本各自硬编码默认端口，互不相同
 * （cert_probe/render_smoke 5227、route_sweep 5234、text_audit/overflow_audit 5235），
 * 且 `overflow_audit.mjs` **漏了 `process.env.BASE`** ——
 *   BASE=http://127.0.0.1:5999 node scripts/gate/overflow_audit.mjs
 * 实测仍去请求 5235（对照组 text_audit / route_sweep 均正确请求 5999）。
 * 5235 恰是历史上放陈旧 preview 的端口 ⇒ 会「审计了另一台服务器」：
 * 空页面没有横向溢出，于是打印 0/14 全绿 —— 假绿，比假红危险得多。
 *
 * 现在默认值只留这一处，解析顺序：argv[2] > 环境变量 BASE > DEFAULT_BASE；
 * 并且每个闸门开工先打印审计目标，跑错端口一眼可见。
 *
 * 改动纪律：新增闸门脚本一律 `import { gateBase } from './base.mjs'`，
 * 不得再出现硬编码的 `127.0.0.1:<port>` 字面量（回归锁 test/gateBase.test.mjs 盯着）。
 */

/** 统一默认端口（取 README/HANDOFF 文档化的 5227，不再是每脚本一套）。 */
export const DEFAULT_GATE_PORT = 5227
export const DEFAULT_BASE = `http://127.0.0.1:${DEFAULT_GATE_PORT}`

/**
 * 解析审计目标。
 * @param {string[]} argv 默认 process.argv（取 argv[2] 作为显式 BASE）
 * @param {Record<string,string|undefined>} env 默认 process.env
 * @returns {{ base: string, source: 'argv' | 'env BASE' | '默认值' }}
 */
export function resolveBase(argv = process.argv, env = process.env) {
  if (argv[2]) return { base: argv[2], source: 'argv' }
  if (env.BASE) return { base: env.BASE, source: 'env BASE' }
  return { base: DEFAULT_BASE, source: '默认值' }
}

/** 打印审计目标（防「跑错端口以为全绿」），返回 base 供调用方使用。 */
export function logBase({ base, source }) {
  console.log(`[gate] 审计目标 = ${base}（来源：${source}）`)
  return base
}

/** 一行拿到 base 并回显 —— 闸门脚本标准用法：`const BASE = gateBase()`。 */
export function gateBase(argv = process.argv, env = process.env) {
  return logBase(resolveBase(argv, env))
}
