<template>
  <div class="diagnosis-page wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学工作 / 学习诊断"
        title="学习诊断"
        description="发现学生学习问题，判断优先级，并直接安排下一步教学。"
      >
        <template #actions>
          <ActionButton
            v-if="viewMode === 'single'"
            :disabled="!selectedStudentId"
            :loading="generating"
            @click="handleGenerateCurrent"
          >生成报告</ActionButton>
        </template>
      </PageHeader>

      <FilterBar class="diagnosis-filter">
        <template #leading><el-segmented v-model="viewMode" :options="viewModeOptions" /></template>
        <WorkbenchSelect v-if="viewMode === 'grade'" v-model="selectedGrade" :options="gradeOptions" width="140px" aria-label="按年级筛选" placeholder="选择年级" />
        <el-select v-if="viewMode === 'single'" v-model="selectedStudentId" class="student-select" placeholder="选择学生" filterable clearable @change="handleStudentChange">
          <el-option v-for="student in studentList" :key="student.id" :label="student.name" :value="student.id"><span class="student-option"><el-avatar :size="22" :src="student.avatar" />{{ student.name }}<small>{{ student.grade }}</small></span></el-option>
        </el-select>
        <WorkbenchSelect v-if="viewMode === 'grade'" v-model="diagSubject" :options="diagSubjectOptions" width="120px" aria-label="按学科筛选" />
        <el-segmented v-model="periodMode" :options="periodModeOptions" />
        <WorkbenchSelect v-if="periodMode !== 'all'" v-model="periodOffset" :options="offsetOptions" width="120px" aria-label="时间偏移" />
        <template #actions><span class="filter-note">{{ filterNoteText }}</span></template>
      </FilterBar>

      <template v-if="viewMode === 'single'">
        <section v-if="!selectedStudentId" class="diagnosis-layout">
          <ContentCard class="student-attention" title="发现问题" description="按真实正确率、错题与待重练数量排列需要关注的学生" flush>
            <template #actions><el-checkbox :model-value="allChecked" :indeterminate="isIndeterminate" @change="toggleCheckAll">全选</el-checkbox></template>
            <div v-if="loadingSummary" class="loading-stack"><el-skeleton v-for="index in 5" :key="index" :rows="2" animated /></div>
            <EmptyState v-else-if="!attentionReports.length" title="暂无可诊断的学生数据" description="当前周期还没有已完成的批改数据，可以切换时间范围后重试。" />
            <div v-else class="student-diagnosis-list">
              <article v-for="report in attentionReports" :key="report.student.id" class="student-diagnosis-row" tabindex="0" role="button" :aria-label="`查看${report.student.name}的学习诊断，正确率${report.stats ? `${report.stats.accuracy}%` : '暂无数据'}，${report.stats?.newWrongCount ?? 0} 道新增错题`" @click="focusStudent(report)" @keydown.enter.prevent="focusStudent(report)" @keydown.space.prevent="focusStudent(report)">
                <el-checkbox :model-value="checkedIds.includes(report.student.id)" @click.stop @change="value => toggleCheck(report.student.id, value)" />
                <el-avatar :size="34">{{ report.student.name?.slice(0, 1) }}</el-avatar>
                <div class="student-identity"><strong>{{ report.student.name }}</strong><small>{{ report.student.grade || '暂无年级' }}</small></div>
                <StatusTag :tone="studentRiskLevel(report).key === 'critical' ? 'danger' : studentRiskLevel(report).key === 'attention' ? 'warning' : 'success'">{{ studentRiskLevel(report).label }}</StatusTag>
                <div class="student-metrics"><span><b>{{ report.stats ? `${report.stats.accuracy}%` : '-' }}</b>正确率</span><span><b>{{ report.stats?.newWrongCount ?? '-' }}</b>新增错题</span><span><b>{{ report.stats?.pendingCount ?? '-' }}</b>待重练</span></div>
                <div class="student-next"><span>建议动作</span><strong>{{ !report.stats ? '等待有效学习数据' : studentRiskLevel(report).key === 'critical' ? '优先查看错题并安排重练' : studentRiskLevel(report).key === 'attention' ? '检查薄弱知识点' : '保持观察' }}</strong></div>
                <el-icon class="row-arrow"><ArrowRight /></el-icon>
              </article>
            </div>
          </ContentCard>
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
          </section>

          <ContentCard v-if="currentStudentDetail?.knowledgeDiagnosis?.length" class="knowledge-diagnosis" title="知识点诊断" description="从掌握情况、错题表现到建议动作，帮助老师完成教学判断" flush>
            <DataTable :data="weakKnowledge" size="small" empty-text=" ">
              <el-table-column prop="tag" label="知识点" min-width="180"><template #default="{ row }"><div class="knowledge-name"><strong>{{ row.tag }}</strong><small>{{ row.subject || '其他' }}</small></div></template></el-table-column>
              <el-table-column label="当前掌握" width="130"><template #default="{ row }"><StatusTag :tone="knowledgeLevel(row).key === 'critical' ? 'danger' : knowledgeLevel(row).key === 'attention' ? 'warning' : 'success'">{{ knowledgeLevel(row).label }} · {{ row.accuracy }}%</StatusTag></template></el-table-column>
              <el-table-column label="错题表现" width="130"><template #default="{ row }"><strong :class="{ 'danger-text': row.wrongCount >= 3 }">最近错误 {{ row.wrongCount }} 次</strong><small class="table-sub">共 {{ row.totalCount }} 题</small></template></el-table-column>
              <el-table-column label="最近变化" width="130"><template #default><span class="no-comparison">本周期累计</span><small class="table-sub">暂无知识点分日对比</small></template></el-table-column>
              <el-table-column label="建议动作" min-width="220"><template #default="{ row }"><div class="table-action"><span>{{ getDiagnosisAction(row) }}</span><el-button text type="primary" @click.stop="openWrongBook">加入重练</el-button></div></template></el-table-column>
            </DataTable>
          </ContentCard>

          <ContentCard v-if="studentSuggestions.length" class="student-suggestions" title="本周备课建议（按 KP）" :description="`${currentStudentName} · ${periodLabel}`" flush>
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
          </ContentCard>
          <EmptyState v-else-if="!generating && currentStudentDetail" title="该学生当前周期暂无知识点诊断" description="可以切换周期，或等待新的批改数据进入诊断。" />
        </template>
      </template>

      <section v-else class="grade-suggestions-section">
        <ContentCard
          :title="`「${selectedGrade || '年级'}」本周备课建议`"
          :description="`${periodLabel} · ${diagSubject || '数学'} · ${gradeSuggestionsMeta?.studentCount ?? '-'} 名学生`
            + (gradeSuggestionsError ? ` · 加载失败：${gradeSuggestionsError}` : '')"
          flush
        >
          <template #actions>
            <ActionButton :loading="loadingGradeSuggestions" @click="retryGradeSuggestions">刷新</ActionButton>
          </template>
          <div v-if="loadingGradeSuggestions" class="loading-stack"><el-skeleton v-for="index in 3" :key="index" :rows="3" animated /></div>
          <EmptyState
            v-else-if="!gradeSuggestions.length"
            :icon="Reading"
            title="该年级本周暂无共性薄弱知识点"
            description="切换时间范围或学科继续查看，或等待新批改数据进入。"
          />
          <div v-else class="grade-suggestion-list">
            <article v-for="(s, idx) in gradeSuggestions" :key="s.kpName" class="grade-suggestion-card">
              <header class="card-header">
                <div class="rank-pill">{{ idx + 1 }}</div>
                <div class="kp-name-block">
                  <h3>{{ s.kpName }}</h3>
                  <div class="kp-meta">
                    <StatusTag :label="s.subject || '其他'" tone="neutral" />
                    <span class="meta-item"><b>{{ s.wrongCount }}</b> 道错题</span>
                    <span class="meta-item"><b>{{ s.blankCount }}</b> 道空题</span>
                    <span class="meta-item"><b>{{ s.studentCount }}</b> 名学生</span>
                  </div>
                </div>
              </header>

              <section v-if="s.errorDistribution?.length" class="card-section error-dist">
                <label>错因分布</label>
                <div class="error-bars">
                  <div v-for="e in s.errorDistribution" :key="e.errorType" class="error-bar-row">
                    <span class="error-type" :style="{ color: errorTypeColor(e.errorType) }">{{ e.errorType }}</span>
                    <el-progress :percentage="e.ratio" :color="errorTypeColor(e.errorType)" :stroke-width="10" style="flex: 1; margin: 0 10px;" />
                    <span class="error-count">{{ e.count }}次 · {{ e.ratio }}%</span>
                  </div>
                </div>
              </section>

              <section v-if="s.sampleQuestions?.length" class="card-section sample-list">
                <label>典型错题（讲义例题）</label>
                <div v-for="(q, qi) in s.sampleQuestions" :key="q.id" class="sample-item">
                  <div class="sample-q">{{ qi + 1 }}. {{ q.content }}</div>
                  <div class="sample-meta">
                    <span class="sample-stu">{{ q.studentName }}</span>
                    <span v-if="q.isBlank" class="sample-answer sample-answer--blank">空题未作答</span>
                    <span v-else class="sample-answer">作答：{{ q.studentAnswer || '未填写' }}</span>
                    <span class="sample-answer">正确：{{ q.correctAnswer || '—' }}</span>
                  </div>
                  <div class="sample-reason">
                    <StatusTag v-if="!q.isBlank" :tone="q.errorType ? 'danger' : 'info'">
                      {{ q.errorType || '未标注' }}{{ q.errorReason ? `：${q.errorReason}` : '' }}
                    </StatusTag>
                    <StatusTag v-else tone="warning">空题（建议当堂提问）</StatusTag>
                  </div>
                </div>
              </section>

              <footer v-if="s.teachingAdvice" class="card-footer">
                <el-icon><Reading /></el-icon>
                <span>教学建议：<strong>{{ s.teachingAdvice }}</strong></span>
              </footer>
            </article>
          </div>
        </ContentCard>
      </section>

      <!-- 周末讲题错题卷：按"具体题"维度聚合，错误率排序 -->
      <section v-if="viewMode === 'grade'" class="wrong-paper-section">
        <ContentCard
          class="wrong-paper-card"
          :title="`「${selectedGrade || '年级'}」本周错题卷清单`"
          :description="wrongPaperDescription"
          flush
        >
          <template #actions>
            <ActionButton :loading="exportingWrongPaper" :disabled="wrongPaperItems.length === 0" @click="handleExportWrongPaperAll">
              <el-icon><Download /></el-icon>导出全班讲义卷
            </ActionButton>
            <ActionButton :loading="loadingWrongPaper" @click="loadWrongPaper">
              <el-icon><Refresh /></el-icon>刷新
            </ActionButton>
          </template>

          <div v-if="loadingWrongPaper" class="loading-stack">
            <el-skeleton v-for="i in 4" :key="i" :rows="2" animated />
          </div>
          <EmptyState
            v-else-if="!wrongPaperItems.length"
            :icon="Reading"
            title="该年级本周暂无错题"
            description="切换时间范围或学科继续查看，或等待新批改数据进入。"
          />
          <DataTable
            v-else
            :data="wrongPaperItems"
            row-key="identityKey"
            :expand-row-keys="Array.from(expandedWrongRows)"
            :default-expand-all="false"
            size="small"
            empty-text=" "
            class="wrong-paper-table"
          >
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="wrong-paper-expand">
                  <div class="expand-row">
                    <span class="expand-label">正确答案</span>
                    <strong>{{ row.correctAnswer || '—' }}</strong>
                  </div>
                  <div v-if="row.involvedStudents?.length" class="expand-row">
                    <span class="expand-label">错的学生（{{ row.involvedStudents.length }} 人）</span>
                    <div class="student-chips">
                      <el-tag
                        v-for="s in row.involvedStudents"
                        :key="s.id"
                        :type="s.wrongTimes > 1 ? 'danger' : 'info'"
                        effect="plain"
                        size="small"
                      >
                        {{ s.name }}{{ s.wrongTimes > 1 ? ` ×${s.wrongTimes}` : '' }}
                      </el-tag>
                    </div>
                  </div>
                  <div v-if="row.errorDistribution?.length" class="expand-row">
                    <span class="expand-label">错因分布</span>
                    <div class="error-mini">
                      <span v-for="e in row.errorDistribution" :key="e.errorType" :style="{ color: errorTypeColor(e.errorType) }">
                        {{ e.errorType }} {{ e.count }}次 · {{ e.ratio }}%
                      </span>
                    </div>
                  </div>
                  <div v-if="row.knowledgeTags?.length" class="expand-row">
                    <span class="expand-label">知识点</span>
                    <span>
                      <el-tag v-for="t in row.knowledgeTags.slice(0, 4)" :key="t" type="info" effect="plain" size="small" style="margin-right: 4px;">
                        {{ t }}
                      </el-tag>
                    </span>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="row" width="48" align="center">
              <template #default="{ row, $index }">
                <span :class="['rank-num', { 'is-top': $index < 3 }]">{{ $index + 1 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="题目" min-width="280">
              <template #default="{ row }">
                <div class="wrong-q-cell">
                  <span class="wrong-q-content">{{ row.content }}</span>
                  <span v-if="row.knowledgeTags?.length" class="wrong-q-tags">
                    <el-tag
                      v-for="t in row.knowledgeTags.slice(0, 2)"
                      :key="t"
                      type="info"
                      effect="plain"
                      size="small"
                    >{{ t }}</el-tag>
                  </span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="错误率" width="110" align="center" sortable :sort-method="(a, b) => a.errorRate - b.errorRate">
              <template #default="{ row }">
                <div :class="['error-rate', errorRateTone(row.errorRate)]">
                  <strong>{{ row.errorRate }}%</strong>
                  <small>{{ row.studentCount }}/{{ wrongPaperMeta?.totalStudentCount || '-' }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="错题次数" width="86" align="center">
              <template #default="{ row }"><span>{{ row.wrongCount }}</span></template>
            </el-table-column>
            <el-table-column label="错因" min-width="160">
              <template #default="{ row }">
                <div v-if="row.errorDistribution?.length" class="error-tags">
                  <StatusTag
                    v-for="e in row.errorDistribution.slice(0, 2)"
                    :key="e.errorType"
                    :tone="errorTypeToTone(e.errorType)"
                    size="small"
                  >{{ e.errorType }} {{ e.ratio }}%</StatusTag>
                  <span v-if="row.errorDistribution.length > 2" class="muted">+{{ row.errorDistribution.length - 2 }}</span>
                </div>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" align="center" fixed="right">
              <template #default="{ row }">
                <div class="row-actions">
                  <el-button text size="small" @click="toggleWrongRow(wrongPaperRowKey(row))">
                    {{ isWrongRowExpanded(wrongPaperRowKey(row)) ? '收起' : '详情' }}
                  </el-button>
                  <el-button
                    text
                    type="primary"
                    size="small"
                    :disabled="!row.involvedStudents?.length"
                    @click="handleExportWrongPaperStudent(row)"
                  >个人卷</el-button>
                </div>
              </template>
            </el-table-column>
          </DataTable>
        </ContentCard>
      </section>

      <!-- 底部输出条：把诊断结论直接转化为下一步教学动作（替代原 report-output 大面板） -->
      <section class="output-bar" aria-label="诊断输出">
        <span class="output-bar__label">输出</span>
        <ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('week')">生成本周报告</ActionButton>
        <ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('month')">生成本月报告</ActionButton>
        <ActionButton @click="handleExportHandout">生成讲义</ActionButton>
        <ActionButton variant="primary" @click="handleDistributeExam">生成再测卷</ActionButton>
      </section>
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
                <StatusTag v-if="!q.isBlank" :tone="q.errorType ? 'danger' : 'info'">
                  {{ q.errorType || '未标注' }}{{ q.errorReason ? `：${q.errorReason}` : '' }}
                </StatusTag>
                <StatusTag v-else tone="warning">空题（建议当堂提问）</StatusTag>
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
import { ArrowRight, Close, PieChart, User, Collection, Reading, Download } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import { getStudents, getAllWeeklyReports, getTeachingDiagnosis, getTeachingDiagnosisDetail, getTeachingWrongPaper, exportWrongPaper } from '../../services/apiService'
import { generateWeeklyReport } from '../../utils/weeklyReportGenerator'
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
const currentStudentDetail = ref(null)
const checkedIds = ref([])

const viewModeOptions = [
  { label: '按年级', value: 'grade' },
  { label: '单生', value: 'single' }
]

// ── 全班共性诊断 State（保留兼容，新口径按年级） ──
const classDiagnosis = ref([])
const loadingClassDiagnosis = ref(false)
const diagSubject = ref('')
const diagSubjectOptions = [
  { label: '全部学科', value: '' },
  { label: '数学', value: '数学' },
  { label: '语文', value: '语文' },
  { label: '英语', value: '英语' }
]

// ── 年级备课建议 State（新口径：晚托班按年级） ──
const grades = ref([])
const selectedGrade = ref('')
const gradeSuggestions = ref([])
const gradeSuggestionsMeta = ref(null)
const loadingGradeSuggestions = ref(false)
const gradeSuggestionsError = ref('')

// ── 单生备课建议 State ──
const studentSuggestions = ref([])
const loadingStudentSuggestions = ref(false)
const drawerVisible = ref(false)
const drawerTag = ref('')
const drawerDetail = ref(null)
const loadingDetail = ref(false)

// ── 周末讲题错题卷 State（年级视图） ──
const wrongPaperItems = ref([])
const wrongPaperMeta = ref(null) // {totalStudentCount, wrongStudentCount, period}
const loadingWrongPaper = ref(false)
const wrongPaperError = ref('')
const exportingWrongPaper = ref(false)
const expandedWrongRows = ref(new Set()) // Set<identityKey>

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

const gradeOptions = computed(() =>
  grades.value.map(g => ({ label: g, value: g }))
)

const filterNoteText = computed(() => {
  if (viewMode.value === 'grade') {
    if (!selectedGrade.value) return '请选择年级'
    return `${selectedGrade.value} · ${gradeSuggestions.value.length} 个薄弱知识点`
  }
  return selectedStudentId.value
    ? currentStudentName.value
    : `${reportsWithData.value.length} 名学生有数据`
})

// 错题卷区块描述：年级 · 时段 · 学科 · 总人数 · 本周错题学生数 · 加载失败原因
const wrongPaperDescription = computed(() => {
  if (!selectedGrade.value) return '请选择年级'
  const meta = wrongPaperMeta.value
  const total = meta?.totalStudentCount ?? '-'
  const wrongStu = meta?.wrongStudentCount ?? '-'
  return `${selectedGrade.value} · ${periodLabel.value} · ${diagSubject.value || '数学'} · 共 ${total} 名学生 · ${wrongStu} 人本周错题${wrongPaperError.value ? ` · 加载失败：${wrongPaperError.value}` : ''}`
})

// 错误率档位（视觉强化）
function errorRateTone(rate) {
  if (rate >= 40) return 'is-critical'
  if (rate >= 20) return 'is-warning'
  if (rate >= 10) return 'is-info'
  return 'is-normal'
}

// 错因 → StatusTag tone（与已有 errorTypeColor 视觉一致）
function errorTypeToTone(type) {
  if (!type || type === '未标注') return 'default'
  if (/计算|运算/.test(type)) return 'danger'
  if (/审题/.test(type)) return 'warning'
  if (/公式|概念/.test(type)) return 'primary'
  if (/步骤|单位/.test(type)) return 'info'
  if (/方法|分析/.test(type)) return 'success'
  if (/抄写|粗心/.test(type)) return 'default'
  return 'default'
}

// ── Watch period changes to refresh data ──

watch([periodMode, periodOffset], () => {
  loadSummary()
  if (viewMode.value === 'grade' && selectedGrade.value) {
    loadGradeSuggestions()
    loadWrongPaper()
  }
  if (selectedStudentId.value) handleStudentChange(selectedStudentId.value)
})

watch(viewMode, (val) => {
  if (val === 'grade' && selectedGrade.value) {
    loadGradeSuggestions()
    loadWrongPaper()
  }
  if (val === 'single' && selectedStudentId.value) loadStudentSuggestions()
})

watch(selectedGrade, () => {
  if (viewMode.value === 'grade' && selectedGrade.value) {
    loadGradeSuggestions()
    loadWrongPaper()
  }
})

watch(selectedStudentId, (id) => {
  if (viewMode.value === 'single' && id) loadStudentSuggestions()
})

// ── Lifecycle ──
onMounted(async () => {
  await loadStudents()
  await loadGrades()
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

async function loadGrades() {
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const resp = await fetch(`${API_BASE}/teaching/grades`)
    const data = await resp.json()
    if (data.success && Array.isArray(data.grades)) {
      grades.value = data.grades
      // 默认选中第一个年级
      if (!selectedGrade.value && data.grades.length > 0) {
        selectedGrade.value = data.grades[0]
      }
    }
  } catch (e) {
    console.warn('加载年级列表失败:', e)
  }
}

async function loadGradeSuggestions() {
  if (!selectedGrade.value) return
  loadingGradeSuggestions.value = true
  gradeSuggestionsError.value = ''
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const url = new URL(`${API_BASE}/teaching/grade-suggestions`, window.location.origin)
    url.searchParams.set('grade', selectedGrade.value)
    url.searchParams.set('mode', periodMode.value)
    url.searchParams.set('offset', String(periodOffset.value))
    url.searchParams.set('subject', diagSubject.value || '数学')
    const resp = await fetch(url.toString().replace(window.location.origin, ''))
    const data = await resp.json()
    if (data.success) {
      gradeSuggestions.value = data.suggestions || []
      gradeSuggestionsMeta.value = data
    } else {
      gradeSuggestionsError.value = data.error || '获取年级备课建议失败'
    }
  } catch (e) {
    gradeSuggestionsError.value = e.message || '获取年级备课建议失败'
    console.error('loadGradeSuggestions 异常:', e)
  } finally {
    loadingGradeSuggestions.value = false
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
    console.warn('加载单生备课建议失败:', e)
  } finally {
    loadingStudentSuggestions.value = false
  }
}

async function retryGradeSuggestions() {
  await loadGradeSuggestions()
}

// ── 错题卷（年级视图） ──
async function loadWrongPaper() {
  if (!selectedGrade.value) return
  loadingWrongPaper.value = true
  wrongPaperError.value = ''
  try {
    const data = await getTeachingWrongPaper({
      grade: selectedGrade.value,
      mode: periodMode.value,
      offset: periodOffset.value,
      subject: diagSubject.value || undefined,
    })
    if (data.success) {
      wrongPaperItems.value = data.items || []
      wrongPaperMeta.value = data
    } else {
      wrongPaperError.value = data.error || '获取错题卷失败'
      wrongPaperItems.value = []
      wrongPaperMeta.value = null
    }
  } catch (e) {
    wrongPaperError.value = e.message || '获取错题卷失败'
    console.error('loadWrongPaper 异常:', e)
  } finally {
    loadingWrongPaper.value = false
  }
}

function toggleWrongRow(key) {
  const set = expandedWrongRows.value
  if (set.has(key)) set.delete(key)
  else set.add(key)
}

function isWrongRowExpanded(key) {
  return expandedWrongRows.value.has(key)
}

function wrongPaperRowKey(row) {
  return row.identityKey || row.questionId || row.content
}

async function handleExportWrongPaperAll() {
  if (!selectedGrade.value || wrongPaperItems.value.length === 0) return
  exportingWrongPaper.value = true
  try {
    const blob = await exportWrongPaper({
      grade: selectedGrade.value,
      mode: 'all',
      subject: diagSubject.value || '数学',
      periodMode: periodMode.value,
      periodOffset: periodOffset.value,
    })
    const ymd = dayjs().format('YYYYMMDD')
    const safeGrade = String(selectedGrade.value).replace(/[\\/:*?"<>|\s]/g, '_')
    saveAs(blob, `${ymd}_${safeGrade}_全班错题卷.docx`)
    ElMessage.success('全班错题卷已生成')
  } catch (e) {
    ElMessage.error('导出失败：' + (e.message || '未知错误'))
  } finally {
    exportingWrongPaper.value = false
  }
}

async function handleExportWrongPaperStudent(row) {
  if (!selectedGrade.value || !row?.involvedStudents?.length) return
  exportingWrongPaper.value = true
  try {
    // 选第一个学生作为默认导出对象（个人卷：每次只生成一个学生的卷）
    // 真实场景中老师通常会逐个学生点导出，所以这里一次只导一个
    const stu = row.involvedStudents[0]
    const blob = await exportWrongPaper({
      grade: selectedGrade.value,
      mode: 'student',
      studentId: stu.id,
      studentName: stu.name,
      subject: diagSubject.value || '数学',
      periodMode: periodMode.value,
      periodOffset: periodOffset.value,
    })
    const ymd = dayjs().format('YYYYMMDD')
    const safeName = String(stu.name || '学生').replace(/[\\/:*?"<>|\s]/g, '_')
    saveAs(blob, `${ymd}_${safeName}_错题卷.docx`)
    ElMessage.success(`${stu.name}的错题卷已生成`)
  } catch (e) {
    ElMessage.error('导出失败：' + (e.message || '未知错误'))
  } finally {
    exportingWrongPaper.value = false
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
  if (classDiagnosis.value.length === 0 && !currentStudentDetail.value?.knowledgeDiagnosis?.length) return
  // 重构：跳转到 HandoutPreview 备课工作台（不再直接下载 docx）。
  // 老师可以在工作台切换模板、查看错题、编辑笔记、导 docx。
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
  // 重构：底部输出条"生成再测卷"按钮直接调用此函数展示两条发卷路径，
  // 教师确认后关闭对话框（不再就地触发批量生成，进度改由 toast 反馈）。
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
        confirmButtonText: '知道了',
        cancelButtonText: '关闭',
        type: 'info',
        dangerouslyUseHTMLString: true
      }
    )
  } catch (e) {
    ElMessage.warning('发卷入口已取消')
  }
}

function generatePeriodReport(mode) {
  if (!selectedStudentId.value) return ElMessage.info('请先选择学生')
  periodMode.value = mode
  periodOffset.value = 0
  nextTick(() => handleGenerateCurrent())
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
function knowledgeLevel(row) {
  if (row.accuracy < 60 || row.wrongCount >= 3) return { key: 'critical', label: '较弱' }
  if (row.accuracy < 80 || row.wrongCount >= 2) return { key: 'attention', label: '待巩固' }
  return { key: 'normal', label: '稳定' }
}
</script>

<style scoped>
.diagnosis-page{color:var(--wb-text)}.diagnosis-filter{margin-bottom:16px}.student-select{width:220px}.offset-select,.subject-select{width:120px}.student-option{display:flex;align-items:center;gap:8px}.student-option small{margin-left:auto;color:var(--wb-text-tertiary)}.filter-note{color:var(--wb-text-tertiary);font-size:11px;white-space:nowrap}.diagnosis-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(320px,.75fr);align-items:start;gap:16px;margin-bottom:16px}.loading-stack{display:grid;gap:18px;padding:20px}.student-diagnosis-list{min-height:360px}.student-diagnosis-row{display:flex;align-items:center;gap:12px;min-height:82px;padding:12px 16px;box-sizing:border-box;border-bottom:1px solid var(--wb-border-light);cursor:pointer}.student-diagnosis-row:last-child{border-bottom:0}.student-diagnosis-row:hover{background:var(--wb-bg-elevated)}.student-identity{display:flex;width:110px;min-width:0;flex-direction:column;gap:3px}.student-identity strong{font-size:13px}.student-identity small{color:var(--wb-text-tertiary);font-size:10px}.student-metrics{display:grid;grid-template-columns:repeat(3,72px);gap:6px}.student-metrics span{display:flex;color:var(--wb-text-tertiary);font-size:9px;flex-direction:column;gap:3px}.student-metrics b{color:var(--wb-text);font-size:12px}.student-next{display:flex;min-width:170px;flex:1;flex-direction:column;gap:4px}.student-next span{color:var(--wb-text-tertiary);font-size:9px}.student-next strong{font-size:11px;font-weight:550}.row-arrow{color:var(--wb-text-tertiary)}.student-detail-layout{grid-template-columns:minmax(0,1.35fr) minmax(330px,.65fr)}.teaching-judgement{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--wb-border-light);border-radius:8px}.teaching-judgement>div{min-height:88px;padding:14px;border-right:1px solid var(--wb-border-light)}.teaching-judgement>div:last-child{border-right:0}.teaching-judgement .focus{background:#fffaf2}.teaching-judgement span{display:block;margin-bottom:7px;color:var(--wb-text-tertiary);font-size:10px}.teaching-judgement strong{font-size:11px;line-height:1.65}.trend-panel{margin-top:16px;padding-top:16px;border-top:1px solid var(--wb-border-light)}.trend-heading{display:flex;align-items:center;justify-content:space-between}.trend-heading>div{display:flex;flex-direction:column;gap:4px}.trend-heading strong{font-size:12px}.trend-heading span{color:var(--wb-text-tertiary);font-size:10px}.trend-result{font-size:11px;font-weight:600}.trend-result.success{color:var(--wb-success)}.trend-result.danger{color:var(--wb-danger)}.trend-result.primary{color:var(--wb-primary)}.trend-bars{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;height:120px;margin-top:14px}.trend-day{display:flex;align-items:center;min-width:0;flex-direction:column;gap:4px}.trend-track{display:flex;width:100%;height:72px;align-items:flex-end;justify-content:center;background:var(--wb-bg-elevated);border-radius:5px;overflow:hidden}.trend-track span{display:block;width:100%;background:var(--wb-primary-soft);border-top:2px solid var(--wb-primary)}.trend-day b{font-size:9px}.trend-day small{color:var(--wb-text-tertiary);font-size:8px}.trend-empty{padding:30px;color:var(--wb-text-tertiary);font-size:11px;text-align:center}.knowledge-diagnosis,.class-diagnosis-section{margin-bottom:16px}.knowledge-name{display:flex;flex-direction:column;gap:3px}.knowledge-name strong{font-size:12px}.knowledge-name small,.table-sub{display:block;color:var(--wb-text-tertiary);font-size:9px}.danger-text{color:var(--wb-danger)}.no-comparison{font-size:11px;color:var(--wb-text-secondary)}.table-action{display:flex;align-items:center;justify-content:space-between;gap:10px}.drawer-header{display:flex;align-items:flex-start;justify-content:space-between}.drawer-title{font-size:16px;font-weight:650}.drawer-sub{margin-top:4px;color:var(--wb-text-tertiary);font-size:11px}.drawer-body{min-height:300px}.error-dist{display:grid;gap:12px}.error-item{display:flex;align-items:center}.error-type{width:90px;font-size:11px}.error-count{color:var(--wb-text-tertiary);font-size:10px}.sample-list{display:grid;gap:10px}.sample-item{padding:12px;background:var(--wb-bg-elevated);border-radius:8px}.sample-q{font-size:12px;line-height:1.6}.sample-meta,.sample-reason{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.sample-meta{color:var(--wb-text-secondary);font-size:10px}.blank-badge{color:var(--wb-danger);font-weight:600}.muted{color:var(--wb-text-tertiary)}.diagnosis-page :deep(.el-input__wrapper),.diagnosis-page :deep(.el-select__wrapper){min-height:34px;border-radius:8px;box-shadow:0 0 0 1px var(--wb-border) inset}.diagnosis-page :deep(.el-segmented){--el-segmented-item-selected-bg-color:#fff;--el-segmented-item-selected-color:var(--wb-primary)}.diagnosis-page :deep(.diag-row--blank td){background:#fffaf2!important}.diagnosis-page :deep(button:focus-visible){outline:2px solid var(--wb-primary);outline-offset:2px}.output-bar{display:flex;align-items:center;gap:var(--wb-space-3);margin-top:var(--wb-space-4);padding:var(--wb-space-3) var(--wb-space-4);border:1px solid var(--wb-border-light);border-radius:var(--wb-radius-md);background:var(--wb-bg-card)}.output-bar__label{color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-semibold)}@media(max-width:1180px){.diagnosis-layout,.student-detail-layout{grid-template-columns:1fr}.student-next{display:none}}@media(max-width:760px){.student-select,.offset-select{width:100%}.student-diagnosis-row{align-items:flex-start;flex-wrap:wrap}.student-metrics{width:100%;padding-left:58px}.teaching-judgement{grid-template-columns:1fr}.teaching-judgement>div{border-right:0;border-bottom:1px solid var(--wb-border-light)}.output-bar{flex-wrap:wrap}}

/* ── 周末讲题错题卷（grade view） ── */
.wrong-paper-section{margin-bottom:16px}
.wrong-paper-card :deep(.el-button.is-text){font-size:11px}
.wrong-paper-table{margin-top:8px}
.wrong-paper-table :deep(.cell){padding:8px 6px}
.wrong-q-cell{display:flex;flex-direction:column;gap:4px;min-width:0}
.wrong-q-content{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:1.5;word-break:break-word}
.wrong-q-tags{display:flex;flex-wrap:wrap;gap:4px}
.error-rate{display:flex;flex-direction:column;align-items:center;line-height:1.2}
.error-rate strong{font-size:14px;font-weight:700}
.error-rate small{font-size:9px;color:var(--wb-text-tertiary);margin-top:2px}
.error-rate.is-critical strong{color:var(--wb-danger)}
.error-rate.is-critical{background:#fef2f2;border-radius:6px;padding:4px 0}
.error-rate.is-warning strong{color:var(--wb-warning)}
.error-rate.is-info strong{color:var(--wb-primary)}
.error-rate.is-normal strong{color:var(--wb-text-secondary)}
.rank-num{display:inline-block;min-width:24px;padding:2px 8px;border-radius:10px;background:var(--wb-bg-elevated);color:var(--wb-text-secondary);font-size:11px;font-weight:600}
.rank-num.is-top{background:var(--wb-primary-soft);color:var(--wb-primary)}
.error-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.row-actions{display:flex;gap:4px;justify-content:center}
.muted{color:var(--wb-text-tertiary);font-size:11px}
.wrong-paper-expand{padding:8px 12px;background:var(--wb-bg-elevated);border-radius:8px;margin:4px 0}
.expand-row{display:flex;gap:12px;align-items:flex-start;padding:6px 0;font-size:12px;border-bottom:1px dashed var(--wb-border-light)}
.expand-row:last-child{border-bottom:0}
.expand-label{flex-shrink:0;width:96px;color:var(--wb-text-tertiary);font-size:11px}
.student-chips{display:flex;flex-wrap:wrap;gap:4px}
.error-mini{display:flex;flex-wrap:wrap;gap:8px;font-size:11px}

/* ── 年级备课建议（grade view） ── */
.grade-suggestions-section{margin-bottom:16px}
.grade-suggestion-list{display:grid;gap:14px}
.grade-suggestion-card{padding:18px 20px;border:1px solid var(--wb-border-light);border-radius:var(--wb-radius-md);background:var(--wb-bg-card)}
.card-header{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}
.rank-pill{display:grid;flex-shrink:0;width:30px;height:30px;place-items:center;color:#fff;background:var(--wb-primary);border-radius:50%;font-size:13px;font-weight:650}
.rank-pill.small{width:22px;height:22px;font-size:11px}
.kp-name-block{flex:1;min-width:0}
.kp-name-block h3{margin:0 0 6px;font-size:14px;font-weight:650}
.kp-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--wb-text-secondary);font-size:10px}
.kp-meta .meta-item b{color:var(--wb-text);font-weight:600;font-size:11px}
.card-section{padding:12px 0;border-top:1px solid var(--wb-border-light)}
.card-section:first-of-type{border-top:0;padding-top:0}
.card-section label{display:block;margin-bottom:8px;color:var(--wb-text-tertiary);font-size:10px;font-weight:600}
.error-bars{display:grid;gap:10px}
.error-bar-row{display:flex;align-items:center}
.error-bar-row .error-type{width:90px;font-size:11px}
.error-bar-row .error-count{color:var(--wb-text-tertiary);font-size:10px;min-width:74px;text-align:right}
.sample-item{padding:10px 12px;background:var(--wb-bg-elevated);border-radius:6px;margin-bottom:8px}
.sample-item:last-child{margin-bottom:0}
.sample-q{font-size:12px;line-height:1.6}
.sample-meta,.sample-reason{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;color:var(--wb-text-secondary);font-size:10px}
.card-footer{display:flex;align-items:center;gap:8px;margin-top:14px;padding:10px 14px;background:var(--wb-primary-soft);border-radius:6px;color:var(--wb-text);font-size:11px}
.card-footer strong{color:var(--wb-primary);font-weight:600}

/* ── 单生备课建议（single view 内的紧凑卡片） ── */
.student-suggestions{margin-bottom:16px}
.student-suggestion-list{display:grid;gap:12px}
.student-suggestion-card{padding:14px 16px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-card)}
.student-suggestion-card header{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.student-suggestion-card header strong{font-size:13px}
.meta-inline{color:var(--wb-text-tertiary);font-size:10px;margin-left:auto}
.mini-error-dist{display:grid;gap:4px;margin:8px 0}
.mini-error-row{display:flex;align-items:center;justify-content:space-between;font-size:11px}
.mini-error-count{color:var(--wb-text-tertiary);font-size:10px}
.student-suggestion-card footer{margin-top:10px;padding-top:10px;border-top:1px dashed var(--wb-border-light);font-size:11px;color:var(--wb-text-secondary)}
.advice-label{color:var(--wb-text-tertiary);margin-right:4px}
.student-suggestion-card footer strong{color:var(--wb-primary);font-weight:600}
</style>
