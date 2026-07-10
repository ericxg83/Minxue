import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/DashboardWorkbench.vue'),
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
  {
    path: '/growth',
    name: 'Growth',
    component: () => import('../views/GrowthWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/exam-history',
    name: 'ExamHistory',
    component: () => import('../views/ExamHistoryWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/exam-grading',
    name: 'ExamGrading',
    component: () => import('../views/ExamGradingWorkbench.vue'),
    meta: { requiresPC: true }
  },
  {
    path: '/ai-review',
    name: 'AIReview',
    component: () => import('../views/AIReviewWorkbench.vue'),
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
