<template>
  <div class="growth-workbench">
    <div class="main-layout">
      <!-- 第一栏：主内容区 -->
      <section class="growth-main" v-loading="loading">
        <!-- 顶部学生选择器 -->
        <div class="growth-selector-bar">
          <span class="growth-selector-bar__title">成长中心</span>
          <div class="growth-selector-bar__filters">
            <div class="selector-item">
              <span class="selector-label">学生</span>
              <el-select v-model="selectedStudentId" placeholder="选择学生" @change="handleStudentChange" style="width: 180px;">
                <el-option
                  v-for="student in students"
                  :key="student.id"
                  :label="student.name"
                  :value="student.id"
                >
                  <span style="display: flex; align-items: center; gap: 8px;">
                    <el-avatar :size="24" :src="student.avatar" />
                    {{ student.name }}
                    <span style="font-size: 12px; color: var(--wb-text-tertiary);">{{ student.class }}</span>
                  </span>
                </el-option>
              </el-select>
            </div>
            <div class="selector-item">
              <span class="selector-label">时间范围</span>
              <el-select v-model="timeRange" style="width: 180px;">
                <el-option label="最近7天（05-12 ~ 05-18）" value="7d" />
                <el-option label="最近30天" value="30d" />
                <el-option label="最近90天" value="90d" />
              </el-select>
            </div>
            <div class="selector-item">
              <span class="selector-label">科目</span>
              <el-select v-model="subjectFilter" placeholder="全部科目" style="width: 130px;">
                <el-option label="全部科目" value="all" />
                <el-option label="数学" value="数学" />
                <el-option label="语文" value="语文" />
                <el-option label="英语" value="英语" />
                <el-option label="物理" value="物理" />
                <el-option label="化学" value="化学" />
              </el-select>
            </div>
            <el-button type="primary" size="default" class="export-btn">
              <el-icon><Download /></el-icon>
              导出报告
            </el-button>
          </div>
        </div>

        <template v-if="currentStudent">
          <!-- 核心统计卡片 -->
          <div class="kpi-cards">
            <div class="kpi-card">
              <div class="kpi-card__left">
                <div class="kpi-card__label">错题总数</div>
                <div class="kpi-card__value">{{ kpiData.totalWrong }} <span class="kpi-card__unit">题</span></div>
                <div class="kpi-card__trend" :class="kpiData.totalWrongTrend > 0 ? 'trend-down' : 'trend-up'">
                  较上周
                  <span v-if="kpiData.totalWrongTrend > 0">-{{ kpiData.totalWrongTrend }} 题 ↓</span>
                  <span v-else>+{{ Math.abs(kpiData.totalWrongTrend) }} 题 ↑</span>
                </div>
              </div>
              <div class="kpi-card__icon kpi-card__icon--blue">
                <el-icon><Document /></el-icon>
              </div>
            </div>
            <div class="kpi-card">
              <div class="kpi-card__left">
                <div class="kpi-card__label">正确率</div>
                <div class="kpi-card__value">{{ kpiData.accuracy }}%</div>
                <div class="kpi-card__trend trend-up">
                  较上周 <span>+{{ kpiData.accuracyTrend }}% ↑</span>
                </div>
              </div>
              <div class="kpi-card__icon kpi-card__icon--green">
                <el-icon><TrendCharts /></el-icon>
              </div>
            </div>
            <div class="kpi-card">
              <div class="kpi-card__left">
                <div class="kpi-card__label">知识点掌握率</div>
                <div class="kpi-card__value">{{ kpiData.masteryRate }}%</div>
                <div class="kpi-card__trend trend-up">
                  较上周 <span>+{{ kpiData.masteryTrend }}% ↑</span>
                </div>
              </div>
              <div class="kpi-card__icon kpi-card__icon--purple">
                <el-icon><PieChart /></el-icon>
              </div>
            </div>
            <div class="kpi-card">
              <div class="kpi-card__left">
                <div class="kpi-card__label">学习时长</div>
                <div class="kpi-card__value">{{ kpiData.studyHours }} <span class="kpi-card__unit">小时</span></div>
                <div class="kpi-card__trend trend-up">
                  较上周 <span>+{{ kpiData.studyHoursTrend }} 小时 ↑</span>
                </div>
              </div>
              <div class="kpi-card__icon kpi-card__icon--orange">
                <el-icon><Clock /></el-icon>
              </div>
            </div>
          </div>

          <!-- 趋势图区域 -->
          <div class="charts-row">
            <div class="chart-card">
              <div class="chart-card__title">正确率趋势</div>
              <div ref="accuracyChartRef" class="chart-card__body"></div>
            </div>
            <div class="chart-card">
              <div class="chart-card__title">错题数量趋势</div>
              <div ref="wrongCountChartRef" class="chart-card__body"></div>
            </div>
          </div>

          <!-- 详细数据区 -->
          <div class="detail-row">
            <!-- 知识点掌握情况 -->
            <div class="detail-card">
              <div class="detail-card__title">知识点掌握情况</div>
              <div class="detail-card__body">
                <table class="knowledge-table">
                  <thead>
                    <tr>
                      <th style="width: 120px;">知识点</th>
                      <th style="width: 160px;">掌握程度</th>
                      <th style="width: 80px;">正确率</th>
                      <th style="width: 70px;">错题数</th>
                      <th style="width: 80px;">变化趋势</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="knowledgePointsData.length === 0">
                      <td colspan="5" style="text-align:center;color:var(--wb-text-tertiary);padding:24px 0;">
                        暂无掌握度数据 —— 学生上传作业批改后自动生成
                      </td>
                    </tr>
                    <tr v-for="kp in knowledgePointsData" :key="kp.name">
                      <td>{{ kp.name }}</td>
                      <td>
                        <div class="mastery-bar-cell">
                          <div class="mastery-bar-bg">
                            <div class="mastery-bar-fill" :style="{ width: kp.mastery + '%', background: kp.mastery >= 80 ? '#6366F1' : kp.mastery >= 60 ? 'var(--wb-warning)' : 'var(--wb-danger)' }"></div>
                          </div>
                          <span class="mastery-bar-value">{{ kp.mastery }}%</span>
                        </div>
                      </td>
                      <td>{{ kp.accuracy }}%</td>
                      <td>{{ kp.wrongCount }}</td>
                      <td>
                        <span class="trend-badge" :class="kp.trend > 0 ? 'trend-badge--up' : 'trend-badge--down'">
                          <el-icon v-if="kp.trend > 0"><Top /></el-icon>
                          <el-icon v-else><Bottom /></el-icon>
                          {{ Math.abs(kp.trend) }}%
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 错题类型分布 -->
            <div class="detail-card">
              <div class="detail-card__title">错题类型分布</div>
              <div class="detail-card__body">
                <div class="pie-chart-wrapper">
                  <div ref="pieChartRef" class="pie-chart-container"></div>
                  <div class="pie-chart-center">
                    <div class="pie-center-value">{{ kpiData.totalWrong }}</div>
                    <div class="pie-center-label">总错题</div>
                  </div>
                </div>
                <div class="pie-legend">
                  <div v-for="item in pieLegendData" :key="item.name" class="pie-legend-item">
                    <span class="pie-legend-dot" :style="{ background: item.color }"></span>
                    <span class="pie-legend-name">{{ item.name }}</span>
                    <span class="pie-legend-value">{{ item.value }} ({{ item.percent }}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 薄弱知识点推荐 -->
          <div class="recommend-card">
            <div class="recommend-card__header">
              <div>
                <div class="recommend-card__title">薄弱知识点推荐</div>
                <div class="recommend-card__sub">综合全班/全年级掌握度，按紧急程度排序</div>
              </div>
              <el-button type="primary" link size="small" @click="handleGenerateHandout" :loading="generatingHandout">
                <el-icon><Document /></el-icon>
                一键生成讲义
              </el-button>
            </div>
            <div class="recommend-card__body" v-loading="loadingRecommend">
              <div v-if="recommendedTopics.length === 0" class="recommend-empty">
                暂无推荐 —— 学生数据不足以生成推荐
              </div>
              <div v-else class="recommend-list">
                <div
                  v-for="(topic, idx) in recommendedTopics"
                  :key="topic.kpId || idx"
                  class="recommend-item"
                  :class="{ 'is-urgent': topic.isUrgent }"
                >
                  <div class="recommend-rank">{{ idx + 1 }}</div>
                  <div class="recommend-main">
                    <div class="recommend-name">
                      <el-tag size="small" :type="topic.isUrgent ? 'danger' : 'warning'" effect="dark">
                        {{ topic.subject }}
                      </el-tag>
                      <span class="recommend-name-text">{{ topic.name }}</span>
                    </div>
                    <div class="recommend-meta">
                      <span>平均掌握度 <strong>{{ topic.avgMastery }}%</strong></span>
                      <span class="dot">·</span>
                      <span>{{ topic.studentCount }} 人共性薄弱</span>
                      <span class="dot">·</span>
                      <span>优先级 {{ topic.priority }}</span>
                    </div>
                    <div v-if="topic.reason" class="recommend-reason">📌 {{ topic.reason }}</div>
                  </div>
                  <div class="recommend-bar">
                    <div
                      class="recommend-bar-fill"
                      :style="{ width: topic.avgMastery + '%', background: topic.isUrgent ? '#F5222D' : topic.avgMastery < 50 ? '#FA8C16' : '#6366F1' }"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 最近错题记录 -->
          <div class="recent-wrong-card">
            <div class="recent-wrong-card__title">最近错题记录</div>
            <div class="recent-wrong-card__body">
              <table class="wrong-record-table">
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>题目</th>
                    <th style="width: 70px;">科目</th>
                    <th style="width: 100px;">知识点</th>
                    <th style="width: 130px;">错题时间</th>
                    <th style="width: 80px;">你的答案</th>
                    <th style="width: 80px;">正确答案</th>
                    <th style="width: 80px;">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(record, idx) in paginatedRecords" :key="record.id">
                    <td>{{ (currentPage - 1) * PAGE_SIZE + idx + 1 }}</td>
                    <td class="record-question">
                      <el-tag class="record-subject-tag" :style="{ background: getSubjectColor(record.subject) }">{{ record.subject }}</el-tag>
                      <span class="record-question-text">{{ record.question }}</span>
                    </td>
                    <td>{{ record.subject }}</td>
                    <td>{{ record.knowledgePoint }}</td>
                    <td>{{ record.time }}</td>
                    <td class="record-answer record-answer--wrong">{{ record.studentAnswer }}</td>
                    <td class="record-answer record-answer--correct">{{ record.correctAnswer }}</td>
                    <td>
                      <el-button text type="primary" size="small" @click="handleViewDetail(record)">查看详情</el-button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="recent-wrong-card__footer">
              <span class="record-count">共 {{ recentWrongRecords.length }} 条</span>
              <el-pagination
                v-model:current-page="currentPage"
                :page-size="PAGE_SIZE"
                :total="recentWrongRecords.length"
                layout="prev, pager, next"
                small
              />
            </div>
          </div>
        </template>

        <template v-else>
          <div class="empty-state">
            <el-empty description="请选择学生查看成长数据" />
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowDown, Download, Document, TrendCharts,
  PieChart, Clock, Top, Bottom
} from '@element-plus/icons-vue'
import { useGrowthStore } from '../stores/growthStore'
import { getStudents } from '../../services/apiService'
import { getRecommendedTopics } from '../../services/apiService'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart as EChartsPieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { LinearGradient } from 'echarts/lib/util/graphic'

echarts.use([LineChart, BarChart, EChartsPieChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])
import dayjs from 'dayjs'

const growthStore = useGrowthStore()
const router = useRouter()

// ===== 学生列表 =====
const students = ref([])
const selectedStudentId = ref(null)
const loading = ref(false)

const currentStudent = computed(() => {
  return students.value.find(s => s.id === selectedStudentId.value)
})

const handleStudentChange = (studentId) => {
  loading.value = true
  growthStore.setCurrentStudent(studentId)
  growthStore.loadData(studentId).finally(() => {
    loading.value = false
    const student = students.value.find(s => s.id === studentId)
    if (student) {
      ElMessage.success(`已切换到 ${student.name}`)
    }
    nextTick(() => {
      initCharts()
    })
  })
}

// ===== 筛选 =====
const timeRange = ref('7d')
const subjectFilter = ref('all')

// ===== KPI 数据 =====
const kpiData = computed(() => {
  const masteryRate = growthStore.averageMasteryRate || growthStore.masteryRate || 0
  return {
    totalWrong: growthStore.totalWrongQuestions || 0,
    totalWrongTrend: 0,
    accuracy: growthStore.masteryRate || 0,
    accuracyTrend: 0,
    masteryRate,
    masteryTrend: 0,
    studyHours: 0,
    studyHoursTrend: 0,
  }
})

// ===== 知识点掌握数据（真实 knowledge_mastery 数据，无记录时降级为本地字典展示空态） =====
const knowledgePointsData = computed(() => {
  const real = growthStore.masteryPoints
  if (real.length > 0) return real
  // 无掌握度记录时展示空态占位（不再使用假数据）
  return []
})

// ===== 饼图数据（真实 error_type 分布） =====
const pieLegendData = computed(() => {
  const list = growthStore.wrongQuestions
    .filter(wq => wq.student_id === growthStore.currentStudentId)
  const counts = {}
  list.forEach(wq => {
    const t = wq.error_type || wq.question?.error_type || '未标注'
    counts[t] = (counts[t] || 0) + 1
  })
  const colors = ['#6366F1', '#52C41A', '#FA8C16', '#722ED1', '#13C2C2', '#F5222D']
  const total = list.length
  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    return [{ name: '暂无数据', value: 1, percent: 100, color: '#D9D9D9' }]
  }
  return entries.map(([name, value], i) => ({
    name,
    value,
    percent: total > 0 ? Math.round((value / total) * 100) : 0,
    color: colors[i % colors.length],
  }))
})

// ===== 最近错题记录（真实 wrong_questions 数据） =====
const recentWrongRecords = computed(() => {
  const list = growthStore.wrongQuestions
    .filter(wq => wq.student_id === growthStore.currentStudentId)
    .slice(0, 12)
  return list.map(wq => {
    const q = wq.question || {}
    const content = q.content || wq.content || ''
    const subject = q.subject || wq.subject || '数学'
    const tags = q.ai_tags || wq.ai_tags || []
    return {
      id: wq.id,
      subject,
      question: content.length > 60 ? content.slice(0, 60) + '…' : content,
      knowledgePoint: Array.isArray(tags) && tags[0] && tags[0] !== '未分类' ? tags[0] : '-',
      time: dayjs(wq.added_at || wq.created_at).format('MM-DD HH:mm'),
      studentAnswer: wq.student_answer || q.student_answer || '-',
      correctAnswer: wq.correct_answer || q.answer || '-',
    }
  })
})

// ===== 分页 =====
const PAGE_SIZE = 5
const currentPage = ref(1)

const paginatedRecords = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return recentWrongRecords.value.slice(start, start + PAGE_SIZE)
})

// ===== 图表引用 =====
const accuracyChartRef = ref(null)
const wrongCountChartRef = ref(null)
const pieChartRef = ref(null)
let accuracyChart = null
let wrongCountChart = null
let pieChart = null

// ===== 初始化图表 =====
const initCharts = () => {
  // 正确率趋势折线图
  if (accuracyChartRef.value) {
    if (accuracyChart) accuracyChart.dispose()
    accuracyChart = echarts.init(accuracyChartRef.value)

    const trendData = growthStore.masteryRateTrend.length > 0
      ? growthStore.masteryRateTrend
      : [
          { date: '05-12', rate: 60 },
          { date: '05-13', rate: 65 },
          { date: '05-14', rate: 55 },
          { date: '05-15', rate: 62 },
          { date: '05-16', rate: 58 },
          { date: '05-17', rate: 52 },
          { date: '05-18', rate: 72 },
        ]

    accuracyChart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: '{b}<br/>{c}%',
        backgroundColor: '#fff',
        borderColor: '#E5E6EB',
        borderWidth: 1,
        textStyle: { color: '#1D2129' },
      },
      grid: { left: 40, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: trendData.map(d => d.date),
        axisLine: { lineStyle: { color: '#E5E6EB' } },
        axisLabel: { color: '#86909C', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: '#86909C', fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#F2F3F5' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [{
        data: trendData.map(d => d.rate),
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { color: '#6366F1', width: 2 },
        itemStyle: { color: '#6366F1' },
        areaStyle: {
          color: new LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(99, 102, 241, 0.15)' },
            { offset: 1, color: 'rgba(99, 102, 241, 0.01)' },
          ]),
        },
      }],
    })
  }

  // 错题数量柱状图
  if (wrongCountChartRef.value) {
    if (wrongCountChart) wrongCountChart.dispose()
    wrongCountChart = echarts.init(wrongCountChartRef.value)

    const wrongTrend = growthStore.wrongQuestionTrend.length > 0
      ? growthStore.wrongQuestionTrend
      : [
          { date: '05-12', count: 50 },
          { date: '05-13', count: 32 },
          { date: '05-14', count: 22 },
          { date: '05-15', count: 35 },
          { date: '05-16', count: 25 },
          { date: '05-17', count: 18 },
          { date: '05-18', count: 12 },
        ]

    wrongCountChart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: '{b}<br/>错题数：{c} 题',
        backgroundColor: '#fff',
        borderColor: '#E5E6EB',
        borderWidth: 1,
        textStyle: { color: '#1D2129' },
      },
      grid: { left: 40, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: wrongTrend.map(d => d.date),
        axisLine: { lineStyle: { color: '#E5E6EB' } },
        axisLabel: { color: '#86909C', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#86909C', fontSize: 11 },
        splitLine: { lineStyle: { color: '#F2F3F5' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [{
        data: wrongTrend.map(d => d.count),
        type: 'bar',
        barWidth: 20,
        itemStyle: {
          color: '#6366F1',
          borderRadius: [4, 4, 0, 0],
        },
      }],
    })
  }

  // 饼图
  if (pieChartRef.value) {
    if (pieChart) pieChart.dispose()
    pieChart = echarts.init(pieChartRef.value)

    pieChart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
        backgroundColor: '#fff',
        borderColor: '#E5E6EB',
        borderWidth: 1,
        textStyle: { color: '#1D2129' },
      },
      series: [{
        type: 'pie',
        radius: ['55%', '75%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        data: pieLegendData.value.map(item => ({
          name: item.name,
          value: item.value,
          itemStyle: { color: item.color },
        })),
      }],
    })
  }
}

// ===== 工具函数 =====
const getSubjectColor = (subject) => {
  const colorMap = {
    '数学': '#6366F1',
    '语文': '#FA8C16',
    '英语': '#52C41A',
    '物理': '#722ED1',
    '化学': '#13C2C2',
  }
  return colorMap[subject] || '#86909C'
}

const handleViewDetail = (record) => {
  ElMessage.info(`查看题目详情：${record.question.substring(0, 30)}...`)
}

// ===== 薄弱知识点推荐 =====
const recommendedTopics = ref([])
const loadingRecommend = ref(false)
const generatingHandout = ref(false)

const loadRecommend = async () => {
  loadingRecommend.value = true
  try {
    recommendedTopics.value = await getRecommendedTopics({
      limit: 8,
      subject: subjectFilter.value === 'all' ? undefined : subjectFilter.value,
    })
  } catch (e) {
    console.warn('拉取薄弱知识点推荐失败:', e.message)
    recommendedTopics.value = []
  } finally {
    loadingRecommend.value = false
  }
}

watch([selectedStudentId, subjectFilter], () => {
  loadRecommend()
})

// 一键生成讲义：跳转到讲义预览页（HandoutPreview 走 /handout/from-diagnosis）
const handleGenerateHandout = () => {
  if (generatingHandout.value) return
  generatingHandout.value = true
  try {
    const subj = subjectFilter.value === 'all' ? '' : subjectFilter.value
    const route = router.resolve({ path: '/handout', query: { subject: subj } })
    window.open(route.href, '_blank')
  } finally {
    setTimeout(() => { generatingHandout.value = false }, 500)
  }
}

// ===== 窗口resize =====
const handleResize = () => {
  accuracyChart?.resize()
  wrongCountChart?.resize()
  pieChart?.resize()
}

// ===== 初始化 =====
onMounted(async () => {
  try {
    const result = await getStudents(false)
    const list = result.data || result || []
    students.value = Array.isArray(list) ? list : []

    if (students.value.length > 0) {
      selectedStudentId.value = students.value[0].id
      growthStore.setCurrentStudent(selectedStudentId.value)
      await growthStore.loadData(selectedStudentId.value)
    }
  } catch (e) {
    console.error('加载学生列表失败:', e)
  }

  // 加载薄弱知识点推荐
  loadRecommend()

  nextTick(() => {
    initCharts()
  })

  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  accuracyChart?.dispose()
  wrongCountChart?.dispose()
  pieChart?.dispose()
})
</script>

<style scoped>
/* ===== CSS Variables ===== */
.growth-workbench {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--wb-bg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== Main Layout ===== */
.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Growth Main Content ===== */
.growth-main {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== Selector Bar ===== */
.growth-selector-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-radius: var(--wb-radius-md);
  padding: 14px 20px;
  box-shadow: var(--wb-shadow-sm);
  flex-shrink: 0;
}

.growth-selector-bar__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--wb-text);
  flex-shrink: 0;
  margin-right: 24px;
}

.growth-selector-bar__filters {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.selector-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selector-label {
  font-size: 13px;
  color: var(--wb-text-tertiary);
  white-space: nowrap;
}

.export-btn {
  margin-left: auto;
  flex-shrink: 0;
}

/* ===== KPI Cards ===== */
.kpi-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.kpi-card {
  background: #fff;
  border-radius: var(--wb-radius-md);
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--wb-shadow-sm);
  transition: box-shadow 0.2s;
}

.kpi-card:hover {
  box-shadow: var(--wb-shadow-md);
}

.kpi-card__left {
  flex: 1;
}

.kpi-card__label {
  font-size: 13px;
  color: var(--wb-text-tertiary);
  margin-bottom: 8px;
}

.kpi-card__value {
  font-size: 28px;
  font-weight: 700;
  color: var(--wb-text);
  line-height: 1.2;
}

.kpi-card__unit {
  font-size: 14px;
  font-weight: 400;
  color: var(--wb-text-tertiary);
}

.kpi-card__trend {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  margin-top: 6px;
}

.trend-up span {
  color: var(--wb-danger);
  font-weight: 500;
}

.trend-down span {
  color: #52C41A;
  font-weight: 500;
}

.kpi-card__icon {
  width: 48px;
  height: 48px;
  border-radius: var(--wb-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.kpi-card__icon .el-icon {
  font-size: 24px;
  color: #fff;
}

.kpi-card__icon--blue { background: linear-gradient(135deg, var(--wb-primary), var(--wb-primary-hover)); }
.kpi-card__icon--green { background: linear-gradient(135deg, #52C41A, #73D13D); }
.kpi-card__icon--purple { background: linear-gradient(135deg, #722ED1, #9254DE); }
.kpi-card__icon--orange { background: linear-gradient(135deg, var(--wb-warning), #FFC53D); }

/* ===== Charts Row ===== */
.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-card {
  background: #fff;
  border-radius: var(--wb-radius-md);
  padding: 16px 20px;
  box-shadow: var(--wb-shadow-sm);
}

.chart-card__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--wb-text);
  margin-bottom: 12px;
}

.chart-card__body {
  width: 100%;
  height: 220px;
}

/* ===== Detail Row ===== */
.detail-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}

.detail-card {
  background: #fff;
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-shadow-sm);
  overflow: hidden;
}

.detail-card__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--wb-text);
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--wb-bg-hover);
}

.detail-card__body {
  padding: 12px 20px 16px;
}

/* Knowledge Table */
.knowledge-table {
  width: 100%;
  border-collapse: collapse;
}

.knowledge-table th {
  font-size: 12px;
  font-weight: 500;
  color: var(--wb-text-tertiary);
  text-align: left;
  padding: 8px 4px;
  border-bottom: 1px solid var(--wb-bg-hover);
}

.knowledge-table td {
  font-size: 13px;
  color: var(--wb-text);
  padding: 10px 4px;
  border-bottom: 1px solid var(--wb-bg-hover);
}

.knowledge-table tr:last-child td {
  border-bottom: none;
}

.mastery-bar-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mastery-bar-bg {
  flex: 1;
  height: 8px;
  background: var(--wb-bg-hover);
  border-radius: var(--wb-radius-xs);
  overflow: hidden;
}

.mastery-bar-fill {
  height: 100%;
  border-radius: var(--wb-radius-xs);
  transition: width 0.5s ease;
}

.mastery-bar-value {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  flex-shrink: 0;
  width: 36px;
}

.trend-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: var(--wb-radius-xs);
}

.trend-badge--up {
  color: #52C41A;
  background: #F6FFED;
}

.trend-badge--down {
  color: var(--wb-danger);
  background: #FFF2F0;
}

/* Pie Chart */
.pie-chart-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.pie-chart-container {
  width: 180px;
  height: 180px;
}

.pie-chart-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.pie-center-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--wb-text);
}

.pie-center-label {
  font-size: 11px;
  color: var(--wb-text-tertiary);
}

.pie-legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pie-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.pie-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pie-legend-name {
  flex: 1;
  color: var(--wb-text-secondary);
}

.pie-legend-value {
  color: var(--wb-text-tertiary);
  font-size: 12px;
}

/* ===== Recent Wrong Records ===== */
.recent-wrong-card {
  background: #fff;
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-shadow-sm);
  overflow: hidden;
}

.recent-wrong-card__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--wb-text);
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--wb-bg-hover);
}

.recent-wrong-card__body {
  overflow-x: auto;
}

.wrong-record-table {
  width: 100%;
  border-collapse: collapse;
}

.wrong-record-table th {
  font-size: 12px;
  font-weight: 500;
  color: var(--wb-text-tertiary);
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--wb-bg-hover);
  white-space: nowrap;
}

.wrong-record-table td {
  font-size: 13px;
  color: var(--wb-text);
  padding: 10px 12px;
  border-bottom: 1px solid var(--wb-bg-hover);
}

.wrong-record-table tr:last-child td {
  border-bottom: none;
}

.record-question {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  max-width: 400px;
}

.record-subject-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: var(--wb-radius-xs);
  color: #fff;
  flex-shrink: 0;
  font-weight: 500;
  border: none;
}

.record-question-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-answer {
  font-weight: 600;
}

.record-answer--wrong {
  color: var(--wb-danger);
}

.record-answer--correct {
  color: #22C55E;
}

.recent-wrong-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--wb-bg-hover);
}

.record-count {
  font-size: 12px;
  color: var(--wb-text-tertiary);
}

/* 薄弱知识点推荐卡片 */
.recommend-card {
  background: #fff;
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-shadow-sm);
  padding: 16px 20px;
}
.recommend-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}
.recommend-card__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--wb-text);
  margin-bottom: 4px;
}
.recommend-card__sub {
  font-size: 12px;
  color: var(--wb-text-tertiary);
}
.recommend-card__body {
  min-height: 60px;
}
.recommend-empty {
  text-align: center;
  font-size: 13px;
  color: var(--wb-text-tertiary);
  padding: 24px 0;
}
.recommend-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.recommend-item {
  display: grid;
  grid-template-columns: 32px 1fr 120px;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #F7F8FA;
  border-radius: 6px;
  border-left: 3px solid var(--wb-primary);
  transition: background 0.2s;
}
.recommend-item:hover {
  background: var(--wb-primary-mist);
}
.recommend-item.is-urgent {
  border-left-color: #F5222D;
  background: #FFF2F0;
}
.recommend-item.is-urgent:hover {
  background: #FFE7E5;
}
.recommend-rank {
  font-size: 16px;
  font-weight: 700;
  color: var(--wb-text-tertiary);
  text-align: center;
}
.recommend-item.is-urgent .recommend-rank {
  color: #F5222D;
}
.recommend-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.recommend-name-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--wb-text);
}
.recommend-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--wb-text-tertiary);
}
.recommend-meta strong {
  color: var(--wb-text);
  font-weight: 600;
}
.recommend-meta .dot {
  color: var(--wb-text-tertiary);
}
.recommend-reason {
  margin-top: 4px;
  font-size: 11px;
  color: #FA8C16;
}
.recommend-bar {
  width: 120px;
  height: 8px;
  background: var(--wb-bg-hover);
  border-radius: 4px;
  overflow: hidden;
}
.recommend-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

/* ===== Empty State ===== */
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

/* ===== Scrollbar ===== */
.growth-main::-webkit-scrollbar {
  width: 6px;
}

.growth-main::-webkit-scrollbar-track {
  background: transparent;
}

.growth-main::-webkit-scrollbar-thumb {
  background: var(--wb-border);
  border-radius: var(--wb-radius-xs);
}

.growth-main::-webkit-scrollbar-thumb:hover {
  background: var(--wb-text-tertiary);
}
</style>
