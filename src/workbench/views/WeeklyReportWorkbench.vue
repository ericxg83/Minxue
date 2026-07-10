<template>
  <div class="weekly-report-workbench">
    <!-- Top Bar -->
    <header class="top-bar">
      <div class="top-bar-left">
        <span class="page-title">周学习诊断报告</span>
        <el-select
          v-model="selectedStudentId"
          placeholder="选择学生（选填，不选则生成全部）"
          style="width: 260px"
          filterable
          clearable
          @change="handleStudentChange"
        >
          <el-option
            v-for="s in studentList"
            :key="s.id"
            :label="s.name"
            :value="s.id"
          >
            <span style="display: flex; align-items: center; gap: 8px;">
              <el-avatar :size="22" :src="s.avatar" />
              {{ s.name }}
              <span style="font-size: 12px; color: #86909C;">{{ s.grade }}</span>
            </span>
          </el-option>
        </el-select>
      </div>
      <div class="top-bar-right">
        <span class="stat-item">第 {{ weekNum }} 周</span>
        <span class="stat-item">{{ periodLabel }}</span>
        <el-button type="primary" :loading="generating" @click="handleGenerateCurrent">
          {{ selectedStudentId ? `生成 ${currentStudentName} 的报告` : '生成本周报告' }}
        </el-button>
        <el-button
          type="primary"
          plain
          :loading="generatingAll"
          @click="handleGenerateAll"
          class="btn-generate-all"
        >
          一键生成全部学生
        </el-button>
        <el-button
          type="success"
          plain
          :loading="generatingAll"
          :disabled="checkedIds.length === 0"
          @click="handleGenerateSelected"
        >
          生成勾选学生{{ checkedIds.length ? ` (${checkedIds.length})` : '' }}
        </el-button>
      </div>
    </header>

    <!-- Main Content -->
    <main class="main-content">
      <!-- 本周概览 -->
      <section class="summary-section" v-if="summaryData && !loadingSummary && !selectedStudentId">
        <div class="section-title">
          <el-icon><DataAnalysis /></el-icon>
          本周学习概览（{{ summaryData.reports.filter(r => r.stats?.totalQuestions > 0).length }}/{{ summaryData.reports.length }} 人有数据）
          <el-checkbox
            :model-value="allChecked"
            :indeterminate="isIndeterminate"
            @change="toggleCheckAll"
            style="margin-left: 16px;"
          >全选</el-checkbox>
        </div>
        <div class="kpi-grid">
          <div
            v-for="r in summaryData.reports"
            :key="r.student.id"
            class="kpi-card"
            :class="{ 'kpi-card--checked': checkedIds.includes(r.student.id) }"
          >
            <div class="kpi-card__header">
              <el-checkbox
                :model-value="checkedIds.includes(r.student.id)"
                @change="(v) => toggleCheck(r.student.id, v)"
                @click.stop
              />
              <div class="kpi-card__name" @click="selectedStudentId = r.student.id" style="cursor: pointer;">{{ r.student.name }}</div>
            </div>
            <div class="kpi-card__row" @click="selectedStudentId = r.student.id" style="cursor: pointer;">
              <div class="kpi-item">
                <div class="kpi-value" :style="{ color: getAccuracyColor(r.stats?.accuracy) }">
                  {{ r.stats ? r.stats.accuracy + '%' : '-' }}
                </div>
                <div class="kpi-label">正确率</div>
              </div>
              <div class="kpi-item">
                <div class="kpi-value" style="color: #F53F3F;">
                  {{ r.stats ? r.stats.newWrongCount : '-' }}
                </div>
                <div class="kpi-label">新增错题</div>
              </div>
              <div class="kpi-item">
                <div class="kpi-value" style="color: #1677FF;">
                  {{ r.stats ? r.stats.totalTasks : '-' }}
                </div>
                <div class="kpi-label">作业(份)</div>
              </div>
            </div>
            <div v-if="!r.stats" class="no-data">本周无学习数据</div>
          </div>
        </div>
      </section>

      <!-- 当前学生统计详情 -->
      <section class="detail-section" v-if="currentStudentDetail && !generatingAll">
        <!-- KPI Cards -->
        <div class="kpi-cards" v-if="currentStudentDetail.stats">
          <div class="kpi-card-big">
            <div class="kpi-card-big__label">本周作业</div>
            <div class="kpi-card-big__value">{{ currentStudentDetail.stats.totalTasks }}<span class="unit"> 份</span></div>
            <div class="kpi-card-big__sub">已完成 {{ currentStudentDetail.stats.completedTasks }} 份</div>
          </div>
          <div class="kpi-card-big">
            <div class="kpi-card-big__label">批改题量</div>
            <div class="kpi-card-big__value">{{ currentStudentDetail.stats.totalQuestions }}<span class="unit"> 题</span></div>
            <div class="kpi-card-big__sub">正确 {{ currentStudentDetail.stats.correctCount }} 题 / 错误 {{ currentStudentDetail.stats.wrongCount }} 题</div>
          </div>
          <div class="kpi-card-big">
            <div class="kpi-card-big__label">正确率</div>
            <div class="kpi-card-big__value" :style="{ color: getAccuracyColor(currentStudentDetail.stats.accuracy) }">
              {{ currentStudentDetail.stats.accuracy }}<span class="unit">%</span>
            </div>
            <el-progress
              :percentage="currentStudentDetail.stats.accuracy"
              :color="getAccuracyColor(currentStudentDetail.stats.accuracy)"
              :stroke-width="8"
              style="margin-top: 6px;"
            />
          </div>
          <div class="kpi-card-big">
            <div class="kpi-card-big__label">错题掌握</div>
            <div class="kpi-card-big__value">
              <span style="color: #16A34A;">{{ currentStudentDetail.stats.masteredCount }}</span>
              <span class="unit"> / </span>
              <span style="color: #DC2626;">{{ currentStudentDetail.stats.pendingCount }}</span>
            </div>
            <div class="kpi-card-big__sub">
              已掌握 {{ currentStudentDetail.stats.masteredCount }} 题 · 待提升 {{ currentStudentDetail.stats.pendingCount }} 题
            </div>
          </div>
        </div>

        <!-- 知识点诊断表 -->
        <el-card class="knowledge-card" v-if="currentStudentDetail.knowledgeDiagnosis?.length > 0">
          <template #header>
            <div class="card-header">
              <span><el-icon><TrendCharts /></el-icon> 知识点诊断</span>
            </div>
          </template>
          <el-table :data="currentStudentDetail.knowledgeDiagnosis" stripe style="width: 100%" size="small">
            <el-table-column prop="tag" label="知识点" min-width="160" />
            <el-table-column prop="totalCount" label="总题数" width="80" align="center" />
            <el-table-column prop="wrongCount" label="错误次数" width="90" align="center">
              <template #default="{ row }">
                <span :style="{ color: row.wrongCount >= 3 ? '#DC2626' : '#666', fontWeight: row.wrongCount >= 3 ? 600 : 400 }">
                  {{ row.wrongCount }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="accuracy" label="正确率" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="row.accuracy >= 80 ? 'success' : row.accuracy >= 60 ? 'warning' : 'danger'" size="small" effect="light">
                  {{ row.accuracy }}%
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="掌握程度" min-width="160">
              <template #default="{ row }">
                <el-progress
                  :percentage="row.accuracy"
                  :color="getAccuracyColor(row.accuracy)"
                  :stroke-width="12"
                  :text-inside="true"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 高频薄弱点提示 -->
        <el-card class="warning-card" v-if="currentStudentDetail.knowledgeDiagnosis?.length > 0" style="margin-top: 12px;">
          <div class="warning-card__content">
            <el-icon style="color: #FA8C16; margin-right: 8px;"><WarningFilled /></el-icon>
            <span>
              <strong>本周高频薄弱点：</strong>
              {{ topWeakTags }}
            </span>
          </div>
        </el-card>
      </section>

      <!-- 无数据提示 -->
      <section v-else-if="selectedStudentId && !currentStudentDetail?.stats && !generating">
        <el-empty description="该学生本周暂无学习数据" :image-size="80" />
      </section>

      <!-- 生成进度 -->
      <section class="progress-section" v-if="progressList.length > 0">
        <div class="section-title">
          <el-icon><List /></el-icon>
          生成进度
        </div>
        <div class="progress-list">
          <div class="progress-item" v-for="(item, idx) in progressList" :key="idx">
            <span class="progress-name">{{ item.name }}</span>
            <el-tag
              :type="getStatusType(item.status)"
              :icon="getStatusIcon(item.status)"
              size="small"
            >
              {{ getStatusLabel(item.status) }}
            </el-tag>
          </div>
        </div>
      </section>

      <!-- 生成结果 -->
      <section class="result-section" v-if="results.length > 0 && !generatingAll">
        <div class="section-title">
          <el-icon><FolderOpened /></el-icon>
          生成结果
          <el-button text type="primary" size="small" @click="handleDownloadAll" style="margin-left: 12px;">
            <el-icon><Download /></el-icon> 全部下载
          </el-button>
        </div>
        <div class="result-list">
          <div class="result-item" v-for="(r, idx) in results" :key="idx">
            <div class="result-left">
              <span class="result-name">{{ r.student.name }}</span>
              <el-tag
                :type="getStatusType(r.status)"
                size="small"
                effect="light"
              >
                {{ getStatusLabel(r.status) }}
              </el-tag>
            </div>
            <div class="result-right">
              <el-button
                v-if="r.status === 'done' && r.pdfBlob"
                text
                type="primary"
                size="small"
                @click="handleDownload(r)"
              >
                <el-icon><Download /></el-icon> 下载
              </el-button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, DataAnalysis, TrendCharts, List, FolderOpened, WarningFilled } from '@element-plus/icons-vue'
import { getStudents, getAllWeeklyReports } from '../../services/apiService'
import { generateWeeklyReport, generateAllWeeklyReports } from '../../utils/weeklyReportGenerator'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

// ── State ──
const selectedStudentId = ref('')
const studentList = ref([])
const summaryData = ref(null)
const loadingSummary = ref(false)
const generating = ref(false)
const generatingAll = ref(false)
const progressList = ref([])
const results = ref([])
const currentStudentDetail = ref(null)
const checkedIds = ref([])

const allChecked = computed(() =>
  summaryData.value?.reports?.length > 0 &&
  checkedIds.value.length === summaryData.value.reports.length
)
const isIndeterminate = computed(() =>
  checkedIds.value.length > 0 &&
  checkedIds.value.length < (summaryData.value?.reports?.length || 0)
)

function toggleCheck(id, checked) {
  if (checked) {
    if (!checkedIds.value.includes(id)) checkedIds.value.push(id)
  } else {
    checkedIds.value = checkedIds.value.filter(x => x !== id)
  }
}

function toggleCheckAll(checked) {
  checkedIds.value = checked
    ? (summaryData.value?.reports || []).map(r => r.student.id)
    : []
}

const weekNum = dayjs().isoWeek()
const periodLabel = computed(() => {
  const start = dayjs().startOf('isoWeek')
  const end = dayjs().endOf('isoWeek')
  return `${start.format('MM/DD')} ~ ${end.format('MM/DD')}`
})

const currentStudentName = computed(() => {
  const s = studentList.value.find(s => s.id === selectedStudentId.value)
  return s?.name || ''
})

// ── Lifecycle ──
onMounted(async () => {
  await loadStudents()
  await loadSummary()
})

// ── Methods ──
async function loadStudents() {
  try {
    const result = await getStudents(true)
    studentList.value = result.data || []
  } catch (e) {
    console.warn('加载学生列表失败:', e)
  }
}

async function loadSummary() {
  loadingSummary.value = true
  try {
    const data = await getAllWeeklyReports(1)
    if (data.success) summaryData.value = data
  } catch (e) {
    console.warn('加载周统计失败:', e)
  } finally {
    loadingSummary.value = false
  }
}

async function handleStudentChange(id) {
  currentStudentDetail.value = null
  if (!id) return
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const resp = await fetch(`${API_BASE}/weekly-report/${id}?weeks=1`)
    const data = await resp.json()
    if (data.success) currentStudentDetail.value = data
  } catch (e) {
    ElMessage.error('获取学生周统计失败')
  }
}

async function handleGenerateCurrent() {
  if (!selectedStudentId.value) {
    ElMessage.warning('请先选择学生')
    return
  }
  generating.value = true
  try {
    const pdfBlob = await generateWeeklyReport(selectedStudentId.value, { weeks: 1 })
    if (pdfBlob) {
      const name = currentStudentName.value
      const filename = `${name}_周学习诊断报告_第${weekNum}周_${dayjs().format('YYYYMMDD')}.pdf`
      saveAs(pdfBlob, filename)
      ElMessage.success('报告已生成')
    } else {
      ElMessage.warning('本周暂无学习数据')
    }
  } catch (e) {
    ElMessage.error('生成失败: ' + (e.message || '未知错误'))
  } finally {
    generating.value = false
  }
}

async function handleGenerateAll() {
  generatingAll.value = true
  progressList.value = []
  results.value = []
  currentStudentDetail.value = null

  try {
    const arr = await generateAllWeeklyReports({
      weeks: 1,
      onProgress: (studentName, status) => {
        progressList.value = progressList.value.filter(p => p.name !== studentName)
        progressList.value.push({ name: studentName, status })
      }
    })
    results.value = arr

    const done = arr.filter(r => r.status === 'done').length
    const skipped = arr.filter(r => r.status === 'skipped').length
    const failed = arr.filter(r => r.status === 'failed').length
    ElMessage.success(`已完成！成功 ${done} 人${skipped ? `，无数据 ${skipped} 人` : ''}${failed ? `，失败 ${failed} 人` : ''}`)
  } catch (e) {
    ElMessage.error('批量生成失败: ' + (e.message || '未知错误'))
  } finally {
    generatingAll.value = false
  }
}

async function handleGenerateSelected() {
  if (checkedIds.value.length === 0) {
    ElMessage.warning('请先勾选学生')
    return
  }
  generatingAll.value = true
  progressList.value = []
  results.value = []
  currentStudentDetail.value = null

  try {
    const arr = await generateAllWeeklyReports({
      weeks: 1,
      studentIds: [...checkedIds.value],
      onProgress: (studentName, status) => {
        progressList.value = progressList.value.filter(p => p.name !== studentName)
        progressList.value.push({ name: studentName, status })
      }
    })
    results.value = arr

    const done = arr.filter(r => r.status === 'done').length
    const skipped = arr.filter(r => r.status === 'skipped').length
    const failed = arr.filter(r => r.status === 'failed').length
    ElMessage.success(`已完成！成功 ${done} 人${skipped ? `，无数据 ${skipped} 人` : ''}${failed ? `，失败 ${failed} 人` : ''}`)
  } catch (e) {
    ElMessage.error('批量生成失败: ' + (e.message || '未知错误'))
  } finally {
    generatingAll.value = false
  }
}

function handleDownload(r) {
  if (!r.pdfBlob) return
  const filename = `${r.student.name}_周学习诊断报告_第${weekNum}周_${dayjs().format('YYYYMMDD')}.pdf`
  saveAs(r.pdfBlob, filename)
}

function handleDownloadAll() {
  results.value
    .filter(r => r.status === 'done' && r.pdfBlob)
    .forEach((r, i) => setTimeout(() => handleDownload(r), i * 500))
  ElMessage.success(`开始下载 ${results.value.filter(r => r.status === 'done').length} 份报告`)
}

// ── Helpers ──
function getAccuracyColor(accuracy) {
  if (!accuracy && accuracy !== 0) return '#86909C'
  return accuracy >= 80 ? '#16A34A' : accuracy >= 60 ? '#D97706' : '#DC2626'
}

function getStatusType(status) {
  switch (status) {
    case 'generating': return 'primary'
    case 'done': return 'success'
    case 'failed': return 'danger'
    case 'skipped': return 'warning'
    default: return 'info'
  }
}

function getStatusIcon(status) {
  return ''
}

function getStatusLabel(status) {
  switch (status) {
    case 'generating': return '生成中...'
    case 'done': return '已完成'
    case 'failed': return '失败'
    case 'skipped': return '无数据'
    default: return status
  }
}

const topWeakTags = computed(() => {
  if (!currentStudentDetail.value?.knowledgeDiagnosis?.length) return ''
  const top3 = currentStudentDetail.value.knowledgeDiagnosis.slice(0, 3)
  return top3.map(k => `「${k.tag}」正确率 ${k.accuracy}%`).join('；')
})
</script>

<style scoped>
.weekly-report-workbench {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F2F3F5;
}

/* ── Top Bar ── */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #1D2129;
  white-space: nowrap;
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.stat-item {
  font-size: 13px;
  color: #86909C;
  white-space: nowrap;
}

/* ── Main Content ── */
.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── KPI Grid ── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.kpi-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #e4e7ed;
  transition: box-shadow 0.2s;
}

.kpi-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.kpi-card--checked {
  border-color: #1677FF;
  background: #F0F7FF;
}

.kpi-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.kpi-card__header .kpi-card__name {
  margin-bottom: 0;
}

.kpi-card__name {
  font-size: 14px;
  font-weight: 600;
  color: #1D2129;
  margin-bottom: 10px;
}

.kpi-card__row {
  display: flex;
  gap: 16px;
}

.kpi-item {
  flex: 1;
  text-align: center;
}

.kpi-value {
  font-size: 22px;
  font-weight: 700;
}

.kpi-label {
  font-size: 11px;
  color: #86909C;
  margin-top: 2px;
}

.no-data {
  font-size: 12px;
  color: #C9CDD4;
  text-align: center;
  padding: 8px;
}

/* ── KPI Cards (detail) ── */
.kpi-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.kpi-card-big {
  background: #fff;
  border-radius: 8px;
  padding: 16px 20px;
  border: 1px solid #e4e7ed;
}

.kpi-card-big__label {
  font-size: 13px;
  color: #86909C;
  margin-bottom: 4px;
}

.kpi-card-big__value {
  font-size: 28px;
  font-weight: 700;
  color: #1D2129;
}

.kpi-card-big__value .unit {
  font-size: 14px;
  font-weight: 400;
  color: #86909C;
}

.kpi-card-big__sub {
  font-size: 12px;
  color: #86909C;
  margin-top: 4px;
}

/* ── Cards ── */
.knowledge-card,
.warning-card {
  margin-top: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.warning-card__content {
  display: flex;
  align-items: center;
  font-size: 14px;
  color: #9A3412;
  line-height: 1.6;
}

/* ── Progress ── */
.progress-section {
  margin-top: 16px;
}

.progress-list {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
}

.progress-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid #F2F3F5;
}

.progress-item:last-child {
  border-bottom: none;
}

.progress-name {
  font-size: 14px;
  color: #1D2129;
}

/* ── Results ── */
.result-section {
  margin-top: 16px;
}

.result-list {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
}

.result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #F2F3F5;
}

.result-item:last-child {
  border-bottom: none;
}

.result-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-name {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .top-bar {
    padding: 10px 12px;
  }

  .top-bar-left {
    width: 100%;
  }

  .page-title {
    font-size: 16px;
  }

  .top-bar-right {
    width: 100%;
    justify-content: stretch;
  }

  .top-bar-right .el-button {
    flex: 1;
  }

  .main-content {
    padding: 12px;
  }

  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .kpi-cards {
    grid-template-columns: 1fr 1fr;
  }

  .stat-item {
    font-size: 12px;
  }
}

@media (max-width: 480px) {
  .kpi-cards {
    grid-template-columns: 1fr;
  }

  .btn-generate-all {
    width: 100%;
  }
}
</style>