import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/DashboardWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/grade',
    name: 'GradeCenter',
    component: () => import('../views/GradeCenterWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/review',
    name: 'Review',
    redirect: to => ({ path: '/grade', query: { ...to.query, source: 'homework' } }),
    meta: { requiresPC: true }
  },
  // 第 137 轮（负责人裁决②）：独立「待办」页下线——其内容（待复核/识别异常/新增错题）
  // 逐项都是首页驾驶舱 KPI + 「需要处理」提醒带 + 铃铛通知的子集，且从不进侧栏、只靠
  // 复核台空态一颗按钮触达。整页删除，复核台那颗按钮改指首页 '/'。该页非导航目标、
  // 无外部书签，不留 redirect。
  // 第 91 轮：独立的「错题中心」页面下线，错题清单并入学生档案页（#student-wrong）。
  // r260（2026-10-10 负责人拍板方案 A）：/wrongbook 复活为「错题检索」真页面——
  //   跨学生按关键字找一道题（此前唯一入口要先定学生再长下拉）。这不是 r91 下线的
  //   「错题分析页」回流：不放统计卡/图表，只做"搜题 → 去原卷编辑"一件事。
  //   学生档案页的 embedded 错题清单保持不动（单生操作场景）。
  //   老书签兜底：/wrongbook?studentId=x 仍落到那名学生的档案页（beforeEnter）。
  {
    path: '/wrongbook',
    name: 'WrongBookSearch',
    component: () => import('../views/WrongBookSearch.vue'),
    beforeEnter: (to) => (to.query.studentId ? { path: `/students/${to.query.studentId}` } : true),
    meta: { requiresPC: true }
  },
  {
    path: '/paper',
    name: 'PaperImport',
    component: () => import('../views/ExamWorkbench.vue'),
    meta: { requiresPC: true }
  },
  // 2026-09-03 简化：删了 /paper/:id/review（ExamAnswerReview）。
  // 历史书签/链接落到 /paper 列表，避免空页。
  {
    path: '/paper/:catchAll(.*)',
    redirect: '/paper'
  },
  {
    path: '/students',
    name: 'Students',
    component: () => import('../views/StudentsWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/students/:id',
    name: 'StudentDetail',
    component: () => import('../views/StudentDetailWorkbench.vue'),
    meta: { requiresPC: true }
  },
  // 第 91 轮：「成长中心」下线（它展示的每一块在学习诊断里都有对应物，唯一独有的
  // 「家长成长卡」已搬到学习诊断的输出条）。redirect 只作历史书签兜底。
  {
    path: '/growth',
    redirect: to => ({ path: '/weekly-report', query: to.query })
  },
  // 第 137 轮（负责人裁决③）：删除从未被任何导航指向的死路由 /exam-history/review。
  // 重练复核实际链路是 /grade?source=retry → /grade/task（source 走 query，不再依赖已删的 legacySource prop）。
  // /exam-history 重定向保留作历史书签兜底。
  {
    path: '/exam-history',
    name: 'ExamHistory',
    redirect: to => ({ path: '/grade', query: { ...to.query, source: 'retry' } }),
    meta: { requiresPC: true }
  },
  {
    path: '/grade/task',
    name: 'GradeTaskReview',
    component: () => import('../views/UnifiedReviewWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/question-bank',
    name: 'QuestionBank',
    component: () => import('../views/QuestionBankWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/weekly-report',
    name: 'WeeklyReport',
    component: () => import('../views/WeeklyReportWorkbench.vue'),
    meta: { requiresPC: false }
  },
  {
    path: '/worksheets',
    name: 'WorksheetMgr',
    component: () => import('../views/WorksheetManagement.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/worksheets/:id/review',
    name: 'WorksheetReview',
    component: () => import('../views/WorksheetReview.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/weekend-ppt',
    name: 'WeekendHandout',
    component: () => import('../views/WeekendHandout.vue'),
    meta: { requiresPC: false }
  },
  // 第 137 轮（负责人裁决）：「我的讲义」页面（/handouts 列表 + /handout 编辑）属伪需求，
  // 整条链路（页面、模板引擎、docx 导出、/api/handout* 路由）已下线。
  // 按「页面下线 ≠ 老书签 404」既有约定留 redirect：落到老师侧仍在用的「周末班课件」。
  {
    path: '/handouts',
    redirect: '/weekend-ppt'
  },
  {
    path: '/handout',
    redirect: '/weekend-ppt'
  },
  {
    path: '/handout/:catchAll(.*)',
    redirect: '/weekend-ppt'
  },
  {
    path: '/weekend-ppt/board',
    name: 'WeekendBoard',
    component: () => import('../views/WeekendBoard.vue'),
    meta: { requiresPC: false }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 路由守卫：PC 检测
// 历史遗留：此处 before 守卫两个分支相同（空转死代码，注释承诺的"改为显示提示"从未实现）。
// 桌面提示已由 App.vue 的 showDesktopNotice（监听 route.meta.requiresPC + window.innerWidth）承担，
// 此守卫删除后行为不变。保留空守卫以维持"这里有 PC 检测逻辑"的定位，但不再写入死代码。

// 注：实际 PC 检测实现见 App.vue#updateViewportNotice（r159 清理死代码时确认）。
export default router




