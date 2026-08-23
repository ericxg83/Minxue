<template>
  <div class="dashboard wb-page">
    <div class="wb-page__inner">
      <PageHeader :eyebrow="todayLabel" title="早上好，老师" :description="`今天还有 ${totalTodo} 项工作需要处理。`">
        <template #actions>
          <ActionButton variant="primary" @click="go('/review')">
            <el-icon><Upload /></el-icon>
            开始批改
          </ActionButton>
        </template>
      </PageHeader>

    <section class="summary-strip" aria-label="今日摘要">
      <button class="summary-item" @click="go('/todo')">
        <span class="summary-value">{{ notiStore.summary.pendingReview || 0 }}</span>
        <span class="summary-label">待人工复核</span>
        <span class="summary-action">去处理 <el-icon><ArrowRight /></el-icon></span>
      </button>
      <button class="summary-item" @click="go('/todo')">
        <span class="summary-value summary-value--danger">{{ notiStore.summary.failedTasks || 0 }}</span>
        <span class="summary-label">识别异常</span>
        <span class="summary-action">查看异常 <el-icon><ArrowRight /></el-icon></span>
      </button>
      <button class="summary-item" @click="go('/exam-history')">
        <span class="summary-value summary-value--accent">{{ notiStore.summary.todayNewWrongQuestions || 0 }}</span>
        <span class="summary-label">今日新增错题</span>
        <span class="summary-action">看错题池 <el-icon><ArrowRight /></el-icon></span>
      </button>
      <button class="summary-item" @click="go('/growth')">
        <span class="summary-value">{{ students.length }}</span>
        <span class="summary-label">当前学生</span>
        <span class="summary-action">查看学生 <el-icon><ArrowRight /></el-icon></span>
      </button>
    </section>

    <el-alert
      v-if="notiStore.summary.failedTasks > 0"
      class="failure-alert"
      type="error"
      :closable="false"
      show-icon
      :title="`${notiStore.summary.failedTasks} 份作业处理异常，原始图片已保留，可从待办中重新处理。`"
      @click="go('/todo')"
    />

    <section class="section-heading"><div><span class="section-kicker">工作节奏</span><h2>先处理重要的，再记录变化</h2></div><span class="section-note">实时同步最近任务</span></section>

    <section class="dashboard-grid">
      <section class="surface surface--todo">
        <div class="surface-header">
          <div>
            <h2>今日待办</h2>
            <p>先处理会影响错题沉淀和学生反馈的事项</p>
          </div>
          <el-button text type="primary" @click="go('/todo')">查看全部</el-button>
        </div>
        <div v-if="todoItems.length" class="todo-list">
          <button v-for="item in todoItems" :key="item.id" class="todo-row" @click="go(item.path)">
            <span class="priority-dot" :class="`priority-dot--${item.priority}`"></span>
            <span class="todo-content">
              <strong>{{ item.title }}</strong>
              <small>{{ item.description }}</small>
            </span>
            <span class="todo-time">{{ formatTime(item.createdAt) }}</span>
            <el-icon class="row-arrow"><ArrowRight /></el-icon>
          </button>
        </div>
        <EmptyState v-else compact :icon="CircleCheck" title="今天没有待处理事项" description="作业处理完成后，新的任务会出现在这里。" />
      </section>

      <section class="surface">
        <div class="surface-header">
          <div>
            <h2>学生风险</h2>
            <p>从最近任务中识别需要关注的学生</p>
          </div>
          <el-button text type="primary" @click="go('/growth')">查看学生</el-button>
        </div>
        <div v-if="studentSignals.length" class="student-list">
          <button v-for="student in studentSignals" :key="student.name" class="student-row" @click="go('/growth')">
            <el-avatar :size="34">{{ student.name.slice(0, 1) }}</el-avatar>
            <span class="student-copy">
              <strong>{{ student.name }}</strong>
              <small>{{ student.note }}</small>
            </span>
            <el-tag :type="student.type" size="small" effect="plain">{{ student.status }}</el-tag>
          </button>
        </div>
        <EmptyState v-else compact :icon="User" title="暂无需要优先关注的学生" description="学生出现新的错题或任务变化后，会在这里提示。" />
      </section>
    </section>

    <section class="surface progress-surface">
      <div class="surface-header">
        <div>
          <h2>今日处理进度</h2>
          <p>从作业提交到学习结果确认</p>
        </div>
        <span class="progress-note">{{ recentTasks.length ? `最近有 ${recentTasks.length} 项任务更新` : '等待新的任务' }}</span>
      </div>
      <div class="workflow-progress">
        <div v-for="(step, index) in workflowSteps" :key="step.label" class="workflow-step">
          <span class="workflow-index" :class="{ 'workflow-index--active': index === 0 && notiStore.summary.pendingReview > 0 }">{{ index + 1 }}</span>
          <span>{{ step.label }}</span>
          <el-icon v-if="index < workflowSteps.length - 1"><ArrowRight /></el-icon>
        </div>
      </div>
    </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, CircleCheck, Upload, User } from '@element-plus/icons-vue'
import { getStudents } from '../../services/apiService'
import { useNotificationStore } from '../stores/notificationStore'
import ActionButton from '../components/ui/ActionButton.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'

const router = useRouter()
const notiStore = useNotificationStore()
const students = ref([])
const recentTasks = computed(() => notiStore.summary.recentTasks || [])
const totalTodo = computed(() => (notiStore.summary.pendingReview || 0) + (notiStore.summary.failedTasks || 0) + (notiStore.summary.todayNewWrongQuestions || 0))
const todayLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()))
const workflowSteps = [{ label: '作业提交' }, { label: 'AI 批改' }, { label: '教师复核' }, { label: '错题沉淀' }, { label: '重练验证' }]

const todoItems = computed(() => {
  const items = []
  recentTasks.value.slice(0, 4).forEach((task, index) => {
    const failed = task.status === 'failed'
    items.push({
      id: task.id || index,
      title: failed ? `${task.studentName || '学生'}的作业处理异常` : `${task.studentName || '学生'}的作业等待复核`,
      description: failed ? '识别没有完成，建议重新处理或查看原图' : (task.originalName || '近期上传的作业'),
      priority: failed ? 'high' : 'normal',
      createdAt: task.createdAt,
      path: failed ? '/todo' : '/review'
    })
  })
  return items
})

const studentSignals = computed(() => {
  const names = [...new Set(recentTasks.value.map(task => task.studentName).filter(Boolean))]
  return names.slice(0, 3).map((name, index) => ({
    name,
    note: index === 0 && notiStore.summary.todayNewWrongQuestions > 0 ? '今天有新的错题记录' : '最近有作业任务更新',
    status: index === 0 && notiStore.summary.todayNewWrongQuestions > 0 ? '需关注' : '有更新',
    type: index === 0 && notiStore.summary.todayNewWrongQuestions > 0 ? 'warning' : 'info'
  }))
})

const go = (path) => router.push(path)
const formatTime = (value) => {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

onMounted(async () => {
  notiStore.fetchSummary()
  try {
    const result = await getStudents(false)
    const list = result.data || result || []
    students.value = Array.isArray(list) ? list : []
  } catch (error) {
    students.value = []
  }
})
</script>

<style scoped>
.dashboard { color: var(--wb-text); }
.surface-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.surface-header p { margin: 0; color: var(--wb-text-secondary); font-size: 13px; }
.summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; overflow: hidden; }
.summary-item { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 12px; row-gap: 2px; min-height: 82px; padding: 14px 20px; color: inherit; text-align: left; background: transparent; border: 0; border-right: 1px solid var(--wb-border-light); cursor: pointer; }
.summary-item:last-child { border-right: 0; }
.summary-item:hover { background: var(--wb-primary-mist); }
.summary-value { grid-row: span 2; color: var(--wb-text); font-size: 29px; line-height: 1; font-variant-numeric: tabular-nums; }
.summary-value--danger { color: var(--wb-danger); }
.summary-value--accent { color: var(--wb-warning); }
.summary-label { color: var(--wb-text); font-size: 13px; font-weight: 600; }
.summary-action { display: inline-flex; align-items: center; gap: 3px; color: var(--wb-text-tertiary); font-size: 12px; }
.failure-alert { margin-top: 16px; cursor: pointer; border-radius: var(--wb-radius-panel); }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin: 30px 0 12px; }.section-heading h2 { margin: 4px 0 0; color: var(--wb-text); font-size: 17px; letter-spacing: -.02em; }.section-kicker { color: var(--wb-primary); font-size: 11px; font-weight: 700; letter-spacing: .08em; }.section-note { color: var(--wb-text-tertiary); font-size: 12px; }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .85fr); gap: 16px; }
.surface { min-width: 0; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: var(--wb-radius-panel); box-shadow: none; }
.surface-header { padding: 18px 20px; border-bottom: 1px solid var(--wb-border-light); }
.surface-header h2 { margin: 0 0 5px; color: var(--wb-text); font-size: 15px; font-weight: 650; }
.todo-list, .student-list { padding: 4px 10px 10px; }
.todo-row, .student-row { display: flex; align-items: center; width: 100%; gap: 12px; padding: 13px 10px; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--wb-border-light); cursor: pointer; }
.todo-row:last-child, .student-row:last-child { border-bottom: 0; }
.todo-row:hover, .student-row:hover { background: var(--wb-bg); }
.priority-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--wb-primary); }
.priority-dot--high { background: var(--wb-danger); }
.todo-content, .student-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.todo-content strong, .student-copy strong { overflow: hidden; color: var(--wb-text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.todo-content small, .student-copy small { overflow: hidden; color: var(--wb-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.todo-time { color: var(--wb-text-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.row-arrow { color: var(--wb-text-tertiary); }
.student-row { padding: 14px 12px; }
.student-row :deep(.el-avatar) { flex: 0 0 auto; color: var(--wb-primary); background: var(--wb-primary-soft); }
.progress-surface { margin-top: 16px; }
.progress-note { color: var(--wb-text-tertiary); font-size: 12px; }
.workflow-progress { display: flex; align-items: center; padding: 22px; }
.workflow-step { display: flex; flex: 1; align-items: center; gap: 8px; color: var(--wb-text-secondary); font-size: 12px; white-space: nowrap; }
.workflow-step:last-child { flex: 0 0 auto; }
.workflow-step > .el-icon { flex: 1; color: var(--wb-border); }
.workflow-index { display: inline-flex; align-items: center; justify-content: center; width: 23px; height: 23px; flex: 0 0 23px; color: var(--wb-text-tertiary); font-size: 11px; border: 1px solid var(--wb-border); border-radius: 50%; }
.workflow-index--active { color: white; background: var(--wb-primary); border-color: var(--wb-primary); }
@media (max-width: 1000px) { .summary-strip { grid-template-columns: repeat(2, 1fr); } .summary-item:nth-child(2) { border-right: 0; } .summary-item:nth-child(-n+2) { border-bottom: 1px solid var(--wb-border-light); } .dashboard-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .summary-strip { grid-template-columns: 1fr; } .summary-item, .summary-item:nth-child(2) { border-right: 0; border-bottom: 1px solid var(--wb-border-light); } .summary-item:last-child { border-bottom: 0; } .workflow-progress { align-items: flex-start; flex-direction: column; gap: 12px; } .workflow-step, .workflow-step:last-child { flex: initial; } .workflow-step > .el-icon { display: none; } }
</style>
