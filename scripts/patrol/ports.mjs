/**
 * patrol 引擎的端口口径（单一实现，r293）
 * ─────────────────────────────────────────────────────────────
 * 背景（实测，2026-10-16）：
 *   本地服务自 2026-10-13 起重构为「计划任务 MinxueLocalServices 登录时拉起
 *   后端 :4000 + 前端 vite dev :3000」（scripts/start-local.cmd 头部注释实证；
 *   netstat 实测 :3000 PID 4504 / :4000 PID 2588，无 :5173 监听）。
 *   而 patrol 引擎仍探 2026-10-04 之前的旧移动端 dev 端口 :5173 ⇒
 *   健康检查恒报 `mobile-dev DOWN`、冒烟恒被跳过（「环境未就绪」假信号），
 *   smoke.mjs 单独手跑也会打一台不存在的服务器。
 *   r292 只读发现（提案 r292-P-B），r293 落地。
 *
 * 为什么单独成模块：与 scripts/gate/base.mjs（r158）同因——端口字面量散落
 *   多处必漂移（:5173 就是这么过时的）。patrol.mjs 与 smoke.mjs 都从这里
 *   取口径；回归锁 test/patrolPortCaliber.test.mjs 盯着「不得再出现硬编码
 *   5173 / 127.0.0.1:<port> 字面量」。
 *
 * 改端口只改这一处；本地服务端口再变时，先改这里再跑锁。
 */

/** 后端（server/index.js） */
export const BACKEND_PORT = 4000

/** 前端 vite dev（npm run dev / start-local / MinxueLocalServices 计划任务） */
export const FRONTEND_PORT = 3000

export const BACKEND_BASE = `http://127.0.0.1:${BACKEND_PORT}`
export const FRONTEND_BASE = `http://127.0.0.1:${FRONTEND_PORT}`
