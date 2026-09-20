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
  assert.ok(
    LIB_SRC.includes('b.wrongTimes - a.wrongTimes') && (LIB_SRC.includes('mergeStudents') || LIB_SRC.includes('students.sort')),
    '合并后学生明细按错次排序（mergeStudents）'
  )
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

test('白板模式：路由 + 手写组件 + 入口', () => {
  const BOARD_SRC = readFileSync(resolve(ROOT, 'src/workbench/views/WeekendBoard.vue'), 'utf8')
  const CANVAS_SRC = readFileSync(resolve(ROOT, 'src/workbench/components/DrawingCanvas.vue'), 'utf8')
  // 路由注册（board 必须在 /weekend-ppt 之后且路径完整）
  assert.ok(
    ROUTER_SRC.includes("path: '/weekend-ppt/board'") &&
      ROUTER_SRC.includes("import('../views/WeekendBoard.vue')"),
    '必须注册 /weekend-ppt/board 路由'
  )
  // 手写层：Canvas + Pointer Events + 分层（覆盖在题目上）
  assert.ok(CANVAS_SRC.includes('<canvas'), '必须有 canvas 元素')
  assert.ok(CANVAS_SRC.includes('@pointerdown'), '必须用 Pointer Events（统一鼠标/触控笔/触摸）')
  assert.ok(CANVAS_SRC.includes('e.pressure'), '必须读取笔压')
  assert.ok(CANVAS_SRC.includes('z-index: 3'), '手写层必须在题目层之上')
  assert.ok(CANVAS_SRC.includes('exportPng'), '必须支持板书导出')
  // 平板防手掌误触：手指(touch)默认忽略，仅触控笔/鼠标可书写，除非显式开启
  assert.ok(
    CANVAS_SRC.includes("e.pointerType === 'touch' && !props.allowTouch"),
    '手指默认不绘制（防手掌误触），须 allowTouch 开启'
  )
  assert.ok(CANVAS_SRC.includes('allowTouch: { type: Boolean, default: false }'), 'allowTouch 默认关闭')
  // 白板页：答案浮现 + 原卷 + 全屏 + localStorage 笔迹
  assert.ok(BOARD_SRC.includes('showAnswer'), '必须有答案浮现')
  assert.ok(BOARD_SRC.includes('showOriginal'), '必须有原卷对照')
  assert.ok(BOARD_SRC.includes('requestFullscreen'), '必须支持全屏投屏')
  assert.ok(BOARD_SRC.includes('localStorage.setItem'), '笔迹必须本地持久化')
  assert.ok(BOARD_SRC.includes('wb_strokes_'), '笔迹 key 必须按题隔离')
  // 入口：预览区有「白板模式」按钮，跳转携带 selected
  assert.ok(VIEW_SRC.includes('白板模式'), '页面上必须有白板模式按钮')
  assert.ok(VIEW_SRC.includes("path: '/weekend-ppt/board'"), '必须跳转白板路由')
  assert.ok(VIEW_SRC.includes('selected.value'), '跳转必须携带勾选题目')
})

test('序号展示口径：节内局部序号 + 不显示卷面题号（2026-09-18 修复）', () => {
  // 预览页：节内序号从 1 起（localSeq），勾选仍用全局 index
  assert.ok(
    VIEW_SRC.includes('localSeq: i + 1'),
    '预览页必须生成节内序号 localSeq（每节从 1 起）'
  )
  assert.ok(VIEW_SRC.includes('{{ q.localSeq }}'), '蓝色序号徽标必须显示节内序号 localSeq')
  assert.ok(
    VIEW_SRC.includes('toggleQuestion(q.index') && VIEW_SRC.includes('isSelected(q.index'),
    '勾选/选中仍必须用全局唯一 index（localSeq 仅展示，不能进数据主键）'
  )
  // 用户明确不关心「卷面第几题」——预览页不应出现卷面题号标签
  assert.ok(
    !VIEW_SRC.includes('q.questionNumber') || !/卷面第\s*\{\{\s*q\.questionNumber/.test(VIEW_SRC),
    '预览页不应显示「卷面第 N 题」标签（用户不关心此信息）'
  )
  // 白板：题面徽标与板书导出标题用课件序号（currentIndex + 1），不混卷面号
  const B_SRC = readFileSync(resolve(ROOT, 'src/workbench/views/WeekendBoard.vue'), 'utf8')
  assert.ok(B_SRC.includes('第 {{ currentIndex + 1 }} 题'), '白板题面徽标必须显示课件序号 currentIndex+1')
  assert.ok(B_SRC.includes('currentIndex.value + 1'), '板书导出标题必须用 currentIndex 而非卷面号')
  assert.ok(
    !/卷面第\s*\{\{\s*current(?:Index)?\.?value?\??\.questionNumber/.test(B_SRC),
    '白板题面与导出标题不应再出现卷面题号'
  )
  // PPT 渲染端：页眉序号按节重置（与原全局递增解耦），日志统计改用 totalQ
  assert.ok(PPTX_SRC.includes('let seq = 0'), 'PPT 页眉序号必须在节内初始化（每节从 1 起）')
  assert.ok(PPTX_SRC.includes('totalQ'), 'PPT 渲染完成日志必须用 totalQ 统计总题数')
})

test('难度筛选：参数 + 路由 + 预览星级（2026-09-18 加入，与错题组卷预览页口径一致）', () => {
  // —— 后端 lib：解构 + 过滤块 ——
  assert.ok(LIB_SRC.includes("difficulty = ''"), 'buildHandout 必须解构 difficulty（默认空=不限）')
  assert.ok(
    LIB_SRC.includes("if (difficulty && difficulty !== 'all')"),
    'buildHandout 难度过滤条件：非空且非 all 才生效（避免空串误过滤）'
  )
  assert.ok(
    LIB_SRC.includes('TIERS.find(x => x.match(t.difficulty))') && LIB_SRC.includes('k === difficulty'),
    '过滤必须按 TIERS 档位 key 匹配，不能直接比 difficulty 数值（与组卷预览同口径）'
  )

  // —— 路由 sanitizeParams 透传 ——
  assert.ok(ROUTE_SRC.includes("difficulty: str(body.difficulty)"), 'sanitizeParams 必须取 difficulty')
  assert.ok(ROUTE_SRC.includes('...params'), 'preview 必须把 sanitize 后的参数整体透传给 buildHandout')

  // —— 前端：参数 + 选项 + 下拉绑定 ——
  assert.ok(VIEW_SRC.includes('difficulty:'), 'WeekendHandout 默认参数必须包含 difficulty 字段')
  assert.ok(VIEW_SRC.includes('difficultyOptions'), '必须定义 difficultyOptions 选项数组')
  assert.ok(
    VIEW_SRC.includes('基础（难度1-2）') &&
      VIEW_SRC.includes('中等（难度3）') &&
      VIEW_SRC.includes('较难（难度4-5）') &&
      VIEW_SRC.includes('难度未判定'),
    '难度选项必须覆盖四档且标签清晰（与错题组卷预览页口径一致）'
  )
  assert.ok(
    VIEW_SRC.includes('v-model="params.difficulty"') &&
      VIEW_SRC.includes(':options="difficultyOptions"') &&
      VIEW_SRC.includes('aria-label="难度筛选"'),
    '必须用 WorkbenchSelect 绑定 params.difficulty，并暴露 a11y 标签'
  )
  assert.ok(VIEW_SRC.includes("difficulty: body.difficulty") || VIEW_SRC.includes('difficulty: params.value.difficulty'),
    'buildParamsBody 必须把难度筛选发给后端')

  // —— 预览页用 difficultyStars 显示星级（与 RetryPaperPreview 同口径）——
  assert.ok(VIEW_SRC.includes('difficultyStars'), '预览页必须复用 difficultyStars 工具，确保与组卷预览同口径')
  assert.ok(VIEW_SRC.includes('item-diff'), '预览页每题必须有难度星级容器')
  assert.ok(VIEW_SRC.includes('.item-diff {') || /\.item-diff\s*\{[^}]*(color|gold|#)/s.test(VIEW_SRC),
    '难度星级必须用与组卷预览页一致的金色样式')

  // —— 白板入口：把 difficulty 透传给后端，否则预览筛了、白板又拉全档 ——
  const B_SRC = readFileSync(resolve(ROOT, 'src/workbench/views/WeekendBoard.vue'), 'utf8')
  assert.ok(B_SRC.includes("Number(q.difficulty)") || B_SRC.includes("q.difficulty"),
    'WeekendBoard 必须从 query 读取 difficulty 并传给后端')
})

test('章节筛选：标准教材目录 + 树形下拉 + preview/generate/白板透传（2026-09-19）', () => {
  // 后端 lib：chapter 参数解构 + 过滤条件
  assert.ok(LIB_SRC.includes("chapter = ''"), 'buildHandout 必须解构 chapter（默认空=不限）')
  assert.ok(LIB_SRC.includes('chapterNodeIds'), '选章必须包含其全部课时子节点')
  assert.ok(
    LIB_SRC.includes('chapterIds.has(cid)'),
    '章节筛选必须按标准节点 id 精确过滤，不能按 OCR 标题过滤'
  )
  // 路由透传
  assert.ok(ROUTE_SRC.includes("chapter: str(body.chapter)"), 'sanitizeParams 必须取 chapter')

  // 前端：树形下拉 + 参数 + 透传
  assert.ok(VIEW_SRC.includes('el-tree-select'), '必须用 Element Plus 树形下拉')
  assert.ok(VIEW_SRC.includes('params.chapter'), '前端参数必须包含 chapter')
  assert.ok(VIEW_SRC.includes('loadChapterTree'), '前端必须从后端接口加载章节树')
  assert.ok(VIEW_SRC.includes('按教材章节筛选'), '下拉必须有清晰的筛选提示')
  assert.ok(
    VIEW_SRC.includes('chapter: body.chapter') || VIEW_SRC.includes('chapter: params.value.chapter'),
    'buildParamsBody 必须把章节筛选发给后端'
  )
  // 白板必须从 query 读取 chapter 并传给 preview
  const B_SRC = readFileSync(resolve(ROOT, 'src/workbench/views/WeekendBoard.vue'), 'utf8')
  assert.ok(B_SRC.includes('chapter: q.chapter'), 'WeekendBoard 必须从 query 读取 chapter')
  assert.ok(ROUTE_SRC.includes("router.get('/api/weekend-ppt/chapters'"), '必须提供章节树接口')
})
