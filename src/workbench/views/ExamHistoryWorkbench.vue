<template>
  <div class="exam-history-workbench">
    <div class="main-layout">
      <!-- Left Panel: Student selector + Exam List -->
      <aside class="exam-panel">
        <div class="exam-panel__header">
          <span class="exam-panel__title">组卷历史</span>
          <el-icon class="exam-panel__close" @click="handleBack"><Close /></el-icon>
        </div>

        <!-- Student Switcher -->
        <div class="exam-panel__student">
          <StudentSwitcher
            :current-student="currentStudent"
            :student-list="studentList"
            :visible="showStudentSwitcher"
            @change-student="handleStudentChange"
            @update:visible="showStudentSwitcher = $event"
          />
        </div>

        <!-- Stats Row -->
        <div class="exam-panel__stats">
          <span>共 {{ exams.length }} 份试卷</span>
          <span class="stat-graded">已批改 {{ gradedCount }}</span>
          <span class="stat-ungraded">待批改 {{ ungradedCount }}</span>
        </div>

        <!-- Exam List -->
        <div class="exam-panel__list">
          <template v-if="loading">
            <el-skeleton :rows="4" animated style="padding: 12px;" />
          </template>

          <template v-else-if="exams.length === 0">
            <el-empty description="该学生暂无组卷记录" :image-size="80" />
          </template>

          <template v-else>
            <div
              v-for="exam in exams"
              :key="exam.id"
              class="exam-card"
              :class="{ 'exam-card--selected': selectedExam?.id === exam.id }"
              @click="selectExam(exam)"
            >
              <div class="exam-card__top">
                <span class="exam-card__name">{{ exam.name }}</span>
                <el-tag
                  :type="exam.status === 'graded' ? 'success' : 'warning'"
                  size="small"
                  effect="light"
                >
                  {{ exam.status === 'graded' ? '已批改' : '未批改' }}
                </el-tag>
              </div>
              <div class="exam-card__meta">
                <span>{{ formatDate(exam.created_at) }}</span>
                <span>·</span>
                <span>{{ exam.total_count || exam.question_ids?.length || 0 }} 题</span>
              </div>
              <div v-if="exam.status === 'graded'" class="exam-card__stats">
                <span class="stat-item stat-correct">正确 {{ exam.correct_count || 0 }}</span>
                <span class="stat-item stat-wrong">错误 {{ exam.wrong_count || 0 }}</span>
                <span class="stat-item stat-rate">正确率 {{ computeAccuracy(exam) }}%</span>
              </div>
              <div class="exam-card__actions">
                <el-button
                  v-if="exam.status !== 'graded'"
                  type="primary"
                  size="small"
                  @click.stop="startGrading(exam)"
                >
                  <el-icon><EditPen /></el-icon> 批改
                </el-button>
                <el-button
                  v-else
                  size="small"
                  @click.stop="selectExam(exam)"
                >
                  查看结果
                </el-button>
              </div>
            </div>
          </template>
        </div>
      </aside>

      <!-- Right Panel: Detail View -->
      <section class="detail-panel">
        <!-- No selection state -->
        <div v-if="!selectedExam" class="detail-empty">
          <el-empty description="请从左侧选择一份试卷" :image-size="100" />
        </div>

        <!-- Ungraded exam prompt -->
        <div v-else-if="selectedExam.status !== 'graded'" class="detail-prompt">
          <div class="prompt-content">
            <el-icon class="prompt-icon" :size="48" color="#1677FF"><EditPen /></el-icon>
            <h3>{{ selectedExam.name }}</h3>
            <p>共 {{ selectedExam.total_count || selectedExam.question_ids?.length || 0 }} 道题目</p>
            <p class="prompt-hint">点击下方按钮开始批改此试卷</p>
            <el-button type="primary" size="large" @click="startGrading(selectedExam)">
              <el-icon><EditPen /></el-icon> 开始批改
            </el-button>
          </div>
        </div>

        <!-- Graded exam result view -->
        <div v-else class="detail-result">
          <div class="result-header">
            <h2>{{ selectedExam.name }}</h2>
            <el-tag type="success" size="small" effect="dark">已批改</el-tag>
          </div>
          <div class="result-meta">
            <span>{{ formatDate(selectedExam.created_at) }}</span>
            <span>·</span>
            <span>{{ selectedExam.total_count || selectedExam.question_ids?.length || 0 }} 题</span>
          </div>

          <div class="result-stats-grid">
            <div class="stat-box stat-box--total">
              <div class="stat-box__value">{{ selectedExam.total_count || selectedExam.question_ids?.length || 0 }}</div>
              <div class="stat-box__label">总题数</div>
            </div>
            <div class="stat-box stat-box--correct">
              <div class="stat-box__value">{{ selectedExam.correct_count || 0 }}</div>
              <div class="stat-box__label">正确</div>
            </div>
            <div class="stat-box stat-box--wrong">
              <div class="stat-box__value">{{ selectedExam.wrong_count || 0 }}</div>
              <div class="stat-box__label">错误</div>
            </div>
            <div class="stat-box stat-box--rate">
              <div class="stat-box__value">{{ computeAccuracy(selectedExam) }}%</div>
              <div class="stat-box__label">正确率</div>
            </div>
          </div>

          <el-divider />

          <h3 class="result-subtitle">答题详情</h3>
          <div class="result-detail-list">
            <div class="detail-row" v-for="i in (selectedExam.total_count || selectedExam.question_ids?.length || 0)" :key="i">
              <span class="detail-index">第 {{ i }} 题</span>
              <span v-if="i <= (selectedExam.correct_count || 0)" class="detail-status detail-status--correct">
                正确
              </span>
              <span v-else class="detail-status detail-status--wrong">
                错误
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Close, EditPen } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import StudentSwitcher from '../components/wrongbook/StudentSwitcher.vue'
import { getStudents, getGeneratedExamsByStudent } from '../../services/apiService'

const router = useRouter()

const studentList = ref([])
const currentStudent = ref(null)
const exams = ref([])
const selectedExam = ref(null)
const loading = ref(false)
const showStudentSwitcher = ref(false)

const gradedCount = computed(() => exams.value.filter(e => e.status === 'graded').length)
const ungradedCount = computed(() => exams.value.filter(e => e.status !== 'graded').length)

function computeAccuracy(exam) {
  const total = exam.total_count || exam.question_ids?.length || 0
  if (total === 0) return 0
  return Math.round(((exam.correct_count || 0) / total) * 100)
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return dayjs(dateStr).format('MM/DD HH:mm')
}

function selectExam(exam) {
  selectedExam.value = exam
}

function handleBack() {
  router.push('/')
}

async function handleStudentChange(student) {
  currentStudent.value = student
  selectedExam.value = null
  await loadExams()
}

async function loadExams() {
  if (!currentStudent.value) return
  loading.value = true
  try {
    exams.value = await getGeneratedExamsByStudent(currentStudent.value.id, false)
  } catch (e) {
    console.error('加载组卷记录失败:', e)
    exams.value = []
  } finally {
    loading.value = false
  }
}

function startGrading(exam) {
  router.push({
    name: 'ExamGrading',
    query: {
      examId: exam.id,
      studentId: currentStudent.value?.id
    }
  })
}

onMounted(async () => {
  try {
    const result = await getStudents(false)
    studentList.value = result?.students || []
    if (studentList.value.length > 0) {
      currentStudent.value = studentList.value[0]
      await loadExams()
    }
  } catch (e) {
    console.error('加载学生列表失败:', e)
  }
})
</script>

<style scoped>
.exam-history-workbench {
  height: 100%;
}

.main-layout {
  display: flex;
  height: 100%;
}

/* ── Left Panel ── */
.exam-panel {
  width: 380px;
  min-width: 380px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e4e7ed;
}

.exam-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f2f3f5;
}

.exam-panel__title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}

.exam-panel__close {
  cursor: pointer;
  color: #86909C;
  font-size: 18px;
}

.exam-panel__close:hover {
  color: #4E5969;
}

.exam-panel__student {
  border-bottom: 1px solid #f2f3f5;
}

.exam-panel__stats {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  font-size: 12px;
  color: #86909C;
  border-bottom: 1px solid #f2f3f5;
}

.stat-graded { color: #67C23A; }
.stat-ungraded { color: #E6A23C; }

.exam-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

/* Exam Card */
.exam-card {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 6px;
  border: 1px solid transparent;
}

.exam-card:hover {
  background: #f5f7fa;
}

.exam-card--selected {
  background: #E8F3FF;
  border-color: #1677FF;
}

.exam-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.exam-card__name {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exam-card__meta {
  font-size: 12px;
  color: #86909C;
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.exam-card__stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  margin-bottom: 6px;
}

.stat-item { font-weight: 500; }
.stat-correct { color: #67C23A; }
.stat-wrong { color: #F56C6C; }
.stat-rate { color: #1677FF; }

.exam-card__actions {
  display: flex;
  justify-content: flex-end;
}

/* ── Right Panel ── */
.detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  overflow-y: auto;
}

.detail-empty,
.detail-prompt {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.prompt-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.prompt-icon {
  margin-bottom: 8px;
}

.prompt-content h3 {
  margin: 0;
  font-size: 18px;
  color: #1D2129;
}

.prompt-content p {
  margin: 0;
  color: #86909C;
  font-size: 14px;
}

.prompt-hint {
  color: #c0c4cc;
  font-size: 13px;
}

/* Result View */
.detail-result {
  padding: 24px 32px;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.result-header h2 {
  margin: 0;
  font-size: 20px;
  color: #1D2129;
}

.result-meta {
  font-size: 13px;
  color: #86909C;
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
}

.result-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 8px;
}

.stat-box {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  border: 1px solid #e4e7ed;
}

.stat-box__value {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 4px;
}

.stat-box__label {
  font-size: 13px;
  color: #86909C;
}

.stat-box--total .stat-box__value { color: #1D2129; }
.stat-box--correct .stat-box__value { color: #67C23A; }
.stat-box--wrong .stat-box__value { color: #F56C6C; }
.stat-box--rate .stat-box__value { color: #1677FF; }

.result-subtitle {
  font-size: 15px;
  color: #1D2129;
  margin: 0 0 12px 0;
}

.result-detail-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 6px;
  border: 1px solid #f2f3f5;
}

.detail-index {
  font-size: 13px;
  color: #4E5969;
  flex: 1;
}

.detail-status {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
}

.detail-status--correct {
  color: #67C23A;
  background: #F0F9EB;
}

.detail-status--wrong {
  color: #F56C6C;
  background: #FEF0F0;
}
</style>
