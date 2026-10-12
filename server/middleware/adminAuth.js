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
 *   · ADMIN_SECRET 未设 → 只允许本地来源（loopback / 内网），非本地 401 + 告警
 *     （生产公网来源在 env 未设时被锁，开发本地不受影响）
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
  // ADMIN_SECRET 未设：本地来源放行（开发友好），非本地拒绝并告警
  if (isLocalSource(req)) return next()
  console.warn(`[adminAuth] 拒绝公网访问 admin 端点（ADMIN_SECRET 未配置）：${req.method} ${req.originalUrl} from ${req.ip}`)
  return res.status(401).json({ error: '生产环境访问管理端点需配置 ADMIN_SECRET 并携带 x-admin-token' })
}

export default adminAuth
