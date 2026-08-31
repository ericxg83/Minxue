import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getStudents, getWrongQuestionsByStudent, getQuestionsByTask, getTasksByStudent, getTaskById, updateWrongQuestionStatus, updateTaskStatus, recalculateTaskStats, getLatestJudgements, clearStudentCaches, updateQuestionReviewStatus, addWrongQuestions, getGeneratedExamsByStudent, getQuestionsByIds, gradeGeneratedExam } from '../../services/apiService'
import { useLifecycleStore, LIFECYCLE_STATUS } from './lifecycleStore'
import { checkQuestionCompleteness } from '../../utils/questionCompleteness.js'
import { TASK_TYPE, getReviewConfig } from '../config/reviewConfig'
import { REVIEW_STATUS, DEFAULT_CONFIDENCE_THRESHOLD, getReviewState, needsWrongBookDecision, effectiveIsCorrect as resolveEffectiveIsCorrect } from '../../utils/reviewDecision'

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

  // AI 置信度阈值（低于此值标记为"待确认"）—— 与移动端同源
  const confidenceThreshold = ref(DEFAULT_CONFIDENCE_THRESHOLD)

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

  // ── 撤销上一笔：仅回退前端内存状态，不反向写库 ──
  // 元素：{ questionId, prevStatus, wqSnapshot }
  const reviewUndoStack = ref([])
  const canUndo = computed(() => reviewUndoStack.value.length > 0)

  // 撤销最近一次人工判定（正确/错误/排除）
  // - 恢复该题的 review_status（原为空则清空）
  // - 恢复该题对应错题记录的上一生命周期状态
  // - 不调用任何 API：避免产生反向写库，保证「撤销不改变已落库事实」
  const undoLastReview = () => {
    const last = reviewUndoStack.value.pop()
    if (!last) return false
    const q = allQuestions.value.find(item => item.id === last.questionId)
    if (q) {
      if (last.prevStatus) q.review_status = last.prevStatus
      else delete q.review_status
    }
    if (last.wqSnapshot) {
      const idx = wrongQuestions.value.findIndex(w => w.id === last.wqSnapshot.id)
      if (idx >= 0) wrongQuestions.value[idx] = { ...last.wqSnapshot }
    }
    return true
  }

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
        return needsWrongBookDecision(q, inBook.has(q.id))
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
  const reviewQuestion = (questionId, result, metadata = {}) => {
    const question = allQuestions.value.find(q => q.id === questionId)
    if (!question) return

    // ── 完整逻辑（完整性校验 + 错题本同步） ──
    // 完整性检查 — 标记"错误"时，不完整的题目不进错题本
    if (result === REVIEW_STATUS.WRONG) {
      const { isComplete, issues } = checkQuestionCompleteness(question)
      if (!isComplete) {
        return { blocked: true, issues, questionId }
      }
    }

    // 撤销快照：在变更前记录该题与错题记录的上一状态。
    // 撤销仅回退前端内存状态，不产生反向写库。
    const wq = wrongQuestions.value.find(w => w.question_id === questionId)
    reviewUndoStack.value.push({
      questionId,
      prevStatus: question.review_status || null,
      wqSnapshot: wq ? { ...wq } : null
    })
    // 限制栈深度，避免长时间批改无界增长
    if (reviewUndoStack.value.length > 20) reviewUndoStack.value.shift()

    // Store manual review status on the question
    question.review_status = result

    // 持久化 review_status 到数据库
    updateQuestionReviewStatus(questionId, result, metadata).catch(e =>
      console.error(`review_status 持久化失败 q=${questionId.substring(0, 8)}:`, e.message)
    )

    // Also update the wrong question if it exists
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

  // 按 taskId 直接定位：先 fetch task 详情反查 student_id，再切换学生并选中 task。
  // 用于 Dashboard / 其他入口只传 taskId 不传 studentId 的场景：
  // 老逻辑默认选第一个学生并从其 studentTasks 里 find(taskId)，task 在其他学生下时找不到，
  // 会落到 autoSelectPendingTask 选错学生的任务——这就是 Dashboard 圈出的 BUG 根因。
  const loadTaskById = async (taskId) => {
    try {
      const task = await getTaskById(taskId)
      if (!task) return false

      if (students.value.length === 0) {
        await loadStudents()
      }

      const targetStudentId = task.student_id || task.studentId
      const student = students.value.find(s => String(s.id) === String(targetStudentId))

      if (student && (!currentStudent.value || String(currentStudent.value.id) !== String(student.id))) {
        setCurrentStudent(student)
        await Promise.all([
          loadStudentTasks(student.id),
          loadWrongQuestions(student.id)
        ])
      }

      await selectTask(task)
      return true
    } catch (e) {
      console.error('[reviewStore] loadTaskById 失败:', e)
      return false
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
          // ⚠️ 不再用 judgement.is_correct 兜底覆盖题目状态：
          //    questions 表才是最终判题权威（Step 7 重判后写回），judgements 是审计流水，
          //    历史上还存在"答案生成前写早了的脏 ai_ocr 记录"。用它兜底会把错题显示成判定正确。
          //    这里只合并 confidence，is_correct 一律以 questions 表为准。
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
  // 返回：correct（AI正确）| wrong（AI错误）| pending（待复核）| exception（AI未判定）| processing（处理中）
  // 优先用既有人工复核结果，其次 AI 判定字段。
  // 题目的 5 态判定 —— 实现见 src/utils/reviewDecision.js，移动端复核页共用同一函数
  const getAiState = (q) => getReviewState(q, confidenceThreshold.value)

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
        .map(q => ({
          questionId: q.id,
          isCorrect: effectiveIsCorrect(q),
          skipWrongBook: q.review_status === REVIEW_STATUS.WRONG_NO_BOOK
        }))
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
  const effectiveIsCorrect = (q) => resolveEffectiveIsCorrect(q)

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

  // 保留错误事实，但明确记录本次不进入错题本
  const markWrongNoBook = async (questionId, reason) => {
    const question = allQuestions.value.find(q => q.id === questionId)
    if (!question) return false
    const previousStatus = question.review_status ?? null
    question.review_status = REVIEW_STATUS.WRONG_NO_BOOK
    try {
      await updateQuestionReviewStatus(questionId, REVIEW_STATUS.WRONG_NO_BOOK, {
        wrongBookAction: 'skip',
        skipReason: reason || 'other'
      })
      return true
    } catch (error) {
      question.review_status = previousStatus
      throw error
    }
  }

  // 将一道题加入错题本（仅对完整题有效；不完整题服务端会跳过）
  const addQuestionToBook = async (questionId) => {
    const studentId = currentStudent.value?.id
    if (!studentId || !questionId) return
    await addWrongQuestions(studentId, [questionId])
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
    studentAllQuestions,
    currentReviewQuestion,
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
    loadTaskById,
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
    markWrongNoBook,
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
    // 撤销上一笔（仅回退前端内存状态，不反向写库）
    canUndo,
    undoLastReview,
    // 多试卷聚合映射（左栏卷标签使用；当前由 selectTask 清空置空）
    questionToTaskMap
  }
})
