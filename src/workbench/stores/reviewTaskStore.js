import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { mockReviewTasks, mockStudents } from '../../data/mockData'
import { mockQuestions } from '../../data/mockData'
import { generateExamPDF } from '../../utils/pdfGenerator'
import { ElMessage } from 'element-plus'

export const useReviewTaskStore = defineStore('reviewTask', () => {
  // 重练任务列表
  const reviewTasks = ref([])
  
  // 当前选中的任务
  const selectedTask = ref(null)
  
  // 筛选条件
  const statusFilter = ref('pending_print')  // pending_print | printed | completed | all
  
  // 初始化数据
  const initData = () => {
    reviewTasks.value = mockReviewTasks.map(task => ({ ...task }))
  }

  // 按状态筛选的任务
  const filteredTasks = computed(() => {
    if (statusFilter.value === 'all') return reviewTasks.value
    return reviewTasks.value.filter(t => t.status === statusFilter.value)
  })

  // 今日待打印任务
  const todayPendingTasks = computed(() => {
    const today = dayjs().format('YYYY-MM-DD')
    return reviewTasks.value.filter(t => 
      t.review_date === today && t.status === 'pending_print'
    )
  })

  // 待打印任务数量
  const pendingPrintCount = computed(() => {
    return reviewTasks.value.filter(t => t.status === 'pending_print').length
  })

  // 已打印任务数量
  const printedCount = computed(() => {
    return reviewTasks.value.filter(t => t.status === 'printed').length
  })

  // 已完成任务数量
  const completedCount = computed(() => {
    return reviewTasks.value.filter(t => t.status === 'completed').length
  })

  // 按学生分组今日待打印任务
  const todayPendingTasksByStudent = computed(() => {
    const grouped = {}
    todayPendingTasks.value.forEach(task => {
      if (!grouped[task.student_id]) {
        grouped[task.student_id] = []
      }
      grouped[task.student_id].push(task)
    })
    return grouped
  })

  // 获取任务详情
  const getTaskById = (taskId) => {
    return reviewTasks.value.find(t => t.id === taskId)
  }

  // 获取任务的题目
  const getTaskQuestions = (task) => {
    return task.question_ids
      .map(qid => mockQuestions.find(q => q.id === qid))
      .filter(Boolean)
  }

  // 生成重练卷PDF（自动排版 + 生成）
  const generateReviewPDF = async (task) => {
    const student = mockStudents.find(s => s.id === task.student_id)
    const questions = getTaskQuestions(task)
    
    if (!student || questions.length === 0) {
      ElMessage.error('无法生成重练卷：缺少学生信息或题目')
      return false
    }

    const title = `${student.name} ${task.review_date}重练卷`
    const filename = `${student.name}-${task.review_date}-重练卷`

    try {
      // 生成PDF并下载
      await generateExamPDF({
        title,
        studentName: student.class,
        questions,
        filename,
        showAnswers: false,
        qrContent: `review-task:${task.id}`
      })
      
      // 模拟生成PDF URL
      task.pdf_url = `https://example.com/pdfs/${filename}.pdf`
      
      ElMessage.success(`${title} 已生成并下载`)
      return true
    } catch (error) {
      console.error('PDF生成失败:', error)
      ElMessage.error('PDF生成失败，请重试')
      return false
    }
  }

  // 批量生成所有待打印任务的PDF
  const generateAllPendingPDFs = async () => {
    const tasks = todayPendingTasks.value
    if (tasks.length === 0) {
      ElMessage.info('没有待生成的重练卷')
      return
    }

    ElMessage.info(`开始生成 ${tasks.length} 份重练卷...`)

    for (const task of tasks) {
      await generateReviewPDF(task)
    }

    ElMessage.success('所有重练卷已生成完毕')
  }

  // 标记为已打印
  const markAsPrinted = (taskId) => {
    const task = reviewTasks.value.find(t => t.id === taskId)
    if (task) {
      task.status = 'printed'
      task.printed_at = new Date().toISOString()
      ElMessage.success('已标记为已打印')
      return true
    }
    return false
  }

  // 标记为已完成
  const markAsCompleted = (taskId) => {
    const task = reviewTasks.value.find(t => t.id === taskId)
    if (task) {
      task.status = 'completed'
      task.completed_at = new Date().toISOString()
      ElMessage.success('已标记为已完成')
      return true
    }
    return false
  }

  // 设置筛选条件
  const setStatusFilter = (status) => {
    statusFilter.value = status
  }

  // 选中任务
  const selectTask = (task) => {
    selectedTask.value = task
  }

  // 取消选中
  const clearSelection = () => {
    selectedTask.value = null
  }

  return {
    reviewTasks,
    selectedTask,
    statusFilter,
    filteredTasks,
    todayPendingTasks,
    pendingPrintCount,
    printedCount,
    completedCount,
    todayPendingTasksByStudent,
    initData,
    getTaskById,
    getTaskQuestions,
    generateReviewPDF,
    generateAllPendingPDFs,
    markAsPrinted,
    markAsCompleted,
    setStatusFilter,
    selectTask,
    clearSelection
  }
})