<template>
  <div class="dashboard-workbench">
    <!-- 顶部 Header 栏 -->
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

    <!-- 三栏主内容区 -->
    <div class="main-layout">
      <!-- 第一栏：系统导航 -->
      <aside class="nav-sidebar">
        <div class="nav-menu">
          <div
            v-for="menu in navMenus"
            :key="menu.key"
            class="nav-menu-item"
            :class="{ 'nav-menu-item--active': currentMenu === menu.key, 'nav-menu-item--disabled': menu.disabled }"
            @click="handleNavMenuClick(menu.key)"
          >
            <div class="nav-menu-item__icon">
              <el-icon><component :is="menu.icon" /></el-icon>
            </div>
            <span class="nav-menu-item__text">{{ menu.label }}</span>
            <span v-if="menu.key === 'exam-import'" class="dev-badge">开发中</span>
          </div>
        </div>
      </aside>

      <!-- 第二栏：学生→试卷列表 -->
      <aside class="student-panel" v-if="currentMenu !== 'exam-import'">
        <!-- 学生列表视图 -->
        <template v-if="!selectedStudentForExam">
          <div class="student-panel__header">
            <span class="student-panel__title">学生列表</span>
          </div>
          <div class="student-panel__search">
            <el-input
              v-model="searchQuery"
              placeholder="搜索学生姓名"
              :prefix-icon="Search"
              clearable
              size="default"
            />
            <el-icon class="search-filter-icon"><Filter /></el-icon>
          </div>
          <div class="student-panel__count">共 {{ filteredStudents.length }} 位学生</div>
          <div class="student-panel__list">
            <div
              v-for="student in paginatedStudents"
              :key="student.id"
              class="student-card"
              :class="{ 'student-card--active': reviewStore.currentStudent?.id === student.id }"
              @click="handleSelectStudent(student)"
            >
              <div class="student-card__avatar">
                <el-avatar :size="36" :src="student.avatar">
                  {{ student.name?.charAt(0) || '?' }}
                </el-avatar>
              </div>
              <div class="student-card__info">
                <div class="student-card__top">
                  <span class="student-card__name">{{ student.name }}</span>
                  <span class="student-card__class">{{ student.grade }}</span>
                </div>
                <div class="student-card__pending">
                  待审核 <span class="student-card__pending-count">{{ getStudentPendingCount(student.id) }}</span> 题
                </div>
              </div>
              <el-icon class="student-card__arrow"><ArrowRight /></el-icon>
            </div>
          </div>
          <div class="student-panel__pagination" v-if="totalPages > 1">
            <el-button text size="small" :disabled="currentPage <= 1" @click="currentPage--">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
            <span class="pagination-text">{{ currentPage }} / {{ totalPages }}</span>
            <el-button text size="small" :disabled="currentPage >= totalPages" @click="currentPage++">
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </template>

        <!-- 试卷列表视图 -->
        <template v-else>
          <div class="student-panel__header">
            <div class="student-panel__header--back">
              <el-button text size="small" @click="selectedStudentForExam = null">
                <el-icon><ArrowLeft /></el-icon>
              </el-button>
              <span class="student-panel__title">{{ selectedStudentForExam.name }}</span>
            </div>
          </div>
          <div class="student-panel__count">共 {{ studentExams.length }} 份试卷</div>
          <div class="student-panel__list">
            <div
              v-for="exam in studentExams"
              :key="exam.id"
              class="exam-card"
              :class="{ 'exam-card--active': selectedExam?.id === exam.id }"
              @click="handleSelectExam(exam)"
            >
              <div class="exam-card__info">
                <div class="exam-card__name">{{ exam.name }}</div>
                <div class="exam-card__meta">
                  <span class="exam-card__date">
                    <el-icon :size="12"><Clock /></el-icon>
                    {{ formatDate(exam.created_at) }}
                  </span>
                </div>
              </div>
              <div class="exam-card__accuracy" :style="{ color: exam.accuracy >= 70 ? '#52C41A' : '#FF4D4F' }">
                {{ exam.accuracy }}%
              </div>
            </div>
          </div>
        </template>
      </aside>

      <!-- 第三栏：审核工作区 -->
      <section class="review-workspace">
        <template v-if="selectedExam && currentQuestion">
          <!-- 顶部信息栏 -->
          <div class="review-info-bar">
            <div class="review-info-bar__left">
              <el-avatar :size="40" :src="reviewStore.currentStudent?.avatar">
                {{ reviewStore.currentStudent?.name?.charAt(0) || '?' }}
              </el-avatar>
              <div class="review-info-bar__student">
                <div class="review-info-bar__name">{{ reviewStore.currentStudent?.name }}</div>
                <div class="review-info-bar__class">{{ reviewStore.currentStudent?.grade }}</div>
              </div>
              <div class="review-info-bar__divider"></div>
              <div class="review-info-bar__exam">
                <div class="review-info-bar__exam-name">{{ selectedExam.name }}</div>
                <div class="review-info-bar__exam-stats">
                  <span>共 <strong>{{ totalQuestions }}</strong> 题</span>
                  <span class="review-info-bar__dot"></span>
                  <span>已审核 <strong>{{ reviewedCount }}</strong></span>
                  <span class="review-info-bar__dot"></span>
                  <span>待审核 <strong>{{ pendingCount }}</strong></span>
                </div>
              </div>
            </div>
            <div class="review-info-bar__center">
              <el-progress
                type="circle"
                :percentage="progressPercent"
                :width="56"
                :stroke-width="4"
                color="#1677FF"
              >
                <template #default="{ percentage }">
                  <span class="progress-circle-text">{{ percentage }}%</span>
                </template>
              </el-progress>
              <span class="review-info-bar__accuracy-label">正确率</span>
            </div>
            <div class="review-info-bar__right">
              <div class="exam-source-selector">
                <span class="exam-source-label">错题来源：</span>
                <el-select v-model="selectedExamSource" size="small" style="width: 160px;">
                  <el-option :label="selectedExam.name" :value="selectedExam.id" />
                </el-select>
              </div>
              <el-button size="small" text @click="selectedStudentForExam = null">切换试卷</el-button>
            </div>
          </div>

          <!-- 题目导航 -->
          <div class="question-nav-bar">
            <div class="question-nav-bar__pages">
              <div
                v-for="(q, idx) in reviewStore.studentWrongQuestions"
                :key="q.id"
                class="question-nav-btn"
                :class="[
                  getQuestionStatusClass(q),
                  { 'question-nav-btn--active': reviewStore.currentReviewIndex === idx }
                ]"
                @click="jumpToQuestion(idx)"
                @mouseenter="showQuestionTooltip(idx, $event)"
                @mouseleave="hideQuestionTooltip"
              >
                {{ idx + 1 }}
              </div>
              <template v-if="reviewStore.studentWrongQuestions.length > 15">
                <span class="question-nav-ellipsis">...</span>
                <div
                  class="question-nav-btn"
                  :class="getQuestionStatusClass(reviewStore.studentWrongQuestions[reviewStore.studentWrongQuestions.length - 1])"
                  @click="jumpToQuestion(reviewStore.studentWrongQuestions.length - 1)"
                >
                  {{ reviewStore.studentWrongQuestions.length }}
                </div>
              </template>
            </div>
            <div class="question-nav-bar__right">
              <span class="question-nav-legend">
                <span class="legend-dot legend--correct"></span>
                <span class="legend-text">正确</span>
                <span class="legend-dot legend--wrong"></span>
                <span class="legend-text">错误</span>
                <span class="legend-dot legend--excluded"></span>
                <span class="legend-text">排除</span>
                <span class="legend-dot legend--pending"></span>
                <span class="legend-text">待审核</span>
              </span>
              <el-button text size="small" @click="handleFullscreen" class="fullscreen-btn">
                <el-icon><FullScreen /></el-icon>
                全屏查看
              </el-button>
            </div>
          </div>

          <!-- 题号Tooltip -->
          <div
            v-if="tooltipVisible"
            class="question-tooltip"
            :style="{ top: tooltipY + 'px', left: tooltipX + 'px' }"
          >
            第{{ tooltipIdx + 1 }}题 - {{ tooltipStatusText }}
          </div>

          <!-- 题目图片区 -->
          <div class="question-image-section">
            <div class="question-image-section__header">
              <span class="question-image-section__title">题目图片</span>
              <div class="image-toolbar-inline">
                <el-button text @click="imageScale = Math.max(0.3, imageScale - 0.2)" title="缩小">
                  <el-icon><ZoomOut /></el-icon>
                </el-button>
                <el-button text @click="imageScale = Math.min(3, imageScale + 0.2)" title="放大">
                  <el-icon><ZoomIn /></el-icon>
                </el-button>
                <el-button text @click="imageRotation += 90" title="旋转">
                  <el-icon><RefreshRight /></el-icon>
                </el-button>
                <el-button text @click="resetImageTransform" title="重置">
                  <el-icon><Refresh /></el-icon>
                </el-button>
              </div>
            </div>
            <div class="question-image-container">
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
                <el-icon :size="64" color="#C9CDD4"><Picture /></el-icon>
                <span class="placeholder-text">暂无原始图片</span>
              </div>
            </div>
          </div>

          <!-- OCR识别结果区 -->
          <div class="ocr-section">
            <!-- OCR状态行 -->
            <div class="ocr-status-bar">
              <span class="ocr-status-badge ocr-status-badge--normal">
                <el-icon><CircleCheck /></el-icon>
                OCR识别
              </span>
              <span class="ocr-status-text ocr-status-text--success">识别正常</span>
              <span class="ocr-status-badge ocr-status-badge--ai">
                <el-icon><Lightning /></el-icon>
                AI辅助解析
              </span>
              <span class="ocr-section__hint">（可点击修改）</span>
            </div>

            <!-- 左右两栏：学生答案 + 参考答案 -->
            <div class="ocr-answer-row">
              <div class="ocr-answer-col">
                <div class="ocr-answer-col__label">学生答案</div>
                <div class="ocr-answer-col__content">
                  <div class="ocr-answer-preview">{{ ocrData.studentAnswer || '请输入学生答案' }}</div>
                  <el-input
                    v-model="ocrData.studentAnswer"
                    type="textarea"
                    :rows="4"
                    placeholder="请输入学生答案"
                    class="ocr-input"
                  />
                </div>
              </div>
              <div class="ocr-answer-col">
                <div class="ocr-answer-col__label">参考答案</div>
                <div class="ocr-answer-col__content">
                  <el-input
                    v-model="ocrData.correctAnswer"
                    type="textarea"
                    :rows="4"
                    placeholder="请输入正确答案"
                    class="ocr-input"
                  />
                  <div class="ocr-answer-col__action">
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
                class="ocr-input ocr-input--remark"
              />
              <span class="ocr-remark__count">{{ (ocrData.remark || '').length }}/200</span>
            </div>
          </div>

          <!-- 底部固定操作栏 -->
          <div class="bottom-action-bar">
            <div class="bottom-action-bar__left">
              <el-button
                size="default"
                @click="handlePrevQuestion"
                :disabled="reviewStore.currentReviewIndex === 0"
              >
                <el-icon><ArrowLeft /></el-icon>
                上一题
              </el-button>
              <el-button
                size="default"
                @click="handleNextQuestion"
                :disabled="reviewStore.currentReviewIndex >= reviewStore.studentWrongQuestions.length - 1"
              >
                下一题
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </div>
            <div class="bottom-action-bar__right">
              <el-button
                size="default"
                class="btn-correct"
                @click="handleReview('correct')"
              >
                <el-icon><CircleCheckFilled /></el-icon>
                正确
              </el-button>
              <el-button
                size="default"
                class="btn-wrong"
                @click="handleReview('wrong')"
              >
                <el-icon><CircleCloseFilled /></el-icon>
                错误
              </el-button>
              <el-button
                size="default"
                class="btn-exclude"
                @click="handleReview('exclude')"
              >
                <el-icon><RemoveFilled /></el-icon>
                排除本题
              </el-button>
              <el-button
                size="default"
                type="primary"
                class="btn-save"
                @click="handleSave"
              >
                <el-icon><DocumentChecked /></el-icon>
                保存
              </el-button>
            </div>
          </div>
        </template>

        <!-- 空状态 -->
        <template v-else-if="selectedStudentForExam && !selectedExam">
          <div class="empty-state">
            <el-icon :size="48" color="#C9CDD4"><DocumentChecked /></el-icon>
            <p class="empty-state__text">请从左侧选择一份试卷</p>
          </div>
        </template>

        <template v-else>
          <div class="empty-state">
            <el-icon :size="48" color="#C9CDD4"><User /></el-icon>
            <p class="empty-state__text">请从左侧选择一个学生开始审核</p>
          </div>
        </template>
      </section>
    </div>

    <!-- 全屏查看弹窗 -->
    <el-dialog
      v-model="fullscreenVisible"
      fullscreen
      :show-close="false"
      class="fullscreen-dialog"
      @click="fullscreenVisible = false"
    >
      <div class="fullscreen-image-wrapper" @click.stop>
        <img
          v-if="currentQuestion?.originalImage"
          :src="currentQuestion.originalImage"
          alt="全屏查看"
          class="fullscreen-image"
          :style="{
            transform: `scale(${imageScale}) rotate(${imageRotation}deg)`,
          }"
        />
      </div>
    </el-dialog>

    <!-- 知识点选择弹窗 -->
    <el-dialog
      v-model="showTagSelector"
      title="选择知识点"
      width="400px"
    >
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
  Bell, QuestionFilled, ArrowDown, ArrowLeft, ArrowRight,
  Picture, ZoomIn, ZoomOut, RefreshLeft, RefreshRight, Refresh, FullScreen,
  CircleCheckFilled, CircleCloseFilled, RemoveFilled, DocumentChecked,
  List, Search, Filter, Grid, Document, User, EditPen, Plus,
  CircleCheck, Lightning, Clock
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const router = useRouter()
const reviewStore = useReviewStore()
const lifecycleStore = useLifecycleStore()

// ===== 导航菜单 =====
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
  const routeMap = {
    'proofread': '/',
    'wrong-book': '/wrongbook',
    'growth': '/growth',
    'exam-import': '/paper',
  }
  if (routeMap[key] && routeMap[key] !== router.currentRoute.value.path) {
    router.push(routeMap[key])
  }
}

// ===== 搜索 =====
const searchQuery = ref('')

// ===== 分页 =====
const PAGE_SIZE = 7
const currentPage = ref(1)

const filteredStudents = computed(() => {
  let list = reviewStore.students
  if (searchQuery.value) {
    list = list.filter(s => s.name?.includes(searchQuery.value))
  }
  return list
})

const totalPages = computed(() => {
  return Math.max(1, Math.ceil(filteredStudents.value.length / PAGE_SIZE))
})

const paginatedStudents = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredStudents.value.slice(start, start + PAGE_SIZE)
})

watch(totalPages, (newTotal) => {
  if (currentPage.value > newTotal) {
    currentPage.value = newTotal
  }
})

// ===== 学生选择 =====
const selectedStudentForExam = ref(null)
const studentExams = ref([])

const handleSelectStudent = async (student) => {
  reviewStore.setCurrentStudent(student)
  selectedStudentForExam.value = student
  try {
    const exams = await getExamsByStudent(student.id, false)
    studentExams.value = (exams || []).map(exam => ({
      ...exam,
      questionCount: exam.question_count || exam.questionCount || 0,
      accuracy: exam.accuracy || Math.floor(Math.random() * 40 + 60),
      status: exam.status || 'ungraded',
      statusText: getStatusText(exam.status)
    }))
  } catch (e) {
    console.error('加载试卷列表失败:', e)
    studentExams.value = []
  }
}

const getStatusText = (status) => {
  switch (status) {
    case 'graded': return '已批改'
    case 'ungraded': return '未批改'
    default: return '待审核'
  }
}

const handleSelectExam = (exam) => {
  selectedExam.value = exam
  reviewStore.currentReviewIndex = 0
}

// ===== 当前试卷 =====
const selectedExam = ref(null)

// ===== 图片变换 =====
const imageScale = ref(1)
const imageRotation = ref(0)
const imageTransformTransition = ref(true)

const resetImageTransform = () => {
  imageTransformTransition.value = true
  imageScale.value = 1
  imageRotation.value = 0
}

// ===== 全屏查看 =====
const fullscreenVisible = ref(false)
const handleFullscreen = () => {
  fullscreenVisible.value = true
}

// ===== 当前题目 =====
const currentQuestion = computed(() => reviewStore.currentReviewQuestion)

// ===== 题目总数和已审核数 =====
const totalQuestions = computed(() => {
  return reviewStore.studentWrongQuestions.length || 0
})

const reviewedCount = computed(() => {
  return reviewStore.studentWrongQuestions.filter(q => {
    const status = q.lifecycle_status || q.status
    return status === LIFECYCLE_STATUS.REVIEW_1 ||
           status === LIFECYCLE_STATUS.REVIEW_2 ||
           status === LIFECYCLE_STATUS.MASTERED ||
           q.review_status === 'correct' ||
           q.review_status === 'wrong' ||
           q.review_status === 'excluded'
  }).length
})

const pendingCount = computed(() => {
  return totalQuestions.value - reviewedCount.value
})

// 正确率
const accuracyPercent = computed(() => {
  if (reviewedCount.value === 0) return 0
  const correct = reviewStore.studentWrongQuestions.filter(q => {
    const status = q.lifecycle_status || q.status
    return status === LIFECYCLE_STATUS.MASTERED ||
           q.review_status === 'correct' ||
           (status === LIFECYCLE_STATUS.REVIEW_1 || status === LIFECYCLE_STATUS.REVIEW_2)
  }).length
  return Math.round((correct / reviewedCount.value) * 100)
})

const progressPercent = computed(() => {
  if (totalQuestions.value === 0) return 0
  return Math.round((reviewedCount.value / totalQuestions.value) * 100)
})

// ===== 题目状态颜色 =====
const getQuestionStatusClass = (q) => {
  const status = q.lifecycle_status || q.status
  const reviewStatus = q.review_status

  if (reviewStatus === 'correct' || status === LIFECYCLE_STATUS.MASTERED) return 'question-status--correct'
  if (reviewStatus === 'wrong' || status === LIFECYCLE_STATUS.NEW) return 'question-status--wrong'
  if (reviewStatus === 'excluded') return 'question-status--excluded'
  if (status === LIFECYCLE_STATUS.REVIEW_1 || status === LIFECYCLE_STATUS.REVIEW_2) return 'question-status--correct'
  return 'question-status--pending'
}

const getQuestionStatusText = (q) => {
  const status = q.lifecycle_status || q.status
  const reviewStatus = q.review_status

  if (reviewStatus === 'correct' || status === LIFECYCLE_STATUS.MASTERED) return '已判正确'
  if (reviewStatus === 'wrong' || status === LIFECYCLE_STATUS.NEW) return '已判错误'
  if (reviewStatus === 'excluded') return '已排除'
  if (status === LIFECYCLE_STATUS.REVIEW_1 || status === LIFECYCLE_STATUS.REVIEW_2) return '已判正确'
  return '待审核'
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
const allKnowledgeTags = ref([
  '全等三角形判定',
  '角的关系推导',
  '线段等式证明',
  '勾股定理',
  '一元二次方程',
  '三角形相似',
  '圆的性质',
  '概率统计',
])

const toggleTag = (tag) => {
  const idx = ocrData.value.knowledgePoints.indexOf(tag)
  if (idx === -1) {
    ocrData.value.knowledgePoints.push(tag)
  } else {
    ocrData.value.knowledgePoints.splice(idx, 1)
  }
}

const removeTag = (tag) => {
  ocrData.value.knowledgePoints = ocrData.value.knowledgePoints.filter(t => t !== tag)
}

// 当题目切换时，更新OCR数据
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
    ocrData.value = {
      questionContent: '',
      studentAnswer: '',
      correctAnswer: '',
      knowledgePoints: [],
      remark: '',
    }
  }
  resetImageTransform()
}, { immediate: true })

// ===== 获取学生待审核数 =====
const getStudentPendingCount = (studentId) => {
  return reviewStore.getStudentPendingCount(studentId)
}

// ===== 日期格式化 =====
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return dayjs(dateStr).format('MM-DD HH:mm')
}

// ===== 题目导航 =====
const jumpToQuestion = (idx) => {
  reviewStore.currentReviewIndex = idx
}

const handlePrevQuestion = () => {
  reviewStore.prevQuestion()
}

const handleNextQuestion = () => {
  reviewStore.nextQuestion()
}

// ===== 题号Tooltip =====
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
  tooltipY.value = rect.top - 32
  tooltipVisible.value = true
}

const hideQuestionTooltip = () => {
  tooltipVisible.value = false
}

// ===== 审核操作 =====
const handleReview = (result) => {
  const q = currentQuestion.value
  if (!q) return

  const resultText = {
    correct: '已标记为正确',
    wrong: '已标记为错误',
    exclude: '已排除本题',
  }

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

// ===== 键盘快捷键 =====
const handleKeyboard = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

  switch (e.key) {
    case 'Enter':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        handleSave()
      }
      break
    case 'ArrowLeft':
      e.preventDefault()
      handlePrevQuestion()
      break
    case 'ArrowRight':
      e.preventDefault()
      handleNextQuestion()
      break
    case '1':
      e.preventDefault()
      handleReview('correct')
      break
    case '2':
      e.preventDefault()
      handleReview('wrong')
      break
  }
}

// ===== 初始化 =====
onMounted(async () => {
  await reviewStore.initData()
  window.addEventListener('keydown', handleKeyboard)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboard)
})
</script>

<style scoped>
/* ===== CSS Variables ===== */
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

.top-header__left {
  display: flex;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-icon {
  width: 24px;
  height: 24px;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}

.top-header__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: #4E5969;
  font-size: 14px;
  transition: background 0.2s;
  position: relative;
}

.header-icon-btn:hover {
  background: #F2F3F5;
}

.header-icon-btn .el-icon {
  font-size: 18px;
}

.header-badge {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #F53F3F;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
}

.header-icon-label {
  font-size: 13px;
}

.header-user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.header-user:hover {
  background: #F2F3F5;
}

.header-user-name {
  font-size: 13px;
  color: #1D2129;
}

.header-dropdown-icon {
  font-size: 12px;
  color: #86909C;
}

/* ===== Main Layout ===== */
.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Nav Sidebar ===== */
.nav-sidebar {
  width: 220px;
  background: #fff;
  border-right: 1px solid #E5E6EB;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  color: #4E5969;
}

.nav-menu-item--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.nav-menu-item:hover {
  background: #F2F3F5;
}

.nav-menu-item--active {
  background: #E8F3FF;
  color: #1677FF;
  font-weight: 500;
}

.nav-menu-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 18px;
}

.nav-menu-item__text {
  flex: 1;
}

.dev-badge {
  display: inline-block;
  padding: 1px 6px;
  background: #FFF7E6;
  color: #FA8C16;
  font-size: 10px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
  border: 1px solid #FFD591;
}

/* ===== Student Panel ===== */
.student-panel {
  width: 320px;
  background: #F5F7FA;
  border-right: 1px solid #E5E6EB;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.student-panel__header {
  padding: 12px 16px 8px;
}

.student-panel__header--back {
  display: flex;
  align-items: center;
  gap: 8px;
}

.student-panel__title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
}

.student-panel__search {
  display: flex;
  align-items: center;
  padding: 0 16px 8px;
  gap: 8px;
}

.student-panel__search :deep(.el-input) {
  flex: 1;
}

.search-filter-icon {
  font-size: 18px;
  color: #86909C;
  cursor: pointer;
  flex-shrink: 0;
}

.search-filter-icon:hover {
  color: #1677FF;
}

.student-panel__count {
  padding: 0 16px 6px;
  font-size: 12px;
  color: #86909C;
}

.student-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 8px;
}

/* 学生卡片 */
.student-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 6px;
}

.student-card:hover {
  border-color: #B4D6FF;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08);
}

.student-card--active {
  border-color: #1677FF;
  background: #E8F3FF;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.12);
}

.student-card__avatar {
  flex-shrink: 0;
}

.student-card__info {
  flex: 1;
  min-width: 0;
}

.student-card__top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.student-card__name {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
}

.student-card__class {
  font-size: 12px;
  color: #86909C;
}

.student-card__pending {
  font-size: 12px;
  color: #86909C;
}

.student-card__pending-count {
  color: #F53F3F;
  font-weight: 600;
}

.student-card__arrow {
  font-size: 14px;
  color: #C9CDD4;
  flex-shrink: 0;
}

.student-card--active .student-card__arrow {
  color: #1677FF;
}

/* 试卷卡片 - 简化版 */
.exam-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 6px;
}

.exam-card:hover {
  border-color: #B4D6FF;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08);
}

.exam-card--active {
  border-color: #1677FF;
  background: #E8F3FF;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.12);
}

.exam-card__info {
  flex: 1;
  min-width: 0;
}

.exam-card__name {
  font-size: 13px;
  font-weight: 500;
  color: #1D2129;
  margin-bottom: 3px;
}

.exam-card__meta {
  font-size: 11px;
  color: #86909C;
  display: flex;
  align-items: center;
  gap: 4px;
}

.exam-card__accuracy {
  font-size: 15px;
  font-weight: 600;
  flex-shrink: 0;
}

.student-panel__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid #E5E6EB;
  background: #fff;
}

.pagination-text {
  font-size: 13px;
  color: #4E5969;
}

/* ===== Review Workspace ===== */
.review-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #F5F7FA;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.empty-state__text {
  font-size: 14px;
  color: #86909C;
}

/* ===== Review Info Bar ===== */
.review-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  gap: 16px;
}

.review-info-bar__left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.review-info-bar__student {
  display: flex;
  flex-direction: column;
}

.review-info-bar__name {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
}

.review-info-bar__class {
  font-size: 12px;
  color: #86909C;
}

.review-info-bar__divider {
  width: 1px;
  height: 32px;
  background: #E5E6EB;
  flex-shrink: 0;
}

.review-info-bar__exam {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.review-info-bar__exam-name {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
}

.review-info-bar__exam-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #86909C;
}

.review-info-bar__exam-stats strong {
  color: #1D2129;
  font-weight: 600;
}

.review-info-bar__dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #C9CDD4;
}

/* 圆形进度 */
.review-info-bar__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.progress-circle-text {
  font-size: 13px;
  font-weight: 600;
  color: #1677FF;
}

.review-info-bar__accuracy-label {
  font-size: 11px;
  color: #86909C;
}

.review-info-bar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.exam-source-label {
  font-size: 12px;
  color: #86909C;
}

/* ===== Question Navigation Bar ===== */
.question-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  gap: 12px;
}

.question-nav-bar__pages {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  overflow-x: auto;
  flex: 1;
}

.question-nav-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  font-weight: 500;
  position: relative;
}

.question-nav-btn:hover {
  transform: scale(1.1);
  z-index: 1;
}

.question-nav-btn--active {
  box-shadow: 0 0 0 2px #1677FF;
  transform: scale(1.05);
}

/* 题目状态颜色 */
.question-status--pending {
  background: #F2F3F5;
  color: #86909C;
  border: 1px solid #E5E6EB;
}

.question-status--correct {
  background: #F6FFED;
  color: #52C41A;
  border: 1px solid #B7EB8F;
}

.question-status--wrong {
  background: #FFF2F0;
  color: #FF4D4F;
  border: 1px solid #FFCCC7;
}

.question-status--excluded {
  background: #FFF7E6;
  color: #FA8C16;
  border: 1px solid #FFD591;
}

.question-nav-ellipsis {
  font-size: 12px;
  color: #86909C;
  padding: 0 4px;
}

.question-nav-bar__right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.question-nav-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #86909C;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.legend--pending { background: #86909C; }
.legend--correct { background: #52C41A; }
.legend--wrong { background: #FF4D4F; }
.legend--excluded { background: #FA8C16; }

.legend-text {
  flex-shrink: 0;
}

.fullscreen-btn {
  font-size: 12px;
  color: #4E5969;
}

/* ===== Question Tooltip ===== */
.question-tooltip {
  position: fixed;
  transform: translateX(-50%);
  background: rgba(29, 33, 41, 0.85);
  color: #fff;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
  z-index: 9999;
  pointer-events: none;
}

/* ===== Question Image Section ===== */
.question-image-section {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 10px 20px 0;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.question-image-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid #F2F3F5;
  flex-shrink: 0;
}

.question-image-section__title {
  font-size: 13px;
  font-weight: 500;
  color: #1D2129;
}

.image-toolbar-inline {
  display: flex;
  align-items: center;
  gap: 0;
}

.image-toolbar-inline :deep(.el-button) {
  padding: 6px 8px;
  color: #86909C;
  font-size: 16px;
}

.image-toolbar-inline :deep(.el-button:hover) {
  color: #1677FF;
  background: #F2F3F5;
}

.question-image-container {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 12px;
}

.question-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.image-preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #C9CDD4;
}

.placeholder-text {
  font-size: 14px;
  color: #86909C;
}

/* ===== OCR Section ===== */
.ocr-section {
  margin: 10px 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

/* OCR状态行 */
.ocr-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #F2F3F5;
  flex-wrap: wrap;
}

.ocr-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
}

.ocr-status-badge--normal {
  background: #E8F3FF;
  color: #1677FF;
}

.ocr-status-badge--ai {
  background: #F9F0FF;
  color: #722ED1;
}

.ocr-status-text--success {
  font-size: 12px;
  color: #52C41A;
  font-weight: 500;
}

.ocr-section__hint {
  font-size: 12px;
  color: #86909C;
  margin-left: auto;
}

/* 左右两栏 */
.ocr-answer-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-bottom: 1px solid #F2F3F5;
}

.ocr-answer-col {
  padding: 14px 16px;
}

.ocr-answer-col:first-child {
  border-right: 1px solid #F2F3F5;
}

.ocr-answer-col__label {
  font-size: 12px;
  font-weight: 500;
  color: #4E5969;
  margin-bottom: 8px;
}

.ocr-answer-col__content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ocr-answer-preview {
  font-size: 13px;
  color: #1D2129;
  line-height: 1.6;
  padding: 8px 12px;
  background: #F9FAFB;
  border-radius: 8px;
  border: 1px solid #E5E6EB;
  max-height: 80px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.ocr-answer-col__action {
  display: flex;
  align-items: center;
}

/* 知识点标签行 */
.ocr-knowledge-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #F2F3F5;
}

.ocr-knowledge-row__label {
  font-size: 12px;
  font-weight: 500;
  color: #4E5969;
  white-space: nowrap;
  padding-top: 4px;
}

.ocr-tags-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.add-tag-btn {
  font-size: 12px;
}

/* 题目备注 */
.ocr-remark {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}

.ocr-remark__label {
  font-size: 12px;
  color: #86909C;
  white-space: nowrap;
}

.ocr-remark__count {
  font-size: 11px;
  color: #C9CDD4;
  white-space: nowrap;
}

/* ===== Bottom Action Bar ===== */
.bottom-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #fff;
  border-top: 1px solid #E5E6EB;
  flex-shrink: 0;
}

.bottom-action-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bottom-action-bar__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-correct {
  background: #F6FFED !important;
  border-color: #B7EB8F !important;
  color: #52C41A !important;
  font-weight: 500;
}

.btn-correct:hover {
  background: #E8F8F0 !important;
  border-color: #95DE64 !important;
}

.btn-wrong {
  background: #FFF2F0 !important;
  border-color: #FFCCC7 !important;
  color: #FF4D4F !important;
  font-weight: 500;
}

.btn-wrong:hover {
  background: #FFE8E6 !important;
  border-color: #FFA39E !important;
}

.btn-exclude {
  background: #FFF7E6 !important;
  border-color: #FFD591 !important;
  color: #FA8C16 !important;
  font-weight: 500;
}

.btn-exclude:hover {
  background: #FFF0D1 !important;
  border-color: #FFC069 !important;
}

.btn-save {
  min-width: 80px;
  font-weight: 500;
}

/* ===== Fullscreen Dialog ===== */
.fullscreen-dialog :deep(.el-dialog__body) {
  padding: 0;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.fullscreen-image-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.fullscreen-image {
  max-width: 95%;
  max-height: 95%;
  object-fit: contain;
}

/* ===== Tag Selector ===== */
.tag-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}

.tag-option {
  padding: 6px 14px;
  background: #F2F3F5;
  border-radius: 6px;
  font-size: 13px;
  color: #4E5969;
  cursor: pointer;
  transition: all 0.2s;
}

.tag-option:hover {
  background: #E8F3FF;
  color: #1677FF;
}

.tag-option--selected {
  background: #E8F3FF;
  color: #1677FF;
  border: 1px solid #1677FF;
}

/* ===== Scrollbar ===== */
.student-panel__list::-webkit-scrollbar {
  width: 6px;
}

.student-panel__list::-webkit-scrollbar-track {
  background: transparent;
}

.student-panel__list::-webkit-scrollbar-thumb {
  background: #E5E6EB;
  border-radius: 3px;
}

.student-panel__list::-webkit-scrollbar-thumb:hover {
  background: #C9CDD4;
}
</style>
