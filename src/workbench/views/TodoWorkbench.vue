<template>
  <div class="todo-page">
    <header class="todo-header">
      <div>
        <div class="eyebrow">工作台 / 待办</div>
        <h1>待办</h1>
        <p>优先处理会影响错题沉淀和学生反馈的事项。</p>
      </div>
      <el-button plain @click="notiStore.fetchSummary" :loading="notiStore.loading">刷新</el-button>
    </header>

    <section class="todo-summary">
      <div><strong>{{ totalCount }}</strong><span>全部待办</span></div>
      <div><strong class="is-warning">{{ notiStore.summary.pendingReview || 0 }}</strong><span>待人工复核</span></div>
      <div><strong class="is-danger">{{ notiStore.summary.failedTasks || 0 }}</strong><span>识别异常</span></div>
      <div><strong class="is-accent">{{ notiStore.summary.todayNewWrongQuestions || 0 }}</strong><span>今日新增错题</span></div>
    </section>

    <section class="todo-surface">
      <div class="filter-row">
        <div class="filter-tabs" role="tablist" aria-label="待办类型">
          <button v-for="filter in filters" :key="filter.key" :class="{ active: activeFilter === filter.key }" @click="activeFilter = filter.key">
            {{ filter.label }}<span v-if="filter.count">{{ filter.count }}</span>
          </button>
        </div>
        <el-select v-model="priorityFilter" size="small" style="width: 120px" aria-label="优先级筛选">
          <el-option label="全部优先级" value="all" />
          <el-option label="高优先级" value="high" />
          <el-option label="普通事项" value="normal" />
        </el-select>
      </div>

      <div v-if="filteredItems.length" class="todo-table">
        <div class="todo-table-head"><span>事项</span><span>学生</span><span>时间</span><span>操作</span></div>
        <button v-for="item in filteredItems" :key="item.id" class="todo-table-row" @click="go(item.path)">
          <span class="todo-main"><i :class="`priority-dot priority-dot--${item.priority}`"></i><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
          <span class="todo-student">{{ item.student }}</span>
          <span class="todo-time">{{ item.time }}</span>
          <span><el-button text type="primary" @click.stop="go(item.path)">{{ item.action }}</el-button></span>
        </button>
      </div>
      <div v-else class="todo-empty">
        <el-icon><CircleCheck /></el-icon>
        <strong>当前筛选下没有待办</strong>
        <span>处理完成的事项会自动从这里移出。</span>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { CircleCheck } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '../stores/notificationStore'

const router = useRouter()
const notiStore = useNotificationStore()
const activeFilter = ref('all')
const priorityFilter = ref('all')
const recentTasks = computed(() => notiStore.summary.recentTasks || [])
const totalCount = computed(() => (notiStore.summary.pendingReview || 0) + (notiStore.summary.failedTasks || 0) + (notiStore.summary.todayNewWrongQuestions || 0))
const filters = computed(() => [
  { key: 'all', label: '全部', count: totalCount.value },
  { key: 'review', label: '待复核', count: notiStore.summary.pendingReview || 0 },
  { key: 'failed', label: '识别异常', count: notiStore.summary.failedTasks || 0 },
  { key: 'wrong', label: '新增错题', count: notiStore.summary.todayNewWrongQuestions || 0 }
])
const items = computed(() => recentTasks.value.map((task, index) => {
  const failed = task.status === 'failed'
  return { id: task.id || index, title: failed ? '作业处理异常' : '作业等待人工复核', description: failed ? '识别没有完成，建议重新处理或查看原图' : (task.originalName || '近期上传的作业'), student: task.studentName || '未关联学生', time: formatTime(task.createdAt), action: failed ? '查看异常' : '立即复核', type: failed ? 'failed' : 'review', priority: failed ? 'high' : 'normal', path: failed ? '/todo' : '/review' }
}))
const filteredItems = computed(() => items.value.filter(item => (activeFilter.value === 'all' || item.type === activeFilter.value) && (priorityFilter.value === 'all' || item.priority === priorityFilter.value)))
const go = (path) => router.push(path)
function formatTime(value) { if (!value) return '刚刚'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '刚刚' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
onMounted(() => notiStore.fetchSummary())
</script>

<style scoped>
.todo-page { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 32px 36px 48px; background: var(--wb-bg); }
.todo-header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px; }
.eyebrow { color: var(--wb-text-tertiary); font-size: 12px; }
h1 { margin: 6px 0 4px; color: var(--wb-text); font-size: 25px; font-weight: 650; }
.todo-header p { margin: 0; color: var(--wb-text-secondary); font-size: 13px; }
.todo-summary { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 16px; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }
.todo-summary div { display: flex; align-items: baseline; gap: 10px; padding: 18px 20px; border-right: 1px solid var(--wb-border-light); }
.todo-summary div:last-child { border-right: 0; }
.todo-summary strong { color: var(--wb-text); font-size: 24px; font-variant-numeric: tabular-nums; }
.todo-summary .is-warning { color: var(--wb-warning); }.todo-summary .is-danger { color: var(--wb-danger); }.todo-summary .is-accent { color: var(--wb-accent); }
.todo-summary span { color: var(--wb-text-secondary); font-size: 13px; }
.todo-surface { background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }
.filter-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--wb-border-light); }
.filter-tabs { display: flex; gap: 4px; overflow-x: auto; }.filter-tabs button { padding: 7px 10px; color: var(--wb-text-secondary); white-space: nowrap; background: transparent; border: 0; border-radius: 6px; cursor: pointer; }.filter-tabs button:hover { color: var(--wb-text); background: var(--wb-bg); }.filter-tabs button.active { color: var(--wb-primary); font-weight: 600; background: var(--wb-primary-mist); }.filter-tabs span { margin-left: 5px; color: var(--wb-text-tertiary); font-size: 11px; }
.todo-table-head, .todo-table-row { display: grid; grid-template-columns: minmax(320px, 1fr) 180px 120px 110px; align-items: center; gap: 16px; padding: 0 20px; }.todo-table-head { min-height: 38px; color: var(--wb-text-tertiary); font-size: 12px; background: var(--wb-bg); }.todo-table-row { width: 100%; min-height: 70px; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--wb-border-light); cursor: pointer; }.todo-table-row:hover { background: #FBFBFE; }.todo-main { display: grid; grid-template-columns: 8px 1fr; column-gap: 10px; row-gap: 4px; align-items: center; }.todo-main strong { color: var(--wb-text); font-size: 13px; }.todo-main small { grid-column: 2; overflow: hidden; color: var(--wb-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.priority-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--wb-primary); }.priority-dot--high { background: var(--wb-danger); }.todo-student, .todo-time { color: var(--wb-text-secondary); font-size: 12px; }.todo-time { color: var(--wb-text-tertiary); }.todo-empty { display: flex; align-items: center; justify-content: center; min-height: 280px; flex-direction: column; gap: 8px; color: var(--wb-text-tertiary); font-size: 13px; }.todo-empty .el-icon { color: var(--wb-success); font-size: 34px; }.todo-empty strong { color: var(--wb-text); font-size: 14px; }
@media (max-width: 900px) { .todo-page { padding: 24px; }.todo-summary { grid-template-columns: repeat(2, 1fr); }.todo-summary div:nth-child(2) { border-right: 0; }.todo-summary div:nth-child(-n+2) { border-bottom: 1px solid var(--wb-border-light); }.todo-table-head { display: none; }.todo-table-row { grid-template-columns: 1fr auto; gap: 6px 12px; padding: 14px 16px; }.todo-main { grid-row: span 2; }.todo-student, .todo-time { text-align: right; }.todo-table-row > span:last-child { grid-column: 2; grid-row: 2; text-align: right; } }
@media (max-width: 560px) { .todo-page { padding: 20px 16px 32px; }.todo-header { align-items: flex-start; flex-direction: column; gap: 16px; }.todo-summary { grid-template-columns: 1fr; }.todo-summary div, .todo-summary div:nth-child(2) { border-right: 0; border-bottom: 1px solid var(--wb-border-light); }.todo-summary div:last-child { border-bottom: 0; } }
</style>
