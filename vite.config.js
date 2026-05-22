import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\./,
            handler: 'CacheFirst',
            options: {
              cacheName: 'oss-cdn-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30天
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
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7天
              }
            }
          }
        ]
      },
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
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Core framework - always loaded first
          if (id.includes('node_modules/react/') || 
              id.includes('node_modules/react-dom/') || 
              id.includes('node_modules/scheduler/')) {
            return 'react-core'
          }
          
          // UI libraries - defer until needed
          if (id.includes('node_modules/motion/') || 
              id.includes('node_modules/framer-motion/')) {
            return 'motion'
          }
          
          if (id.includes('node_modules/lucide-react/')) {
            return 'lucide-icons'
          }
          
          // PDF generation - only needed for specific features
          if (id.includes('node_modules/jspdf/') || 
              id.includes('node_modules/html2canvas/') || 
              id.includes('node_modules/rgbcolor/') || 
              id.includes('node_modules/fflate/')) {
            return 'pdf-generator'
          }
          
          // QR code libraries
          if (id.includes('node_modules/qrcode.react/') || 
              id.includes('node_modules/qrcode-generator/')) {
            return 'qr-code'
          }
          
          // Other UI components
          if (id.includes('node_modules/antd-mobile/') || 
              id.includes('node_modules/@rc-component/')) {
            return 'antd-mobile'
          }
          
          // Other vendor libs
          if (id.includes('node_modules/dayjs/') || 
              id.includes('node_modules/axios/') || 
              id.includes('node_modules/zustand/')) {
            return 'vendor-utils'
          }
          
          return null
        },
        // Optimize chunk naming for better caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      }
    },
    // Enable CSS code splitting
    cssCodeSplit: true,
    // Optimize build for faster loading
    target: 'es2020',
    // Reduce chunk size warning threshold
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
    }
  }
}))
