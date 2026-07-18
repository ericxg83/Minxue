import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { getStudents, getWrongQuestionsByStudent, getQuestionsByTask, getTasksByStudent, updateWrongQuestionStatus, updateTaskStatus, recalculateTaskStats, getLatestJudgements, clearStudentCaches, updateQuestionReviewStatus, addWrongQuestions, getGeneratedExamsByStudent, getQuestionsByIds, gradeGeneratedExam } from '../../services/apiService'
import { useLifecycleStore, LIFECYCLE_STATUS } from './lifecycleStore'
import { checkQuestionCompleteness } from '../../utils/questionCompleteness.js'
import { TASK_TYPE, getReviewConfig } from '../config/reviewConfig'

export const useReviewStore = defineStore('review', () => {
  const lifecycleStore = useLifecycleStore()
  
  // 学生列表
  const students = ref([])
  const currentStudent = ref(null)
  
  // 错题列表（从 wrong_questions 表）
  const wrongQuestions = ref([])
  
  // 当前试卷的所有题目（从 questions 表）
  const allQuestions = ref([])
  const currentTaskId = ref(null)

  // 当前选中的试卷（task 对象，含 image_url）
  const currentTask = ref(null)

  // AI 置信度阈值（低于此值标记为"待确认"）
  const confidenceThreshold = ref(0.5)

  // 当前学生的已完成任务列表
  const studentTasks = ref([])
  
  // 当前审核的题目索引
  const currentReviewIndex = ref(0)

  // 多试卷聚合：题目 → 所属任务映射（image 模式，pending 任务聚合）
  const questionToTaskMap = ref({})
  
  // 审核状态
  const reviewStatus = ref('idle') // idle, reviewing, completed

  // 该学生全部待复核试卷已完成 → 展示空状态
  const reviewAllDone = ref(false)

  // 错题拦截弹窗状态
  const wrongGateVisible = ref(false)
  const wrongGateList = ref([]) // [{ questionId, index, reason, issues? }]
  // ReviewTopBar 触发「去编辑」时记录的待编辑题目，QuestionDetailPanel 监听后打开编辑面板
  const pendingEditQuestionId = ref(null)

  // ── 批改工作台：场景模式（homework 题目校对 / paper 错题重练）──
  const taskType = ref(TASK_TYPE.HOMEWORK)
  const reviewConfig = computed(() => getReviewConfig(taskType.value))
  // 数据来源：image=学生上传图片 | paper=生成的练习卷
  const source = computed(() => reviewConfig.value.source)

  // ── 多页试卷查看 ──
  // 当前试卷（exam/task）对应的页图任务列表；currentTask 上挂载 _pageTasks（paper 模式）
  const currentPageIndex = ref(0)
  // 页图列表：image 模式 = 从 task.images JSONB 构建；paper 模式 = 该 exam 关联的答题卡 task 行
  const currentPaperPages = computed(() => {
    const t = currentTask.value
    if (!t) return []
    if (source.value === 'paper') {
      const pages = Array.isArray(t._pageTasks) ? t._pageTasks : []
      return pages.length > 0 ? pages : (t.image_url ? [t] : [])
    }
    // image 模式：从 task.images JSONB 构建页图列表（支持多页上传）
    const imgs = t.images || []
    if (Array.isArray(imgs) && imgs.length > 0) {
      return imgs.map(img => ({ ...img, id: img.id || `page-${img.page_number}` }))
    }
    return t.image_url ? [{ image_url: t.image_url, page_number: 1 }] : []
  })
  // 当前页图 URL
  const currentPageImage = computed(() => {
    // 多页练习册/多图任务：使用当前题目自身的 image_url
    const q = allQuestions.value[currentReviewIndex.value]
    if (q?.image_url && source.value === 'image') {
      return q.image_url
    }
    const pages = currentPaperPages.value
    if (pages.length === 0) return currentTask.value?.image_url || ''
    const idx = Math.min(currentPageIndex.value, pages.length - 1)
    return pages[idx]?.image_url || ''
  })
  const setPageIndex = (i) => {
    if (i >= 0 && i < currentPaperPages.value.length) {
      currentPageIndex.value = i
    }
  }
  
  // 今日统计数据
  const todayStats = ref({
    pendingReview: 0,       // 今日待审核错题数量
    pendingStudents: 0,     // 今日待处理学生数量
    newWrongQuestions: 0,   // 今日新增错题数量
    pendingPrintExams: 0    // 已生成待打印重练卷数量
  })

  // 所有题目（用于显示完整题号导航 1~N）
  const studentAllQuestions = computed(() => {
    return allQuestions.value
  })

  // 当前审核的题目（优先显示有 review_status 的，即需要人工复核的）
  const currentReviewQuestion = computed(() => {
    if (allQuestions.value.length === 0) return null
    return allQuestions.value[currentReviewIndex.value] || null
  })

  // 题目确认状态：已有人工审核记录 OR AI confidence >= 阈值
  const questionConfirmationMap = computed(() => {
    const map = {}
    for (const q of allQuestions.value) {
      const manual = !!q.review_status
      map[q.id] = manual || (q.confidence != null && q.confidence >= confidenceThreshold.value)
    }
    return map
  })

  // 复审进度
  const reviewProgress = computed(() => {
    const total = allQuestions.value.length
    const confirmed = Object.values(questionConfirmationMap.value).filter(Boolean).length
    return { total, confirmed, unconfirmed: total - confirmed, percent: total ? Math.round(confirmed / total * 100) : 0 }
  })

  // 当前试卷中「判定为错但未成功入册」的错题列表
  // - 判定为错：人工标 wrong，或 AI 判错且人工未覆盖（review_status 为空且 is_correct===false）
  // - 未入册：wrongQuestions（已按 is_complete=TRUE 过滤）中无对应记录
  // 每条附带 reason: 'complete'（可加入错题本）| 'incomplete'（题目元素不完整，需先编辑）
  const unresolvedWrongQuestions = computed(() => {
    const inBook = new Set(wrongQuestions.value.map(wq => wq.question_id))
    return allQuestions.value
      .map((q, idx) => ({ question: q, index: idx }))
      .filter(({ question: q }) => {
        const isWrong = q.review_status === 'wrong' ||
          (q.review_status == null && q.is_correct === false)
        return isWrong && !inBook.has(q.id)
      })
      .map(({ question: q, index }) => {
        const { isComplete, issues } = checkQuestionCompleteness(q)
        return {
          questionId: q.id,
          index,
          reason: isComplete ? 'complete' : 'incomplete',
          issues
        }
      })
  })

  // 获取学生待审核题目数（优化：单次遍历）
  const getStudentPendingCount = (studentId) => {
    let count = 0
    for (const wq of wrongQuestions.value) {
      if (wq.student_id === studentId && wq.lifecycle_status !== LIFECYCLE_STATUS.MASTERED) {
        count++
      }
    }
    return count
  }

  // 获取学生今日新增错题数（优化：单次遍历）
  const getStudentTodayNewCount = (studentId) => {
    const today = dayjs().format('YYYY-MM-DD')
    let count = 0
    for (const wq of wrongQuestions.value) {
      if (wq.student_id === studentId) {
        const addedDate = dayjs(wq.added_at).format('YYYY-MM-DD')
        if (addedDate === today) {
          count++
        }
      }
    }
    return count
  }

  // 获取今日统计数据（优化：单次遍历）
  const calculateTodayStats = () => {
    const today = dayjs().format('YYYY-MM-DD')

    let pendingReview = 0
    let newWrongQuestions = 0
    let pendingPrintExams = 0
    const studentIds = new Set()

    // 单次遍历计算所有统计
    for (const wq of wrongQuestions.value) {
      if (wq.lifecycle_status !== LIFECYCLE_STATUS.MASTERED) {
        pendingReview++
        studentIds.add(wq.student_id)
      }

      const addedDate = dayjs(wq.added_at).format('YYYY-MM-DD')
      if (addedDate === today && wq.lifecycle_status === LIFECYCLE_STATUS.NEW) {
        newWrongQuestions++
      }

      if (wq.lifecycle_status === LIFECYCLE_STATUS.NEW) {
        pendingPrintExams++
      }
    }

    todayStats.value = {
      pendingReview,
      pendingStudents: studentIds.size,
      newWrongQuestions,
      pendingPrintExams
    }
  }

  // 加载学生列表
  const loadStudents = async () => {
    try {
      const result = await getStudents(false)
      const list = result.data || result || []
      students.value = Array.isArray(list) ? list : []
    } catch (e) {
      console.error('加载学生列表失败:', e)
      students.value = []
    }
  }

  // 加载试卷的所有题目
  // URL 归一化：去掉查询串、协议与 host，仅保留末段路径（OSS object key/文件名）。
  // 用于把题目 image_url 与 task.images 的 image_url 做鲁棒匹配——
  // 两者可能因 resolveUrl（CDN/签名）导致 host、query 不同，但对象路径稳定。
  const normalizeUrlKey = (u) => {
    if (!u || typeof u !== 'string') return ''
    const noQuery = u.split('?')[0]
    const seg = noQuery.split('/').filter(Boolean)
    return seg.slice(-2).join('/') || noQuery
  }

  // 回填 page_number：部分批改管线（如练习册路径）未给题目写入 page_number，
  // 导致分卷排序 / 卷N标注 / 中央页图同步全部塌缩到"第1页"。
  // 用题目 image_url 匹配 task.images 的上传顺序，为缺失页号的题目补上有效页号。
  const backfillPageNumbers = (list) => {
    if (list.every(q => q.page_number != null)) return
    const imgs = currentTask.value?.images
    if (!Array.isArray(imgs) || imgs.length <= 1) return
    const keyToPage = new Map()
    imgs.forEach((img, i) => {
      const k = normalizeUrlKey(img?.image_url)
      if (k) keyToPage.set(k, img.page_number || i + 1)
    })
    if (keyToPage.size === 0) return
    for (const q of list) {
      if (q.page_number != null) continue
      const k = normalizeUrlKey(q.image_url)
      if (k && keyToPage.has(k)) q.page_number = keyToPage.get(k)
    }
  }

  const loadQuestions = async (taskId) => {
    if (!taskId) return
    currentTaskId.value = taskId
    try {
      const questions = await getQuestionsByTask(taskId, false)
      const list = Array.isArray(questions) ? questions : []
      // 缺失页号时按 image_url 回填，保证多卷任务能正确分卷
      backfillPageNumbers(list)
      // 排序：先按 page_number（图片上传顺序，卷1在卷2前），再按 sort_order/sequence
      // （服务端已按 page_number + 版面 y 坐标返回，此处稳定排序不破坏页内顺序）
      allQuestions.value = list.sort((a, b) => {
        const aPage = a.page_number || 1
        const bPage = b.page_number || 1
        if (aPage !== bPage) return aPage - bPage
        const aOrder = a.sort_order || a.sequence || 0
        const bOrder = b.sort_order || b.sequence || 0
        return aOrder - bOrder
      })
    } catch (e) {
      console.error('加载题目数据失败:', e)
      allQuestions.value = []
    }
  }

  // 加载错题数据
  const loadWrongQuestions = async (studentId) => {
    if (!studentId) return
    try {
      const data = await getWrongQuestionsByStudent(studentId, false)
      wrongQuestions.value = (Array.isArray(data) ? data : []).map(wq => ({
        ...wq,
        lifecycle_status: wq.lifecycle_status || LIFECYCLE_STATUS.NEW
      }))
    } catch (e) {
      console.error('加载错题数据失败:', e)
      wrongQuestions.value = []
    }
  }

  // 初始化数据
  const initData = async () => {
    // 加载学生列表
    await loadStudents()

    // 默认选择第一个学生（无论是否有错题）
    const firstStudent = students.value[0]
    if (firstStudent) {
      setCurrentStudent(firstStudent)
      // 并行加载：已完成任务 + 错题数据，减少串行等待
      await Promise.all([
        loadStudentTasks(firstStudent.id),
        loadWrongQuestions(firstStudent.id)
      ])
      // 自动选择第一份待复核试卷；无则展示空状态
      await autoSelectPendingTask()
    }

    // 计算今日统计
    calculateTodayStats()
  }

  // 自动选择第一份「待复核」试卷（status === 'done'）。
  // 无待复核试卷时，不自动打开已复核试卷，而是清空当前上下文并展示空状态。
  // 已复核试卷仍可通过顶部「选择试卷」下拉手动查看。
  const autoSelectPendingTask = async () => {
    const firstPending = studentTasks.value.find(t => t.status === 'done')
    if (firstPending) {
      await selectTask(firstPending)
      return firstPending
    }
    // 无待复核 → 空状态：清空当前试卷 / 题目，避免残留已复核试卷
    currentTask.value = null
    allQuestions.value = []
    currentReviewIndex.value = 0
    questionToTaskMap.value = {}
    reviewAllDone.value = true
    return null
  }

  // 设置当前学生
  const setCurrentStudent = (student) => {
    currentStudent.value = student
    currentReviewIndex.value = 0
    reviewStatus.value = allQuestions.value.length > 0 ? 'reviewing' : 'completed'
    reviewAllDone.value = false
  }

  // 下一题
  const nextQuestion = () => {
    if (currentReviewIndex.value < allQuestions.value.length - 1) {
      currentReviewIndex.value++
      syncPageForCurrentQuestion()
      return true
    }
    return false
  }

  // 上一题
  const prevQuestion = () => {
    if (currentReviewIndex.value > 0) {
      currentReviewIndex.value--
      syncPageForCurrentQuestion()
      return true
    }
    return false
  }

  // 跳转到指定题目
  const jumpToQuestion = (idx) => {
    if (idx >= 0 && idx < allQuestions.value.length) {
      currentReviewIndex.value = idx
      syncPageForCurrentQuestion()
    }
  }

  // 题目切换时同步页面索引：使 PaperViewerPanel 显示当前题目所在页的图片
  const syncPageForCurrentQuestion = () => {
    const q = allQuestions.value[currentReviewIndex.value]
    if (!q) return
    const pageNum = q.page_number || 1
    const pages = currentPaperPages.value
    const idx = pages.findIndex(p => p.page_number === pageNum)
    if (idx >= 0 && idx !== currentPageIndex.value) {
      currentPageIndex.value = idx
    }
  }

  // 审核错题（统一入口，按 taskType 分支业务逻辑）
  const reviewQuestion = (questionId, result) => {
    const question = allQuestions.value.find(q => q.id === questionId)
    if (!question) return

    // ── 完整逻辑（完整性校验 + 错题本同步） ──
    // 完整性检查 — 标记"错误"时，不完整的题目不进错题本
    if (result === 'wrong') {
      const { isComplete, issues } = checkQuestionCompleteness(question)
      if (!isComplete) {
        return { blocked: true, issues, questionId }
      }
    }

    // Store manual review status on the question
    question.review_status = result

    // 持久化 review_status 到数据库
    updateQuestionReviewStatus(questionId, result).catch(e =>
      console.error(`review_status 持久化失败 q=${questionId.substring(0, 8)}:`, e.message)
    )

    // Also update the wrong question if it exists
    const wq = wrongQuestions.value.find(w => w.question_id === questionId)
    if (wq) {
      const currentStatus = wq.lifecycle_status || LIFECYCLE_STATUS.NEW

      switch (result) {
        case 'correct':
          // [Bugfix] 人工确认做对 → 直接标记为已掌握，不再渐进式推进
          wq.lifecycle_status = LIFECYCLE_STATUS.MASTERED
          wq.status = 'mastered'
          wq.practice_count = (wq.practice_count || 0) + 1
          break
        case 'wrong':
          wq.lifecycle_status = LIFECYCLE_STATUS.NEW
          wq.status = 'pending'
          wq.error_count = (wq.error_count || 0) + 1
          break
        case 'exclude':
          wq.lifecycle_status = LIFECYCLE_STATUS.EXCLUDED
          wq.status = 'excluded'
          break
      }

      // [P0-3c] 持久化审核结果到数据库
      updateWrongQuestionStatus(wq.id, wq.status, {
        lifecycle_status: wq.lifecycle_status
      }).catch(e => console.error(`[P0-3c] 审核结果持久化失败 wq=${wq.id.substring(0, 8)}:`, e.message))
    }

    // 重新计算统计
    calculateTodayStats()

    // 自动进入下一题
    if (!nextQuestion()) {
      // 最后一道题已复核 → 自动完成复核 + 进入下一份
      reviewStatus.value = 'completed'
      // 延迟触发自动保存和跳转，让 UI 先更新
      setTimeout(() => autoCompleteAndAdvance(), 300)
    }
  }

  // 仅写入 source_type（留给错题重练模式标记复核来源）
  // 自动完成复核并跳转到下一份试卷
  const autoCompleteAndAdvance = async () => {
    if (!currentTask.value) return
    // 门禁：存在未入册错题则拦截，弹清单等用户处理（不标记复核、不跳转）
    const list = getUnresolvedWrong()
    if (list.length > 0) {
      openWrongGate(list)
      return
    }
    // 聚合模式：一次性完成所有待复核任务
    const isAggregated = source.value === 'image' && Object.keys(questionToTaskMap.value).length > 0
    if (isAggregated) {
      const pending = studentTasks.value.filter(t => t.status === 'done')
      for (const task of pending) {
        await persistTaskCompletion(task)
      }
      if (currentStudent.value?.id) {
        clearStudentCaches(currentStudent.value.id)
      }
      await loadStudentTasks(currentStudent.value.id)
      allQuestions.value = []
      questionToTaskMap.value = {}
      currentTask.value = null
      currentReviewIndex.value = 0
      reviewAllDone.value = true
      return
    }
    // 原有单试卷流程
    await persistTaskCompletion(currentTask.value)
    currentTask.value.status = 'reviewed'
    if (currentStudent.value?.id) {
      clearStudentCaches(currentStudent.value.id)
    }
    // 刷新任务列表
    await loadStudentTasks(currentStudent.value.id)
    // 确保刚复核的试卷始终在 studentTasks 中
    if (currentTask.value && !studentTasks.value.some(t => t.id === currentTask.value.id)) {
      studentTasks.value.push({ ...currentTask.value })
      const sorter = { done: 0, reviewed: 1 }
      studentTasks.value.sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))
    }
    // 自动进入下一份试卷；无则全部完成 → 空状态
    const next = nextTask()
    if (next) {
      await selectTask(next)
    } else {
      reviewAllDone.value = true
    }
  }

  // 加载当前学生的已完成任务列表（含 done 和 reviewed）
  const loadStudentTasks = async (studentId) => {
    // paper 模式：练习卷列表映射为统一的 studentTasks 语义
    if (source.value === 'paper') {
      return loadStudentPapers(studentId)
    }
    try {
      const tasks = await getTasksByStudent(studentId, false)
      // 纳入 done 和 reviewed，按 status 排序：done 优先
      const sorter = { done: 0, reviewed: 1 }
      studentTasks.value = (tasks || [])
        .filter(t => t.status === 'done' || t.status === 'reviewed')
        .sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))
    } catch (e) {
      console.error('加载学生任务失败:', e)
      studentTasks.value = []
    }
  }

  // paper 模式：加载练习卷（generated_exams），映射为统一 task 结构
  // status: ungraded/grading → 'done'(待复核) ; graded → 'reviewed'(已复核)
  const loadStudentPapers = async (studentId) => {
    try {
      const [exams, tasks] = await Promise.all([
        getGeneratedExamsByStudent(studentId, false),
        getTasksByStudent(studentId, false)
      ])
      // 按 generated_exam_id 归拢答题卡页图（每张上传照片一行 task）
      const pagesByExam = {}
      for (const t of (tasks || [])) {
        const gid = t.generated_exam_id
        if (!gid) continue
        ;(pagesByExam[gid] = pagesByExam[gid] || []).push(t)
      }
      for (const gid of Object.keys(pagesByExam)) {
        pagesByExam[gid].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      }
      const sorter = { done: 0, reviewed: 1 }
      studentTasks.value = (Array.isArray(exams) ? exams : []).map(exam => {
        const pages = pagesByExam[exam.id] || []
        return {
          // 统一 task 语义（复用 topbar/缩略图/完成逻辑）
          id: exam.id,
          original_name: exam.name || '未命名练习卷',
          status: exam.status === 'graded' ? 'reviewed' : 'done',
          image_url: pages[0]?.image_url || '',
          // paper 专属：题目 ID 列表 + 多页图任务
          _questionIds: exam.question_ids || [],
          _pageTasks: pages,
          _isPaper: true,
        }
      }).sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))
    } catch (e) {
      console.error('加载练习卷失败:', e)
      studentTasks.value = []
    }
  }

  // 待复核试卷（status === 'done'）
  const pendingTasks = computed(() =>
    studentTasks.value.filter(t => t.status === 'done')
  )

  // 已复核试卷（status === 'reviewed'）
  const reviewedTasks = computed(() =>
    studentTasks.value.filter(t => t.status === 'reviewed')
  )

  // 其他待复核页（同一份练习卷的其他答题卡页图，不是其他试卷）
  const otherPendingPages = computed(() => {
    const t = currentTask.value
    if (!t || source.value !== 'paper') return []
    const pages = Array.isArray(t._pageTasks) ? t._pageTasks : []
    if (pages.length <= 1) return []
    return pages.filter((_, i) => i !== currentPageIndex.value)
  })

  // 加载所有待复核试卷的题目（image 模式：多试卷聚合）
  const loadAllPendingQuestions = async () => {
    const pending = studentTasks.value.filter(t => t.status === 'done')
    const allQs = []
    const map = {}
    for (const task of pending) {
      try {
        const questions = await getQuestionsByTask(task.id, false)
        const sorted = (Array.isArray(questions) ? questions : []).sort((a, b) => {
          const aOrder = a.sort_order || a.sequence || 0
          const bOrder = b.sort_order || b.sequence || 0
          return aOrder - bOrder
        })
        for (const q of sorted) {
          map[q.id] = task.id
        }
        allQs.push(...sorted)
      } catch (e) {
        console.error(`loadAllPendingQuestions: task ${task.id} 加载题目失败:`, e)
      }
    }
    allQuestions.value = allQs
    questionToTaskMap.value = map
  }

  // 选择试卷 → 加载题目 + 判定数据 + 错题数据
  const selectTask = async (task) => {
    currentTask.value = task
    currentReviewIndex.value = 0
    currentPageIndex.value = 0
    reviewStatus.value = 'reviewing'
    reviewAllDone.value = false
    questionToTaskMap.value = {}

    if (source.value === 'paper') {
      await loadPaperQuestions(task)
    } else {
      // image 模式：只加载选中任务的题目，不聚合其他待复核任务
      await loadQuestions(task.id)
    }

    // [修复] 加载最新判定数据（含 confidence），合并到每道题
    if (currentStudent.value?.id && allQuestions.value.length > 0) {
      await mergeJudgements(currentStudent.value.id, allQuestions.value)
    }

    // 同步当前题目所在页，确保 PaperViewerPanel 显示正确页图
    syncPageForCurrentQuestion()

    if (currentStudent.value?.id) {
      await loadWrongQuestions(currentStudent.value.id)
    }
  }

  // paper 模式：按练习卷 question_ids 拉取题目，保持 question_ids 顺序
  const loadPaperQuestions = async (task) => {
    const ids = task?._questionIds || []
    currentTaskId.value = task?.id || null
    if (ids.length === 0) {
      allQuestions.value = []
      return
    }
    try {
      const fetched = await getQuestionsByIds(ids, currentStudent.value?.id)
      const list = Array.isArray(fetched) ? fetched : []
      // 按 question_ids 原始顺序排列
      allQuestions.value = list.slice().sort((a, b) => {
        const ai = ids.indexOf(a.id)
        const bi = ids.indexOf(b.id)
        return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi)
      })
    } catch (e) {
      console.error('加载练习卷题目失败:', e)
      allQuestions.value = []
    }
  }

  // 从 judgements 表合并 confidence 到 questions
  const mergeJudgements = async (studentId, questions) => {
    try {
      const qIds = questions.map(q => q.id).filter(Boolean)
      if (qIds.length === 0) return
      const result = await getLatestJudgements(studentId, qIds)
      const judgements = result.judgements || []
      if (!Array.isArray(judgements) || judgements.length === 0) return

      const judgeMap = {}
      for (const j of judgements) {
        if (j.question_id) judgeMap[j.question_id] = j
      }

      for (const q of questions) {
        const j = judgeMap[q.id]
        if (j) {
          q.confidence = j.confidence
          // 若 question 本身没有 is_correct，从 judgement 补充
          if (q.is_correct == null && j.is_correct != null) {
            q.is_correct = j.is_correct
          }
        }
      }
    } catch (e) {
      console.error('合并判定数据失败:', e)
    }
  }

  // ── 批改工作台：场景模式控制 ──

  // 设置当前批改场景（保留接口，当前仅 homework）
  const setTaskType = (type) => {
    taskType.value = type || TASK_TYPE.HOMEWORK
  }

  // 退出批改时重置为默认模式
  const resetReviewMode = () => {
    taskType.value = TASK_TYPE.HOMEWORK
    currentPageIndex.value = 0
  }

  // 获取人工复核进度
  const getManualReviewProgress = () => {
    const total = allQuestions.value.length
    if (total === 0) return { reviewed: 0, total: 0, percent: 0 }
    const reviewed = allQuestions.value.filter(q => q.review_status).length
    return { reviewed, total, percent: Math.round((reviewed / total) * 100) }
  }

  // 获取题目状态
  const getQuestionReviewStatus = (question) => {
    return question.review_status || null
  }

  // ── 5 态语义判定（用于左侧图标 / 顶部统计）──────────────────────
  // 返回：correct（AI正确）| wrong（AI错误）| pending（待复核）| exception（AI异常）| processing（处理中）
  // 优先用既有人工复核结果，其次 AI 判定字段。
  const getAiState = (q) => {
    if (!q) return 'processing'

    // 人工已复核 → 以人工结论为最高优先级
    if (q.review_status === 'correct') return 'correct'
    if (q.review_status === 'wrong') return 'wrong'

    // AI 异常：未识别答案 / OCR 失败
    if (q.answer_source === 'blank') return 'exception'

    // 处理中：AI 尚未出任何判定
    if (q.is_correct == null && q.confidence == null) return 'processing'

    // AI 错误：判定学生答案错误
    if (q.is_correct === false) return 'wrong'

    // AI 正确 + 已确认（人工复核 或 置信度达标）
    const manual = !!q.review_status
    const confirmed = manual || (q.confidence != null && q.confidence >= confidenceThreshold.value)
    if (q.is_correct === true && confirmed) return 'correct'

    // 其余 → 待复核（置信度不足 / AI 不确定）
    return 'pending'
  }

  // 5 态数量汇总（用于顶部统计）
  const aiStateStats = computed(() => {
    const stats = { correct: 0, wrong: 0, pending: 0, exception: 0, processing: 0 }
    for (const q of allQuestions.value) {
      stats[getAiState(q)]++
    }
    return stats
  })

  // 需要老师处理的题数（待复核 + 异常 + 处理中）
  const needsAttentionCount = computed(() => {
    const s = aiStateStats.value
    return s.pending + s.exception + s.processing
  })

  // 跳到下一份试卷（仅在 done 的待复核试卷中导航）
  const nextTask = () => {
    if (!currentTask.value || pendingTasks.value.length === 0) return null
    const idx = pendingTasks.value.findIndex(t => t.id === currentTask.value.id)
    if (idx < pendingTasks.value.length - 1) {
      return pendingTasks.value[idx + 1]
    }
    return null // 已经是最后一份
  }

  // 持久化「完成复核」：按数据来源分支落库
  // - image：刷新任务统计 + 标记 task=reviewed
  // - paper：按各题正误调用 gradeGeneratedExam（掌握度进阶 + 标记 exam=graded）
  const persistTaskCompletion = async (task) => {
    if (!task) return
    if (source.value === 'paper') {
      const results = allQuestions.value
        .map(q => ({ questionId: q.id, isCorrect: effectiveIsCorrect(q) }))
        .filter(r => r.isCorrect != null)
      if (results.length > 0 && currentStudent.value?.id) {
        await gradeGeneratedExam(task.id, currentStudent.value.id, results).catch(e =>
          console.error('保存练习卷批改结果失败:', e.message)
        )
      }
      return
    }
    // image 模式
    await recalculateTaskStats(task.id).catch(e =>
      console.error('刷新统计数据失败:', e.message)
    )
    await updateTaskStatus(task.id, 'reviewed').catch(e =>
      console.error('保存复核状态失败:', e.message)
    )
  }

  // 结合人工复核结果得到每题最终正误（供 paper 提交）
  const effectiveIsCorrect = (q) => {
    if (q.review_status === 'correct') return true
    if (q.review_status === 'wrong') return false
    if (q.review_status === 'exclude') return null // 排除不计入
    return q.is_correct ?? null
  }

  // 完成任务复核：将试卷标记为 reviewed，清理缓存
  const completeTaskReview = async () => {
    if (!currentTask.value) return

    // 聚合模式：一次性完成所有待复核任务（所有试卷一起复核完成）
    const isAggregated = Object.keys(questionToTaskMap.value).length > 0
    if (isAggregated) {
      const pending = studentTasks.value.filter(t => t.status === 'done')
      for (const task of pending) {
        await persistTaskCompletion(task)
      }
      if (currentStudent.value?.id) {
        clearStudentCaches(currentStudent.value.id)
        await loadStudentTasks(currentStudent.value.id)
      }
      allQuestions.value = []
      questionToTaskMap.value = {}
      currentTask.value = null
      currentReviewIndex.value = 0
      reviewAllDone.value = true
      return
    }

    // 原有单试卷逻辑
    await persistTaskCompletion(currentTask.value)
    currentTask.value.status = 'reviewed'
    if (currentStudent.value?.id) {
      clearStudentCaches(currentStudent.value.id)
      await loadStudentTasks(currentStudent.value.id)
    }
    // 确保刚复核的试卷始终在 studentTasks 中（即使服务端返回有延迟）
    if (currentTask.value && !studentTasks.value.some(t => t.id === currentTask.value.id)) {
      studentTasks.value.push({ ...currentTask.value })
      const sorter = { done: 0, reviewed: 1 }
      studentTasks.value.sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))
    }
    // 还有待复核试卷 → 重新聚合加载题目；无 → 空状态
    const next = nextTask()
    if (next) {
      await selectTask(next)
    } else {
      allQuestions.value = []
      questionToTaskMap.value = {}
      currentTask.value = null
      currentReviewIndex.value = 0
      reviewAllDone.value = true
    }
  }

  // ── 错题拦截门禁 ──────────────────────────────────────────

  // 返回当前试卷未入册错题清单（供按钮点击 / 自动完成时校验）
  const getUnresolvedWrong = () => unresolvedWrongQuestions.value

  // 弹出错题拦截清单
  const openWrongGate = (list) => {
    wrongGateList.value = Array.isArray(list) ? list : []
    wrongGateVisible.value = true
  }

  // 弹窗中单题是否已成功入册（用于显示「已加入 ✓」）
  const isQuestionInBook = (questionId) =>
    wrongQuestions.value.some(wq => wq.question_id === questionId)

  // 将一道题加入错题本（仅对完整题有效；不完整题服务端会跳过）
  const addQuestionToBook = async (questionId) => {
    const studentId = currentStudent.value?.id
    if (!studentId || !questionId) return
    await addWrongQuestions(studentId, [questionId]).catch(e =>
      console.error('加入错题本失败:', e.message)
    )
    if (studentId) {
      clearStudentCaches(studentId)
      await loadWrongQuestions(studentId)
    }
  }

  // ReviewTopBar 触发「去编辑」：跳到该题并通知详情面板打开编辑
  const focusQuestionForEdit = (questionId) => {
    const idx = allQuestions.value.findIndex(q => q.id === questionId)
    if (idx >= 0) {
      jumpToQuestion(idx)
      pendingEditQuestionId.value = questionId
    }
    wrongGateVisible.value = false
  }

  return {
    students,
    currentStudent,
    wrongQuestions,
    allQuestions,
    currentReviewIndex,
    currentTaskId,
    reviewStatus,
    todayStats,
    studentAllQuestions,
    currentReviewQuestion,
    getStudentPendingCount,
    getStudentTodayNewCount,
    calculateTodayStats,
    loadStudents,
    loadWrongQuestions,
    loadQuestions,
    initData,
    setCurrentStudent,
    nextQuestion,
    prevQuestion,
    jumpToQuestion,
    reviewQuestion,
    getManualReviewProgress,
    getQuestionReviewStatus,
    // 5 态语义判定
    getAiState,
    aiStateStats,
    needsAttentionCount,
    // 新增
    currentTask,
    confidenceThreshold,
    studentTasks,
    questionConfirmationMap,
    reviewProgress,
    loadStudentTasks,
    selectTask,
    autoSelectPendingTask,
    nextTask,
    completeTaskReview,
    autoCompleteAndAdvance,
    otherPendingPages,
    pendingTasks,
    reviewedTasks,
    // 复核完成门禁 / 空状态
    reviewAllDone,
    wrongGateVisible,
    wrongGateList,
    pendingEditQuestionId,
    unresolvedWrongQuestions,
    getUnresolvedWrong,
    openWrongGate,
    addQuestionToBook,
    focusQuestionForEdit,
    isQuestionInBook,
    // 批改工作台：场景模式
    taskType,
    reviewConfig,
    source,
    setTaskType,
    resetReviewMode,
    // 多页试卷查看
    currentPageIndex,
    currentPaperPages,
    currentPageImage,
    setPageIndex,
    // 多试卷聚合
    questionToTaskMap,
    loadAllPendingQuestions
  }
})
