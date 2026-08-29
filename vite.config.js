import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import fs from 'fs'

// App（Capacitor）构建：只打移动端入口。
// PC 工作台的 Vue + Element Plus + ECharts 链约占 dist 的 2.4MB，
// 手机 App 里永远不会打开这些页面（workbench/router/index.js 绝大多数路由
// 标了 requiresPC），没必要随 APK 分发。由 scripts/build-app.mjs 设置该标记；
// mode 仍为 production，因此 .env.production 照常生效。
const isAppBuild = process.env.BUILD_TARGET === 'app'

// App 构建时移除 index.html 里的 /workbench 重定向脚本：
// 该构建不打 workbench.html，留着这段只会把用户送到 404。
const stripWorkbenchRedirect = () => ({
  name: 'strip-workbench-redirect',
  transformIndexHtml(html) {
    if (!isAppBuild) return html
    return html.replace(
      /[ \t]*<!-- workbench-redirect:start -->[\s\S]*?<!-- workbench-redirect:end -->\n?/,
      ''
    )
  }
})

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    vue(),
    tailwindcss(),
    stripWorkbenchRedirect()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@workbench': resolve(__dirname, 'src/workbench')
    }
  },
  define: {
    // 移动端里「跳转 PC 工作台」的入口需要知道 workbench.html 是否随本次构建分发。
    // App 构建不打 workbench 入口，此时必须由 VITE_WORKBENCH_URL 指向线上 Web 工作台，
    // 否则相关入口应提示而不是跳到 404。
    __WORKBENCH_BUNDLED__: JSON.stringify(!isAppBuild)
  },
  build: {
    // App 构建输出到独立目录，避免与 Web 构建产物互相覆盖；
    // capacitor.config.json 的 webDir 指向此目录。
    outDir: isAppBuild ? 'dist-app' : 'dist',
    rollupOptions: {
      input: isAppBuild
        ? { main: resolve(__dirname, 'index.html') }
        : {
            main: resolve(__dirname, 'index.html'),
            workbench: resolve(__dirname, 'workbench.html')
          },
      output: {
        manualChunks: (id) => {
          // Vue framework
          if (id.includes('node_modules/vue/') || 
              id.includes('node_modules/@vue/') ||
              id.includes('node_modules/pinia/') ||
              id.includes('node_modules/vue-router/')) {
            return 'vue-core'
          }
          
          if (id.includes('node_modules/element-plus/')) {
            return 'element-plus'
          }
          
          // React framework
          if (id.includes('node_modules/react/') || 
              id.includes('node_modules/react-dom/') || 
              id.includes('node_modules/scheduler/')) {
            return 'react-core'
          }
          
          // UI libraries
          if (id.includes('node_modules/motion/') || 
              id.includes('node_modules/framer-motion/')) {
            return 'motion'
          }
          
          if (id.includes('node_modules/lucide-react/')) {
            return 'lucide-icons'
          }
          
          // PDF generation
          if (id.includes('node_modules/jspdf/') || 
              id.includes('node_modules/html2canvas/') || 
              id.includes('node_modules/rgbcolor/') || 
              id.includes('node_modules/fflate/')) {
            return 'pdf-generator'
          }
          
          // QR code
          if (id.includes('node_modules/qrcode.react/') || 
              id.includes('node_modules/qrcode-generator/')) {
            return 'qr-code'
          }
          
          // Other UI
          if (id.includes('node_modules/antd-mobile/') || 
              id.includes('node_modules/@rc-component/')) {
            return 'antd-mobile'
          }
          
          // Other vendor
          if (id.includes('node_modules/echarts')) {
            return 'echarts'
          }

          if (id.includes('node_modules/dayjs/') || 
              id.includes('node_modules/axios/') || 
              id.includes('node_modules/zustand/')) {
            return 'vendor-utils'
          }
          
          return null
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      }
    },
    cssCodeSplit: true,
    target: 'es2020',
    chunkSizeWarningLimit: 500,
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        // 上传PDF/图片等大文件请求可能超过默认2分钟代理超时，
        // 放宽到20分钟以匹配前端 apiService 的10分钟超时
        proxyTimeout: 20 * 60 * 1000,
        timeout: 20 * 60 * 1000,
      }
    },
    // Dev server: serve workbench.html for /workbench and /exam-workbench routes
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (
          req.url === '/workbench' || req.url.startsWith('/workbench/') ||
          req.url === '/exam-workbench' || req.url.startsWith('/exam-workbench/')
        ) {
          const html = fs.readFileSync(resolve(__dirname, 'workbench.html'), 'utf-8')
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
          return
        }
        next()
      })
    }
  },
  preview: {
    port: 4173,
    host: true
  }
}))

