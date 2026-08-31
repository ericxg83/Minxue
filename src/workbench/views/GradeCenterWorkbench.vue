<template>
  <div class="grade-center wb-page wb-page--workspace">
    <a class="skip-link" href="#grade-main">跳到任务列表</a>
    <div class="wb-page__inner grade-workbench">
      <PageHeader
        eyebrow="教学工作 / 批改中心"
        title="作业批改"
        description="集中处理学生作业与错题重练"
      >
        <template #actions>
          <ActionButton :loading="loading" @click="loadData">
            <el-icon><Refresh /></el-icon>刷新
          </ActionButton>
        </template>
      </PageHeader>

      <!-- 本页任务分布：4 chip 轻量表达，点击切换 statusFilter（替代原 KpiStrip 4 KPI 行） -->
      <nav class="task-distribution" aria-label="本页任务分布">
        <button
          v-for="chip in taskDistribution"
          :key="chip.key"
          type="button"
          :class="['task-distribution__chip', `is-${chip.tone}`, { 'is-active': chip.active }]"
          :aria-pressed="chip.active"
          @click="chip.action()"
        >
          <strong>{{ chip.count }}</strong>
          <span>{{ chip.label }}</span>
        </button>
      </nav>

      <FilterBar class="task-filters">
        <template #leading>
          <span class="queue-title">任务列表</span>
        </template>
        <WorkbenchSelect
          v-model="studentId"
          :options="students.map(s => ({ label: s.name, value: s.id }))"
          clearable
          placeholder="全部学生"
          width="160px"
          aria-label="按学生筛选"
          @change="syncQuery"
        />
        <div class="filter-group" role="group" aria-label="任务来源">
          <span class="filter-group__label">来源</span>
          <div class="segment-control" role="tablist">
            <button
              v-for="item in sourceTabs"
              :key="item.key"
              type="button"
              :class="{ active: sourceFilter === item.key }"
              :aria-selected="sourceFilter === item.key"
              @click="sourceFilter = item.key"
            >
              {{ item.label }}<span>{{ item.count }}</span>
            </button>
          </div>
        </div>
        <div class="filter-group" role="group" aria-label="任务状态">
          <span class="filter-group__label">状态</span>
          <div class="segment-control" role="tablist">
            <button
              v-for="item in statusTabs"
              :key="item.key"
              type="button"
              :class="{ active: statusFilter === item.key }"
              :aria-selected="statusFilter === item.key"
              @click="statusFilter = item.key"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <template #actions>
          <ActionButton
            v-if="hasNonDefaultFilter"
            variant="ghost"
            @click="clearFilters"
          >
            清除筛选
          </ActionButton>
        </template>
      </FilterBar>

      <section id="grade-main" class="workspace-grid" aria-label="批改任务工作区">
        <ContentCard class="task-queue" title="任务列表" description="按优先级排列，整行点击查看，进度用 Enter 打开" flush>
          <div v-if="loading" class="loading-state" role="status" aria-live="polite">
            <el-icon class="is-loading"><Loading /></el-icon>
            <strong>正在同步 AI 批改任务</strong>
            <span>正在读取学生作业与重练记录</span>
          </div>
          <div v-else-if="loadError" class="error-state" role="alert">
            <el-icon><WarningFilled /></el-icon>
            <strong>读不到任务列表</strong>
            <span>{{ loadError }}</span>
            <div class="error-state__actions">
              <ActionButton @click="loadData">重新加载</ActionButton>
              <ActionButton variant="ghost" @click="clearFilters">清除筛选重试</ActionButton>
            </div>
          </div>
          <ul v-else-if="visibleTasks.length" class="task-list">
            <li
              v-for="task in visibleTasks"
              v-memo="[
                task.workflowStatus,
                task.wrongCount,
                task.statusLabel,
                selectedTask?.key === task.key
              ]"
              :key="task.key"
              :class="['task-item', { active: selectedTask?.key === task.key }]"
              tabindex="0"
              role="button"
              :aria-pressed="selectedTask?.key === task.key"
              :aria-label="`${task.studentName} · ${task.name} · ${task.statusLabel}，按 Enter 进入批改`"
              :data-task-key="task.key"
              @click="selectTask(task)"
              @keydown.enter.prevent="openTask(task)"
              @keydown.space.prevent="openTask(task)"
              @keydown.up.prevent="focusTaskPrev(task)"
              @keydown.down.prevent="focusTaskNext(task)"
            >
              <el-avatar :size="38" :src="task.studentAvatar">{{ task.studentName.slice(0, 1) }}</el-avatar>
              <div class="task-copy">
                <div class="task-primary">
                  <strong>{{ task.studentName }}</strong>
                  <span class="task-type">{{ task.sourceLabel }}</span>
                </div>
                <div class="task-name">{{ task.name }}</div>
                <div class="task-meta">
                  <time>{{ task.timeLabel }}</time>
                  <span>{{ task.questionCount }} 题</span>
                  <span v-if="task.pendingCount">{{ task.pendingCount }} 待处理</span>
                </div>
              </div>
              <div class="task-state">
                <StatusTag :tone="task.tone">{{ task.statusLabel }}</StatusTag>
              </div>
            </li>
          </ul>
          <EmptyState
            v-else
            :title="allTasks.length === 0 ? '还没有任何作业任务' : '当前筛选下没有任务'"
            :description="emptyDescription"
          >
            <template #actions>
              <ActionButton @click="clearFilters">清除筛选</ActionButton>
            </template>
          </EmptyState>
        </ContentCard>

        <ContentCard class="task-inspector" title="任务摘要" description="确认任务状态后进入批改工作区" flush>
          <template v-if="selectedTask">
            <div class="preview-content">
              <div class="preview-heading">
                <div>
                  <span class="preview-student">{{ selectedTask.studentName }}</span>
                  <h2>{{ selectedTask.name }}</h2>
                </div>
                <StatusTag :tone="selectedTask.tone">{{ selectedTask.statusLabel }}</StatusTag>
              </div>

              <div class="ai-flow" aria-label="AI 批改流程">
                <div
                  v-for="step in flowSteps(selectedTask)"
                  :key="step.label"
                  :class="['flow-step', `is-${step.state}`]"
                >
                  <span class="flow-dot">
                    <el-icon v-if="step.state === 'done'"><Check /></el-icon>
                  </span>
                  <div>
                    <strong>{{ step.label }}</strong>
                    <small>{{ step.note }}</small>
                  </div>
                </div>
              </div>

              <dl class="ds-mini-stat-grid preview-stats">
                <MiniStat label="题目" :value="selectedTask.questionCount" unit="题" />
                <MiniStat
                  label="错题"
                  :value="selectedTask.wrongCount"
                  unit="题"
                  :tone="selectedTask.wrongCount > 0 ? 'danger' : 'default'"
                  emphasis
                />
                <MiniStat label="处理状态" :value="selectedTask.aiStatusLabel" />
              </dl>

              <div class="preview-actions">
                <ActionButton variant="primary" @click="openTask(selectedTask)">
                  {{ selectedTask.actionLabel }}<el-icon><ArrowRight /></el-icon>
                </ActionButton>
              </div>
            </div>
          </template>
          <EmptyState
            v-else
            title="从左侧选一个任务开始批改"
            description="按优先级排列，先处理最上面的任务。"
            compact
          />
        </ContentCard>
      </section>

      <!-- B5：移动端 sticky Primary CTA · 仅 selectedTask 存在时渲染，PC 通过 CSS 隐藏 -->
      <div v-if="selectedTask" class="preview-sticky-cta">
        <ActionButton variant="primary" @click="openTask(selectedTask)">
          {{ selectedTask.actionLabel }}<el-icon><ArrowRight /></el-icon>
        </ActionButton>
      </div>

      <Transition name="toast">
        <div v-if="confirmToast" class="confirm-toast" role="status" aria-live="polite">
          <el-icon><Check /></el-icon>
          <span>{{ confirmToast }}</span>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Check, Loading, Refresh, WarningFilled } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import MiniStat from '../components/ui/MiniStat.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import { getGeneratedExamsByStudent, getStudents, getTasksByStudent } from '../../services/apiService'
import { humanizeError } from '../utils/humanizeError'

const route = useRoute()
const router = useRouter()
const students = ref([])
const allTasks = ref([])
const loading = ref(true)
const loadError = ref('')
const selectedTask = ref(null)
const confirmToast = ref('')
let toastTimer = null

const allowedSource = ['homework', 'retry']
const allowedStatus = ['active', 'failed', 'all', 'completed']
const studentId = ref(route.query.studentId || '')
const sourceFilter = ref(allowedSource.includes(route.query.source) ? route.query.source : 'all')
const statusFilter = ref(allowedStatus.includes(route.query.status) ? route.query.status : 'active')

const activeStatuses = new Set(['pending', 'processing', 'review', 'retry'])
const failedStatuses = new Set(['failed'])
const completedStatuses = new Set(['completed'])

const pendingCount = computed(() => allTasks.value.filter(item => activeStatuses.has(item.workflowStatus)).length)
const failedCount = computed(() => allTasks.value.filter(item => failedStatuses.has(item.workflowStatus)).length)
const retryPendingCount = computed(() => allTasks.value.filter(item => item.source === 'retry' && activeStatuses.has(item.workflowStatus)).length)
const weekCompletedCount = computed(() => {
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  weekStart.setHours(0, 0, 0, 0)
  return allTasks.value.filter(item => completedStatuses.has(item.workflowStatus) && new Date(item.createdAt || 0) >= weekStart).length
})

const visibleTasks = computed(() => allTasks.value.filter(item => {
  const sourceMatches = sourceFilter.value === 'all' || item.source === sourceFilter.value
  let statusMatches = true
  if (statusFilter.value === 'active') statusMatches = activeStatuses.has(item.workflowStatus)
  else if (statusFilter.value === 'failed') statusMatches = failedStatuses.has(item.workflowStatus)
  else if (statusFilter.value === 'completed') statusMatches = completedStatuses.has(item.workflowStatus)
  return sourceMatches && statusMatches
}))

const sourceTabs = computed(() => [
  { key: 'all', label: '全部', count: allTasks.value.length },
  { key: 'homework', label: '学生作业', count: allTasks.value.filter(item => item.source === 'homework').length },
  { key: 'retry', label: '错题重练', count: allTasks.value.filter(item => item.source === 'retry').length }
])
const statusTabs = [
  { key: 'active', label: '待处理' },
  { key: 'failed', label: '识别异常' },
  { key: 'all', label: '全部' },
  { key: 'completed', label: '已完成' }
]

// 本页任务分布：4 chip 点击切换 statusFilter（替代原 KpiStrip 4 KPI 行）
// 视觉比 KpiStrip 轻 50%：单行、1px border-light 框、active 用 primary-soft 背景
const taskDistribution = computed(() => [
  {
    key: 'pending',
    label: '待人工复核',
    count: pendingCount.value,
    tone: 'default',
    active: statusFilter.value === 'active' && sourceFilter.value === 'all',
    action: () => { statusFilter.value = 'active'; if (sourceFilter.value === 'retry') sourceFilter.value = 'all' }
  },
  {
    key: 'failed',
    label: '识别异常',
    count: failedCount.value,
    tone: 'danger',
    active: statusFilter.value === 'failed',
    action: () => { statusFilter.value = 'failed' }
  },
  {
    key: 'retry',
    label: '重练待验证',
    count: retryPendingCount.value,
    tone: 'warning',
    active: sourceFilter.value === 'retry' && statusFilter.value === 'active',
    action: () => { sourceFilter.value = 'retry'; statusFilter.value = 'active' }
  },
  {
    key: 'completed',
    label: '本周完成',
    count: weekCompletedCount.value,
    tone: 'success',
    active: statusFilter.value === 'completed',
    action: () => { statusFilter.value = 'completed' }
  }
])

const hasNonDefaultFilter = computed(() =>
  !!studentId.value || sourceFilter.value !== 'all' || statusFilter.value !== 'active'
)

const emptyDescription = computed(() =>
  allTasks.value.length === 0
    ? '新上传的作业和完成的重练任务会出现在这里。'
    : '当前筛选下没有匹配的任务，可以清除筛选查看更多。'
)

function clearFilters() {
  studentId.value = ''
  sourceFilter.value = 'all'
  statusFilter.value = 'active'
  syncQuery()
}

const formatTime = value => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '时间未知'
  const today = new Date()
  const isToday = parsed.toDateString() === today.toDateString()
  return isToday ? `今天 ${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}` : `${parsed.getMonth() + 1}月${parsed.getDate()}日`
}

const normalizeHomeworkStatus = status => {
  if (status === 'failed') return { workflowStatus: 'failed', statusLabel: '识别异常', tone: 'danger', aiStatusLabel: '识别异常' }
  if (status === 'reviewed') return { workflowStatus: 'completed', statusLabel: '已确认', tone: 'success', aiStatusLabel: '教师已确认' }
  if (status === 'done') return { workflowStatus: 'review', statusLabel: '待复核', tone: 'warning', aiStatusLabel: 'AI 已完成' }
  if (['pending', 'processing', 'queued'].includes(status)) return { workflowStatus: 'processing', statusLabel: 'AI 处理中', tone: 'processing', aiStatusLabel: '正在识别与判题' }
  return { workflowStatus: 'pending', statusLabel: '待处理', tone: 'warning', aiStatusLabel: '等待处理' }
}

const homework = (task, student) => {
  const state = normalizeHomeworkStatus(task.status)
  const questionCount = Number(task.question_count || task.total_questions || task.total_count || task.result?.questionCount || 0)
  return {
    ...state,
    key: `homework-${student.id}-${task.id}`,
    id: task.id,
    studentId: student.id,
    studentName: student.name,
    studentAvatar: student.avatar || '',
    source: 'homework',
    sourceLabel: '学生作业',
    name: task.original_name || '未命名作业',
    timeLabel: task.created_at ? formatTime(task.created_at) : '学生上传',
    createdAt: task.created_at,
    imageUrl: task.image_url || '',
    questionCount,
    pendingCount: state.workflowStatus === 'completed' ? 0 : questionCount,
    wrongCount: Number(task.result?.wrongCount || task.wrong_count || 0),
    actionLabel: state.workflowStatus === 'completed' ? '查看结果' : state.workflowStatus === 'processing' ? '查看进度' : '进入复核'
  }
}

const retry = (task, student) => {
  const completed = task.status === 'graded'
  const questionCount = Number(task.total_count || task.question_ids?.length || 0)
  return {
    key: `retry-${student.id}-${task.id}`,
    id: task.id,
    studentId: student.id,
    studentName: student.name,
    studentAvatar: student.avatar || '',
    source: 'retry',
    sourceLabel: '错题重练',
    name: task.name || '未命名重练',
    timeLabel: task.created_at ? formatTime(task.created_at) : '来自错题池',
    createdAt: task.created_at,
    imageUrl: '',
    questionCount,
    pendingCount: completed ? 0 : questionCount,
    wrongCount: Number(task.wrong_count || 0),
    workflowStatus: completed ? 'completed' : 'retry',
    statusLabel: completed ? '已确认' : '待重练',
    tone: completed ? 'success' : 'warning',
    aiStatusLabel: completed ? '验证已完成' : '等待教师验证',
    actionLabel: completed ? '查看结果' : '开始验证'
  }
}

const priority = { failed: 0, review: 1, retry: 2, pending: 3, processing: 4, completed: 5 }

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await getStudents(false)
    students.value = response.data || response || []
    const targets = studentId.value
      ? students.value.filter(student => String(student.id) === String(studentId.value))
      : students.value
    const lists = await Promise.all(targets.map(async student => {
      const [tasks, exams] = await Promise.all([
        getTasksByStudent(student.id, false).catch(() => []),
        getGeneratedExamsByStudent(student.id, false).catch(() => [])
      ])
      return [
        ...(tasks || []).map(task => homework(task, student)),
        ...(exams || []).map(task => retry(task, student))
      ]
    }))
    allTasks.value = lists.flat().sort((left, right) => {
      const statusOrder = priority[left.workflowStatus] - priority[right.workflowStatus]
      if (statusOrder) return statusOrder
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0)
    })
  } catch (error) {
    loadError.value = humanizeError(error?.message, { entity: '任务列表' })
    allTasks.value = []
  } finally {
    loading.value = false
  }
}

function syncQuery() {
  const query = {}
  if (studentId.value) query.studentId = studentId.value
  if (sourceFilter.value !== 'all') query.source = sourceFilter.value
  if (statusFilter.value !== 'active') query.status = statusFilter.value
  router.replace({ path: '/grade', query })
  loadData()
}

function selectTask(task) {
  selectedTask.value = task
}

function openTask(task) {
  if (task) {
    selectedTask.value = task
    showToast(`已${task.actionLabel}`)
  }
  if (task) {
    router.push({ path: '/grade/task', query: { studentId: task.studentId, taskId: task.id, source: task.source } })
  }
}

function showToast(message) {
  confirmToast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { confirmToast.value = '' }, 800)
}

function focusTaskRelative(task, dir) {
  const idx = visibleTasks.value.findIndex(t => t.key === task.key)
  if (idx < 0) return
  const next = visibleTasks.value[idx + dir]
  if (next) {
    nextTick(() => {
      const el = document.querySelector(`[data-task-key="${next.key}"]`)
      el && el.focus()
    })
  }
}

function focusTaskPrev(task) { focusTaskRelative(task, -1) }
function focusTaskNext(task) { focusTaskRelative(task, 1) }

function flowSteps(task) {
  const processing = task.workflowStatus === 'processing'
  const failed = task.workflowStatus === 'failed'
  const awaitingReview = ['review', 'retry', 'pending'].includes(task.workflowStatus)
  const completed = task.workflowStatus === 'completed'
  return [
    { label: '上传完成', note: task.timeLabel, state: 'done' },
    {
      label: 'AI 识别与判题',
      note: failed ? '处理出现异常' : processing ? '正在进行' : '已生成结果',
      state: failed ? 'error' : processing ? 'active' : 'done'
    },
    {
      label: task.source === 'retry' ? '重练验证' : '教师复核',
      note: completed ? '已确认' : awaitingReview ? '等待处理' : '尚未开始',
      state: completed ? 'done' : awaitingReview ? 'active' : 'pending'
    }
  ]
}

watch(visibleTasks, tasks => {
  if (!tasks.some(task => task.key === selectedTask.value?.key)) {
    selectedTask.value = tasks[0] || null
  }
}, { immediate: true })

watch([sourceFilter, statusFilter, studentId], () => {
  if (!loading.value) syncQuery()
})

onMounted(loadData)
</script>

<style scoped>
.grade-workbench { display: flex; min-height: 100%; flex-direction: column; }

/* ── 本页任务分布 chip row（替代原 KpiStrip 4 KPI 行） ──
   视觉比 KpiStrip 轻 50%：单行 + 1px border-light 框 + 36px min-height，
   active 用 primary-soft 背景，跟 Element Plus 按钮语言一致。
   chip 行高 36px 是 task-distribution 的项目级约定。 */
.task-distribution {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--wb-space-2);
  margin-bottom: var(--wb-space-3);
}

.task-distribution__chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--wb-space-2);
  /* min-height 36px 是 task-distribution chip 的项目级约定，区别于 --wb-row-min-height: 56px 的 list row。 */
  min-height: 36px;
  padding: var(--wb-space-2) var(--wb-space-3);
  color: var(--wb-text-secondary);
  font: inherit;
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  cursor: pointer;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease),
              border-color var(--wb-motion-fast) var(--wb-motion-ease),
              color var(--wb-motion-fast) var(--wb-motion-ease);
}
.task-distribution__chip:hover {
  background: var(--wb-bg-hover);
  border-color: var(--wb-border);
}
.task-distribution__chip:focus-visible {
  outline: 2px solid var(--wb-primary);
  outline-offset: 2px;
}
.task-distribution__chip strong {
  color: var(--wb-text);
  font-size: var(--wb-fs-card-title);
  font-weight: var(--wb-fw-bold);
  font-variant-numeric: tabular-nums;
  line-height: var(--wb-lh-tight);
}
.task-distribution__chip span {
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-regular);
}
.task-distribution__chip.is-danger strong { color: var(--wb-status-danger-fg); }
.task-distribution__chip.is-warning strong { color: var(--wb-status-warning-fg); }
.task-distribution__chip.is-success strong { color: var(--wb-status-success-fg); }

/* active 状态统一用 primary 色（覆盖各 tone 的 strong 颜色），与 Element Plus tab 行为一致。
   chip 元素无直接 text，故不在此处设 color（strong/span 已覆盖）。 */
.task-distribution__chip.is-active {
  background: var(--wb-primary-soft);
  border-color: var(--wb-primary);
}
.task-distribution__chip.is-active strong,
.task-distribution__chip.is-active span {
  color: var(--wb-primary);
}

@media (prefers-reduced-motion: reduce) {
  .task-distribution__chip { transition: none !important; }
}
.skip-link {
  position: absolute;
  top: -40px;
  left: 16px;
  z-index: 100;
  padding: 8px 12px;
  background: var(--wb-primary);
  color: var(--wb-text-inverse);
  font-radius: var(--wb-radius-sm);
  text-decoration: none;
  transition: top var(--wb-motion-fast) var(--wb-motion-ease);
}
.skip-link:focus { top: 8px; }

.task-filters { margin-bottom: var(--wb-space-3); }
.queue-title {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  white-space: nowrap;
}
.student-filter { width: 160px; }
.filter-group { display: flex; align-items: center; gap: var(--wb-space-2); }
.filter-group__label {
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  white-space: nowrap;
}
.segment-control {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--wb-bg-elevated);
  border-radius: var(--wb-radius-sm);
}
.segment-control button {
  min-height: 28px;
  padding: 0 var(--wb-space-2);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.segment-control button:hover { color: var(--wb-text); }
.segment-control button.active {
  color: var(--wb-primary);
  font-weight: var(--wb-fw-semibold);
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, .08);
}
.segment-control button span {
  margin-left: var(--wb-space-1);
  color: var(--wb-text-secondary);
  font-size: 10px;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(520px, 1.28fr) minmax(360px, .72fr);
  /* B1 优化：双栏共享外框，去掉 gap 用 1px border 分隔，视觉上属同一个批改工作区 */
  gap: 0;
  min-height: 0;
  flex: 1;
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-panel);
  overflow: hidden;
}
.task-queue, .task-inspector { min-height: 520px; overflow: hidden; }
/* B1：内部 ContentCard 取消自己的 border / 圆角 / 背景，融入共享外框。
   注意：.task-queue 自身就是 ContentCard 的 root 元素，:deep() 无法匹配自身；
   Vue scoped CSS 子组件 root 优先级更高，这里用 !important 覆盖 ContentCard 的内部样式。 */
.workspace-grid .task-queue,
.workspace-grid .task-inspector {
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}
/* B1：左右两栏中间 1px 分隔线 */
.workspace-grid .task-queue {
  border-right: 1px solid var(--wb-border-light) !important;
}
.task-queue :deep(.body), .task-inspector :deep(.body) {
  height: calc(100% - 69px);
  min-height: 0;
}

.task-list {
  margin: 0;
  padding: 0;
  list-style: none;
  height: 100%;
  max-height: 610px;
  overflow-y: auto;
}
.task-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--wb-space-3);
  min-height: 60px;
  padding: var(--wb-space-2) var(--wb-space-4);
  box-sizing: border-box;
  border-bottom: 1px solid var(--wb-border-light);
  cursor: pointer;
  outline: none;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.task-item:last-child { border-bottom: 0; }
.task-item:hover { background: var(--wb-bg-elevated); }
.task-item.active {
  background: var(--wb-primary-mist);
  box-shadow: inset 3px 0 var(--wb-primary);
}
.task-item:focus-visible { box-shadow: inset 0 0 0 2px var(--wb-primary); }
.task-item :deep(.el-avatar) {
  color: var(--wb-primary);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-primary-soft);
}

.task-copy { min-width: 0; }
.task-primary { display: flex; align-items: center; gap: var(--wb-space-2); }
.task-primary strong {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
}
.task-type {
  padding: 2px 6px;
  color: var(--wb-text-secondary);
  font-size: 10px;
  background: var(--wb-bg-hover);
  border-radius: 4px;
}
.task-name {
  margin-top: var(--wb-space-1);
  overflow: hidden;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-meta {
  display: flex;
  gap: var(--wb-space-2);
  margin-top: var(--wb-space-1);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
}
.task-state { display: flex; align-items: center; }

.loading-state, .error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
  padding: 32px;
  box-sizing: border-box;
  flex-direction: column;
  gap: var(--wb-space-2);
  font-size: var(--wb-fs-meta);
  text-align: center;
}

/* loading 中性风格 */
.loading-state { color: var(--wb-text-secondary); }
.loading-state > .el-icon { color: var(--wb-primary); font-size: 30px; }

/* B4 优化：复用 InlineAlert danger tone 的 token，视觉与跨页面的 InlineAlert 危险态一致 */
.error-state {
  background: var(--wb-status-danger-bg);
  border: 1px solid rgba(220, 38, 38, 0.16);
  border-radius: var(--wb-radius-md);
  color: var(--wb-text);
}
.error-state > .el-icon { color: var(--wb-status-danger-fg); font-size: 30px; }
.error-state strong {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
}
.error-state > span {
  color: var(--wb-text-secondary);
}
.error-state__actions {
  display: flex;
  gap: var(--wb-space-2);
  margin-top: var(--wb-space-2);
}

.preview-content { padding: var(--wb-space-4); }
.preview-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--wb-space-3);
}
.preview-student {
  color: var(--wb-primary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-semibold);
}
.preview-heading h2 {
  margin: var(--wb-space-1) 0 0;
  overflow: hidden;
  color: var(--wb-text);
  font-size: var(--wb-fs-card-title);
  font-weight: var(--wb-fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-flow { display: grid; gap: 0; margin-top: var(--wb-space-4); }
.flow-step {
  position: relative;
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: var(--wb-space-2);
  min-height: 48px;
  color: var(--wb-text-tertiary);
}
.flow-step:not(:last-child)::after {
  position: absolute;
  top: 20px;
  bottom: 0;
  left: 9px;
  width: 1px;
  content: '';
  background: var(--wb-border);
}
.flow-dot {
  position: relative;
  z-index: 1;
  display: grid;
  width: 19px;
  height: 19px;
  place-items: center;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid var(--wb-border);
  border-radius: 50%;
}
.flow-dot .el-icon { font-size: 10px; }
.flow-step strong, .flow-step small { display: block; }
.flow-step strong { color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); }
.flow-step small { margin-top: 3px; font-size: 10px; }
.flow-step.is-done .flow-dot { color: #fff; background: var(--wb-success); border-color: var(--wb-success); }
.flow-step.is-active .flow-dot { background: var(--wb-primary-soft); border: 5px solid var(--wb-primary); }
.flow-step.is-active strong { color: var(--wb-primary); }
.flow-step.is-error .flow-dot { background: var(--wb-danger); border-color: var(--wb-danger); }
.flow-step.is-error strong { color: var(--wb-danger); }

.preview-stats {
  /* B3 优化：去除上下 border，让 AI 流程 → MiniStat → Primary Action 形成连续信息层级 */
  margin: var(--wb-space-4) 0 0;
  padding: var(--wb-space-3) 0 0;
}

.preview-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--wb-space-2);
  margin-top: var(--wb-space-4);
}

/* B5：移动端 sticky Primary CTA · PC 默认隐藏，移动端浮动在 wb-page 底部 */
.preview-sticky-cta { display: none; }

.confirm-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  display: inline-flex;
  align-items: center;
  gap: var(--wb-space-2);
  padding: 8px 16px;
  background: var(--wb-text);
  color: var(--wb-text-inverse);
  font-size: var(--wb-fs-body);
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-elev-overlay);
}
.confirm-toast .el-icon { font-size: 16px; color: var(--wb-success); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }
.toast-enter-active, .toast-leave-active {
  transition: opacity var(--wb-motion-base) var(--wb-motion-ease), transform var(--wb-motion-base) var(--wb-motion-ease);
}

@media (min-width: 1281px) and (max-width: 1520px) {
  .task-queue, .task-inspector { min-height: 560px; }
}
@media (min-width: 1521px) {
  .workspace-grid { grid-template-columns: minmax(620px, 1.32fr) minmax(420px, .68fr); }
  .task-queue, .task-inspector { min-height: 600px; }
}
@media (max-width: 1080px) {
  .workspace-grid { grid-template-columns: 1fr; }
  .task-inspector { min-height: auto; }
  .task-inspector :deep(.body) { height: auto; }
  /* B5：移动端双栏堆叠，preview-actions 内 Primary 隐藏，由 sticky CTA 接管 */
  .preview-actions { display: none; }
  .preview-sticky-cta {
    position: sticky;
    bottom: var(--wb-space-3);
    display: flex;
    justify-content: center;
    padding: var(--wb-space-3) var(--wb-space-3) var(--wb-space-2);
    background: var(--wb-bg);
    z-index: 5;
  }
}
@media (max-width: 720px) {
  .grade-center { padding: 20px 16px 32px; }
  .workspace-grid { display: block; }
  .task-inspector { margin-top: var(--wb-space-3); }
  .task-item {
    grid-template-columns: 34px minmax(0, 1fr);
    min-height: 64px;
  }
  .task-state {
    grid-column: 2;
    align-items: center;
    justify-content: flex-end;
    flex-direction: row;
  }
}
@media (prefers-reduced-motion: reduce) {
  .task-item, .skip-link, .confirm-toast, .segment-control button { transition: none !important; }
  .toast-enter-active, .toast-leave-active { transition: none !important; }
}
</style>
