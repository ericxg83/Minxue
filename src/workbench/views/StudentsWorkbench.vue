<template>
  <div class="wb-page">
    <a class="skip-link" href="#student-main">跳到学生列表</a>
    <div class="wb-page__inner">
      <PageHeader eyebrow="学生学习 / 学生档案" title="学生档案" description="按学生查看学习状态，进入档案可看学情、错题、重练并安排下一步。">
        <template #actions><ActionButton variant="primary" @click="openCreateDialog">添加学生</ActionButton></template>
      </PageHeader>

      <KpiStrip aria-label="学生状态概览" :items="kpiItems" />

      <FilterBar>
        <template #leading><span class="result-label">当前显示</span><strong>{{ filteredStudents.length }} 名学生</strong></template>
        <WorkbenchInput
          v-model="search"
          clearable
          placeholder="搜索学生姓名"
          width="230px"
          aria-label="按学生姓名搜索"
          @input="syncQuery"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </WorkbenchInput>
        <div class="filter-tabs" role="tablist" aria-label="学生状态筛选">
          <button
            v-for="filter in filters"
            :key="filter.key"
            type="button"
            role="tab"
            :class="{ active: activeFilter === filter.key }"
            :aria-selected="activeFilter === filter.key"
            @click="setFilter(filter.key)"
          >
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

        <div v-else-if="loadError" class="error-state" role="alert">
          <el-icon><WarningFilled /></el-icon>
          <strong>读不到学生列表</strong>
          <span>{{ loadError }}</span>
          <div class="error-state__actions">
            <ActionButton @click="loadStudents">重新加载</ActionButton>
          </div>
        </div>

        <div
          v-else-if="filteredStudents.length"
          class="student-table"
          role="table"
          aria-label="学生学习状态"
        >
          <div role="rowgroup">
            <div role="row" class="table-head" aria-hidden="true">
              <div role="columnheader">学生</div>
              <div role="columnheader">作业记录</div>
              <div role="columnheader">未掌握错题</div>
              <div role="columnheader">待重练</div>
              <div role="columnheader">当前状态</div>
              <div role="columnheader" class="op-col"><span class="sr-only">操作</span></div>
            </div>
          </div>
          <div role="rowgroup" class="student-rowgroup">
            <div
              v-for="student in filteredStudents"
              :key="student.id"
              role="row"
              tabindex="0"
              :class="['student-row', { 'is-paused': student.paused }]"
              :aria-label="`查看${student.name || '未命名学生'}的学习档案，${student.taskCount} 份作业，${student.wrongCount} 道未掌握错题，${student.retryCount} 份待重练，状态${student.status}`"
              @click="openStudent(student.id)"
              @keydown.enter.prevent="openStudent(student.id)"
              @keydown.space.prevent="openStudent(student.id)"
            >
              <div role="cell" class="student-cell">
                <el-avatar :size="38" :src="student.avatar">{{ initial(student.name) }}</el-avatar>
                <span class="student-identity"><strong>{{ student.name || '未命名学生' }}</strong><small>{{ student.grade || student.class || '暂无年级信息' }}</small></span>
              </div>
              <div role="cell" class="metric-cell"><small>作业记录</small><strong>{{ student.taskCount }}</strong><em>份</em></div>
              <div role="cell" class="metric-cell" :class="{ danger: student.wrongCount > 0 }"><small>未掌握错题</small><strong>{{ student.wrongCount }}</strong><em>道</em></div>
              <div role="cell" class="metric-cell" :class="{ warning: student.retryCount > 0 }"><small>待重练</small><strong>{{ student.retryCount }}</strong><em>份</em></div>
              <div role="cell" class="status-cell"><StatusTag :label="student.status" :tone="student.statusTone" /></div>
              <div role="cell" class="row-action" @click.stop>
                <el-dropdown trigger="click" placement="bottom-end" @command="command => handleRowCommand(command, student)">
                  <ActionButton
                    variant="ghost"
                    class="row-more"
                    :aria-label="`${student.name || '学生'}的更多操作`"
                    :icon-only="true"
                    @keydown.enter.stop
                    @keydown.space.stop
                  >
                    <el-icon><MoreFilled /></el-icon>
                  </ActionButton>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="open">查看档案</el-dropdown-item>
                      <el-dropdown-item v-if="student.paused" command="resume">恢复在读</el-dropdown-item>
                      <el-dropdown-item v-else command="pause">标记停课</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </div>
        </div>

        <EmptyState v-else :icon="User" :title="emptyTitle" :description="emptyDescription">
          <template v-if="hasActiveFilters" #actions><ActionButton @click="resetFilters">清除筛选</ActionButton></template>
        </EmptyState>
      </ContentCard>
    </div>

    <WorkbenchDialog v-model="createDialogVisible" title="添加学生" :loading="creating" @closed="resetCreateForm">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top" @submit.prevent="submitCreateStudent">
        <el-form-item label="学生姓名" prop="name">
          <WorkbenchInput v-model="createForm.name" :maxlength="30" show-word-limit placeholder="请输入学生姓名" aria-label="学生姓名" @keyup.enter="submitCreateStudent" />
        </el-form-item>
        <el-form-item label="年级" prop="grade">
          <WorkbenchInput v-model="createForm.grade" :maxlength="30" placeholder="例如：五年级（选填）" aria-label="年级" @keyup.enter="submitCreateStudent" />
        </el-form-item>
      </el-form>
      <template #footer>
        <ActionButton variant="ghost" @click="createDialogVisible = false">取消</ActionButton>
        <ActionButton variant="primary" :loading="creating" @click="submitCreateStudent">添加学生</ActionButton>
      </template>
    </WorkbenchDialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MoreFilled, Search, User, WarningFilled } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { createStudent, getStudents, getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent, updateStudent } from '../../services/apiService'
import { humanizeError } from '../utils/humanizeError'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import KpiStrip from '../components/ui/KpiStrip.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchDialog from '../components/ui/WorkbenchDialog.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'

const route = useRoute()
const router = useRouter()
const students = ref([])
const loading = ref(true)
const loadError = ref('')
const search = ref(route.query.q || '')
const activeFilter = ref(['active', 'risk', 'retry', 'paused'].includes(route.query.filter) ? route.query.filter : 'active')
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
    statusTone: paused ? 'neutral' : hasRisk ? 'warning' : 'success'
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
  { key: 'retry', label: '待重练', count: summary.value.withRetry },
  { key: 'paused', label: '已停课', count: summary.value.paused }
])
const filteredStudents = computed(() => enrichedStudents.value.filter(student => {
  const matchesSearch = !search.value || (student.name || '').toLowerCase().includes(search.value.toLowerCase())
  let matchesFilter
  if (activeFilter.value === 'paused') matchesFilter = student.paused
  else if (activeFilter.value === 'risk') matchesFilter = student.hasRisk
  else if (activeFilter.value === 'retry') matchesFilter = !student.paused && student.retryCount > 0
  else matchesFilter = !student.paused
  return matchesSearch && matchesFilter
}))
const hasActiveFilters = computed(() => Boolean(search.value) || activeFilter.value !== 'active')
const emptyTitle = computed(() => {
  if (search.value) return '没有找到匹配的学生'
  if (activeFilter.value === 'paused') return '没有停课的学生'
  if (activeFilter.value === 'retry') return '在读学生都没有待重练的卷子'
  if (activeFilter.value === 'risk') return '在读学生都没有待处理的错题'
  return '还没有在读学生'
})
const emptyDescription = computed(() => {
  if (search.value) return '换个姓名试试，或切换到其他状态查看。'
  if (activeFilter.value === 'paused') return '停课的学生会出现在这里，学习记录一直保留。'
  if (activeFilter.value === 'retry') return '有未批改重练卷的学生会自动出现在这里。'
  if (activeFilter.value === 'risk') return '有新错题或待重练的学生会自动出现在这里。'
  return '添加学生后，作业批改产生的错题和重练记录都会归到他的档案里。'
})

const kpiItems = computed(() => [
  {
    key: 'active',
    value: summary.value.active,
    unit: '人',
    label: '在读学生',
    tone: 'primary',
    actionLabel: '看在读',
    actionIcon: undefined,
    onClick: () => setFilter('active')
  },
  {
    key: 'risk',
    value: summary.value.risk,
    unit: '人',
    label: '需关注',
    tone: summary.value.risk ? 'warning' : 'default',
    actionLabel: '看需关注',
    actionIcon: undefined,
    onClick: () => setFilter('risk')
  },
  {
    key: 'withRetry',
    value: summary.value.withRetry,
    unit: '人',
    label: '待重练',
    tone: summary.value.withRetry ? 'danger' : 'default',
    actionLabel: '看待重练',
    actionIcon: undefined,
    onClick: () => setFilter('retry')
  },
  {
    key: 'paused',
    value: summary.value.paused,
    unit: '人',
    label: '已停课',
    actionLabel: '看已停课',
    actionIcon: undefined,
    onClick: () => setFilter('paused')
  }
])

const initial = name => (name || '?').slice(0, 1)
const openStudent = id => router.push(`/students/${id}`)
const setFilter = key => {
  activeFilter.value = key
  syncQuery()
}
const resetFilters = () => {
  search.value = ''
  activeFilter.value = 'active'
  syncQuery()
}

function syncQuery() {
  const query = {}
  if (search.value) query.q = search.value
  if (activeFilter.value !== 'active') query.filter = activeFilter.value
  router.replace({ path: '/students', query })
}

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
    await updateStudent(student.id, { enrollment_status: enrollmentStatus })
    ElMessage.success(enrollmentStatus === 'paused' ? '已标记停课' : '已恢复在读')
  } catch (error) {
    if (index >= 0) students.value[index] = { ...students.value[index], enrollment_status: previous }
    ElMessage.error(humanizeError(error?.message, { entity: '学生列表' }) || '状态更新失败，请稍后重试')
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
    ElMessage.error(humanizeError(error?.message, { entity: '学生列表' }) || '学生添加失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

const loadStudents = async () => {
  loading.value = true
  loadError.value = ''
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
      return {
        ...student,
        taskCount: Array.isArray(tasks) ? tasks.length : 0,
        wrongCount: wrongList.filter(item => item.lifecycle_status !== 'mastered').length,
        retryCount: examList.filter(item => !['graded', 'completed'].includes(item.status)).length
      }
    }))
  } catch (error) {
    students.value = []
    loadError.value = humanizeError(error?.message, { entity: '学生列表' })
  } finally {
    loading.value = false
  }
}

watch(() => route.query, q => {
  const nextQ = q.q || ''
  const nextFilter = ['active', 'risk', 'retry', 'paused'].includes(q.filter) ? q.filter : 'active'
  if (nextQ !== search.value) search.value = nextQ
  if (nextFilter !== activeFilter.value) activeFilter.value = nextFilter
})

onMounted(loadStudents)
</script>

<style scoped>
.skip-link {
  position: absolute;
  top: -40px;
  left: 16px;
  z-index: 100;
  padding: 8px 12px;
  background: var(--wb-primary);
  color: var(--wb-text-inverse);
  border-radius: var(--wb-radius-sm);
  text-decoration: none;
  transition: top var(--wb-motion-fast) var(--wb-motion-ease);
}
.skip-link:focus { top: 8px; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.result-label { color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); }
.ds-filter-bar strong { color: var(--wb-text); font-size: var(--wb-fs-meta); white-space: nowrap; }
.student-search { width: 230px; }

.filter-tabs { display: flex; align-items: center; gap: 4px; }
.filter-tabs button {
  height: 28px;
  padding: 0 var(--wb-space-2);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  background: transparent;
  border: 0;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
}
.filter-tabs button:hover { color: var(--wb-text); background: var(--wb-bg-hover); }
.filter-tabs button.active {
  color: var(--wb-primary);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-primary-soft);
}
.filter-tabs span {
  margin-left: var(--wb-space-1);
  color: var(--wb-text-secondary);
  font-size: 10px;
}

.student-workspace { margin-top: var(--wb-space-4); overflow: hidden; }

.student-table { display: block; }
.table-head, .student-row {
  display: grid;
  grid-template-columns: minmax(250px, 1.5fr) minmax(100px, .65fr) minmax(110px, .7fr) minmax(100px, .65fr) minmax(100px, .65fr) 44px;
  align-items: center;
  gap: var(--wb-space-4);
  padding: 0 20px;
}
.table-head {
  min-height: 40px;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-eyebrow);
  background: var(--wb-bg-elevated);
  border-bottom: 1px solid var(--wb-border-light);
  font-weight: var(--wb-fw-semibold);
  letter-spacing: 0.01em;
}
.student-row {
  width: 100%;
  min-height: 76px;
  box-sizing: border-box;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--wb-border-light);
  cursor: pointer;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.student-row:last-child { border-bottom: 0; }
.student-row:hover { background: var(--wb-bg-hover); }
.student-row:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--wb-primary);
  outline-offset: -2px;
}
.student-row.is-paused .student-identity strong,
.student-row.is-paused .metric-cell strong { color: var(--wb-text-tertiary); }
.student-row.is-paused :deep(.el-avatar) {
  color: var(--wb-text-tertiary);
  background: var(--wb-bg-elevated);
}
.student-row.is-paused .metric-cell.danger strong,
.student-row.is-paused .metric-cell.warning strong { color: var(--wb-text-tertiary); }

.student-cell { display: flex; align-items: center; min-width: 0; gap: 12px; }
.student-cell :deep(.el-avatar) {
  flex: 0 0 auto;
  color: var(--wb-primary);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-primary-soft);
}
.student-identity { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
.student-identity strong {
  overflow: hidden;
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.student-identity small { color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); }

.metric-cell {
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  font-variant-numeric: tabular-nums;
}
.metric-cell small { display: none; }
.metric-cell strong { color: var(--wb-text); font-size: var(--wb-fs-body); font-weight: var(--wb-fw-semibold); }
.metric-cell em { margin-left: 3px; color: var(--wb-text-tertiary); font-size: 10px; font-style: normal; }
.metric-cell.danger strong { color: var(--wb-danger); }
.metric-cell.warning strong { color: var(--wb-warning); }

.status-cell { display: flex; align-items: center; }
.row-action { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
.row-more { color: var(--wb-text-secondary); }

.skeleton-row { padding: var(--wb-space-4) 20px; border-bottom: 1px solid var(--wb-border-light); }
.skeleton-row:last-child { border-bottom: 0; }
.skeleton-content {
  display: grid;
  grid-template-columns: 38px minmax(160px, 1.5fr) repeat(3, minmax(80px, .65fr)) 44px;
  align-items: center;
  gap: var(--wb-space-4);
}
.skeleton-avatar { width: 38px; height: 38px; }
.skeleton-name { width: 50%; }
.skeleton-metric { width: 38px; }
.skeleton-status { width: 64px; height: 24px; }

.error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
  padding: 32px;
  box-sizing: border-box;
  flex-direction: column;
  gap: var(--wb-space-2);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  text-align: center;
}
.error-state > .el-icon { color: var(--wb-danger); font-size: 30px; }
.error-state strong { color: var(--wb-text); font-size: var(--wb-fs-body); }
.error-state__actions { display: flex; gap: var(--wb-space-2); margin-top: var(--wb-space-2); }

@media (min-width: 1521px) {
  .student-workspace :deep(.ds-content-card) { max-width: none; }
}
@media (max-width: 1000px) {
  .table-head { display: none; }
  .student-row {
    grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(72px, auto)) auto 40px;
    gap: var(--wb-space-3);
    padding: 14px 16px;
  }
  .metric-cell small {
    display: block;
    margin-bottom: 5px;
    color: var(--wb-text-secondary);
    font-size: 10px;
  }
}
@media (max-width: 720px) {
  .student-search { width: 100%; }
  .filter-tabs { overflow-x: auto; width: 100%; }
  .filter-tabs button { flex: 0 0 auto; }
  .student-row { grid-template-columns: 1fr repeat(3, auto) 40px; }
  .status-cell { grid-column: 1 / -1; padding-left: 50px; }
}
@media (max-width: 520px) {
  .student-row { grid-template-columns: 1fr auto auto 40px; }
  .metric-cell:nth-of-type(2) { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .student-row, .row-more, .skip-link, .filter-tabs button { transition: none !important; }
  .el-skeleton.is-animated .el-skeleton__item { animation: none !important; }
}
</style>
