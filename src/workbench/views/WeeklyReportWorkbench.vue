<template>
  <div class="diagnosis-page wb-page">
    <div class="wb-page__inner">
      <PageHeader eyebrow="学生学习 / 诊断决策" title="学习诊断" description="发现学生学习问题，判断优先级，并直接安排下一步教学。">
        <template #badge><span class="period-badge">{{ periodLabel }}</span></template>
        <template #actions><ActionButton v-if="viewMode === 'single'" :disabled="!selectedStudentId" :loading="generating" @click="handleGenerateCurrent">生成报告</ActionButton></template>
      </PageHeader>

      <FilterBar class="diagnosis-filter">
        <template #leading><el-segmented v-model="viewMode" :options="viewModeOptions" /></template>
        <el-select v-if="viewMode === 'single'" v-model="selectedStudentId" class="student-select" placeholder="选择学生" filterable clearable @change="handleStudentChange">
          <el-option v-for="student in studentList" :key="student.id" :label="student.name" :value="student.id"><span class="student-option"><el-avatar :size="22" :src="student.avatar" />{{ student.name }}<small>{{ student.grade }}</small></span></el-option>
        </el-select>
        <el-segmented v-model="periodMode" :options="periodModeOptions" />
        <el-select v-if="periodMode !== 'all'" v-model="periodOffset" class="offset-select"><el-option v-for="option in offsetOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select>
        <template #actions><span class="filter-note">{{ selectedStudentId ? currentStudentName : `${reportsWithData.length} 名学生有数据` }}</span></template>
      </FilterBar>

      <section class="diagnosis-stats" aria-label="学习诊断概览">
        <StatsCard label="本周期正确率" :value="`${overviewStats.accuracy || 0}%`" :description="selectedStudentId ? `${overviewStats.correctCount || 0} / ${overviewStats.totalQuestions || 0} 题正确` : `${overviewStats.studentCount || 0} 名学生纳入统计`" :tone="(overviewStats.accuracy || 0) < 60 ? 'danger' : (overviewStats.accuracy || 0) < 80 ? 'warning' : 'success'" />
        <StatsCard label="新增错题" :value="overviewStats.newWrongCount || 0" unit="题" description="本周期新进入错题记录" tone="danger" />
        <StatsCard label="待重练" :value="overviewStats.pendingCount || 0" unit="题" description="尚未完成掌握验证" tone="warning" />
        <StatsCard label="已掌握" :value="overviewStats.masteredCount || 0" unit="题" description="已完成重练验证" tone="success" />
        <StatsCard label="学习趋势" :value="selectedStudentId ? trendSummary.label : '选择学生后查看'" :description="selectedStudentId ? trendSummary.description : '趋势仅使用真实分日学习数据'" :tone="selectedStudentId ? trendSummary.tone : 'default'" />
      </section>

      <template v-if="viewMode === 'single'">
        <section v-if="!selectedStudentId" class="diagnosis-layout">
          <ContentCard class="student-attention" title="发现问题" description="按真实正确率、错题与待重练数量排列需要关注的学生" flush>
            <template #actions><el-checkbox :model-value="allChecked" :indeterminate="isIndeterminate" @change="toggleCheckAll">全选</el-checkbox></template>
            <div v-if="loadingSummary" class="loading-stack"><el-skeleton v-for="index in 5" :key="index" :rows="2" animated /></div>
            <EmptyState v-else-if="!attentionReports.length" title="暂无可诊断的学生数据" description="当前周期还没有已完成的批改数据，可以切换时间范围后重试。" />
            <div v-else class="student-diagnosis-list">
              <article v-for="report in attentionReports" :key="report.student.id" class="student-diagnosis-row" @click="focusStudent(report)">
                <el-checkbox :model-value="checkedIds.includes(report.student.id)" @click.stop @change="value => toggleCheck(report.student.id, value)" />
                <el-avatar :size="34">{{ report.student.name?.slice(0, 1) }}</el-avatar>
                <div class="student-identity"><strong>{{ report.student.name }}</strong><small>{{ report.student.grade || '暂无年级' }}</small></div>
                <span :class="['risk-status', studentRiskLevel(report).key]">{{ studentRiskLevel(report).label }}</span>
                <div class="student-metrics"><span><b>{{ report.stats ? `${report.stats.accuracy}%` : '-' }}</b>正确率</span><span><b>{{ report.stats?.newWrongCount ?? '-' }}</b>新增错题</span><span><b>{{ report.stats?.pendingCount ?? '-' }}</b>待重练</span></div>
                <div class="student-next"><span>建议动作</span><strong>{{ !report.stats ? '等待有效学习数据' : studentRiskLevel(report).key === 'critical' ? '优先查看错题并安排重练' : studentRiskLevel(report).key === 'attention' ? '检查薄弱知识点' : '保持观察' }}</strong></div>
                <el-icon class="row-arrow"><ArrowRight /></el-icon>
              </article>
            </div>
          </ContentCard>

          <div class="action-column">
            <ContentCard title="解决方案" description="把诊断结果直接转化为下一步">
              <div class="solution-list">
                <div class="solution-item"><span class="solution-icon danger"><el-icon><WarningFilled /></el-icon></span><div><strong>{{ aggregateStats.pendingCount || 0 }} 道题待完成重练验证</strong><p>优先选择重点关注学生处理</p></div><ActionButton :disabled="!selectedStudentId" @click="openWrongBook">查看错题</ActionButton></div>
                <div class="solution-item"><span class="solution-icon primary"><el-icon><EditPen /></el-icon></span><div><strong>生成针对性学习任务</strong><p>先选择学生，再基于错题安排重练</p></div><ActionButton :disabled="!selectedStudentId" variant="primary" @click="openWrongBook">进入错题中心</ActionButton></div>
              </div>
            </ContentCard>
            <ContentCard title="跨周期观察" description="长期改善需要连续周期数据">
              <div class="honest-state"><el-icon><TrendCharts /></el-icon><strong>暂不提供长期改善结论</strong><p>当前接口只返回所选周期数据，不展示未经验证的同比变化。</p></div>
            </ContentCard>
          </div>
        </section>

        <template v-else>
          <section v-if="currentStudentDetail?.stats" class="diagnosis-layout student-detail-layout">
            <ContentCard title="发现问题" :description="`${currentStudentName} · ${periodLabel}`">
              <div class="teaching-judgement">
                <div><span>已经看到</span><strong>{{ studentProgressText }}</strong></div>
                <div class="focus"><span>优先处理</span><strong>{{ topWeakTags || '本周期暂无明确薄弱知识点，继续观察' }}</strong></div>
                <div><span>下一步验证</span><strong>{{ nextActionText }}</strong></div>
              </div>
              <div v-if="periodMode === 'week'" class="trend-panel">
                <div class="trend-heading"><div><strong>周期内学习趋势</strong><span>只对比有答题记录的学习日</span></div><span :class="['trend-result', trendSummary.tone]">{{ trendSummary.label }}</span></div>
                <div v-if="currentStudentDetail.dailyTrend?.length" class="trend-bars"><div v-for="point in currentStudentDetail.dailyTrend" :key="point.day" class="trend-day"><div class="trend-track"><span :style="{ height: `${Math.max(4, point.accuracy || 0)}%` }" /></div><b>{{ point.total ? `${point.accuracy}%` : '-' }}</b><small>{{ point.day }}</small></div></div>
                <div v-else class="trend-empty">暂无分日学习数据</div>
              </div>
            </ContentCard>

            <ContentCard title="解决方案" description="基于当前诊断直接行动">
              <div class="solution-list single-solutions">
                <div class="solution-item"><span class="solution-icon danger"><el-icon><Collection /></el-icon></span><div><strong>{{ overviewStats.pendingCount || 0 }} 道待重练错题</strong><p>查看重复错误与题目详情</p></div><ActionButton @click="openWrongBook">查看错题</ActionButton></div>
                <div class="solution-item"><span class="solution-icon primary"><el-icon><EditPen /></el-icon></span><div><strong>发现 {{ weakKnowledgeCount }} 个薄弱知识点</strong><p>加入下一次针对性重练</p></div><ActionButton variant="primary" @click="openWrongBook">生成针对性重练</ActionButton></div>
              </div>
            </ContentCard>
          </section>

          <ContentCard v-if="currentStudentDetail?.knowledgeDiagnosis?.length" class="knowledge-diagnosis" title="知识点诊断" description="从掌握情况、错题表现到建议动作，帮助老师完成教学判断" flush>
            <DataTable :data="weakKnowledge" size="small" empty-text=" ">
              <el-table-column prop="tag" label="知识点" min-width="180"><template #default="{ row }"><div class="knowledge-name"><strong>{{ row.tag }}</strong><small>{{ row.subject || '其他' }}</small></div></template></el-table-column>
              <el-table-column label="当前掌握" width="130"><template #default="{ row }"><span :class="['mastery-status', knowledgeLevel(row).key]">{{ knowledgeLevel(row).label }} · {{ row.accuracy }}%</span></template></el-table-column>
              <el-table-column label="错题表现" width="130"><template #default="{ row }"><strong :class="{ 'danger-text': row.wrongCount >= 3 }">最近错误 {{ row.wrongCount }} 次</strong><small class="table-sub">共 {{ row.totalCount }} 题</small></template></el-table-column>
              <el-table-column label="最近变化" width="130"><template #default><span class="no-comparison">本周期累计</span><small class="table-sub">暂无知识点分日对比</small></template></el-table-column>
              <el-table-column label="建议动作" min-width="220"><template #default="{ row }"><div class="table-action"><span>{{ getDiagnosisAction(row) }}</span><el-button text type="primary" @click.stop="openWrongBook">加入重练</el-button></div></template></el-table-column>
            </DataTable>
          </ContentCard>
          <EmptyState v-else-if="!generating && currentStudentDetail" title="该学生当前周期暂无知识点诊断" description="可以切换周期，或等待新的批改数据进入诊断。" />
        </template>
      </template>

      <section v-else class="class-diagnosis-section">
        <ContentCard title="全班共性问题" :description="`${periodLabel} · 点击知识点查看涉及学生和典型错题`" flush>
          <template #actions><el-select v-model="diagSubject" class="subject-select" @change="loadClassDiagnosis"><el-option label="全部学科" value="" /><el-option label="数学" value="数学" /><el-option label="语文" value="语文" /><el-option label="英语" value="英语" /></el-select></template>
          <DataTable v-loading="loadingClassDiagnosis" :data="classDiagnosis" empty-text=" " :row-class-name="diagRowClass" @row-click="openDrill">
            <el-table-column prop="subject" label="学科" width="90" /><el-table-column prop="tag" label="知识点" min-width="180" />
            <el-table-column label="当前状态" width="130"><template #default="{ row }"><span :class="['mastery-status', row.blankCount > 0 || row.wrongCount >= 3 ? 'critical' : 'attention']">{{ row.blankCount > 0 ? '重点关注' : '需要关注' }}</span></template></el-table-column>
            <el-table-column label="错题表现" width="150"><template #default="{ row }"><strong>{{ row.wrongCount }} 次错误</strong><small class="table-sub">{{ row.blankCount }} 次空题</small></template></el-table-column>
            <el-table-column prop="studentCount" label="涉及学生" width="100" align="center" />
            <el-table-column label="建议动作" min-width="220"><template #default="{ row }"><span>{{ row.blankCount > 0 ? '优先讲解并当堂提问' : '安排共性错题重练' }}</span></template></el-table-column>
            <el-table-column width="50"><template #default><el-icon><ArrowRight /></el-icon></template></el-table-column>
          </DataTable>
          <EmptyState v-if="!loadingClassDiagnosis && !classDiagnosis.length" title="该时段暂无全班共性问题" description="可以切换时间范围或学科继续查看。" />
          <template #footer><div class="class-actions"><ActionButton :disabled="!classDiagnosis.length" @click="handleExportHandout">备课讲义</ActionButton><ActionButton variant="primary" :disabled="!classDiagnosis.length" @click="handleDistributeExam">生成共性错题再测</ActionButton></div></template>
        </ContentCard>
      </section>

      <ContentCard class="report-output" title="诊断报告" description="报告是完成诊断与教学安排后的最终输出，不影响当前页面继续分析。">
        <div class="report-options">
          <div><span class="report-icon"><el-icon><FolderOpened /></el-icon></span><div><strong>学生诊断报告</strong><p>包含周期表现、知识点诊断与错题再测内容</p></div></div>
          <div class="report-actions"><ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('week')">生成本周报告</ActionButton><ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('month')">生成本月报告</ActionButton><el-dropdown v-if="viewMode === 'single'" trigger="click"><el-button text>批量报告 <el-icon><ArrowRight /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item @click="handleGenerateAll">生成全部学生</el-dropdown-item><el-dropdown-item :disabled="!checkedIds.length" @click="handleGenerateSelected">生成勾选学生{{ checkedIds.length ? `（${checkedIds.length}）` : '' }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
        </div>
        <div v-if="progressList.length" class="progress-list"><div v-for="(item,index) in progressList" :key="index" class="progress-item"><span>{{ item.name }}</span><el-tag :type="getStatusType(item.status)" size="small">{{ getStatusLabel(item.status) }}</el-tag></div></div>
        <div v-if="results.length && !generatingAll" class="result-list"><div v-for="(result,index) in results" :key="index" class="result-item"><span><strong>{{ result.student.name }}</strong><el-tag :type="getStatusType(result.status)" size="small">{{ getStatusLabel(result.status) }}</el-tag></span><el-button v-if="result.status === 'done' && result.pdfBlob" text type="primary" @click="handleDownload(result)"><el-icon><Download /></el-icon>下载</el-button></div><el-button text type="primary" @click="handleDownloadAll">全部下载</el-button></div>
      </ContentCard>
    </div>
    <!-- 知识点下钻抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      size="520px"
      destroy-on-close
      :show-close="false"
    >
      <template #header>
        <div class="drawer-header">
          <div>
            <div class="drawer-title">「{{ drawerTag }}」诊断详情</div>
            <div class="drawer-sub">{{ periodLabel }}</div>
          </div>
          <el-button text @click="drawerVisible = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
      </template>
      <div v-loading="loadingDetail" class="drawer-body">
        <template v-if="drawerDetail">
          <div class="section-title">
            <el-icon><PieChart /></el-icon>
            错因分布（做错题共 {{ drawerDetail.totalWrong }} 道）
          </div>
          <div class="error-dist">
            <div class="error-item" v-for="e in drawerDetail.errorDist" :key="e.errorType">
              <span class="error-type" :style="{ color: errorTypeColor(e.errorType) }">{{ e.errorType }}</span>
              <el-progress
                :percentage="e.ratio"
                :color="errorTypeColor(e.errorType)"
                :stroke-width="12"
                style="flex: 1; margin: 0 12px;"
              />
              <span class="error-count">{{ e.count }}次 · {{ e.ratio }}%</span>
            </div>
            <div v-if="drawerDetail.errorDist.length === 0" class="muted" style="padding: 8px 0;">
              暂无做错题（该知识点仅有空题，空题不做错因分析）
            </div>
          </div>

          <div class="section-title" style="margin-top: 20px;">
            <el-icon><User /></el-icon>
            涉及学生（{{ drawerDetail.students.length }} 人）
          </div>
          <el-table :data="drawerDetail.students" stripe size="small" style="width: 100%">
            <el-table-column prop="name" label="姓名" min-width="100" />
            <el-table-column prop="grade" label="年级" width="90" align="center" />
            <el-table-column prop="blankCount" label="空题" width="80" align="center">
              <template #default="{ row }">
                <span v-if="row.blankCount > 0" class="blank-badge">{{ row.blankCount }}</span>
                <span v-else class="muted">0</span>
              </template>
            </el-table-column>
            <el-table-column prop="wrongCount" label="做错" width="80" align="center" />
          </el-table>

          <div class="section-title" style="margin-top: 20px;">
            <el-icon><Collection /></el-icon>
            典型错题（讲义例题）
          </div>
          <div v-if="drawerDetail.sampleQuestions?.length" class="sample-list">
            <div class="sample-item" v-for="(q, qi) in drawerDetail.sampleQuestions" :key="q.id">
              <div class="sample-q">{{ qi + 1 }}. {{ q.content }}</div>
              <div class="sample-meta">
                <span class="sample-stu">{{ q.studentName }}</span>
                <span v-if="q.isBlank" class="sample-answer sample-answer--blank">空题未作答</span>
                <span v-else class="sample-answer">作答：{{ q.studentAnswer || '未填写' }}</span>
                <span class="sample-answer">正确：{{ q.correctAnswer || '—' }}</span>
              </div>
              <div class="sample-reason">
                <el-tag v-if="!q.isBlank" size="small" :type="q.errorType ? 'danger' : 'info'" effect="light">
                  {{ q.errorType || '未标注' }}{{ q.errorReason ? `：${q.errorReason}` : '' }}
                </el-tag>
                <el-tag v-else size="small" type="warning" effect="light">空题（建议当堂提问）</el-tag>
              </div>
            </div>
          </div>
          <div v-else class="muted" style="padding: 8px 0;">暂未取到该知识点的错题样本</div>
        </template>
        <el-empty v-else description="暂无详情数据" :image-size="80" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download, DataAnalysis, TrendCharts, List, FolderOpened, WarningFilled, QuestionFilled, ArrowRight, Close, PieChart, User, Collection, EditPen } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatsCard from '../components/ui/StatsCard.vue'
import { getStudents, getAllWeeklyReports, getTeachingDiagnosis, getTeachingDiagnosisDetail } from '../../services/apiService'
import { generateWeeklyReport, generateAllWeeklyReports } from '../../utils/weeklyReportGenerator'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

const router = useRouter()

// ── State ──
const viewMode = ref('single')
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

const viewModeOptions = [
  { label: '单学生', value: 'single' },
  { label: '全班共性', value: 'class' }
]

// ── 全班共性诊断 State ──
const classDiagnosis = ref([])
const loadingClassDiagnosis = ref(false)
const diagSubject = ref('')
const drawerVisible = ref(false)
const drawerTag = ref('')
const drawerDetail = ref(null)
const loadingDetail = ref(false)
const exportingHandout = ref(false)

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

// ── Period State ──
const periodMode = ref('week')
const periodOffset = ref(0)

const periodModeOptions = [
  { label: '周', value: 'week' },
  { label: '月', value: 'month' },
  { label: '全部', value: 'all' }
]

const offsetOptions = computed(() => {
  if (periodMode.value === 'week') {
    return [
      { label: '本周', value: 0 },
      { label: '上周', value: 1 },
      { label: '前2周', value: 2 },
      { label: '前3周', value: 3 },
      { label: '前4周', value: 4 },
      { label: '前5周', value: 5 },
      { label: '前6周', value: 6 },
      { label: '前7周', value: 7 },
      { label: '前8周', value: 8 },
      { label: '前9周', value: 9 },
      { label: '前10周', value: 10 }
    ]
  }
  if (periodMode.value === 'month') {
    return [
      { label: '本月', value: 0 },
      { label: '上月', value: 1 },
      { label: '前2月', value: 2 },
      { label: '前3月', value: 3 }
    ]
  }
  return []
})

const weekNum = computed(() => {
  if (periodMode.value !== 'week') return ''
  return dayjs().subtract(periodOffset.value, 'week').isoWeek()
})

const periodLabel = computed(() => {
  if (periodMode.value === 'all') return '全部时间'
  if (periodMode.value === 'week') {
    const start = dayjs().subtract(periodOffset.value, 'week').startOf('isoWeek')
    const end = dayjs().subtract(periodOffset.value, 'week').endOf('isoWeek')
    return `第${dayjs().subtract(periodOffset.value, 'week').isoWeek()}周 ${start.format('MM/DD')} ~ ${end.format('MM/DD')}`
  }
  if (periodMode.value === 'month') {
    const m = dayjs().subtract(periodOffset.value, 'month')
    return `${m.format('YYYY年M月')}`
  }
  return ''
})

const currentStudentName = computed(() => {
  const s = studentList.value.find(s => s.id === selectedStudentId.value)
  return s?.name || ''
})

// ── Watch period changes to refresh data ──

watch([periodMode, periodOffset], () => {
  loadSummary()
  if (viewMode.value === 'class') loadClassDiagnosis()
  if (selectedStudentId.value) handleStudentChange(selectedStudentId.value)
})

watch(viewMode, (val) => {
  if (val === 'class') loadClassDiagnosis()
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
    const data = await getAllWeeklyReports({ mode: periodMode.value, offset: periodOffset.value })
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
    const resp = await fetch(`${API_BASE}/weekly-report/${id}?mode=${periodMode.value}&offset=${periodOffset.value}`)
    const data = await resp.json()
    if (data.success) currentStudentDetail.value = data
  } catch (e) {
    ElMessage.error('获取学生周统计失败')
  }
}

async function loadClassDiagnosis() {
  loadingClassDiagnosis.value = true
  try {
    const data = await getTeachingDiagnosis({
      mode: periodMode.value,
      offset: periodOffset.value,
      subject: diagSubject.value || undefined
    })
    classDiagnosis.value = data.success ? data.diagnosis : []
  } catch (e) {
    ElMessage.error('加载全班共性诊断失败')
  } finally {
    loadingClassDiagnosis.value = false
  }
}

async function openDrill(row) {
  if (!row) return
  drawerTag.value = row.tag
  drawerVisible.value = true
  drawerDetail.value = null
  loadingDetail.value = true
  try {
    const data = await getTeachingDiagnosisDetail(row.tag, {
      mode: periodMode.value,
      offset: periodOffset.value
    })
    drawerDetail.value = data.success ? data : null
  } catch (e) {
    ElMessage.error('加载知识点详情失败')
  } finally {
    loadingDetail.value = false
  }
}

function diagRowClass({ row }) {
  return row.blankCount > 0 ? 'diag-row--blank' : ''
}

async function handleExportHandout() {
  if (classDiagnosis.value.length === 0) return
  // P0-P4 重塑：跳转到 HandoutPreview 备课工作台（不再直接下载 docx）。
  // 老师可以在工作台切换模板、查看错题、编辑笔记、导 docx。
  exportingHandout.value = false
  router.push({
    name: 'HandoutPreview',
    query: {
      subject: diagSubject.value || '',
      periodMode: periodMode.value,
      periodOffset: periodOffset.value,
    },
  })
}

async function handleDistributeExam() {
  try {
    const { ElMessageBox } = await import('element-plus')
    await ElMessageBox.confirm(
      '<div style="line-height: 1.7;">' +
      '<p style="font-weight: 600; margin: 4px 0;">针对本轮共性错题，有两条发卷路径：</p>' +
      '<p style="margin: 6px 0;"><b style="color: #6366F1;">路径 A · 每周自动（推荐）</b><br/>' +
      '「周学习诊断报告」已内含每位学生的错题再测卷，点击下方按钮一键生成全部学生，下载打印即可发卷。</p>' +
      '<p style="margin: 6px 0;"><b style="color: var(--wb-success);">路径 B · 移动端临时卷</b><br/>' +
      '需要针对个别学生或某个知识点单独补练时，打开移动端 App「错题本」，勾选错题（最多 30 题）即可生成临时再测卷。</p>' +
      '<p style="color: var(--wb-text-tertiary); font-size: 12px; margin: 6px 0;">零组卷开发：两条路径均为系统既有能力，按需选用即可。</p>' +
      '</div>',
      '发「错题再测卷」',
      {
        confirmButtonText: '一键生成全部学生周报',
        cancelButtonText: '知道了',
        type: 'info',
        dangerouslyUseHTMLString: true
      }
    ).then(() => {
      handleGenerateAll()
    }).catch(() => {})
  } catch (e) {
    ElMessage.warning('发卷入口已取消')
  }
}

function subjectTagType(subject) {
  if (subject === '数学') return 'danger'
  if (subject === '语文') return 'primary'
  if (subject === '英语') return 'warning'
  return 'info'
}

function errorTypeColor(type) {
  if (type === '未标注') return 'var(--wb-text-tertiary)'
  // 运算类 → 红；审题类 → 橙；知识类 → 蓝；过程类 → 紫；方法类 → 绿；习惯类 → 灰
  if (/计算|运算/.test(type)) return 'var(--wb-danger)'
  if (/审题/.test(type)) return 'var(--wb-warning)'
  if (/公式|概念/.test(type)) return 'var(--wb-primary)'
  if (/步骤|单位/.test(type)) return '#8B5CF6'
  if (/方法|分析/.test(type)) return 'var(--wb-success)'
  if (/抄写|粗心/.test(type)) return 'var(--wb-text-secondary)'
  return 'var(--wb-text-secondary)'
}

async function handleGenerateCurrent() {
  if (!selectedStudentId.value) {
    ElMessage.warning('请先选择学生')
    return
  }
  generating.value = true
  try {
    // 返回值：{ mode: 'print' | 'download', pdfBlob?, message? }
    // - 生产环境：mode='print'（弹打印框另存为 PDF）
    // - 开发环境：mode='download'，含 pdfBlob（直接 saveAs）
    const result = await generateWeeklyReport(selectedStudentId.value, { mode: periodMode.value, offset: periodOffset.value })
    if (!result) {
      ElMessage.warning('该时段暂无学习数据')
      return
    }
    if (result.mode === 'print') {
      ElMessage.success(result.message || '请在打印对话框另存为 PDF')
    } else if (result.mode === 'download' && result.pdfBlob) {
      const name = currentStudentName.value
      const suffix = periodMode.value === 'all' ? '全部时间' : (periodMode.value === 'month' ? dayjs().subtract(periodOffset.value, 'month').format('M月') : `第${weekNum.value}周`)
      const filename = `${name}_周学习诊断报告_${suffix}_${dayjs().format('YYYYMMDD')}.pdf`
      saveAs(result.pdfBlob, filename)
      ElMessage.success('报告已生成')
    } else {
      ElMessage.error('生成失败：未拿到 PDF')
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
      mode: periodMode.value,
      offset: periodOffset.value,
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
      mode: periodMode.value,
      offset: periodOffset.value,
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
  const suffix = periodMode.value === 'all' ? '全部时间' : (periodMode.value === 'month' ? dayjs().subtract(periodOffset.value, 'month').format('M月') : `第${weekNum.value}周`)
  const filename = `${r.student.name}_周学习诊断报告_${suffix}_${dayjs().format('YYYYMMDD')}.pdf`
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
  if (!accuracy && accuracy !== 0) return 'var(--wb-text-tertiary)'
  return accuracy >= 80 ? 'var(--wb-success)' : accuracy >= 60 ? 'var(--wb-warning)' : 'var(--wb-danger)'
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
  const top3 = [...currentStudentDetail.value.knowledgeDiagnosis]
    .sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy)
    .slice(0, 3)
  return top3.map(k => `「${k.tag}」${k.wrongCount}次错误，正确率${k.accuracy}%`).join('；')
})

const studentProgressText = computed(() => {
  const stats = currentStudentDetail.value?.stats
  if (!stats) return '暂无足够数据'
  if (stats.masteredCount > 0 && stats.pendingCount > 0) return `已有${stats.masteredCount}题完成掌握验证，仍有${stats.pendingCount}题需要继续跟进`
  if (stats.masteredCount > 0) return `已有${stats.masteredCount}题完成掌握验证`
  if (stats.pendingCount > 0) return `本周期记录${stats.pendingCount}题待提升错题，先处理高频问题`
  return '本周期暂未形成可验证的错题掌握记录'
})

const nextActionText = computed(() => {
  const diagnosis = currentStudentDetail.value?.knowledgeDiagnosis || []
  if (!diagnosis.length) return '保持观察，出现重复错误后再安排针对训练'
  const focus = [...diagnosis].sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy)[0]
  if (focus.accuracy < 60) return `先讲清「${focus.tag}」的解题方法，再用相近变式独立复测`
  if (focus.wrongCount >= 2) return `安排「${focus.tag}」错题重练，重点观察是否还需要提示`
  return `安排「${focus.tag}」相近题复测，确认能否迁移`
})

function getDiagnosisAction(row) {
  if (row.accuracy < 60 || row.wrongCount >= 3) return '优先讲解，次日重练'
  if (row.accuracy < 80 || row.wrongCount >= 2) return '安排变式，观察独立完成'
  return '暂不加题，后续复测巩固'
}

const reportsWithData = computed(() => (summaryData.value?.reports || []).filter(r => r.stats?.totalQuestions > 0))
const aggregateStats = computed(() => {
  const reports = reportsWithData.value
  const totals = reports.reduce((acc, report) => {
    const stats = report.stats || {}
    acc.questions += stats.totalQuestions || 0
    acc.correct += stats.correctCount || 0
    acc.newWrong += stats.newWrongCount || 0
    acc.pending += stats.pendingCount || 0
    acc.mastered += stats.masteredCount || 0
    return acc
  }, { questions: 0, correct: 0, newWrong: 0, pending: 0, mastered: 0 })
  return {
    accuracy: totals.questions ? Math.round((totals.correct / totals.questions) * 1000) / 10 : 0,
    newWrongCount: totals.newWrong,
    pendingCount: totals.pending,
    masteredCount: totals.mastered,
    studentCount: reports.length
  }
})
const overviewStats = computed(() => selectedStudentId.value && currentStudentDetail.value?.stats ? currentStudentDetail.value.stats : aggregateStats.value)
const attentionReports = computed(() => [...(summaryData.value?.reports || [])].sort((a, b) => studentRiskScore(b) - studentRiskScore(a)))
const weakKnowledge = computed(() => [...(currentStudentDetail.value?.knowledgeDiagnosis || [])].sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy))
const weakKnowledgeCount = computed(() => weakKnowledge.value.filter(row => row.accuracy < 80 || row.wrongCount >= 2).length)
const dailyTrendPoints = computed(() => (currentStudentDetail.value?.dailyTrend || []).filter(point => point.total > 0))
const trendSummary = computed(() => {
  const points = dailyTrendPoints.value
  if (periodMode.value !== 'week') return { label: '暂无周期趋势', description: '月度与全部时间暂不提供分日趋势', tone: 'default' }
  if (points.length < 2) return { label: '数据不足', description: '至少需要 2 天有效数据', tone: 'default' }
  const change = Math.round((points[points.length - 1].accuracy - points[0].accuracy) * 10) / 10
  if (change > 0) return { label: `上升 ${change}%`, description: '周期内首末有效学习日对比', tone: 'success' }
  if (change < 0) return { label: `下降 ${Math.abs(change)}%`, description: '周期内首末有效学习日对比', tone: 'danger' }
  return { label: '保持平稳', description: '周期内首末有效学习日持平', tone: 'primary' }
})
function studentRiskLevel(report) {
  const stats = report?.stats
  if (!stats || !stats.totalQuestions) return { key: 'normal', label: '暂无数据' }
  if (stats.accuracy < 60 || stats.pendingCount >= 5 || stats.newWrongCount >= 5) return { key: 'critical', label: '重点关注' }
  if (stats.accuracy < 80 || stats.pendingCount > 0 || stats.newWrongCount > 0) return { key: 'attention', label: '需要关注' }
  return { key: 'normal', label: '正常' }
}
function studentRiskScore(report) {
  const level = studentRiskLevel(report).key
  const stats = report?.stats || {}
  return (level === 'critical' ? 200 : level === 'attention' ? 100 : 0) + (stats.pendingCount || 0) * 3 + (stats.newWrongCount || 0) + (100 - (stats.accuracy || 0))
}
function focusStudent(report) {
  if (!report?.student?.id) return
  selectedStudentId.value = report.student.id
  handleStudentChange(report.student.id)
}
function openWrongBook() {
  if (!selectedStudentId.value) return ElMessage.info('请先选择学生')
  router.push({ path: '/wrongbook', query: { studentId: selectedStudentId.value } })
}
async function generatePeriodReport(mode) {
  if (!selectedStudentId.value) return ElMessage.info('请先选择学生')
  periodMode.value = mode
  periodOffset.value = 0
  await nextTick()
  handleGenerateCurrent()
}
function knowledgeLevel(row) {
  if (row.accuracy < 60 || row.wrongCount >= 3) return { key: 'critical', label: '较弱' }
  if (row.accuracy < 80 || row.wrongCount >= 2) return { key: 'attention', label: '待巩固' }
  return { key: 'normal', label: '稳定' }
}
</script>

<style scoped>
.diagnosis-page{color:var(--wb-text)}.period-badge{display:inline-flex;align-items:center;height:24px;padding:0 9px;color:var(--wb-primary);font-size:11px;font-weight:600;background:var(--wb-primary-soft);border-radius:999px}.diagnosis-filter{margin-bottom:16px}.student-select{width:220px}.offset-select,.subject-select{width:120px}.student-option{display:flex;align-items:center;gap:8px}.student-option small{margin-left:auto;color:var(--wb-text-tertiary)}.filter-note{color:var(--wb-text-tertiary);font-size:11px;white-space:nowrap}.diagnosis-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.diagnosis-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(320px,.75fr);align-items:start;gap:16px;margin-bottom:16px}.action-column{display:grid;gap:16px}.loading-stack{display:grid;gap:18px;padding:20px}.student-diagnosis-list{min-height:360px}.student-diagnosis-row{display:flex;align-items:center;gap:12px;min-height:82px;padding:12px 16px;box-sizing:border-box;border-bottom:1px solid var(--wb-border-light);cursor:pointer}.student-diagnosis-row:last-child{border-bottom:0}.student-diagnosis-row:hover{background:var(--wb-bg-elevated)}.student-identity{display:flex;width:110px;min-width:0;flex-direction:column;gap:3px}.student-identity strong{font-size:13px}.student-identity small{color:var(--wb-text-tertiary);font-size:10px}.risk-status,.mastery-status{display:inline-flex;align-items:center;height:23px;padding:0 8px;font-size:10px;font-weight:600;border-radius:5px;white-space:nowrap}.risk-status.normal,.mastery-status.normal{color:var(--wb-success);background:var(--wb-success-soft)}.risk-status.attention,.mastery-status.attention{color:var(--wb-warning);background:var(--wb-warning-soft)}.risk-status.critical,.mastery-status.critical{color:var(--wb-danger);background:var(--wb-danger-soft)}.student-metrics{display:grid;grid-template-columns:repeat(3,72px);gap:6px}.student-metrics span{display:flex;color:var(--wb-text-tertiary);font-size:9px;flex-direction:column;gap:3px}.student-metrics b{color:var(--wb-text);font-size:12px}.student-next{display:flex;min-width:170px;flex:1;flex-direction:column;gap:4px}.student-next span{color:var(--wb-text-tertiary);font-size:9px}.student-next strong{font-size:11px;font-weight:550}.row-arrow{color:var(--wb-text-tertiary)}.solution-list{display:grid;gap:0}.solution-item{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;padding:14px 0;border-bottom:1px solid var(--wb-border-light)}.solution-item:first-child{padding-top:0}.solution-item:last-child{padding-bottom:0;border-bottom:0}.solution-item div{min-width:0}.solution-item strong{font-size:12px}.solution-item p,.honest-state p,.report-options p{margin:4px 0 0;color:var(--wb-text-secondary);font-size:10px;line-height:1.5}.solution-icon,.report-icon{display:grid;width:32px;height:32px;place-items:center;border-radius:8px}.solution-icon.danger{color:var(--wb-danger);background:var(--wb-danger-soft)}.solution-icon.primary,.report-icon{color:var(--wb-primary);background:var(--wb-primary-soft)}.honest-state{display:flex;align-items:center;flex-direction:column;color:var(--wb-text-tertiary);text-align:center}.honest-state>.el-icon{margin-bottom:10px;font-size:26px}.honest-state strong{color:var(--wb-text);font-size:12px}.student-detail-layout{grid-template-columns:minmax(0,1.35fr) minmax(330px,.65fr)}.teaching-judgement{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--wb-border-light);border-radius:8px}.teaching-judgement>div{min-height:88px;padding:14px;border-right:1px solid var(--wb-border-light)}.teaching-judgement>div:last-child{border-right:0}.teaching-judgement .focus{background:#fffaf2}.teaching-judgement span{display:block;margin-bottom:7px;color:var(--wb-text-tertiary);font-size:10px}.teaching-judgement strong{font-size:11px;line-height:1.65}.trend-panel{margin-top:16px;padding-top:16px;border-top:1px solid var(--wb-border-light)}.trend-heading{display:flex;align-items:center;justify-content:space-between}.trend-heading>div{display:flex;flex-direction:column;gap:4px}.trend-heading strong{font-size:12px}.trend-heading span{color:var(--wb-text-tertiary);font-size:10px}.trend-result{font-size:11px;font-weight:600}.trend-result.success{color:var(--wb-success)}.trend-result.danger{color:var(--wb-danger)}.trend-result.primary{color:var(--wb-primary)}.trend-bars{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;height:120px;margin-top:14px}.trend-day{display:flex;align-items:center;min-width:0;flex-direction:column;gap:4px}.trend-track{display:flex;width:100%;height:72px;align-items:flex-end;justify-content:center;background:var(--wb-bg-elevated);border-radius:5px;overflow:hidden}.trend-track span{display:block;width:100%;background:var(--wb-primary-soft);border-top:2px solid var(--wb-primary)}.trend-day b{font-size:9px}.trend-day small{color:var(--wb-text-tertiary);font-size:8px}.trend-empty{padding:30px;color:var(--wb-text-tertiary);font-size:11px;text-align:center}.knowledge-diagnosis,.class-diagnosis-section{margin-bottom:16px}.knowledge-name{display:flex;flex-direction:column;gap:3px}.knowledge-name strong{font-size:12px}.knowledge-name small,.table-sub{display:block;color:var(--wb-text-tertiary);font-size:9px}.danger-text{color:var(--wb-danger)}.no-comparison{font-size:11px;color:var(--wb-text-secondary)}.table-action{display:flex;align-items:center;justify-content:space-between;gap:10px}.class-actions{display:flex;justify-content:flex-end;gap:8px}.report-output{margin-top:16px}.report-options{display:flex;align-items:center;justify-content:space-between;gap:20px}.report-options>div:first-child{display:flex;align-items:center;gap:10px}.report-options strong{font-size:12px}.report-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.progress-list,.result-list{display:grid;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--wb-border-light)}.progress-item,.result-item{display:flex;align-items:center;justify-content:space-between;min-height:36px}.result-item>span{display:flex;align-items:center;gap:8px}.drawer-header{display:flex;align-items:flex-start;justify-content:space-between}.drawer-title{font-size:16px;font-weight:650}.drawer-sub{margin-top:4px;color:var(--wb-text-tertiary);font-size:11px}.drawer-body{min-height:300px}.error-dist{display:grid;gap:12px}.error-item{display:flex;align-items:center}.error-type{width:90px;font-size:11px}.error-count{color:var(--wb-text-tertiary);font-size:10px}.sample-list{display:grid;gap:10px}.sample-item{padding:12px;background:var(--wb-bg-elevated);border-radius:8px}.sample-q{font-size:12px;line-height:1.6}.sample-meta,.sample-reason{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.sample-meta{color:var(--wb-text-secondary);font-size:10px}.blank-badge{color:var(--wb-danger);font-weight:600}.muted{color:var(--wb-text-tertiary)}.diagnosis-page :deep(.el-input__wrapper),.diagnosis-page :deep(.el-select__wrapper){min-height:34px;border-radius:8px;box-shadow:0 0 0 1px var(--wb-border) inset}.diagnosis-page :deep(.el-segmented){--el-segmented-item-selected-bg-color:#fff;--el-segmented-item-selected-color:var(--wb-primary)}.diagnosis-page :deep(.diag-row--blank td){background:#fffaf2!important}.diagnosis-page :deep(button:focus-visible){outline:2px solid var(--wb-primary);outline-offset:2px}@media(max-width:1180px){.diagnosis-stats{grid-template-columns:repeat(3,1fr)}.diagnosis-layout,.student-detail-layout{grid-template-columns:1fr}.student-next{display:none}}@media(max-width:760px){.diagnosis-stats{grid-template-columns:repeat(2,1fr)}.student-select,.offset-select{width:100%}.student-diagnosis-row{align-items:flex-start;flex-wrap:wrap}.student-metrics{width:100%;padding-left:58px}.teaching-judgement{grid-template-columns:1fr}.teaching-judgement>div{border-right:0;border-bottom:1px solid var(--wb-border-light)}.report-options{align-items:flex-start;flex-direction:column}.report-actions{width:100%}}
</style>
