<template>
  <div class="wb-page students-page">
    <div class="wb-page__inner">
      <PageHeader eyebrow="学生学习 / 学生档案" title="学生档案" description="按学生查看学习状态，进入档案可看学情、错题、重练并安排下一步。">
        <template #badge><span class="header-count">在读 {{ summary.active }} 人</span></template>
        <template #actions><ActionButton variant="primary" @click="openCreateDialog">添加学生</ActionButton></template>
      </PageHeader>

      <section class="stats-grid" aria-label="学生状态概览">
        <StatsCard label="在读学生" :value="summary.active" unit="人" description="当前正常上课" tone="primary" />
        <StatsCard label="需关注" :value="summary.risk" unit="人" description="在读且有未掌握错题或待重练" tone="warning" />
        <StatsCard label="待重练" :value="summary.withRetry" unit="人" description="有重练卷还没批改" tone="danger" />
        <StatsCard label="已停课" :value="summary.paused" unit="人" description="不计入在读，记录保留" />
      </section>

      <FilterBar>
        <template #leading><span class="result-label">当前显示</span><strong>{{ filteredStudents.length }} 名学生</strong></template>
        <el-input v-model="search" clearable placeholder="搜索学生姓名" class="student-search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <div class="filter-tabs" role="tablist" aria-label="学生状态筛选">
          <button v-for="filter in filters" :key="filter.key" type="button" role="tab" :class="{ active: activeFilter === filter.key }" :aria-selected="activeFilter === filter.key" @click="activeFilter = filter.key">
            {{ filter.label }}<span>{{ filter.count }}</span>
          </button>
        </div>
      </FilterBar>

      <ContentCard title="学生学习状态" description="点任意一行进入学生档案，安排下一步" flush class="student-workspace">
        <div v-if="loading" class="student-skeleton" aria-label="正在加载学生">
          <div v-for="index in 5" :key="index" class="skeleton-row">
            <el-skeleton animated>
              <template #template>
                <div class="skeleton-content">
                  <el-skeleton-item variant="circle" class="skeleton-avatar" />
                  <el-skeleton-item variant="text" class="skeleton-name" />
                  <el-skeleton-item variant="text" class="skeleton-metric" />
                  <el-skeleton-item variant="text" class="skeleton-metric" />
                  <el-skeleton-item variant="text" class="skeleton-metric" />
                  <el-skeleton-item variant="button" class="skeleton-status" />
                </div>
              </template>
            </el-skeleton>
          </div>
        </div>

        <div v-else-if="filteredStudents.length" class="student-table">
          <div class="table-head" aria-hidden="true"><span>学生</span><span>作业记录</span><span>未掌握错题</span><span>待重练</span><span>当前状态</span><span></span></div>
          <div
            v-for="student in filteredStudents"
            :key="student.id"
            role="button"
            tabindex="0"
            :class="['student-row', { 'is-paused': student.paused }]"
            :aria-label="`查看${student.name || '未命名学生'}的学习档案`"
            @click="openStudent(student.id)"
            @keydown.enter.prevent="openStudent(student.id)"
            @keydown.space.prevent="openStudent(student.id)"
          >
            <span class="student-cell">
              <el-avatar :size="38" :src="student.avatar">{{ initial(student.name) }}</el-avatar>
              <span class="student-identity"><strong>{{ student.name || '未命名学生' }}</strong><small>{{ student.grade || student.class || '暂无年级信息' }}</small></span>
            </span>
            <span class="metric-cell"><small>作业记录</small><strong>{{ student.taskCount }}</strong><em>份</em></span>
            <span class="metric-cell" :class="{ danger: student.wrongCount > 0 }"><small>未掌握错题</small><strong>{{ student.wrongCount }}</strong><em>道</em></span>
            <span class="metric-cell" :class="{ warning: student.retryCount > 0 }"><small>待重练</small><strong>{{ student.retryCount }}</strong><em>份</em></span>
            <span class="status-cell"><StatusTag :label="student.status" :tone="student.statusTone" /></span>
            <span class="row-action" @click.stop>
              <el-dropdown trigger="click" placement="bottom-end" @command="command => handleRowCommand(command, student)">
                <el-button text class="row-more" :aria-label="`${student.name || '学生'}的更多操作`" @keydown.enter.stop @keydown.space.stop><el-icon><MoreFilled /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="open">查看档案</el-dropdown-item>
                    <el-dropdown-item v-if="student.paused" command="resume">恢复在读</el-dropdown-item>
                    <el-dropdown-item v-else command="pause">标记停课</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </div>
        </div>

        <EmptyState v-else :icon="User" :title="emptyTitle" :description="emptyDescription">
          <template v-if="hasActiveFilters" #actions><ActionButton @click="resetFilters">清除筛选</ActionButton></template>
        </EmptyState>
      </ContentCard>
    </div>

    <el-dialog v-model="createDialogVisible" title="添加学生" width="420px" destroy-on-close @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top" @submit.prevent="submitCreateStudent">
        <el-form-item label="学生姓名" prop="name">
          <el-input v-model="createForm.name" maxlength="30" show-word-limit placeholder="请输入学生姓名" @keyup.enter="submitCreateStudent" />
        </el-form-item>
        <el-form-item label="年级" prop="grade">
          <el-input v-model="createForm.grade" maxlength="30" placeholder="例如：五年级（选填）" @keyup.enter="submitCreateStudent" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreateStudent">添加学生</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MoreFilled, Search, User } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { createStudent, getStudents, getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent, updateStudent } from '../../services/apiService'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatsCard from '../components/ui/StatsCard.vue'
import StatusTag from '../components/ui/StatusTag.vue'

const router = useRouter()
const students = ref([])
const loading = ref(true)
const search = ref('')
const activeFilter = ref('active')
const createDialogVisible = ref(false)
const creating = ref(false)
const createFormRef = ref()
const createForm = ref({ name: '', grade: '' })
const createRules = {
  name: [
    { required: true, message: '请输入学生姓名', trigger: 'blur' },
    { min: 1, max: 30, message: '学生姓名长度应为 1-30 个字符', trigger: 'blur' }
  ]
}

const enrichedStudents = computed(() => students.value.map(student => {
  const wrongCount = student.wrongCount || 0
  const retryCount = student.retryCount || 0
  const taskCount = student.taskCount || 0
  const paused = student.enrollment_status === 'paused'
  const hasRisk = !paused && (wrongCount > 0 || retryCount > 0)
  return {
    ...student,
    wrongCount,
    retryCount,
    taskCount,
    paused,
    hasRisk,
    status: paused ? '已停课' : hasRisk ? '需关注' : '正常',
    statusTone: paused ? 'default' : hasRisk ? 'warning' : 'success'
  }
}))
const activeStudents = computed(() => enrichedStudents.value.filter(student => !student.paused))
const summary = computed(() => ({
  active: activeStudents.value.length,
  paused: enrichedStudents.value.filter(student => student.paused).length,
  risk: activeStudents.value.filter(student => student.hasRisk).length,
  withRetry: activeStudents.value.filter(student => student.retryCount > 0).length
}))
const filters = computed(() => [
  { key: 'active', label: '在读', count: summary.value.active },
  { key: 'risk', label: '需关注', count: summary.value.risk },
  { key: 'paused', label: '已停课', count: summary.value.paused }
])
const filteredStudents = computed(() => enrichedStudents.value.filter(student => {
  const matchesSearch = !search.value || (student.name || '').toLowerCase().includes(search.value.toLowerCase())
  const matchesFilter = activeFilter.value === 'paused'
    ? student.paused
    : activeFilter.value === 'risk'
      ? student.hasRisk
      : !student.paused
  return matchesSearch && matchesFilter
}))
const hasActiveFilters = computed(() => Boolean(search.value) || activeFilter.value !== 'active')
const emptyTitle = computed(() => {
  if (search.value) return '没有找到匹配的学生'
  if (activeFilter.value === 'paused') return '没有停课的学生'
  if (activeFilter.value === 'risk') return '在读学生都没有待处理的错题'
  return '还没有在读学生'
})
const emptyDescription = computed(() => {
  if (search.value) return '换个姓名试试，或切换到其他状态查看。'
  if (activeFilter.value === 'paused') return '停课的学生会出现在这里，学习记录一直保留。'
  if (activeFilter.value === 'risk') return '有新错题或待重练的学生会自动出现在这里。'
  return '添加学生后，作业批改产生的错题和重练记录都会归到他的档案里。'
})
const initial = name => (name || '?').slice(0, 1)
const openStudent = id => router.push(`/students/${id}`)
const resetFilters = () => { search.value = ''; activeFilter.value = 'active' }
const openCreateDialog = () => { createDialogVisible.value = true }
const resetCreateForm = () => {
  createForm.value = { name: '', grade: '' }
  createFormRef.value?.clearValidate()
}

const handleRowCommand = async (command, student) => {
  if (command === 'open') return openStudent(student.id)
  if (command === 'resume') return setEnrollment(student, 'active')
  if (command === 'pause') {
    try {
      await ElMessageBox.confirm(
        `停课后 ${student.name || '该学生'} 不再计入在读人数，作业和错题记录全部保留；续费后可随时恢复在读。`,
        '标记停课',
        { confirmButtonText: '确认停课', cancelButtonText: '取消', type: 'warning' }
      )
    } catch { return }
    return setEnrollment(student, 'paused')
  }
}

const setEnrollment = async (student, enrollmentStatus) => {
  const previous = student.enrollment_status
  const index = students.value.findIndex(item => item.id === student.id)
  if (index >= 0) students.value[index] = { ...students.value[index], enrollment_status: enrollmentStatus }
  try {
    await updateStudent(student.id, { enrollmentStatus })
    ElMessage.success(enrollmentStatus === 'paused' ? '已标记停课' : '已恢复在读')
  } catch (error) {
    if (index >= 0) students.value[index] = { ...students.value[index], enrollment_status: previous }
    ElMessage.error(error.message || '状态更新失败，请稍后重试')
  }
}
const submitCreateStudent = async () => {
  if (creating.value) return
  const valid = await createFormRef.value?.validate().catch(() => false)
  if (!valid) return

  creating.value = true
  try {
    await createStudent({
      name: createForm.value.name.trim(),
      grade: createForm.value.grade.trim()
    })
    createDialogVisible.value = false
    ElMessage.success('学生添加成功')
    await loadStudents()
  } catch (error) {
    ElMessage.error(error.message || '学生添加失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

const loadStudents = async () => {
  loading.value = true
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
    ElMessage.error(error.message || '学生列表加载失败，请刷新重试')
  } finally {
    loading.value = false
  }
}

onMounted(loadStudents)
</script>

<style scoped>
.students-page { overflow-y: auto; }
.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
.header-count { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; color: var(--wb-primary); font-size: 11px; font-weight: 600; background: var(--wb-primary-soft); border-radius: 6px; }
.result-label { color: var(--wb-text-tertiary); font-size: 12px; }
.ds-filter-bar strong { color: var(--wb-text); font-size: 12px; white-space: nowrap; }
.student-search { width: 230px; }
.filter-tabs { display: flex; align-items: center; gap: 4px; }
.filter-tabs button { height: 32px; padding: 0 10px; color: var(--wb-text-secondary); font-size: 12px; background: transparent; border: 0; border-radius: 7px; cursor: pointer; }
.filter-tabs button:hover { color: var(--wb-text); background: var(--wb-bg-hover); }
.filter-tabs button.active { color: var(--wb-primary); font-weight: 600; background: var(--wb-primary-soft); }
.filter-tabs span { margin-left: 5px; color: var(--wb-text-tertiary); font-size: 10px; }
.student-workspace { margin-top: 16px; overflow: hidden; }
.table-head, .student-row { display: grid; grid-template-columns: minmax(250px, 1.5fr) minmax(100px, .65fr) minmax(110px, .7fr) minmax(100px, .65fr) minmax(100px, .65fr) 44px; align-items: center; gap: 16px; padding: 0 20px; }
.table-head { min-height: 40px; color: var(--wb-text-tertiary); font-size: 11px; background: var(--wb-bg-elevated); border-bottom: 1px solid var(--wb-border-light); }
.student-row { width: 100%; min-height: 72px; box-sizing: border-box; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--wb-border-light); cursor: pointer; transition: background-color .16s ease; }
.student-row:last-child { border-bottom: 0; }
.student-row:hover { background: var(--wb-bg-hover); }
.student-row:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--wb-primary); outline-offset: -2px; }
.student-row.is-paused .student-identity strong, .student-row.is-paused .metric-cell strong { color: var(--wb-text-tertiary); }
.student-row.is-paused :deep(.el-avatar) { color: var(--wb-text-tertiary); background: var(--wb-bg-elevated); }
.student-row.is-paused .metric-cell.danger strong, .student-row.is-paused .metric-cell.warning strong { color: var(--wb-text-tertiary); }
.student-cell { display: flex; align-items: center; min-width: 0; gap: 12px; }
.student-cell :deep(.el-avatar) { flex: 0 0 auto; color: var(--wb-primary); font-weight: 650; background: var(--wb-primary-soft); }
.student-identity { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
.student-identity strong { overflow: hidden; color: var(--wb-text); font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.student-identity small { color: var(--wb-text-tertiary); font-size: 11px; }
.metric-cell { color: var(--wb-text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.metric-cell small { display: none; }
.metric-cell strong { color: var(--wb-text); font-size: 14px; font-weight: 650; }
.metric-cell em { margin-left: 3px; color: var(--wb-text-tertiary); font-size: 10px; font-style: normal; }
.metric-cell.danger strong { color: var(--wb-danger); }
.metric-cell.warning strong { color: var(--wb-warning); }
.status-cell { display: flex; align-items: center; }
.row-action { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; color: var(--wb-text-tertiary); font-size: 11px; white-space: nowrap; }
.row-more { min-height: 28px; padding: 0 6px; color: var(--wb-text-tertiary); opacity: 0; transition: opacity .16s ease; }
.student-row:hover .row-more, .student-row:focus-within .row-more { opacity: 1; }
.row-more:hover { color: var(--wb-primary); }
.skeleton-row { padding: 17px 20px; border-bottom: 1px solid var(--wb-border-light); }
.skeleton-row:last-child { border-bottom: 0; }
.skeleton-content { display: grid; grid-template-columns: 38px minmax(160px, 1.5fr) repeat(3, minmax(80px, .65fr)) 44px; align-items: center; gap: 16px; }
.skeleton-avatar { width: 38px; height: 38px; }
.skeleton-name { width: 50%; }
.skeleton-metric { width: 38px; }
.skeleton-status { width: 64px; height: 24px; }
@media (max-width: 1000px) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .table-head { display: none; } .student-row { grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(72px, auto)) auto 40px; gap: 12px; padding: 14px 16px; } .row-more { opacity: 1; } .metric-cell small { display: block; margin-bottom: 5px; color: var(--wb-text-tertiary); font-size: 10px; } }
@media (max-width: 720px) { .stats-grid { grid-template-columns: 1fr 1fr; } .student-search { width: 100%; } .filter-tabs { overflow-x: auto; width: 100%; } .filter-tabs button { flex: 0 0 auto; } .student-row { grid-template-columns: 1fr repeat(3, auto) 40px; } .status-cell { grid-column: 1 / -1; padding-left: 50px; } }
@media (max-width: 520px) { .stats-grid { grid-template-columns: 1fr; } .student-row { grid-template-columns: 1fr auto auto 40px; } .metric-cell:nth-of-type(2) { display: none; } }
</style>