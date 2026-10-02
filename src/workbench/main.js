import { createApp } from 'vue'
import 'katex/dist/katex.min.css'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/workbench-theme.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

const app = createApp(App)

// 全局错误处理（2026-10-02 补护栏）：渲染函数抛错时 Vue 默认只写 console，
// 页面会静默冻结——成长中心孤儿页曾因此带病运行数月无人知晓。
// 这里在控制台保留完整信息的同时，每次会话向负责人弹一次可见提示。
import { ElMessage } from 'element-plus'
let workbenchErrorToastShown = false
app.config.errorHandler = (err, _instance, info) => {
  console.error(`[工作台异常] ${info}:`, err)
  if (!workbenchErrorToastShown) {
    workbenchErrorToastShown = true
    try {
      ElMessage.error(`页面出现异常（${info}），部分内容可能未更新，请刷新页面；详情见控制台`)
    } catch { /* 提示失败不影响主流程 */ }
  }
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// 注册所有图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.mount('#workbench-app')

