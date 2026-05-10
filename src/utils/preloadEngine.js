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

  preloadPage = async (pageName, studentId, options = {}) => {
    const { priority = 'normal', delay = 0 } = options
    const cacheKey = `${pageName}_${studentId}`

    if (this.preloadedPages.has(cacheKey)) return

    const config = PRELOAD_CONFIG[pageName]
    if (!config) return

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    const cached = cacheManager.get(`${pageName}_${studentId}`)
    if (cached.data && !cached.stale) {
      this.preloadedPages.add(cacheKey)
      return
    }

    const controller = new AbortController()
    this.abortControllers.set(cacheKey, controller)

    try {
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
    const { getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent, getQuestionsByTask } =
      await import('../services/apiService')

    switch (pageName) {
      case 'processing':
        await getTasksByStudent(studentId, true)
        break
      case 'pending': {
        const tasks = await getTasksByStudent(studentId, true)
        if (tasks && tasks.length > 0) {
          const doneTasks = tasks.filter(t => t.status === 'done')
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

  smartPreload = (currentPage, studentId) => {
    if (!studentId) return

    const targets = PAGE_PRELOAD_MAP[currentPage]
    if (!targets) return

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

  hoverPreload = (targetPage, studentId) => {
    if (!studentId) return
    this._hoverTimer && clearTimeout(this._hoverTimer)
    this._hoverTimer = setTimeout(() => {
      this.preloadPage(targetPage, studentId, { priority: 'high', delay: 0 })
    }, 100)
  }

  cancelHoverPreload = () => {
    this._hoverTimer && clearTimeout(this._hoverTimer)
  }

  cancelAll = () => {
    for (const [key, controller] of this.abortControllers) {
      controller.abort()
    }
    this.abortControllers.clear()
    this.queue = []
  }

  reset = () => {
    this.preloadedPages.clear()
    this.cancelAll()
  }
}

export const preloadEngine = new PreloadEngine()
export default preloadEngine
