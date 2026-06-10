import { createRouter, createWebHashHistory } from 'vue-router'
import ExamWorkbench from '../views/ExamWorkbench.vue'

const routes = [
  {
    path: '/',
    name: 'ExamWorkbench',
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
