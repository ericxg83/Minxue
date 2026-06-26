<template>
  <div class="ai-review-container">
    <!-- 顶部导航 -->
    <div class="header">
      <div class="header-left">
        <el-button @click="$router.push('/')" :icon="ArrowLeft">返回</el-button>
        <h2>AI批改复审中心</h2>
      </div>
      <div class="header-right" v-if="aiReviewStore.currentStudent">
        <span class="student-name">{{ aiReviewStore.currentStudent.name }}</span>
        <el-tag v-if="aiReviewStore.reviewStatus === 'reviewing'" type="warning">复审中</el-tag>
        <el-tag v-if="aiReviewStore.reviewStatus === 'completed'" type="success">已完成</el-tag>
      </div>
    </div>

    <!-- 任务列表视图 -->
    <div v-if="aiReviewStore.reviewStatus === 'idle' || aiReviewStore.reviewStatus === 'loading'" class="task-list-view">
      <div class="student-selector">
        <el-select 
          v-model="selectedStudentId" 
          placeholder="选择学生" 
          @change="handleStudentChange"
          style="width: 200px"
        >
          <el-option 
            v-for="student in aiReviewStore.students" 
            :key="student.id" 
            :label="student.name" 
            :value="student.id" 
          />
        </el-select>
      </div>

      <div class="task-grid">
        <div 
          v-for="task in aiReviewStore.pendingTasks" 
          :key="task.id"
          class="task-card"
          @click="aiReviewStore.selectTask(task)"
        >
          <div class="task-header">
            <h3>{{ task.original_name || '未命名试卷' }}</h3>
            <el-tag size="small">{{ task.result?.questionCount || 0 }}题</el-tag>
          </div>
          <div class="task-info">
            <span>创建时间: {{ formatDate(task.created_at) }}</span>
          </div>
          <div class="task-status">
            <el-tag type="warning" size="small">待复审</el-tag>
          </div>
        </div>

        <el-empty v-if="aiReviewStore.pendingTasks.length === 0" description="暂无待复审试卷" />
      </div>
    </div>

    <!-- 复审视图 -->
    <div v-if="aiReviewStore.reviewStatus === 'reviewing'" class="review-view">
      <!-- 进度条 -->
      <div class="progress-bar">
        <div class="progress-info">
          <span>进度: {{ aiReviewStore.progress }}%</span>
          <span>{{ aiReviewStore.stats.confirmed + aiReviewStore.stats.corrected }} / {{ aiReviewStore.stats.total }}</span>
        </div>
        <el-progress :percentage="aiReviewStore.progress" :stroke-width="8" />
        <div class="progress-stats">
          <el-tag size="small" type="success">已确认 {{ aiReviewStore.stats.confirmed }}</el-tag>
          <el-tag size="small" type="danger">已修正 {{ aiReviewStore.stats.corrected }}</el-tag>
          <el-tag size="small" type="warning">待处理 {{ aiReviewStore.stats.pending }}</el-tag>
        </div>
      </div>

      <!-- 题目导航 -->
      <div class="question-nav">
        <el-button @click="aiReviewStore.prevQuestion" :disabled="aiReviewStore.currentQuestionIndex === 0">
          ← 上一题
        </el-button>
        <span class="question-index">
          第 {{ aiReviewStore.currentQuestionIndex + 1 }} / {{ aiReviewStore.taskQuestions.length }} 题
        </span>
        <el-button 
          @click="aiReviewStore.nextQuestion" 
          :disabled="aiReviewStore.currentQuestionIndex === aiReviewStore.taskQuestions.length - 1"
        >
          下一题 →
        </el-button>
        <el-button @click="aiReviewStore.backToTaskList" type="info">返回列表</el-button>
      </div>

      <!-- 主内容区 -->
      <div class="main-content">
        <!-- 左侧：原始试卷图片 -->
        <div class="left-panel">
          <div class="panel-header">
            <h3>原始试卷</h3>
            <div class="image-controls">
              <el-button-group>
                <el-button @click="aiReviewStore.zoomImage(-0.2)" size="small">-</el-button>
                <el-button size="small">{{ Math.round(aiReviewStore.imageScale * 100) }}%</el-button>
                <el-button @click="aiReviewStore.zoomImage(0.2)" size="small">+</el-button>
                <el-button @click="aiReviewStore.resetImageViewer" size="small">重置</el-button>
              </el-button-group>
            </div>
          </div>
          <div
            class="image-viewer"
            @mousedown="aiReviewStore.startDrag"
            @mousemove="aiReviewStore.onDrag"
            @mouseup="aiReviewStore.endDrag"
            @mouseleave="aiReviewStore.endDrag"
          >
            <LazyImage
              v-if="aiReviewStore.currentTask?.image_url"
              :src="aiReviewStore.currentTask.image_url"
              alt="试卷图片"
              width="100%"
              height="100%"
              :style="{
                transform: `scale(${aiReviewStore.imageScale}) translate(${aiReviewStore.imagePosition.x}px, ${aiReviewStore.imagePosition.y}px)`,
                cursor: aiReviewStore.isDragging ? 'grabbing' : 'grab'
              }"
            />
            <el-empty v-else description="暂无试卷图片" />
          </div>
        </div>

        <!-- 右侧：AI识别结果 -->
        <div class="right-panel">
          <div class="panel-header">
            <h3>AI识别结果</h3>
            <el-tag 
              :type="currentQuestionStatusType" 
              size="small"
            >
              {{ currentQuestionStatus }}
            </el-tag>
          </div>

          <div class="question-content" v-if="aiReviewStore.currentQuestion">
            <!-- 题干 -->
            <div class="field-section">
              <label>题干</label>
              <el-input
                v-model="editableQuestion.content"
                type="textarea"
                :rows="4"
                placeholder="题干内容"
                @change="markAsEdited"
              />
            </div>

            <!-- 选项（如果有） -->
            <div class="field-section" v-if="editableQuestion.options?.length">
              <label>选项</label>
              <div v-for="(opt, idx) in editableQuestion.options" :key="idx" class="option-item">
                <span class="option-label">{{ String.fromCharCode(65 + idx) }}.</span>
                <el-input v-model="editableQuestion.options[idx]" @change="markAsEdited" />
              </div>
            </div>

            <!-- 学生答案 -->
            <div class="field-section">
              <label>学生答案</label>
              <div class="answer-display">{{ aiReviewStore.currentQuestion.student_answer || '未作答' }}</div>
            </div>

            <!-- 标准答案 -->
            <div class="field-section">
              <label>标准答案</label>
              <el-input
                v-model="editableQuestion.answer"
                placeholder="标准答案"
                @change="markAsEdited"
              />
            </div>

            <!-- AI判定 -->
            <div class="field-section">
              <label>AI判定</label>
              <div class="ai-result">
                <el-tag 
                  :type="aiResultType" 
                  size="large"
                >
                  {{ aiResultText }}
                </el-tag>
              </div>
            </div>

            <!-- 解析 -->
            <div class="field-section">
              <label>解析</label>
              <el-input
                v-model="editableQuestion.analysis"
                type="textarea"
                :rows="3"
                placeholder="解析内容"
                @change="markAsEdited"
              />
            </div>
          </div>

          <el-empty v-else description="暂无题目数据" />
        </div>
      </div>

      <!-- 底部操作区 -->
      <div class="bottom-actions">
        <div class="action-buttons">
          <el-button type="success" size="large" @click="handleResult('correct')">
            ✓ 正确 (Enter)
          </el-button>
          <el-button type="danger" size="large" @click="handleResult('wrong')">
            ✗ 错误
          </el-button>
          <el-button type="info" size="large" @click="handleResult('unanswered')">
            ○ 未作答
          </el-button>
        </div>
        <div class="action-hints">
          <span>快捷键: Enter确认并下一题 | ← → 切换题目</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAIReviewStore, AI_REVIEW_STATUS } from '../stores/aiReviewStore'
import { ArrowLeft } from '@element-plus/icons-vue'
import LazyImage from '../components/shared/LazyImage.vue'

const router = useRouter()
const aiReviewStore = useAIReviewStore()

const selectedStudentId = ref('')

// 可编辑的题目数据
const editableQuestion = ref({
  content: '',
  options: [],
  answer: '',
  analysis: ''
})

// 标记是否已编辑
const hasEdited = ref(false)

// 当前题目状态
const currentQuestionStatus = computed(() => {
  if (!aiReviewStore.currentQuestion) return ''
  const status = aiReviewStore.currentQuestion._reviewStatus
  switch (status) {
    case AI_REVIEW_STATUS.PENDING: return '待复审'
    case AI_REVIEW_STATUS.CONFIRMED: return '已确认'
    case AI_REVIEW_STATUS.CORRECTED: return '已修正'
    default: return ''
  }
})

const currentQuestionStatusType = computed(() => {
  if (!aiReviewStore.currentQuestion) return ''
  const status = aiReviewStore.currentQuestion._reviewStatus
  switch (status) {
    case AI_REVIEW_STATUS.PENDING: return 'warning'
    case AI_REVIEW_STATUS.CONFIRMED: return 'success'
    case AI_REVIEW_STATUS.CORRECTED: return 'danger'
    default: return 'info'
  }
})

// AI判定结果
const aiResultText = computed(() => {
  if (!aiReviewStore.currentQuestion) return ''
  const result = aiReviewStore.currentQuestion._reviewResult
  if (result === 'correct') return '正确'
  if (result === 'wrong') return '错误'
  return '未作答'
})

const aiResultType = computed(() => {
  if (!aiReviewStore.currentQuestion) return 'info'
  const result = aiReviewStore.currentQuestion._reviewResult
  if (result === 'correct') return 'success'
  if (result === 'wrong') return 'danger'
  return 'info'
})

// 处理学生切换
const handleStudentChange = (studentId) => {
  const student = aiReviewStore.students.find(s => s.id === studentId)
  if (student) {
    aiReviewStore.setCurrentStudent(student)
  }
}

// 标记为已编辑
const markAsEdited = () => {
  hasEdited.value = true
}

// 处理结果
const handleResult = (result) => {
  const question = aiReviewStore.currentQuestion
  if (!question) return

  // 如果有编辑，保存修改
  if (hasEdited.value) {
    aiReviewStore.updateQuestionContent(question.id, {
      content: editableQuestion.value.content,
      options: editableQuestion.value.options,
      answer: editableQuestion.value.answer,
      analysis: editableQuestion.value.analysis
    })
    hasEdited.value = false
  }

  // 确认复审结果
  aiReviewStore.confirmReview(question.id, result)

  // 自动下一题
  aiReviewStore.nextQuestion()
}

// 键盘快捷键
const handleKeyboard = (e) => {
  if (aiReviewStore.reviewStatus !== 'reviewing') return

  switch (e.key) {
    case 'Enter':
      e.preventDefault()
      handleResult('correct')
      break
    case 'ArrowLeft':
      e.preventDefault()
      aiReviewStore.prevQuestion()
      break
    case 'ArrowRight':
      e.preventDefault()
      aiReviewStore.nextQuestion()
      break
  }
}

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN')
}

// 生命周期
onMounted(async () => {
  await aiReviewStore.loadStudents()
  if (aiReviewStore.students.length > 0) {
    selectedStudentId.value = aiReviewStore.students[0].id
    handleStudentChange(selectedStudentId.value)
  }
  window.addEventListener('keydown', handleKeyboard)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboard)
})
</script>

<style scoped>
.ai-review-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.header {
  background: #fff;
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-left h2 {
  margin: 0;
  font-size: 20px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.student-name {
  font-weight: bold;
}

/* 任务列表视图 */
.task-list-view {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.student-selector {
  margin-bottom: 24px;
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.task-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.task-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.task-header h3 {
  margin: 0;
  font-size: 16px;
}

.task-info {
  color: #666;
  font-size: 14px;
  margin-bottom: 12px;
}

.task-status {
  display: flex;
  justify-content: flex-end;
}

/* 复审视图 */
.review-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.progress-bar {
  background: #fff;
  padding: 12px 24px;
  border-bottom: 1px solid #eee;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
}

.progress-stats {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.question-nav {
  background: #fff;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #eee;
}

.question-index {
  font-weight: bold;
}

.main-content {
  flex: 1;
  display: flex;
  gap: 0;
  overflow: hidden;
}

.left-panel, .right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.left-panel {
  border-right: 1px solid #eee;
}

.panel-header {
  background: #fff;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
}

.image-viewer {
  flex: 1;
  overflow: hidden;
  background: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-viewer img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transition: transform 0.1s;
}

.question-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.field-section {
  margin-bottom: 16px;
}

.field-section label {
  display: block;
  font-weight: bold;
  margin-bottom: 8px;
  color: #333;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.option-label {
  font-weight: bold;
  min-width: 24px;
}

.answer-display {
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 14px;
}

.ai-result {
  padding: 12px;
}

/* 底部操作区 */
.bottom-actions {
  background: #fff;
  padding: 16px 24px;
  border-top: 1px solid #eee;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-buttons {
  display: flex;
  justify-content: center;
  gap: 16px;
}

.action-hints {
  text-align: center;
  color: #999;
  font-size: 12px;
}
</style>
