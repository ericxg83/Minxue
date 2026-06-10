<template>
  <div class="growth-container" v-loading="loading">
    <!-- 顶部导航 -->
    <div class="top-nav">
      <el-button text @click="handleGoBack" class="back-btn">
        ← 返回工作台
      </el-button>
      <div class="top-nav-title">
        <h2 class="growth-title">学生成长中心</h2>
        <p class="growth-subtitle">基于真实数据，记录学习成长轨迹</p>
      </div>
    </div>

    <!-- 学生选择器 -->
    <div class="student-selector">
      <el-select v-model="selectedStudentId" placeholder="选择学生" @change="handleStudentChange" style="width: 100%">
        <el-option
          v-for="student in students"
          :key="student.id"
          :label="student.name"
          :value="student.id"
        />
      </el-select>
    </div>

    <template v-if="currentStudent">
      <!-- 基础统计卡片 -->
      <div class="stats-grid">
        <div class="stat-card" style="border-left-color: #007aff;">
          <div class="stat-label">累计录入</div>
          <div class="stat-value" style="color: #007aff;">{{ growthStore.totalQuestions }}</div>
          <div class="stat-unit">道题目</div>
        </div>
        <div class="stat-card" style="border-left-color: #ff3b30;">
          <div class="stat-label">累计错题</div>
          <div class="stat-value" style="color: #ff3b30;">{{ growthStore.totalWrongQuestions }}</div>
          <div class="stat-unit">道（去重后）</div>
        </div>
        <div class="stat-card" style="border-left-color: #34c759;">
          <div class="stat-label">已掌握</div>
          <div class="stat-value" style="color: #34c759;">{{ growthStore.masteredQuestions }}</div>
          <div class="stat-unit">道</div>
        </div>
        <div class="stat-card" style="border-left-color: #ff9500;">
          <div class="stat-label">未掌握</div>
          <div class="stat-value" style="color: #ff9500;">{{ growthStore.pendingQuestions }}</div>
          <div class="stat-unit">道</div>
        </div>
      </div>

      <!-- 掌握率大卡片 -->
      <div class="mastery-card">
        <div class="mastery-ring">
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#f0f0f0" stroke-width="10" />
            <circle
              cx="60" cy="60" r="50" fill="none" stroke="#34c759" stroke-width="10"
              stroke-dasharray="314" :stroke-dashoffset="314 - (314 * growthStore.masteryRate / 100)"
              transform="rotate(-90 60 60)" stroke-linecap="round"
            />
          </svg>
          <div class="mastery-rate-text">
            <span class="rate-number">{{ growthStore.masteryRate }}</span>
            <span class="rate-percent">%</span>
          </div>
        </div>
        <div class="mastery-label">掌握率</div>
      </div>

      <!-- 最近30天动态 -->
      <div class="section">
        <div class="section-title">最近30天动态</div>
        <div class="trend-row">
          <div class="trend-item">
            <div class="trend-icon trend-icon-up">↑</div>
            <div class="trend-content">
              <div class="trend-value">{{ growthStore.newWrongLast30Days }}</div>
              <div class="trend-label">新增错题</div>
            </div>
          </div>
          <div class="trend-divider"></div>
          <div class="trend-item">
            <div class="trend-icon trend-icon-down">↓</div>
            <div class="trend-content">
              <div class="trend-value">{{ growthStore.eliminatedWrongLast30Days }}</div>
              <div class="trend-label">消灭错题</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 掌握率趋势图 -->
      <div class="section">
        <div class="section-title">掌握率趋势（近7天）</div>
        <div class="chart-container">
          <div class="bar-chart">
            <div class="bar-chart-grid">
              <div v-for="item in growthStore.masteryRateTrend" :key="item.date" class="bar-item">
                <div class="bar-wrapper">
                  <div class="bar-fill mastery-bar" :style="{ height: Math.max(item.rate, 2) + '%' }">
                    <span class="bar-value">{{ item.rate }}%</span>
                  </div>
                </div>
                <div class="bar-label">{{ item.date }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 错题变化趋势 -->
      <div class="section">
        <div class="section-title">错题变化趋势（近7天）</div>
        <div class="chart-container">
          <div class="bar-chart">
            <div class="bar-chart-grid">
              <div v-for="item in growthStore.wrongQuestionTrend" :key="item.date" class="bar-item">
                <div class="bar-wrapper">
                  <div class="bar-fill wrong-bar" :style="{ height: Math.max(getBarHeight(item.count), 2) + '%' }">
                    <span class="bar-value">{{ item.count }}</span>
                  </div>
                </div>
                <div class="bar-label">{{ item.date }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 重练完成率 -->
      <div class="section">
        <div class="section-title">重练完成率</div>
        <div class="progress-card">
          <div class="progress-bar-bg">
            <div
              class="progress-bar-fill"
              :style="{ width: growthStore.reviewCompletionRate + '%' }"
            ></div>
          </div>
          <div class="progress-text">{{ growthStore.reviewCompletionRate }}% 的错题进行过重练</div>
        </div>
      </div>

      <!-- 科目统计 -->
      <div class="section" v-if="growthStore.subjectStats.length > 0">
        <div class="section-title">各科目掌握情况</div>
        <div class="subject-list">
          <div v-for="subject in growthStore.subjectStats" :key="subject.subject" class="subject-item">
            <div class="subject-header">
              <span class="subject-name">{{ subject.subject }}</span>
              <span class="subject-rate">{{ subject.rate }}%</span>
            </div>
            <div class="subject-bar">
              <div
                class="subject-bar-fill"
                :style="{ width: subject.rate + '%' }"
              ></div>
            </div>
            <div class="subject-detail">
              已掌握 {{ subject.mastered }} / 共 {{ subject.total }} 道
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <el-empty v-else description="请选择学生查看成长数据" />
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useGrowthStore } from '../stores/growthStore'
import { getStudents } from '../../services/apiService'
import { ElMessage } from 'element-plus'

const router = useRouter()
const growthStore = useGrowthStore()
const students = ref([])
const selectedStudentId = ref(null)
const loading = ref(false)

const currentStudent = computed(() => {
  return students.value.find(s => s.id === selectedStudentId.value)
})

// 获取柱状图高度百分比（基于最大值）
const getMaxWrongCount = () => {
  const trend = growthStore.wrongQuestionTrend
  if (trend.length === 0) return 1
  return Math.max(...trend.map(item => item.count), 1)
}

const getBarHeight = (count) => {
  const max = getMaxWrongCount()
  return (count / max) * 100
}

function handleStudentChange(studentId) {
  loading.value = true
  growthStore.setCurrentStudent(studentId)
  setTimeout(() => {
    loading.value = false
    const student = students.value.find(s => s.id === studentId)
    if (student) {
      ElMessage.success(`已切换到 ${student.name}`)
    }
  }, 300)
}

function handleGoBack() {
  router.push('/')
}

onMounted(async () => {
  // 自动清理旧缓存（版本更新时）
  try {
    const oldKeys = ['students_cache', 'tasks_cache_', 'wrong_questions_cache_', 'exams_cache_', 'generated_exams_cache_']
    oldKeys.forEach(prefix => {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(prefix)) {
          localStorage.removeItem(key)
          localStorage.removeItem(key + '_ts')
        }
      })
    })
  } catch (e) {}

  loading.value = true
  try {
    // 加载学生列表
    const result = await getStudents(false)
    const list = result.data || result || []
    students.value = Array.isArray(list) ? list : []

    // 默认选择第一个学生
    if (students.value.length > 0) {
      selectedStudentId.value = students.value[0].id
      growthStore.setCurrentStudent(selectedStudentId.value)
      await growthStore.loadData(selectedStudentId.value)
    }
  } catch (e) {
    console.error('加载学生列表失败:', e)
    ElMessage.error('加载数据失败')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.growth-container {
  padding: 16px;
  background: #f5f7fa;
  min-height: 100vh;
}

/* 顶部导航 */
.top-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.back-btn {
  flex-shrink: 0;
  font-size: 13px;
}

.top-nav-title {
  flex: 1;
}

.growth-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
}

.growth-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8e8e93;
}

/* 学生选择器 */
.student-selector {
  margin-bottom: 16px;
}

/* 基础统计网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  border-left: 4px solid;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.stat-label {
  font-size: 12px;
  color: #8e8e93;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.stat-unit {
  font-size: 11px;
  color: #b0b0b0;
  margin-top: 4px;
}

/* 掌握率大卡片 */
.mastery-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.mastery-ring {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mastery-rate-text {
  position: absolute;
  display: flex;
  align-items: baseline;
}

.rate-number {
  font-size: 32px;
  font-weight: 700;
  color: #1a1a1a;
}

.rate-percent {
  font-size: 16px;
  color: #8e8e93;
}

.mastery-label {
  margin-top: 12px;
  font-size: 14px;
  color: #6b7280;
}

/* 通用区块 */
.section {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f3f4f6;
}

/* 30天动态 */
.trend-row {
  display: flex;
  align-items: center;
  justify-content: space-around;
}

.trend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.trend-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
}

.trend-icon-up {
  background: #fff1f0;
  color: #ff3b30;
}

.trend-icon-down {
  background: #f6ffed;
  color: #34c759;
}

.trend-content {
  display: flex;
  flex-direction: column;
}

.trend-value {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a1a;
}

.trend-label {
  font-size: 12px;
  color: #8e8e93;
}

.trend-divider {
  width: 1px;
  height: 32px;
  background: #e5e7eb;
}

/* 柱状图 */
.chart-container {
  padding: 8px 0;
}

.bar-chart-grid {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  height: 160px;
  gap: 8px;
}

.bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.bar-wrapper {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.bar-fill {
  width: 60%;
  max-width: 40px;
  border-radius: 4px 4px 0 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  transition: height 0.3s ease;
  min-height: 4px;
  position: relative;
}

.mastery-bar {
  background: linear-gradient(180deg, #34c759, #28a745);
}

.wrong-bar {
  background: linear-gradient(180deg, #ff3b30, #d32f2f);
}

.bar-value {
  font-size: 10px;
  color: #fff;
  padding-top: 4px;
  font-weight: 500;
}

.bar-label {
  margin-top: 8px;
  font-size: 10px;
  color: #8e8e93;
}

/* 进度条 */
.progress-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-bar-bg {
  height: 12px;
  background: #f3f4f6;
  border-radius: 6px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #5856d6, #007aff);
  border-radius: 6px;
  transition: width 0.5s ease;
}

.progress-text {
  font-size: 12px;
  color: #8e8e93;
  text-align: center;
}

/* 科目统计 */
.subject-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.subject-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.subject-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.subject-name {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.subject-rate {
  font-size: 13px;
  font-weight: 600;
  color: #34c759;
}

.subject-bar {
  height: 6px;
  background: #f3f4f6;
  border-radius: 3px;
  overflow: hidden;
}

.subject-bar-fill {
  height: 100%;
  background: #34c759;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.subject-detail {
  font-size: 11px;
  color: #8e8e93;
}
</style>
