<template>
  <div class="grade-center wb-page">
    <div class="wb-page__inner grade-workbench">
      <PageHeader
        eyebrow="教学工作 / AI 批改工作台"
        title="批改中心"
        :description="`今天还有 ${pendingCount} 项任务需要处理，优先完成待教师复核与异常任务。`"
      >
        <template #badge>
          <span class="pending-pill">{{ pendingCount }} 项待处理</span>
        </template>
        <template #actions>
          <ActionButton :loading="loading" @click="loadData">
            <el-icon><Refresh /></el-icon>刷新
          </ActionButton>
        </template>
      </PageHeader>

      <section class="wb-stats-grid" aria-label="AI 批改任务统计">
        <StatsCard label="待处理" :value="pendingCount" description="今日任务队列" tone="warning" />
        <StatsCard label="AI 处理中" :value="processingCount" description="识别与判题进行中" tone="primary" />
        <StatsCard label="待教师复核" :value="reviewCount" description="AI 已完成，等待确认" tone="warning" />
        <StatsCard label="待重练验证" :value="retryVerifyCount" description="学生已完成重练" tone="danger" />
      </section>

      <FilterBar class="task-filters">
        <template #leading>
          <span class="queue-title">任务队列</span>
          <span class="queue-count">{{ visibleTasks.length }} 项</span>
        </template>
        <el-select v-model="studentId" clearable class="student-filter" placeholder="全部学生" @change="syncQuery">
          <el-option v-for="student in students" :key="student.id" :label="student.name" :value="student.id" />
        </el-select>
        <div class="segment-control" role="tablist" aria-label="任务来源">
          <button v-for="item in sourceTabs" :key="item.key" :class="{ active: sourceFilter === item.key }" @click="sourceFilter = item.key">
            {{ item.label }}<span>{{ item.count }}</span>
          </button>
        </div>
        <div class="segment-control" role="tablist" aria-label="任务状态">
          <button v-for="item in statusTabs" :key="item.key" :class="{ active: statusFilter === item.key }" @click="statusFilter = item.key">
            {{ item.label }}
          </button>
        </div>
      </FilterBar>

      <section class="workspace-grid">
        <ContentCard class="task-queue" title="学生任务" description="按异常、待复核、待验证和处理中排序" flush>
          <div v-if="loading" class="loading-state">
            <el-icon class="is-loading"><Loading /></el-icon>
            <strong>正在同步 AI 批改任务</strong>
            <span>正在读取学生作业与重练记录</span>
          </div>
          <div v-else-if="loadError" class="loading-state loading-state--error">
            <el-icon><WarningFilled /></el-icon>
            <strong>任务列表加载失败</strong>
            <span>{{ loadError }}</span>
            <ActionButton @click="loadData">重新加载</ActionButton>
          </div>
          <div v-else-if="visibleTasks.length" class="task-list">
            <article
              v-for="task in visibleTasks"
              :key="task.key"
              :class="['task-item', { active: selectedTask?.key === task.key }]"
              tabindex="0"
              @click="selectTask(task)"
              @keydown.enter="openTask(task)"
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
                <span :class="['status-badge', `status-badge--${task.tone}`]"><i />{{ task.statusLabel }}</span>
                <el-button type="primary" text @click.stop="openTask(task)">{{ task.actionLabel }}</el-button>
              </div>
            </article>
          </div>
          <EmptyState v-else title="当前筛选下没有任务" description="新上传的作业和完成的重练任务会出现在这里。" />
        </ContentCard>

        <ContentCard class="task-inspector" title="任务预览" description="确认 AI 处理结果后进入审核工作区" flush>
          <template v-if="selectedTask">
            <div class="preview-media">
              <img v-if="selectedTask.imageUrl" :src="selectedTask.imageUrl" :alt="selectedTask.name" />
              <div v-else class="preview-placeholder">
                <el-icon><DocumentChecked /></el-icon>
                <strong>{{ selectedTask.source === 'retry' ? '错题重练任务' : '作业图片暂不可预览' }}</strong>
                <span>{{ selectedTask.source === 'retry' ? '进入审核工作区查看题目与学生作答' : '原始任务未返回可用图片' }}</span>
              </div>
              <span class="preview-type">{{ selectedTask.sourceLabel }}</span>
            </div>

            <div class="preview-content">
              <div class="preview-heading">
                <div>
                  <span class="preview-student">{{ selectedTask.studentName }}</span>
                  <h2>{{ selectedTask.name }}</h2>
                </div>
                <span :class="['status-badge', `status-badge--${selectedTask.tone}`]"><i />{{ selectedTask.statusLabel }}</span>
              </div>

              <div class="ai-flow" aria-label="AI 批改流程">
                <div v-for="step in flowSteps(selectedTask)" :key="step.label" :class="['flow-step', `is-${step.state}`]">
                  <span class="flow-dot"><el-icon v-if="step.state === 'done'"><Check /></el-icon></span>
                  <div><strong>{{ step.label }}</strong><small>{{ step.note }}</small></div>
                </div>
              </div>

              <dl class="preview-stats">
                <div><dt>题目数量</dt><dd>{{ selectedTask.questionCount }}</dd></div>
                <div><dt>AI 识别状态</dt><dd>{{ selectedTask.aiStatusLabel }}</dd></div>
                <div><dt>错题数量</dt><dd :class="{ danger: selectedTask.wrongCount > 0 }">{{ selectedTask.wrongCount }}</dd></div>
              </dl>

              <div v-if="selectedTask.tone === 'danger'" class="task-alert">
                <el-icon><WarningFilled /></el-icon>
                <span>AI 处理出现异常，原始任务仍保留，可进入工作区查看详情。</span>
              </div>

              <div class="preview-actions">
                <ActionButton variant="primary" @click="openTask(selectedTask)">
                  {{ selectedTask.actionLabel }}<el-icon><ArrowRight /></el-icon>
                </ActionButton>
                <span>将打开现有 Review Workspace</span>
              </div>
            </div>
          </template>
          <EmptyState v-else title="选择一个任务查看详情" description="从左侧任务列表选择作业或重练任务。" />
        </ContentCard>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Check, DocumentChecked, Loading, Refresh, WarningFilled } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatsCard from '../components/ui/StatsCard.vue'
import { getGeneratedExamsByStudent, getStudents, getTasksByStudent } from '../../services/apiService'

const route = useRoute()
const router = useRouter()
const students = ref([])
const allTasks = ref([])
const loading = ref(true)
const loadError = ref('')
const selectedTask = ref(null)
const studentId = ref(route.query.studentId || '')
const sourceFilter = ref(route.query.source === 'retry' ? 'retry' : 'all')
const statusFilter = ref('active')

const activeStatuses = new Set(['pending', 'processing', 'review', 'retry', 'failed'])
const pendingCount = computed(() => allTasks.value.filter(item => activeStatuses.has(item.workflowStatus)).length)
const processingCount = computed(() => allTasks.value.filter(item => item.workflowStatus === 'processing').length)
const reviewCount = computed(() => allTasks.value.filter(item => item.workflowStatus === 'review').length)
const retryVerifyCount = computed(() => allTasks.value.filter(item => item.workflowStatus === 'retry').length)
const visibleTasks = computed(() => allTasks.value.filter(item => {
  const sourceMatches = sourceFilter.value === 'all' || item.source === sourceFilter.value
  const statusMatches = statusFilter.value === 'all' || (statusFilter.value === 'active' ? activeStatuses.has(item.workflowStatus) : item.workflowStatus === 'completed')
  return sourceMatches && statusMatches
}))
const sourceTabs = computed(() => [
  { key: 'all', label: '全部', count: allTasks.value.length },
  { key: 'homework', label: '学生作业', count: allTasks.value.filter(item => item.source === 'homework').length },
  { key: 'retry', label: '错题重练', count: allTasks.value.filter(item => item.source === 'retry').length }
])
const statusTabs = [
  { key: 'active', label: '待处理' },
  { key: 'all', label: '全部任务' },
  { key: 'completed', label: '已完成' }
]

const formatTime = value => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '时间未知'
  const today = new Date()
  const isToday = parsed.toDateString() === today.toDateString()
  return isToday ? `今天 ${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}` : `${parsed.getMonth() + 1}月${parsed.getDate()}日`
}

const normalizeHomeworkStatus = status => {
  if (status === 'failed') return { workflowStatus: 'failed', statusLabel: '处理异常', tone: 'danger', aiStatusLabel: '识别异常' }
  if (status === 'reviewed') return { workflowStatus: 'completed', statusLabel: '已完成', tone: 'success', aiStatusLabel: '教师已确认' }
  if (status === 'done') return { workflowStatus: 'review', statusLabel: '待教师复核', tone: 'warning', aiStatusLabel: 'AI 已完成' }
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
    statusLabel: completed ? '已完成' : '待重练验证',
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
    const targets = studentId.value ? students.value.filter(student => String(student.id) === String(studentId.value)) : students.value
    const lists = await Promise.all(targets.map(async student => {
      const [tasks, exams] = await Promise.all([
        getTasksByStudent(student.id, false).catch(() => []),
        getGeneratedExamsByStudent(student.id, false).catch(() => [])
      ])
      return [...(tasks || []).map(task => homework(task, student)), ...(exams || []).map(task => retry(task, student))]
    }))
    allTasks.value = lists.flat().sort((left, right) => {
      const statusOrder = priority[left.workflowStatus] - priority[right.workflowStatus]
      if (statusOrder) return statusOrder
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0)
    })
  } catch (error) {
    loadError.value = error?.message || '暂时无法读取任务，请稍后重试。'
    allTasks.value = []
  } finally {
    loading.value = false
  }
}

function syncQuery() {
  router.replace({
    path: '/grade',
    query: studentId.value
      ? { studentId: studentId.value, ...(sourceFilter.value !== 'all' ? { source: sourceFilter.value } : {}) }
      : sourceFilter.value !== 'all' ? { source: sourceFilter.value } : {}
  })
  loadData()
}

function selectTask(task) {
  selectedTask.value = task
}

function openTask(task) {
  router.push({ path: '/grade/task', query: { studentId: task.studentId, taskId: task.id, source: task.source } })
}

function flowSteps(task) {
  const processing = task.workflowStatus === 'processing'
  const failed = task.workflowStatus === 'failed'
  const awaitingReview = ['review', 'retry', 'pending'].includes(task.workflowStatus)
  const completed = task.workflowStatus === 'completed'
  return [
    { label: '上传完成', note: task.timeLabel, state: 'done' },
    { label: 'AI 识别与判题', note: failed ? '处理出现异常' : processing ? '正在进行' : '已生成结果', state: failed ? 'error' : processing ? 'active' : 'done' },
    { label: task.source === 'retry' ? '重练验证' : '教师复核', note: completed ? '已确认' : awaitingReview ? '等待处理' : '尚未开始', state: completed ? 'done' : awaitingReview ? 'active' : 'pending' }
  ]
}

watch(visibleTasks, tasks => {
  if (!tasks.some(task => task.key === selectedTask.value?.key)) selectedTask.value = tasks[0] || null
}, { immediate: true })

onMounted(loadData)
</script>

<style scoped>
.grade-workbench { display: flex; min-height: 100%; flex-direction: column; }
.pending-pill { padding: 4px 9px; color: var(--wb-warning); font-size: 11px; font-weight: 600; background: var(--wb-warning-soft); border-radius: 999px; }
.task-filters { margin-bottom: 12px; }
.queue-title { color: var(--wb-text); font-size: 13px; font-weight: 650; white-space: nowrap; }
.queue-count { color: var(--wb-text-tertiary); font-size: 11px; white-space: nowrap; }
.student-filter { width: 160px; }
.segment-control { display: flex; gap: 2px; padding: 3px; background: var(--wb-bg-elevated); border-radius: 8px; }
.segment-control button { min-height: 28px; padding: 0 9px; color: var(--wb-text-secondary); font-size: 11px; background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
.segment-control button:hover { color: var(--wb-text); }
.segment-control button.active { color: var(--wb-primary); font-weight: 600; background: #fff; box-shadow: 0 1px 3px rgba(15, 23, 42, .08); }
.segment-control button span { margin-left: 5px; color: var(--wb-text-tertiary); font-size: 10px; }
.workspace-grid { display: grid; grid-template-columns: minmax(520px, 1.28fr) minmax(340px, .72fr); gap: 12px; min-height: 0; flex: 1; }
.task-queue,.task-inspector { min-height: 520px; overflow: hidden; }
.task-queue :deep(.body),.task-inspector :deep(.body) { height: calc(100% - 69px); min-height: 0; }
.task-list { height: 100%; max-height: 610px; overflow-y: auto; }
.task-item { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 84px; padding: 12px 16px; box-sizing: border-box; border-bottom: 1px solid var(--wb-border-light); cursor: pointer; outline: none; transition: background .15s ease, box-shadow .15s ease; }
.task-item:last-child { border-bottom: 0; }
.task-item:hover { background: var(--wb-bg-elevated); }
.task-item.active { background: var(--wb-primary-mist); box-shadow: inset 3px 0 var(--wb-primary); }
.task-item:focus-visible { box-shadow: inset 0 0 0 2px var(--wb-primary); }
.task-item :deep(.el-avatar) { color: var(--wb-primary); font-weight: 650; background: var(--wb-primary-soft); }
.task-copy { min-width: 0; }
.task-primary { display: flex; align-items: center; gap: 7px; }
.task-primary strong { color: var(--wb-text); font-size: 13px; font-weight: 650; }
.task-type { padding: 2px 6px; color: var(--wb-text-secondary); font-size: 10px; background: var(--wb-bg-hover); border-radius: 4px; }
.task-name { margin-top: 5px; overflow: hidden; color: var(--wb-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.task-meta { display: flex; gap: 10px; margin-top: 5px; color: var(--wb-text-tertiary); font-size: 10px; }
.task-state { display: flex; align-items: flex-end; gap: 4px; flex-direction: column; }
.status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; font-size: 10px; font-weight: 600; border-radius: 5px; white-space: nowrap; }
.status-badge i { width: 6px; height: 6px; background: currentColor; border-radius: 50%; }
.status-badge--processing { color: var(--wb-primary); background: var(--wb-primary-mist); }
.status-badge--warning { color: var(--wb-warning); background: var(--wb-warning-soft); }
.status-badge--danger { color: var(--wb-danger); background: var(--wb-danger-soft); }
.status-badge--success { color: var(--wb-success); background: var(--wb-success-soft); }
.loading-state { display: flex; align-items: center; justify-content: center; min-height: 360px; padding: 32px; box-sizing: border-box; flex-direction: column; gap: 8px; color: var(--wb-text-tertiary); font-size: 12px; text-align: center; }
.loading-state > .el-icon { color: var(--wb-primary); font-size: 30px; }
.loading-state strong { color: var(--wb-text); font-size: 13px; }
.loading-state--error > .el-icon { color: var(--wb-danger); }
.preview-media { position: relative; height: 210px; overflow: hidden; background: #eef1f5; border-bottom: 1px solid var(--wb-border-light); }
.preview-media img { width: 100%; height: 100%; object-fit: cover; object-position: top center; }
.preview-media::after { position: absolute; inset: auto 0 0; height: 48px; content: ''; background: linear-gradient(transparent, rgba(15, 23, 42, .12)); pointer-events: none; }
.preview-type { position: absolute; top: 12px; left: 12px; z-index: 1; padding: 4px 8px; color: var(--wb-text-secondary); font-size: 10px; font-weight: 600; background: rgba(255, 255, 255, .92); border: 1px solid rgba(226, 232, 240, .9); border-radius: 6px; backdrop-filter: blur(8px); }
.preview-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 7px; color: var(--wb-text-tertiary); text-align: center; }
.preview-placeholder .el-icon { color: var(--wb-primary); font-size: 34px; }
.preview-placeholder strong { color: var(--wb-text-secondary); font-size: 13px; }
.preview-placeholder span { max-width: 260px; font-size: 11px; }
.preview-content { padding: 18px; }
.preview-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.preview-student { color: var(--wb-primary); font-size: 11px; font-weight: 600; }
.preview-heading h2 { margin: 5px 0 0; overflow: hidden; color: var(--wb-text); font-size: 15px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.ai-flow { display: grid; gap: 0; margin-top: 18px; }
.flow-step { position: relative; display: grid; grid-template-columns: 22px 1fr; gap: 9px; min-height: 48px; color: var(--wb-text-tertiary); }
.flow-step:not(:last-child)::after { position: absolute; top: 20px; bottom: 0; left: 9px; width: 1px; content: ''; background: var(--wb-border); }
.flow-dot { position: relative; z-index: 1; display: grid; width: 19px; height: 19px; place-items: center; box-sizing: border-box; background: #fff; border: 1px solid var(--wb-border); border-radius: 50%; }
.flow-dot .el-icon { font-size: 10px; }
.flow-step strong,.flow-step small { display: block; }
.flow-step strong { color: var(--wb-text-secondary); font-size: 11px; }
.flow-step small { margin-top: 3px; font-size: 10px; }
.flow-step.is-done .flow-dot { color: #fff; background: var(--wb-success); border-color: var(--wb-success); }
.flow-step.is-active .flow-dot { background: var(--wb-primary-soft); border: 5px solid var(--wb-primary); }
.flow-step.is-active strong { color: var(--wb-primary); }
.flow-step.is-error .flow-dot { background: var(--wb-danger); border-color: var(--wb-danger); }
.flow-step.is-error strong { color: var(--wb-danger); }
.preview-stats { display: grid; grid-template-columns: repeat(3, 1fr); margin: 2px 0 0; padding: 14px 0; border-top: 1px solid var(--wb-border-light); border-bottom: 1px solid var(--wb-border-light); }
.preview-stats div { padding: 0 12px; border-right: 1px solid var(--wb-border-light); }
.preview-stats div:first-child { padding-left: 0; }
.preview-stats div:last-child { border-right: 0; }
.preview-stats dt { color: var(--wb-text-tertiary); font-size: 10px; }
.preview-stats dd { margin: 6px 0 0; color: var(--wb-text); font-size: 14px; font-weight: 650; }
.preview-stats dd.danger { color: var(--wb-danger); }
.task-alert { display: flex; align-items: flex-start; gap: 7px; margin-top: 13px; padding: 10px; color: var(--wb-danger); font-size: 10px; line-height: 1.5; background: var(--wb-danger-soft); border-radius: 7px; }
.preview-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 16px; }
.preview-actions span { color: var(--wb-text-tertiary); font-size: 10px; }
@media (max-width: 1080px) { .workspace-grid { grid-template-columns: 1fr; } .task-inspector { min-height: auto; } .task-inspector :deep(.body) { height: auto; } .preview-media { height: 260px; } }
@media (max-width: 720px) { .grade-center { padding: 20px 16px 32px; } .workspace-grid { display: block; } .task-inspector { margin-top: 12px; } .task-item { grid-template-columns: 34px minmax(0, 1fr); } .task-state { grid-column: 2; align-items: center; justify-content: space-between; flex-direction: row; } .preview-stats { grid-template-columns: 1fr; } .preview-stats div { padding: 9px 0; border-right: 0; border-bottom: 1px solid var(--wb-border-light); } .preview-stats div:last-child { border-bottom: 0; } }
</style>
