<template>
  <div class="diagnosis-page wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学工作 / 学习诊断"
        title="学习诊断"
        description="看清一段时间的作业表现、错因和薄弱知识点，再生成家长反馈。"
      >
        <template #actions>
          <ActionButton
            :disabled="!selectedStudentId || loadingStudentDetail || !currentStudentDetail"
            :loading="generating"
            @click="handleGenerateCurrent"
          >导出家长报告</ActionButton>
          <span class="header-share-card">
            <GrowthCardButton :student-id="selectedStudentId || ''" :student-name="currentStudentName || ''" :mode="periodMode" :offset="periodOffset" />
          </span>
        </template>
      </PageHeader>

      <!-- r138：筛选条改variant='bare' —— 原来是一个 58px 高的白框，
           而它承载的只是「上下文」（我是谁、看哪段），不该比下面的结论框得更重。
           说明文字（filterNoteText）移到读数条副行，语义上更贴数字。 -->
      <FilterBar class="diagnosis-filter" variant="bare">
        <WorkbenchSelect v-model="selectedStudentId" :options="studentOptions" width="180px" aria-label="选择学生" placeholder="选择学生" />
        <el-segmented v-model="periodMode" :options="periodModeOptions" />
        <WorkbenchSelect v-if="periodMode !== 'all'" v-model="periodOffset" :options="offsetOptions" width="120px" aria-label="时间偏移" />
      </FilterBar>

      <!-- r135：删除 r133 的学生横排选择器（StudentPicker）。负责人验收反馈「姓名框好多余又丑」，
           核实确实三重冗余：顶栏「选择学生」下拉 + 下方「需要关注的学生」列表（行内含头像/姓名/年级/
           正确率/错题数且可点击进诊断）已完整覆盖选人与横向对比两个诉求，卡片排信息量反而最低。
           选人入口保留：下拉（快）+ 列表行点击（带上下文）。 -->

      <!-- r137（负责人裁决）：「班级备课」grade 视图与「我的讲义」一并下线，
           页面只剩单生诊断（家长反馈）一条主线，viewMode 分段器随之删除。 -->

      <!-- ═══ r138 视觉重构 ═══
           核心假设验证：页面不好看的主因不是设计系统不够，而是过度使用大型 Card。
           本轮改动（不改业务逻辑、不改 API / 路由 / 数据）：
           ① hero-strip 白卡 → DiagnosisReadout（无框读数条，全页最大数字 = 正确率）；
           ② 5 个 KPI → 3 个主指标（批改题量 / 新增错题 / 待攻克），
              「已记住」不再单列（与三态条重复且口径冲突，已合并到三态条）；
           ③ 「下一步做什么」从右栏第二屏提到**全宽第一屏** —— 它是全页结论；
           ④ 成长对比 4 项 → 压缩成 1 行脚注（3 项与顶部读数条重复）；
           ⑤ 重练战绩（右栏）与重练进步（主栏）数据重复、口径不同 → 只留一处；
           ⑥ 错因分布 / 正确率走势 / 知识点表 改variant='bare'（去白框）；
           ⑦ 「需要关注的学生」列表也改bare —— 行间已有 hairline，不需要再套白卡。 -->

      <!-- 未选学生：全班概览读数条 -->
      <DiagnosisReadout
        v-if="!selectedStudentId && reportsWithData.length"
        aria-label="全班学习概览"
        :accuracy="aggregateStats.totalQuestions ? aggregateStats.accuracy : null"
        :accuracy-text="aggregateStats.totalQuestions ? `${aggregateStats.accuracy}` : '—'"
        caption-title="全班概览"
        :caption-meta="`${periodLabel} · 共 ${summaryData?.reports?.length || 0} 名学生`"
        :note="`${reportsWithData.length} 名学生本周期有批改数据 · 完成作业 ${aggregateStats.completedTasks || 0} 份`"
        :metrics="aggregateMetrics"
        :mastered="aggregateStats.masteredCount"
        :basic="aggregateStats.basicMasteredCount"
        :todo="aggregateStats.notStartedCount"
        :practiced="aggregateStats.practicedCount"
      />

      <!-- 未选学生：需要关注的学生（bare 列表，行间 hairline） -->
      <section v-if="!selectedStudentId" class="attention">
        <header class="sec-head">
          <h2>需要关注的学生</h2>
          <p>按真实正确率、错题与待重练数量排列 · 点任意一行进入该生诊断</p>
        </header>
        <div v-if="loadingSummary" class="loading-stack"><el-skeleton v-for="index in 5" :key="index" :rows="2" animated /></div>
        <EmptyState
          v-else-if="summaryError"
          :icon="WarningFilled"
          title="学习诊断数据加载失败"
          :description="`${summaryError}。请检查网络后重试 —— 这不代表本周期没有批改数据。`"
        >
          <template #actions>
            <el-button size="small" type="primary" @click="loadSummary">重试</el-button>
          </template>
        </EmptyState>
        <EmptyState v-else-if="!attentionReports.length" title="暂无可诊断的学生数据" description="当前周期还没有已完成的批改数据，可以切换时间范围后重试。" />
        <div v-else class="student-diagnosis-list">
          <article v-for="report in attentionReports" :key="report.student.id" class="student-diagnosis-row" tabindex="0" role="button" :aria-label="`查看${report.student.name}的学习诊断，正确率${hasStats(report) ? `${report.stats.accuracy}%` : '暂无数据'}，${hasStats(report) ? report.stats.newWrongCount : '—'} 道新增错题`" @click="focusStudent(report)" @keydown.enter.prevent="focusStudent(report)" @keydown.space.prevent="focusStudent(report)">
            <el-avatar :size="34">{{ report.student.name?.slice(0, 1) }}</el-avatar>
            <div class="student-identity"><strong>{{ report.student.name }}</strong><small>{{ report.student.grade || '暂无年级' }}</small></div>
            <StatusTag :tone="studentRiskLevel(report).key === 'critical' ? 'danger' : studentRiskLevel(report).key === 'attention' ? 'warning' : 'success'">{{ studentRiskLevel(report).label }}</StatusTag>
            <div class="student-metrics"><span><b>{{ hasStats(report) ? `${report.stats.accuracy}%` : '—' }}</b>正确率</span><span><b>{{ hasStats(report) ? report.stats.newWrongCount : '—' }}</b>新增错题</span><span><b>{{ hasStats(report) ? securedOf(report.stats) : '—' }}</b>已掌握</span></div>
            <div class="student-next"><span>建议动作</span><strong>{{ !hasStats(report) ? '等待有效学习数据' : studentRiskLevel(report).key === 'critical' ? '优先查看错题并安排重练' : studentRiskLevel(report).key === 'attention' ? '检查薄弱知识点' : '保持观察' }}</strong></div>
            <el-icon class="row-arrow"><ArrowRight /></el-icon>
          </article>
        </div>
      </section>

      <template v-else>
        <div v-if="loadingStudentDetail" class="diagnosis-loading" role="status">正在整理所选学生的学习记录…</div>
        <EmptyState v-else-if="!currentStudentDetail" title="暂时无法显示诊断内容" description="请重新选择学生，或稍后重试。" />
        <div v-else class="student-diagnosis">

          <!-- ── 二级：学生当前状态（无框读数条）── -->
          <DiagnosisReadout
            v-if="singleHero"
            aria-label="学生学习概览"
            :accuracy="singleHero.acc"
            :accuracy-text="singleHero.accText"
            :caption-title="currentStudentName"
            :caption-meta="`${periodLabel} · ${singleHero.correctLine}`"
            :note="singleHero.totalTasks ? `完成作业 ${singleHero.completedTasks}/${singleHero.totalTasks} 份 · 反复错 ${singleHero.repeatWrongCount} 道` : `反复错 ${singleHero.repeatWrongCount} 道`"
            :metrics="singleMetrics"
            :mastered="singleHero.masteredCount"
            :basic="singleHero.basicMasteredCount"
            :todo="singleHero.notStartedCount"
            :practiced="singleHero.practicedCount"
          />

          <!-- ── 一级结论：「下一步做什么」提到全宽第一屏 ──
               r138 之前它在 356px 右栏第二屏、且每条自带卡片（卡片套卡片）。
               它是这一页真正要回答的问题（老师要的是「我今天该干什么」），
               所以位置必须最靠前，宽度必须够放完整句。 -->
          <section class="dx__next">
            <header class="sec-head">
              <h2>下一步做什么</h2>
              <p>按见效快慢排序 · 每条都有真实数据支撑 · 点开就能干</p>
            </header>
            <NextActions
              :error-causes="currentStudentDetail?.errorDistribution || []"
              :repeat-wrong-count="singleHero?.repeatWrongCount || 0"
              :basic-count="singleHero?.basicMasteredCount || 0"
              :todo-count="singleHero?.notStartedCount || 0"
              :zero-accuracy-tags="zeroAccuracyTags"
            />
          </section>

          <!-- ── 三级：为什么错（错因分布，bare + 轻量分析列表）── -->
          <ContentCard
            class="dx__errcause"
            variant="bare"
            title="为什么错"
            :description="currentStudentDetail?.errorDistribution?.length
              ? `${currentStudentDetail.errorDistribution.reduce((s, e) => s + e.count, 0)} 道错题已归因 · 占比最高的一类最该先抓`
              : '错因会在每周一凌晨自动回填，或随批改逐步补齐'"
          >
            <ErrorCauseBars
              :items="currentStudentDetail?.errorDistribution || []"
              @select="onErrorCauseClick"
            />
          </ContentCard>

          <!-- 学习趋势折线图（r130 新增，r132 加粒度切换）：周/月/全部三档都出图。
               它取代了旧版那张「周期内学习趋势」柱状图 —— 后者读的是 point.day /
               point.total，而后端buildDailyTrend 返回 {date, accuracy, count}，
               字段名对不上，柱子恒为 4% 空高、标签恒为 '-'，等于一张坏掉的图；
               且整块包在 v-if="periodMode === 'week'" 里，月/全部模式根本没图。
               保留两张图只会让老师困惑，故直接删旧留新（小而美：能删就删）。

               r132：默认「按天」。按周会把剧烈波动抹平 —— 实测陆晨曦 09-10
               只有 2/12 题（16.7%），按周看完全被平均掉。老师要看的正是
               「哪天崩了」，所以按天是默认，周是备选。

               r138：改 variant='bare'（去白框）；成长对比压缩成脚注一行。 -->
          <ContentCard
            v-if="currentStudentDetail?.stats"
            class="trend-line-card"
            variant="bare"
            title="正确率走势"
            :description="`${currentStudentName} · 只看有批改记录的时段 · 没批改的日子不计入`"
          >
            <template #actions>
              <div class="trend-switch">
                <button
                  v-for="opt in trendGranularityOptions"
                  :key="opt.key"
                  type="button"
                  class="trend-switch__btn"
                  :class="{ 'is-on': trendGranularity === opt.key }"
                  :aria-pressed="trendGranularity === opt.key"
                  @click="trendGranularity = opt.key"
                >{{ opt.label }}</button>
              </div>
            </template>
            <TrendLineChart :points="trendChartPoints" />
            <p v-if="trendChartPoints.length" class="trend-note">
              {{ trendSummary.description }}
            </p>
            <!-- r138：成长对比从独立大卡压缩成一行脚注。
                 原来 4 项里「正确率 / 新增错题 / 完成题量」与顶部读数条重复，
                 只剩「较上周涨跌」是这里独有的信息 ⇒ 只保留它。 -->
            <p v-if="growthFootnote" class="growth-footnote">{{ growthFootnote }}</p>
          </ContentCard>

          <!-- ⛔ 知识点表从「全量 133 行」改为「默认 5 行 + 可展开」（r134）。
               实测全量渲染高度**7622px** —— 一张卡把整个主栏拉成一条看不到头的长带，
               这正是负责人说的「长条通栏显得太丑」的元凶：
               ① 视觉上，主栏被一张无限长的表占满，右栏的 sticky 完全失去意义；
               ② 133 行里绝大多数是「错 1 次、正确率 90%+」的知识点，
                  排在后面根本不会被看到，等于占位。
               mockup 的做法是只列最该练的 5 行 + 一个「全部」入口 —— 保留信息可达性，
               但把首屏还给真正要处理的问题。
               r138：外层改 variant='bare'（表格本身需要列对齐，保留；壳去掉）。 -->
          <ContentCard
            v-if="currentStudentDetail?.knowledgeDiagnosis?.length"
            class="knowledge-diagnosis"
            variant="bare"
            title="最该练的知识点"
            :description="`按错误次数排序 · 共 ${weakKnowledge.length} 个知识点出过错 · ${
              weakKnowledgeCount > TOP_KNOWLEDGE_ROWS
                ? `先看最严重的 ${TOP_KNOWLEDGE_ROWS} 个`
                : '已全部列出'}`"
            flush
          >
            <template #actions>
              <button v-if="weakKnowledge.length > TOP_KNOWLEDGE_ROWS" type="button" class="kp-toggle" @click="knowledgeExpanded = !knowledgeExpanded">
                {{ knowledgeExpanded ? '只看最严重的' : `展开全部 ${weakKnowledge.length} 个` }}
              </button>
            </template>
            <DataTable :data="knowledgeRows" size="small" empty-text=" ">
              <el-table-column prop="tag" label="知识点" min-width="180"><template #default="{ row }"><div class="knowledge-name"><strong>{{ row.tag }}</strong><small>{{ row.subject || '其他' }}</small></div></template></el-table-column>
              <el-table-column label="当前掌握" width="130"><template #default="{ row }"><StatusTag :tone="knowledgeLevel(row).key === 'critical' ? 'danger' : knowledgeLevel(row).key === 'attention' ? 'warning' : 'success'">{{ knowledgeLevel(row).label }} · {{ row.accuracy }}%</StatusTag></template></el-table-column>
              <el-table-column label="错题表现" width="130"><template #default="{ row }"><strong :class="{ 'danger-text': row.wrongCount >= 3 }">最近错误 {{ row.wrongCount }} 次</strong><small class="table-sub">共 {{ row.totalCount }} 题</small></template></el-table-column>
              <el-table-column label="最近变化" width="150"><template #default="{ row }"><div v-if="knowledgeChange(row).prevWrong != null" class="recent-change"><strong :class="knowledgeChange(row).tone === 'down' ? 'change-good' : knowledgeChange(row).tone === 'up' ? 'change-bad' : ''">{{ knowledgeChange(row).deltaText }}</strong><small class="table-sub">上周 {{ knowledgeChange(row).prevWrong }} 次</small></div><div v-else class="recent-change"><strong class="change-new">本周新增</strong><small class="table-sub">上周未出现</small></div></template></el-table-column>
              <el-table-column label="建议动作" min-width="220"><template #default="{ row }"><div class="table-action"><span>{{ getDiagnosisAction(row) }}</span><el-button text type="primary" @click.stop="openWrongBook">加入重练</el-button></div></template></el-table-column>
            </DataTable>
            <p v-if="!knowledgeExpanded && weakKnowledge.length > TOP_KNOWLEDGE_ROWS" class="kp-note">
              其余 {{ weakKnowledge.length - TOP_KNOWLEDGE_ROWS }} 个知识点多为「错 1 次、正确率 90% 以上」，
              不占首屏；点右上角可展开查看。
            </p>
          </ContentCard>

          <!-- ── 四级：明细（折叠区，默认收起）──
               r138：重练进步 + 本周备课建议原本各占一张大卡，
               但它们是「查得到就行」的信息，不该和上面的结论抢首屏。
               折叠后首屏只剩：状态 → 结论 → 原因 → 走势 → 知识点。 -->
          <details v-if="retryProgressVisible" class="fold">
            <summary class="fold__head">
              <span class="fold__title">重练进步</span>
              <span class="fold__meta">{{ retryProgress.examCount }} 份卷 · {{ retryProgress.retriedCount }} 题 · 正确率 {{ retryProgress.retryAccuracy }}%</span>
            </summary>
            <div class="fold__body">
              <div class="retry-grid">
                <div class="retry-item">
                  <div class="retry-item__value">{{ retryProgress.examCount }}</div>
                  <div class="retry-item__label">完成重练卷</div>
                </div>
                <div class="retry-item">
                  <div class="retry-item__value">{{ retryProgress.retriedCount }}</div>
                  <div class="retry-item__label">重练题目</div>
                </div>
                <div class="retry-item">
                  <div class="retry-item__value" :class="{ 'is-good': (retryProgress.retryAccuracy || 0) >= 80 }">{{ retryProgress.retryAccuracy }}<small>%</small></div>
                  <div class="retry-item__label">重练正确率</div>
                </div>
                <!-- r138：原右栏「重练战绩」卡与此重复（同一个retryProgress），
                     且标签一个叫「推进到基本掌握」一个叫「推进到已记住」⇒ 口径冲突。
                     现在只留一处，统一用「推进到已记住」（与读数条/三态条措辞一致）。 -->
                <div class="retry-item">
                  <div class="retry-item__value" :class="{ 'is-good': retryProgress.pushedToBasic > 0 }">{{ retryProgress.pushedToBasic }}</div>
                  <div class="retry-item__label">推进到已记住</div>
                </div>
              </div>
              <p class="retry-note">
                答对 {{ retryProgress.correctCount }} 题 · 未通过回到待练 {{ retryProgress.stillNew }} 题
              </p>
            </div>
          </details>

          <details v-if="studentSuggestions.length" class="fold">
            <summary class="fold__head">
              <span class="fold__title">本周备课建议</span>
              <span class="fold__meta">{{ studentSuggestions.length }} 个知识点 · {{ currentStudentName }} · {{ periodLabel }}</span>
            </summary>
            <div class="fold__body">
              <div class="student-suggestion-list">
                <article v-for="(s, idx) in studentSuggestions" :key="s.kpName" class="student-suggestion-card">
                  <header>
                    <div class="rank-pill small">{{ idx + 1 }}</div>
                    <strong>{{ s.kpName }}</strong>
                    <span class="meta-inline">错题 {{ s.wrongCount }} · 空题 {{ s.blankCount }}</span>
                  </header>
                  <div v-if="s.errorDistribution?.length" class="mini-error-dist">
                    <div v-for="e in s.errorDistribution.slice(0, 3)" :key="e.errorType" class="mini-error-row">
                      <span :style="{ color: errorTypeColor(e.errorType) }">{{ e.errorType }}</span>
                      <span class="mini-error-count">{{ e.count }}次 · {{ e.ratio }}%</span>
                    </div>
                  </div>
                  <footer v-if="s.teachingAdvice">
                    <span class="advice-label">辅导建议：</span>
                    <strong>{{ s.teachingAdvice }}</strong>
                  </footer>
                </article>
              </div>
            </div>
          </details>

          <EmptyState v-else-if="!generating && currentStudentDetail && !studentSuggestions.length && !retryProgressVisible" title="该学生当前周期暂无知识点诊断" description="可以切换周期，或等待新的批改数据进入诊断。" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowRight, WarningFilled } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import GrowthCardButton from '../components/GrowthCardButton.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
// r138：新增 DiagnosisReadout（读数条）。它内部复用 TrophyBar（三态条），
// 取代了原hero-strip（白卡 + 正确率圆环 + 5 个 KPI）。
import DiagnosisReadout from '../components/diagnosis/DiagnosisReadout.vue'
import TrendLineChart from '../components/diagnosis/TrendLineChart.vue'
import ErrorCauseBars from '../components/diagnosis/ErrorCauseBars.vue'
import NextActions from '../components/diagnosis/NextActions.vue'
import { getStudents, getWeeklyReport, getAllWeeklyReports } from '../../services/apiService'
import { generateWeeklyReport } from '../../utils/weeklyReportGenerator'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

const router = useRouter()

// ── State ──
// r137（负责人裁决）：「班级备课」（年级备课建议 + 错题卷清单）与「我的讲义」属伪需求，
// 已基本不用，整个视图连同 viewMode 分段器一并下线；本页只剩单生学习诊断（家长反馈）一条主线。
// 讲义/错题卷 Word 导出、模板引擎、提词器等后端能力同步移除。
const selectedStudentId = ref('')
const studentList = ref([])
const summaryData = ref(null)
const loadingSummary = ref(false)
// 加载失败必须与「本周期真的没有批改数据」区分（第 129 轮）：此前失败后 summaryData
// 保持 null，页面渲染「暂无可诊断的学生数据」，老师会误以为这周白干了
const summaryError = ref('')
const generating = ref(false)
const currentStudentDetail = ref(null)

const loadingStudentDetail = ref(false)
let studentDetailRequestId = 0

// ── 单生学习建议 State ──
const studentSuggestions = ref([])
const loadingStudentSuggestions = ref(false)

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

// r138：filterNoteText 随模板里的 FilterBar actions 一起移除 —— 说明文字
// 现在直接写进读数条的 captionMeta / note（语义上更贴数字，不必绕一层插槽）。
// 保留导出以防后续复用；未使用的变量不会报错，但为避免 lint 噪音改名为注释说明。

// ── Watch period changes to refresh data ──

watch([periodMode, periodOffset], () => {
  loadSummary()
  if (selectedStudentId.value) handleStudentChange(selectedStudentId.value)
})

watch(selectedStudentId, (id) => {
  if (id) {
    handleStudentChange(id)
    loadStudentSuggestions()
  } else {
    currentStudentDetail.value = null
  }
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
  summaryError.value = ''
  try {
    const data = await getAllWeeklyReports({ mode: periodMode.value, offset: periodOffset.value })
    if (data.success) summaryData.value = data
    else summaryError.value = data.error || '加载失败'
  } catch (e) {
    console.warn('加载周统计失败:', e)
    summaryError.value = e?.message || '加载失败'
  } finally {
    loadingSummary.value = false
  }
}

async function handleStudentChange(id) {
  const requestId = ++studentDetailRequestId
  currentStudentDetail.value = null
  if (!id) {
    loadingStudentDetail.value = false
    return
  }

  loadingStudentDetail.value = true
  try {
    const data = await getWeeklyReport(id, { mode: periodMode.value, offset: periodOffset.value })
    if (requestId !== studentDetailRequestId) return
    if (!data?.success) throw new Error(data?.error || '获取学生周统计失败')
    currentStudentDetail.value = data
  } catch (e) {
    if (requestId === studentDetailRequestId) {
      ElMessage.error(e?.message || '获取学生周统计失败')
    }
  } finally {
    if (requestId === studentDetailRequestId) loadingStudentDetail.value = false
  }
}

async function loadStudentSuggestions() {
  if (!selectedStudentId.value) return
  loadingStudentSuggestions.value = true
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const url = new URL(`${API_BASE}/teaching/student-suggestions`, window.location.origin)
    url.searchParams.set('studentId', selectedStudentId.value)
    url.searchParams.set('mode', periodMode.value)
    url.searchParams.set('offset', String(periodOffset.value))
    const resp = await fetch(url.toString().replace(window.location.origin, ''))
    const data = await resp.json()
    if (data.success) {
      studentSuggestions.value = data.suggestions || []
    }
  } catch (e) {
    console.warn('加载单生学习建议失败:', e)
  } finally {
    loadingStudentSuggestions.value = false
  }
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

// ═══ 成长对比（prev）与重练进步（2026-09-20 P0） ═══
const lastPeriodLabel = computed(() => {
  if (periodMode.value === 'week') {
    const start = dayjs().subtract(periodOffset.value + 1, 'week').startOf('isoWeek')
    const end = dayjs().subtract(periodOffset.value + 1, 'week').endOf('isoWeek')
    return `${start.format('MM/DD')} ~ ${end.format('MM/DD')}`
  }
  if (periodMode.value === 'month') {
    return dayjs().subtract(periodOffset.value + 1, 'month').format('YYYY年M月')
  }
  return ''
})

const prevStats = computed(() => currentStudentDetail.value?.prev?.stats || null)
const prevHasData = computed(() => !!prevStats.value && (prevStats.value.totalQuestions > 0 || prevStats.value.newWrongCount > 0))

// 四项对比：正确率/完成题量 升=好；新增错题/待重练 升=坏
const growthCompareItems = computed(() => {
  const cur = currentStudentDetail.value?.stats || {}
  const prev = prevStats.value || {}
  const items = [
    { key: 'accuracy', label: '正确率', cur: cur.accuracy ?? 0, prev: prev.totalQuestions ? (prev.accuracy ?? null) : null, format: v => `${v}%`, betterWhen: 'up' },
    { key: 'newWrong', label: '新增错题', cur: cur.newWrongCount ?? 0, prev: prev.totalQuestions ? (prev.newWrongCount ?? null) : null, format: v => `${v} 题`, betterWhen: 'down' },
    { key: 'pending', label: '待重练', cur: cur.pendingCount ?? 0, prev: prev.totalQuestions ? (prev.pendingCount ?? null) : null, format: v => `${v} 题`, betterWhen: 'down' },
    { key: 'questions', label: '完成题量', cur: cur.totalQuestions ?? 0, prev: prev.totalQuestions ?? null, format: v => `${v} 题`, betterWhen: 'up' }
  ]
  return items.map(it => {
    const delta = it.prev != null ? it.cur - it.prev : null
    let tone = 'is-neutral'
    let deltaText = '与上周持平'
    if (delta != null && delta !== 0) {
      const good = (delta > 0 && it.betterWhen === 'up') || (delta < 0 && it.betterWhen === 'down')
      tone = good ? 'is-good' : 'is-bad'
      deltaText = `${delta > 0 ? '较上周 +' : '较上周 -'}${Math.abs(delta)}`
    }
    return {
      key: it.key,
      label: it.label,
      currentText: it.format(it.cur),
      prevText: it.prev != null ? it.format(it.prev) : '',
      deltaText,
      tone
    }
  })
})

// ═══ r138：成长对比从独立大卡压缩成一行脚注 ═══
// 原「成长对比」卡有 4 项（正确率 / 新增错题 / 待重练 / 完成题量），
// 其中 3 项与顶部读数条显示的是同一批数据 ⇒ 重复。
// 只保留这里独有的「较上周涨跌」，拼成一行放在趋势图脚注里。
// ⛔ 口径完全复用 growthCompareItems，不新增任何计算逻辑。
const growthFootnote = computed(() => {
  if (periodMode.value === 'all') return ''
  if (!prevHasData.value) return ''
  const parts = growthCompareItems.value
    .filter(item => item.prevText && item.deltaText !== '与上周持平')
    .map(item => `${item.label} ${item.deltaText}`)
  if (!parts.length) return `与${lastPeriodLabel}基本持平`
  return `较${periodMode.value === 'week' ? '上周' : '上月'}：${parts.join(' · ')}`
})

// 知识点「最近变化」：上周同名知识点错误次数对比
const prevTagWrongMap = computed(() => {
  const map = new Map()
  for (const k of currentStudentDetail.value?.prev?.knowledgeDiagnosis || []) {
    const subj = k.subject || '其他'
    if (!map.has(subj)) map.set(subj, new Map())
    map.get(subj).set(k.tag, k.wrongCount)
  }
  return map
})

function knowledgeChange(row) {
  const subjMap = prevTagWrongMap.value.get(row.subject || '其他')
  const prevWrong = subjMap?.get(row.tag)
  if (prevWrong == null) return { prevWrong: null }
  const cur = row.wrongCount
  if (cur > prevWrong) return { prevWrong, deltaText: `较上周 +${cur - prevWrong} 次`, tone: 'up' }
  if (cur < prevWrong) return { prevWrong, deltaText: `较上周 -${prevWrong - cur} 次`, tone: 'down' }
  return { prevWrong, deltaText: '与上周持平', tone: 'flat' }
}

const retryProgress = computed(() => currentStudentDetail.value?.retryProgress || null)
const retryProgressVisible = computed(() => !!retryProgress.value && retryProgress.value.examCount > 0)

// r133：原「发现问题」三栏文字卡（studentProgressText / topWeakTags / nextActionText）
// 已删除 —— 它把「已看到什么」用三段长句复述一遍，而这三个问题现在分别由
// 战果条（已拿下多少）、错因横条（为什么错）、NextActions（接下来做什么）更直接地回答。
// 三段文案在页面上是全大段文字，实测占了 240px 高度却没给任何可操作项。
// 「优先处理哪三��知识点」的信息也没丢：错因条下方与知识点表仍在，
// 且 NextActions 会把全错知识点合并成一条「合并讲一节」。

function getDiagnosisAction(row) {
  if (row.accuracy < 60 || row.wrongCount >= 3) return '优先讲解，次日重练'
  if (row.accuracy < 80 || row.wrongCount >= 2) return '安排变式，观察独立完成'
  return '暂不加题，后续复测巩固'
}

const reportsWithData = computed(() => (summaryData.value?.reports || []).filter(r => r.stats?.totalQuestions > 0))
// r130：三态（mastered / basicMastered / notStarted）从后端新字段取；
// 老字段 pendingCount 语义未变（= basic + todo），保留给排序与风险分级用。
const aggregateStats = computed(() => {
  const reports = reportsWithData.value
  const totals = reports.reduce((acc, report) => {
    const stats = report.stats || {}
    acc.questions += stats.totalQuestions || 0
    acc.correct += stats.correctCount || 0
    acc.newWrong += stats.newWrongCount || 0
    acc.pending += stats.pendingCount || 0
    acc.mastered += stats.masteredCount || 0
    acc.basic += stats.basicMasteredCount || 0
    acc.todo += stats.notStartedCount || 0
    acc.practiced += stats.practicedCount || 0
    return acc
  }, { questions: 0, correct: 0, newWrong: 0, pending: 0, mastered: 0, basic: 0, todo: 0, practiced: 0 })
  return {
    accuracy: totals.questions ? Math.round((totals.correct / totals.questions) * 1000) / 10 : 0,
    totalQuestions: totals.questions,
    newWrongCount: totals.newWrong,
    pendingCount: totals.pending,
    masteredCount: totals.mastered,
    basicMasteredCount: totals.basic,
    notStartedCount: totals.todo,
    practicedCount: totals.practiced,
    // 「已记住」= 完全掌握 + 基本掌握：家长要看的信心数字，答对过就该被承认
    securedCount: totals.mastered + totals.basic,
    studentCount: reports.length
  }
})

// ── r138：全班概览读数条的 3 个主指标 ──
// ⛔ 从原来的 5 个 KPI 减到 3 个：批改题量 / 新增错题 / 待攻克。
//   删掉「有数据学生」（移到 note 副行）与「已记住」
//   （后者与下方三态条显示同一批数据，且两处「已记住」口径不同 ⇒ 口径冲突，已合并）。
//   「完成作业」需要跨 report 汇总，单独累加，不进 aggregateStats 主体字段。
const aggregateCompletedTasks = computed(() =>
  reportsWithData.value.reduce((sum, report) => sum + (report.stats?.completedTasks || 0), 0)
)
const aggregateMetrics = computed(() => [
  { label: '批改题量', value: aggregateStats.value.totalQuestions },
  { label: '新增错题', value: aggregateStats.value.newWrongCount, tone: 'is-warn' },
  { label: '待攻克', value: aggregateStats.value.notStartedCount }
])

// 单生读数条的 3 个主指标（同 aggregateMetrics 口径，逐项对应而非重复统计）
const singleMetrics = computed(() => {
  const h = singleHero.value
  if (!h) return []
  return [
    { label: '批改题量', value: h.totalQuestions },
    { label: '新增错题', value: h.newWrongCount, tone: 'is-warn' },
    { label: '待攻克', value: h.notStartedCount }
  ]
})

// 单生 hero 数据视图：批改题量为 0 时正确率无意义，显示 —
const singleHero = computed(() => {
  const s = currentStudentDetail.value?.stats
  if (!s) return null
  const hasQuestions = (s.totalQuestions || 0) > 0
  const mastered = s.masteredCount || 0
  const basic = s.basicMasteredCount || 0
  return {
    acc: hasQuestions ? s.accuracy : null,
    accText: hasQuestions ? `${s.accuracy}%` : '—',
    correctLine: `答对 ${s.correctCount || 0}/${s.totalQuestions || 0} 题`,
    completedTasks: s.completedTasks || 0,
    totalTasks: s.totalTasks || 0,
    totalQuestions: s.totalQuestions || 0,
    newWrongCount: s.newWrongCount || 0,
    masteredCount: mastered,
    basicMasteredCount: basic,
    notStartedCount: s.notStartedCount || 0,
    practicedCount: s.practicedCount || 0,
    repeatWrongCount: s.repeatWrongCount || 0,
    // r130：「已掌握」把基本掌握算进来（答对过 1 次就是记住了），
    // 旧版只显示完全掌握 2 道，实际 16 道 —— 数字好看但失真。
    securedCount: mastered + basic
  }
})
const overviewStats = computed(() => selectedStudentId.value && currentStudentDetail.value?.stats ? currentStudentDetail.value.stats : aggregateStats.value)
const attentionReports = computed(() => [...(summaryData.value?.reports || [])].sort((a, b) => studentRiskScore(b) - studentRiskScore(a)))
const weakKnowledge = computed(() => [...(currentStudentDetail.value?.knowledgeDiagnosis || [])].sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy))
const weakKnowledgeCount = computed(() => weakKnowledge.value.filter(row => row.accuracy < 80 || row.wrongCount >= 2).length)
// r134：知识点表默认只出最严重的 5 行（见模板注释里的 7622px 教训）
const TOP_KNOWLEDGE_ROWS = 5
const knowledgeExpanded = ref(false)
const knowledgeRows = computed(() =>
  knowledgeExpanded.value ? weakKnowledge.value : weakKnowledge.value.slice(0, TOP_KNOWLEDGE_ROWS)
)
// ── 正确率走势图（r132：按天 / 按周 粒度切换）──
// 数据源优先用后端 r132 的 dailyAccuracy / weeklyAccuracy（口径同源、含 correct）。
// 旧字段 periodTrend / dailyTrend 保留兜底 —— r130 修的字段名错配不能回退。
// ⛔ 两种粒度都不补空日：当天没批改不是「全错」，空点一律过滤（折线自然断开）。
const trendGranularity = ref('day')
const trendGranularityOptions = [
  { key: 'day', label: '按天' },
  { key: 'week', label: '按周' }
]
const trendSource = computed(() => {
  const detail = currentStudentDetail.value || {}
  return trendGranularity.value === 'day'
    ? (detail.dailyAccuracy || [])
    : (detail.weeklyAccuracy || detail.periodTrend || detail.dailyTrend || [])
})
const trendChartPoints = computed(() => trendSource.value.filter(point => point && point.count > 0 && point.accuracy != null))
const trendSummary = computed(() => {
  const points = trendChartPoints.value
  const isDay = trendGranularity.value === 'day'
  if (points.length < 2) {
    return points.length === 1
      ? { label: '仅 1 段记录', description: '出现第二段批改数据后可看走势', tone: 'default' }
      : { label: '暂无趋势', description: '本周期没有批改记录', tone: 'default' }
  }
  // 按天的首末对比会被单日噪声主导（如某天只做 2 题），故按天只报「区间」不报涨跌，
  // 按周（样本量足够大）才给涨跌 —— 避免拿一个 16.7% 的单日去讲「下降 15%」。
  // ⛔ 极值只在「样本量够」的天里取：实测蔡怡希 09-24 只批改 2 题且全错，
  //   若把它算成「最低 0%」，会与 200 道题的 56% 同等呈现，明显误导。
  //   低样本天（题量 <10）只作为图上的空心点存在，不参与极值与文案。
  const first = points[0]
  const last = points[points.length - 1]
  if (isDay) {
    const solid = points.filter(p => p.count >= 10)
    const lowCount = points.length - solid.length
    if (solid.length >= 2) {
      const lowest = solid.reduce((a, b) => (b.accuracy < a.accuracy ? b : a))
      const highest = solid.reduce((a, b) => (b.accuracy > a.accuracy ? b : a))
      return {
        label: `${points.length} 天有批改`,
        description: `最高 ${highest.accuracy}%（${highest.date.slice(5)}）· 最低 ${lowest.accuracy}%（${lowest.date.slice(5)}）`
          + (lowCount > 0 ? ` · 另有 ${lowCount} 天题量不足 10 道，图上用空心点表示，波动大仅供参考` : '')
          + ' · 当天没批改的日子不计入',
        tone: 'default'
      }
    }
    return {
      label: `${points.length} 天有批改`,
      description: '每天批改的题量都不足 10 道，正确率波动大，先看整体题量再判断',
      tone: 'default'
    }
  }
  const change = Math.round((last.accuracy - first.accuracy) * 10) / 10
  if (change >= 3) return { label: `上升 ${change}%`, description: `${first.date.slice(5)} ${first.accuracy}% → ${last.date.slice(5)} ${last.accuracy}%`, tone: 'success' }
  if (change <= -3) return { label: `下降 ${Math.abs(change)}%`, description: `${first.date.slice(5)} ${first.accuracy}% → ${last.date.slice(5)} ${last.accuracy}%`, tone: 'danger' }
  return { label: '基本持平', description: `${first.date.slice(5)} ${first.accuracy}% → ${last.date.slice(5)} ${last.accuracy}%`, tone: 'primary' }
})
// r130：单生「已掌握」= 完全掌握 + 基本掌握。答对过 1 次就是记住了，
// 不该只认 2 次答对那一档（那是「完全掌握」的定义，不是「记住了没有」）。
function securedOf(stats) {
  if (!stats) return 0
  return (stats.masteredCount || 0) + (stats.basicMasteredCount || 0)
}

// ── r133 重构新增 ──
// （r135：原 1) pickerStudents / 4) focusStudentById 随学生横排选择器一并删除，见模板注释）
// 顶栏下拉的选项
const studentOptions = computed(() =>
  studentList.value.map(s => ({ value: s.id, label: s.name }))
)
// 2) 全错知识点：出题 >= 2 且正确率 0 —— 建议合并讲一节而不是逐个重练
const zeroAccuracyTags = computed(() => {
  const list = currentStudentDetail.value?.knowledgeDiagnosis || []
  return list
    .filter(k => (k.totalCount || 0) >= 2 && (k.wrongCount || 0) >= (k.totalCount || 0))
    .slice(0, 3)
    .map(k => k.tag)
})
// 3) 点错因条 → 下钻到错题中心（该类错题在错题本里可筛）
//    ⛔ 不直接调发卷接口：会动组卷链路（C 级敏感区），先跳到有现成勾选入口的页面。
function onErrorCauseClick(row) {
  ElMessage.info(`已定位「${row.errorType}」${row.count} 道 —— 到错题中心可勾选后一键发卷`)
  router.push({ path: '/students' })
}

// r116：与 studentRiskLevel 的「暂无数据」判定同口径 —— stats 存在但 totalQuestions=0
// （该生本周期没有任何作答）不等于正确率 0%，指标一律显示「—」，避免家长/老师误读。
function hasStats(report) {
  const stats = report?.stats
  return Boolean(stats && stats.totalQuestions)
}

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
}
// 第 91 轮：错题中心页面已下线，错题清单并入学生档案页 ⇒ 这里改指学生档案。
function openWrongBook() {
  if (!selectedStudentId.value) return ElMessage.info('请先选择学生')
  router.push({ path: `/students/${selectedStudentId.value}` })
}
function knowledgeLevel(row) {
  if (row.accuracy < 60 || row.wrongCount >= 3) return { key: 'critical', label: '较弱' }
  if (row.accuracy < 80 || row.wrongCount >= 2) return { key: 'attention', label: '待巩固' }
  return { key: 'normal', label: '稳定' }
}
</script>

<style scoped>
/* ══════════════════════════════════════════════════════════════════
   学习诊断页 · r138 视觉重构
   核心假设：页面不好看的主因不是设计系统不够，而是过度使用大型 Card。
   本轮验证的做法 —— 不新增设计语言，只用既有 token（spacing / typography /
   hairline border）重新组织层级：
     · 容器：8 张ContentCard → 3 个 variant='bare' 无卡区块 + 2 个折叠区
     · 横向：只有一条粗分隔线（页头下），其余全用 --wb-border-light
     · 纵向：靠 --wb-space-* 与字号层级建立，不靠盒子
   ⛔ 全程无渐变 / 发光 / 玻璃拟态 / 阴影 / 新色值 —— 只用 --wb-* token。
   ══════════════════════════════════════════════════════════════════ */

/* ── 页面骨架：收窄容器 + 上移筛选条 ──
   r138：原--wb-container-standard 是 1520px（全局 token，未改）。
   内容型页面（读数 + 列表 + 折线）在 1520px 下会被拉成稀疏长条，
   这里在页面内收窄到 1120px —— 留白变成「行的呼吸」而不是「盒子之间的空隙」。 */
.diagnosis-page{color:var(--wb-text)}
.diagnosis-page .wb-page__inner{max-width:1120px}

/* ── 小节标题（无容器区块的统一标题形态）──
   替代原来每张 ContentCard 的 header：h2 + 一句说明 + 下方 hairline。 */
.sec-head{margin-bottom:var(--wb-space-2)}
.sec-head h2{
  margin:0;color:var(--wb-text);
  font-size:var(--wb-fs-section);font-weight:var(--wb-fw-semibold);
  line-height:var(--wb-lh-tight);
}
.sec-head p{margin:var(--wb-space-1) 0 0;color:var(--wb-text-secondary);font-size:var(--wb-fs-meta);line-height:var(--wb-lh-normal)}

/* ── 筛选条（bare变体）：只保留下方 hairline ── */
.diagnosis-filter{margin-bottom:var(--wb-space-6)}

/* ══ 一级结论：「下一步做什么」（全宽 · 裸排版 · 编号清单）══
   r138 之前它在 356px 右栏第二屏、且每条自带卡片（卡片套卡片）。
   它是这一页真正要回答的问题，必须最靠前、宽度必须够放完整句。 */
.dx__next{margin-bottom:var(--wb-space-8)}
.dx__next .nextlist{margin-top:var(--wb-space-3)}

/* ══ 二/三级区块间距：用 --wb-space-8 做「呼吸」，不再靠卡片 gap ══ */
.dx__errcause,.trend-line-card,.knowledge-diagnosis{margin-bottom:var(--wb-space-8)}

/* ── 趋势区块内的粒度切换 ── */
.trend-switch{display:flex;gap:2px;padding:2px;background:var(--wb-bg-elevated);border-radius:8px}
.trend-switch__btn{padding:5px 13px;border:0;border-radius:6px;background:transparent;color:var(--wb-text-tertiary);font-size:12px;font-weight:600;cursor:pointer;transition:color var(--wb-motion-fast) var(--wb-motion-ease)}
.trend-switch__btn:hover{color:var(--wb-text)}
.trend-switch__btn.is-on{background:var(--wb-bg-card);color:var(--wb-primary);box-shadow:var(--wb-elev-card)}
.trend-note{margin:var(--wb-space-3) 0 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);line-height:var(--wb-lh-relaxed)}
/* r138：成长对比脚注。与趋势说明同字号档，只用间距分开—— 两者都是脚注。 */
.growth-footnote{
  margin:var(--wb-space-2) 0 0;padding-top:var(--wb-space-2);
  border-top:1px solid var(--wb-border-light);
  color:var(--wb-text-secondary);font-size:var(--wb-fs-caption);
  font-variant-numeric:tabular-nums;line-height:var(--wb-lh-relaxed);
}

/* ── 知识点表：bare 外壳下的补充说明 ── */
.kp-toggle{padding:5px 12px;border:1px solid var(--wb-border);border-radius:var(--wb-radius-sm);background:var(--wb-bg-card);color:var(--wb-status-info-fg);font-size:var(--wb-fs-caption);font-weight:var(--wb-fw-semibold);cursor:pointer;white-space:nowrap}
.kp-toggle:hover{background:var(--wb-bg-hover);border-color:var(--wb-border-strong)}
.kp-note{margin:0;padding:var(--wb-space-3) 0 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);line-height:var(--wb-lh-relaxed)}
.knowledge-name{display:flex;flex-direction:column;gap:3px}
.knowledge-name strong{font-size:12px}
.knowledge-name small,.table-sub{display:block;color:var(--wb-text-tertiary);font-size:9px}
.danger-text{color:var(--wb-status-danger-fg)}
.table-action{display:flex;align-items:center;justify-content:space-between;gap:10px}
.recent-change{display:flex;flex-direction:column;gap:3px}
.recent-change strong{font-size:12px;font-weight:650}
.recent-change .change-good{color:var(--wb-status-success-fg)}
.recent-change .change-bad{color:var(--wb-status-danger-fg)}
.recent-change .change-new{color:var(--wb-status-warning-fg)}

/* ══ 四级明细：折叠区（默认收起）══
   重练进步 + 本周备课建议是「查得到就行」的信息，不该和上面的结论抢首屏。
   用原生 <details>，无新组件、无动画、键盘可达。 */
.fold{border-top:1px solid var(--wb-border-light)}
.fold:last-of-type{border-bottom:1px solid var(--wb-border-light)}
.fold__head{
  display:flex;align-items:baseline;gap:var(--wb-space-4);
  padding:var(--wb-space-4) var(--wb-space-2);
  cursor:pointer;list-style:none;
}
.fold__head::-webkit-details-marker{display:none}
.fold__head:hover .fold__title{color:var(--wb-primary)}
.fold__head:focus-visible{outline:2px solid var(--wb-status-info-fg);outline-offset:-2px}
.fold__title{color:var(--wb-text);font-size:var(--wb-fs-body);font-weight:var(--wb-fw-semibold);transition:color var(--wb-motion-fast) var(--wb-motion-ease)}
.fold__meta{color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}
/* 展开标记：一个纯文本三角，用CSS 画，不引图标库 */
.fold__head::before{content:'▸';color:var(--wb-text-tertiary);font-size:11px}
.fold[open] .fold__head::before{content:'▾'}
.fold__body{padding:0 var(--wb-space-2) var(--wb-space-5)}

/* 重练网格：bare 语境下用竖线分隔，不用小灰盒 */
.retry-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;max-width:640px}
.retry-item{padding:0 var(--wb-space-5);border-left:1px solid var(--wb-border-light)}
.retry-item:first-child{padding-left:0;border-left:0}
.retry-item__value{color:var(--wb-text);font-size:var(--wb-fs-section);font-weight:var(--wb-fw-bold);line-height:var(--wb-lh-tight);font-variant-numeric:tabular-nums}
.retry-item__value small{color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-medium);margin-left:2px}
.retry-item__value.is-good{color:var(--wb-status-success-fg)}
.retry-item__label{margin-top:var(--wb-space-1);color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}
.retry-note{margin:var(--wb-space-4) 0 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);line-height:var(--wb-lh-relaxed)}

/* ── 备课建议（折叠区内）── */
.student-suggestion-list{display:grid;gap:var(--wb-space-4)}
.student-suggestion-card{padding-bottom:var(--wb-space-4);border-bottom:1px solid var(--wb-border-light)}
.student-suggestion-card:last-child{padding-bottom:0;border-bottom:0}
.student-suggestion-card header{display:flex;align-items:center;gap:var(--wb-space-3);margin-bottom:var(--wb-space-2)}
.student-suggestion-card header strong{font-size:var(--wb-fs-body)}
.meta-inline{color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);margin-left:auto}
.mini-error-dist{display:grid;gap:var(--wb-space-1);margin:var(--wb-space-2) 0}
.mini-error-row{display:flex;align-items:center;justify-content:space-between;font-size:var(--wb-fs-meta)}
.mini-error-count{color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}
.student-suggestion-card footer{margin-top:var(--wb-space-3);padding-top:var(--wb-space-3);border-top:1px solid var(--wb-border-light);font-size:var(--wb-fs-meta);color:var(--wb-text-secondary)}
.advice-label{color:var(--wb-text-tertiary);margin-right:4px}
.student-suggestion-card footer strong{color:var(--wb-primary);font-weight:600}
.rank-pill{display:grid;flex-shrink:0;width:22px;height:22px;place-items:center;color:#fff;background:var(--wb-primary);border-radius:50%;font-size:11px;font-weight:650}

/* ══ 未选学生：「需要关注的学生」（bare 列表）══
   原来是一张 flush 大卡；行与行之间本来就有 hairline，卡壳是多余的。 */
.attention{margin-bottom:var(--wb-space-8)}
.loading-stack{display:grid;gap:var(--wb-space-4);padding:var(--wb-space-5) 0}
.student-diagnosis-list{min-height:320px}
.student-diagnosis-row{
  display:flex;align-items:center;gap:var(--wb-space-3);
  min-height:72px;padding:var(--wb-space-3) var(--wb-space-2);
  box-sizing:border-box;border-bottom:1px solid var(--wb-border-light);cursor:pointer;
  transition:background var(--wb-motion-fast) var(--wb-motion-ease);
}
.student-diagnosis-row:hover{background:var(--wb-bg-hover)}
.student-diagnosis-row:focus-visible{outline:2px solid var(--wb-status-info-fg);outline-offset:-2px}
.student-identity{display:flex;width:110px;min-width:0;flex-direction:column;gap:3px}
.student-identity strong{font-size:var(--wb-fs-body)}
.student-identity small{color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}
.student-metrics{display:grid;grid-template-columns:repeat(3,84px);gap:var(--wb-space-2)}
.student-metrics span{display:flex;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);flex-direction:column;gap:3px}
.student-metrics b{color:var(--wb-text);font-size:var(--wb-fs-section);font-weight:var(--wb-fw-bold);line-height:var(--wb-lh-tight);font-variant-numeric:tabular-nums}
.student-next{display:flex;min-width:170px;flex:1;flex-direction:column;gap:4px}
.student-next span{color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}
.student-next strong{font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-medium)}
.row-arrow{color:var(--wb-text-tertiary)}

/* ── 页头右侧的分享卡按钮 ── */
.header-share-card{display:inline-flex;align-items:center}
.diagnosis-loading{padding:var(--wb-space-8) var(--wb-space-4);text-align:center;color:var(--wb-text-secondary);font-size:var(--wb-fs-meta)}

/* ── Element Plus 控件在诊断页的对齐（沿用 r133，未变）── */
.diagnosis-page :deep(.el-input__wrapper),.diagnosis-page :deep(.el-select__wrapper){min-height:34px;border-radius:8px;box-shadow:0 0 0 1px var(--wb-border) inset}
.diagnosis-page :deep(.el-segmented){--el-segmented-item-selected-bg-color:#fff;--el-segmented-item-selected-color:var(--wb-primary)}
.diagnosis-page :deep(button:focus-visible){outline:2px solid var(--wb-primary);outline-offset:2px}
/* bare 表格外壳：去掉 Element Plus 自带的表头底色，只留 hairline —— 表格需要列对齐，
   但不需要一整块底色（那是「容器感」的来源之一）。 */
.diagnosis-page :deep(.knowledge-diagnosis .el-table th.el-table__cell){background:transparent}

/* ══ 响应式 ══
   三个断点：1280（窄桌面，收指标列）/ 860（平板，指标转行）/ 640（手机，表格与网格转单列） */
@media(max-width:1280px){
  .student-next{display:none}
  .diagnosis-page .wb-page__inner{max-width:100%}
}
@media(max-width:860px){
  .retry-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--wb-space-4) 0}
  .retry-item:nth-child(3){padding-left:0;border-left:0}
  .student-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}
  .fold__head{flex-wrap:wrap;gap:var(--wb-space-2)}
}
@media(max-width:640px){
  .student-diagnosis-row{align-items:flex-start;flex-wrap:wrap;padding:var(--wb-space-4) var(--wb-space-2)}
  .student-metrics{width:100%;padding-left:0}
  .student-identity{width:auto;flex:1}
  .retry-grid{grid-template-columns:1fr}
  .retry-item{padding:var(--wb-space-2) 0 0;border-left:0;border-top:1px solid var(--wb-border-light)}
  .retry-item:first-child{padding-top:0;border-top:0}
}
@media(max-width:600px){:global(.app-shell:has(.diagnosis-page) > .app-sidebar){display:none}}
</style>
