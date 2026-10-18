/**
 * /api/admin/* 鉴权中间件（P15 修复，2026-10-12 R55）
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * minxue-api.onrender.com 公网可达，/api/admin/* 此前全部无鉴权：
 *   POST /api/admin/data-cleanup 默认全表删除 tasks/wrong_questions/generated_exams
 *   无 WHERE 无 dryRun，任何人调用即数据不可逆丢失（实测 dryRun 直接返回 DB 计数）。
 *
 * ── 策略（渐进式，不 break 现状）─────────────────────────────────────────
 *   · ADMIN_SECRET 已设 → 严格校验请求头 x-admin-token，不匹配 401
 *   · ADMIN_SECRET 未设 + NODE_ENV=production → 一律 401（fail-closed）
 *   · ADMIN_SECRET 未设 + 非生产（开发）→ 只允许本地来源（loopback / 内网）
 *
 * ⛔ production 为什么不做「本地来源放行」（2026-10-18 实测，P15 失效根因）：
 *   server/index.js 未设 app.set('trust proxy')，因此 Express 的 req.ip =
 *   req.socket.remoteAddress = **Render 前置代理的内网 IP**（172.x/10.x 网段）。
 *   isLocalSource 的内网正则会把【所有公网请求】误判为"本地"→ 直接放行 ⇒
 *   公网任意人仍可 POST /api/admin/data-cleanup 全表删除（与实测一致：
 *   render.yaml NODE_ENV=production 且无 ADMIN_SECRET，公网 dryRun 仍返回 200）。
 *   生产没有"本地来源"这一说（访问者都来自公网），未配 ADMIN_SECRET 就必须全拒。
 *
 * 负责人需在 Render 后台设置 ADMIN_SECRET 环境变量并 redeploy，之后管理端点即受保护。
 * token 由负责人自行保管，前端/脚本调用 admin 端点时带 x-admin-token 请求头。
 */
function isLocalSource(req) {
  // Express 的 req.ip 受 trust proxy 设置影响；Render 在代理后，req.ip 通常为真实客户端 IP
  const ip = req.ip || req.socket?.remoteAddress || ''
  // 回环 / IPv6 回环 / 内网
  if (/^127\.0\.0\.1$/.test(ip) || ip === '::1' || ip === '::ffff:127.0.0.1') return true
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01]\.)/.test(ip)) return true
  // Render 健康检查来自内网，但健康检查不走 /api/admin，无需特殊处理
  return false
}

export function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET
  if (secret) {
    const token = req.headers['x-admin-token']
    if (token && token === secret) return next()
    return res.status(401).json({ error: '管理端点需要有效的 x-admin-token' })
  }
  // ADMIN_SECRET 未设：
  if (process.env.NODE_ENV === 'production') {
    // ⛔ 生产一律拒绝：Render 前置代理使 req.ip 恒为内网代理 IP，
    //    isLocalSource 会把所有公网请求误判为本地（2026-10-18 实测，P15 失效）。
    //    生产没有"本地来源"——必须配置 ADMIN_SECRET 才能使用 admin 端点。
    console.warn(`[adminAuth] 生产环境 ADMIN_SECRET 未配置，拒绝所有 admin 访问：${req.method} ${req.originalUrl}`)
    return res.status(401).json({ error: '生产环境管理端点必须配置 ADMIN_SECRET 并携带 x-admin-token' })
  }
  // 开发环境（NODE_ENV!=='production'）：本地来源放行（开发友好），非本地拒绝并告警
  if (isLocalSource(req)) return next()
  console.warn(`[adminAuth] 拒绝非本地访问 admin 端点（ADMIN_SECRET 未配置）：${req.method} ${req.originalUrl} from ${req.ip}`)
  return res.status(401).json({ error: '访问管理端点需配置 ADMIN_SECRET 并携带 x-admin-token' })
}

export default adminAuth
