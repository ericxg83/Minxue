import { Router } from 'express'
import { snapshot } from '../services/quotaSentinel.js'

// 配额哨兵查询接口（提案 1，2026-09-30）。
// GET /api/quota/status → { code:0, data: { ok, degraded:[{supplier,kind,detail,since,minutes}], checkedAt } }
// 消费方：教师工作台顶栏降级横幅（10-01 档接入）与夜间巡检报告。
// snapshot 内部全兜底，本路由不会因哨兵异常而 500。
const router = Router()

router.get('/status', (_req, res) => {
  res.json({ code: 0, data: snapshot() })
})

export default router
