import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LIB_SRC = readFileSync(resolve(ROOT, 'server/lib/weekendHandout.js'), 'utf8')
const CLI_SRC = readFileSync(resolve(ROOT, 'server/scripts/weekend-handout.mjs'), 'utf8')
const ROUTE_SRC = readFileSync(resolve(ROOT, 'server/routes/weekendHandout.js'), 'utf8')
const INDEX_SRC = readFileSync(resolve(ROOT, 'server/index.js'), 'utf8')
const PPTX_SRC = readFileSync(resolve(ROOT, 'server/services/weekendPptxService.js'), 'utf8')
const VIEW_SRC = readFileSync(resolve(ROOT, 'src/workbench/views/WeekendHandout.vue'), 'utf8')
const SIDEBAR_SRC = readFileSync(resolve(ROOT, 'src/workbench/components/layout/AppSidebar.vue'), 'utf8')
const ROUTER_SRC = readFileSync(resolve(ROOT, 'src/workbench/router/index.js'), 'utf8')

/**
 * 周末班错题课件产品化（2026-09-17，方案 A）
 *
 * 背景：老师每周要把全班错题整理成讲评 PPT。原为 CLI 脚本 + python-pptx，
 * 生产环境无 Python → 改为后端 Node 渲染（pptxgenjs）。
 *
 * 本测试锁定三个关键不变量：
 *  1. 聚合逻辑抽到 lib/weekendHandout.js 可调用模块，CLI 与 API 同源
 *  2. 「完整题干相同」二次去重（v3 基线 30 题里题11 重复两条 → 29 题）
 *  3. API 端点 / 前端入口存在且路由前缀正确（避免双重前缀 404 事故）
 */

test('buildHandout 可调用模块导出核心聚合能力', () => {
  assert.ok(LIB_SRC.includes('export async function buildHandout('), '必须导出 buildHandout')
  assert.ok(LIB_SRC.includes('export const TIERS'), '必须导出 TIERS（渲染端共用难度档）')
  assert.ok(LIB_SRC.includes('import { normalizeStem } from'), '必须复用题干归一化（不做相似度合并）')
})

test('同题二次去重：完整题干相同的条目合并（CLI 与 lib 同构）', () => {
  // lib 侧：完整题干归一化键二次合并
  assert.ok(
    LIB_SRC.includes('完整题干归一化键二次合并') || LIB_SRC.includes('完整题干相同合并'),
    'lib 必须包含完整题干二次去重逻辑'
  )
  assert.ok(LIB_SRC.includes('normalizeStem('), '去重键必须用 normalizeStem')
  assert.ok(LIB_SRC.includes('cur.students = students.sort'), '合并后学生明细按错次排序')
  // CLI 侧同构
  assert.ok(
    CLI_SRC.includes('完整题干相同合并'),
    'CLI 脚本必须同步二次去重（与 lib 同构）'
  )
  // 两处都用 let topics（二次合并会重新赋值）
  assert.ok(LIB_SRC.includes('let topics = []'), 'lib 中 topics 必须可重新赋值')
  assert.ok(CLI_SRC.includes('let topics = []'), 'CLI 中 topics 必须可重新赋值')
})

test('preview/generate 路由完整路径，外部直接挂载（防双重前缀）', () => {
  assert.ok(ROUTE_SRC.includes("router.post('/api/weekend-ppt/preview'"), '必须有 preview 端点（完整路径）')
  assert.ok(ROUTE_SRC.includes("router.post('/api/weekend-ppt/generate'"), '必须有 generate 端点（完整路径）')
  assert.ok(ROUTE_SRC.includes('selected'), 'generate 必须支持勾选题目')
  // 外部挂载不带前缀（路由内部已写完整路径）
  assert.ok(
    INDEX_SRC.includes('app.use(weekendHandoutRouter)') &&
      !INDEX_SRC.includes("app.use('/api/weekend-ppt', weekendHandoutRouter)"),
    'weekendHandout 必须直接挂载，不能加前缀（否则 /api/weekend-ppt + /api/weekend-ppt/preview 双重前缀 404）'
  )
})

test('PPTX 渲染：敏学品牌 token + 图片 base64 data URI', () => {
  assert.ok(PPTX_SRC.includes("'6366F1'"), '主色必须为敏学 Indigo-500 #6366F1')
  assert.ok(PPTX_SRC.includes('TIER_COLORS'), '难度分档必须用状态色语义')
  assert.ok(PPTX_SRC.includes('data:${mime};base64,'), '图片必须转 base64 data URI（pptxgenjs 不收原始 Buffer）')
  assert.ok(PPTX_SRC.includes('animation: \'fade\''), '答案必须保留单击浮现动画')
  assert.ok(PPTX_SRC.includes('estimateLines'), '长答案必须走多档字号自适应（防截断）')
})

test('工作台入口：路由 + 侧栏菜单存在', () => {
  assert.ok(ROUTER_SRC.includes("path: '/weekend-ppt'"), '路由必须注册 /weekend-ppt')
  assert.ok(ROUTER_SRC.includes("import('../views/WeekendHandout.vue')"), '路由必须指向 WeekendHandout.vue')
  assert.ok(SIDEBAR_SRC.includes("path:'/weekend-ppt'"), '侧栏必须挂周末班课件入口')
  assert.ok(SIDEBAR_SRC.includes('周末班课件'), '侧栏菜单名必须为中文「周末班课件」')
  assert.ok(VIEW_SRC.includes('/weekend-ppt/preview'), '页面必须调用 preview 接口')
  assert.ok(VIEW_SRC.includes('/api/weekend-ppt/generate'), '页面必须调用 generate 接口')
})
