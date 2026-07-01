<template>
  <div class="exam-history-workbench">
    <!-- Top Bar: Student Selector + Stats -->
    <header class="top-bar">
      <div class="top-bar-left">
        <el-select
          v-model="selectedStudentId"
          placeholder="选择学生"
          style="width: 200px"
          @change="handleStudentChange"
        >
          <el-option
            v-for="s in studentList"
            :key="s.id"
            :label="s.name"
            :value="s.id"
          />
        </el-select>
        <span class="page-title">组卷历史</span>
      </div>
      <div class="top-bar-right">
        <template v-if="exams.length > 0">
          <span class="stat-item">共 {{ exams.length }} 份</span>
          <span class="stat-graded">已批改 {{ gradedCount }}</span>
          <span class="stat-ungraded">待批改 {{ ungradedCount }}</span>
        </template>
      </div>
    </header>

    <!-- Main Content: Card List + Detail -->
    <main class="main-content">
      <!-- Loading -->
      <div v-if="loading" class="content-loading">
        <el-skeleton :rows="4" animated />
      </div>

      <!-- Empty -->
      <div v-else-if="!selectedStudentId" class="content-empty">
        <el-empty description="请选择学生查看组卷记录" :image-size="100" />
      </div>

      <div v-else-if="exams.length === 0" class="content-empty">
        <el-empty description="该学生暂无组卷记录" :image-size="100" />
      </div>

      <!-- Exam Cards + Detail -->
      <template v-else>
        <div class="content-layout">
          <!-- Left: Exam List -->
          <div class="exam-list">
            <div class="list-header">
              <span class="list-title">试卷列表</span>
              <el-button text type="primary" size="small" @click="loadExams">
                <el-icon><Refresh /></el-icon> 刷新
              </el-button>
            </div>
            <div class="exam-list-scroll">
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
                <span class="stat-correct">正确 {{ exam.correct_count || 0 }}</span>
                <span class="stat-wrong">错误 {{ exam.wrong_count || 0 }}</span>
                <span class="stat-rate">正确率 {{ computeAccuracy(exam) }}%</span>
              </div>
            </div>
            </div>
          </div>
          <div class="exam-detail">
            <template v-if="!selectedExam">
              <div class="detail-hint">
                <el-empty description="从左侧选择一份试卷" :image-size="80" />
              </div>
            </template>

            <!-- Ungraded -->
            <template v-else-if="selectedExam.status !== 'graded'">
              <div class="detail-ungraded">
                <el-icon :size="48" color="#1677FF"><EditPen /></el-icon>
                <h3>{{ selectedExam.name }}</h3>
                <p>共 {{ selectedExam.total_count || selectedExam.question_ids?.length || 0 }} 道题目</p>
                <p class="detail-hint-text">请批改此试卷，批改结果将调整每道题的掌握度</p>
                <el-button type="primary" size="large" @click="startGrading(selectedExam)">
                  <el-icon><EditPen /></el-icon> 开始批改
                </el-button>
              </div>
            </template>

            <!-- Graded Result -->
            <template v-else>
              <div class="detail-graded">
                <div class="detail-header">
                  <h3>{{ selectedExam.name }}</h3>
                  <el-tag type="success" size="small" effect="dark">已批改</el-tag>
                </div>
                <div class="detail-meta">
                  {{ formatDate(selectedExam.created_at) }} · {{ selectedExam.total_count || selectedExam.question_ids?.length || 0 }} 题
                </div>

                <div class="stats-grid">
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

                <h4 class="detail-subtitle">答题详情</h4>
                <div class="detail-list">
                  <div
                    v-for="i in (selectedExam.total_count || selectedExam.question_ids?.length || 0)"
                    :key="i"
                    class="detail-row"
                  >
                    <span class="detail-index">第 {{ i }} 题</span>
                    <span
                      class="detail-status"
                      :class="i <= (selectedExam.correct_count || 0) ? 'detail-status--correct' : 'detail-status--wrong'"
                    >
                      {{ i <= (selectedExam.correct_count || 0) ? '正确' : '错误' }}
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Close, EditPen, Refresh } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { getStudents, getGeneratedExamsByStudent } from '../../services/apiService'

const router = useRouter()

const studentList = ref([])
const selectedStudentId = ref('')
const exams = ref([])
const selectedExam = ref(null)
const loading = ref(false)

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

async function handleStudentChange(studentId) {
  selectedStudentId.value = studentId
  selectedExam.value = null
  await loadExams()
}

async function loadExams() {
  if (!selectedStudentId.value) return
  loading.value = true
  try {
    exams.value = await getGeneratedExamsByStudent(selectedStudentId.value, false)
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
      studentId: selectedStudentId.value
    }
  })
}

onMounted(async () => {
  try {
    // Fix: getStudents returns { data: students[] }, not { students[] }
    const result = await getStudents(false)
    const list = result.data || result || []
    studentList.value = Array.isArray(list) ? list : []
    if (studentList.value.length > 0) {
      selectedStudentId.value = studentList.value[0].id
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
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

/* ── Top Bar ── */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #86909C;
}

.stat-graded { color: #67C23A; }
.stat-ungraded { color: #E6A23C; }

/* ── Main Content ── */
.main-content {
  flex: 1;
  overflow: hidden;
}

.content-loading,
.content-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
}

/* ── Content Layout ── */
.content-layout {
  display: flex;
  height: 100%;
}

/* ── Left: Exam List ── */
.exam-list {
  width: 380px;
  min-width: 380px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e4e7ed;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #f2f3f5;
}

.list-title {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
}

.exam-list-scroll {
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
  margin: 0 8px 6px;
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
}

.stat-correct { color: #67C23A; font-weight: 500; }
.stat-wrong { color: #F56C6C; font-weight: 500; }
.stat-rate { color: #1677FF; font-weight: 500; }

/* ── Right: Detail ── */
.exam-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 32px;
}

.detail-hint {
  color: #c0c4cc;
}

.detail-ungraded {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 400px;
}

.detail-ungraded h3 {
  margin: 0;
  font-size: 18px;
  color: #1D2129;
}

.detail-ungraded p {
  margin: 0;
  color: #86909C;
  font-size: 14px;
}

.detail-hint-text {
  color: #c0c4cc;
  font-size: 13px;
}

/* Graded Detail */
.detail-graded {
  width: 100%;
  max-width: 600px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.detail-header h3 {
  margin: 0;
  font-size: 20px;
  color: #1D2129;
}

.detail-meta {
  font-size: 13px;
  color: #86909C;
  margin-bottom: 24px;
}

.stats-grid {
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

.detail-subtitle {
  font-size: 15px;
  color: #1D2129;
  margin: 0 0 12px 0;
}

.detail-list {
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
