<template>
  <div class="dashboard-workbench">
    <!-- 顶部工具栏 -->
    <header class="top-bar">
      <div class="top-bar-left">
        <h1 class="workbench-title">错题审核工作台</h1>
        <span class="workbench-subtitle">核心业务 · 学生错题管理</span>
      </div>
      <div class="top-bar-right">
        <el-button type="primary" text @click="handleGoToWrongBook">
          <el-icon><EditPen /></el-icon>
          错题本编辑
        </el-button>
        <el-button type="info" text @click="handleGoToPaperImport">
          <el-icon><Upload /></el-icon>
          试卷入库
        </el-button>
        <el-divider direction="vertical" />
        <div class="user-info">
          <el-avatar :size="32" src="https://api.dicebear.com/7.x/avataaars/svg?seed=teacher" />
          <span class="user-name">教师</span>
        </div>
      </div>
    </header>

    <!-- 统计卡片区域 -->
    <div class="stats-section">
      <div class="stats-grid">
        <div class="stat-card stat-card--pending">
          <div class="stat-card__icon">
            <el-icon><Document /></el-icon>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__value">{{ reviewStore.todayStats.pendingReview }}</div>
            <div class="stat-card__label">今日待审核错题</div>
          </div>
        </div>
        
        <div class="stat-card stat-card--students">
          <div class="stat-card__icon">
            <el-icon><User /></el-icon>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__value">{{ reviewStore.todayStats.pendingStudents }}</div>
            <div class="stat-card__label">今日待处理学生</div>
          </div>
        </div>
        
        <div class="stat-card stat-card--new">
          <div class="stat-card__icon">
            <el-icon><Plus /></el-icon>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__value">{{ reviewStore.todayStats.newWrongQuestions }}</div>
            <div class="stat-card__label">今日新增错题</div>
          </div>
        </div>
        
        <div class="stat-card stat-card--print">
          <div class="stat-card__icon">
            <el-icon><Printer /></el-icon>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__value">{{ reviewStore.todayStats.pendingPrintExams }}</div>
            <div class="stat-card__label">待打印重练卷</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 主内容区 -->
    <main class="main-content">
      <!-- 左侧：学生列表 -->
      <aside class="left-panel">
        <div class="panel-header">
          <span class="panel-title">学生列表</span>
          <span class="panel-count">{{ reviewStore.students.length }} 人</span>
        </div>
        
        <div class="student-list">
          <div
            v-for="student in reviewStore.students"
            :key="student.id"
            class="student-item"
            :class="{ 'student-item--active': reviewStore.currentStudent?.id === student.id }"
            @click="handleSelectStudent(student)"
          >
            <div class="student-item__avatar">
              <el-avatar :size="40" :src="student.avatar">
                {{ student.name.charAt(0) }}
              </el-avatar>
            </div>
            <div class="student-item__info">
              <div class="student-item__name">{{ student.name }}</div>
              <div class="student-item__class">{{ student.class }}</div>
            </div>
            <div class="student-item__stats">
              <div class="student-item__pending">
                <el-badge 
                  :value="reviewStore.getStudentPendingCount(student.id)" 
                  :max="99"
                  :hidden="reviewStore.getStudentPendingCount(student.id) === 0"
                >
                  <el-icon><Document /></el-icon>
                </el-badge>
                <span class="student-item__pending-text">待审</span>
              </div>
              <div class="student-item__today">
                <span class="student-item__today-count">{{ reviewStore.getStudentTodayNewCount(student.id) }}</span>
                <span class="student-item__today-text">今日</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧：错题审核区域 -->
      <section class="right-panel">
        <template v-if="reviewStore.currentStudent">
          <!-- 审核头部 -->
          <div class="review-header">
            <div class="review-header__info">
              <el-avatar :size="36" :src="reviewStore.currentStudent.avatar">
                {{ reviewStore.currentStudent.name.charAt(0) }}
              </el-avatar>
              <div class="review-header__text">
                <div class="review-header__name">{{ reviewStore.currentStudent.name }} 的错题</div>
                <div class="review-header__count">
                  第 {{ reviewStore.currentReviewIndex + 1 }} / {{ reviewStore.studentWrongQuestions.length }} 题
                </div>
              </div>
            </div>
            <div class="review-header__progress">
              <el-progress 
                :percentage="reviewProgress" 
                :stroke-width="6"
                :show-text="false"
              />
            </div>
          </div>

          <!-- 审核内容区 -->
          <div v-if="currentQuestion" class="review-content">
            <!-- 左侧：原始试卷图片 -->
            <div class="review-image">
              <div class="review-image__header">
                <el-icon><Picture /></el-icon>
                <span>原始试卷</span>
              </div>
              <div class="review-image__container">
                <img 
                  v-if="currentQuestion.originalImage" 
                  :src="currentQuestion.originalImage" 
                  alt="原始试卷"
                  class="review-image__img"
                />
                <div v-else class="review-image__placeholder">
                  <el-icon :size="48"><PictureFilled /></el-icon>
                  <span>暂无原始图片</span>
                </div>
              </div>
            </div>

            <!-- 右侧：AI识别结果 -->
            <div class="review-result">
              <div class="review-result__header">
                <el-icon><EditPen /></el-icon>
                <span>AI识别结果</span>
                <el-tag v-if="currentQuestion.question?.subject" size="small" type="info">
                  {{ currentQuestion.question.subject }}
                </el-tag>
                <el-tag v-if="currentQuestion.question?.category" size="small">
                  {{ currentQuestion.question.category }}
                </el-tag>
              </div>
              
              <div class="review-result__content">
                <!-- 题目内容 -->
                <div class="review-question">
                  <div class="review-question__label">题目</div>
                  <div class="review-question__text">
                    {{ currentQuestion.question?.content || '暂无内容' }}
                  </div>
                </div>

                <!-- 选项 -->
                <div v-if="currentQuestion.question?.options?.length > 0" class="review-options">
                  <div class="review-options__label">选项</div>
                  <div class="review-options__list">
                    <div 
                      v-for="(opt, idx) in currentQuestion.question.options" 
                      :key="idx"
                      class="review-option"
                      :class="{ 
                        'review-option--correct': currentQuestion.question?.answer === String.fromCharCode(65 + idx),
                        'review-option--student': currentQuestion.question?.student_answer === String.fromCharCode(65 + idx)
                      }"
                    >
                      <span class="review-option__letter">{{ String.fromCharCode(65 + idx) }}</span>
                      <span class="review-option__text">{{ opt }}</span>
                      <el-tag v-if="currentQuestion.question?.answer === String.fromCharCode(65 + idx)" size="small" type="success">正确答案</el-tag>
                      <el-tag v-if="currentQuestion.question?.student_answer === String.fromCharCode(65 + idx)" size="small" type="danger">学生选择</el-tag>
                    </div>
                  </div>
                </div>

                <!-- 解析 -->
                <div v-if="currentQuestion.question?.analysis" class="review-analysis">
                  <div class="review-analysis__label">解析</div>
                  <div class="review-analysis__text">{{ currentQuestion.question.analysis }}</div>
                </div>

                <!-- 错误信息 -->
                <div class="review-meta">
                  <el-tag type="warning" size="small">
                    错误次数：{{ currentQuestion.error_count || 1 }}
                  </el-tag>
                  <el-tag type="info" size="small">
                    练习次数：{{ currentQuestion.practice_count || 0 }}
                  </el-tag>
                  <el-tag size="small">
                    加入时间：{{ dayjs(currentQuestion.added_at).format('YYYY-MM-DD') }}
                  </el-tag>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部审核按钮 -->
          <div class="review-actions">
            <div class="review-actions__shortcuts">
              <span class="shortcut-hint">快捷键：<kbd>Enter</kbd> 确认 <kbd>←</kbd><kbd>→</kbd> 切换题目</span>
            </div>
            <div class="review-actions__buttons">
              <el-button 
                size="large" 
                @click="handlePrevQuestion"
                :disabled="reviewStore.currentReviewIndex === 0"
              >
                <el-icon><ArrowLeft /></el-icon>
                上一题
              </el-button>
              
              <el-button 
                type="success" 
                size="large" 
                @click="handleReview('correct')"
              >
                <el-icon><CircleCheckFilled /></el-icon>
                正确
              </el-button>
              
              <el-button 
                type="danger" 
                size="large" 
                @click="handleReview('wrong')"
              >
                <el-icon><CircleCloseFilled /></el-icon>
                错误
              </el-button>
              
              <el-button 
                type="warning" 
                size="large" 
                @click="handleReview('unanswered')"
              >
                <el-icon><WarningFilled /></el-icon>
                未作答
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
          </div>
        </template>

        <template v-else>
          <el-empty description="请选择学生开始审核" />
        </template>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useReviewStore } from '../stores/reviewStore'
import { ElMessage } from 'element-plus'
import {
  Document, User, Plus, Printer, Picture, PictureFilled,
  EditPen, CircleCheckFilled, CircleCloseFilled, WarningFilled,
  ArrowLeft, ArrowRight, Upload
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const router = useRouter()
const reviewStore = useReviewStore()

// 当前审核的错题
const currentQuestion = computed(() => reviewStore.currentReviewQuestion)

// 审核进度
const reviewProgress = computed(() => {
  const total = reviewStore.studentWrongQuestions.length
  if (total === 0) return 0
  return Math.round(((reviewStore.currentReviewIndex + 1) / total) * 100)
})

// 选择学生
const handleSelectStudent = (student) => {
  reviewStore.setCurrentStudent(student)
}

// 审核错题
const handleReview = (result) => {
  if (!currentQuestion.value) return
  
  const resultText = {
    correct: '已标记为正确',
    wrong: '已标记为错误',
    unanswered: '已标记为未作答'
  }
  
  reviewStore.reviewQuestion(currentQuestion.value.id, result)
  ElMessage.success(resultText[result])
}

// 上一题
const handlePrevQuestion = () => {
  reviewStore.prevQuestion()
}

// 下一题
const handleNextQuestion = () => {
  reviewStore.nextQuestion()
}

// 跳转到错题本编辑
const handleGoToWrongBook = () => {
  router.push('/wrongbook')
}

// 跳转到试卷入库
const handleGoToPaperImport = () => {
  router.push('/paper')
}

// 键盘快捷键处理
const handleKeyboard = (e) => {
  // 如果正在输入框中，不处理快捷键
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  
  switch (e.key) {
    case 'Enter':
      // Enter 确认（默认标记为正确）
      e.preventDefault()
      handleReview('correct')
      break
    case 'ArrowLeft':
      // 左箭头 上一题
      e.preventDefault()
      handlePrevQuestion()
      break
    case 'ArrowRight':
      // 右箭头 下一题
      e.preventDefault()
      handleNextQuestion()
      break
    case '1':
      // 数字1 正确
      e.preventDefault()
      handleReview('correct')
      break
    case '2':
      // 数字2 错误
      e.preventDefault()
      handleReview('wrong')
      break
    case '3':
      // 数字3 未作答
      e.preventDefault()
      handleReview('unanswered')
      break
  }
}

// 初始化
onMounted(() => {
  reviewStore.initData()
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
  background: #f5f7fa;
}

/* 顶部工具栏 */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workbench-title {
  font-size: 20px;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

.workbench-subtitle {
  font-size: 12px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 4px 8px;
  border-radius: 4px;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
}

.user-name {
  font-size: 14px;
  color: #374151;
}

/* 统计卡片区域 */
.stats-section {
  padding: 16px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f9fafb;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.stat-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.stat-card--pending .stat-card__icon {
  background: #fef3c7;
  color: #d97706;
}

.stat-card--students .stat-card__icon {
  background: #dbeafe;
  color: #2563eb;
}

.stat-card--new .stat-card__icon {
  background: #dcfce7;
  color: #16a34a;
}

.stat-card--print .stat-card__icon {
  background: #f3e8ff;
  color: #9333ea;
}

.stat-card__value {
  font-size: 28px;
  font-weight: 700;
  color: #111827;
  line-height: 1;
}

.stat-card__label {
  font-size: 13px;
  color: #6b7280;
  margin-top: 4px;
}

/* 主内容区 */
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧面板 */
.left-panel {
  width: 280px;
  background: #fff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.panel-title {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.panel-count {
  font-size: 12px;
  color: #9ca3af;
}

.student-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.student-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.student-item:hover {
  background: #f9fafb;
}

.student-item--active {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}

.student-item__avatar {
  flex-shrink: 0;
}

.student-item__info {
  flex: 1;
  min-width: 0;
}

.student-item__name {
  font-size: 14px;
  font-weight: 500;
  color: #111827;
}

.student-item__class {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
}

.student-item__stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.student-item__pending {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #d97706;
  font-size: 12px;
}

.student-item__pending-text {
  font-size: 10px;
}

.student-item__today {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.student-item__today-count {
  font-size: 14px;
  font-weight: 600;
  color: #16a34a;
}

.student-item__today-text {
  font-size: 10px;
  color: #6b7280;
}

/* 右侧审核区域 */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.review-header__info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-header__text {
  display: flex;
  flex-direction: column;
}

.review-header__name {
  font-size: 14px;
  font-weight: 500;
  color: #111827;
}

.review-header__count {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
}

.review-header__progress {
  width: 200px;
}

/* 审核内容区 */
.review-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.review-image {
  width: 50%;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.review-image__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.review-image__container {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: #f5f7fa;
}

.review-image__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.review-image__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #9ca3af;
}

.review-result {
  width: 50%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.review-result__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.review-result__content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.review-question {
  margin-bottom: 16px;
}

.review-question__label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
  font-weight: 500;
}

.review-question__text {
  font-size: 15px;
  color: #111827;
  line-height: 1.6;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
}

.review-options {
  margin-bottom: 16px;
}

.review-options__label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
  font-weight: 500;
}

.review-options__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.review-option--correct {
  background: #f0fdf4;
  border-color: #86efac;
}

.review-option--student {
  background: #fef2f2;
  border-color: #fca5a5;
}

.review-option__letter {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.review-option__text {
  flex: 1;
  font-size: 14px;
  color: #111827;
}

.review-analysis {
  margin-bottom: 16px;
  padding: 12px;
  background: #eff6ff;
  border-radius: 8px;
  border-left: 4px solid #3b82f6;
}

.review-analysis__label {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
  font-weight: 500;
}

.review-analysis__text {
  font-size: 14px;
  color: #1e40af;
  line-height: 1.6;
}

.review-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* 底部审核按钮 */
.review-actions {
  padding: 12px 20px;
  background: #fff;
  border-top: 1px solid #e5e7eb;
}

.review-actions__shortcuts {
  text-align: center;
  margin-bottom: 8px;
}

.shortcut-hint {
  font-size: 12px;
  color: #9ca3af;
}

.shortcut-hint kbd {
  display: inline-block;
  padding: 2px 6px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  margin: 0 2px;
}

.review-actions__buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.review-actions__buttons .el-button {
  min-width: 100px;
}
</style>
