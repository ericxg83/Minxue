/**
 * 回归锁：/api/admin/* 必须挂鉴权中间件（P15 修复，2026-10-12 R55）
 *
 * 背景：minxue-api.onrender.com 公网可达，/api/admin/* 此前全部无鉴权。
 *   POST /api/admin/data-cleanup 默认全表删除无 WHERE，实测 dryRun 直接返回 DB 计数
 *   （tasks=222 / wrong_questions=1311 / generated_exams=34）。任何人调用即数据不可逆丢失。
 *
 * 修复（P15）：新建 server/middleware/adminAuth.js，在 server/index.js 挂载
 *   app.use('/api/admin', adminAuth)。
 *   ADMIN_SECRET 已设 → 校验 x-admin-token；未设 → 只允许本地来源。
 *
 * 判据设计：源码级锁定 ——
 *   1. adminAuth.js 必须存在并导出 adminAuth 中间件，含 ADMIN_SECRET 校验与本地来源兜底；
 *   2. server/index.js 必须在所有 /api/admin 路由之前挂载 app.use('/api/admin', adminAuth)；
 *   3. ⛔ 生产 fail-closed：ADMIN_SECRET 未设 + NODE_ENV=production 必须一律 401，
 *      不得走 isLocalSource（2026-10-18 实测：Render 无 trust proxy，req.ip=代理内网 IP，
 *      isLocalSource 把公网请求误判本地 → P15 失效，公网 dryRun 仍 200）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MW = fs.readFileSync(path.join(ROOT, 'server', 'middleware', 'adminAuth.js'), 'utf-8')
const IDX = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf-8')

test('P15 回归锁：adminAuth 中间件存在并含双策略校验', () => {
  assert.match(MW, /export function adminAuth/, '必须导出 adminAuth 函数')
  assert.match(MW, /ADMIN_SECRET/, '必须读取 ADMIN_SECRET 环境变量')
  assert.match(MW, /x-admin-token/, '必须校验 x-admin-token 请求头')
  assert.match(MW, /isLocalSource/, 'ADMIN_SECRET 未设时必须有本地来源兜底函数')
  assert.match(MW, /401/, '鉴权失败必须返回 401')
})

test('P15 回归锁：server/index.js 必须在路由前挂载 app.use(\'/api/admin\', adminAuth)', () => {
  const mountIdx = IDX.indexOf("app.use('/api/admin', adminAuth)")
  assert.ok(mountIdx > 0, "必须挂载 app.use('/api/admin', adminAuth)")
  // 挂载必须在第一个 /api/admin 路由之前
  const firstAdminRoute = IDX.search(/app\.(get|post|put|delete)\(['"`]\/api\/admin\//)
  assert.ok(firstAdminRoute > 0, '必须存在 /api/admin 路由')
  assert.ok(mountIdx < firstAdminRoute, 'adminAuth 挂载必须在第一个 /api/admin 路由之前')
  // import 必须存在
  assert.match(IDX, /import \{ adminAuth \} from ['"`]\.\/middleware\/adminAuth\.js['"`]/, '必须 import adminAuth')
})

test('P15 回归锁：生产 fail-closed——NODE_ENV=production 且未设 ADMIN_SECRET 必须全拒（P16 修复）', () => {
  // isLocalSource 必须在 production 分支内不可达：production 分支直接 401
  assert.match(MW, /NODE_ENV === 'production'/, '必须显式判断 NODE_ENV=production')
  // 位置关系：production 分支的 401 必须出现在 isLocalSource(req) 调用之前
  // （若有人把 isLocalSource 提前放进 production 分支，本判据即翻红）
  const prodCheckAt = MW.indexOf("NODE_ENV === 'production'")
  const prod401At = MW.indexOf('return res.status(401)', prodCheckAt)
  const localCallAt = MW.indexOf('isLocalSource(req)') // 函数定义也在前面，但调用点是 if (isLocalSource(req))
  const localIfAt = MW.indexOf('if (isLocalSource(req))')
  assert.ok(prod401At > prodCheckAt, 'production 分支必须返回 401')
  assert.ok(prod401At > -1 && localIfAt > -1 && prod401At < localIfAt,
    'production 分支的 401 必须先于 isLocalSource 调用（Render 代理 IP 会误判本地）')
  // 双策略仍须保留：ADMIN_SECRET 校验 + isLocalSource 开发兜底
  assert.match(MW, /ADMIN_SECRET/, '必须读取 ADMIN_SECRET 环境变量')
  assert.match(MW, /x-admin-token/, '必须校验 x-admin-token 请求头')
  assert.match(MW, /isLocalSource/, '开发环境仍须有本地来源兜底函数')
})
