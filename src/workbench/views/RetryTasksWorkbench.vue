<template>
  <div class="retry-page">
    <header class="page-header">
      <div>
        <div class="eyebrow">学习闭环 / 重练任务</div>
        <h1>重练任务</h1>
        <p>通过再次练习，确认错题是否真正掌握。</p>
      </div>
      <el-button plain :loading="loading" @click="loadData">刷新</el-button>
    </header>

    <section class="summary-strip">
      <div><strong>{{ visibleExams.length }}</strong><span>全部任务</span></div>
      <div><strong class="warning">{{ pendingExams.length }}</strong><span>待批改</span></div>
      <div><strong class="success">{{ gradedExams.length }}</strong><span>已完成</span></div>
      <div><strong class="accent">{{ totalQuestions }}</strong><span>重练题目</span></div>
    </section>

    <section class="retry-surface">
      <div class="toolbar">
        <el-select v-model="selectedStudentId" clearable placeholder="全部学生" style="width: 180px" @change="syncStudentQuery">
          <el-option v-for="student in students" :key="student.id" :label="student.name" :value="student.id" />
        </el-select>
        <div class="filter-tabs" role="tablist" aria-label="重练任务状态">
          <button v-for="filter in filters" :key="filter.key" :class="{ active: activeFilter === filter.key }" @click="activeFilter = filter.key">{{ filter.label }}<span>{{ filter.count }}</span></button>
        </div>
      </div>

      <div v-if="loading" class="state"><el-icon class="is-loading"><Loading /></el-icon><span>正在加载重练任务…</span></div>
      <div v-else-if="visibleExams.length" class="retry-table">
        <div class="table-head"><span>任务</span><span>学生</span><span>题目</span><span>创建时间</span><span>状态</span><span></span></div>
        <article v-for="exam in visibleExams" :key="`${exam.student_id}-${exam.id}`" class="retry-row">
          <div class="task-copy"><strong>{{ exam.name }}</strong><small>{{ exam.source === 'generated' ? '来自错题池' : '重练任务' }}</small></div>
          <span class="student-name">{{ exam.studentName }}</span>
          <span class="muted">{{ exam.total_count || exam.question_ids?.length || 0 }} 题</span>
          <span class="muted">{{ formatDate(exam.created_at) }}</span>
          <el-tag :type="statusType(exam.status)" size="small" effect="plain">{{ statusLabel(exam.status) }}</el-tag>
          <el-button v-if="exam.status !== 'graded'" type="primary" text @click="openReview(exam)">开始批改</el-button>
          <el-button v-else text type="primary" @click="openReview(exam)">查看结果</el-button>
        </article>
      </div>
      <div v-else class="state"><el-icon><Document /></el-icon><strong>还没有重练任务</strong><span>在错题池中选择题目，就可以创建针对性重练。</span><el-button text type="primary" @click="router.push('/wrongbook')">去错题池</el-button></div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Document, Loading } from '@element-plus/icons-vue'
import { getGeneratedExamsByStudent, getStudents } from '../../services/apiService'

const route = useRoute()
const router = useRouter()
const students = ref([])
const exams = ref([])
const loading = ref(true)
const selectedStudentId = ref(route.query.studentId || '')
const activeFilter = ref('all')

const visibleExams = computed(() => exams.value.filter(exam => activeFilter.value === 'all' || exam.status === activeFilter.value))
const pendingExams = computed(() => exams.value.filter(exam => exam.status !== 'graded'))
const gradedExams = computed(() => exams.value.filter(exam => exam.status === 'graded'))
const totalQuestions = computed(() => exams.value.reduce((sum, exam) => sum + (exam.total_count || exam.question_ids?.length || 0), 0))
const filters = computed(() => [
  { key: 'all', label: '全部', count: exams.value.length },
  { key: 'ungraded', label: '待批改', count: pendingExams.value.length },
  { key: 'graded', label: '已完成', count: gradedExams.value.length }
])

async function loadData() {
  loading.value = true
  try {
    const studentResult = await getStudents(false)
    students.value = studentResult.data || studentResult || []
    const targets = selectedStudentId.value ? students.value.filter(student => String(student.id) === String(selectedStudentId.value)) : students.value
    const lists = await Promise.all(targets.map(student => getGeneratedExamsByStudent(student.id, false).catch(() => [])))
    exams.value = lists.flat().map(exam => ({ ...exam, studentName: students.value.find(student => String(student.id) === String(exam.student_id))?.name || '未命名学生' })).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  } catch (error) {
    students.value = []
    exams.value = []
  } finally {
    loading.value = false
  }
}
function syncStudentQuery() { router.replace({ path: '/exam-history', query: selectedStudentId.value ? { studentId: selectedStudentId.value } : {} }); loadData() }
function openReview(exam) { router.push({ path: '/exam-history/review', query: { studentId: exam.student_id, examId: exam.id } }) }
function statusLabel(status) { return status === 'graded' ? '已完成' : '待批改' }
function statusType(status) { return status === 'graded' ? 'success' : 'warning' }
function formatDate(value) { if (!value) return '时间未知'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间未知' : `${date.getMonth() + 1}月${date.getDate()}日` }
onMounted(loadData)
</script>

<style scoped>
.retry-page { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 32px 36px 48px; background: var(--wb-bg); }.page-header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px; }.eyebrow { color: var(--wb-text-tertiary); font-size: 12px; }h1 { margin: 6px 0 4px; color: var(--wb-text); font-size: 25px; font-weight: 650; }.page-header p { margin: 0; color: var(--wb-text-secondary); font-size: 13px; }.summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 16px; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }.summary-strip div { display: flex; align-items: baseline; gap: 10px; padding: 18px 20px; border-right: 1px solid var(--wb-border-light); }.summary-strip div:last-child { border-right: 0; }.summary-strip strong { margin-left: auto; color: var(--wb-text); font-size: 24px; font-variant-numeric: tabular-nums; }.summary-strip span { color: var(--wb-text-secondary); font-size: 13px; }.summary-strip .warning { color: var(--wb-warning); }.summary-strip .success { color: var(--wb-success); }.summary-strip .accent { color: var(--wb-accent); }.retry-surface { overflow: hidden; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }.toolbar { display: flex; align-items: center; gap: 24px; padding: 14px 20px; border-bottom: 1px solid var(--wb-border-light); }.filter-tabs { display: flex; gap: 4px; }.filter-tabs button { padding: 7px 10px; color: var(--wb-text-secondary); background: transparent; border: 0; border-radius: 6px; cursor: pointer; }.filter-tabs button.active { color: var(--wb-primary); font-weight: 600; background: var(--wb-primary-mist); }.filter-tabs span { margin-left: 5px; color: var(--wb-text-tertiary); font-size: 11px; }.table-head, .retry-row { display: grid; grid-template-columns: minmax(260px, 1.4fr) 140px 90px 120px 100px 110px; align-items: center; gap: 16px; padding: 0 20px; }.table-head { min-height: 38px; color: var(--wb-text-tertiary); font-size: 12px; background: var(--wb-bg); }.retry-row { min-height: 70px; border-bottom: 1px solid var(--wb-border-light); }.retry-row:hover { background: #FBFBFE; }.task-copy { display: flex; min-width: 0; flex-direction: column; gap: 4px; }.task-copy strong { overflow: hidden; color: var(--wb-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.task-copy small, .muted, .student-name { color: var(--wb-text-secondary); font-size: 12px; }.state { display: flex; align-items: center; justify-content: center; min-height: 280px; flex-direction: column; gap: 8px; color: var(--wb-text-tertiary); font-size: 13px; }.state .el-icon { font-size: 32px; }.state strong { color: var(--wb-text); font-size: 14px; }.state .el-button { margin-top: 4px; }
@media (max-width: 900px) { .retry-page { padding: 24px; }.summary-strip { grid-template-columns: repeat(2, 1fr); }.summary-strip div:nth-child(2) { border-right: 0; }.summary-strip div:nth-child(-n+2) { border-bottom: 1px solid var(--wb-border-light); }.table-head { display: none; }.retry-row { grid-template-columns: 1fr auto; gap: 7px 12px; padding: 14px 16px; }.task-copy { grid-row: span 2; }.retry-row > span:nth-child(2), .retry-row > span:nth-child(3), .retry-row > span:nth-child(4), .retry-row > .el-tag { text-align: right; }.retry-row > .el-button { grid-column: 2; justify-self: end; } }
@media (max-width: 560px) { .retry-page { padding: 20px 16px 32px; }.page-header { align-items: flex-start; flex-direction: column; gap: 12px; }.toolbar { align-items: stretch; flex-direction: column; gap: 12px; }.summary-strip { grid-template-columns: 1fr; }.summary-strip div, .summary-strip div:nth-child(2) { border-right: 0; border-bottom: 1px solid var(--wb-border-light); }.summary-strip div:last-child { border-bottom: 0; }.filter-tabs { overflow-x: auto; } }
</style>

