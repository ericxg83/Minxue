import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import fs from 'fs'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      manifest: {
        name: '敏学错题本',
        short_name: '敏学',
        description: '晚托班老师错题管理系统',
        theme_color: '#1677ff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\./,
            handler: 'CacheFirst',
            options: {
              cacheName: 'oss-cdn-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|webp|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60
              }
            }
          }
        ]
      }
    })
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
        target: 'http://localhost:3001',
        changeOrigin: true
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
