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
      <!-- 页头：按时段问候 + 今日日期 + 一句话状态 + 全页唯一主操作 -->
      <PageHeader
        eyebrow="教学工作 / 工作台"
        :title="`${greeting}，老师`"
        :description="`${todayLabel} · ${briefHeadline}`"
      >
        <template #actions>
          <ActionButton variant="primary" @click="go('/grade')">
            开始批改
            <el-icon><ArrowRight /></el-icon>
          </ActionButton>
        </template>
      </PageHeader>

      <!-- 学生规模摘要：低频信息收敛为一行灰字 -->
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
      <div v-if="initialLoading" class="ledger" aria-busy="true" aria-label="加载工作台">
        <span class="skeleton-block skeleton-block--row" />
        <span class="skeleton-block skeleton-block--row" />
        <span class="skeleton-block skeleton-block--row" />
        <span class="skeleton-block skeleton-block--chart" />
      </div>

      <!-- 教案本三段式：待办 → 已完成 → 需要关注 -->
      <div v-else class="ledger">
        <!-- ───── ① 今日待办 ───── -->
        <section class="ledger-day" aria-label="今日待办">
          <header class="ledger-day__head">
            <h2 class="ledger-day__title">待办</h2>
            <span v-if="todoCount > 0" class="ledger-day__count">{{ todoCount }} 件</span>
            <router-link v-else to="/grade" class="ledger-day__done">
              没有待办，看看已完成
              <el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </router-link>
          </header>

          <ul v-if="todoRows.length" class="ledger-list">
            <li
              v-for="t in todoRows"
              :key="t.key"
              class="ledger-row"
              :class="`is-${t.tone}`"
              @click="go(t.to)"
            >
              <span class="ledger-row__dot" aria-hidden="true" />
              <span class="ledger-row__body">
                <span class="ledger-row__title">{{ t.title }}</span>
                <span class="ledger-row__desc">{{ t.description }}</span>
              </span>
              <span class="ledger-row__count">{{ t.count }}{{ t.unit }}</span>
              <span class="ledger-row__go">
                <el-icon aria-hidden="true"><ArrowRight /></el-icon>
              </span>
            </li>
          </ul>

          <EmptyState
            v-else
            compact
            title="今天没有待处理事项"
            description="待复核、识别异常、待补入的错题都会出现在这里。"
          />
        </section>

        <!-- ───── ② 今日已完成 + 7 日趋势 ───── -->
        <section class="ledger-day" aria-label="今日已完成">
          <header class="ledger-day__head">
            <h2 class="ledger-day__title">已完成</h2>
            <span class="ledger-day__meta">今日已批改 {{ todayCell.tasksDone || 0 }} 份 · 新增错题 {{ todayCell.newWrong || 0 }} 道</span>
          </header>

          <!-- 近 7 日趋势：柱=作业量，线=新增错题（双轴） -->
          <div v-if="hasTrend" ref="trendChartRef" class="chart chart--trend" />
          <EmptyState
            v-else
            compact
            title="近 7 日暂无批改记录"
            description="开始批改作业后，这里会显示每日作业量与新增错题的走势。"
          />
        </section>

        <!-- ───── ③ 需要关注 ───── -->
        <section class="ledger-day" aria-label="需要关注">
          <header class="ledger-day__head">
            <h2 class="ledger-day__title">需要关注</h2>
            <router-link to="/students" class="ledger-day__link">
              全部学生 <el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </router-link>
          </header>

          <div class="ledger-grid">
            <!-- 待关注学生 -->
            <div class="ledger-col">
              <h3 class="ledger-col__title">学生</h3>
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
              <p v-else class="ledger-col__empty">暂无需要特别关注的学生</p>

              <!-- 批改中（轮询实时进度） -->
              <template v-if="notiStore.hasInProgress">
                <h3 class="ledger-col__title ledger-col__title--mt">批改中</h3>
                <ul class="mini-list">
                  <li v-for="t in notiStore.inProgressTasks.slice(0, 3)" :key="t.id">
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
              </template>
            </div>

            <!-- 错题消化 + 薄弱点 -->
            <div class="ledger-col">
              <h3 class="ledger-col__title">错题消化</h3>
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
            </div>
          </div>
        </section>
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

const pendingCount = computed(() => notiStore.summary.pendingReview || 0)
const failedCount = computed(() => notiStore.summary.failedTasks || 0)
const wrongCount = computed(() => notiStore.summary.todayNewWrongQuestions || 0)
const undigestedCount = computed(() => retryOverview.value?.undigested || 0)

// 近 7 日趋势派生：今/昨对比
const hasTrend = computed(() => trend.value.some(d => (d.tasksDone || 0) + (d.newWrong || 0) > 0))
const todayCell = computed(() => trend.value[trend.value.length - 1] || { tasksDone: 0, newWrong: 0 })
const ydayCell = computed(() => trend.value[trend.value.length - 2] || { tasksDone: 0, newWrong: 0 })
const wrongDelta = computed(() => {
  if (!trend.value.length) return null
  return (todayCell.value.newWrong || 0) - (ydayCell.value.newWrong || 0)
})

// 总"件事"（以行为单位）
const totalCount = computed(() =>
  (pendingCount.value > 0 ? 1 : 0) +
  (failedCount.value > 0 ? 1 : 0) +
  (wrongCount.value > 0 ? 1 : 0) +
  (undigestedCount.value > 0 ? 1 : 0)
)
const briefHeadline = computed(() =>
  totalCount.value === 0 ? '今天没有待处理事项' : `今日 ${totalCount.value} 件事需要处理`
)

// ① 待办行：待复核 / 识别异常 / 待补入 / 卡住
const todoRows = computed(() => {
  const rows = []
  if (pendingCount.value > 0) {
    rows.push({ key: 'pending', title: '待复核', description: '批改结果需要你确认', count: pendingCount.value, unit: '份', tone: 'primary', to: '/grade' })
  }
  if (failedCount.value > 0) {
    rows.push({ key: 'failed', title: '识别异常', description: 'AI 识别失败，可重新处理或查看原图', count: failedCount.value, unit: '份', tone: 'danger', to: { path: '/grade', query: { status: 'failed' } } })
  }
  if (gatePendingCount.value > 0) {
    rows.push({ key: 'gate', title: '错题待补入错题本', description: '因缺图/缺选项未入册，补全后自动入册', count: gatePendingCount.value, unit: '道', tone: 'warning', to: { path: '/grade/task', query: { source: 'homework', gate: '1' } } })
  }
  return rows
})
const todoCount = computed(() => todoRows.value.reduce((s, r) => s + r.count, 0))

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
  const primary = cssVar('--wb-primary', '#B4530A')
  const warn = cssVar('--wb-status-warning-fg', '#B4530A')
  const text2 = cssVar('--wb-text-secondary', '#57534E')
  const border = cssVar('--wb-border-light', '#F5F4F2')
  trendChart.setOption({
    animation: !reduceMotion,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: border,
      borderWidth: 1,
      textStyle: { color: cssVar('--wb-text', '#1C1917') }
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
            { offset: 0, color: 'rgba(180, 83, 9, 0.16)' },
            { offset: 1, color: 'rgba(180, 83, 9, 0.01)' }
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
  const success = cssVar('--wb-status-success-fg', '#15803D')
  const info = cssVar('--wb-status-info-fg', '#57534E')
  const warn = cssVar('--wb-status-warning-fg', '#B4530A')
  const text = cssVar('--wb-text', '#1C1917')
  digestChart.setOption({
    animation: !reduceMotion,
    tooltip: { trigger: 'item', formatter: '{b}：{c} 道（{d}%）' },
    legend: {
      orient: 'vertical',
      right: 4,
      top: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: cssVar('--wb-text-secondary', '#57534E'), fontSize: 12 }
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
            t: { color: cssVar('--wb-text-tertiary', '#A8A29E'), fontSize: 12 }
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

/* ── 教案本三段式 ── */
.ledger {
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-6);
}

/* 日区块：无卡片感，靠发丝边与留白分层 */
.ledger-day {
  padding: var(--wb-space-6) var(--wb-space-7);
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-lg);
  box-shadow: var(--wb-elev-card);
}
.ledger-day__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--wb-space-3);
  margin-bottom: var(--wb-space-4);
  padding-bottom: var(--wb-space-3);
  border-bottom: 1px solid var(--wb-border-light);
}
.ledger-day__title {
  margin: 0;
  color: var(--wb-text);
  font-size: var(--wb-fs-section);
  font-weight: var(--wb-fw-semibold);
  line-height: var(--wb-lh-tight);
}
.ledger-day__count {
  color: var(--wb-primary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-semibold);
  font-variant-numeric: tabular-nums;
}
.ledger-day__done {
  display: inline-flex;
  align-items: center;
  gap: var(--wb-space-1);
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
  text-decoration: none;
}
.ledger-day__done:hover { color: var(--wb-primary); }
.ledger-day__meta {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
  font-variant-numeric: tabular-nums;
}
.ledger-day__link {
  display: inline-flex;
  align-items: center;
  gap: var(--wb-space-1);
  color: var(--wb-primary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
  text-decoration: none;
}
.ledger-day__link:hover { color: var(--wb-primary-hover); }

/* 待办行 */
.ledger-list { margin: 0; padding: 0; list-style: none; }
.ledger-row {
  display: flex;
  align-items: center;
  gap: var(--wb-space-4);
  padding: var(--wb-space-4) var(--wb-space-2);
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.ledger-row + .ledger-row { border-top: 1px solid var(--wb-border-light); }
.ledger-row:hover { background: var(--wb-bg-hover); }
.ledger-row:focus-visible { outline: 2px solid var(--wb-primary); outline-offset: -2px; }

.ledger-row__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--wb-text-tertiary);
}
.ledger-row.is-primary .ledger-row__dot { background: var(--wb-primary); }
.ledger-row.is-danger .ledger-row__dot { background: var(--wb-status-danger-fg); }
.ledger-row.is-warning .ledger-row__dot { background: var(--wb-status-warning-fg); }

.ledger-row__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ledger-row__title { color: var(--wb-text); font-size: var(--wb-fs-body); font-weight: var(--wb-fw-medium); }
.ledger-row__desc { color: var(--wb-text-tertiary); font-size: var(--wb-fs-caption); }
.ledger-row__count {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  font-variant-numeric: tabular-nums;
}
.ledger-row.is-danger .ledger-row__count { color: var(--wb-status-danger-fg); }
.ledger-row.is-warning .ledger-row__count { color: var(--wb-status-warning-fg); }
.ledger-row__go { color: var(--wb-text-tertiary); opacity: 0; transition: opacity var(--wb-motion-fast) var(--wb-motion-ease); }
.ledger-row:hover .ledger-row__go { opacity: 1; }

/* 需要关注：两列 */
.ledger-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: var(--wb-space-6);
  align-items: start;
}
@media (max-width: 900px) {
  .ledger-grid { grid-template-columns: 1fr; }
}
.ledger-col { min-width: 0; }
.ledger-col__title {
  margin: 0 0 var(--wb-space-3);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
}
.ledger-col__title--mt { margin-top: var(--wb-space-5); }
.ledger-col__empty { margin: 0; color: var(--wb-text-tertiary); font-size: var(--wb-fs-meta); }

/* 迷你列表 */
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
.is-spinning { animation: ledger-spin 1.4s linear infinite; }
@keyframes ledger-spin { to { transform: rotate(360deg); } }

/* 趋势图 */
.chart--trend { width: 100%; height: 220px; }
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

/* 消化环 + 薄弱条 */
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
  border-radius: var(--wb-radius-pill);
  overflow: hidden;
}
.weak-row__fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--wb-primary-soft), var(--wb-primary));
  border-radius: var(--wb-radius-pill);
  transition: width var(--wb-motion-slow) var(--wb-motion-ease);
}
.weak-row__count {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-caption);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.weak-row:hover .weak-row__name { color: var(--wb-primary); }

/* ── 骨架 ── */
@keyframes ledger-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.skeleton-block {
  display: block;
  background: linear-gradient(90deg, var(--wb-bg-hover), var(--wb-border-light), var(--wb-bg-hover));
  background-size: 200% 100%;
  animation: ledger-shimmer 1.4s linear infinite;
  border-radius: var(--wb-radius-md);
}
.skeleton-block--row { height: 48px; margin-bottom: var(--wb-space-3); }
.skeleton-block--chart { height: 260px; }

/* ── 错峰入场 + reduced-motion ── */
.ledger-day { animation: wb-fade-up 0.42s var(--wb-motion-ease-out) both; }
.ledger-day:nth-child(2) { animation-delay: 0.16s; }
.ledger-day:nth-child(3) { animation-delay: 0.24s; }
@media (prefers-reduced-motion: reduce) {
  .is-spinning { animation: none; }
  .ledger-day, .skeleton-block { animation: none !important; }
}
</style>
