<template>
  <div class="dashboard-workbench">
    <!-- 顶部 Header 栏 -->
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

    <!-- 三栏主内容区 -->
    <div class="main-layout">
      <!-- 第一栏：系统导航 -->
      <aside class="nav-sidebar">
        <div class="nav-menu">
          <div
            v-for="menu in navMenus"
            :key="menu.key"
            class="nav-menu-item"
            :class="{ 'nav-menu-item--active': currentMenu === menu.key }"
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

      <!-- 第二栏：学生列表 -->
      <aside class="student-panel">
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
              <el-avatar :size="40" :src="student.avatar">
                {{ student.name.charAt(0) }}
              </el-avatar>
            </div>
            <div class="student-card__info">
              <div class="student-card__top">
                <span class="student-card__name">{{ student.name }}</span>
                <span class="student-card__class">{{ student.class }}</span>
              </div>
              <div class="student-card__pending">
                待审核 <span class="student-card__pending-count">{{ getStudentPendingCount(student.id) }}</span> 题
              </div>
              <div class="student-card__time">
                最近上传：{{ getStudentLastUploadTime(student.id) }}
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
      </aside>

      <!-- 第三栏：审核工作区 -->
      <section class="review-workspace">
        <template v-if="reviewStore.currentStudent">
          <!-- 顶部信息栏 -->
          <div class="review-info-bar">
            <div class="review-info-bar__left">
              <el-avatar :size="40" :src="reviewStore.currentStudent.avatar">
                {{ reviewStore.currentStudent.name.charAt(0) }}
              </el-avatar>
              <div class="review-info-bar__text">
                <div class="review-info-bar__name">{{ reviewStore.currentStudent.name }}</div>
                <div class="review-info-bar__class">{{ reviewStore.currentStudent.class }}</div>
              </div>
              <div class="review-info-bar__stats">
                <span class="review-info-bar__pending">待审核 <strong>{{ studentPendingCount }}</strong> 题</span>
                <span class="review-info-bar__reviewed">，已审核 <strong>{{ studentReviewedCount }}</strong> 题</span>
              </div>
            </div>
            <div class="review-info-bar__right">
              <div class="exam-source-selector">
                <span class="exam-source-label">错题来源：</span>
                <el-select v-model="selectedExamSource" size="small" style="width: 180px;">
                  <el-option label="5月18日数学卷" value="exam1" />
                  <el-option label="5月20日语文卷" value="exam2" />
                  <el-option label="5月22日英语卷" value="exam3" />
                </el-select>
              </div>
              <el-button size="small" text>切换试卷</el-button>
            </div>
          </div>

          <!-- 题目分页导航 -->
          <div class="question-pagination-bar">
            <div class="question-pagination-bar__left">
              <span class="question-list-label">题目列表</span>
              <span class="question-list-count">{{ reviewStore.studentWrongQuestions.length }} 题</span>
            </div>
            <div class="question-pagination-bar__pages">
              <div
                v-for="(q, idx) in reviewStore.studentWrongQuestions"
                :key="q.id"
                class="page-btn"
                :class="{ 'page-btn--active': reviewStore.currentReviewIndex === idx }"
                @click="jumpToQuestion(idx)"
              >
                {{ idx + 1 }}
              </div>
            </div>
            <div class="question-pagination-bar__right">
              <span class="total-count">共 {{ reviewStore.studentWrongQuestions.length }} 题</span>
              <div class="view-mode-btns">
                <el-icon class="view-mode-btn"><List /></el-icon>
                <el-icon class="view-mode-btn"><Grid /></el-icon>
              </div>
            </div>
          </div>

          <!-- 图片工具栏 -->
          <div class="image-toolbar">
            <div class="image-toolbar__left">
              <el-button text size="small" @click="imageScale = Math.max(0.3, imageScale - 0.2)">
                <el-icon><ZoomOut /></el-icon>
                缩小
              </el-button>
              <el-button text size="small" @click="imageScale = Math.min(3, imageScale + 0.2)">
                <el-icon><ZoomIn /></el-icon>
                放大
              </el-button>
              <el-button text size="small" @click="imageRotation -= 90">
                <el-icon><RefreshLeft /></el-icon>
                旋转左
              </el-button>
              <el-button text size="small" @click="imageRotation += 90">
                <el-icon><RefreshRight /></el-icon>
                旋转右
              </el-button>
              <el-button text size="small" @click="resetImageTransform">
                <el-icon><Refresh /></el-icon>
                重置
              </el-button>
            </div>
            <div class="image-toolbar__right">
              <el-button text size="small" @click="handleFullscreen">
                <el-icon><FullScreen /></el-icon>
                全屏查看
              </el-button>
            </div>
          </div>

          <!-- 中间内容区：图片预览 + OCR编辑区 -->
          <div class="review-content-area">
            <!-- 图片预览区 -->
            <div class="image-preview-section">
              <div class="image-preview-container">
                <img
                  v-if="currentQuestion?.originalImage"
                  :src="currentQuestion.originalImage"
                  alt="题目图片"
                  class="preview-image"
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

            <!-- OCR编辑区 -->
            <div class="ocr-editor-section">
              <div class="ocr-editor__title">
                OCR识别结果
              </div>
              <div class="ocr-editor__form">
                <div class="form-row">
                  <label class="form-label">题目内容 <span class="required">*</span></label>
                  <el-input
                    v-model="ocrData.questionContent"
                    type="textarea"
                    :rows="3"
                    placeholder="请输入题目内容"
                    class="form-input"
                  />
                </div>
                <div class="form-row">
                  <label class="form-label">学生答案 <span class="required">*</span></label>
                  <el-input
                    v-model="ocrData.studentAnswer"
                    placeholder="请输入学生答案"
                    class="form-input"
                  />
                </div>
                <div class="form-row">
                  <label class="form-label">正确答案 <span class="required">*</span></label>
                  <el-input
                    v-model="ocrData.correctAnswer"
                    placeholder="请输入正确答案"
                    class="form-input"
                  />
                </div>
                <div class="form-row">
                  <label class="form-label">知识点 <span class="required">*</span></label>
                  <el-select
                    v-model="ocrData.knowledgePoints"
                    multiple
                    placeholder="请选择知识点"
                    class="form-input"
                    filterable
                    allow-create
                  >
                    <el-option label="勾股定理" value="pythagorean" />
                    <el-option label="一元二次方程" value="quadratic" />
                    <el-option label="三角形相似" value="similarity" />
                    <el-option label="圆的性质" value="circle" />
                    <el-option label="概率统计" value="probability" />
                  </el-select>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部固定操作栏 -->
          <div class="bottom-action-bar">
            <div class="bottom-action-bar__nav">
              <el-button
                size="large"
                @click="handlePrevQuestion"
                :disabled="reviewStore.currentReviewIndex === 0"
              >
                <el-icon><ArrowLeft /></el-icon>
                上一题
              </el-button>
              <el-button
                size="large"
                @click="handleNextQuestion"
                :disabled="reviewStore.currentReviewIndex >= reviewStore.studentWrongQuestions.length - 1"
              >
                下一题
                <el-icon><ArrowRight /></el-icon>
              </el-button>
            </div>
            <div class="bottom-action-bar__actions">
              <el-button
                size="large"
                class="btn-correct"
                @click="handleReview('correct')"
              >
                <el-icon><CircleCheckFilled /></el-icon>
                正确
              </el-button>
              <el-button
                size="large"
                class="btn-wrong"
                @click="handleReview('wrong')"
              >
                <el-icon><CircleCloseFilled /></el-icon>
                错误
              </el-button>
              <el-button
                size="large"
                class="btn-exclude"
                @click="handleReview('exclude')"
              >
                <el-icon><WarningFilled /></el-icon>
                排除本题
              </el-button>
              <el-button
                size="large"
                type="primary"
                class="btn-save"
                @click="handleSave"
              >
                <el-icon><DocumentCopy /></el-icon>
                保存
              </el-button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="empty-state">
            <el-empty description="请从左侧选择一个学生开始审核" />
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useReviewStore } from '../stores/reviewStore'
import { useLifecycleStore } from '../stores/lifecycleStore'
import { ElMessage } from 'element-plus'
import {
  Bell, QuestionFilled, ArrowDown, ArrowLeft, ArrowRight,
  Picture, ZoomIn, ZoomOut, RefreshLeft, RefreshRight, Refresh, FullScreen,
  CircleCheckFilled, CircleCloseFilled, WarningFilled, DocumentCopy,
  List, Search, Filter, Grid
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
  { key: 'exam-import', label: '试卷入库', icon: 'UploadFilled' },
]

const handleNavMenuClick = (key) => {
  currentMenu.value = key
  // 路由跳转
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
    list = list.filter(s => s.name.includes(searchQuery.value))
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
const handleSelectStudent = (student) => {
  reviewStore.setCurrentStudent(student)
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

// ===== 全屏查看 =====
const fullscreenVisible = ref(false)
const handleFullscreen = () => {
  fullscreenVisible.value = true
}

// ===== 当前题目 =====
const currentQuestion = computed(() => reviewStore.currentReviewQuestion)

// ===== 学生统计 =====
const studentPendingCount = computed(() => {
  return reviewStore.getStudentPendingCount(reviewStore.currentStudent?.id) || 0
})

const studentReviewedCount = computed(() => {
  const studentId = reviewStore.currentStudent?.id
  if (!studentId) return 0
  const total = reviewStore.students.find(s => s.id === studentId)?.wrong_question_count || 0
  return Math.max(0, total - studentPendingCount.value)
})

// ===== 试卷来源 =====
const selectedExamSource = ref('exam1')

// ===== OCR数据 =====
const ocrData = ref({
  questionContent: '',
  studentAnswer: '',
  correctAnswer: '',
  knowledgePoints: [],
})

// 当题目切换时，更新OCR数据
watch(currentQuestion, (newQ) => {
  if (newQ?.question) {
    ocrData.value = {
      questionContent: newQ.question.content || '',
      studentAnswer: newQ.question.student_answer || '',
      correctAnswer: newQ.question.answer || '',
      knowledgePoints: newQ.question.ai_tags || [],
    }
  } else {
    ocrData.value = {
      questionContent: '',
      studentAnswer: '',
      correctAnswer: '',
      knowledgePoints: [],
    }
  }
  // 重置图片变换
  resetImageTransform()
}, { immediate: true })

// ===== 获取学生待审核数 =====
const getStudentPendingCount = (studentId) => {
  return reviewStore.getStudentPendingCount(studentId)
}

// ===== 获取学生最近上传时间 =====
const getStudentLastUploadTime = (studentId) => {
  const questions = reviewStore.wrongQuestions.filter(wq => wq.student_id === studentId)
  if (questions.length === 0) return '暂无'
  const latest = questions.reduce((max, q) => {
    return new Date(q.added_at) > new Date(max.added_at) ? q : max
  })
  const added = dayjs(latest.added_at)
  const now = dayjs()
  if (added.isSame(now, 'day')) {
    return `今天 ${added.format('HH:mm')}`
  } else if (added.isSame(now.subtract(1, 'day'), 'day')) {
    return `昨天 ${added.format('HH:mm')}`
  } else {
    return added.format('MM-DD HH:mm')
  }
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

// ===== 审核操作 =====
const handleReview = (result) => {
  const q = currentQuestion.value
  if (!q) return

  const resultText = {
    correct: '已标记为正确',
    wrong: '已标记为错误',
    exclude: '已排除本题',
  }

  if (result === 'exclude') {
    // 排除本题：跳过此题
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

  // 更新题目数据
  if (q.question) {
    q.question.content = ocrData.value.questionContent
    q.question.student_answer = ocrData.value.studentAnswer
    q.question.answer = ocrData.value.correctAnswer
    q.question.ai_tags = ocrData.value.knowledgePoints
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

/* ===== Nav Sidebar (第一栏: 220px) ===== */
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

/* ===== Student Panel (第二栏: 320px) ===== */
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
  padding: 14px 16px 8px;
}

.student-panel__title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
}

.student-panel__search {
  display: flex;
  align-items: center;
  padding: 0 16px 10px;
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
  padding: 0 16px 8px;
  font-size: 12px;
  color: #86909C;
}

.student-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 8px;
}

.student-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
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
  margin-bottom: 4px;
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
  margin-bottom: 2px;
}

.student-card__pending-count {
  color: #F53F3F;
  font-weight: 600;
}

.student-card__time {
  font-size: 11px;
  color: #C9CDD4;
}

.student-card__arrow {
  font-size: 14px;
  color: #C9CDD4;
  flex-shrink: 0;
}

.student-card--active .student-card__arrow {
  color: #1677FF;
}

.student-panel__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid #E5E6EB;
  background: #fff;
}

.pagination-text {
  font-size: 13px;
  color: #4E5969;
}

/* ===== Review Workspace (第三栏: 自适应) ===== */
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
  align-items: center;
  justify-content: center;
}

/* ===== Review Info Bar ===== */
.review-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
}

.review-info-bar__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-info-bar__text {
  display: flex;
  flex-direction: column;
}

.review-info-bar__name {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}

.review-info-bar__class {
  font-size: 13px;
  color: #86909C;
}

.review-info-bar__stats {
  font-size: 13px;
  color: #86909C;
}

.review-info-bar__stats strong {
  color: #F53F3F;
  font-weight: 600;
}

.review-info-bar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.exam-source-label {
  font-size: 13px;
  color: #86909C;
}

/* ===== Question Pagination Bar ===== */
.question-pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
}

.question-pagination-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.question-list-label {
  font-size: 13px;
  color: #4E5969;
}

.question-list-count {
  font-size: 12px;
  color: #86909C;
}

.question-pagination-bar__pages {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 13px;
  color: #4E5969;
  cursor: pointer;
  transition: all 0.2s;
}

.page-btn:hover {
  background: #F2F3F5;
}

.page-btn--active {
  background: #1677FF;
  color: #fff;
  font-weight: 600;
}

.question-pagination-bar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.total-count {
  font-size: 12px;
  color: #86909C;
}

.view-mode-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}

.view-mode-btn {
  font-size: 16px;
  color: #86909C;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.view-mode-btn:hover {
  background: #F2F3F5;
  color: #4E5969;
}

/* ===== Image Toolbar ===== */
.image-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 20px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
}

.image-toolbar__left {
  display: flex;
  align-items: center;
  gap: 2px;
}

.image-toolbar__left :deep(.el-button) {
  padding: 4px 8px;
  height: auto;
}

.image-toolbar__right {
  display: flex;
  align-items: center;
}

.image-toolbar__right :deep(.el-button) {
  padding: 4px 8px;
  height: auto;
}

/* ===== Review Content Area ===== */
.review-content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 20px;
  gap: 12px;
}

/* Image Preview Section (~60%) */
.image-preview-section {
  flex: 3;
  min-height: 0;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.image-preview-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-image {
  max-width: 95%;
  max-height: 95%;
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

/* OCR Editor Section (~40%) */
.ocr-editor-section {
  flex: 2;
  min-height: 0;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ocr-editor__title {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  border-bottom: 1px solid #E5E6EB;
  flex-shrink: 0;
}

.ocr-editor__form {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.form-label {
  width: 80px;
  flex-shrink: 0;
  font-size: 13px;
  color: #4E5969;
  padding-top: 8px;
  text-align: right;
}

.form-label .required {
  color: #F53F3F;
}

.form-input {
  flex: 1;
}

.form-input :deep(.el-textarea__inner),
.form-input :deep(.el-input__inner) {
  border-radius: 8px;
}

/* ===== Bottom Action Bar ===== */
.bottom-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-top: 1px solid #E5E6EB;
  flex-shrink: 0;
}

.bottom-action-bar__nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bottom-action-bar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-correct {
  background: #F0FFF4 !important;
  border-color: #B2F5EA !important;
  color: #22C55E !important;
  font-weight: 500;
}

.btn-correct:hover {
  background: #E0FFE8 !important;
  border-color: #6EE7B7 !important;
}

.btn-wrong {
  background: #FFF2F0 !important;
  border-color: #FFCCC7 !important;
  color: #F53F3F !important;
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
  min-width: 100px;
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

/* ===== Scrollbar ===== */
.student-panel__list::-webkit-scrollbar,
.ocr-editor__form::-webkit-scrollbar {
  width: 6px;
}

.student-panel__list::-webkit-scrollbar-track,
.ocr-editor__form::-webkit-scrollbar-track {
  background: transparent;
}

.student-panel__list::-webkit-scrollbar-thumb,
.ocr-editor__form::-webkit-scrollbar-thumb {
  background: #E5E6EB;
  border-radius: 3px;
}

.student-panel__list::-webkit-scrollbar-thumb:hover,
.ocr-editor__form::-webkit-scrollbar-thumb:hover {
  background: #C9CDD4;
}
</style>
