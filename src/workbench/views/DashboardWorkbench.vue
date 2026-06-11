<template>
  <div class="dashboard-workbench">
    <!-- 顶部 Header -->
    <header class="top-header">
      <div class="top-header__left">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" class="logo-icon" width="24" height="24">
            <path d="M12 3L4 7v10l8 4 8-4V7l-8-4z" stroke="#1677FF" stroke-width="2" stroke-linejoin="round"/>
            <path d="M12 22V12M12 12l8-5M12 12L4 7" stroke="#1677FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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

        <!-- 搜索框 -->
        <template v-if="!selectedStudentForExam">
          <div class="list-panel__search">
            <el-input v-model="searchQuery" placeholder="搜索学生姓名" :prefix-icon="Search" clearable size="default" />
            <el-icon class="search-filter-icon"><Filter /></el-icon>
          </div>
          <div class="list-panel__count">共 {{ filteredStudents.length }} 位学生</div>
        </template>

        <div class="list-panel__list">
          <!-- 学生卡片列表 -->
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
                <el-icon v-if="getStudentPendingCount(student.id) > 0" class="student-card__badge">
                  <ChatDotRound />
                </el-icon>
              </div>
              <div class="student-card__stats">
                <div class="stat-line">
                  <span class="stat-label">AI批改：</span>
                  <span class="stat-value">{{ student.aiGraded || 0 }}/{{ student.totalQuestions || 27 }}</span>
                  <el-icon class="stat-icon--success"><CircleCheckFilled /></el-icon>
                </div>
                <div class="stat-line">
                  <span class="stat-label">人工复核：</span>
                  <span class="stat-value">{{ student.manualReviewed || 0 }}/{{ student.totalQuestions || 27 }}</span>
                </div>
              </div>
              <div class="student-card__progress">
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" :style="{ width: getStudentProgressPercent(student) + '%' }"></div>
                </div>
                <span class="progress-percent">{{ getStudentProgressPercent(student) }}%</span>
              </div>
            </div>
          </template>

          <!-- 试卷卡片列表 -->
          <template v-else>
            <div
              v-for="exam in studentExams"
              :key="exam.id"
              class="exam-card"
              :class="{ 'exam-card--active': selectedExam?.id === exam.id }"
              @click="handleSelectExam(exam)"
            >
              <div class="exam-card__info">
                <div class="exam-card__name">{{ exam.name }}</div>
                <div class="exam-card__meta">{{ formatDate(exam.created_at) }}</div>
              </div>
              <div class="exam-card__progress">
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" :style="{ width: getExamProgressPercent(exam) + '%' }"></div>
                </div>
                <span class="progress-percent">{{ getExamProgressPercent(exam) }}%</span>
              </div>
            </div>
          </template>
        </div>
      </aside>

      <!-- 第三栏：审核工作区 -->
      <section class="review-workspace" v-if="selectedExam && currentQuestion">
        <!-- 顶部信息栏 -->
        <div class="review-header">
          <div class="review-header__left">
            <div class="review-header__student">
              <div class="review-avatar-circle">{{ reviewStore.currentStudent?.name?.charAt(0) || '?' }}</div>
              <div class="review-header__student-info">
                <div class="review-header__name">{{ reviewStore.currentStudent?.name }}</div>
                <div class="review-header__class">{{ reviewStore.currentStudent?.grade }}</div>
              </div>
            </div>
            <div class="review-header__exam">
              <div class="review-header__exam-name">{{ selectedExam.name }}</div>
              <div class="review-header__exam-info">
                共 {{ totalQuestions }} 题 · AI批改完成 · 人工复核中
              </div>
            </div>
          </div>
          <div class="review-header__center">
            <div class="review-header__ai-badge">
              <el-icon><CircleCheckFilled /></el-icon>
              AI批改进度
            </div>
            <div class="review-header__ai-value">{{ reviewedCount }}/{{ totalQuestions }} 题</div>
            <div class="review-header__ai-status">
              <el-icon class="ai-done-icon"><CircleCheckFilled /></el-icon>
              已完成
            </div>
          </div>
          <div class="review-header__right">
            <div class="review-header__manual">
              <div class="review-header__manual-label">人工复核进度</div>
              <div class="review-header__manual-value">{{ reviewedCount }}/{{ totalQuestions }} 题</div>
              <div class="review-header__manual-bar">
                <div class="manual-progress-bar">
                  <div class="manual-progress-fill" :style="{ width: progressPercent + '%' }"></div>
                </div>
                <span class="manual-progress-text">{{ progressPercent }}%</span>
              </div>
            </div>
          </div>
          <div class="review-header__source">
            <span class="review-header__source-label">错题来源：</span>
            <el-select v-model="selectedExamSource" size="small" style="width: 140px;">
              <el-option :label="selectedExam.name" :value="selectedExam.id" />
            </el-select>
          </div>
        </div>

        <!-- 题号导航 -->
        <div class="question-nav-bar">
          <div class="question-nav-bar__pages">
            <div
              v-for="(q, idx) in reviewStore.studentWrongQuestions"
              :key="q.id"
              class="question-nav-btn"
              :class="[getQuestionStatusClass(q), { 'question-nav-btn--active': reviewStore.currentReviewIndex === idx }]"
              @click="jumpToQuestion(idx)"
              @mouseenter="showQuestionTooltip(idx, $event)"
              @mouseleave="hideQuestionTooltip"
            >
              {{ idx + 1 }}
            </div>
          </div>
          <div class="question-nav-bar__legend">
            <span class="legend-item"><span class="legend-dot legend--correct"></span>正确</span>
            <span class="legend-item"><span class="legend-dot legend--wrong"></span>错误</span>
            <span class="legend-item"><span class="legend-dot legend--excluded"></span>排除</span>
            <span class="legend-item"><span class="legend-dot legend--pending"></span>未复核</span>
          </div>
        </div>

        <!-- 题号Tooltip -->
        <div v-if="tooltipVisible" class="question-tooltip" :style="{ top: tooltipY + 'px', left: tooltipX + 'px' }">
          第{{ tooltipIdx + 1 }}题 · {{ tooltipStatusText }}
        </div>

        <!-- 题目内容区（左文本 右图片） -->
        <div class="question-content-section">
          <div class="question-content-section__header">
            <span class="question-content-section__title">题目内容</span>
            <div class="image-toolbar-inline">
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
          <div class="question-content-body">
            <!-- 左侧：题目文本 -->
            <div class="question-text-area">
              <div class="question-text-content">{{ ocrData.questionContent || '暂无题目内容' }}</div>
            </div>
            <!-- 右侧：题目图片 -->
            <div class="question-image-area">
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

        <!-- OCR识别结果区 -->
        <div class="ocr-section">
          <!-- OCR状态行 -->
          <div class="ocr-status-bar">
            <span class="ocr-status-badge ocr-status-badge--blue">
              <el-icon><CircleCheck /></el-icon>
              OCR识别结果
            </span>
            <span class="ocr-status-badge ocr-status-badge--green">
              <el-icon><SuccessFilled /></el-icon>
              识别正常
            </span>
            <span class="ocr-status-badge ocr-status-badge--purple">
              <el-icon><Lightning /></el-icon>
              AI辅助解析
            </span>
          </div>

          <!-- 学生答案 + 参考答案 -->
          <div class="ocr-answer-row">
            <div class="ocr-answer-col">
              <div class="ocr-answer-col__label">学生答案 <span class="ocr-answer-col__sub">（OCR识别）</span></div>
              <div class="ocr-answer-col__body">
                <el-input
                  v-model="ocrData.studentAnswer"
                  type="textarea"
                  :rows="4"
                  placeholder="学生作答内容..."
                  class="ocr-input"
                />
              </div>
            </div>
            <div class="ocr-answer-col">
              <div class="ocr-answer-col__label">参考答案 <span class="ocr-answer-col__sub">（AI生成）</span></div>
              <div class="ocr-answer-col__body">
                <div class="ocr-reference-content">{{ ocrData.correctAnswer || '暂无参考答案' }}</div>
                <div class="ocr-reference-action">
                  <el-button text size="small" type="primary">
                    <el-icon><EditPen /></el-icon>
                    AI参考答案
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- 知识点标签 -->
          <div class="ocr-knowledge-row">
            <div class="ocr-knowledge-row__label">知识点标签</div>
            <div class="ocr-tags-list">
              <el-tag
                v-for="tag in ocrData.knowledgePoints"
                :key="tag"
                size="default"
                closable
                @close="removeTag(tag)"
                type="info"
                effect="light"
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
              class="ocr-input ocr-input--remark"
            />
            <span class="ocr-remark__count">{{ (ocrData.remark || '').length }}/200</span>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="bottom-action-bar">
          <div class="bottom-action-bar__left">
            <el-button size="default" @click="handlePrevQuestion" :disabled="reviewStore.currentReviewIndex === 0">
              <el-icon><ArrowLeft /></el-icon>
              上一题
            </el-button>
            <el-button size="default" @click="handleNextQuestion" :disabled="reviewStore.currentReviewIndex >= reviewStore.studentWrongQuestions.length - 1">
              下一题
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
          <div class="bottom-action-bar__right">
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
      </section>

      <!-- 空状态 -->
      <section class="review-workspace empty-workspace" v-else>
        <div class="empty-state">
          <el-icon :size="64" color="#C9CDD4"><DocumentChecked /></el-icon>
          <p class="empty-state__text">{{ selectedStudentForExam ? '请从左侧选择一份试卷' : '请从左侧选择一个学生开始审核' }}</p>
        </div>
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
  Search, Filter, ChatDotRound, CircleCheck, SuccessFilled, Lightning, EditPen, Plus, User
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const router = useRouter()
const reviewStore = useReviewStore()
const lifecycleStore = useLifecycleStore()

// ===== 导航 =====
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

// ===== 搜索 =====
const searchQuery = ref('')
const filteredStudents = computed(() => {
  let list = reviewStore.students
  if (searchQuery.value) {
    list = list.filter(s => s.name?.includes(searchQuery.value))
  }
  return list
})

// ===== 学生/试卷选择 =====
const selectedStudentForExam = ref(null)
const studentExams = ref([])
const selectedExam = ref(null)

const handleSelectStudent = async (student) => {
  reviewStore.setCurrentStudent(student)
  selectedStudentForExam.value = student
  selectedExam.value = null
  try {
    const exams = await getExamsByStudent(student.id, false)
    studentExams.value = (exams || []).map(exam => ({
      ...exam,
      questionCount: exam.question_count || exam.questionCount || 27,
      accuracy: exam.accuracy || 0,
      manualReviewed: exam.manual_reviewed || 0,
      status: exam.status || 'ungraded'
    }))
  } catch (e) {
    studentExams.value = []
  }
}

const backToStudents = () => {
  selectedStudentForExam.value = null
  selectedExam.value = null
}

const handleSelectExam = (exam) => {
  selectedExam.value = exam
  reviewStore.currentReviewIndex = 0
}

// ===== 图片变换 =====
const imageScale = ref(1)
const imageRotation = ref(0)
const imageTransformTransition = ref(true)
const resetImageTransform = () => {
  imageTransformTransition.value = true
  imageScale.value = 1
  imageRotation.value = 0
}

// ===== 全屏 =====
const fullscreenVisible = ref(false)

// ===== 当前题目 =====
const currentQuestion = computed(() => reviewStore.currentReviewQuestion)
const totalQuestions = computed(() => reviewStore.studentWrongQuestions.length || 0)

const reviewedCount = computed(() => {
  return reviewStore.studentWrongQuestions.filter(q => {
    const status = q.lifecycle_status || q.status
    return status === LIFECYCLE_STATUS.REVIEW_1 || status === LIFECYCLE_STATUS.REVIEW_2 ||
           status === LIFECYCLE_STATUS.MASTERED || q.review_status === 'correct' ||
           q.review_status === 'wrong' || q.review_status === 'excluded'
  }).length
})

const progressPercent = computed(() => {
  if (totalQuestions.value === 0) return 0
  return Math.round((reviewedCount.value / totalQuestions.value) * 100)
})

// ===== 题目状态 =====
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

// ===== Tooltip =====
const tooltipVisible = ref(false)
const tooltipIdx = ref(0)
const tooltipStatusText = ref('')
const tooltipX = ref(0)
const tooltipY = ref(0)

const showQuestionTooltip = (idx, event) => {
  const q = reviewStore.studentWrongQuestions[idx]
  if (!q) return
  tooltipIdx.value = idx
  tooltipStatusText.value = getQuestionStatusText(q)
  const rect = event.currentTarget.getBoundingClientRect()
  tooltipX.value = rect.left + rect.width / 2
  tooltipY.value = rect.top - 36
  tooltipVisible.value = true
}
const hideQuestionTooltip = () => { tooltipVisible.value = false }

// ===== 学生进度 =====
const getStudentPendingCount = (studentId) => reviewStore.getStudentPendingCount(studentId)

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

// ===== 试卷来源 =====
const selectedExamSource = ref('exam1')

// ===== OCR数据 =====
const ocrData = ref({
  questionContent: '',
  studentAnswer: '',
  correctAnswer: '',
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
      studentAnswer: newQ.question.student_answer || '',
      correctAnswer: newQ.question.answer || '',
      knowledgePoints: newQ.question.ai_tags || newQ.question.knowledge_points || [],
      remark: newQ.question.remark || '',
    }
  } else {
    ocrData.value = { questionContent: '', studentAnswer: '', correctAnswer: '', knowledgePoints: [], remark: '' }
  }
  resetImageTransform()
}, { immediate: true })

// ===== 日期 =====
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return dayjs(dateStr).format('MM-DD HH:mm')
}

// ===== 题号导航 =====
const jumpToQuestion = (idx) => { reviewStore.currentReviewIndex = idx }
const handlePrevQuestion = () => { reviewStore.prevQuestion() }
const handleNextQuestion = () => { reviewStore.nextQuestion() }

// ===== 审核 =====
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

// ===== 保存 =====
const handleSave = () => {
  const q = currentQuestion.value
  if (!q) return
  if (q.question) {
    q.question.content = ocrData.value.questionContent
    q.question.student_answer = ocrData.value.studentAnswer
    q.question.answer = ocrData.value.correctAnswer
    q.question.ai_tags = ocrData.value.knowledgePoints
    q.question.remark = ocrData.value.remark
  }
  ElMessage.success('保存成功')
}

// ===== 键盘 =====
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
  await reviewStore.initData()
  window.addEventListener('keydown', handleKeyboard)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboard)
})
</script>

<style scoped>
.dashboard-workbench {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== Top Header ===== */
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

/* ===== Nav Sidebar ===== */
.nav-sidebar {
  width: 220px; background: #fff; border-right: 1px solid #E5E6EB;
  flex-shrink: 0; display: flex; flex-direction: column; padding: 16px 12px;
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

/* ===== List Panel (Student/Exam List) ===== */
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

/* 学生卡片 */
.student-card {
  background: #fff; border-radius: 12px; border: 1px solid transparent;
  cursor: pointer; transition: all 0.2s; margin-bottom: 8px;
  padding: 12px;
}
.student-card:hover { border-color: #B4D6FF; box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08); }
.student-card--active { border-color: #1677FF; background: #E8F3FF; box-shadow: 0 2px 8px rgba(22, 119, 255, 0.12); }

.student-card__top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.avatar-circle {
  width: 36px; height: 36px; border-radius: 50%;
  background: #E5E6EB; color: #4E5969; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 500;
}
.student-card__info { flex: 1; }
.student-card__name { font-size: 14px; font-weight: 500; color: #1D2129; }
.student-card__class { font-size: 12px; color: #86909C; }
.student-card__badge {
  font-size: 16px; color: #fff;
  background: #F53F3F; border-radius: 50%; padding: 2px;
  width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
}
.student-card__stats { margin-bottom: 8px; }
.stat-line { display: flex; align-items: center; gap: 4px; font-size: 12px; margin-bottom: 2px; }
.stat-label { color: #86909C; }
.stat-value { color: #1D2129; font-weight: 500; }
.stat-icon--success { color: #52C41A; font-size: 12px; }

.student-card__progress { display: flex; align-items: center; gap: 8px; }
.progress-bar-bg { flex: 1; height: 6px; background: #F2F3F5; border-radius: 3px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: #1677FF; border-radius: 3px; transition: width 0.3s ease; }
.progress-percent { font-size: 12px; color: #86909C; white-space: nowrap; }

/* 试卷卡片 */
.exam-card {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border-radius: 12px; border: 1px solid transparent;
  cursor: pointer; transition: all 0.2s; margin-bottom: 8px;
  padding: 12px;
}
.exam-card:hover { border-color: #B4D6FF; box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08); }
.exam-card--active { border-color: #1677FF; background: #E8F3FF; box-shadow: 0 2px 8px rgba(22, 119, 255, 0.12); }
.exam-card__info { flex: 1; }
.exam-card__name { font-size: 13px; font-weight: 500; color: #1D2129; margin-bottom: 2px; }
.exam-card__meta { font-size: 11px; color: #86909C; }
.exam-card__progress { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* ===== Review Workspace ===== */
.review-workspace { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #F5F7FA; min-width: 0; }
.empty-workspace { align-items: center; justify-content: center; }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.empty-state__text { font-size: 14px; color: #86909C; }

/* ===== Review Header ===== */
.review-header {
  display: flex; align-items: center; padding: 10px 20px;
  background: #fff; border-bottom: 1px solid #E5E6EB; gap: 16px; flex-shrink: 0;
}
.review-header__left { display: flex; align-items: center; gap: 12px; }
.review-header__student { display: flex; align-items: center; gap: 8px; }
.review-avatar-circle {
  width: 36px; height: 36px; border-radius: 50%;
  background: #E5E6EB; color: #4E5969; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 500;
}
.review-header__student-info { display: flex; flex-direction: column; }
.review-header__name { font-size: 15px; font-weight: 600; color: #1D2129; }
.review-header__class { font-size: 12px; color: #86909C; }
.review-header__exam { display: flex; flex-direction: column; gap: 2px; }
.review-header__exam-name { font-size: 14px; font-weight: 500; color: #1D2129; }
.review-header__exam-info { font-size: 12px; color: #86909C; }

.review-header__center {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: #F6FFED; border-radius: 8px;
  border: 1px solid #B7EB8F;
}
.review-header__ai-badge {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: #52C41A; font-weight: 500;
}
.review-header__ai-badge .el-icon { font-size: 14px; }
.review-header__ai-value { font-size: 12px; color: #389E0D; font-weight: 600; }
.review-header__ai-status {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: #52C41A;
}
.ai-done-icon { font-size: 14px; }

.review-header__right { display: flex; flex-direction: column; align-items: flex-start; }
.review-header__manual-label { font-size: 12px; color: #4E5969; font-weight: 500; margin-bottom: 2px; }
.review-header__manual-value { font-size: 14px; font-weight: 600; color: #1D2129; margin-bottom: 4px; }
.review-header__manual-bar { display: flex; align-items: center; gap: 8px; }
.manual-progress-bar { width: 100px; height: 6px; background: #F2F3F5; border-radius: 3px; overflow: hidden; }
.manual-progress-fill { height: 100%; background: #1677FF; border-radius: 3px; transition: width 0.3s ease; }
.manual-progress-text { font-size: 12px; color: #1677FF; font-weight: 600; }

.review-header__source { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.review-header__source-label { font-size: 12px; color: #86909C; }

/* ===== Question Nav ===== */
.question-nav-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 20px; background: #fff; border-bottom: 1px solid #E5E6EB; gap: 12px;
}
.question-nav-bar__pages { display: flex; align-items: center; gap: 4px; overflow-x: auto; flex: 1; }
.question-nav-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.15s;
  flex-shrink: 0; font-weight: 500; position: relative;
}
.question-nav-btn:hover { transform: scale(1.1); }
.question-nav-btn--active { box-shadow: 0 0 0 2px #1677FF; }

.status-pending { background: #F2F3F5; color: #86909C; border: 1px solid #E5E6EB; }
.status-correct { background: #F6FFED; color: #52C41A; border: 1px solid #B7EB8F; }
.status-wrong { background: #FFF2F0; color: #FF4D4F; border: 1px solid #FFCCC7; }
.status-excluded { background: #FFF7E6; color: #FA8C16; border: 1px solid #FFD591; }

.question-nav-bar__legend { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #86909C; }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.legend--pending { background: #86909C; }
.legend--correct { background: #52C41A; }
.legend--wrong { background: #FF4D4F; }
.legend--excluded { background: #FA8C16; }

/* ===== Tooltip ===== */
.question-tooltip {
  position: fixed; transform: translateX(-50%);
  background: rgba(29, 33, 41, 0.85); color: #fff;
  font-size: 12px; padding: 4px 10px; border-radius: 6px;
  white-space: nowrap; z-index: 9999; pointer-events: none;
}

/* ===== Question Content Section ===== */
.question-content-section {
  margin: 10px 20px 0; background: #fff; border-radius: 12px;
  border: 1px solid #E5E6EB; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}
.question-content-section__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid #F2F3F5;
}
.question-content-section__title { font-size: 13px; font-weight: 500; color: #1D2129; }
.image-toolbar-inline { display: flex; align-items: center; gap: 0; }
.image-toolbar-inline :deep(.el-button) { padding: 6px 8px; color: #86909C; font-size: 16px; }
.image-toolbar-inline :deep(.el-button:hover) { color: #1677FF; background: #F2F3F5; }

.question-content-body { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.question-text-area {
  padding: 16px; border-right: 1px solid #F2F3F5;
  overflow-y: auto; max-height: 300px;
}
.question-text-content { font-size: 13px; color: #1D2129; line-height: 1.8; white-space: pre-wrap; }
.question-image-area {
  display: flex; align-items: center; justify-content: center;
  padding: 16px; overflow: hidden; min-height: 200px;
}
.question-image { max-width: 100%; max-height: 100%; object-fit: contain; }
.image-preview-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #C9CDD4; }
.placeholder-text { font-size: 13px; color: #86909C; }

/* ===== OCR Section ===== */
.ocr-section {
  margin: 10px 20px; background: #fff; border-radius: 12px;
  border: 1px solid #E5E6EB; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.ocr-status-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-bottom: 1px solid #F2F3F5;
}
.ocr-status-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;
}
.ocr-status-badge--blue { background: #E8F3FF; color: #1677FF; }
.ocr-status-badge--green { background: #F6FFED; color: #52C41A; }
.ocr-status-badge--purple { background: #F9F0FF; color: #722ED1; }
.ocr-status-badge .el-icon { font-size: 14px; }

.ocr-answer-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #F2F3F5; }
.ocr-answer-col { padding: 14px 16px; }
.ocr-answer-col:first-child { border-right: 1px solid #F2F3F5; }
.ocr-answer-col__label { font-size: 12px; font-weight: 500; color: #4E5969; margin-bottom: 8px; }
.ocr-answer-col__sub { font-weight: 400; color: #86909C; }
.ocr-answer-col__body { display: flex; flex-direction: column; gap: 8px; }
.ocr-reference-content {
  font-size: 12px; color: #1D2129; line-height: 1.7;
  padding: 10px 12px; background: #F9FAFB; border-radius: 8px;
  border: 1px solid #E5E6EB; white-space: pre-wrap;
  max-height: 120px; overflow-y: auto;
}
.ocr-reference-action { display: flex; align-items: center; }

.ocr-knowledge-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #F2F3F5; }
.ocr-knowledge-row__label { font-size: 12px; font-weight: 500; color: #4E5969; white-space: nowrap; padding-top: 2px; }
.ocr-tags-list { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: 1; }
.add-tag-btn { font-size: 12px; }

.ocr-remark { display: flex; align-items: center; gap: 12px; padding: 10px 16px; }
.ocr-remark__label { font-size: 12px; color: #86909C; white-space: nowrap; }
.ocr-remark__count { font-size: 11px; color: #C9CDD4; white-space: nowrap; }

/* ===== Bottom Action Bar ===== */
.bottom-action-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px; background: #fff; border-top: 1px solid #E5E6EB; flex-shrink: 0;
}
.bottom-action-bar__left { display: flex; align-items: center; gap: 8px; }
.bottom-action-bar__right { display: flex; align-items: center; gap: 10px; }
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

/* ===== Scrollbar ===== */
.list-panel__list::-webkit-scrollbar { width: 6px; }
.list-panel__list::-webkit-scrollbar-track { background: transparent; }
.list-panel__list::-webkit-scrollbar-thumb { background: #E5E6EB; border-radius: 3px; }
</style>
