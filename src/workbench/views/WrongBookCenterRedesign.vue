<template>
  <div class="wrong-center wb-page">
    <div class="wb-page__inner">
      <template v-if="noStudentContext">
        <PageHeader eyebrow="学生学习 / 长期学习数据" title="错题中心" description="先选择学生，再进入错题清单、状态统计与重练任务。" />
        <KpiStrip :items="overviewKpis" :clickable="false" aria-label="错题中心总览" />

        <ContentCard v-if="recentStudentsObjects.length" title="最近访问" description="继续之前的工作" flush class="wb-empty__recent">
          <div class="recent-list">
            <button
              v-for="student in recentStudentsObjects"
              :key="student.id"
              type="button"
              class="recent-row"
              :aria-label="`进入${student.name}的错题中心${student.total_error_count ? '，累计错题 ' + student.total_error_count + ' 道' : ''}`"
              @click="selectStudentById(student.id)"
            >
              <el-avatar :size="36" :src="student.avatar">{{ student.name?.slice(0, 1) }}</el-avatar>
              <div class="recent-meta">
                <strong>{{ student.name }}</strong>
                <small>{{ student.grade || student.class || '暂无班级信息' }}</small>
              </div>
              <span v-if="student.total_error_count" class="error-pill is-warning">累计 {{ student.total_error_count }} 道</span>
              <span v-else class="error-pill is-muted">暂无错题</span>
              <el-icon class="row-arrow"><ArrowRight /></el-icon>
            </button>
          </div>
        </ContentCard>

        <ContentCard :title="`所有学生 · ${students.length} 人`" description="按建档时间倒序，点击任一行进入错题中心" flush class="wb-empty__all">
          <div v-if="students.length" class="student-list" role="table" aria-label="所有学生">
            <div class="list-head" role="rowgroup">
              <div role="row" class="list-head__row" aria-hidden="true">
                <div role="columnheader">学生</div>
                <div role="columnheader">累计错题</div>
                <div role="columnheader">重练数</div>
                <div role="columnheader">已掌握</div>
                <div role="columnheader">最近错题</div>
                <div role="columnheader" class="op-col"><span class="sr-only">操作</span></div>
              </div>
            </div>
            <div role="rowgroup" class="list-body">
              <button
                v-for="student in students"
                :key="student.id"
                type="button"
                role="row"
                class="student-row"
                :aria-label="`进入${student.name}的错题中心${student.total_error_count ? '，累计错题 ' + student.total_error_count + ' 道' : ''}`"
                @click="selectStudentById(student.id)"
              >
                <div role="cell" class="student-cell">
                  <el-avatar :size="38" :src="student.avatar">{{ student.name?.slice(0, 1) }}</el-avatar>
                  <span class="student-identity"><strong>{{ student.name }}</strong><small>{{ student.grade || student.class || '暂无班级信息' }}</small></span>
                </div>
                <div role="cell" :class="['metric-cell', { 'is-danger': (student.total_error_count || 0) > 0 }]">
                  <strong>{{ student.total_error_count || 0 }}</strong><em>道</em>
                </div>
                <div role="cell" class="metric-cell">
                  <strong>{{ student.practice_count || 0 }}</strong><em>次</em>
                </div>
                <div role="cell" :class="['metric-cell', { 'is-success': (student.mastered_count || 0) > 0 }]">
                  <strong>{{ student.mastered_count || 0 }}</strong><em>道</em>
                </div>
                <div role="cell" class="metric-cell">
                  <span v-if="student.last_wrong_at" class="last-wrong">{{ formatRelative(student.last_wrong_at) }}</span>
                  <span v-else class="muted">暂无</span>
                </div>
                <div role="cell" class="row-action"><el-icon><ArrowRight /></el-icon></div>
              </button>
            </div>
          </div>
          <EmptyState v-else title="还没有学生" description="添加学生后，错题中心才能为他/她服务。" />
        </ContentCard>
      </template>

      <template v-else>
      <PageHeader v-if="!embedded" eyebrow="学生学习 / 长期学习数据" title="错题中心" description="从学生维度管理错题状态，优先安排重复出错与尚未重练的题目。">
        <template #badge><span class="scope-chip">{{ currentStudent?.name || '未选择学生' }}</span></template>
        <template #actions>
          <ActionButton @click="wrongBookStore.refreshData">刷新</ActionButton>
        </template>
      </PageHeader>

      <ContentCard v-if="!embedded" class="student-overview" flush>
        <div class="student-profile">
          <button class="student-switcher" type="button" @click="showStudentDialog = true">
            <el-avatar :size="42" :src="currentStudent?.avatar">{{ currentStudent?.name?.slice(0, 1) || '?' }}</el-avatar>
            <span class="student-copy"><strong>{{ currentStudent?.name || '选择学生' }}</strong><small>{{ currentStudent?.class || '暂无班级信息' }}</small></span>
            <span class="switch-label">切换学生 <el-icon><ArrowDown /></el-icon></span>
          </button>
          <div class="mastery-overview">
            <div class="mastery-heading"><span>当前错题掌握度</span><strong>{{ stats.masteryRate }}%</strong></div>
            <div class="mastery-track"><span :style="{ width: `${Math.min(100, Math.max(0, stats.masteryRate || 0))}%` }" /></div>
            <div class="mastery-meta"><span>共 {{ stats.total }} 道错题</span><span>{{ stats.mastered }} 道已掌握</span></div>
          </div>
          <div class="priority-summary"><span>建议优先处理</span><strong>{{ summaryItems.find(item => item.key === 'repeat')?.value || 0 }} 道重复错题</strong><small>通过重练验证后再标记掌握</small></div>
        </div>
      </ContentCard>

      <section class="wb-stats-grid status-grid" aria-label="错题状态统计">
        <button v-for="item in summaryItems" :key="item.key" type="button" :class="['status-filter', { active: activeSummary === item.key }]" @click="setSummary(item.key)">
          <StatsCard :label="item.label" :value="item.value" :description="item.note" :tone="item.tone" />
        </button>
      </section>

      <FilterBar class="wrong-filter-bar">
        <template #leading><div class="result-context"><strong>{{ activeSummaryLabel }}</strong><span>{{ filteredQuestions.length }} 道题</span></div></template>
        <WorkbenchInput v-model="searchInput" clearable placeholder="搜索题目或知识点" width="260px" aria-label="搜索题目或知识点" @input="updateSearch">
          <template #prefix><el-icon><Search /></el-icon></template>
        </WorkbenchInput>
        <WorkbenchSelect v-model="subjectFilter" :options="subjectOptions" placeholder="全部学科" width="128px" aria-label="按学科筛选" @change="applySubject" />
        <WorkbenchSelect v-model="timeFilter" :options="timeOptions" placeholder="全部时间" width="128px" aria-label="按时间筛选" @change="applyTime" />
        <ActionButton @click="showAdvanced = !showAdvanced">更多筛选</ActionButton>
        <template #actions><el-dropdown trigger="click" @command="handleSort"><el-button text>{{ sortLabel }} <el-icon><ArrowDown /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="priority">优先处理</el-dropdown-item><el-dropdown-item command="time_desc">最近新增</el-dropdown-item><el-dropdown-item command="error_desc">错误次数最多</el-dropdown-item></el-dropdown-menu></template></el-dropdown></template>
      </FilterBar>

      <div v-if="showAdvanced" class="advanced-filters"><span>问题类型</span><button v-for="item in categoryOptions" :key="item.key" type="button" :class="{ active: categoryFilter === item.key }" @click="applyCategory(item.key)">{{ item.label }}</button><el-button text size="small" @click="resetFilters">重置筛选</el-button></div>

      <section class="management-workspace">
        <ContentCard class="question-manager" flush>
          <template #header><div class="section-heading"><h2>错题记录</h2><p>按错误频次、重练状态和新增时间管理</p></div></template>
          <template #actions><el-checkbox :model-value="paginatedQuestions.length > 0 && selectedQuestions.length === paginatedQuestions.length" @change="wrongBookStore.selectAll">全选本页</el-checkbox></template>
          <div v-if="wrongBookStore.loading" class="loading-list"><el-skeleton v-for="index in 5" :key="index" :rows="2" animated /></div>
          <EmptyState v-else-if="!paginatedQuestions.length" :icon="CircleCheck" title="当前筛选下没有错题" description="可以切换状态或重置筛选，继续查看该学生的其他错题记录。"><template #actions><ActionButton @click="resetFilters">重置筛选</ActionButton></template></EmptyState>
          <div v-else class="question-records">
            <article v-for="item in paginatedQuestions" :key="item.id" :class="['question-record', { current: selectedQuestion?.id === item.id }]" @click="selectedQuestion = item">
              <el-checkbox :model-value="isSelected(item)" :aria-label="`选择错题：${titleOf(item)}`" @click.stop @change="wrongBookStore.toggleSelection(item)" />
              <div class="record-main">
                <div class="record-topline">
                  <span class="subject-label">{{ subjectOf(item) }}</span>
                  <span :class="['status-label', toneOf(item)]">{{ labelOf(item) }}</span>
                  <span v-if="errorTypeOf(item)" :class="['error-type-pill', errorTypeToneOf(item)]" :title="errorReasonOf(item) || ''">{{ errorTypeOf(item) }}</span>
                  <span v-if="item.error_count >= 2" class="error-frequency">错误 {{ item.error_count }} 次</span>
                  <time :title="fullTime(item)">{{ formatTime(item) }}</time>
                </div>
                <h3>{{ titleOf(item) || '暂无题目内容' }}</h3>
                <div class="record-bottomline"><div class="knowledge-tags"><span v-for="tag in tagsOf(item).slice(0, 2)" :key="tag">{{ tag }}</span><span v-if="!tagsOf(item).length" class="muted-tag">未关联知识点</span></div><span class="practice-count">已重练 {{ item.practice_count || 0 }} 次</span></div>
              </div>
              <el-icon class="record-arrow"><ArrowRight /></el-icon>
            </article>
          </div>
          <template v-if="filteredQuestions.length > PAGE_SIZE" #footer><el-pagination v-model:current-page="currentPage" background layout="prev, pager, next" :page-size="PAGE_SIZE" :total="filteredQuestions.length" /></template>
        </ContentCard>

        <ContentCard v-if="selectedQuestion" class="learning-record" flush>
          <template #header><div class="section-heading"><span class="detail-eyebrow">学习记录</span><h2>{{ subjectOf(selectedQuestion) }}错题详情</h2></div></template>
          <template #actions><span :class="['status-label', toneOf(selectedQuestion)]">{{ labelOf(selectedQuestion) }}</span></template>
          <div class="detail-scroll">
            <section class="detail-section question-preview"><label>题目内容</label><p>{{ contentOf(selectedQuestion) || '暂无题目文字内容' }}</p><img v-if="imageOf(selectedQuestion)" :src="imageOf(selectedQuestion)" alt="错题原图" /></section>
            <section class="detail-section answer-comparison"><div><label>学生答案</label><p class="wrong-answer">{{ answerOf(selectedQuestion, 'student_answer') || '未记录' }}</p></div><div><label>正确答案</label><p>{{ answerOf(selectedQuestion, 'answer') || '未记录' }}</p></div></section>
            <section class="detail-section"><label>知识点</label><div class="detail-tags"><span v-for="tag in tagsOf(selectedQuestion)" :key="tag">{{ tag }}</span><span v-if="!tagsOf(selectedQuestion).length" class="muted-tag">未关联知识点</span></div></section>
            <section class="learning-status"><div><span>累计出错</span><strong>{{ selectedQuestion.error_count || 1 }} 次</strong></div><div><span>累计重练</span><strong>{{ selectedQuestion.practice_count || 0 }} 次</strong></div><div><span>收录时间</span><strong>{{ formatTime(selectedQuestion) }}</strong></div></section>
            <section v-if="errorTypeOf(selectedQuestion)" class="detail-section error-analysis-block">
              <label>错因分析</label>
              <div class="error-analysis-card">
                <div class="error-type-big" :class="errorTypeToneOf(selectedQuestion)">{{ errorTypeOf(selectedQuestion) }}</div>
                <div class="error-reason">{{ errorReasonOf(selectedQuestion) || '已自动判定，但暂无具体描述' }}</div>
                <div v-if="selectedQuestion.ai_confidence" class="error-confidence">AI 置信度 {{ Math.round(selectedQuestion.ai_confidence * 100) }}%</div>
              </div>
            </section>
            <section v-else-if="analysisOf(selectedQuestion)" class="detail-section"><label>解析</label><p class="analysis">{{ analysisOf(selectedQuestion) }}</p></section>
          </div>
          <template #footer><div class="detail-actions"><ActionButton :disabled="labelOf(selectedQuestion) === '已掌握'" @click="markMastered(selectedQuestion)">标记已掌握</ActionButton><el-button text type="danger" @click="removeQuestion(selectedQuestion)">移除</el-button></div></template>
        </ContentCard>
        <ContentCard v-else class="learning-record detail-empty" flush><EmptyState :icon="Reading" title="选择一道错题查看学习记录" description="这里会展示题目、答案、知识点、错误频次和重练状态，帮助判断下一步处理方式。" /></ContentCard>
      </section>
      </template>
    </div>

    <el-dialog v-model="showStudentDialog" title="切换学生" width="420px"><div class="student-picker"><button v-for="student in students" :key="student.id" type="button" :class="['student-option', { active: currentStudent?.id === student.id }]" @click="switchStudent(student)"><el-avatar :size="36" :src="student.avatar">{{ student.name?.slice(0, 1) }}</el-avatar><span><strong>{{ student.name }}</strong><small>{{ student.class || '暂无班级信息' }}</small></span><el-icon v-if="currentStudent?.id === student.id"><CircleCheck /></el-icon></button></div></el-dialog>
  </div>
</template>
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowRight, CircleCheck, Reading, Search } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import KpiStrip from '../components/ui/KpiStrip.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatsCard from '../components/ui/StatsCard.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import { getStudents, createGeneratedExam, getGeneratedExamsByStudent } from '../../services/apiService'
import { buildExamBaseName, buildExamNameWithSeq } from '../../domain/examNaming'
import { useWrongBookStore } from '../stores/wrongBookStore'
import dayjs from 'dayjs'

// embedded：嵌在学生档案页的「错题」tab 里，学生上下文由父页给定，
// 因此隐藏自己的页头与学生切换器，创卷后由父页负责切到「重练」tab。
const props = defineProps({
  embedded: { type: Boolean, default: false },
  studentId: { type: String, default: '' }
})
const emit = defineEmits(['exam-created'])

const wrongBookStore = useWrongBookStore(); const router = useRouter(); const route = useRoute(); const PAGE_SIZE = 17
const embedded = computed(() => props.embedded)
const creatingExam = ref(false)
const currentPage = computed({ get: () => wrongBookStore.currentPage, set: value => { wrongBookStore.currentPage = value } }); const currentStudent = computed(() => wrongBookStore.currentStudent); const selectedQuestions = computed(() => wrongBookStore.selectedQuestions); const filteredQuestions = computed(() => wrongBookStore.filteredQuestions); const paginatedQuestions = computed(() => wrongBookStore.paginatedQuestions); const stats = computed(() => wrongBookStore.stats); const subjects = computed(() => [...new Set(wrongBookStore.wrongQuestions.map(item => item.subject || item.question?.subject).filter(Boolean))])
const subjectOptions = computed(() => subjects.value.map(s => ({ label: s, value: s })))
const timeOptions = [
  { label: '全部时间', value: 'all' },
  { label: '最近 7 天', value: 'week' },
  { label: '最近 30 天', value: 'month' }
]; const selectedQuestion = ref(null); const students = ref([]); const showStudentDialog = ref(false); const showAdvanced = ref(false); const activeSummary = ref('pending'); const searchInput = ref(wrongBookStore.searchQuery); const subjectFilter = ref(wrongBookStore.filters.subject || 'all'); const timeFilter = ref(wrongBookStore.filters.time || 'all'); const categoryFilter = ref(wrongBookStore.filters.category || 'all'); const sortLabel = ref('优先处理')

// 无学生上下文空状态：localStorage 记录最近访问 3 人
const RECENT_KEY = 'wrongbook.recentStudents'; const MAX_RECENT = 3
const loadRecentStudents = () => { try { const raw = localStorage.getItem(RECENT_KEY); if (!raw) return []; const list = JSON.parse(raw); return Array.isArray(list) ? list.slice(0, MAX_RECENT).map(String) : [] } catch { return [] } }
const pushRecentStudent = id => { try { const sid = String(id); const list = loadRecentStudents().filter(item => item !== sid); list.unshift(sid); localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))) } catch {} }
const recentStudents = ref(loadRecentStudents())
const noStudentContext = computed(() => !embedded.value && !currentStudent.value)
const recentStudentsObjects = computed(() => recentStudents.value.map(id => students.value.find(s => String(s.id) === id)).filter(Boolean))
const selectStudentById = id => { const student = students.value.find(s => String(s.id) === String(id)); if (student) switchStudent(student) }
const formatRelative = time => { const v = dayjs(time); if (!v.isValid()) return ''; const d = dayjs().diff(v, 'day'); if (d === 0) return '今天'; if (d === 1) return '昨天'; if (d < 7) return `${d} 天前`; if (d < 30) return `${Math.floor(d / 7)} 周前`; return v.format('MM-DD') }

// 空状态总览 KPI：从 /api/students 返回字段聚合
const overviewKpis = computed(() => {
  const total = students.value.length
  const withWrong = students.value.filter(s => (s.total_error_count || 0) > 0).length
  const recentNew = students.value.reduce((sum, s) => sum + (s.recent_wrong_count || 0), 0)
  const totalError = students.value.reduce((sum, s) => sum + (s.total_error_count || 0), 0)
  return [
    { key: 'total', value: total, unit: '人', label: '学生总数', tone: 'default' },
    { key: 'withWrong', value: withWrong, unit: '人', label: '有错题的学生', tone: withWrong > 0 ? 'warning' : 'default' },
    { key: 'recentNew', value: recentNew, unit: '道', label: '近 7 天新增错题', tone: 'info' },
    { key: 'totalError', value: totalError, unit: '道', label: '累计错题数', tone: 'danger' }
  ]
})

const categoryOptions = [{ key: 'all', label: '全部问题' }, { key: 'wrong', label: '答错' }, { key: 'unanswered', label: '未作答' }]; const summaryItems = computed(() => [{ key: 'pending', label: '待处理', value: stats.value.pendingMaster, note: '需要教师安排下一步', tone: 'danger' }, { key: 'repeat', label: '重复出错', value: wrongBookStore.wrongQuestions.filter(item => (item.error_count || 1) >= 2).length, note: '优先关注', tone: 'warning' }, { key: 'unpracticed', label: '尚未重练', value: wrongBookStore.wrongQuestions.filter(item => !(item.practice_count > 0)).length, note: '还没有后续练习', tone: 'primary' }, { key: 'mastered', label: '已掌握', value: stats.value.mastered, note: '通过重练验证', tone: 'success' }]); const activeSummaryLabel = computed(() => summaryItems.value.find(item => item.key === activeSummary.value)?.label || '待处理')
const getQuestion = item => item?.question || item || {}; const titleOf = item => { const text = contentOf(item); return text.length > 72 ? `${text.slice(0, 72)}…` : text }; const contentOf = item => getQuestion(item).content || item?.content || ''; const subjectOf = item => item?.subject || getQuestion(item).subject || '未分类'; const tagsOf = item => { const q = getQuestion(item); return (q.tags_source === 'manual' ? q.manual_tags : (q.ai_tags || q.tags)) || [] }; const answerOf = (item, key) => getQuestion(item)[key] || item?.[key] || ''; const analysisOf = item => getQuestion(item).analysis || item?.analysis || ''; const imageOf = item => getQuestion(item).image_url || item?.question_image_url || ''; const errorTypeOf = item => (item?.error_type || getQuestion(item).error_type || '').trim(); const errorReasonOf = item => (item?.error_reason || getQuestion(item).error_reason || '').trim(); const errorTypeToneOf = item => { const t = errorTypeOf(item); if (!t) return 'muted'; if (/计算|运算/.test(t)) return 'danger'; if (/审题|单位/.test(t)) return 'warning'; if (/公式|概念|步骤/.test(t)) return 'primary'; if (/方法|分析/.test(t)) return 'success'; return 'info' }; const formatTime = item => { const value = item?.added_at || item?.created_at; if (!value) return '-'; const date = dayjs(value); if (date.isSame(dayjs(), 'day')) return `今天 ${date.format('HH:mm')}`; if (date.isSame(dayjs().subtract(1, 'day'), 'day')) return `昨天 ${date.format('HH:mm')}`; return date.format('MM-DD HH:mm') }; const fullTime = item => item?.added_at ? dayjs(item.added_at).format('YYYY-MM-DD HH:mm') : '-'; const isSelected = item => selectedQuestions.value.some(selected => selected.id === item.id); const toneOf = item => item.lifecycle_status === 'mastered' || item.status === 'mastered' ? 'success' : (item.error_count >= 2 ? 'warning' : 'danger'); const labelOf = item => item.lifecycle_status === 'mastered' || item.status === 'mastered' ? '已掌握' : (item.error_count >= 2 ? '重复出错' : (item.practice_count > 0 ? '待重练' : '新错题'))
function updateSearch() { wrongBookStore.setSearchQuery(searchInput.value) }; function setSummary(key) { activeSummary.value = key; wrongBookStore.setFilter('status', key === 'mastered' ? 'mastered' : key === 'pending' ? 'pending' : 'all'); if (key === 'repeat') wrongBookStore.setFilter('errorCount', '2-3') }; function applySubject(value) { wrongBookStore.setFilter('subject', value || 'all') }; function applyTime(value) { wrongBookStore.setFilter('time', value || 'all') }; function applyCategory(value) { categoryFilter.value = value; wrongBookStore.setFilter('category', value) }; function resetFilters() { wrongBookStore.resetFilters(); activeSummary.value = 'pending'; subjectFilter.value = 'all'; timeFilter.value = 'all'; categoryFilter.value = 'all'; searchInput.value = ''; sortLabel.value = '优先处理' }; function handleSort(command) { sortLabel.value = command === 'time_desc' ? '最近新增' : command === 'error_desc' ? '错误次数最多' : '优先处理'; wrongBookStore.sortBy = command === 'priority' ? 'error_desc' : command }; function switchStudent(student) { wrongBookStore.setCurrentStudent(student); wrongBookStore.loadWrongQuestions(student.id); selectedQuestion.value = null; showStudentDialog.value = false; pushRecentStudent(student.id); if (!embedded.value) router.replace({ path: '/wrongbook', query: { studentId: student.id } }) }; async function createRetry() {
  const student = currentStudent.value
  if (!student) { ElMessage.warning('请先选择学生'); return }
  if (!selectedQuestions.value.length) { ElMessage.info('请先选择需要重练的题目'); return }
  // 重练卷 question_ids 必须是题库题目 ID（wrong_questions.question_id）；
  // 练习册自包含错题若未关联到题库题目（question_id 为空），其 ID 无法进入重练批改链路，需剔除并提示。
  const validItems = selectedQuestions.value.filter(item => item.question_id)
  const droppedCount = selectedQuestions.value.length - validItems.length
  if (!validItems.length) {
    ElMessage.warning('所选错题暂无可组卷的题目（部分练习册自包含错题尚未关联到题库题目）')
    return
  }
  const questionIds = validItems.map(item => item.question_id)
  creatingExam.value = true
  try {
    const existing = await getGeneratedExamsByStudent(student.id, false).catch(() => [])
    const baseName = buildExamBaseName(validItems)
    const examName = buildExamNameWithSeq(baseName, existing, student.id)
    const exam = await createGeneratedExam({ student_id: student.id, name: examName, question_ids: questionIds })
    if (!exam?.id) throw new Error('创建重练卷失败')
    const suffix = droppedCount ? `（${droppedCount} 道练习册自包含错题未纳入重练）` : ''
    ElMessage.success(`已生成重练卷「${exam.name}」，共 ${questionIds.length} 题${suffix}`)
    wrongBookStore.clearSelection()
    emit('exam-created', exam)
    if (!embedded.value) router.push({ path: '/students/' + student.id, query: { tab: 'retry' } })
  } catch (error) {
    ElMessage.error(error.message || '创建重练卷失败，请稍后重试')
  } finally {
    creatingExam.value = false
  }
}
function createRetryFor(item) { wrongBookStore.clearSelection(); wrongBookStore.toggleSelection(item); createRetry() }; async function markMastered(item) { await wrongBookStore.updateLifecycleStatus(item.id, 'mastered'); ElMessage.success('已标记为已掌握') }; async function removeQuestion(item) { try { await ElMessageBox.confirm('移除后，这道题将不再出现在当前学生的错题列表中。', '移除错题', { confirmButtonText: '确认移除', cancelButtonText: '取消', type: 'warning' }); if (await wrongBookStore.deleteQuestion(item.id)) { selectedQuestion.value = null; ElMessage.success('错题已移除') } } catch {} }
onMounted(async () => {
  try {
    if (embedded.value && props.studentId) {
      const result = await getStudents(false)
      students.value = result.data || result || []
      const target = students.value.find(s => String(s.id) === String(props.studentId))
      if (target) switchStudent(target)
      else ElMessage.error('未找到指定学生')
      return
    }
    const result = await getStudents(false)
    students.value = result.data || result || []
    const requestedStudentId = route.query.studentId
    const requestedStudent = students.value.find(student => String(student.id) === String(requestedStudentId))
    if (requestedStudent) switchStudent(requestedStudent)
    else if (currentStudent.value) await wrongBookStore.loadWrongQuestions(currentStudent.value.id)
    // 未指定学生时不再 fallback 到列表首位；noStudentContext 计算属性驱动空状态选择器
  } catch { ElMessage.error('学生列表加载失败，请刷新重试') }
})
watch(() => props.studentId, async (id) => {
  if (!embedded.value || !id) return
  if (currentStudent.value && String(currentStudent.value.id) === String(id)) return
  if (!students.value.length) {
    try { const r = await getStudents(false); students.value = r.data || r || [] } catch {}
  }
  const target = students.value.find(s => String(s.id) === String(id))
  if (target) switchStudent(target)
})
</script>

<style scoped>
.wrong-center{min-height:100%;color:var(--wb-text)}.scope-chip{display:inline-flex;align-items:center;height:24px;padding:0 9px;color:var(--wb-primary);font-size:11px;font-weight:600;background:var(--wb-primary-soft);border-radius:999px}.student-overview{margin-bottom:16px}.student-profile{display:grid;grid-template-columns:minmax(260px,1.1fr) minmax(260px,1fr) minmax(220px,.8fr);align-items:center;min-height:108px}.student-switcher{display:flex;align-items:center;gap:12px;align-self:stretch;padding:20px;border:0;border-right:1px solid var(--wb-border-light);background:transparent;text-align:left;cursor:pointer}.student-switcher:hover{background:var(--wb-bg-subtle)}.student-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:4px}.student-copy strong{font-size:16px}.student-copy small,.switch-label,.mastery-meta,.priority-summary small{color:var(--wb-text-tertiary);font-size:11px}.switch-label{display:flex;align-items:center;gap:4px;white-space:nowrap}.mastery-overview{padding:18px 24px}.mastery-heading,.mastery-meta{display:flex;align-items:center;justify-content:space-between}.mastery-heading span{color:var(--wb-text-secondary);font-size:12px}.mastery-heading strong{font-size:20px}.mastery-track{height:6px;margin:12px 0 9px;overflow:hidden;background:var(--wb-border-light);border-radius:999px}.mastery-track span{display:block;height:100%;background:var(--wb-success);border-radius:inherit}.priority-summary{display:flex;align-self:stretch;justify-content:center;padding:18px 24px;flex-direction:column;border-left:1px solid var(--wb-border-light)}.priority-summary>span{color:var(--wb-text-tertiary);font-size:11px}.priority-summary strong{margin:6px 0;color:var(--wb-warning);font-size:15px}.status-grid{margin-bottom:16px}.status-filter{display:block;min-width:0;padding:0;border:0;border-radius:var(--wb-radius-panel);background:transparent;text-align:left;cursor:pointer}.status-filter :deep(.ds-stats-card){height:100%;box-sizing:border-box;transition:.18s}.status-filter:hover :deep(.ds-stats-card){border-color:#c9cbd2}.status-filter.active :deep(.ds-stats-card){border-color:var(--wb-primary);box-shadow:0 0 0 2px var(--wb-primary-soft)}.wrong-filter-bar{margin-bottom:12px}.result-context{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.result-context strong{font-size:13px}.result-context span{color:var(--wb-text-tertiary);font-size:11px}.question-search{width:260px}.compact-select{width:128px}.advanced-filters{display:flex;align-items:center;gap:8px;margin:-2px 0 12px;padding:10px 14px;background:var(--wb-bg-card);border:1px solid var(--wb-border);border-radius:var(--wb-radius-panel)}.advanced-filters>span{margin-right:4px;color:var(--wb-text-tertiary);font-size:11px}.advanced-filters>button{padding:5px 9px;color:var(--wb-text-secondary);font-size:12px;border:0;border-radius:6px;background:transparent;cursor:pointer}.advanced-filters>button.active{color:var(--wb-primary);background:var(--wb-primary-soft)}.retry-basket{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:12px;padding:12px 14px;background:#f5f7ff;border:1px solid #dfe3ff;border-radius:var(--wb-radius-panel)}.basket-summary,.basket-actions{display:flex;align-items:center;gap:10px}.basket-summary>span:nth-child(2){display:flex;flex-direction:column;gap:3px}.basket-summary strong{font-size:13px}.basket-summary small{color:var(--wb-text-secondary);font-size:11px}.basket-icon{display:grid;width:32px;height:32px;place-items:center;color:var(--wb-primary);background:#fff;border:1px solid #dfe3ff;border-radius:8px}.management-workspace{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(340px,.85fr);align-items:start;gap:16px}.question-manager,.learning-record{min-height:560px}.section-heading h2{margin:0;font-size:15px}.section-heading p{margin:5px 0 0;color:var(--wb-text-secondary);font-size:11px}.detail-eyebrow{display:block;margin-bottom:5px;color:var(--wb-primary);font-size:10px;font-weight:650;letter-spacing:.05em}.loading-list{display:grid;gap:20px;padding:20px}.question-records{min-height:460px}.question-record{display:flex;align-items:center;gap:12px;min-height:88px;padding:13px 16px;box-sizing:border-box;border-bottom:1px solid var(--wb-border-light);cursor:pointer;transition:background .15s}.question-record:last-child{border-bottom:0}.question-record:hover{background:var(--wb-bg-subtle)}.question-record.current{background:#f7f8ff;box-shadow:inset 3px 0 var(--wb-primary)}.record-main{min-width:0;flex:1}.record-topline,.record-bottomline{display:flex;align-items:center;gap:7px}.record-topline time{margin-left:auto;color:var(--wb-text-tertiary);font-size:10px}.question-record h3{margin:7px 0;font-size:13px;font-weight:550;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.subject-label,.status-label,.error-frequency,.knowledge-tags span{display:inline-flex;align-items:center;height:21px;padding:0 7px;box-sizing:border-box;font-size:10px;border-radius:5px;white-space:nowrap}.subject-label{color:var(--wb-primary);background:var(--wb-primary-soft)}.status-label.danger{color:var(--wb-danger);background:#fff0ef}.status-label.warning{color:var(--wb-warning);background:#fff5df}.status-label.success{color:var(--wb-success);background:#edfaf1}.error-frequency{color:var(--wb-text-secondary);background:var(--wb-bg-subtle)}.error-type-pill{display:inline-flex;align-items:center;height:21px;padding:0 8px;box-sizing:border-box;color:#fff;font-size:10px;font-weight:600;border-radius:5px;white-space:nowrap}.error-type-pill.danger{background:var(--wb-danger)}.error-type-pill.warning{background:var(--wb-warning)}.error-type-pill.primary{background:var(--wb-primary)}.error-type-pill.success{background:var(--wb-success)}.error-type-pill.info{background:var(--wb-text-secondary)}.error-type-pill.muted{background:var(--wb-bg-subtle);color:var(--wb-text-tertiary)}.error-analysis-block{background:var(--wb-primary-soft)}.error-analysis-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid #dfe3ff;background:#fff;border-radius:8px}.error-type-big{font-size:14px;font-weight:650}.error-type-big.danger{color:var(--wb-danger)}.error-type-big.warning{color:var(--wb-warning)}.error-type-big.primary{color:var(--wb-primary)}.error-type-big.success{color:var(--wb-success)}.error-type-big.info{color:var(--wb-text-secondary)}.error-reason{color:var(--wb-text);font-size:12px;line-height:1.6}.error-confidence{color:var(--wb-text-tertiary);font-size:10px}.knowledge-tags{display:flex;min-width:0;gap:5px;overflow:hidden}.knowledge-tags span{max-width:150px;overflow:hidden;color:var(--wb-text-secondary);background:var(--wb-bg-subtle);text-overflow:ellipsis}.knowledge-tags .muted-tag,.detail-tags .muted-tag{color:var(--wb-text-tertiary)}.practice-count{margin-left:auto;color:var(--wb-text-tertiary);font-size:10px;white-space:nowrap}.record-arrow{color:#c4c7ce}.learning-record{position:sticky;top:68px}.detail-scroll{max-height:570px;overflow:auto}.detail-section{padding:17px 20px;border-bottom:1px solid var(--wb-border-light)}.detail-section label{display:block;margin-bottom:8px;color:var(--wb-text-tertiary);font-size:10px;font-weight:600}.detail-section p{margin:0;font-size:12px;line-height:1.7;white-space:pre-wrap}.question-preview img{display:block;max-width:100%;max-height:220px;margin-top:12px;object-fit:contain;border:1px solid var(--wb-border);border-radius:8px}.answer-comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px}.wrong-answer{color:var(--wb-danger)}.detail-tags{display:flex;gap:6px;flex-wrap:wrap}.detail-tags span{padding:5px 8px;color:var(--wb-primary);font-size:10px;background:var(--wb-primary-soft);border-radius:5px}.learning-status{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--wb-border-light)}.learning-status div{display:flex;padding:14px 10px;flex-direction:column;gap:5px;text-align:center;border-right:1px solid var(--wb-border-light)}.learning-status div:last-child{border-right:0}.learning-status span{color:var(--wb-text-tertiary);font-size:10px}.learning-status strong{font-size:12px;font-weight:600}.analysis{color:var(--wb-text-secondary)}.detail-actions{display:flex;align-items:center;gap:8px}.detail-actions .el-button:first-child{flex:1}.detail-empty{display:flex;align-items:center;justify-content:center}.detail-empty :deep(.body){width:100%}.student-picker{display:grid;gap:6px}.student-option{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:0;border-radius:8px;background:transparent;text-align:left;cursor:pointer}.student-option:hover,.student-option.active{background:var(--wb-primary-soft)}.student-option>span{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px}.student-option small{color:var(--wb-text-tertiary);font-size:11px}.student-option .el-icon{color:var(--wb-primary)}.wrong-center :deep(.el-input__wrapper),.wrong-center :deep(.el-select__wrapper){min-height:34px;border-radius:8px;box-shadow:0 0 0 1px var(--wb-border) inset}.wrong-center :deep(.el-pagination){justify-content:center}.wrong-center :deep(button:focus-visible),.student-switcher:focus-visible,.student-option:focus-visible{outline:2px solid var(--wb-primary);outline-offset:2px}@media(max-width:1100px){.student-profile{grid-template-columns:1fr 1fr}.priority-summary{display:none}.management-workspace{grid-template-columns:minmax(0,1fr) minmax(320px,.8fr)}}@media(max-width:900px){.management-workspace{grid-template-columns:1fr}.learning-record{position:static;min-height:0}.question-manager{min-height:480px}}@media(max-width:720px){.student-profile{grid-template-columns:1fr}.student-switcher{border-right:0;border-bottom:1px solid var(--wb-border-light)}.mastery-overview{padding:16px 20px}.status-grid{grid-template-columns:repeat(2,1fr)}.question-search,.compact-select{width:100%}.retry-basket{align-items:flex-start;flex-direction:column}.basket-actions{width:100%;justify-content:flex-end}.question-record{padding:12px}.error-frequency,.record-arrow{display:none}.record-topline time{display:none}.answer-comparison{grid-template-columns:1fr}.learning-status{grid-template-columns:1fr}.learning-status div{align-items:center;flex-direction:row;justify-content:space-between;border-right:0;border-bottom:1px solid var(--wb-border-light)}.learning-status div:last-child{border-bottom:0}}

/* 错题中心空状态：与工作台 KpiStrip / Row 风格对齐 */
.wb-empty__recent{margin-top:var(--wb-space-4)}.wb-empty__all{margin-top:var(--wb-space-4)}
.recent-list{display:grid;gap:0}
.recent-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:var(--wb-space-3);min-height:64px;padding:0 var(--wb-space-5);box-sizing:border-box;color:inherit;background:transparent;border:0;border-bottom:1px solid var(--wb-border-light);text-align:left;cursor:pointer;transition:background var(--wb-motion-fast) var(--wb-motion-ease)}
.recent-row:hover{background:var(--wb-bg-hover)}
.recent-row:focus-visible{position:relative;z-index:1;outline:2px solid var(--wb-primary);outline-offset:-2px}
.recent-meta{display:flex;min-width:0;flex-direction:column;gap:3px}
.recent-meta strong{font-size:var(--wb-fs-body);font-weight:var(--wb-fw-semibold);color:var(--wb-text)}
.recent-meta small{color:var(--wb-text-tertiary);font-size:var(--wb-fs-eyebrow)}
.error-pill{display:inline-flex;align-items:center;height:22px;padding:0 var(--wb-space-2);border-radius:var(--wb-radius-xs);font-size:var(--wb-fs-eyebrow);font-weight:var(--wb-fw-semibold);white-space:nowrap;font-variant-numeric:tabular-nums}
.error-pill.is-warning{color:var(--wb-warning);background:var(--wb-status-warning-bg, #fff5df)}
.error-pill.is-muted{color:var(--wb-text-tertiary);background:var(--wb-bg-subtle)}
.row-arrow{color:#c4c7ce}

/* 所有学生列表：与 StudentsWorkbench student-row 风格一致 */
.student-list{display:block}
.list-head__row{display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(86px,.65fr) minmax(76px,.55fr) minmax(76px,.55fr) minmax(86px,.65fr) 36px;align-items:center;gap:var(--wb-space-3);padding:0 var(--wb-space-5);min-height:40px;box-sizing:border-box;background:var(--wb-bg-elevated);border-bottom:1px solid var(--wb-border-light);color:var(--wb-text-secondary);font-size:var(--wb-fs-eyebrow);font-weight:var(--wb-fw-semibold);letter-spacing:.01em}
.op-col{display:flex;justify-content:flex-end}
.student-row{display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(86px,.65fr) minmax(76px,.55fr) minmax(76px,.55fr) minmax(86px,.65fr) 36px;align-items:center;gap:var(--wb-space-3);width:100%;min-height:76px;padding:0 var(--wb-space-5);box-sizing:border-box;color:inherit;background:transparent;border:0;border-bottom:1px solid var(--wb-border-light);text-align:left;cursor:pointer;transition:background var(--wb-motion-fast) var(--wb-motion-ease)}
.student-row:last-child{border-bottom:0}
.student-row:hover{background:var(--wb-bg-hover)}
.student-row:focus-visible{position:relative;z-index:1;outline:2px solid var(--wb-primary);outline-offset:-2px}
.student-cell{display:flex;align-items:center;min-width:0;gap:var(--wb-space-3)}
.student-identity{display:flex;min-width:0;flex-direction:column;gap:2px}
.student-identity strong{font-size:var(--wb-fs-body);font-weight:var(--wb-fw-semibold);color:var(--wb-text)}
.student-identity small{color:var(--wb-text-tertiary);font-size:var(--wb-fs-eyebrow)}
.metric-cell{display:flex;align-items:baseline;gap:3px;color:var(--wb-text);font-variant-numeric:tabular-nums}
.metric-cell strong{font-size:var(--wb-fs-stat, 20px);font-weight:var(--wb-fw-bold);color:var(--wb-text)}
.metric-cell em{font-size:var(--wb-fs-eyebrow);font-style:normal;color:var(--wb-text-tertiary)}
.metric-cell.is-danger strong{color:var(--wb-danger)}
.metric-cell .last-wrong{font-size:var(--wb-fs-body);color:var(--wb-text-secondary)}
.metric-cell .muted{font-size:var(--wb-fs-body);color:var(--wb-text-tertiary)}
.row-action{display:flex;align-items:center;justify-content:flex-end;color:#c4c7ce}

.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

@media(max-width:1000px){.list-head__row,.student-row{grid-template-columns:minmax(200px,1.5fr) minmax(74px,.6fr) minmax(66px,.5fr) minmax(66px,.5fr) minmax(74px,.6fr) 32px;gap:var(--wb-space-2);padding:0 var(--wb-space-4)}}
@media(max-width:720px){.list-head__row,.student-row{grid-template-columns:minmax(0,1.4fr) minmax(64px,.55fr) minmax(58px,.45fr) minmax(58px,.45fr) minmax(64px,.55fr) 28px;gap:var(--wb-space-2);padding:0 var(--wb-space-3)}.student-cell{gap:var(--wb-space-2)}}
</style>