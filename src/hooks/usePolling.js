import { useEffect, useRef } from 'react'

/**
 * 统一轮询 hook —— 集中管理页面级轮询：
 *  - 页面隐藏(background tab / 熄屏)时暂停，恢复可见时立即补一次
 *  - 组件卸载自动清理
 *  - 同一时刻多个轮询各自独立 interval（无共享心跳，保证简单可靠）
 *
 * @param {() => void} fn      轮询回调（建议内部做幂等/去重）
 * @param {number} interval    轮询间隔 ms
 * @param {boolean} enabled    是否启用（false 时完全不启动）
 * @param {Array} deps         effect 依赖，变化时重建轮询
 */
export function usePolling(fn, interval, enabled = true, deps = []) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return

    const tick = () => {
      if (!document.hidden) fnRef.current()
    }

    // 立即执行一次
    tick()

    const timer = setInterval(tick, interval)

    // 页面恢复可见时立即补一次，无需等下一个 interval
    const onVisibility = () => {
      if (!document.hidden) fnRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, interval, ...deps])
}
