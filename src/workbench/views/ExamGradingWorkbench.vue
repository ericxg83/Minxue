<template>
  <div class="exam-grading-workbench">
    <!-- Loading State -->
    <div v-if="store.isLoading" class="grading-loading">
      <el-skeleton :rows="6" animated />
    </div>

    <!-- Error State -->
    <div v-else-if="store.error && !store.questions.length" class="grading-error">
      <el-result icon="error" title="加载失败" :sub-title="store.error">
        <template #extra>
          <el-button type="primary" @click="handleBack">返回</el-button>
        </template>
      </el-result>
    </div>

    <!-- Empty Questions State -->
    <div v-else-if="!store.isLoading && store.questions.length === 0 && !store.error" class="grading-empty">
      <el-result icon="warning" title="该试卷没有题目" sub-title="请检查试卷数据">
        <template #extra>
          <el-button type="primary" @click="handleBack">返回</el-button>
        </template>
      </el-result>
    </div>

    <!-- Main Grading UI -->
    <template v-else-if="store.currentQuestion">
      <!-- Header Bar -->
      <header class="grading-header">
        <div class="grading-header__left">
          <el-button text @click="handleBack" class="back-btn">
            <el-icon><ArrowLeft /></el-icon>
            <span>返回</span>
          </el-button>
          <span class="exam-title">{{ store.currentExam?.name || '组卷批改' }}</span>
          <span class="student-name" v-if="currentStudentName"> · {{ currentStudentName }}</span>
        </div>
        <div class="grading-header__right">
          <el-progress :percentage="store.progress" :stroke-width="14" :format="progressFormat" />
        </div>
      </header>

      <!-- Completion Dialog -->
      <el-dialog v-model="showCompletion" title="批改完成" width="500px" :close-on-click-modal="false" align-center>
        <div class="completion-content">
          <el-icon class="completion-icon" :size="56" color="#67C23A"><CircleCheckFilled /></el-icon>
          <div class="completion-stats">
            <div class="stat-row">
              <span class="stat-label">题目总数</span>
              <span class="stat-value">{{ store.totalQuestions }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">已掌握</span>
              <span class="stat-value stat-value--success">{{ statsSummary.mastered }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">升级(不懂→略懂)</span>
              <span class="stat-value stat-value--primary">{{ statsSummary.upgradedToReview1 }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">升级(略懂→完全懂)</span>
              <span class="stat-value stat-value--primary">{{ statsSummary.upgradedToMastered }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">未掌握(重置为不懂)</span>
              <span class="stat-value stat-value--danger">{{ statsSummary.reset }}</span>
            </div>
          </div>
        </div>
        <template #footer>
          <el-button type="primary" :loading="store.isSaving" @click="handleSave">
            {{ store.isSaving ? '保存中...' : '保存并返回' }}
          </el-button>
        </template>
      </el-dialog>

      <!-- Main Content Area -->
      <main class="grading-main">
        <div class="grading-content">
          <!-- Mastery Status Bar -->
          <div class="mastery-bar">
            <span class="mastery-label">掌握度</span>
            <div class="mastery-steps">
              <span class="mastery-step" :class="{ active: store.currentLifecycleLabel === '新错题' }">不懂</span>
              <span class="mastery-arrow"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              <span class="mastery-step" :class="{ active: store.currentLifecycleLabel === '第一次重练' }">略懂</span>
              <span class="mastery-arrow"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              <span class="mastery-step" :class="{ active: store.currentLifecycleLabel === '已掌握' }">完全懂</span>
            </div>
            <el-tag v-if="store.currentErrorCount > 0" type="danger" size="small" effect="plain" class="error-count-tag">
              错误 {{ store.currentErrorCount }} 次
            </el-tag>
          </div>

          <!-- Question Number Navigation -->
          <div class="question-nav">
            <span class="question-number">第 {{ store.currentQuestionIndex + 1 }} / {{ store.totalQuestions }} 题</span>
            <div class="question-dots">
              <span
                v-for="(q, idx) in store.questions"
                :key="q.id"
                class="dot"
                :class="{
                  'dot--active': idx === store.currentQuestionIndex,
                  'dot--correct': store.gradingResults[q.id]?.isCorrect === true,
                  'dot--wrong': store.gradingResults[q.id]?.isCorrect === false,
                  'dot--pending': !store.gradingResults[q.id]
                }"
                @click="store.currentQuestionIndex = idx"
              />
            </div>
          </div>

          <!-- Question Card -->
          <el-card class="question-card" :class="questionCardClass" shadow="never">
            <template #header>
              <div class="question-header">
                <span class="question-type-tag">{{ questionTypeLabel }}</span>
                <span class="question-subject" v-if="store.currentQuestion.subject">{{ store.currentQuestion.subject }}</span>
                <el-tag
                  v-if="store.gradingResults[store.currentQuestion.id]"
                  :type="isCurrentGradedCorrect ? 'success' : 'danger'"
                  size="small"
                  effect="dark"
                  class="grading-status-tag"
                >
                  {{ isCurrentGradedCorrect ? '已掌握' : '未掌握' }}
                </el-tag>
              </div>
            </template>
            <div class="question-content" v-html="store.currentQuestion.content || '（题目内容为空）'"></div>
            <div v-if="store.currentQuestion.image_url" class="question-image">
              <el-image :src="store.currentQuestion.image_url" fit="contain" :preview-src-list="[store.currentQuestion.image_url]" />
            </div>
            <div v-if="options.length > 0" class="question-options">
              <div v-for="(opt, oi) in options" :key="oi" class="option-item">
                <span class="option-label">{{ String.fromCharCode(65 + oi) }}.</span>
                <span class="option-text">{{ opt }}</span>
              </div>
            </div>
          </el-card>

          <!-- Answer & Analysis Card (always visible) -->
          <el-card class="answer-card" shadow="never" :body-style="{ padding: '14px 16px' }">
            <div class="answer-body">
              <!-- Side-by-side comparison: student vs standard -->
              <div class="ops-compare-bar">
                <div class="ops-compare-item">
                  <div class="ops-cmp-label">学生答案</div>
                  <div class="ops-cmp-value student-val">
                    {{ store.currentQuestion.student_answer || '（未作答）' }}
                  </div>
                </div>
                <div class="ops-cmp-divider"></div>
                <div class="ops-compare-item">
                  <div class="ops-cmp-label">标准答案</div>
                  <div class="ops-cmp-value correct-val">
                    {{ store.currentQuestion.answer || '无' }}
                  </div>
                </div>
              </div>
              <!-- Analysis -->
              <div v-if="store.currentQuestion.analysis" class="analysis-row">
                <span class="analysis-label">解析：</span>
                <span class="analysis-text">{{ store.currentQuestion.analysis }}</span>
              </div>
            </div>
          </el-card>
        </div>
      </main>

      <!-- Fixed Bottom Footer -->
      <footer class="grading-footer">
        <div class="footer-inner">
          <div class="grade-buttons">
            <el-button
              type="success"
              size="large"
              :icon="Check"
              :disabled="!!store.gradingResults[store.currentQuestion.id]"
              @click="handleMarkCorrect"
            >
              掌握
            </el-button>
            <el-button
              type="danger"
              size="large"
              :icon="Close"
              :disabled="!!store.gradingResults[store.currentQuestion.id]"
              @click="handleMarkWrong"
            >
              未掌握
            </el-button>
          </div>
          <div class="action-hints">
            <span>Enter 掌握 · Delete 未掌握 · ← → 切换</span>
          </div>
          <div class="nav-buttons">
            <el-button :disabled="store.currentQuestionIndex === 0" @click="store.goToPrev()">
              <el-icon><ArrowLeft /></el-icon> 上一题
            </el-button>
            <el-button :disabled="store.currentQuestionIndex >= store.questions.length - 1" @click="store.goToNext()">
              下一题 <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
          <div class="complete-area">
            <el-button v-if="store.isFullyGraded" type="primary" size="large" @click="showCompletion = true">
              完成批改
            </el-button>
          </div>
        </div>
      </footer>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, ArrowRight,
  Check, Close, CircleCheckFilled
} from '@element-plus/icons-vue'
import { useExamGradingStore } from '../stores/examGradingStore'
import { getStudents, getGeneratedExamById } from '../../services/apiService'

const route = useRoute()
const router = useRouter()
const store = useExamGradingStore()

const showCompletion = ref(false)
const currentStudentName = ref('')

const questionCardClass = computed(() => {
  const result = store.gradingResults[store.currentQuestion.id]
  if (!result) return {}
  return {
    'question-card--correct': result.isCorrect === true,
    'question-card--wrong': result.isCorrect === false
  }
})

// 当前题目是否已批改为掌握
const isCurrentGradedCorrect = computed(() => {
  return store.gradingResults[store.currentQuestion.id]?.isCorrect === true
})

// 监听完成弹窗关闭后自动回退
const handleBack = () => {
  store.reset()
  router.push('/exam-history')
}

// 进度条格式化
const progressFormat = (percentage) => `${store.gradedCount}/${store.totalQuestions}`

// 计算题目选项
const options = computed(() => {
  const q = store.currentQuestion
  if (!q) return []
  if (Array.isArray(q.options)) return q.options
  return []
})

// 题型标签
const questionTypeLabel = computed(() => {
  const map = {
    choice: '选择题',
    fill: '填空题',
    essay: '简答题',
    judge: '判断题',
    multiple_choice: '多选题',
    calculation: '计算题'
  }
  const q = store.currentQuestion
  return map[q?.question_type] || q?.question_type || '题目'
})

// 统计汇总
const statsSummary = computed(() => {
  const results = Object.values(store.gradingResults)
  let mastered = 0
  let upgradedToReview1 = 0
  let upgradedToMastered = 0
  let reset = 0

  for (const r of results) {
    if (r.newLifecycle === 'mastered' && r.previousLifecycle !== 'mastered') {
      mastered++
    }
    if (r.isCorrect && r.previousLifecycle === 'new' && r.newLifecycle === 'review_1') {
      upgradedToReview1++
    }
    if (r.isCorrect && r.previousLifecycle === 'review_1' && r.newLifecycle === 'review_2') {
      upgradedToMastered++
    }
    if (r.isCorrect && r.previousLifecycle === 'review_2' && r.newLifecycle === 'mastered') {
      upgradedToMastered++
    }
    if (!r.isCorrect) {
      reset++
    }
  }

  return { mastered, upgradedToReview1, upgradedToMastered, reset }
})

// 批改操作
const handleMarkCorrect = () => {
  store.markCurrent(true)
}

const handleMarkWrong = () => {
  store.markCurrent(false)
}

// 保存
const handleSave = async () => {
  try {
    const examId = route.query.examId
    const studentId = route.query.studentId
    await store.saveResults(studentId, examId)
    handleBack()
  } catch (e) {
    // 已在 store 中处理
  }
}

// 键盘快捷键
const handleKeydown = (e) => {
  if (showCompletion.value) return
  switch (e.key) {
    case 'Enter':
      e.preventDefault()
      handleMarkCorrect()
      break
    case 'Delete':
    case 'Backspace':
      e.preventDefault()
      handleMarkWrong()
      break
    case 'ArrowLeft':
      store.goToPrev()
      break
    case 'ArrowRight':
      store.goToNext()
      break
  }
}

onMounted(async () => {
  const examId = route.query.examId
  const studentId = route.query.studentId

  if (!examId || !studentId) {
    store.error = '缺少试卷信息'
    return
  }

  // 获取学生姓名
  try {
    const studentsResult = await getStudents(false)
    const student = (studentsResult?.students || []).find(s => s.id === studentId)
    currentStudentName.value = student?.name || ''
  } catch (e) {
    // 非关键信息，静默失败
  }

  // 加载试卷数据
  // 始终从服务端 GET /generated-exams/:id 拉取最新 question_ids，
  // 避免 localStorage 缓存或列表快照中的过期数据 BUG
  try {
    const freshExam = await getGeneratedExamById(examId)
    if (freshExam) {
      store.loadExam(freshExam)
    } else {
      store.error = '试卷不存在'
      return
    }
  } catch (e) {
    console.error('加载试卷信息失败:', e)
    store.error = '加载试卷信息失败'
    return
  }

  await store.loadQuestions(studentId)
})

onUnmounted(() => {
  // 只在非保存成功的情况下重置（保存成功后由 handleBack 重置）
  // 不需要清理，router 离开时 store 保留
  document.removeEventListener('keydown', handleKeydown)
})

// 注册键盘事件
onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.exam-grading-workbench {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

/* Loading / Error / Empty */
.grading-loading,
.grading-error,
.grading-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 80px;
}

/* ── Header ── */
.grading-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  background: linear-gradient(135deg, #1677FF, #4096FF);
  box-shadow: 0 2px 12px rgba(22, 119, 255, 0.3);
  flex-shrink: 0;
  z-index: 10;
}

.grading-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.back-btn {
  font-size: 13px;
  color: rgba(255,255,255,0.9) !important;
  padding: 4px 10px !important;
  border-radius: 8px !important;
  background: rgba(255,255,255,0.15) !important;
  transition: all 0.2s;
}
.back-btn:hover {
  background: rgba(255,255,255,0.25) !important;
}
.back-btn .el-icon {
  color: rgba(255,255,255,0.9) !important;
}

.exam-title {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.student-name {
  font-size: 13px;
  color: rgba(255,255,255,0.75);
}

.grading-header__right {
  width: 220px;
}
.grading-header__right :deep(.el-progress-bar__outer) {
  background: rgba(255,255,255,0.25) !important;
}
.grading-header__right :deep(.el-progress-bar__inner) {
  background: #fff !important;
}
.grading-header__right :deep(.el-progress__text) {
  color: #fff !important;
  font-size: 13px !important;
  font-weight: 500;
}

/* ── Main Content ── */
.grading-main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}
.grading-main::-webkit-scrollbar { width: 6px; }
.grading-main::-webkit-scrollbar-track { background: transparent; }
.grading-main::-webkit-scrollbar-thumb { background: #E5E6EB; border-radius: 3px; }
.grading-main::-webkit-scrollbar-thumb:hover { background: #C9CDD4; }

.grading-content {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Mastery Bar ── */
.mastery-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}

.mastery-label {
  font-size: 12px;
  font-weight: 600;
  color: #909399;
  letter-spacing: 0.5px;
  white-space: nowrap;
  padding: 2px 10px;
  border-radius: 6px;
  background: #f5f7fa;
}

.mastery-steps {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mastery-step {
  font-size: 12px;
  font-weight: 500;
  color: #c0c4cc;
  padding: 3px 10px;
  border-radius: 6px;
  background: #f5f7fa;
  transition: all 0.3s ease;
}

.mastery-step.active {
  color: #1677FF;
  background: #E8F3FF;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(22,119,255,0.15);
}

.mastery-arrow {
  color: #dcdfe6;
  display: flex;
  align-items: center;
}

.error-count-tag {
  margin-left: auto;
}

/* ── Question Navigation ── */
.question-nav {
  display: flex;
  align-items: center;
  gap: 14px;
}

.question-number {
  font-size: 12px;
  font-weight: 600;
  color: #86909C;
  white-space: nowrap;
  background: #fff;
  padding: 6px 14px;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.question-dots {
  display: flex;
  gap: 6px;
  align-items: center;
  overflow-x: auto;
  flex: 1;
  padding: 4px 0;
}

.question-dots::-webkit-scrollbar {
  height: 0;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.25s ease;
  border: 2px solid transparent;
  flex-shrink: 0;
}

.dot--pending {
  background: #e4e7ed;
}

.dot--correct {
  background: #67C23A;
  box-shadow: 0 1px 4px rgba(103, 194, 58, 0.3);
}

.dot--wrong {
  background: #F56C6C;
  box-shadow: 0 1px 4px rgba(245, 108, 108, 0.3);
}

.dot--active {
  border-color: #1677FF;
  transform: scale(1.3);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.15);
}

/* ── Question Card ── */
.question-card {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  border: 1px solid #e4e7ed;
  transition: all 0.3s ease;
}

.question-card--correct {
  border-color: #67C23A;
  box-shadow: 0 2px 12px rgba(103, 194, 58, 0.12);
}

.question-card--wrong {
  border-color: #F56C6C;
  box-shadow: 0 2px 12px rgba(245, 108, 108, 0.12);
}

.question-card :deep(.el-card__header) {
  padding: 12px 18px;
  border-bottom: 1px solid #f2f3f5;
}

.question-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.question-type-tag {
  display: inline-block;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  background: linear-gradient(135deg, #E8F3FF, #F0F5FF);
  color: #1677FF;
  letter-spacing: 0.3px;
}

.question-subject {
  font-size: 12px;
  color: #86909C;
}

.grading-status-tag {
  margin-left: auto;
}

.question-content {
  font-size: 15px;
  line-height: 1.8;
  color: #1D2129;
  white-space: pre-wrap;
  padding: 4px 0;
}

.question-image {
  margin-top: 12px;
  max-width: 100%;
}

.question-image .el-image {
  max-height: 300px;
  border-radius: 8px;
}

.question-options {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 8px;
}

.option-item {
  display: flex;
  gap: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: #4E5969;
}

.option-label {
  font-weight: 600;
  color: #1D2129;
  min-width: 20px;
}

/* ── Answer Card ── */
.answer-card {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  overflow: hidden;
}

.answer-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Answer comparison bar */
.ops-compare-bar {
  display: flex;
  align-items: stretch;
  gap: 0;
  background: #fff;
  padding: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #f0f0f0;
}

.ops-compare-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  min-width: 0;
}

.ops-compare-item:first-child {
  background: #fafafa;
}

.ops-cmp-label {
  font-size: 11px;
  font-weight: 600;
  color: #909399;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.ops-cmp-value {
  font-size: 15px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 6px;
  line-height: 1.5;
  word-break: break-all;
}

.student-val {
  background: #fff;
  color: #303133;
  border: 1px solid #e8e8e8;
}

.correct-val {
  color: #52C41A;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
}

.ops-cmp-divider {
  width: 1px;
  background: #e4e7ed;
  flex-shrink: 0;
}

/* Analysis */
.analysis-row {
  display: flex;
  gap: 8px;
  font-size: 14px;
  line-height: 1.7;
  padding: 0 14px 2px;
}

.analysis-label {
  color: #909399;
  font-weight: 600;
  white-space: nowrap;
}

.analysis-text {
  color: #4E5969;
  white-space: pre-wrap;
  flex: 1;
  line-height: 1.7;
}

/* ── Footer ── */
.grading-footer {
  flex-shrink: 0;
  background: #fff;
  border-top: none;
  box-shadow: 0 -2px 12px rgba(0,0,0,0.06);
  padding: 14px 24px;
  z-index: 10;
}

.footer-inner {
  max-width: 820px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.grade-buttons {
  display: flex;
  gap: 10px;
}

.grade-buttons .el-button.el-button--success {
  background: linear-gradient(135deg, #52C41A, #73D13D);
  border: none;
  min-width: 110px;
  font-weight: 600;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(82, 196, 26, 0.3);
  transition: all 0.25s;
}
.grade-buttons .el-button.el-button--success:hover {
  box-shadow: 0 4px 14px rgba(82, 196, 26, 0.4);
  transform: translateY(-1px);
}
.grade-buttons .el-button.el-button--success:active {
  transform: translateY(0);
}
.grade-buttons .el-button.el-button--success.is-disabled {
  background: #e8e8e8 !important;
  box-shadow: none !important;
}

.grade-buttons .el-button.el-button--danger {
  background: linear-gradient(135deg, #F56C6C, #FF7875);
  border: none;
  min-width: 110px;
  font-weight: 600;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(245, 108, 108, 0.3);
  transition: all 0.25s;
}
.grade-buttons .el-button.el-button--danger:hover {
  box-shadow: 0 4px 14px rgba(245, 108, 108, 0.4);
  transform: translateY(-1px);
}
.grade-buttons .el-button.el-button--danger:active {
  transform: translateY(0);
}
.grade-buttons .el-button.el-button--danger.is-disabled {
  background: #e8e8e8 !important;
  box-shadow: none !important;
}

.action-hints {
  text-align: center;
  color: #bfc4cc;
  font-size: 12px;
  white-space: nowrap;
  letter-spacing: 0.3px;
}

.nav-buttons {
  display: flex;
  gap: 8px;
}

.nav-buttons .el-button {
  border-radius: 8px;
  font-weight: 500;
}

.complete-area {
  min-width: 120px;
  text-align: right;
}

.complete-area .el-button.el-button--primary {
  border-radius: 10px;
  font-weight: 600;
  background: linear-gradient(135deg, #1677FF, #4096FF);
  border: none;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.3);
}

/* ── Completion Dialog ── */
.completion-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 24px 0 8px;
}

.completion-icon {
  animation: scaleIn 0.3s ease;
}

@keyframes scaleIn {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.completion-stats {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  border-radius: 8px;
  background: #f5f7fa;
}

.stat-label {
  font-size: 14px;
  color: #86909C;
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: #1D2129;
}

.stat-value--success { color: #67C23A; }
.stat-value--primary { color: #1677FF; }
.stat-value--danger { color: #F56C6C; }
</style>
