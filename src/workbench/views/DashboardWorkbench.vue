<template>
  <div class="dashboard">
    <!-- 顶部欢迎区 -->
    <header class="dash-header">
      <div>
        <h1 class="dash-title">工作台</h1>
        <p class="dash-date">{{ greeting }}，欢迎使用敏学成长工作台</p>
      </div>
      <div class="dash-header-actions">
        <el-button type="primary" size="large" @click="goReview">
          <el-icon><DocumentChecked /></el-icon> 开始批改
        </el-button>
      </div>
    </header>

    <!-- 统计卡片 -->
    <section class="stat-grid">
      <div class="stat-card" @click="goReview">
        <div class="stat-card__icon stat-icon--pending"><el-icon><Files /></el-icon></div>
        <div class="stat-card__body">
          <div class="stat-value">{{ notiStore.summary.pendingReview }}</div>
          <div class="stat-label">待复核试卷</div>
        </div>
        <span class="stat-card__link">去批改 ›</span>
      </div>

      <div class="stat-card" @click="goWrongBook">
        <div class="stat-card__icon stat-icon--wrong"><el-icon><Collection /></el-icon></div>
        <div class="stat-card__body">
          <div class="stat-value">{{ notiStore.summary.todayNewWrongQuestions }}</div>
          <div class="stat-label">今日新增错题</div>
        </div>
        <span class="stat-card__link">去错题本 ›</span>
      </div>

      <div class="stat-card" @click="goExamHistory">
        <div class="stat-card__icon stat-icon--retry"><el-icon><Clock /></el-icon></div>
        <div class="stat-card__body">
          <div class="stat-value">{{ pendingPrintCount }}</div>
          <div class="stat-label">待打印重练卷</div>
        </div>
        <span class="stat-card__link">去重练批改 ›</span>
      </div>

      <div class="stat-card" @click="goStudents">
        <div class="stat-card__icon stat-icon--student"><el-icon><User /></el-icon></div>
        <div class="stat-card__body">
          <div class="stat-value">{{ students.length }}</div>
          <div class="stat-label">本班学生</div>
        </div>
        <span class="stat-card__link">切换学生 ›</span>
      </div>
    </section>

    <!-- 失败任务警示 -->
    <el-alert
      v-if="notiStore.summary.failedTasks > 0"
      :title="`${notiStore.summary.failedTasks} 份试卷处理失败（识别或批改异常），可在通知中查看`"
      type="error"
      :closable="false"
      show-icon
      class="dash-alert"
    />

    <!-- 主体双栏 -->
    <section class="dash-main">
      <div class="card recent-card">
        <div class="card-header">
          <h2>最近的试卷</h2>
          <el-button text type="primary" @click="goExamHistory">查看全部</el-button>
        </div>
        <div v-if="recentTasks.length === 0" class="card-empty">
          <el-icon size="36"><Document /></el-icon>
          <span>暂无任务记录</span>
        </div>
        <div v-else class="recent-list">
          <div v-for="t in recentTasks" :key="t.id" class="recent-item" @click="goReview">
            <el-tag :type="taskStatusType(t.status)" size="small" effect="light">
              {{ taskStatusLabel(t.status) }}
            </el-tag>
            <span class="recent-name">{{ t.originalName || '未命名试卷' }}</span>
            <span class="recent-student">{{ t.studentName }}</span>
            <span class="recent-time">{{ formatTime(t.createdAt) }}</span>
          </div>
        </div>
      </div>

      <div class="card shortcut-card">
        <div class="card-header">
          <h2>快捷功能</h2>
        </div>
        <div class="shortcut-grid">
          <div
            v-for="s in shortcuts"
            :key="s.key"
            class="shortcut-item"
            :class="{ 'shortcut-item--disabled': s.disabled }"
            @click="!s.disabled && go(s.path)"
          >
            <div class="shortcut-icon" :style="iconStyle(s.color)">
              <el-icon><component :is="s.icon" /></el-icon>
            </div>
            <span class="shortcut-label">{{ s.label }}</span>
            <span v-if="s.disabled" class="shortcut-badge">开发中</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNotificationStore } from '../stores/notificationStore'
import { getStudents } from '../../services/apiService'
import {
  DocumentChecked, Files, Collection, Clock, User, Document,
  Notebook, DataAnalysis, Download, Reading
} from '@element-plus/icons-vue'

const router = useRouter()
const notiStore = useNotificationStore()

const students = ref([])

// 待打印重练卷：summary 暂无该字段，用通知口径的待复核作为展示兜底
const pendingPrintCount = computed(() => 0)

const recentTasks = computed(() => notiStore.summary.recentTasks || [])

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const shortcuts = [
  { key: 'review', label: '作业批改', path: '/review', icon: 'DocumentChecked', color: '#6366F1' },
  { key: 'retry', label: '重练批改', path: '/exam-history', icon: 'Clock', color: '#8B5CF6' },
  { key: 'wrongbook', label: '错题本', path: '/wrongbook', icon: 'Collection', color: '#DC2626' },
  { key: 'worksheet', label: '练习册管理', path: '/worksheets', icon: 'Notebook', color: '#059669' },
  { key: 'diag', label: '诊断报告', path: '/weekly-report', icon: 'DataAnalysis', color: '#D97706' },
  { key: 'handout', label: '讲义预览', path: '/handout', icon: 'Reading', color: '#4F46E5' },
  { key: 'handouts', label: '我的讲义', path: '/handouts', icon: 'Notebook', color: '#0EA5E9' },
  { key: 'paper', label: '试卷入库', path: '/paper', icon: 'Download', color: '#94A3B8', disabled: true },
]

const iconStyle = (color) => ({ background: color + '1A', color })

const taskStatusMap = { done: { label: '待复核', type: 'warning' }, failed: { label: '失败', type: 'danger' }, reviewed: { label: '已复核', type: 'success' } }
const taskStatusLabel = (s) => taskStatusMap[s]?.label || s
const taskStatusType = (s) => taskStatusMap[s]?.type || 'info'

const formatTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const go = (path) => { if (path !== router.currentRoute.value.path) router.push(path) }
const goReview = () => go('/review')
const goWrongBook = () => go('/wrongbook')
const goExamHistory = () => go('/exam-history')
const goStudents = () => go('/review')

onMounted(async () => {
  // 复用铃铛轮询的全局汇总数据，无需额外后端请求
  notiStore.fetchSummary()
  try {
    const result = await getStudents(false)
    const list = result.data || result || []
    students.value = Array.isArray(list) ? list : []
  } catch (e) {
    console.error('加载学生列表失败:', e)
    students.value = []
  }
})
</script>

<style scoped>
.dashboard {
  height: 100vh;
  overflow-y: auto;
  padding: 24px 28px 40px;
  background: var(--wb-bg);
  box-sizing: border-box;
}

.dash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dash-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--wb-text);
}
.dash-date {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--wb-text-tertiary);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 22px;
}
.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-shadow-sm);
  cursor: pointer;
  transition: box-shadow 0.25s, transform 0.2s;
}
.stat-card:hover {
  box-shadow: var(--wb-shadow-lg);
  transform: translateY(-2px);
}
.stat-card__icon {
  width: 46px;
  height: 46px;
  border-radius: var(--wb-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}
.stat-icon--pending { background: #EEF2FF; color: var(--wb-primary); }
.stat-icon--wrong { background: #FEE2E2; color: var(--wb-danger); }
.stat-icon--retry { background: #EDE9FE; color: var(--wb-accent); }
.stat-icon--student { background: #DCFCE7; color: var(--wb-success); }

.stat-card__body { flex: 1; min-width: 0; }
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--wb-text);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.stat-label {
  font-size: 13px;
  color: var(--wb-text-secondary);
  margin-top: 2px;
}
.stat-card__link {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  white-space: nowrap;
  align-self: flex-end;
}

.dash-alert { margin-top: 16px; }

.dash-main {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
  margin-top: 16px;
}
.card {
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-shadow-sm);
  padding: 18px 20px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--wb-text);
}
.card-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 36px 0;
  color: var(--wb-text-tertiary);
  font-size: 13px;
}

.recent-list { display: flex; flex-direction: column; }
.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}
.recent-item:hover { background: var(--wb-bg-hover); }
.recent-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--wb-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-student {
  font-size: 12px;
  color: var(--wb-text-secondary);
}
.recent-time {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.shortcut-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  background: var(--wb-bg-elevated);
}
.shortcut-item:hover {
  border-color: var(--wb-primary-soft);
  background: var(--wb-primary-mist);
}
.shortcut-item--disabled { cursor: not-allowed; opacity: 0.5; }
.shortcut-item--disabled:hover { background: var(--wb-bg-elevated); border-color: var(--wb-border-light); }
.shortcut-icon {
  width: 34px;
  height: 34px;
  border-radius: var(--wb-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  flex-shrink: 0;
}
.shortcut-label { font-size: 14px; color: var(--wb-text); font-weight: 500; }
.shortcut-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 0 6px;
  font-size: 10px;
  line-height: 16px;
  border-radius: var(--wb-radius-xs);
  background: var(--wb-warning-soft);
  color: var(--wb-warning);
  border: 1px solid #FDE68A;
}
</style>