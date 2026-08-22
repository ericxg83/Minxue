<template>
  <div class="students-page">
    <header class="page-header">
      <div>
        <div class="eyebrow">学生 / 学生列表</div>
        <h1>学生</h1>
        <p>从学生的当前状态开始，进入错题、重练和成长记录。</p>
      </div>
      <span class="student-count">共 {{ filteredStudents.length }} 名学生</span>
    </header>

    <section class="students-surface">
      <div class="toolbar">
        <el-input v-model="search" clearable placeholder="搜索学生姓名" style="width: 240px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <div class="filter-tabs" role="tablist" aria-label="学生状态筛选">
          <button v-for="filter in filters" :key="filter.key" :class="{ active: activeFilter === filter.key }" @click="activeFilter = filter.key">
            {{ filter.label }}<span>{{ filter.count }}</span>
          </button>
        </div>
      </div>

      <div v-if="loading" class="state"><el-icon class="is-loading"><Loading /></el-icon><span>正在加载学生…</span></div>
      <div v-else-if="filteredStudents.length" class="student-table">
        <div class="table-head"><span>学生</span><span>今日作业</span><span>新增错题</span><span>待重练</span><span>状态</span><span></span></div>
        <button v-for="student in filteredStudents" :key="student.id" class="student-row" @click="openStudent(student.id)">
          <span class="student-cell"><el-avatar :size="34" :src="student.avatar">{{ initial(student.name) }}</el-avatar><span><strong>{{ student.name || '未命名学生' }}</strong><small>{{ student.grade || student.class || '暂无年级信息' }}</small></span></span>
          <span class="muted">{{ student.taskCount }} 份</span>
          <span :class="{ danger: student.wrongCount > 0 }">{{ student.wrongCount }}</span>
          <span :class="{ warning: student.retryCount > 0 }">{{ student.retryCount }}</span>
          <span><el-tag :type="student.statusType" size="small" effect="plain">{{ student.status }}</el-tag></span>
          <el-icon class="row-arrow"><ArrowRight /></el-icon>
        </button>
      </div>
      <div v-else class="state"><el-icon><User /></el-icon><strong>没有找到匹配的学生</strong><span>可以换一个姓名或清除筛选条件。</span></div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, Loading, Search, User } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { getStudents, getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent } from '../../services/apiService'

const router = useRouter()
const students = ref([])
const loading = ref(true)
const search = ref('')
const activeFilter = ref('all')

const enrichedStudents = computed(() => students.value.map(student => {
  const wrongCount = student.wrongCount || 0
  const retryCount = student.retryCount || 0
  const taskCount = student.taskCount || 0
  const hasRisk = wrongCount > 0 || retryCount > 0
  return { ...student, wrongCount, retryCount, taskCount, status: hasRisk ? '需关注' : '正常', statusType: hasRisk ? 'warning' : 'success' }
}))
const filters = computed(() => [
  { key: 'all', label: '全部', count: enrichedStudents.value.length },
  { key: 'risk', label: '需关注', count: enrichedStudents.value.filter(student => student.status === '需关注').length },
  { key: 'normal', label: '状态正常', count: enrichedStudents.value.filter(student => student.status === '正常').length }
])
const filteredStudents = computed(() => enrichedStudents.value.filter(student => {
  const matchesSearch = !search.value || (student.name || '').toLowerCase().includes(search.value.toLowerCase())
  const matchesFilter = activeFilter.value === 'all' || (activeFilter.value === 'risk' && student.status === '需关注') || (activeFilter.value === 'normal' && student.status === '正常')
  return matchesSearch && matchesFilter
}))
const initial = (name) => (name || '?').slice(0, 1)
const openStudent = (id) => router.push(`/students/${id}`)

onMounted(async () => {
  try {
    const result = await getStudents(false)
    const list = result.data || result || []
    const base = Array.isArray(list) ? list : []
    students.value = await Promise.all(base.map(async student => {
      const [tasks, wrongQuestions, exams] = await Promise.all([
        getTasksByStudent(student.id).catch(() => []),
        getWrongQuestionsByStudent(student.id).catch(() => []),
        getGeneratedExamsByStudent(student.id).catch(() => [])
      ])
      const wrongList = Array.isArray(wrongQuestions) ? wrongQuestions : []
      const examList = Array.isArray(exams) ? exams : []
      return { ...student, taskCount: Array.isArray(tasks) ? tasks.length : 0, wrongCount: wrongList.filter(item => item.lifecycle_status !== 'mastered').length, retryCount: examList.filter(item => !['graded', 'completed'].includes(item.status)).length }
    }))
  } catch (error) {
    students.value = []
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.students-page { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 32px 36px 48px; background: var(--wb-bg); }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px; }.eyebrow { color: var(--wb-text-tertiary); font-size: 12px; }h1 { margin: 6px 0 4px; color: var(--wb-text); font-size: 25px; font-weight: 650; }.page-header p { margin: 0; color: var(--wb-text-secondary); font-size: 13px; }.student-count { color: var(--wb-text-tertiary); font-size: 13px; }
.students-surface { background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; overflow: hidden; }.toolbar { display: flex; align-items: center; gap: 24px; padding: 14px 20px; border-bottom: 1px solid var(--wb-border-light); }.filter-tabs { display: flex; gap: 4px; }.filter-tabs button { padding: 7px 10px; color: var(--wb-text-secondary); background: transparent; border: 0; border-radius: 6px; cursor: pointer; }.filter-tabs button:hover { background: var(--wb-bg); }.filter-tabs button.active { color: var(--wb-primary); font-weight: 600; background: var(--wb-primary-mist); }.filter-tabs span { margin-left: 5px; color: var(--wb-text-tertiary); font-size: 11px; }.table-head, .student-row { display: grid; grid-template-columns: minmax(280px, 1.5fr) 150px 130px 130px 120px 24px; align-items: center; gap: 16px; padding: 0 20px; }.table-head { min-height: 38px; color: var(--wb-text-tertiary); font-size: 12px; background: var(--wb-bg); }.student-row { width: 100%; min-height: 70px; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--wb-border-light); cursor: pointer; }.student-row:hover { background: #FBFBFE; }.student-cell { display: flex; align-items: center; min-width: 0; gap: 12px; }.student-cell :deep(.el-avatar) { flex: 0 0 auto; color: var(--wb-primary); background: var(--wb-primary-soft); }.student-cell > span { display: flex; min-width: 0; flex-direction: column; gap: 4px; }.student-cell strong { overflow: hidden; color: var(--wb-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.student-cell small, .muted { color: var(--wb-text-secondary); font-size: 12px; }.danger { color: var(--wb-danger); }.warning { color: var(--wb-warning); }.row-arrow { color: var(--wb-text-tertiary); }.state { display: flex; align-items: center; justify-content: center; min-height: 280px; flex-direction: column; gap: 8px; color: var(--wb-text-tertiary); font-size: 13px; }.state .el-icon { font-size: 32px; }.state strong { color: var(--wb-text); font-size: 14px; }
@media (max-width: 900px) { .students-page { padding: 24px; }.toolbar { align-items: stretch; flex-direction: column; gap: 12px; }.table-head { display: none; }.student-row { grid-template-columns: 1fr auto; gap: 8px 12px; padding: 14px 16px; }.student-cell { grid-row: span 2; }.student-row > span:nth-child(2), .student-row > span:nth-child(3), .student-row > span:nth-child(4), .student-row > span:nth-child(5) { text-align: right; }.student-row > span:nth-child(5) { grid-column: 2; } }
@media (max-width: 560px) { .students-page { padding: 20px 16px 32px; }.page-header { align-items: flex-start; flex-direction: column; gap: 8px; }.filter-tabs { overflow-x: auto; } }
</style>

