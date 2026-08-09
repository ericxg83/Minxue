// 本应用不需要 Service Worker（全站已禁用缓存，每次部署应立即生效）。
// 此脚本用于强制退役历史遗留的旧 SW：一旦部署，用户设备上的旧 SW
// 会检测到本文件内容变化 -> 安装 -> 立即激活 -> 清空缓存 -> 注销自身，
// 此后页面完全走网络加载最新版本。
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
    } catch (e) { /* ignore */ }
    try {
      await self.registration.unregister()
    } catch (e) { /* ignore */ }
  })())
  return self.clients.claim()
})
