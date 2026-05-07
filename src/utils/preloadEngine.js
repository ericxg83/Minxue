import cacheManager from './cacheManager'

const PRELOAD_CONFIG = {
  processing: ['tasks'],
  pending: ['tasks', 'pendingQuestions'],
  wrongbook: ['wrongQuestions'],
  exam: ['generatedExams']
}

const PAGE_PRELOAD_MAP = {
  processing: ['pending'],
  pending: ['wrongbook', 'processing'],
  wrongbook: ['exam', 'pending'],
  exam: ['wrongbook']
}

class PreloadEngine {
  constructor() {
    this.queue = []
    this.isProcessing = false
    this.preloadedPages = new Set()
    this.abortControllers = new Map()
  }

  // 预加载指定页面的数据
  preloadPage = async (pageName, studentId, options = {}) => {
    const { priority = 'normal', delay = 0 } = options
    const cacheKey = `${pageName}_${studentId}`

    if (this.preloadedPages.has(cacheKey)) return

    const config = PRELOAD_CONFIG[pageName]
    if (!config) return

    // 延迟预加载，避免阻塞当前操作
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    // 检查是否已缓存
    const cached = cacheManager.get(`${pageName}_${studentId}`)
    if (cached.data && !cached.stale) {
      this.preloadedPages.add(cacheKey)
      return
    }

    // 创建 abort controller 支持取消
    const controller = new AbortController()
    this.abortControllers.set(cacheKey, controller)

    try {
      // 根据页面类型执行对应的预加载逻辑
      await this.executePreload(pageName, studentId, controller.signal)
      this.preloadedPages.add(cacheKey)
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.debug(`Preload ${pageName} failed:`, error)
      }
    } finally {
      this.abortControllers.delete(cacheKey)
    }
  }

  executePreload = async (pageName, studentId, signal) => {
    const { getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent } =
      await import('../services/supabaseService')

    switch (pageName) {
      case 'processing':
        await getTasksByStudent(studentId, true)
        break
      case 'pending': {
        const tasks = await getTasksByStudent(studentId, true)
        if (tasks && tasks.length > 0) {
          const doneTasks = tasks.filter(t => t.status === 'done')
          const { getQuestionsByTask } = await import('../services/supabaseService')
          await Promise.all(
            doneTasks.slice(0, 3).map(t => getQuestionsByTask(t.id, true))
          )
        }
        break
      }
      case 'wrongbook':
        await getWrongQuestionsByStudent(studentId, true)
        break
      case 'exam':
        await getGeneratedExamsByStudent(studentId, true)
        break
      default:
        break
    }

    if (signal.aborted) throw new Error('AbortError')
  }

  // 智能预加载：根据当前页面预测下一页
  smartPreload = (currentPage, studentId) => {
    if (!studentId) return

    const targets = PAGE_PRELOAD_MAP[currentPage]
    if (!targets) return

    // 使用 requestIdleCallback 在空闲时预加载
    const schedulePreload = (target, index) => {
      const delay = 500 + index * 300

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => {
          this.preloadPage(target, studentId, { delay: 0 })
        }, { timeout: delay })
      } else {
        setTimeout(() => {
          this.preloadPage(target, studentId, { delay: 0 })
        }, delay)
      }
    }

    targets.forEach((target, index) => {
      schedulePreload(target, index)
    })
  }

  // 导航悬停预加载
  hoverPreload = (targetPage, studentId) => {
    if (!studentId) return
    // 悬停时立即开始预加载（100ms防抖）
    this._hoverTimer && clearTimeout(this._hoverTimer)
    this._hoverTimer = setTimeout(() => {
      this.preloadPage(targetPage, studentId, { priority: 'high', delay: 0 })
    }, 100)
  }

  cancelHoverPreload = () => {
    this._hoverTimer && clearTimeout(this._hoverTimer)
  }

  // 取消所有预加载
  cancelAll = () => {
    for (const [key, controller] of this.abortControllers) {
      controller.abort()
    }
    this.abortControllers.clear()
    this.queue = []
  }

  // 清空预加载记录（切换学生时调用）
  reset = () => {
    this.preloadedPages.clear()
    this.cancelAll()
  }
}

export const preloadEngine = new PreloadEngine()
export default preloadEngine
