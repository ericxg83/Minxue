<template>
  <div class="growth-workbench">
    <!-- 顶部 Header 栏 -->
    <header class="top-header">
      <div class="top-header__left">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" class="logo-icon" width="24" height="24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#1677FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="logo-text">敏学成长工作台</span>
        </div>
      </div>
      <div class="top-header__right">
        <div class="header-icon-btn" title="通知">
          <el-icon><Bell /></el-icon>
          <span class="header-badge">12</span>
        </div>
        <div class="header-icon-btn" title="帮助中心">
          <el-icon><QuestionFilled /></el-icon>
          <span class="header-icon-label">帮助中心</span>
        </div>
        <div class="header-user">
          <el-avatar :size="32" src="https://api.dicebear.com/7.x/avataaars/svg?seed=admin" />
          <span class="header-user-name">管理员</span>
          <el-icon class="header-dropdown-icon"><ArrowDown /></el-icon>
        </div>
      </div>
    </header>

    <!-- 三栏主内容区 -->
    <div class="main-layout">
      <!-- 第一栏：系统导航 -->
      <aside class="nav-sidebar">
        <div class="nav-menu">
          <div
            v-for="menu in navMenus"
            :key="menu.key"
            class="nav-menu-item"
            :class="{ 'nav-menu-item--active': currentMenu === menu.key }"
            @click="handleNavMenuClick(menu.key)"
          >
            <div class="nav-menu-item__icon">
              <el-icon><component :is="menu.icon" /></el-icon>
            </div>
            <span class="nav-menu-item__text">{{ menu.label }}</span>
          </div>
        </div>
      </aside>

      <!-- 第二栏：主内容区 -->
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
                    <span style="font-size: 12px; color: #86909C;">{{ student.class }}</span>
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
                    <tr v-for="kp in knowledgePointsData" :key="kp.name">
                      <td>{{ kp.name }}</td>
                      <td>
                        <div class="mastery-bar-cell">
                          <div class="mastery-bar-bg">
                            <div class="mastery-bar-fill" :style="{ width: kp.mastery + '%', background: kp.mastery >= 80 ? '#1677FF' : kp.mastery >= 60 ? '#FA8C16' : '#F53F3F' }"></div>
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
  Bell, QuestionFilled, ArrowDown, Download, Document, TrendCharts,
  PieChart, Clock, Top, Bottom
} from '@element-plus/icons-vue'
import { useGrowthStore } from '../stores/growthStore'
import { getStudents } from '../../services/apiService'
import * as echarts from 'echarts'
import dayjs from 'dayjs'

const router = useRouter()
const growthStore = useGrowthStore()

// ===== 导航菜单 =====
const currentMenu = ref('growth')
const navMenus = [
  { key: 'proofread', label: '题目校对', icon: 'DocumentChecked' },
  { key: 'wrong-book', label: '错题管理', icon: 'Collection' },
  { key: 'growth', label: '成长中心', icon: 'TrendCharts' },
  { key: 'exam-import', label: '试卷入库', icon: 'UploadFilled' },
]

const handleNavMenuClick = (key) => {
  currentMenu.value = key
  const routeMap = {
    'proofread': '/',
    'wrong-book': '/wrongbook',
    'growth': '/growth',
    'exam-import': '/paper',
  }
  if (routeMap[key] && routeMap[key] !== router.currentRoute.value.path) {
    router.push(routeMap[key])
  }
}

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
  return {
    totalWrong: growthStore.totalWrongQuestions || 128,
    totalWrongTrend: -12,
    accuracy: growthStore.masteryRate || 72,
    accuracyTrend: 8,
    masteryRate: 68,
    masteryTrend: 6,
    studyHours: 8.5,
    studyHoursTrend: 1.2,
  }
})

// ===== 知识点掌握数据 =====
const knowledgePointsData = computed(() => [
  { name: '勾股定理', mastery: 80, accuracy: 80, wrongCount: 16, trend: 12 },
  { name: '一元一次方程', mastery: 60, accuracy: 60, wrongCount: 28, trend: 5 },
  { name: '平行四边形', mastery: 70, accuracy: 70, wrongCount: 18, trend: -3 },
  { name: '二次函数', mastery: 50, accuracy: 50, wrongCount: 34, trend: -8 },
  { name: '相似三角形', mastery: 90, accuracy: 90, wrongCount: 6, trend: 15 },
])

// ===== 饼图数据 =====
const pieLegendData = [
  { name: '概念理解', value: 32, percent: 25, color: '#1677FF' },
  { name: '计算错误', value: 48, percent: 37, color: '#52C41A' },
  { name: '审题失误', value: 28, percent: 22, color: '#FA8C16' },
  { name: '知识点遗忘', value: 20, percent: 16, color: '#722ED1' },
]

// ===== 最近错题记录 =====
const recentWrongRecords = [
  {
    id: 1,
    subject: '数学',
    question: '如图，在△ABC中，∠A = 90°，AB = 6，AC = 8，则BC的长度为（ ）',
    knowledgePoint: '勾股定理',
    time: '05-18 17:20',
    studentAnswer: '12',
    correctAnswer: '10',
  },
  {
    id: 2,
    subject: '数学',
    question: '解方程：2x + 5 = 17',
    knowledgePoint: '一元一次方程',
    time: '05-17 16:35',
    studentAnswer: '6',
    correctAnswer: '6',
  },
  {
    id: 3,
    subject: '数学',
    question: '如图，平行四边形ABCD中，AD = 5，AB = 6，则周长为（ ）',
    knowledgePoint: '平行四边形',
    time: '05-16 15:40',
    studentAnswer: '22',
    correctAnswer: '22',
  },
  {
    id: 4,
    subject: '数学',
    question: '已知二次函数 y = ax² + bx + c 的图象经过点(1, 3)和(2, 5)，求函数解析式',
    knowledgePoint: '二次函数',
    time: '05-15 14:20',
    studentAnswer: 'y = x² + 1',
    correctAnswer: 'y = 2x² - 3x + 4',
  },
  {
    id: 5,
    subject: '数学',
    question: '若两个相似三角形的面积比为 4:9，则它们的周长比为（ ）',
    knowledgePoint: '相似三角形',
    time: '05-14 11:30',
    studentAnswer: '4:9',
    correctAnswer: '2:3',
  },
  {
    id: 6,
    subject: '数学',
    question: '计算：(-3)² - 2 × (-4) + 5',
    knowledgePoint: '计算错误',
    time: '05-13 09:45',
    studentAnswer: '12',
    correctAnswer: '22',
  },
  {
    id: 7,
    subject: '数学',
    question: '在直角坐标系中，点A(2, 3)关于x轴的对称点坐标为（ ）',
    knowledgePoint: '概念理解',
    time: '05-12 16:10',
    studentAnswer: '(-2, 3)',
    correctAnswer: '(2, -3)',
  },
  {
    id: 8,
    subject: '数学',
    question: '一个等腰三角形的两边长分别为3和7，则周长为（ ）',
    knowledgePoint: '勾股定理',
    time: '05-12 10:20',
    studentAnswer: '13',
    correctAnswer: '17',
  },
  {
    id: 9,
    subject: '数学',
    question: '已知一元二次方程 x² - 5x + 6 = 0 的两根为 x₁, x₂，则 x₁ + x₂ = （ ）',
    knowledgePoint: '一元一次方程',
    time: '05-11 14:50',
    studentAnswer: '6',
    correctAnswer: '5',
  },
  {
    id: 10,
    subject: '数学',
    question: '抛物线 y = x² - 4x + 3 的顶点坐标为（ ）',
    knowledgePoint: '二次函数',
    time: '05-11 09:30',
    studentAnswer: '(2, 1)',
    correctAnswer: '(2, -1)',
  },
  {
    id: 11,
    subject: '数学',
    question: '若△ABC ∽ △DEF，且 AB:DE = 2:3，则面积比为（ ）',
    knowledgePoint: '相似三角形',
    time: '05-10 15:20',
    studentAnswer: '2:3',
    correctAnswer: '4:9',
  },
  {
    id: 12,
    subject: '数学',
    question: '计算：√16 + ∛(-27) + |−5|',
    knowledgePoint: '计算错误',
    time: '05-10 11:00',
    studentAnswer: '6',
    correctAnswer: '6',
  },
]

// ===== 分页 =====
const PAGE_SIZE = 5
const currentPage = ref(1)

const paginatedRecords = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return recentWrongRecords.slice(start, start + PAGE_SIZE)
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
        lineStyle: { color: '#1677FF', width: 2 },
        itemStyle: { color: '#1677FF' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(22, 119, 255, 0.15)' },
            { offset: 1, color: 'rgba(22, 119, 255, 0.01)' },
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
          color: '#1677FF',
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
        data: pieLegendData.map(item => ({
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
    '数学': '#1677FF',
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== Top Header ===== */
.top-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  flex-shrink: 0;
}

.top-header__left {
  display: flex;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-icon {
  width: 24px;
  height: 24px;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}

.top-header__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: #4E5969;
  font-size: 14px;
  transition: background 0.2s;
  position: relative;
}

.header-icon-btn:hover {
  background: #F2F3F5;
}

.header-icon-btn .el-icon {
  font-size: 18px;
}

.header-badge {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #F53F3F;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
}

.header-icon-label {
  font-size: 13px;
}

.header-user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.header-user:hover {
  background: #F2F3F5;
}

.header-user-name {
  font-size: 13px;
  color: #1D2129;
}

.header-dropdown-icon {
  font-size: 12px;
  color: #86909C;
}

/* ===== Main Layout ===== */
.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Nav Sidebar (第一栏: 220px) ===== */
.nav-sidebar {
  width: 220px;
  background: #fff;
  border-right: 1px solid #E5E6EB;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  color: #4E5969;
}

.nav-menu-item:hover {
  background: #F2F3F5;
}

.nav-menu-item--active {
  background: #E8F3FF;
  color: #1677FF;
  font-weight: 500;
}

.nav-menu-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 18px;
}

.nav-menu-item__text {
  flex: 1;
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
  border-radius: 12px;
  padding: 14px 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}

.growth-selector-bar__title {
  font-size: 18px;
  font-weight: 600;
  color: #1D2129;
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
  color: #86909C;
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
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s;
}

.kpi-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.kpi-card__left {
  flex: 1;
}

.kpi-card__label {
  font-size: 13px;
  color: #86909C;
  margin-bottom: 8px;
}

.kpi-card__value {
  font-size: 28px;
  font-weight: 700;
  color: #1D2129;
  line-height: 1.2;
}

.kpi-card__unit {
  font-size: 14px;
  font-weight: 400;
  color: #86909C;
}

.kpi-card__trend {
  font-size: 12px;
  color: #86909C;
  margin-top: 6px;
}

.trend-up span {
  color: #F53F3F;
  font-weight: 500;
}

.trend-down span {
  color: #52C41A;
  font-weight: 500;
}

.kpi-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.kpi-card__icon .el-icon {
  font-size: 24px;
  color: #fff;
}

.kpi-card__icon--blue { background: linear-gradient(135deg, #1677FF, #4096FF); }
.kpi-card__icon--green { background: linear-gradient(135deg, #52C41A, #73D13D); }
.kpi-card__icon--purple { background: linear-gradient(135deg, #722ED1, #9254DE); }
.kpi-card__icon--orange { background: linear-gradient(135deg, #FA8C16, #FFC53D); }

/* ===== Charts Row ===== */
.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-card {
  background: #fff;
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.chart-card__title {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
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
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.detail-card__title {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  padding: 16px 20px 12px;
  border-bottom: 1px solid #F2F3F5;
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
  color: #86909C;
  text-align: left;
  padding: 8px 4px;
  border-bottom: 1px solid #F2F3F5;
}

.knowledge-table td {
  font-size: 13px;
  color: #1D2129;
  padding: 10px 4px;
  border-bottom: 1px solid #F7F8FA;
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
  background: #F2F3F5;
  border-radius: 4px;
  overflow: hidden;
}

.mastery-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.mastery-bar-value {
  font-size: 12px;
  color: #86909C;
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
  border-radius: 4px;
}

.trend-badge--up {
  color: #52C41A;
  background: #F6FFED;
}

.trend-badge--down {
  color: #F53F3F;
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
  color: #1D2129;
}

.pie-center-label {
  font-size: 11px;
  color: #86909C;
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
  color: #4E5969;
}

.pie-legend-value {
  color: #86909C;
  font-size: 12px;
}

/* ===== Recent Wrong Records ===== */
.recent-wrong-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.recent-wrong-card__title {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  padding: 16px 20px 12px;
  border-bottom: 1px solid #F2F3F5;
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
  color: #86909C;
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #F2F3F5;
  white-space: nowrap;
}

.wrong-record-table td {
  font-size: 13px;
  color: #1D2129;
  padding: 10px 12px;
  border-bottom: 1px solid #F7F8FA;
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
  border-radius: 3px;
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
  color: #F53F3F;
}

.record-answer--correct {
  color: #22C55E;
}

.recent-wrong-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid #F2F3F5;
}

.record-count {
  font-size: 12px;
  color: #86909C;
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
  background: #E5E6EB;
  border-radius: 3px;
}

.growth-main::-webkit-scrollbar-thumb:hover {
  background: #C9CDD4;
}
</style>
