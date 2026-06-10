import { createRouter, createWebHistory } from 'vue-router'
import ExamWorkbench from '../views/ExamWorkbench.vue'

const routes = [
  {
    path: '/exam-workbench',
    name: 'ExamWorkbench',
    component: ExamWorkbench,
    meta: { requiresPC: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫：PC检测
router.beforeEach((to, from, next) => {
  if (to.meta.requiresPC && window.innerWidth < 1200) {
    window.location.href = '/'
    return
  }
  next()
})

export default router
