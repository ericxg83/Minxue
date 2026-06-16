<template>
  <div class="notification-panel">
    <!-- Header -->
    <div class="panel-header">
      <span class="panel-title">通知中心</span>
      <el-button text size="small" :loading="loading" @click="handleRefresh">
        <el-icon><Refresh /></el-icon>
        <span>刷新</span>
      </el-button>
    </div>

    <!-- Summary Cards Row -->
    <div class="summary-row">
      <div class="summary-card" @click="goRoute('pendingReview')">
        <div class="card-icon icon-blue"><el-icon size="18"><DocumentChecked /></el-icon></div>
        <div class="card-body">
          <span class="card-num">{{ summary.pendingReview }}</span>
          <span class="card-label">待复核</span>
        </div>
      </div>
      <div class="summary-card" @click="goRoute('failedTasks')">
        <div class="card-icon icon-red"><el-icon size="18"><WarningFilled /></el-icon></div>
        <div class="card-body">
          <span class="card-num">{{ summary.failedTasks }}</span>
          <span class="card-label">失败任务</span>
        </div>
      </div>
      <div class="summary-card" @click="goRoute('wrongQuestions')">
        <div class="card-icon icon-orange"><el-icon size="18"><Collection /></el-icon></div>
        <div class="card-body">
          <span class="card-num">{{ summary.todayNewWrongQuestions }}</span>
          <span class="card-label">今日错题</span>
        </div>
      </div>
      <div class="summary-card" @click="goRoute('all')">
        <div class="card-icon icon-green"><el-icon size="18"><List /></el-icon></div>
        <div class="card-body">
          <span class="card-num">{{ summary.totalNotifications }}</span>
          <span class="card-label">全部待办</span>
        </div>
      </div>
    </div>

    <!-- Section Divider -->
    <div class="section-divider" />

    <!-- Recent Tasks -->
    <div class="recent-section">
      <div class="section-title">最近待办</div>
      <div v-if="recentTasks.length === 0" class="empty-hint">
        <el-icon><CircleCheck /></el-icon>
        <span>暂无待办事项</span>
      </div>
      <div v-else class="task-list">
        <div
          v-for="task in recentTasks"
          :key="task.id"
          class="task-row"
          @click="openTask(task)"
        >
          <span class="task-dot" :class="task.status === 'done' ? 'dot-warning' : 'dot-danger'" />
          <div class="task-info">
            <div class="task-name">{{ task.originalName || '未命名试卷' }}</div>
            <div class="task-meta">
              <span v-if="task.studentName">{{ task.studentName }}</span>
              <span v-if="task.studentName">·</span>
              <span>{{ task.status === 'done' ? '待复核' : '处理失败' }}</span>
              <span>·</span>
              <span>{{ timeAgo(task.createdAt) }}</span>
            </div>
          </div>
          <el-icon class="task-arrow"><ArrowRight /></el-icon>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="panel-footer" @click="goRoute('all')">
      <span>查看全部待办</span>
      <el-icon><ArrowRight /></el-icon>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  DocumentChecked, WarningFilled, Collection, List,
  ArrowRight, CircleCheck, Refresh
} from '@element-plus/icons-vue'
import { useNotificationStore } from '../../stores/notificationStore'

const emit = defineEmits(['close'])
const router = useRouter()
const notificationStore = useNotificationStore()

const summary = computed(() => notificationStore.summary)
const recentTasks = computed(() => notificationStore.recentTasks)
const loading = computed(() => notificationStore.loading)

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = now - date
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

function goRoute(type) {
  emit('close')
  switch (type) {
    case 'wrongQuestions':
      router.push('/wrongbook')
      break
    case 'pendingReview':
    case 'failedTasks':
    case 'all':
    default:
      router.push('/')
      break
  }
}

function openTask(task) {
  emit('close')
  router.push('/')
}

function handleRefresh() {
  notificationStore.fetchSummary()
}
</script>

<style scoped>
.notification-panel {
  width: 380px;
  max-height: 480px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

/* ── Header ── */
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
}

/* ── Summary Cards ── */
.summary-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 0 12px 12px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
}

.summary-card:hover {
  background: #F2F3F5;
}

.card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: #fff;
}

.icon-blue  { background: #1677FF; }
.icon-red   { background: #F53F3F; }
.icon-orange { background: #FA8C16; }
.icon-green { background: #00B42A; }

.card-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.card-num {
  font-size: 18px;
  font-weight: 700;
  color: #1D2129;
  line-height: 1.2;
}

.card-label {
  font-size: 11px;
  color: #86909C;
  white-space: nowrap;
}

/* ── Divider ── */
.section-divider {
  height: 1px;
  background: #F2F3F5;
  margin: 0 12px;
}

/* ── Recent Tasks ── */
.recent-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.section-title {
  font-size: 13px;
  font-weight: 500;
  color: #86909C;
  padding: 10px 16px 6px;
}

.empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px 0;
  color: #C9CDD4;
  font-size: 13px;
}

.task-list {
  overflow-y: auto;
  flex: 1;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.task-row:hover {
  background: #F7F8FA;
}

.task-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-warning { background: #FA8C16; }
.dot-danger  { background: #F53F3F; }

.task-info {
  flex: 1;
  min-width: 0;
}

.task-name {
  font-size: 13px;
  font-weight: 500;
  color: #1D2129;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  font-size: 11px;
  color: #86909C;
  margin-top: 2px;
}

.task-arrow {
  font-size: 14px;
  color: #C9CDD4;
  flex-shrink: 0;
}

.task-row:hover .task-arrow {
  color: #4E5969;
}

/* ── Footer ── */
.panel-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 16px;
  border-top: 1px solid #F2F3F5;
  font-size: 13px;
  color: #1677FF;
  cursor: pointer;
  transition: background 0.2s;
  border-radius: 0 0 8px 8px;
}

.panel-footer:hover {
  background: #F7F8FA;
}
</style>
