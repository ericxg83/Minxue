import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardWorkbench from '../views/DashboardWorkbench.vue'
import WrongBookWorkbench from '../views/WrongBookWorkbench.vue'
import ExamWorkbench from '../views/ExamWorkbench.vue'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: DashboardWorkbench,
    meta: { requiresPC: true }
  },
  {
    path: '/wrongbook',
    name: 'WrongBook',
    component: WrongBookWorkbench,
    meta: { requiresPC: true }
  },
  {
    path: '/paper',
    name: 'PaperImport',
    component: ExamWorkbench,
    meta: { requiresPC: true }
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
