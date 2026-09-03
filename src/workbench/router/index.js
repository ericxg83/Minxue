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
  {
    path: '/todo',
    name: 'Todo',
    component: () => import('../views/TodoWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/wrongbook',
    name: 'WrongBook',
    component: () => import('../views/WrongBookWorkbench.vue'),
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
  {
    path: '/growth',
    name: 'Growth',
    component: () => import('../views/GrowthWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/exam-history',
    name: 'ExamHistory',
    redirect: to => ({ path: '/grade', query: { ...to.query, source: 'retry' } }),
    meta: { requiresPC: true }
  },
  {
    path: '/exam-history/review',
    name: 'ExamHistoryReview',
    component: () => import('../views/UnifiedReviewWorkbench.vue'),
    props: { legacySource: 'retry' },
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
    path: '/handout',
    name: 'HandoutPreview',
    component: () => import('../views/HandoutPreview.vue'),
    meta: { requiresPC: false }
  },
  {
    path: '/handouts',
    name: 'HandoutList',
    component: () => import('../views/HandoutList.vue'),
    meta: { requiresPC: false }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 路由守卫：PC检测
router.beforeEach((to, from, next) => {
  if (to.meta.requiresPC && window.innerWidth < 1200) {
    // 不跳转，改为显示提示
    next()
  } else {
    next()
  }
})

export default router




