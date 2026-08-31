<template>
  <div class="dashboard wb-page">
    <!-- 移动端 sticky 主操作（桌面隐藏） · 通用入口，永远跳到批改中心。
         0 状态下不隐藏也不禁用，给教师一条直达工作区的路。 -->
    <div class="dashboard__sticky-cta">
      <ActionButton variant="primary" @click="go('/grade')">
        <el-icon><ArrowRight /></el-icon>
        去批改中心
      </ActionButton>
    </div>

    <div class="wb-page__inner">
      <PageHeader
        :eyebrow="todayLabel"
        title="早上好，老师"
        :description="briefHeadline"
      />

      <!-- 摘要加载失败：行级提示，不抢主视觉 -->
      <div v-if="notiStore.error && !hasAnyData" class="dashboard-note" role="status">
        <span>摘要加载失败</span>
        <button class="dashboard-note__retry" type="button" @click="notiStore.fetchSummary()">重试</button>
      </div>

      <!-- Briefing 加载骨架：与最终 summary-strip 形状一致，避免 layout shift -->
      <section v-if="initialLoading" class="briefing" aria-busy="true" aria-label="加载今日待办">
        <div class="summary-strip" aria-hidden="true">
          <div v-for="i in 3" :key="i" class="summary-cell">
            <span class="summary-cell__copy">
              <span class="summary-skeleton summary-skeleton--title" />
              <span class="summary-skeleton summary-skeleton--description" />
            </span>
            <span class="summary-skeleton summary-skeleton--count" />
          </div>
        </div>
        <div class="summary-anomaly" aria-hidden="true">
          <span class="summary-anomaly__copy">
            <span class="summary-skeleton summary-skeleton--title" />
            <span class="summary-skeleton summary-skeleton--description" />
          </span>
          <span class="summary-skeleton summary-skeleton--count summary-skeleton--count--anomaly" />
        </div>
      </section>

      <!-- Briefing：今日行动流（Layer 1）—— 3 列 summary-strip + 识别异常行 -->
      <section v-if="!initialLoading && (briefingStrip.length || failedAction)" class="briefing" aria-label="今日待办">
        <!-- 顶部 3 列固定槽位（待复核 / 今日新增错题 / 待重练），0 值也展示 -->
        <div v-if="briefingStrip.length" class="summary-strip">
          <router-link
            v-for="cell in briefingStrip"
            :key="cell.key"
            :to="cell.to"
            class="summary-cell"
            :class="`is-${cell.tone}`"
            :aria-label="`${cell.title}，${cell.count} ${cell.unit}`"
          >
            <span class="summary-cell__copy">
              <strong class="summary-cell__title">{{ cell.title }}</strong>
              <small class="summary-cell__description">{{ cell.description }}</small>
            </span>
            <span class="summary-cell__count">
              <strong>{{ cell.count }}</strong>
              <small>{{ cell.unit }}</small>
            </span>
            <el-icon class="summary-cell__arrow" aria-hidden="true"><ArrowRight /></el-icon>
          </router-link>
        </div>

        <!-- 识别异常：单独 row（0 值也展示，方便老师看到状态） -->
        <router-link
          v-if="failedAction"
          :to="failedAction.to"
          class="summary-anomaly"
          :class="{ 'is-danger': failedCount > 0 }"
          :aria-label="`${failedAction.title}，${failedCount} ${failedAction.unit}`"
        >
          <span class="summary-anomaly__copy">
            <strong class="summary-anomaly__title">{{ failedAction.title }}</strong>
            <small class="summary-anomaly__description">{{ failedAction.description }}</small>
          </span>
          <span class="summary-anomaly__count">
            <strong>{{ failedCount }}</strong>
            <small>{{ failedAction.unit }}</small>
          </span>
          <el-icon class="summary-anomaly__arrow" aria-hidden="true"><ArrowRight /></el-icon>
        </router-link>
      </section>

      <!-- 空态：今天没有行动 -->
      <EmptyState
        v-else
        role="status"
        title="今天没有待处理事项"
        description="新上传的作业和重练任务出现后，会自动列在这里。"
      />

      <!-- Layer 2 · 待复核作业：教师未读 done 任务，与上方 briefing "作业等待复核" 同口径
        入口直达具体 task 复核页（/grade/task?taskId=...） -->
      <section
        v-if="!initialLoading && pendingActivities.length"
        class="recent-activity"
        aria-label="待复核作业"
      >
        <header class="section-header">
          <h2 class="section-header__title">待复核作业</h2>
          <router-link to="/grade" class="section-header__link">
            去批改中心
            <el-icon aria-hidden="true"><ArrowRight /></el-icon>
          </router-link>
        </header>
        <ul class="activity-list">
          <li v-for="act in pendingActivities.slice(0, 5)" :key="act.id">
            <ListRow
              variant="generic"
              :title="`${act.studentName} · ${act.shortName}`"
              :description="`${act.wrongCount ? `${act.wrongCount} 道错题` : '无错题'} · ${act.timeLabel}`"
              :aria-label="`${act.studentName} 的 ${act.shortName} · 待复核 · ${act.timeLabel}`"
              @click="goActivity(act)"
            >
              <template #leading>
                <span class="activity-avatar is-primary">{{ act.studentName.slice(0, 1) }}</span>
              </template>
              <template #trailing>
                <StatusTag tone="info" label="待复核" />
              </template>
            </ListRow>
          </li>
        </ul>
      </section>

      <!-- Layer 2.5 · 诊断与训练：班级薄弱知识点 + 本周重练效果（与 briefing 同屏互补） -->
      <section
        v-if="!initialLoading"
        class="diagnostic-training"
        aria-label="诊断与训练"
      >
        <header class="section-header">
          <h2 class="section-header__title">诊断与训练</h2>
        </header>

        <!-- 班级薄弱知识点 Top 5：按未掌握人数排，每行带「跨 N 个年级」标签 -->
        <div class="diagnostic-training__card">
          <header class="diagnostic-training__card-head">
            <h3 class="diagnostic-training__card-title">班级薄弱知识点</h3>
            <router-link to="/question-bank" class="section-header__link">
              去知识中心
              <el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </router-link>
          </header>
          <ul v-if="dashboardWeakness.length" class="activity-list">
            <li v-for="kp in dashboardWeakness.slice(0, 5)" :key="kp.kpId">
              <ListRow
                variant="generic"
                :title="kp.name"
                :description="weaknessDescription(kp)"
                :aria-label="`${kp.name} · ${weaknessDescription(kp)} · 待讲解`"
                @click="goWeakness(kp)"
              >
                <template #leading>
                  <span class="knowledge-avatar">{{ kp.subject?.slice(0, 1) || '知' }}</span>
                </template>
                <template #trailing>
                  <StatusTag
                    :tone="kp.gradeSpan > 1 ? 'primary' : 'default'"
                    :label="kp.gradeSpan > 1 ? `跨 ${kp.gradeSpan} 个年级` : '单一学段'"
                  />
                </template>
              </ListRow>
            </li>
          </ul>
          <EmptyState
            v-else
            title="班级目前没有明显薄弱知识点"
            description="继续观察，错题与掌握度数据沉淀后会逐步出现。"
          />
        </div>

        <!-- 本周重练效果：3 个 MiniStat（通过率 / 进行中 / 待重练） -->
        <div class="diagnostic-training__card">
          <header class="diagnostic-training__card-head">
            <h3 class="diagnostic-training__card-title">本周重练效果</h3>
            <router-link to="/students?filter=retry" class="section-header__link">
              去重练中心
              <el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </router-link>
          </header>
          <div class="retry-overview">
            <MiniStat label="已掌握率" :value="retryOverview.masteryRate" unit="%" description="班级错题已推进到 review_2 / mastered" />
            <MiniStat label="进行中" :value="retryOverview.inProgress" unit="份" description="重练卷已批改待处理" />
            <MiniStat label="待重练学生" :value="retryOverview.awaitingRetryStudents" unit="人" description="有错题还在错题池里" />
          </div>
        </div>
      </section>

      <!-- Layer 3 · 班级：学生档案总览 + 待关注学生（合并为一段，避免堆 Section） -->
      <section
        v-if="!initialLoading && hasStudents"
        class="attention"
        aria-label="班级"
      >
        <header class="section-header">
          <h2 class="section-header__title">班级</h2>
          <router-link to="/students" class="section-header__link">
            查看全部 {{ students.length }} 名学生
            <el-icon aria-hidden="true"><ArrowRight /></el-icon>
          </router-link>
        </header>

        <!-- 学生档案总览：三列 MiniStat，整行可点击跳学生管理；克制用 MiniStat，全 default tone -->
        <div
          class="student-overview"
          role="button"
          tabindex="0"
          :aria-label="`在读 ${activeCount} 人，停课 ${pausedCount} 人，未活跃 ${inactiveCount} 人 · 查看学生管理`"
          @click="go('/students')"
          @keydown.enter.prevent="go('/students')"
          @keydown.space.prevent="go('/students')"
        >
          <MiniStat label="在读" :value="activeCount" unit="人" />
          <MiniStat label="停课" :value="pausedCount" unit="人" />
          <MiniStat label="未活跃" :value="inactiveCount" unit="人" description="近 7 天未交作业" />
        </div>

        <!-- 待关注学生：top 3，升级为 actionable 类型（补漏/预警/清理/反复错） -->
        <ul v-if="attentionStudents.length" class="attention-list">
          <li v-for="s in attentionStudents.slice(0, 3)" :key="s.id">
            <ListRow
              variant="student"
              :title="s.name"
              :description="s.summary"
              :aria-label="`${s.name} · ${s.summary} · ${s.label}`"
              @click="goAttentionStudent(s)"
            >
              <template #leading>
                <span class="student-avatar">{{ s.name.slice(0, 1) }}</span>
              </template>
              <template #trailing>
                <StatusTag
                  v-if="s.tone && s.tone !== 'default'"
                  :tone="s.tone"
                  :label="s.label"
                />
              </template>
            </ListRow>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight } from '@element-plus/icons-vue'
import {
  getStudents,
  getDashboardWeakness,
  getDashboardRetryOverview,
  getDashboardAttentionStudents
} from '../../services/apiService'
import { useNotificationStore } from '../stores/notificationStore'
import ActionButton from '../components/ui/ActionButton.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ListRow from '../components/ui/ListRow.vue'
import MiniStat from '../components/ui/MiniStat.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusTag from '../components/ui/StatusTag.vue'

const router = useRouter()
const notiStore = useNotificationStore()
const students = ref([])
const initialLoading = ref(true)
// Dashboard 聚合：薄弱知识点 + 本周重练 + actionable 学生
const dashboardWeakness = ref([])
const retryOverview = ref({ masteryRate: 0, inProgress: 0, awaitingRetryStudents: 0 })
const attentionStudentsRaw = ref([])

const todayLabel = computed(() =>
  new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
)

const pendingCount = computed(() => notiStore.summary.pendingReview || 0)
const failedCount = computed(() => notiStore.summary.failedTasks || 0)
const wrongCount = computed(() => notiStore.summary.todayNewWrongQuestions || 0)
const retryCount = computed(() => retryOverview.value?.awaitingRetryStudents || 0)

// 总"件事"：以"行"为单位（>0 才算 1 件），不再把数字叠加，避免「5 件事」和「5 道错题」混淆
const totalCount = computed(() =>
  (pendingCount.value > 0 ? 1 : 0) +
  (failedCount.value > 0 ? 1 : 0) +
  (wrongCount.value > 0 ? 1 : 0) +
  (retryCount.value > 0 ? 1 : 0)
)

const briefHeadline = computed(() => {
  if (totalCount.value === 0) return '今天没有待处理事项'
  return `今日 ${totalCount.value} 件事需要处理`
})

// 顶部 3 列固定 summary-strip（待复核 / 今日新增错题 / 待重练），0 值也展示，0 时降为 default tone
const briefingStrip = computed(() => [
  {
    key: 'pending',
    count: pendingCount.value,
    unit: '份',
    title: '待复核',
    description: pendingCount.value > 0
      ? 'AI 批改完成，等待老师确认正误与判分。'
      : '今日没有待复核的作业。',
    tone: pendingCount.value > 0 ? 'primary' : 'default',
    to: '/grade'
  },
  {
    key: 'wrong',
    count: wrongCount.value,
    unit: '道',
    title: '今日新增错题',
    description: wrongCount.value > 0
      ? '来自近期学生作业，进入错题中心安排重练与掌握验证。'
      : '今日暂无新增错题。',
    tone: wrongCount.value > 0 ? 'warning' : 'default',
    to: '/wrongbook'
  },
  {
    key: 'retry',
    count: retryCount.value,
    unit: '人',
    title: '待重练',
    description: retryCount.value > 0
      ? '错题在错题池里尚未消化，可组卷下发让学生重练。'
      : '今天没有需要安排的重练任务。',
    tone: retryCount.value > 0 ? 'success' : 'default',
    to: { path: '/students', query: { filter: 'retry' } }
  }
])

// 识别异常：单独 row，0 时也展示
const failedAction = computed(() => ({
  key: 'failed',
  count: failedCount.value,
  unit: '份',
  title: '识别异常',
  description: failedCount.value > 0
    ? 'AI 识别失败，可进入批改中心重新处理或查看原图。'
    : '今日没有识别异常的作业。',
  tone: failedCount.value > 0 ? 'danger' : 'default',
  to: { path: '/grade', query: { status: 'failed' } }
}))

const hasAnyData = computed(() =>
  briefingStrip.value.length > 0 || !!failedAction.value || pendingActivities.value.length > 0 || students.value.length > 0
)

const formatRelativeTime = (iso) => {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const diffMs = Date.now() - t.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return `${t.getMonth() + 1}月${t.getDate()}日`
}

// Layer 2 数据源：未读 done 任务（与 briefing "作业等待复核" 同口径）
// 点击直达 /grade/task?taskId=... 复核页；老师打开复核页后该任务会被标记为已读，
// 下次刷新时自动从 pendingActivities 消失（迁移到 recentTasks 桶）
const pendingActivities = computed(() => {
  const list = notiStore.summary.pendingTasks || []
  return list.map((t) => ({
    id: t.id,
    studentId: null,
    studentName: t.studentName || '学生',
    shortName: (t.originalName || '未命名作业').replace(/\.(jpg|jpeg|png|pdf)$/i, ''),
    wrongCount: t.wrongCount || 0,
    timeLabel: formatRelativeTime(t.updatedAt || t.createdAt)
  }))
})

// ── Layer 3 学生聚合 ──
const hasStudents = computed(() => students.value.length > 0)

const activeCount = computed(() => students.value.filter((s) => s.enrollment_status !== 'paused').length)
const pausedCount = computed(() => students.value.filter((s) => s.enrollment_status === 'paused').length)

// 未活跃：在读 + (last_task_at 为空 OR 距今 > 7 天)
const INACTIVE_DAYS = 7
const inactiveCount = computed(() => {
  const cutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000
  return students.value.filter((s) => {
    if (s.enrollment_status === 'paused') return false
    if (!s.last_task_at) return true
    return new Date(s.last_task_at).getTime() < cutoff
  }).length
})

// 待关注学生：升级为 actionable 类型（补漏/预警/清理/反复错）
// 数据源：/api/dashboard/attention-students（一次性聚合 weak/repeat/recent 三个计数）
const attentionStudents = computed(() => {
  const list = []
  for (const s of attentionStudentsRaw.value) {
    let actionableType = null
    let summary = ''
    let tone = 'default'
    let label = ''

    if (s.weakCount >= 3) {
      actionableType = 'weak'
      summary = `${s.weakCount} 个长期未掌握知识点`
      tone = 'primary'
      label = '补漏'
    } else if (s.repeatCount >= 1) {
      actionableType = 'cleanup'
      summary = `同一题反复错 ${s.repeatCount} 次`
      tone = 'warning'
      label = '清理'
    } else if (s.recentWrongCount >= 5) {
      actionableType = 'declining'
      summary = `近 7 天新增 ${s.recentWrongCount} 道错题`
      tone = 'danger'
      label = '预警'
    } else if (s.totalErrorCount >= 2 || s.recentWrongCount >= 3) {
      actionableType = 'frequent'
      summary = `累计错误 ${s.totalErrorCount} 次`
      tone = 'warning'
      label = '反复错'
    }

    if (actionableType) {
      list.push({
        id: s.id,
        name: s.name,
        grade: s.grade,
        actionableType,
        summary,
        tone,
        label
      })
    }
  }
  return list.slice(0, 3)
})

const go = (path) => router.push(path)
const goActivity = (act) => {
  if (!act.id) return
  router.push({ path: '/grade/task', query: { taskId: act.id, source: 'homework' } })
}
const goStudent = (id) => router.push({ path: `/students/${id}` })
const goAttentionStudent = (s) => router.push({ path: `/students/${s.id}` })
const goWeakness = (kp) => router.push({ path: '/question-bank', query: { kpId: kp.kpId } })
const weaknessDescription = (kp) => {
  const span = kp.gradeSpan > 1 ? `跨 ${kp.gradeSpan} 个年级` : '单一学段'
  return `${kp.studentCount} 人未掌握 · ${span}`
}

onMounted(async () => {
  notiStore.fetchSummary()
  // Dashboard 三个聚合 API 并行加载（失败互不影响）
  Promise.allSettled([
    getDashboardWeakness(5).then((d) => { dashboardWeakness.value = d?.weakness || [] }),
    getDashboardRetryOverview().then((d) => { retryOverview.value = d?.overview || { masteryRate: 0, inProgress: 0, awaitingRetryStudents: 0 } }),
    getDashboardAttentionStudents(8).then((d) => { attentionStudentsRaw.value = d?.students || [] })
  ]).catch((e) => console.error('[Dashboard] 加载聚合数据失败:', e))

  try {
    const result = await getStudents(false)
    const list = result && result.data !== undefined ? result.data : (Array.isArray(result) ? result : [])
    students.value = Array.isArray(list) ? list : []
  } catch (e) {
    console.error('[Dashboard] 获取学生列表失败:', e)
    students.value = []
  } finally {
    initialLoading.value = false
  }
})
</script>

<style scoped>
.dashboard { color: var(--wb-text); }

/* ── Layer 2.5 · 诊断与训练（班级薄弱知识点 + 本周重练） ── */
.diagnostic-training { margin-bottom: var(--wb-space-5); }

.diagnostic-training__card {
  margin-bottom: var(--wb-space-3);
  padding: var(--wb-space-3) var(--wb-space-4);
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
}
.diagnostic-training__card:last-child { margin-bottom: 0; }

.diagnostic-training__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-3);
  margin-bottom: var(--wb-space-2);
}
.diagnostic-training__card-title {
  margin: 0;
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  line-height: var(--wb-lh-tight);
}

.retry-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--wb-space-3);
}
@media (max-width: 640px) {
  .retry-overview { grid-template-columns: 1fr; }
}

.knowledge-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--wb-status-warning-fg);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-status-warning-bg);
  border-radius: 50%;
  flex-shrink: 0;
}

.diagnostic-training__card :deep(.ds-list-row) {
  padding: var(--wb-space-2) 0;
}

/* ── 移动端 sticky 主操作 ── */
.dashboard__sticky-cta { display: none; }
@media (max-width: 640px) {
  .dashboard__sticky-cta {
    display: flex;
    position: sticky;
    bottom: var(--wb-space-3);
    justify-content: center;
    margin-top: var(--wb-space-4);
    z-index: 10;
  }
}

/* ── 摘要失败行级提示（替代 InlineAlert，克制） ── */
.dashboard-note {
  display: flex;
  align-items: center;
  gap: var(--wb-space-3);
  padding: var(--wb-space-3) var(--wb-space-4);
  margin-bottom: var(--wb-space-4);
  color: var(--wb-status-warning-fg);
  font-size: var(--wb-fs-meta);
  background: var(--wb-status-warning-bg);
  border-radius: var(--wb-radius-md);
}
.dashboard-note__retry {
  margin-left: auto;
  padding: var(--wb-space-1) calc(var(--wb-space-2) + var(--wb-space-1));
  color: var(--wb-status-warning-fg);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-semibold);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.dashboard-note__retry:hover { color: var(--wb-text); }

/* ── Briefing 列表：3 列 summary-strip + 识别异常行（Layer 1 · 已有） ── */
.briefing { margin-bottom: var(--wb-space-5); }

/* 顶部 3 列固定槽位（待复核 / 今日新增错题 / 待重练），0 值也展示 */
.summary-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--wb-border-light);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}

.summary-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-2);
  min-height: 96px;
  padding: var(--wb-space-3) var(--wb-space-4);
  color: inherit;
  text-decoration: none;
  background: var(--wb-bg-card);
  box-shadow: inset 3px 0 0 transparent;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.summary-cell:hover { background: var(--wb-bg-hover); }
.summary-cell:focus-visible {
  outline: 2px solid var(--wb-primary);
  outline-offset: -2px;
  z-index: 1;
}
.summary-cell.is-primary { box-shadow: inset 3px 0 0 var(--wb-primary); }
.summary-cell.is-warning { box-shadow: inset 3px 0 0 var(--wb-status-warning-fg); }
.summary-cell.is-danger { box-shadow: inset 3px 0 0 var(--wb-status-danger-fg); }
.summary-cell.is-success { box-shadow: inset 3px 0 0 var(--wb-status-success-fg); }
.summary-cell.is-default { box-shadow: inset 3px 0 0 transparent; }

.summary-cell__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--wb-space-1);
  padding-right: 24px;
}
.summary-cell__title {
  color: var(--wb-text);
  font-size: var(--wb-fs-card-title);
  font-weight: var(--wb-fw-semibold);
  line-height: var(--wb-lh-tight);
}
.summary-cell__description {
  overflow: hidden;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  line-height: var(--wb-lh-normal);
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
}

.summary-cell__count {
  display: flex;
  align-items: baseline;
  gap: var(--wb-space-1);
  min-width: 0;
  margin-top: auto;
  font-variant-numeric: tabular-nums;
}
.summary-cell__count strong {
  color: var(--wb-text);
  font-size: var(--wb-fs-stat);
  font-weight: var(--wb-fw-bold);
  line-height: var(--wb-lh-tight);
  letter-spacing: -0.01em;
}
.summary-cell__count small {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-regular);
}
.summary-cell.is-primary .summary-cell__count strong { color: var(--wb-primary); }
.summary-cell.is-warning .summary-cell__count strong { color: var(--wb-status-warning-fg); }
.summary-cell.is-danger .summary-cell__count strong { color: var(--wb-status-danger-fg); }
.summary-cell.is-success .summary-cell__count strong { color: var(--wb-status-success-fg); }
.summary-cell.is-default .summary-cell__count strong { color: var(--wb-text-tertiary); }

.summary-cell__arrow {
  position: absolute;
  top: var(--wb-space-3);
  right: var(--wb-space-4);
  color: var(--wb-text-tertiary);
  font-size: 16px;
  transition: transform var(--wb-motion-fast) var(--wb-motion-ease),
              color var(--wb-motion-fast) var(--wb-motion-ease);
}
.summary-cell:hover .summary-cell__arrow {
  color: var(--wb-primary);
  transform: translateX(2px);
}

/* 识别异常：单独一整行（0 值也展示，让老师能看到状态） */
.summary-anomaly {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 20px;
  align-items: center;
  gap: var(--wb-space-4);
  min-height: 72px;
  margin-top: var(--wb-space-3);
  padding: var(--wb-space-3) var(--wb-space-4);
  color: inherit;
  text-decoration: none;
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  box-shadow: inset 3px 0 0 transparent;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.summary-anomaly:hover { background: var(--wb-bg-hover); }
.summary-anomaly.is-danger { box-shadow: inset 3px 0 0 var(--wb-status-danger-fg); }

.summary-anomaly__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--wb-space-1);
}
.summary-anomaly__title {
  color: var(--wb-text);
  font-size: var(--wb-fs-card-title);
  font-weight: var(--wb-fw-semibold);
  line-height: var(--wb-lh-tight);
}
.summary-anomaly__description {
  overflow: hidden;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  line-height: var(--wb-lh-normal);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-anomaly__count {
  display: flex;
  align-items: baseline;
  gap: var(--wb-space-1);
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.summary-anomaly__count strong {
  color: var(--wb-text);
  font-size: var(--wb-fs-stat);
  font-weight: var(--wb-fw-bold);
  line-height: var(--wb-lh-tight);
}
.summary-anomaly.is-danger .summary-anomaly__count strong { color: var(--wb-status-danger-fg); }
.summary-anomaly__count small {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}

.summary-anomaly__arrow {
  color: var(--wb-text-tertiary);
  font-size: 16px;
  transition: transform var(--wb-motion-fast) var(--wb-motion-ease),
              color var(--wb-motion-fast) var(--wb-motion-ease);
}
.summary-anomaly:hover .summary-anomaly__arrow {
  color: var(--wb-primary);
  transform: translateX(2px);
}

@media (max-width: 720px) {
  .summary-strip { grid-template-columns: 1fr; }
}

/* ── Briefing 骨架：summary-strip / summary-anomaly 形状的骨架，避免 layout shift ── */
@keyframes briefing-skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.summary-skeleton {
  display: block;
  background: linear-gradient(90deg, var(--wb-bg-hover), var(--wb-border-light), var(--wb-bg-hover));
  background-size: 200% 100%;
  animation: briefing-skeleton-shimmer 1.4s linear infinite;
  border-radius: var(--wb-radius-sm);
}
.summary-skeleton--title { width: 32%; height: 14px; }
.summary-skeleton--description { width: 70%; height: 12px; margin-top: 6px; }
.summary-skeleton--count { width: 56px; height: 24px; margin-top: auto; }
.summary-skeleton--count--anomaly { width: 48px; height: 22px; }

/* ── Section Header：4 层结构统一节奏，--wb-fs-card-title + semibold ── */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-3);
  margin-bottom: var(--wb-space-3);
}
.section-header__title {
  margin: 0;
  color: var(--wb-text);
  font-size: var(--wb-fs-card-title);
  font-weight: var(--wb-fw-semibold);
  line-height: var(--wb-lh-tight);
}
.section-header__link {
  display: inline-flex;
  align-items: center;
  gap: var(--wb-space-1);
  color: var(--wb-primary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
  text-decoration: none;
  transition: color var(--wb-motion-fast) var(--wb-motion-ease);
}
.section-header__link:hover { color: var(--wb-primary-hover); }
.section-header__link:focus-visible {
  outline: 2px solid var(--wb-primary);
  outline-offset: 2px;
  border-radius: var(--wb-radius-sm);
}

/* ── Layer 2 · 最近批改完成 ── */
.recent-activity {
  margin-bottom: var(--wb-space-5);
  padding: var(--wb-space-3) var(--wb-space-4);
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
}

.activity-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.activity-list li {
  border-top: 1px solid var(--wb-border-light);
}
.activity-list li:first-child {
  border-top: 0;
}
.activity-list :deep(.ds-list-row) {
  padding: var(--wb-space-2) 0;
}

/* Layer 2 avatar：32px，比批改中心 task-item 38px 略小（工作台密度高） */
.activity-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-bg-hover);
  border-radius: 50%;
  flex-shrink: 0;
}
.activity-avatar.is-danger {
  color: var(--wb-status-danger-fg);
  background: var(--wb-status-danger-bg);
}
.activity-avatar.is-success {
  color: var(--wb-status-success-fg);
  background: var(--wb-status-success-bg);
}

/* ── Layer 3 · 班级（合并段：学生总览 + 待关注） ── */
.attention {
  margin-bottom: var(--wb-space-5);
}

.student-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--wb-space-3);
  padding: var(--wb-space-3) var(--wb-space-4);
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  cursor: pointer;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.student-overview:hover { background: var(--wb-bg-hover); }
.student-overview:focus-visible {
  outline: 2px solid var(--wb-primary);
  outline-offset: 2px;
}

/* MiniStat 三列在 < 640px 改 1 列堆叠 */
@media (max-width: 640px) {
  .student-overview { grid-template-columns: 1fr; }
}

.attention-list {
  margin: var(--wb-space-3) 0 0;
  padding: 0;
  list-style: none;
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
}
.attention-list li {
  border-top: 1px solid var(--wb-border-light);
}
.attention-list li:first-child {
  border-top: 0;
}

/* Layer 3 student avatar：32px，统一工作台密度 */
.student-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--wb-primary);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-primary-soft);
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── 响应式 ── */
@media (max-width: 720px) {
  .summary-strip { grid-template-columns: 1fr; }
}

/* ── reduced-motion ── */
@media (prefers-reduced-motion: reduce) {
  .summary-cell,
  .summary-cell__arrow,
  .summary-anomaly,
  .summary-anomaly__arrow,
  .summary-skeleton { transition: none !important; animation: none !important; }
  .summary-cell:hover .summary-cell__arrow,
  .summary-anomaly:hover .summary-anomaly__arrow { transform: none; }
}
</style>