<template>
  <div class="exam-history-workbench">
    <!-- Top Bar: 学生 + 试卷 选择器 + 统计 -->
    <header class="top-bar">
      <div class="top-bar-left">
        <span class="page-title">组卷历史</span>
        <el-select
          v-model="selectedStudentId"
          placeholder="选择学生"
          style="width: 180px"
          @change="handleStudentChange"
        >
          <el-option
            v-for="s in studentList"
            :key="s.id"
            :label="s.name"
            :value="s.id"
          />
        </el-select>
        <el-select
          v-model="selectedExamId"
          placeholder="选择试卷"
          style="width: 320px"
          :disabled="!selectedStudentId || exams.length === 0"
          @change="handleExamChange"
        >
          <el-option-group v-if="pendingExams.length > 0" label="待批改">
            <el-option
              v-for="exam in pendingExams"
              :key="exam.id"
              :label="`${exam.name} · ${formatDate(exam.created_at)}`"
              :value="exam.id"
            />
          </el-option-group>
          <el-option-group v-if="gradedExams.length > 0" label="已批改">
            <el-option
              v-for="exam in gradedExams"
              :key="exam.id"
              :label="`✓ ${exam.name} · ${formatDate(exam.created_at)}`"
              :value="exam.id"
            />
          </el-option-group>
        </el-select>
      </div>
      <div class="top-bar-right">
        <template v-if="exams.length > 0">
          <span class="stat-item">共 {{ exams.length }} 份</span>
          <span class="stat-graded">已批改 {{ gradedCount }}</span>
          <span class="stat-ungraded">待批改 {{ ungradedCount }}</span>
        </template>
        <el-button text type="primary" size="small" @click="refresh">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
    </header>

    <!-- Main Content: 详情占满 -->
    <main class="main-content">
      <!-- Loading（加载试卷列表） -->
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

      <div v-else-if="!selectedExam" class="content-empty">
        <el-empty description="请在顶部选择一份试卷" :image-size="100" />
      </div>

      <!-- 试卷详情（占满） -->
      <div v-else class="exam-detail">
        <div class="detail-inner">
          <div class="detail-header">
            <h3>{{ selectedExam.name }}</h3>
            <el-tag
              :type="selectedExam.status === 'graded' ? 'success' : 'warning'"
              size="small"
              effect="dark"
            >
              {{ selectedExam.status === 'graded' ? '已批改' : '未批改' }}
            </el-tag>
          </div>
          <div class="detail-meta">
            {{ formatDate(selectedExam.created_at) }} ·
            {{ selectedExam.total_count || selectedExam.question_ids?.length || 0 }} 题
          </div>

          <!-- 未批改：批改提示 -->
          <div v-if="selectedExam.status !== 'graded'" class="grade-action">
            <span class="grade-action__hint">该卷尚未批改，请逐题判定正确/错误后保存，批改结果将调整每道题的掌握度</span>
          </div>

          <!-- 已批改：统计卡 -->
          <div v-else class="stats-grid">
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

          <!-- 题目图片（多张） -->
          <h4 class="detail-subtitle">
            题目详情
            <span v-if="examQuestions.length" class="detail-subtitle__count">（{{ examQuestions.length }} 题）</span>
          </h4>

          <div v-if="questionsLoading" class="questions-loading">
            <el-skeleton :rows="3" animated />
          </div>

          <div v-else-if="examQuestions.length === 0" class="questions-empty">
            <el-empty description="未获取到题目内容" :image-size="80" />
          </div>

          <div v-else class="q-list">
            <div v-for="(q, idx) in examQuestions" :key="q.id" class="q-card">
              <div class="q-card__head">
                <span class="q-index">第 {{ idx + 1 }} 题</span>
                <span
                  v-if="effectiveCorrect(q) === true"
                  class="q-status q-status--correct"
                >正确</span>
                <span
                  v-else-if="effectiveCorrect(q) === false"
                  class="q-status q-status--wrong"
                >错误</span>
                <span v-else class="q-status q-status--pending">待判定</span>
              </div>
              <img
                v-if="imgSrc(q)"
                :src="imgSrc(q)"
                class="q-image"
                alt="题目图片"
                loading="lazy"
              />
              <div v-else class="q-noimage">该题暂无图片</div>
              <!-- 改判操作 -->
              <div class="q-rejudge">
                <el-button
                  size="small"
                  :type="effectiveCorrect(q) === true ? 'success' : 'default'"
                  :plain="effectiveCorrect(q) !== true"
                  @click="setResult(q, true)"
                >✓ 判为正确</el-button>
                <el-button
                  size="small"
                  :type="effectiveCorrect(q) === false ? 'danger' : 'default'"
                  :plain="effectiveCorrect(q) !== false"
                  @click="setResult(q, false)"
                >✗ 判为错误</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 底部保存栏：有改判待提交时显示 -->
    <footer v-if="selectedExam && hasChanges" class="save-bar">
      <span class="save-bar__hint">已改判 {{ Object.keys(pendingResults).length }} 题</span>
      <el-button :loading="saving" type="primary" @click="saveGrading">保存批改结果</el-button>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import {
  getStudents,
  getGeneratedExamsByStudent,
  getQuestionsByIds,
  getLatestJudgements,
  gradeGeneratedExam
} from '../../services/apiService'

const studentList = ref([])
const selectedStudentId = ref('')
const exams = ref([])
const selectedExam = ref(null)
const selectedExamId = ref('')
const loading = ref(false)

const examQuestions = ref([])
const questionsLoading = ref(false)

// 改判：本地记录被手动改判的题目（questionId -> true/false），保存时提交
const pendingResults = ref({})
const saving = ref(false)
const hasChanges = computed(() => Object.keys(pendingResults.value).length > 0)

const gradedCount = computed(() => exams.value.filter(e => e.status === 'graded').length)
const ungradedCount = computed(() => exams.value.filter(e => e.status !== 'graded').length)
const pendingExams = computed(() => exams.value.filter(e => e.status !== 'graded'))
const gradedExams = computed(() => exams.value.filter(e => e.status === 'graded'))

function computeAccuracy(exam) {
  const total = exam.total_count || exam.question_ids?.length || 0
  if (total === 0) return 0
  return Math.round(((exam.correct_count || 0) / total) * 100)
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return dayjs(dateStr).format('MM/DD HH:mm')
}

// 题目图片优先取 image_url（错题裁剪图），几何题回退 geometry_image_url
function imgSrc(q) {
  return q?.image_url || q?.geometry_image_url || ''
}

async function handleStudentChange(studentId) {
  selectedStudentId.value = studentId
  await loadExams()
  selectFirstExam()
}

async function loadExams() {
  if (!selectedStudentId.value) {
    exams.value = []
    return
  }
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

// 切换学生后自动选中最新（列表首项）一份试卷
function selectFirstExam() {
  if (exams.value.length > 0) {
    selectExam(exams.value[0])
  } else {
    selectedExam.value = null
    selectedExamId.value = ''
    examQuestions.value = []
  }
}

function handleExamChange(examId) {
  const exam = exams.value.find(e => e.id === examId)
  if (exam) selectExam(exam)
}

async function selectExam(exam) {
  selectedExam.value = exam
  selectedExamId.value = exam.id
  pendingResults.value = {}
  await loadExamQuestions(exam)
}

// 加载该卷的真实题目（含图片）；已批改卷合并最新判定得到每题正误
async function loadExamQuestions(exam) {
  const ids = exam.question_ids || []
  if (ids.length === 0) {
    examQuestions.value = []
    return
  }
  questionsLoading.value = true
  try {
    const fetched = await getQuestionsByIds(ids, selectedStudentId.value)
    const list = (Array.isArray(fetched) ? fetched : []).slice().sort((a, b) => {
      const ai = ids.indexOf(a.id)
      const bi = ids.indexOf(b.id)
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi)
    })
    await mergeJudgements(list)
    // 防止异步竞态：仅当仍是当前选中卷时写入
    if (selectedExam.value?.id === exam.id) {
      examQuestions.value = list
    }
  } catch (e) {
    console.error('加载试卷题目失败:', e)
    if (selectedExam.value?.id === exam.id) examQuestions.value = []
  } finally {
    questionsLoading.value = false
  }
}

// 合并最新判定，补齐每题 is_correct（题目本身缺失时）
async function mergeJudgements(questions) {
  try {
    const qIds = questions.map(q => q.id).filter(Boolean)
    if (qIds.length === 0 || !selectedStudentId.value) return
    const result = await getLatestJudgements(selectedStudentId.value, qIds)
    const judgements = result.judgements || []
    if (!Array.isArray(judgements) || judgements.length === 0) return
    const judgeMap = {}
    for (const j of judgements) {
      if (j.question_id) judgeMap[j.question_id] = j
    }
    for (const q of questions) {
      const j = judgeMap[q.id]
      if (j && q.is_correct == null && j.is_correct != null) {
        q.is_correct = j.is_correct
      }
    }
  } catch (e) {
    console.error('合并判定数据失败:', e)
  }
}

async function refresh() {
  const prevId = selectedExamId.value
  await loadExams()
  const keep = exams.value.find(e => e.id === prevId)
  if (keep) {
    selectExam(keep)
  } else {
    selectFirstExam()
  }
}

// 改判：将某题标为正确/错误（本地记录，保存时统一提交）
function setResult(q, isCorrect) {
  q.is_correct = isCorrect
  pendingResults.value = { ...pendingResults.value, [q.id]: isCorrect }
}

// 判定后的每题正误（优先本地改判，其次题目自身）
function effectiveCorrect(q) {
  if (q.id in pendingResults.value) return pendingResults.value[q.id]
  return q.is_correct
}

// 保存改判结果 → 调用批改接口，更新掌握度并将卷标记为已批改
async function saveGrading() {
  if (!selectedExam.value) return
  const results = examQuestions.value
    .filter(q => effectiveCorrect(q) != null)
    .map(q => ({ questionId: q.id, isCorrect: effectiveCorrect(q) }))
  if (results.length === 0) {
    ElMessage.warning('请先对题目做出正确/错误判定')
    return
  }
  saving.value = true
  try {
    await gradeGeneratedExam(selectedExam.value.id, selectedStudentId.value, results)
    ElMessage.success('批改结果已保存')
    pendingResults.value = {}
    await refresh()
  } catch (e) {
    console.error('保存批改结果失败:', e)
    ElMessage.error('保存失败，请重试')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    // getStudents 返回 { data: students[] }
    const result = await getStudents(false)
    const list = result.data || result || []
    studentList.value = Array.isArray(list) ? list : []
    if (studentList.value.length > 0) {
      selectedStudentId.value = studentList.value[0].id
      await loadExams()
      selectFirstExam()
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
  gap: 12px;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
  margin-right: 4px;
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

/* ── 详情（占满） ── */
.exam-detail {
  height: 100%;
  overflow-y: auto;
  padding: 24px 32px;
}

.detail-inner {
  max-width: 760px;
  margin: 0 auto;
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

/* 未批改批改入口 */
.grade-action {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}

.grade-action__hint {
  flex: 1;
  font-size: 13px;
  color: #86909C;
}

/* 已批改统计卡 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
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
  margin: 0 0 16px 0;
}

.detail-subtitle__count {
  font-size: 13px;
  color: #86909C;
  font-weight: 400;
}

.questions-loading,
.questions-empty {
  padding: 12px 0;
}

/* ── 题目图片列表 ── */
.q-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.q-card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  overflow: hidden;
}

.q-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #f2f3f5;
}

.q-index {
  font-size: 14px;
  font-weight: 600;
  color: #4E5969;
}

.q-status {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 10px;
  border-radius: 4px;
}

.q-status--correct {
  color: #67C23A;
  background: #F0F9EB;
}

.q-status--wrong {
  color: #F56C6C;
  background: #FEF0F0;
}

.q-status--pending {
  color: #E6A23C;
  background: #FDF6EC;
}

.q-rejudge {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #f2f3f5;
}

/* ── 底部保存栏 ── */
.save-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 12px 32px;
  background: #fff;
  border-top: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.save-bar__hint {
  font-size: 13px;
  color: #86909C;
}

.q-image {
  display: block;
  max-width: 100%;
  margin: 0 auto;
  padding: 12px;
}

.q-noimage {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: #c0c4cc;
}
</style>
