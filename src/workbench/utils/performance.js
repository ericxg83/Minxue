/**
 * 防抖函数 - 延迟执行，多次触发只执行最后一次
 * @param {Function} fn 要执行的函数
 * @param {number} delay 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce(fn, delay = 300) {
  let timer = null
  return function(...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn.apply(this, args)
    }, delay)
  }
}

/**
 * 节流函数 - 限制执行频率，固定时间内只执行一次
 * @param {Function} fn 要执行的函数
 * @param {number} delay 时间间隔（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(fn, delay = 300) {
  let lastTime = 0
  return function(...args) {
    const now = Date.now()
    if (now - lastTime >= delay) {
      lastTime = now
      fn.apply(this, args)
    }
  }
}

/**
 * 批量操作收集器 - 收集多个操作，延迟后一次性执行
 * @param {Function} fn 批量处理函数
 * @param {number} delay 延迟时间（毫秒）
 * @returns {Object} { add, flush, clear }
 */
export function createBatchCollector(fn, delay = 1000) {
  let items = []
  let timer = null

  const flush = () => {
    if (items.length > 0) {
      fn(items)
      items = []
    }
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const add = (item) => {
    items.push(item)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delay)
  }

  const clear = () => {
    items = []
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { add, flush, clear }
}
