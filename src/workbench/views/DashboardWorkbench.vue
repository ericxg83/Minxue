<template>
  <div class="dashboard-workbench">
    <!-- 顶部 Header -->
    <header class="top-header">
      <div class="top-header__left">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" class="logo-icon" width="24" height="24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#1677FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="logo-text">敏学成长工作台</span>
        </div>
      </div>
      <div class="top-header__right">
        <div class="header-icon-btn" title="通知">
          <el-icon><Bell /></el-icon>
          <span class="header-badge">12</span>
        </div>
        <div class="header-icon-btn" title="帮助中心">
          <el-icon><QuestionFilled /></el-icon>
          <span class="header-icon-label">帮助中心</span>
        </div>
        <div class="header-user">
          <el-avatar :size="32" src="https://api.dicebear.com/7.x/avataaars/svg?seed=admin" />
          <span class="header-user-name">管理员</span>
          <el-icon class="header-dropdown-icon"><ArrowDown /></el-icon>
        </div>
      </div>
    </header>

    <!-- 主内容区 -->
    <div class="main-layout">
      <!-- 第一栏：导航 -->
      <aside class="nav-sidebar">
        <div class="nav-menu">
          <div
            v-for="menu in navMenus"
            :key="menu.key"
            class="nav-menu-item"
            :class="{ 'nav-menu-item--active': currentMenu === menu.key, 'nav-menu-item--disabled': menu.disabled }"
            @click="handleNavMenuClick(menu.key)"
          >
            <div class="nav-menu-item__icon"><el-icon><component :is="menu.icon" /></el-icon></div>
            <span class="nav-menu-item__text">{{ menu.label }}</span>
            <span v-if="menu.key === 'exam-import'" class="dev-badge">开发中</span>
          </div>
        </div>
        <div class="nav-sidebar__footer">
          <el-button text size="small" class="collapse-btn">
            <el-icon><Menu /></el-icon>
            收起菜单
          </el-button>
        </div>
      </aside>

      <!-- 第二栏：学生/试卷列表 -->
      <aside class="list-panel">
        <div class="list-panel__header">
          <template v-if="selectedStudentForExam">
            <el-button text size="small" @click="backToStudents" class="back-btn">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
          </template>
          <span class="list-panel__title">{{ selectedStudentForExam ? '试卷列表' : '学生列表' }}</span>
        </div>

        <template v-if="!selectedStudentForExam">
          <div class="list-panel__search">
            <el-input v-model="searchQuery" placeholder="搜索学生姓名" :prefix-icon="Search" clearable size="default" />
            <el-icon class="search-filter-icon"><Filter /></el-icon>
          </div>
          <div class="list-panel__count">共 {{ filteredStudents.length }} 位学生</div>
        </template>

        <div class="list-panel__list">
          <template v-if="!selectedStudentForExam">
            <div
              v-for="student in filteredStudents"
              :key="student.id"
              class="student-card"
              :class="{ 'student-card--active': reviewStore.currentStudent?.id === student.id }"
              @click="handleSelectStudent(student)"
            >
              <div class="student-card__top">
                <div class="student-card__avatar">
                  <div class="avatar-circle">{{ student.name?.charAt(0) || '?' }}</div>
                </div>
                <div class="student-card__info">
                  <div class="student-card__name">{{ student.name }}</div>
                  <div class="student-card__class">{{ student.grade }}</div>
                </div>
              </div>
              <div class="student-card__bottom">
                <span class="student-card__exam-count">共 {{ getStudentExamCount(student.id) }} 份试卷</span>
                <el-icon class="student-card__arrow"><ArrowRight /></el-icon>
              </div>
            </div>
          </template>

          <template v-else>
            <div
              v-for="exam in studentExams"
              :key="exam.id"
              class="exam-card"
              :class="{ 'exam-card--active': selectedExam?.id === exam.id }"
              @click="handleSelectExam(exam)"
            >
              <div class="exam-card__header">
                <div class="exam-card__name">{{ exam.name }}</div>
                <div class="exam-card__date">{{ formatDate(exam.created_at) }}</div>
              </div>
              <!-- AI批改进度 -->
              <div class="exam-card__ai-progress">
                <div class="exam-card__ai-label">AI批改：</div>
                <div class="exam-card__ai-bar">
                  <div class="exam-card__ai-bar-bg">
                    <div
                      class="exam-card__ai-bar-fill"
                      :class="{ 'exam-card__ai-bar-fill--done': exam.aiProgressPercent === 100 }"
                      :style="{ width: exam.aiProgressPercent + '%' }"
                    ></div>
                  </div>
                  <span class="exam-card__ai-value">{{ exam.aiGradedCount }}/{{ exam.questionCount }}</span>
                </div>
              </div>
              <!-- 人工复核进度 -->
              <div class="exam-card__manual-progress">
                <div class="exam-card__manual-label">人工复核：</div>
                <div class="exam-card__manual-bar">
                  <div class="exam-card__manual-bar-bg">
                    <div class="exam-card__manual-bar-fill" :style="{ width: getExamProgressPercent(exam) + '%' }"></div>
                  </div>
                  <span class="exam-card__manual-value">{{ exam.manualReviewed || 0 }}/{{ exam.questionCount }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </aside>

      <!-- 第三栏：审核工作区 -->
      <section class="review-main" v-loading="loading">
        <template v-if="selectedExam && currentQuestion">
          <!-- 顶部信息卡片 -->
          <div class="review-header-card">
            <div class="review-header-card__left">
              <div class="review-header-card__student">
                <div class="review-avatar-circle">{{ reviewStore.currentStudent?.name?.charAt(0) || '?' }}</div>
                <div class="review-header-card__student-info">
                  <div class="review-header-card__name">{{ reviewStore.currentStudent?.name }}</div>
                  <div class="review-header-card__class">{{ reviewStore.currentStudent?.grade }}</div>
                </div>
              </div>
              <div class="review-header-card__divider"></div>
              <div class="review-header-card__exam">
                <div class="review-header-card__exam-name">{{ selectedExam.name }}</div>
                <div class="review-header-card__exam-info">
                  共 {{ totalQuestions }} 题 · AI批改完成 · 人工复核中
                </div>
              </div>
            </div>
            <div class="review-header-card__center">
              <div class="review-header-card__ai-badge">
                <el-icon><CircleCheckFilled /></el-icon>
                AI批改进度
              </div>
              <div class="review-header-card__ai-value">{{ reviewedCount }}/{{ totalQuestions }} 题</div>
              <div class="review-header-card__ai-status">
                <el-icon class="ai-done-icon"><CircleCheckFilled /></el-icon>
                已完成
              </div>
            </div>
            <div class="review-header-card__right">
              <div class="review-header-card__manual-label">人工复核进度</div>
              <div class="review-header-card__manual-value">{{ reviewedCount }}/{{ totalQuestions }} 题</div>
              <div class="review-header-card__manual-bar">
                <div class="manual-progress-bar">
                  <div class="manual-progress-fill" :style="{ width: progressPercent + '%' }"></div>
                </div>
                <span class="manual-progress-text">{{ progressPercent }}%</span>
              </div>
            </div>
          </div>

          <!-- 题号导航卡片 -->
          <div class="question-nav-card">
            <div class="question-nav-card__pages">
              <el-tooltip
                v-for="(q, idx) in reviewStore.studentWrongQuestions"
                :key="q.id"
                :content="`第${idx + 1}题 · ${getQuestionStatusText(q)}`"
                placement="top"
                :show-after="300"
              >
                <div
                  class="question-nav-btn"
                  :class="[getQuestionStatusClass(q), { 'question-nav-btn--active': reviewStore.currentReviewIndex === idx }]"
                  @click="jumpToQuestion(idx)"
                >
                  {{ idx + 1 }}
                </div>
              </el-tooltip>
            </div>
            <div class="question-nav-card__legend">
              <span class="legend-item"><span class="legend-dot legend--pending"></span>未复核</span>
              <span class="legend-item"><span class="legend-dot legend--correct"></span>正确</span>
              <span class="legend-item"><span class="legend-dot legend--wrong"></span>错误</span>
              <span class="legend-item"><span class="legend-dot legend--excluded"></span>排除</span>
            </div>
          </div>

          <!-- 题目内容卡片 -->
          <div class="question-content-card">
            <div class="question-content-card__header">
              <span class="question-content-card__title">题目内容</span>
              <div class="image-toolbar">
                <el-tooltip content="放大" placement="top">
                  <el-button text @click="imageScale = Math.min(3, imageScale + 0.2)"><el-icon><ZoomIn /></el-icon></el-button>
                </el-tooltip>
                <el-tooltip content="缩小" placement="top">
                  <el-button text @click="imageScale = Math.max(0.3, imageScale - 0.2)"><el-icon><ZoomOut /></el-icon></el-button>
                </el-tooltip>
                <el-tooltip content="旋转" placement="top">
                  <el-button text @click="imageRotation -= 90"><el-icon><RefreshLeft /></el-icon></el-button>
                </el-tooltip>
                <el-tooltip content="重置" placement="top">
                  <el-button text @click="resetImageTransform"><el-icon><Refresh /></el-icon></el-button>
                </el-tooltip>
              </div>
            </div>
            <div class="question-content-card__body">
              <div class="question-text-panel">
                <div class="question-text-content">{{ ocrData.questionContent || '暂无题目内容' }}</div>
                <!-- 选择题选项 -->
                <div v-if="ocrData.options && ocrData.options.length > 0" class="question-options">
                  <div
                    v-for="(opt, idx) in ocrData.options"
                    :key="idx"
                    class="option-item"
                    :class="{ 'option-item--correct': opt === ocrData.correctAnswer }"
                  >
                    <span class="option-label">{{ String.fromCharCode(65 + idx) }}.</span>
                    <span class="option-text">{{ opt }}</span>
                  </div>
                </div>
              </div>
              <div class="question-image-panel">
                <img
                  v-if="currentQuestion?.originalImage"
                  :src="currentQuestion.originalImage"
                  alt="题目图片"
                  class="question-image"
                  :style="{
                    transform: `scale(${imageScale}) rotate(${imageRotation}deg)`,
                    transition: imageTransformTransition ? 'transform 0.3s ease' : 'none'
                  }"
                />
                <div v-else class="image-preview-placeholder">
                  <el-icon :size="48" color="#C9CDD4"><Picture /></el-icon>
                  <span class="placeholder-text">暂无图片</span>
                </div>
              </div>
            </div>
          </div>

          <!-- OCR识别结果卡片 -->
          <div class="ocr-card">
            <div class="ocr-card__title">
              <span>OCR识别结果</span>
              <span class="ocr-card__subtitle">可点击修改</span>
            </div>
            <!-- OCR状态徽章行 -->
            <div class="ocr-status-badges">
              <span class="ocr-badge ocr-badge--blue">
                <el-icon><CircleCheck /></el-icon>
                OCR识别
              </span>
              <span class="ocr-badge ocr-badge--green">
                <el-icon><SuccessFilled /></el-icon>
                识别正常
              </span>
              <span class="ocr-badge ocr-badge--purple">
                <el-icon><Lightning /></el-icon>
                AI辅助解析
              </span>
            </div>

            <!-- 学生答案 + 参考答案 双栏 -->
            <div class="ocr-answer-grid">
              <div class="ocr-answer-col">
                <div class="ocr-answer-col__label">学生答案 <span class="ocr-answer-col__sub">（OCR识别）</span></div>
                <div class="ocr-answer-col__content">
                  {{ ocrData.studentAnswer || '暂无学生答案' }}
                </div>
              </div>
              <div class="ocr-answer-col">
                <div class="ocr-answer-col__label">参考答案 <span class="ocr-answer-col__sub">（AI生成）</span></div>
                <div class="ocr-answer-col__content">
                  <template v-if="ocrData.correctAnswer">
                    {{ ocrData.correctAnswer }}
                  </template>
                  <div v-else class="ai-answer-placeholder">
                    <el-icon :size="24" color="#C9CDD4"><Warning /></el-icon>
                    <span class="ai-answer-placeholder__text">解析失败，请人工确认</span>
                  </div>
                </div>
                <div class="ocr-answer-col__action">
                  <el-button text size="small" type="primary">
                    <el-icon><EditPen /></el-icon>
                    AI参考答案
                  </el-button>
                </div>
              </div>
            </div>

            <!-- 知识点标签 -->
            <div class="ocr-knowledge">
              <div class="ocr-knowledge__label">知识点标签</div>
              <div class="ocr-tags-list">
                <el-tag
                  v-for="tag in ocrData.knowledgePoints"
                  :key="tag"
                  size="default"
                  closable
                  @close="removeTag(tag)"
                  effect="light"
                  round
                >
                  {{ tag }}
                </el-tag>
                <el-button text size="small" type="primary" @click="showTagSelector = true" class="add-tag-btn">
                  <el-icon><Plus /></el-icon>
                  添加知识点
                </el-button>
              </div>
            </div>

            <!-- 题目备注 -->
            <div class="ocr-remark">
              <div class="ocr-remark__label">题目备注</div>
              <el-input
                v-model="ocrData.remark"
                placeholder="请输入备注信息（选填）"
                class="ocr-input"
              />
              <span class="ocr-remark__count">{{ (ocrData.remark || '').length }}/200</span>
            </div>
          </div>

          <!-- 底部操作卡片 -->
          <div class="action-card">
            <div class="action-card__left">
              <el-button size="default" @click="handlePrevQuestion" :disabled="reviewStore.currentReviewIndex === 0">
                <el-icon><ArrowLeft /></el-icon>
                上一题
              </el-button>
              <el-button size="default" @click="handleNextQuestion" :disabled="reviewStore.currentReviewIndex >= reviewStore.studentWrongQuestions.length - 1">
                下一题
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </div>
            <div class="action-card__right">
              <el-button size="default" class="btn-correct" @click="handleReview('correct')">
                <el-icon><CircleCheckFilled /></el-icon>
                正确
              </el-button>
              <el-button size="default" class="btn-wrong" @click="handleReview('wrong')">
                <el-icon><CircleCloseFilled /></el-icon>
                错误
              </el-button>
              <el-button size="default" class="btn-exclude" @click="handleReview('exclude')">
                <el-icon><RemoveFilled /></el-icon>
                排除本题
              </el-button>
              <el-button size="default" type="primary" class="btn-save" @click="handleSave">
                <el-icon><DocumentChecked /></el-icon>
                保存
              </el-button>
            </div>
          </div>
        </template>

        <!-- 空状态 -->
        <template v-else>
          <div class="empty-state">
            <el-icon :size="64" color="#C9CDD4"><DocumentChecked /></el-icon>
            <p class="empty-state__text">{{ selectedStudentForExam ? '请从左侧选择一份试卷' : '请从左侧选择一个学生开始审核' }}</p>
          </div>
        </template>
      </section>
    </div>

    <!-- 全屏查看 -->
    <el-dialog v-model="fullscreenVisible" fullscreen :show-close="false" class="fullscreen-dialog" @click="fullscreenVisible = false">
      <div class="fullscreen-image-wrapper" @click.stop>
        <img
          v-if="currentQuestion?.originalImage"
          :src="currentQuestion.originalImage"
          class="fullscreen-image"
          :style="{ transform: `scale(${imageScale}) rotate(${imageRotation}deg)` }"
        />
      </div>
    </el-dialog>

    <!-- 知识点选择 -->
    <el-dialog v-model="showTagSelector" title="选择知识点" width="400px">
      <div class="tag-selector">
        <div
          v-for="tag in allKnowledgeTags"
          :key="tag"
          class="tag-option"
          :class="{ 'tag-option--selected': ocrData.knowledgePoints.includes(tag) }"
          @click="toggleTag(tag)"
        >
          {{ tag }}
        </div>
      </div>
      <template #footer>
        <el-button @click="showTagSelector = false">取消</el-button>
        <el-button type="primary" @click="showTagSelector = false">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useReviewStore } from '../stores/reviewStore'
import { useLifecycleStore, LIFECYCLE_STATUS } from '../stores/lifecycleStore'
import { getExamsByStudent } from '../../services/apiService'
import { ElMessage } from 'element-plus'
import {
  Bell, QuestionFilled, ArrowDown, ArrowLeft, ArrowRight, Menu,
  Picture, ZoomIn, ZoomOut, RefreshLeft, Refresh,
  CircleCheckFilled, CircleCloseFilled, RemoveFilled, DocumentChecked,
  Search, Filter, CircleCheck, SuccessFilled, Lightning, EditPen, Plus, Warning
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const router = useRouter()
const reviewStore = useReviewStore()

const currentMenu = ref('proofread')
const navMenus = [
  { key: 'proofread', label: '题目校对', icon: 'DocumentChecked' },
  { key: 'wrong-book', label: '错题管理', icon: 'Collection' },
  { key: 'growth', label: '成长中心', icon: 'TrendCharts' },
  { key: 'exam-import', label: '试卷入库', icon: 'UploadFilled', disabled: true },
]

const handleNavMenuClick = (key) => {
  const menu = navMenus.find(m => m.key === key)
  if (menu?.disabled) return
  currentMenu.value = key
  const routeMap = { 'proofread': '/', 'wrong-book': '/wrongbook', 'growth': '/growth', 'exam-import': '/paper' }
  if (routeMap[key] && routeMap[key] !== router.currentRoute.value.path) {
    router.push(routeMap[key])
  }
}

const searchQuery = ref('')
const loading = ref(false)

const filteredStudents = computed(() => {
  let list = reviewStore.students
  if (searchQuery.value) {
    list = list.filter(s => s.name?.includes(searchQuery.value))
  }
  return list
})

const selectedStudentForExam = ref(null)
const studentExams = ref([])
const selectedExam = ref(null)

const handleSelectStudent = async (student) => {
  reviewStore.setCurrentStudent(student)
  selectedStudentForExam.value = student
  selectedExam.value = null
  try {
    // Load wrong questions for this student
    await reviewStore.loadWrongQuestions(student.id)

    // Fetch exams with AI grading progress
    const exams = await getExamsByStudent(student.id, false)

    // Calculate manualReviewed per exam from wrong questions
    const studentWQs = reviewStore.wrongQuestions.filter(wq => wq.student_id === student.id)
    const reviewedIds = new Set()
    studentWQs.forEach(wq => {
      if (wq.review_status === 'correct' || wq.review_status === 'wrong' || wq.review_status === 'excluded') {
        reviewedIds.add(wq.question_id)
      }
    })

    studentExams.value = (exams || []).map(exam => {
      const qCount = exam.question_count || 0
      const aiGraded = exam.ai_graded_count || 0

      // Count manually reviewed questions for this exam
      const reviewedForThisExam = studentWQs.filter(wq => reviewedIds.has(wq.question_id)).length

      return {
        ...exam,
        questionCount: qCount,
        aiGradedCount: aiGraded,
        manualReviewed: reviewedForThisExam,
        status: exam.status || 'ungraded',
        aiProgressPercent: qCount > 0 ? Math.round((aiGraded / qCount) * 100) : 0
      }
    })

    // Update student exam count
    student.examCount = studentExams.value.length
  } catch (e) {
    console.error('Load exams failed:', e)
    studentExams.value = []
  }
}

const backToStudents = () => {
  selectedStudentForExam.value = null
  selectedExam.value = null
}

const handleSelectExam = async (exam) => {
  selectedExam.value = exam
  reviewStore.currentReviewIndex = 0
  // Load ALL questions for this exam/task
  await reviewStore.loadQuestions(exam.id)
}

const imageScale = ref(1)
const imageRotation = ref(0)
const imageTransformTransition = ref(true)
const resetImageTransform = () => {
  imageTransformTransition.value = true
  imageScale.value = 1
  imageRotation.value = 0
}

const fullscreenVisible = ref(false)

const currentQuestion = computed(() => reviewStore.currentReviewQuestion)
const totalQuestions = computed(() => reviewStore.allQuestions.length || 0)

const reviewedCount = computed(() => {
  return reviewStore.allQuestions.filter(q => {
    return q.review_status === 'correct' || q.review_status === 'wrong' || q.review_status === 'excluded'
  }).length
})

const progressPercent = computed(() => {
  if (totalQuestions.value === 0) return 0
  return Math.round((reviewedCount.value / totalQuestions.value) * 100)
})

const getQuestionStatusClass = (q) => {
  const reviewStatus = q.review_status
  if (reviewStatus === 'correct') return 'status-correct'
  if (reviewStatus === 'wrong') return 'status-wrong'
  if (reviewStatus === 'excluded') return 'status-excluded'
  return 'status-pending'
}

const getQuestionStatusText = (q) => {
  const reviewStatus = q.review_status
  if (reviewStatus === 'correct') return '正确'
  if (reviewStatus === 'wrong') return '错误'
  if (reviewStatus === 'excluded') return '已排除'
  return '未复核'
}

const getStudentExamCount = (studentId) => {
  return reviewStore.students.find(s => s.id === studentId)?.examCount || 0
}

const getStudentProgressPercent = (student) => {
  const total = student.totalQuestions || 27
  const reviewed = student.manualReviewed || 0
  return total > 0 ? Math.round((reviewed / total) * 100) : 0
}

const getExamProgressPercent = (exam) => {
  const total = exam.questionCount || 27
  const reviewed = exam.manualReviewed || 0
  return total > 0 ? Math.round((reviewed / total) * 100) : 0
}

const ocrData = ref({
  questionContent: '',
  options: [],
  studentAnswer: '',
  correctAnswer: '',
  analysis: '',
  knowledgePoints: [],
  remark: '',
})

const showTagSelector = ref(false)
const allKnowledgeTags = ref(['全等三角形判定', '角的关系推导', '线段等式证明', '平行线的性质', '角平分线定义', '三角形内角和定理', '等式性质', '勾股定理'])

const toggleTag = (tag) => {
  const idx = ocrData.value.knowledgePoints.indexOf(tag)
  if (idx === -1) ocrData.value.knowledgePoints.push(tag)
  else ocrData.value.knowledgePoints.splice(idx, 1)
}
const removeTag = (tag) => {
  ocrData.value.knowledgePoints = ocrData.value.knowledgePoints.filter(t => t !== tag)
}

watch(currentQuestion, (newQ) => {
  if (newQ?.question) {
    ocrData.value = {
      questionContent: newQ.question.content || '',
      options: newQ.question.options || [],
      studentAnswer: newQ.question.student_answer || '',
      correctAnswer: newQ.question.answer || '',
      analysis: newQ.question.analysis || '',
      knowledgePoints: newQ.question.ai_tags || newQ.question.knowledge_points || [],
      remark: newQ.question.remark || '',
    }
  } else {
    ocrData.value = { questionContent: '', options: [], studentAnswer: '', correctAnswer: '', analysis: '', knowledgePoints: [], remark: '' }
  }
  resetImageTransform()
}, { immediate: true })

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return dayjs(dateStr).format('MM-DD HH:mm')
}

const jumpToQuestion = (idx) => { reviewStore.currentReviewIndex = idx }
const handlePrevQuestion = () => { reviewStore.prevQuestion() }
const handleNextQuestion = () => { reviewStore.nextQuestion() }

const handleReview = (result) => {
  const q = currentQuestion.value
  if (!q) return
  const resultText = { correct: '已标记为正确', wrong: '已标记为错误', exclude: '已排除本题' }
  q.review_status = result
  if (result === 'exclude') {
    reviewStore.nextQuestion()
    ElMessage.info('已排除本题')
    return
  }
  reviewStore.reviewQuestion(q.id, result)
  ElMessage.success(resultText[result])
}

const handleSave = () => {
  const q = currentQuestion.value
  if (!q) return
  if (q.question) {
    q.question.content = ocrData.value.questionContent
    q.question.options = ocrData.value.options
    q.question.student_answer = ocrData.value.studentAnswer
    q.question.answer = ocrData.value.correctAnswer
    q.question.analysis = ocrData.value.analysis
    q.question.ai_tags = ocrData.value.knowledgePoints
    q.question.remark = ocrData.value.remark
  }
  ElMessage.success('保存成功')
}

const handleKeyboard = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  switch (e.key) {
    case 'ArrowLeft': e.preventDefault(); handlePrevQuestion(); break
    case 'ArrowRight': e.preventDefault(); handleNextQuestion(); break
    case '1': e.preventDefault(); handleReview('correct'); break
    case '2': e.preventDefault(); handleReview('wrong'); break
  }
}

onMounted(async () => {
  loading.value = true
  await reviewStore.initData()
  loading.value = false
  window.addEventListener('keydown', handleKeyboard)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboard)
})
</script>

<style scoped>
/* ===== 根布局（与成长中心一致） ===== */
.dashboard-workbench {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== Top Header（与成长中心一致） ===== */
.top-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  flex-shrink: 0;
}
.top-header__left { display: flex; align-items: center; }
.logo { display: flex; align-items: center; gap: 8px; }
.logo-icon { width: 24px; height: 24px; }
.logo-text { font-size: 16px; font-weight: 600; color: #1D2129; }
.top-header__right { display: flex; align-items: center; gap: 16px; }
.header-icon-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 8px; border-radius: 6px; cursor: pointer;
  color: #4E5969; font-size: 14px; transition: background 0.2s;
  position: relative;
}
.header-icon-btn:hover { background: #F2F3F5; }
.header-icon-btn .el-icon { font-size: 18px; }
.header-badge {
  position: absolute; top: 0; right: 0;
  min-width: 16px; height: 16px; padding: 0 4px;
  background: #F53F3F; color: #fff; font-size: 11px;
  line-height: 16px; text-align: center; border-radius: 8px;
}
.header-icon-label { font-size: 13px; }
.header-user {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: background 0.2s;
}
.header-user:hover { background: #F2F3F5; }
.header-user-name { font-size: 13px; color: #1D2129; }
.header-dropdown-icon { font-size: 12px; color: #86909C; }

/* ===== Main Layout ===== */
.main-layout { display: flex; flex: 1; overflow: hidden; }

/* ===== Nav Sidebar（与成长中心一致） ===== */
.nav-sidebar {
  width: 220px;
  background: #fff;
  border-right: 1px solid #E5E6EB;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}
.nav-menu { display: flex; flex-direction: column; gap: 4px; }
.nav-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  transition: all 0.2s; font-size: 14px; color: #4E5969;
}
.nav-menu-item--disabled { cursor: not-allowed; opacity: 0.5; }
.nav-menu-item:hover { background: #F2F3F5; }
.nav-menu-item--active { background: #E8F3FF; color: #1677FF; font-weight: 500; }
.nav-menu-item__icon { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; font-size: 18px; }
.nav-menu-item__text { flex: 1; }
.dev-badge {
  display: inline-block; padding: 1px 6px;
  background: #FFF7E6; color: #FA8C16; font-size: 10px;
  border-radius: 4px; font-weight: 500; flex-shrink: 0; border: 1px solid #FFD591;
}
.nav-sidebar__footer {
  margin-top: auto; padding-top: 16px; border-top: 1px solid #F2F3F5;
}
.collapse-btn { color: #86909C; font-size: 13px; }

/* ===== List Panel ===== */
.list-panel {
  width: 320px; background: #F5F7FA; border-right: 1px solid #E5E6EB;
  flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden;
}
.list-panel__header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px 8px;
}
.back-btn { padding: 4px; min-width: auto; }
.list-panel__title { font-size: 15px; font-weight: 600; color: #1D2129; }
.list-panel__search {
  display: flex; align-items: center; padding: 0 16px 8px; gap: 8px;
}
.list-panel__search :deep(.el-input) { flex: 1; }
.search-filter-icon { font-size: 18px; color: #86909C; cursor: pointer; flex-shrink: 0; }
.search-filter-icon:hover { color: #1677FF; }
.list-panel__count { padding: 0 16px 6px; font-size: 12px; color: #86909C; }
.list-panel__list { flex: 1; overflow-y: auto; padding: 0 12px 8px; }

.student-card {
  background: #fff;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 8px;
  padding: 12px;
}
.student-card:hover { box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08); }
.student-card--active { background: #E8F3FF; box-shadow: 0 2px 8px rgba(22, 119, 255, 0.12); }

.student-card__top { display: flex; align-items: center; gap: 10px; }
.avatar-circle {
  width: 36px; height: 36px; border-radius: 50%;
  background: #E5E6EB; color: #4E5969; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 500;
}
.student-card__info { flex: 1; }
.student-card__name { font-size: 14px; font-weight: 500; color: #1D2129; }
.student-card__class { font-size: 12px; color: #86909C; }
.student-card__bottom {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 8px; padding-top: 8px; border-top: 1px solid #F2F3F5;
}
.student-card__exam-count { font-size: 12px; color: #86909C; }
.student-card__arrow { font-size: 14px; color: #C9CDD4; }

.exam-card {
  background: #fff;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 8px;
  padding: 14px 16px;
}
.exam-card:hover { box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08); }
.exam-card--active { background: #E8F3FF; box-shadow: 0 2px 8px rgba(22, 119, 255, 0.12); }

.exam-card__header { margin-bottom: 10px; }
.exam-card__name { font-size: 14px; font-weight: 500; color: #1D2129; }
.exam-card__date { font-size: 12px; color: #86909C; margin-top: 2px; }

/* AI批改进度 */
.exam-card__ai-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.exam-card__ai-label {
  font-size: 12px;
  color: #52C41A;
  font-weight: 500;
  white-space: nowrap;
}
.exam-card__ai-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.exam-card__ai-bar-bg {
  flex: 1;
  height: 6px;
  background: #F2F3F5;
  border-radius: 3px;
  overflow: hidden;
}
.exam-card__ai-bar-fill {
  height: 100%;
  background: #FA8C16;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.exam-card__ai-bar-fill--done {
  background: #52C41A;
}
.exam-card__ai-value {
  font-size: 12px;
  color: #1D2129;
  font-weight: 500;
  white-space: nowrap;
  min-width: 48px;
  text-align: right;
}

/* 人工复核进度 */
.exam-card__manual-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.exam-card__manual-label {
  font-size: 12px;
  color: #86909C;
  white-space: nowrap;
}
.exam-card__manual-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.exam-card__manual-bar-bg {
  flex: 1;
  height: 6px;
  background: #F2F3F5;
  border-radius: 3px;
  overflow: hidden;
}
.exam-card__manual-bar-fill {
  height: 100%;
  background: #1677FF;
  border-radius: 3px;
  transition: width 0.3s ease;
}
.exam-card__manual-value {
  font-size: 12px;
  color: #1D2129;
  font-weight: 500;
  white-space: nowrap;
  min-width: 48px;
  text-align: right;
}

/* ===== Review Main（与成长中心 growth-main 一致的滚动布局） ===== */
.review-main {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.review-main::-webkit-scrollbar { width: 6px; }
.review-main::-webkit-scrollbar-track { background: transparent; }
.review-main::-webkit-scrollbar-thumb { background: #E5E6EB; border-radius: 3px; }

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: 12px;
}
.empty-state__text { font-size: 14px; color: #86909C; }

/* ===== Review Header Card ===== */
.review-header-card {
  background: #fff;
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  gap: 20px;
}
.review-header-card__left { display: flex; align-items: center; gap: 16px; }
.review-header-card__student { display: flex; align-items: center; gap: 10px; }
.review-avatar-circle {
  width: 36px; height: 36px; border-radius: 50%;
  background: #E5E6EB; color: #4E5969; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 500;
}
.review-header-card__student-info { display: flex; flex-direction: column; }
.review-header-card__name { font-size: 15px; font-weight: 600; color: #1D2129; }
.review-header-card__class { font-size: 12px; color: #86909C; }
.review-header-card__divider {
  width: 1px; height: 32px; background: #E5E6EB; flex-shrink: 0;
}
.review-header-card__exam { display: flex; flex-direction: column; gap: 2px; }
.review-header-card__exam-name { font-size: 14px; font-weight: 500; color: #1D2129; }
.review-header-card__exam-info { font-size: 12px; color: #86909C; }

.review-header-card__center {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: #F6FFED; border-radius: 8px;
}
.review-header-card__ai-badge {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: #52C41A; font-weight: 500;
}
.review-header-card__ai-badge .el-icon { font-size: 14px; }
.review-header-card__ai-value { font-size: 12px; color: #389E0D; font-weight: 600; }
.review-header-card__ai-status {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: #52C41A;
}
.ai-done-icon { font-size: 14px; }

.review-header-card__right {
  margin-left: auto;
  display: flex; flex-direction: column; align-items: flex-end;
}
.review-header-card__manual-label { font-size: 12px; color: #4E5969; font-weight: 500; }
.review-header-card__manual-value { font-size: 14px; font-weight: 600; color: #1D2129; margin: 4px 0; }
.review-header-card__manual-bar { display: flex; align-items: center; gap: 8px; }
.manual-progress-bar { width: 100px; height: 6px; background: #F2F3F5; border-radius: 3px; overflow: hidden; }
.manual-progress-fill { height: 100%; background: #1677FF; border-radius: 3px; transition: width 0.3s ease; }
.manual-progress-text { font-size: 12px; color: #1677FF; font-weight: 600; }

/* ===== Question Nav Card ===== */
.question-nav-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.question-nav-card__pages { display: flex; align-items: center; gap: 4px; overflow-x: auto; flex: 1; }
.question-nav-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.15s;
  flex-shrink: 0; font-weight: 500;
}
.question-nav-btn:hover { transform: scale(1.1); }
.question-nav-btn--active { box-shadow: 0 0 0 2px #1677FF; }

.status-pending { background: #F2F3F5; color: #86909C; }
.status-correct { background: #F6FFED; color: #52C41A; }
.status-wrong { background: #FFF2F0; color: #FF4D4F; }
.status-excluded { background: #FFF7E6; color: #FA8C16; }

.question-nav-card__legend { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #86909C; }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.legend--pending { background: #86909C; }
.legend--correct { background: #52C41A; }
.legend--wrong { background: #FF4D4F; }
.legend--excluded { background: #FA8C16; }

/* ===== Question Content Card ===== */
.question-content-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}
.question-content-card__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px; border-bottom: 1px solid #F2F3F5;
}
.question-content-card__title { font-size: 14px; font-weight: 500; color: #1D2129; }
.image-toolbar { display: flex; align-items: center; gap: 0; }
.image-toolbar :deep(.el-button) { padding: 6px 8px; color: #86909C; font-size: 16px; }
.image-toolbar :deep(.el-button:hover) { color: #1677FF; background: #F2F3F5; }

.question-content-card__body { display: grid; grid-template-columns: 1fr 1fr; }
.question-text-panel {
  padding: 16px 20px; border-right: 1px solid #F2F3F5;
  overflow-y: auto; max-height: 260px;
}
.question-text-content { font-size: 13px; color: #1D2129; line-height: 1.8; white-space: pre-wrap; }
.question-options { margin-top: 12px; }
.option-item {
  display: flex; align-items: baseline; gap: 8px;
  padding: 6px 12px; border-radius: 8px; margin-bottom: 4px;
  background: #F9FAFB; transition: background 0.2s;
}
.option-item:hover { background: #F2F3F5; }
.option-item--correct { background: #E8F8EA; }
.option-label { font-size: 13px; font-weight: 600; color: #1D2129; min-width: 18px; }
.option-text { font-size: 13px; color: #4E5969; }
.question-image-panel {
  display: flex; align-items: center; justify-content: center;
  padding: 16px 20px; overflow: hidden; min-height: 200px;
}
.question-image { max-width: 100%; max-height: 100%; object-fit: contain; }
.image-preview-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.placeholder-text { font-size: 13px; color: #86909C; }

/* ===== OCR Card ===== */
.ocr-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}
.ocr-card__title {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px; border-bottom: 1px solid #F2F3F5;
  font-size: 14px; font-weight: 500; color: #1D2129;
}
.ocr-card__subtitle { font-size: 12px; color: #86909C; font-weight: 400; }

.ocr-status-badges {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 20px; border-bottom: 1px solid #F2F3F5;
}
.ocr-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;
}
.ocr-badge--blue { background: #E8F3FF; color: #1677FF; }
.ocr-badge--green { background: #F6FFED; color: #52C41A; }
.ocr-badge--purple { background: #F9F0FF; color: #722ED1; }
.ocr-badge .el-icon { font-size: 14px; }

.ocr-answer-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid #F2F3F5;
}
.ocr-answer-col { padding: 14px 20px; }
.ocr-answer-col:first-child { border-right: 1px solid #F2F3F5; }
.ocr-answer-col__label { font-size: 12px; font-weight: 500; color: #4E5969; margin-bottom: 8px; }
.ocr-answer-col__sub { font-weight: 400; color: #86909C; }
.ocr-answer-col__content {
  font-size: 13px; color: #1D2129; line-height: 1.7;
  padding: 10px 12px; background: #F9FAFB; border-radius: 8px;
  white-space: pre-wrap; min-height: 48px;
}
.ocr-answer-col__action { margin-top: 8px; }

.ai-answer-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 20px; text-align: center;
}
.ai-answer-placeholder__text { font-size: 13px; color: #86909C; }

.ocr-knowledge {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 20px; border-bottom: 1px solid #F2F3F5;
}
.ocr-knowledge__label { font-size: 12px; font-weight: 500; color: #4E5969; white-space: nowrap; padding-top: 2px; }
.ocr-tags-list { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: 1; }
.add-tag-btn { font-size: 12px; }

.ocr-remark { display: flex; align-items: center; gap: 12px; padding: 10px 20px; }
.ocr-remark__label { font-size: 12px; color: #86909C; white-space: nowrap; }
.ocr-remark__count { font-size: 11px; color: #C9CDD4; white-space: nowrap; }
.ocr-input :deep(.el-input__wrapper) { box-shadow: none !important; background: #F9FAFB; border-radius: 8px; }
.ocr-input :deep(.el-input__wrapper):hover { background: #F2F3F5; }

/* ===== Action Card ===== */
.action-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.action-card__left { display: flex; align-items: center; gap: 8px; }
.action-card__right { display: flex; align-items: center; gap: 10px; }
.btn-correct { background: #F6FFED !important; border-color: #B7EB8F !important; color: #52C41A !important; font-weight: 500; }
.btn-correct:hover { background: #D9F7BE !important; border-color: #73D13D !important; }
.btn-wrong { background: #FFF2F0 !important; border-color: #FFCCC7 !important; color: #FF4D4F !important; font-weight: 500; }
.btn-wrong:hover { background: #FFE8E6 !important; border-color: #FFA39E !important; }
.btn-exclude { background: #FFF7E6 !important; border-color: #FFD591 !important; color: #FA8C16 !important; font-weight: 500; }
.btn-exclude:hover { background: #FFF0D1 !important; border-color: #FFC069 !important; }
.btn-save { min-width: 80px; font-weight: 500; }

/* ===== Fullscreen ===== */
.fullscreen-dialog :deep(.el-dialog__body) { padding: 0; height: 100vh; display: flex; align-items: center; justify-content: center; background: #000; }
.fullscreen-image-wrapper { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.fullscreen-image { max-width: 95%; max-height: 95%; object-fit: contain; }

/* ===== Tag Selector ===== */
.tag-selector { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0; }
.tag-option {
  padding: 6px 14px; background: #F2F3F5; border-radius: 6px;
  font-size: 13px; color: #4E5969; cursor: pointer; transition: all 0.2s;
}
.tag-option:hover { background: #E8F3FF; color: #1677FF; }
.tag-option--selected { background: #E8F3FF; color: #1677FF; border: 1px solid #1677FF; }

/* ===== 列表滚动条 ===== */
.list-panel__list::-webkit-scrollbar { width: 6px; }
.list-panel__list::-webkit-scrollbar-track { background: transparent; }
.list-panel__list::-webkit-scrollbar-thumb { background: #E5E6EB; border-radius: 3px; }
</style>
