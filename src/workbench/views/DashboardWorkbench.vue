<template>
  <div class="dashboard wb-page">
    <!-- 移动端 sticky 主操作（桌面隐藏） · 通用入口，永远跳到批改中心 -->
    <div class="dashboard__sticky-cta">
      <ActionButton variant="primary" @click="go('/grade')">
        <el-icon><ArrowRight /></el-icon>
        去批改中心
      </ActionButton>
    </div>

    <div class="wb-page__inner">
      <!-- 页头：按时段问候 + 一句话状态 + 全页唯一主操作 -->
      <PageHeader
        :eyebrow="todayLabel"
        :title="`${greeting}，老师`"
        :description="briefHeadline"
      >
        <template #actions>
          <ActionButton variant="primary" @click="go('/grade')">
            开始批改
            <el-icon><ArrowRight /></el-icon>
          </ActionButton>
        </template>
      </PageHeader>

      <!-- 学生规模摘要：低频信息收敛为一行灰字（替代原三列 MiniStat 卡片） -->
      <p v-if="!initialLoading && hasStudents" class="roster-line">
        在读 {{ activeCount }} 人 · 停课 {{ pausedCount }} 人 · 近 {{ INACTIVE_DAYS }} 天未交作业 {{ inactiveCount }} 人
        <router-link to="/students" class="roster-line__link">管理</router-link>
      </p>

      <!-- 摘要加载失败：行级提示 -->
      <div v-if="notiStore.error && !hasAnyData" class="dashboard-note" role="status">
        <span>摘要加载失败</span>
        <button class="dashboard-note__retry" type="button" @click="notiStore.fetchSummary()">重试</button>
      </div>

      <!-- 加载骨架 -->
      <div v-if="initialLoading" class="cockpit" aria-busy="true" aria-label="加载工作台">
        <div class="cockpit__main">
          <div class="skeleton-strip">
            <span v-for="i in 3" :key="i" class="skeleton-block skeleton-block--kpi" />
          </div>
          <span class="skeleton-block skeleton-block--chart" />
        </div>
        <div class="cockpit__side">
          <span class="skeleton-block skeleton-block--panel" />
          <span class="skeleton-block skeleton-block--panel" />
        </div>
      </div>

      <!-- 两栏驾驶舱：左=行动与趋势，右=实时与提醒 -->
      <div v-else class="cockpit">
        <!-- ───── 左列：主工作流 ───── -->
        <div class="cockpit__main">
          <!-- ① KPI 三卡：单位统一（份/道/道），去描述文案，脚注给可核对的衍生指标 -->
          <div class="kpi-strip">
            <router-link
              v-for="k in kpiCards"
              :key="k.key"
              :to="k.to"
              class="kpi-card"
              :class="`is-${k.tone}`"
              :aria-label="`${k.title}，${k.count} ${k.unit}`"
            >
              <span class="kpi-card__title">{{ k.title }}</span>
              <span class="kpi-card__value">
                <strong>{{ k.count }}</strong>
                <small>{{ k.unit }}</small>
              </span>
              <span class="kpi-card__foot">
                <span
                  v-if="k.delta != null"
                  class="kpi-card__delta"
                  :class="k.delta > 0 ? 'is-up-bad' : k.delta < 0 ? 'is-down-good' : 'is-flat'"
                >
                  {{ k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '—' }} {{ Math.abs(k.delta) }}
                </span>
                {{ k.foot }}
              </span>
            </router-link>
          </div>

          <!-- ② 近 7 日趋势：柱=作业量，线=新增错题（双轴） -->
          <section class="panel" aria-label="近 7 日趋势">
            <header class="panel__head">
              <h2 class="panel__title">近 7 日趋势</h2>
              <span class="panel__legend">
                <span class="legend-dot is-bar" />作业量
                <span class="legend-dot is-line" />新增错题
              </span>
            </header>
            <div v-if="hasTrend" ref="trendChartRef" class="chart chart--trend" />
            <EmptyState
              v-else
              compact
              title="近 7 日暂无批改记录"
              description="开始批改作业后，这里会显示每日作业量与新增错题的走势。"
            />
          </section>

          <!-- ③ 错题消化：进度环 + 班级薄弱知识点 Top5 横向条 -->
          <section class="panel" aria-label="错题消化与薄弱点">
            <header class="panel__head">
              <h2 class="panel__title">错题消化</h2>
              <router-link to="/students" class="panel__link">
                按学生查看 <el-icon aria-hidden="true"><ArrowRight /></el-icon>
              </router-link>
            </header>
            <div class="digest">
              <div v-if="digestTotal > 0" class="digest__donut">
                <div ref="digestChartRef" class="chart chart--donut" />
              </div>
              <div v-else class="digest__donut digest__donut--empty">
                <EmptyState compact title="暂无错题数据" description="批改产生的错题会在这里汇总消化进度。" />
              </div>

              <div class="digest__weak">
                <div class="digest__weak-head">
                  <span class="digest__weak-title">班级薄弱知识点 Top 5</span>
                  <router-link to="/question-bank" class="panel__link">知识中心</router-link>
                </div>
                <ul v-if="weakBars.length" class="weak-list">
                  <li v-for="kp in weakBars" :key="kp.kpId" class="weak-row" @click="goWeakness(kp)">
                    <span class="weak-row__name">{{ kp.name }}</span>
                    <span class="weak-row__track">
                      <span class="weak-row__fill" :style="{ width: kp.pct + '%' }" />
                    </span>
                    <span class="weak-row__count">{{ kp.studentCount }} 人</span>
                  </li>
                </ul>
                <EmptyState v-else compact title="无明显薄弱点" description="继续观察，数据沉淀后会逐步出现。" />
              </div>
            </div>
          </section>
        </div>

        <!-- ───── 右列：实时 + 提醒 + 待关注 ───── -->
        <div class="cockpit__side">
          <!-- ④ 系统提醒带：识别异常 + 待补入 合并，0/0 时整卡消失 -->
          <section v-if="reminderRows.length" class="panel panel--warn" aria-label="系统提醒">
            <header class="panel__head">
              <h2 class="panel__title">需要处理</h2>
              <span class="panel__badge">{{ reminderTotal }}</span>
            </header>
            <ul class="remind-list">
              <li v-for="r in reminderRows" :key="r.key">
                <ListRow
                  variant="generic"
                  :title="r.title"
                  :description="r.description"
                  :aria-label="`${r.title}，${r.count} ${r.unit}`"
                  @click="go(r.to)"
                >
                  <template #leading>
                    <span class="remind-icon" :class="`is-${r.tone}`">
                      <el-icon :size="15"><WarningFilled /></el-icon>
                    </span>
                  </template>
                  <template #trailing>
                    <span class="remind-count" :class="`is-${r.tone}`">{{ r.count }}{{ r.unit }}</span>
                  </template>
                </ListRow>
              </li>
            </ul>
          </section>

          <!-- ⑤ 批改中：轮询实时进度，无任务时整卡消失 -->
          <section v-if="notiStore.hasInProgress" class="panel" aria-label="批改中">
            <header class="panel__head">
              <h2 class="panel__title">批改中</h2>
              <span class="panel__live"><span class="live-dot" />{{ notiStore.inProgressCount }} 份</span>
            </header>
            <ul class="mini-list">
              <li v-for="t in notiStore.inProgressTasks.slice(0, 5)" :key="t.id">
                <ListRow
                  variant="generic"
                  :title="`${t.studentName || '学生'} · ${t.originalName || '未命名作业'}`"
                  :description="`${t.subject || '未分类'} · ${formatElapsed(t.elapsedSec)}${t.isStalled ? ' · 已卡 5 分钟' : ''}`"
                  :aria-label="`${t.studentName || '学生'} 的 ${t.originalName || '未命名作业'} 正在批改`"
                  @click="go('/grade')"
                >
                  <template #leading>
                    <span class="mini-avatar is-primary">
                      <el-icon v-if="!t.isStalled" :size="15" class="is-spinning"><Loading /></el-icon>
                      <el-icon v-else :size="15"><WarningFilled /></el-icon>
                    </span>
                  </template>
                  <template #trailing>
                    <StatusTag :tone="t.isStalled ? 'danger' : 'info'" :label="t.isStalled ? '卡住' : '批改中'" />
                  </template>
                </ListRow>
              </li>
            </ul>
          </section>

          <!-- ⑥ 待关注学生 Top3 -->
          <section class="panel" aria-label="待关注学生">
            <header class="panel__head">
              <h2 class="panel__title">待关注学生</h2>
              <router-link to="/students" class="panel__link">全部</router-link>
            </header>
            <ul v-if="attentionStudents.length" class="mini-list">
              <li v-for="s in attentionStudents" :key="s.id">
                <ListRow
                  variant="student"
                  :title="s.name"
                  :description="s.summary"
                  :aria-label="`${s.name} · ${s.summary} · ${s.label}`"
                  @click="goAttentionStudent(s)"
                >
                  <template #leading>
                    <span class="mini-avatar is-student">{{ s.name.slice(0, 1) }}</span>
                  </template>
                  <template #trailing>
                    <StatusTag v-if="s.tone && s.tone !== 'default'" :tone="s.tone" :label="s.label" />
                  </template>
                </ListRow>
              </li>
            </ul>
            <EmptyState v-else compact title="暂无需要特别关注的学生" description="出现反复错题或长期未掌握时会列在这里。" />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Loading, WarningFilled } from '@element-plus/icons-vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart as EChartsPieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { LinearGradient } from 'echarts/lib/util/graphic'
import {
  getStudents,
  getDashboardWeakness,
  getDashboardRetryOverview,
  getDashboardAttentionStudents,
  getDashboardDailyTrend,
  getGatePendingItems
} from '../../services/apiService'
import { useNotificationStore } from '../stores/notificationStore'
import ActionButton from '../components/ui/ActionButton.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ListRow from '../components/ui/ListRow.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusTag from '../components/ui/StatusTag.vue'

echarts.use([BarChart, LineChart, EChartsPieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const router = useRouter()
// 图表入场动画尊重系统「减弱动效」偏好（与 CSS 动画降级一致）
const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
const notiStore = useNotificationStore()

const students = ref([])
const initialLoading = ref(true)
const dashboardWeakness = ref([])
const retryOverview = ref({ fullyMasteredRate: 0, basicMasteredRate: 0, masteryRate: 0, inProgress: 0, awaitingRetryStudents: 0, total: 0, fullyMastered: 0, basicMastered: 0, undigested: 0 })
const attentionStudentsRaw = ref([])
const gatePendingCount = ref(0)
const trend = ref([])

// ── 图表实例与容器 ──
const trendChartRef = ref(null)
const digestChartRef = ref(null)
let trendChart = null
let digestChart = null

// ── 基础聚合 ──
const todayLabel = computed(() =>
  new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
)

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '凌晨好'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

// 「待复核」= 真正等老师动手的**卷数**，口径与批改中心 chip「待人工复核」同源
// （服务端 /api/tasks/summary 的 pendingReviewPapers，实现见 utils/pendingReviewCaliber.js）。
// ⛔ 不要退回 summary.pendingReview —— 那是**未读通知数**，老师点一次通知铃铛
//    （App.jsx#handleOpenNotifications → markNotificationsRead）就全部标已读、数字塌缩到 0，
//    于是首页显示 1 份、点进批改中心却是 7 份（2026-10-09 事故）。
// 老接口/老缓存缺 pendingReviewPapers 时才退回未读数（宁可少报，也不能让卡片空着）。
const pendingCount = computed(
  () => notiStore.summary.pendingReviewPapers ?? notiStore.summary.pendingReview ?? 0
)
const failedCount = computed(() => notiStore.summary.failedTasks || 0)
const wrongCount = computed(() => notiStore.summary.todayNewWrongQuestions || 0)
const undigestedCount = computed(() => retryOverview.value?.undigested || 0)

// 近 7 日趋势派生：今/昨对比，供 KPI 脚注和环比使用
const hasTrend = computed(() => trend.value.some(d => (d.tasksDone || 0) + (d.newWrong || 0) > 0))
const todayCell = computed(() => trend.value[trend.value.length - 1] || { tasksDone: 0, newWrong: 0 })
const ydayCell = computed(() => trend.value[trend.value.length - 2] || { tasksDone: 0, newWrong: 0 })
const wrongDelta = computed(() => {
  if (!trend.value.length) return null
  return (todayCell.value.newWrong || 0) - (ydayCell.value.newWrong || 0)
})

// 总"件事"（以行为单位，避免与"多少道"混淆）
const totalCount = computed(() =>
  (pendingCount.value > 0 ? 1 : 0) +
  (failedCount.value > 0 ? 1 : 0) +
  (wrongCount.value > 0 ? 1 : 0) +
  (undigestedCount.value > 0 ? 1 : 0)
)
const briefHeadline = computed(() =>
  totalCount.value === 0 ? '今天没有待处理事项' : `今日 ${totalCount.value} 件事需要处理`
)

// ① KPI 三卡：单位统一 份/道/道，脚注是可核对的衍生指标（非固定营销文案）
const kpiCards = computed(() => [
  {
    key: 'pending',
    title: '待复核',
    count: pendingCount.value,
    unit: '份',
    foot: `今日已批改 ${todayCell.value.tasksDone || 0} 份`,
    delta: null,
    tone: pendingCount.value > 0 ? 'primary' : 'default',
    to: '/grade'
  },
  {
    key: 'wrong',
    title: '今日新增错题',
    count: wrongCount.value,
    unit: '道',
    foot: '较昨日',
    delta: wrongDelta.value,
    tone: wrongCount.value > 0 ? 'warning' : 'default',
    to: '/students'
  },
  {
    key: 'undigested',
    title: '待消化错题',
    count: undigestedCount.value,
    unit: '道',
    foot: `已完全掌握 ${retryOverview.value.fullyMasteredRate || 0}%`,
    delta: null,
    tone: undigestedCount.value > 0 ? 'success' : 'default',
    to: { path: '/students', query: { filter: 'retry' } }
  }
])

// ③ 消化进度环数据
const digestTotal = computed(() => retryOverview.value?.total || 0)
const digestData = computed(() => [
  { name: '完全掌握', value: retryOverview.value.fullyMastered || 0 },
  { name: '基本掌握', value: retryOverview.value.basicMastered || 0 },
  { name: '未消化', value: retryOverview.value.undigested || 0 }
])

// ③ 薄弱知识点 Top5 横向条（按未掌握人数归一化）
const weakBars = computed(() => {
  const list = dashboardWeakness.value.slice(0, 5)
  const max = list.reduce((m, k) => Math.max(m, k.studentCount || 0), 0)
  return list.map(k => ({
    ...k,
    pct: max > 0 ? Math.round(((k.studentCount || 0) / max) * 100) : 0
  }))
})

// ④ 系统提醒带：识别异常（>0）+ 待补入（>0）合并
const reminderRows = computed(() => {
  const rows = []
  if (failedCount.value > 0) {
    rows.push({ key: 'failed', title: '识别异常', description: 'AI 识别失败，可重新处理或查看原图', count: failedCount.value, unit: '份', tone: 'danger', to: { path: '/grade', query: { status: 'failed' } } })
  }
  if (gatePendingCount.value > 0) {
    rows.push({ key: 'gate', title: '错题待补入错题本', description: '因缺图/缺选项未入册，补全后自动入册', count: gatePendingCount.value, unit: '道', tone: 'warning', to: { path: '/grade/task', query: { source: 'homework', gate: '1' } } })
  }
  return rows
})
const reminderTotal = computed(() => reminderRows.value.reduce((s, r) => s + r.count, 0))

const hasAnyData = computed(() =>
  pendingCount.value > 0 || failedCount.value > 0 || wrongCount.value > 0 ||
  undigestedCount.value > 0 || notiStore.hasInProgress || students.value.length > 0
)

// ── Layer 3 学生聚合 ──
const hasStudents = computed(() => students.value.length > 0)
const activeCount = computed(() => students.value.filter(s => s.enrollment_status !== 'paused').length)
const pausedCount = computed(() => students.value.filter(s => s.enrollment_status === 'paused').length)
const INACTIVE_DAYS = 7
const inactiveCount = computed(() => {
  const cutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000
  return students.value.filter(s => {
    if (s.enrollment_status === 'paused') return false
    if (!s.last_task_at) return true
    return new Date(s.last_task_at).getTime() < cutoff
  }).length
})

const attentionStudents = computed(() => {
  const list = []
  for (const s of attentionStudentsRaw.value) {
    let actionableType = null
    let summary = ''
    let tone = 'default'
    let label = ''
    if (s.weakCount >= 3) { actionableType = 'weak'; summary = `${s.weakCount} 个长期未掌握知识点`; tone = 'primary'; label = '补漏' }
    else if (s.repeatCount >= 1) { actionableType = 'cleanup'; summary = `同一题反复错 ${s.repeatCount} 次`; tone = 'warning'; label = '清理' }
    else if (s.recentWrongCount >= 5) { actionableType = 'declining'; summary = `近 7 天新增 ${s.recentWrongCount} 道错题`; tone = 'danger'; label = '预警' }
    else if (s.totalErrorCount >= 2 || s.recentWrongCount >= 3) { actionableType = 'frequent'; summary = `累计错误 ${s.totalErrorCount} 次`; tone = 'warning'; label = '反复错' }
    if (actionableType) list.push({ id: s.id, name: s.name, grade: s.grade, actionableType, summary, tone, label })
  }
  return list.slice(0, 3)
})

// ── 交互 ──
const go = (path) => router.push(path)
const goAttentionStudent = (s) => router.push({ path: `/students/${s.id}` })
const goWeakness = (kp) => router.push({ path: '/question-bank', query: { kpId: kp.kpId } })
const formatElapsed = (sec) => {
  const s = Number(sec) || 0
  if (s < 60) return `已耗时 ${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `已耗时 ${m} 分钟`
  const h = Math.floor(m / 60)
  return `已耗时 ${h} 小时 ${m % 60} 分`
}

// ── 图表配色：运行时读取 design token，不写死品牌色 ──
const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const shortDay = (iso) => {
  // "2026-09-28" -> "9/28"
  const parts = String(iso).split('-')
  if (parts.length !== 3) return iso
  return `${Number(parts[1])}/${Number(parts[2])}`
}

const renderTrend = () => {
  if (!trendChartRef.value || !hasTrend.value) return
  if (trendChart) trendChart.dispose()
  trendChart = echarts.init(trendChartRef.value)
  const primary = cssVar('--wb-primary', '#6366F1')
  const warn = cssVar('--wb-status-warning-fg', '#D97706')
  const text2 = cssVar('--wb-text-secondary', '#64748B')
  const border = cssVar('--wb-border-light', '#F1F5F9')
  trendChart.setOption({
    animation: !reduceMotion,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: border,
      borderWidth: 1,
      textStyle: { color: cssVar('--wb-text', '#1E293B') }
    },
    grid: { left: 36, right: 36, top: 18, bottom: 26 },
    xAxis: {
      type: 'category',
      data: trend.value.map(d => shortDay(d.date)),
      axisLine: { lineStyle: { color: border } },
      axisTick: { show: false },
      axisLabel: { color: text2, fontSize: 11 }
    },
    yAxis: [
      {
        type: 'value',
        name: '份',
        nameTextStyle: { color: text2, fontSize: 10 },
        minInterval: 1,
        axisLabel: { color: text2, fontSize: 11 },
        splitLine: { lineStyle: { color: border } },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      {
        type: 'value',
        name: '道',
        nameTextStyle: { color: text2, fontSize: 10 },
        minInterval: 1,
        axisLabel: { color: text2, fontSize: 11 },
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false }
      }
    ],
    series: [
      {
        name: '作业量',
        type: 'bar',
        yAxisIndex: 0,
        barWidth: 16,
        data: trend.value.map(d => d.tasksDone || 0),
        itemStyle: { color: primary, borderRadius: [4, 4, 0, 0], opacity: 0.9 }
      },
      {
        name: '新增错题',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        data: trend.value.map(d => d.newWrong || 0),
        lineStyle: { color: warn, width: 2 },
        itemStyle: { color: warn },
        areaStyle: {
          color: new LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(217, 119, 6, 0.16)' },
            { offset: 1, color: 'rgba(217, 119, 6, 0.01)' }
          ])
        }
      }
    ]
  })
}

const renderDigest = () => {
  if (!digestChartRef.value || digestTotal.value <= 0) return
  if (digestChart) digestChart.dispose()
  digestChart = echarts.init(digestChartRef.value)
  const success = cssVar('--wb-status-success-fg', '#16A34A')
  const info = cssVar('--wb-status-info-fg', '#2563EB')
  const warn = cssVar('--wb-status-warning-fg', '#D97706')
  const text = cssVar('--wb-text', '#1E293B')
  digestChart.setOption({
    animation: !reduceMotion,
    tooltip: { trigger: 'item', formatter: '{b}：{c} 道（{d}%）' },
    legend: {
      orient: 'vertical',
      right: 4,
      top: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: cssVar('--wb-text-secondary', '#64748B'), fontSize: 12 }
    },
    series: [
      {
        name: '错题消化',
        type: 'pie',
        radius: ['58%', '80%'],
        center: ['33%', '50%'],
        avoidLabelOverlap: false,
        label: {
          show: true,
          position: 'center',
          formatter: () => `{v|${digestTotal.value}}\n{t|错题总数}`,
          rich: {
            v: { color: text, fontSize: 26, fontWeight: 700, lineHeight: 32 },
            t: { color: cssVar('--wb-text-tertiary', '#94A3B8'), fontSize: 12 }
          }
        },
        emphasis: { scale: false },
        labelLine: { show: false },
        data: [
          { name: '完全掌握', value: digestData.value[0].value, itemStyle: { color: success } },
          { name: '基本掌握', value: digestData.value[1].value, itemStyle: { color: info } },
          { name: '未消化', value: digestData.value[2].value, itemStyle: { color: warn } }
        ]
      }
    ]
  })
}

const resizeCharts = () => {
  trendChart && trendChart.resize()
  digestChart && digestChart.resize()
}

onMounted(async () => {
  notiStore.fetchSummary()
  notiStore.fetchInProgress()
  notiStore.startInProgressPolling()

  Promise.allSettled([
    getDashboardWeakness(5).then(d => { dashboardWeakness.value = d?.weakness || [] }),
    getDashboardRetryOverview().then(d => { if (d?.overview) retryOverview.value = d.overview }),
    getDashboardAttentionStudents(8).then(d => { attentionStudentsRaw.value = d?.students || [] }),
    getDashboardDailyTrend(7).then(d => { trend.value = Array.isArray(d?.series) ? d.series : [] }),
    getGatePendingItems().then(({ total }) => { gatePendingCount.value = total || 0 }).catch(() => {})
  ]).catch(e => console.error('[Dashboard] 加载聚合数据失败:', e))

  try {
    const result = await getStudents(false)
    const list = result && result.data !== undefined ? result.data : (Array.isArray(result) ? result : [])
    students.value = Array.isArray(list) ? list : []
  } catch (e) {
    console.error('[Dashboard] 获取学生列表失败:', e)
    students.value = []
  } finally {
    initialLoading.value = false
    await nextTick()
    renderTrend()
    renderDigest()
    window.addEventListener('resize', resizeCharts)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts)
  trendChart && trendChart.dispose()
  digestChart && digestChart.dispose()
  trendChart = null
  digestChart = null
  notiStore.stopInProgressPolling()
})
</script>

<style scoped>
.dashboard { color: var(--wb-text); }

/* ── 移动端 sticky ── */
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

/* ── 学生规模摘要行 ── */
.roster-line {
  margin: -8px 0 var(--wb-space-5);
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}
.roster-line__link {
  margin-left: var(--wb-space-2);
  color: var(--wb-primary);
  text-decoration: none;
}
.roster-line__link:hover { color: var(--wb-primary-hover); }

/* ── 摘要失败行级提示 ── */
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

/* ── 两栏驾驶舱 ── */
.cockpit {
  display: grid;
  grid-template-columns: minmax(0, 1.62fr) minmax(0, 1fr);
  gap: var(--wb-space-5);
  align-items: start;
}
.cockpit__main,
.cockpit__side {
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-5);
  min-width: 0;
}
@media (max-width: 1080px) {
  .cockpit { grid-template-columns: 1fr; }
}

/* ── ① KPI 三卡 ── */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--wb-border-light);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
  box-shadow: var(--wb-elev-card);
}
.kpi-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-2);
  min-height: 116px;
  padding: var(--wb-space-4) var(--wb-space-5);
  color: inherit;
  text-decoration: none;
  background: var(--wb-bg-card);
  box-shadow: inset 3px 0 0 transparent;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.kpi-card:hover { background: var(--wb-bg-hover); }
.kpi-card:focus-visible { outline: 2px solid var(--wb-primary); outline-offset: -2px; z-index: 1; }
.kpi-card.is-primary { box-shadow: inset 3px 0 0 var(--wb-primary); }
.kpi-card.is-warning { box-shadow: inset 3px 0 0 var(--wb-status-warning-fg); }
.kpi-card.is-success { box-shadow: inset 3px 0 0 var(--wb-status-success-fg); }
.kpi-card.is-default { box-shadow: inset 3px 0 0 transparent; }

.kpi-card__title {
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
}
.kpi-card__value {
  display: flex;
  align-items: baseline;
  gap: var(--wb-space-1);
  margin-top: auto;
  font-variant-numeric: tabular-nums;
}
.kpi-card__value strong {
  color: var(--wb-text);
  font-size: var(--wb-fs-stat);
  font-weight: var(--wb-fw-bold);
  line-height: var(--wb-lh-tight);
  letter-spacing: -0.01em;
}
.kpi-card__value small { color: var(--wb-text-tertiary); font-size: var(--wb-fs-meta); }
.kpi-card.is-primary .kpi-card__value strong { color: var(--wb-primary); }
.kpi-card.is-warning .kpi-card__value strong { color: var(--wb-status-warning-fg); }
.kpi-card.is-success .kpi-card__value strong { color: var(--wb-status-success-fg); }
.kpi-card.is-default .kpi-card__value strong { color: var(--wb-text-tertiary); }

.kpi-card__foot {
  display: flex;
  align-items: center;
  gap: var(--wb-space-1);
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-caption);
}
.kpi-card__delta { font-weight: var(--wb-fw-semibold); font-variant-numeric: tabular-nums; }
.kpi-card__delta.is-up-bad { color: var(--wb-status-danger-fg); }
.kpi-card__delta.is-down-good { color: var(--wb-status-success-fg); }
.kpi-card__delta.is-flat { color: var(--wb-text-tertiary); }
@media (max-width: 720px) {
  .kpi-strip { grid-template-columns: 1fr; }
}

/* ── 通用面板 ── */
.panel {
  padding: var(--wb-space-5) var(--wb-space-6);
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-elev-card);
}
.panel--warn { border-left: 3px solid var(--wb-status-danger-fg); }
.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-3);
  margin-bottom: var(--wb-space-4);
}
.panel__title {
  margin: 0;
  color: var(--wb-text);
  font-size: var(--wb-fs-card-title);
  font-weight: var(--wb-fw-semibold);
  line-height: var(--wb-lh-tight);
}
.panel__link {
  display: inline-flex;
  align-items: center;
  gap: var(--wb-space-1);
  color: var(--wb-primary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
  text-decoration: none;
}
.panel__link:hover { color: var(--wb-primary-hover); }
.panel__badge {
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  color: #fff;
  font-size: var(--wb-fs-caption);
  font-weight: var(--wb-fw-semibold);
  line-height: 22px;
  text-align: center;
  background: var(--wb-status-danger-fg);
  border-radius: 11px;
}
.panel__live {
  display: inline-flex;
  align-items: center;
  gap: var(--wb-space-2);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
}
.live-dot {
  width: 8px;
  height: 8px;
  background: var(--wb-primary);
  border-radius: 50%;
  animation: cockpit-pulse 1.4s ease-in-out infinite;
}
@keyframes cockpit-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}

/* ── ② 趋势图 ── */
.panel__legend {
  display: inline-flex;
  align-items: center;
  gap: var(--wb-space-1);
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-caption);
}
.legend-dot { display: inline-block; width: 10px; height: 10px; margin-left: var(--wb-space-3); border-radius: 3px; }
.legend-dot.is-bar { background: var(--wb-primary); margin-left: 0; }
.legend-dot.is-line { background: var(--wb-status-warning-fg); border-radius: 50%; }
.chart--trend { width: 100%; height: 220px; }

/* ── ③ 消化环 + 薄弱条 ── */
.digest {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  gap: var(--wb-space-6);
  align-items: center;
}
@media (max-width: 900px) {
  .digest { grid-template-columns: 1fr; }
}
.chart--donut { width: 100%; height: 200px; }
.digest__donut--empty { display: flex; align-items: center; justify-content: center; min-height: 160px; }

.digest__weak { min-width: 0; }
.digest__weak-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--wb-space-3);
}
.digest__weak-title {
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
}
.weak-list { margin: 0; padding: 0; list-style: none; }
.weak-row {
  display: grid;
  grid-template-columns: minmax(0, 96px) minmax(0, 1fr) 42px;
  align-items: center;
  gap: var(--wb-space-3);
  padding: var(--wb-space-2) 0;
  cursor: pointer;
}
.weak-row__name {
  overflow: hidden;
  color: var(--wb-text);
  font-size: var(--wb-fs-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.weak-row__track {
  height: 8px;
  background: var(--wb-bg-hover);
  border-radius: 4px;
  overflow: hidden;
}
.weak-row__fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--wb-primary-soft), var(--wb-primary));
  border-radius: 4px;
  transition: width var(--wb-motion-slow) var(--wb-motion-ease);
}
.weak-row__count {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-caption);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.weak-row:hover .weak-row__name { color: var(--wb-primary); }

/* ── ④ 提醒带 ── */
.remind-list { margin: 0; padding: 0; list-style: none; }
.remind-list li { border-top: 1px solid var(--wb-border-light); }
.remind-list li:first-child { border-top: 0; }
.remind-list :deep(.ds-list-row) { padding: var(--wb-space-3) 0; }
.remind-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
}
.remind-icon.is-danger { color: var(--wb-status-danger-fg); background: var(--wb-status-danger-bg); }
.remind-icon.is-warning { color: var(--wb-status-warning-fg); background: var(--wb-status-warning-bg); }
.remind-count { font-size: var(--wb-fs-body); font-weight: var(--wb-fw-bold); font-variant-numeric: tabular-nums; }
.remind-count.is-danger { color: var(--wb-status-danger-fg); }
.remind-count.is-warning { color: var(--wb-status-warning-fg); }

/* ── ⑤⑥ 迷你列表 ── */
.mini-list { margin: 0; padding: 0; list-style: none; }
.mini-list li { border-top: 1px solid var(--wb-border-light); }
.mini-list li:first-child { border-top: 0; }
.mini-list :deep(.ds-list-row) { padding: var(--wb-space-3) 0; }
.mini-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-semibold);
}
.mini-avatar.is-primary { color: var(--wb-primary); background: var(--wb-primary-soft); }
.mini-avatar.is-student { color: var(--wb-primary); background: var(--wb-primary-soft); }
.is-spinning { animation: cockpit-spin 1.4s linear infinite; }
@keyframes cockpit-spin { to { transform: rotate(360deg); } }

/* ── 骨架 ── */
@keyframes cockpit-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.skeleton-block {
  display: block;
  background: linear-gradient(90deg, var(--wb-bg-hover), var(--wb-border-light), var(--wb-bg-hover));
  background-size: 200% 100%;
  animation: cockpit-shimmer 1.4s linear infinite;
  border-radius: var(--wb-radius-md);
}
.skeleton-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; }
.skeleton-block--kpi { height: 116px; }
.skeleton-block--chart { height: 300px; margin-top: var(--wb-space-5); }
.skeleton-block--panel { height: 220px; }

/* ── 错峰入场 + reduced-motion ── */
.kpi-strip {
  animation: wb-fade-up 0.42s var(--wb-motion-ease-out) both;
}
.cockpit__main > .panel,
.cockpit__side > .panel { animation: wb-fade-up 0.42s var(--wb-motion-ease-out) both; }
.cockpit__main > .panel:nth-child(2) { animation-delay: 0.18s; }
.cockpit__main > .panel:nth-child(3) { animation-delay: 0.26s; }
.cockpit__side > .panel:nth-child(1) { animation-delay: 0.20s; }
.cockpit__side > .panel:nth-child(2) { animation-delay: 0.28s; }
.cockpit__side > .panel:nth-child(3) { animation-delay: 0.36s; }
@media (prefers-reduced-motion: reduce) {
  .live-dot, .is-spinning { animation: none; }
  .kpi-strip,
  .cockpit__main > .panel, .cockpit__side > .panel, .skeleton-block { animation: none !important; }
}
</style>
