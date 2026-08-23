<template>
  <div class="retry-page review-task-page">
    <header class="page-header">
      <div>
        <div class="eyebrow">批改工作台 / 学习验证</div>
        <h1>重练批改</h1>
        <p>批改学生的错题重练，确认哪些知识点正在掌握。</p>
      </div>
      <el-button class="refresh-button" plain :loading="loading" @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
    </header>
    <section class="summary-strip" aria-label="重练任务概览">
      <div class="summary-item summary-item--attention"><span>待批改</span><strong>{{ pendingExams.length }}</strong><small>优先处理</small></div>
      <div class="summary-item"><span>全部任务</span><strong>{{ exams.length }}</strong><small>已加载任务</small></div>
      <div class="summary-item"><span>已完成</span><strong class="success">{{ gradedExams.length }}</strong><small>可查看结果</small></div>
      <div class="summary-item"><span>重练题目</span><strong class="accent">{{ totalQuestions }}</strong><small>覆盖错题验证</small></div>
    </section>
    <section class="retry-surface">
      <div class="toolbar">
        <div class="toolbar-heading"><strong>重练任务</strong><span>{{ visibleExams.length }} 份</span></div>
        <el-select v-model="selectedStudentId" clearable placeholder="全部学生" class="student-select" @change="syncStudentQuery">
          <el-option v-for="student in students" :key="student.id" :label="student.name" :value="student.id" />
        </el-select>
        <div class="filter-tabs" role="tablist" aria-label="重练任务状态">
          <button v-for="filter in filters" :key="filter.key" :class="{ active: activeFilter === filter.key }" @click="activeFilter = filter.key">{{ filter.label }}<span>{{ filter.count }}</span></button>
        </div>
      </div>
      <div v-if="loading" class="state"><el-icon class="is-loading"><Loading /></el-icon><strong>正在加载任务</strong><span>正在同步学生的重练记录</span></div>
      <div v-else-if="visibleExams.length" class="retry-table">
        <div class="table-head"><span>任务</span><span>学生</span><span>题目</span><span>创建时间</span><span>状态</span><span>操作</span></div>
        <article v-for="exam in visibleExams" :key="`${exam.student_id}-${exam.id}`" class="retry-row">
          <div class="task-copy"><strong>{{ exam.name }}</strong><small>{{ exam.source === 'generated' ? '来自错题池' : '重练任务' }}</small></div>
          <span class="student-name">{{ exam.studentName }}</span>
          <span class="muted">{{ exam.total_count || exam.question_ids?.length || 0 }} 题</span>
          <span class="muted">{{ formatDate(exam.created_at) }}</span>
          <el-tag class="status-tag" :type="statusType(exam.status)" size="small" effect="plain">{{ statusLabel(exam.status) }}</el-tag>
          <el-button v-if="exam.status !== 'graded'" class="row-action" type="primary" @click="openReview(exam)">开始批改</el-button>
          <el-button v-else class="row-action" text type="primary" @click="openReview(exam)">查看结果</el-button>
        </article>
      </div>
      <div v-else class="state"><el-icon><Document /></el-icon><strong>还没有重练任务</strong><span>在错题池中选择题目，就可以创建针对性重练。</span><el-button text type="primary" @click="router.push('/wrongbook')">去错题池创建</el-button></div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Document, Loading, Refresh } from '@element-plus/icons-vue'
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
.retry-page { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 34px 40px 52px; background: var(--wb-bg); }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; max-width: 1240px; margin: 0 auto 26px; }
.eyebrow { color: var(--wb-primary); font-size: 12px; font-weight: 600; letter-spacing: .02em; }
h1 { margin: 8px 0 5px; color: var(--wb-text); font-size: 28px; font-weight: 700; letter-spacing: -.02em; }
.page-header p { margin: 0; color: var(--wb-text-secondary); font-size: 13px; }
.refresh-button { border-color: var(--wb-border); color: var(--wb-text-secondary); }
.summary-strip, .retry-surface { max-width: 1240px; margin-left: auto; margin-right: auto; }
.summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 16px; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }
.summary-item { position: relative; display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; gap: 4px 12px; padding: 15px 20px; border-right: 1px solid var(--wb-border-light); }
.summary-item:last-child { border-right: 0; }
.summary-item > span { color: var(--wb-text-secondary); font-size: 12px; }
.summary-item strong { color: var(--wb-text); font-size: 23px; line-height: 1; font-variant-numeric: tabular-nums; }
.summary-item small { grid-column: 1 / -1; color: var(--wb-text-tertiary); font-size: 11px; }
.summary-item .success { color: var(--wb-success); } .summary-item .accent { color: var(--wb-accent); }
.summary-item--attention { box-shadow: inset 3px 0 var(--wb-warning); } .summary-item--attention strong { color: var(--wb-warning); }
.retry-surface { overflow: hidden; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }
.toolbar { display: flex; align-items: center; gap: 20px; padding: 13px 20px; border-bottom: 1px solid var(--wb-border-light); }
.toolbar-heading { display: flex; align-items: baseline; gap: 8px; margin-right: auto; } .toolbar-heading strong { color: var(--wb-text); font-size: 14px; } .toolbar-heading span { color: var(--wb-text-tertiary); font-size: 12px; }
.student-select { width: 180px; } .filter-tabs { display: flex; gap: 3px; }
.filter-tabs button { padding: 7px 10px; color: var(--wb-text-secondary); background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: 12px; }
.filter-tabs button:hover { background: var(--wb-bg); color: var(--wb-text); } .filter-tabs button.active { color: var(--wb-primary); font-weight: 600; background: var(--wb-primary-mist); }
.filter-tabs span { margin-left: 5px; color: var(--wb-text-tertiary); font-size: 11px; }
.table-head, .retry-row { display: grid; grid-template-columns: minmax(260px, 1.4fr) 140px 90px 120px 100px 110px; align-items: center; gap: 16px; padding: 0 20px; }
.table-head { min-height: 36px; color: var(--wb-text-tertiary); font-size: 11px; background: var(--wb-bg); } .retry-row { min-height: 72px; border-bottom: 1px solid var(--wb-border-light); } .retry-row:last-child { border-bottom: 0; } .retry-row:hover { background: #FAFBFF; }
.task-copy { display: flex; min-width: 0; flex-direction: column; gap: 5px; } .task-copy strong { overflow: hidden; color: var(--wb-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.task-copy small, .muted, .student-name { color: var(--wb-text-secondary); font-size: 12px; } .status-tag { justify-self: start; } .row-action { min-width: 82px; }
.state { display: flex; align-items: center; justify-content: center; min-height: 300px; flex-direction: column; gap: 8px; color: var(--wb-text-tertiary); font-size: 13px; } .state .el-icon { font-size: 30px; } .state strong { color: var(--wb-text); font-size: 14px; } .state .el-button { margin-top: 4px; }
@media (max-width: 900px) { .retry-page { padding: 24px; } .summary-strip { grid-template-columns: repeat(2, 1fr); } .summary-item:nth-child(2) { border-right: 0; } .summary-item:nth-child(-n+2) { border-bottom: 1px solid var(--wb-border-light); } .table-head { display: none; } .retry-row { grid-template-columns: 1fr auto; gap: 7px 12px; padding: 14px 16px; } .task-copy { grid-row: span 2; } .retry-row > span:nth-child(2), .retry-row > span:nth-child(3), .retry-row > span:nth-child(4), .retry-row > .el-tag { text-align: right; } .retry-row > .el-button { grid-column: 2; justify-self: end; } }
@media (max-width: 560px) { .retry-page { padding: 20px 16px 32px; } .page-header { align-items: flex-start; flex-direction: column; gap: 12px; } .toolbar { align-items: stretch; flex-direction: column; gap: 12px; } .student-select { width: 100%; } .summary-strip { grid-template-columns: 1fr; } .summary-item, .summary-item:nth-child(2) { border-right: 0; border-bottom: 1px solid var(--wb-border-light); } .summary-item:last-child { border-bottom: 0; } .filter-tabs { overflow-x: auto; } }
</style>

