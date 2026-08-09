import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { ToastProvider } from './components/ToastProvider.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import 'katex/dist/katex.min.css'
import './index.css'

// ── 禁用 PWA 缓存：主动注销任何已注册的 Service Worker ──
// 本应用无缓存需求，必须让每次部署的最新版立即生效。
// 立即执行（不等 load），避免旧 SW 抢在注销前用旧缓存渲染页面。
;(function disableServiceWorkerCache() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => registration.unregister())
    })
  } catch (e) { /* ignore */ }
  // 清除 SW 留下的缓存存储
  if (typeof window !== 'undefined' && window.caches) {
    window.caches.keys().then(keys => {
      keys.forEach(key => window.caches.delete(key))
    }).catch(() => { /* ignore */ })
  }
})()

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
