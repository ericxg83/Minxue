import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import fs from 'fs'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    vue(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@workbench': resolve(__dirname, 'src/workbench')
    }
  },
  build: {
    rollupOptions: {
      input: {
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

