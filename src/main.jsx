import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { ToastProvider } from './components/ToastProvider.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import 'katex/dist/katex.min.css'
import './index.css'

// ── 禁用 PWA 缓存：主动注销任何已注册的 Service Worker ──
// 避免浏览器继续用旧缓存的 JS/CSS，导致线上更新看不到新版本
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => registration.unregister())
    }).then(() => {
      if (navigator.serviceWorker.controller) {
        // 清除缓存存储
        if (window.caches) {
          caches.keys().then(keys => {
            keys.forEach(key => caches.delete(key))
          })
        }
      }
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
