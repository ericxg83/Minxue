<template>
  <div class="paper-bank wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学资源 / 题库"
        title="试卷题库"
        description="把纸质卷（拍照或 PDF）转成结构化题目，永久保存；跨卷勾题直接出讲义 PDF"
      >
        <template #actions>
          <ActionButton variant="secondary" @click="showCreateDialog = true">
            <el-icon><Plus /></el-icon>新建试卷
          </ActionButton>
          <ActionButton variant="primary" :disabled="!papers.length" @click="openUploadDialog(null, 'questions')">
            <el-icon><UploadFilled /></el-icon>上传并解析
          </ActionButton>
        </template>
      </PageHeader>

      <FilterBar class="pb-filter">
        <template #leading>
          <div class="pb-summary">
            <strong>{{ questions.length }} 道题</strong>
            <span>{{ papers.length }} 套卷 · 已勾选 {{ selectedIds.length }} 题</span>
          </div>
        </template>
        <WorkbenchSelect v-model="filterPaper" :options="paperFilterOptions" width="200px" aria-label="按试卷筛选" />
        <WorkbenchInput v-model="filterQuestionNos" clearable placeholder="题号，如 19,24,25" width="170px" aria-label="按题号筛选" />
        <WorkbenchSelect v-model="filterType" :options="typeFilterOptions" width="126px" aria-label="按题型筛选" />
        <WorkbenchSelect v-model="filterDifficulty" :options="difficultyFilterOptions" width="126px" aria-label="按难度筛选" />
        <WorkbenchSelect v-model="filterTag" :options="tagFilterOptions" width="126px" aria-label="按标签筛选" />
        <WorkbenchInput v-model="filterKeyword" clearable placeholder="搜索题干" width="180px" aria-label="搜索题干" />
        <template #actions><el-button text @click="resetFilters">重置</el-button></template>
      </FilterBar>

      <ContentCard class="pb-list" title="题目" description="勾选要讲的题，可跨多套卷一起出讲义" flush>
        <div v-if="loading" class="pb-loading"><el-skeleton v-for="i in 6" :key="i" :rows="2" animated /></div>

        <EmptyState
          v-else-if="!papers.length"
          :icon="Tickets"
          title="还没有试卷"
          description="先新建一份试卷，再把卷子拍照或上传 PDF —— 系统会自动拆成一道道题。"
        >
          <template #actions>
            <ActionButton variant="primary" @click="showCreateDialog = true"><el-icon><Plus /></el-icon>新建试卷</ActionButton>
          </template>
        </EmptyState>

        <EmptyState
          v-else-if="!questions.length"
          :icon="Search"
          title="没有符合筛选条件的题目"
          description="可以调整筛选条件，或先给这份卷子上传文件并解析。"
        >
          <template #actions><ActionButton @click="resetFilters">重置筛选</ActionButton></template>
        </EmptyState>

        <div v-else class="pb-rows">
          <label v-for="q in questions" :key="q.id" class="pb-row" :class="{ 'is-selected': isSelected(q.id) }">
            <el-checkbox :model-value="isSelected(q.id)" @change="toggle(q.id)" />
            <div class="pb-row__body">
              <div class="pb-row__head">
                <span class="pb-row__num">{{ questionLabel(q) }}</span>
                <span class="pb-row__paper">{{ q.resource_name }}</span>
                <span v-for="t in (q.tags || [])" :key="t" class="pb-tag">{{ t }}</span>
                <span v-if="q.difficulty" class="pb-row__diff">{{ stars(q.difficulty) }}</span>
                <span class="pb-row__type">{{ typeLabel(q.question_type) }}</span>
              </div>
              <div class="pb-row__text">{{ q.parent_stem || q.content }}</div>
              <div v-if="(q.options || []).length" class="pb-row__opts">
                <span v-for="(o, i) in q.options" :key="i">{{ String.fromCharCode(65 + i) }}. {{ o }}</span>
              </div>
              <div v-if="q.answer" class="pb-row__answer">
                参考答案：{{ q.answer }}
                <em v-if="q.answer_source">{{ answerSourceLabel(q.answer_source) }}</em>
                <em v-if="q.answer_conflict_count > 1" class="is-warn">
                  ⚠ 答案册里有 {{ q.answer_conflict_count }} 条同题号答案，需人工确认
                </em>
              </div>
              <div v-else class="pb-row__answer is-empty">未录入参考答案</div>
            </div>
            <img v-if="q.image_url" class="pb-row__thumb" :src="thumbUrl(q.image_url)" alt="原题" loading="lazy" />
          </label>
        </div>
      </ContentCard>

      <ContentCard class="pb-papers" title="试卷" description="解析状态与题目数">
        <div class="pb-paper-list">
          <div v-for="p in papers" :key="p.id" class="pb-paper">
            <div class="pb-paper__main">
              <strong>{{ p.name }}</strong>
              <span>
                {{ [p.grade, p.subject].filter(Boolean).join(' · ') || '未设置' }}
                · 题目 {{ p.question_count || 0 }}
                · 官方答案 {{ p.answer_count || 0 }}
              </span>
            </div>
            <StatusTag :label="parseLabel(p)" :tone="parseTone(p)" />
            <StatusTag :label="answerParseLabel(p)" :tone="answerParseTone(p)" />
            <el-button text @click="openUploadDialog(p.id, 'questions')">上传题目</el-button>
            <el-button text type="primary" @click="openUploadDialog(p.id, 'answers')">上传答案</el-button>
            <el-popconfirm title="确定删除这份试卷及其全部题目？" confirm-button-text="删除" cancel-button-text="取消" @confirm="handleDeletePaper(p)">
              <template #reference><el-button text type="danger">删除</el-button></template>
            </el-popconfirm>
          </div>
        </div>
      </ContentCard>
    </div>

    <!-- 底部操作条：已勾选 → 生成讲义 -->
    <div v-if="selectedIds.length" class="pb-actionbar">
      <span>已勾选 <strong>{{ selectedIds.length }}</strong> 题</span>
      <el-checkbox v-model="handoutWithAnswers">带参考答案</el-checkbox>
      <el-checkbox v-model="handoutWithImage">显示原题图</el-checkbox>
      <el-button text @click="clearSelection">清空</el-button>
      <ActionButton variant="primary" :loading="exporting" @click="handleExportHandout">
        <el-icon><Document /></el-icon>生成讲义 PDF
      </ActionButton>
    </div>

    <el-dialog v-model="showCreateDialog" title="新建试卷" width="440px">
      <el-form :model="createForm" label-width="72px">
        <el-form-item label="名称">
          <WorkbenchInput v-model="createForm.name" placeholder="如：2026 黄浦一模·数学" aria-label="试卷名称" />
        </el-form-item>
        <el-form-item label="年级">
          <WorkbenchInput v-model="createForm.grade" placeholder="如：初三" aria-label="年级" />
        </el-form-item>
        <el-form-item label="科目">
          <WorkbenchInput v-model="createForm.subject" placeholder="如：数学" aria-label="科目" />
        </el-form-item>
        <el-form-item label="考试日期">
          <el-date-picker v-model="createForm.examDate" type="date" value-format="YYYY-MM-DD" placeholder="选填" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreatePaper">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showUploadDialog" :title="uploadMode === 'answers' ? '上传官方答案' : '上传试卷题目'" width="520px">
      <p class="pb-hint" v-if="uploadMode === 'answers'">
        上传这份卷子的<strong>官方答案</strong>（PDF 或答案页照片）。答案会存进答案库并标为「官方」，
        讲义里优先用它，<strong>不会用 AI 猜</strong>。答案按<strong>题号</strong>与题目自动对上。
      </p>
      <p class="pb-hint" v-else>
        支持 <strong>PDF</strong>（推荐，无拍照变形）或 <strong>多张照片</strong>（JPEG / PNG / WebP）。
        上传后系统会在后台拆题，可以离开本页，解析完再回来。
      </p>
      <WorkbenchSelect v-model="uploadPaperId" :options="uploadPaperOptions" width="100%" aria-label="选择试卷" />
      <input ref="fileInput" type="file" multiple accept=".pdf,image/jpeg,image/png,image/webp" style="display:none" @change="onFilesPicked" />
      <div class="pb-upload-actions">
        <el-button :disabled="!uploadPaperId" @click="fileInput?.click()">选择文件</el-button>
        <span v-if="pickedFiles.length" class="pb-picked">已选 {{ pickedFiles.length }} 个文件</span>
      </div>
      <template #footer>
        <el-button @click="showUploadDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!uploadPaperId || !pickedFiles.length" :loading="uploading" @click="handleUpload">开始解析</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Plus, UploadFilled, Search, Document, Tickets } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import PageHeader from '../components/ui/PageHeader.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ActionButton from '../components/ui/ActionButton.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import {
  getPaperBankPapers,
  createPaperBankPaper,
  deletePaperBankPaper,
  parsePaperBankPaper,
  parsePaperBankAnswers,
  searchPaperBankQuestions,
} from '../../services/apiService.js'
import { buildHandoutBody, buildHandoutCSS, groupHandoutQuestions } from '../../utils/handoutPdf'
import { renderCustomBodyToHTML, exportServerPDF } from '../../utils/serverPdfExporter'
import { ossThumbUrl } from '../../utils/ossThumb'

const papers = ref([])
const questions = ref([])
const loading = ref(false)
const creating = ref(false)
const uploading = ref(false)
const exporting = ref(false)

const filterPaper = ref('all')
const filterQuestionNos = ref('')
const filterType = ref('all')
const filterDifficulty = ref('all')
const filterTag = ref('all')
const filterKeyword = ref('')

const selectedIds = ref([])
const handoutWithAnswers = ref(false)
const handoutWithImage = ref(false)

const showCreateDialog = ref(false)
const showUploadDialog = ref(false)
const createForm = ref({ name: '', grade: '', subject: '数学', examDate: null })
const uploadPaperId = ref('')
// 'questions' = 题目 PDF/照片（进 resource_questions）；'answers' = 官方答案（进答案库）
const uploadMode = ref('questions')
const pickedFiles = ref([])
const fileInput = ref(null)

let pollTimer = null

const paperFilterOptions = computed(() => [
  { label: '全部试卷', value: 'all' },
  ...papers.value.map(p => ({ label: `${p.name}（${p.question_count || 0}）`, value: p.id })),
])
const uploadPaperOptions = computed(() => papers.value.map(p => ({ label: p.name, value: p.id })))
const typeFilterOptions = [
  { label: '全部题型', value: 'all' },
  { label: '选择题', value: 'choice' },
  { label: '填空题', value: 'fill' },
  { label: '判断题', value: 'judge' },
  { label: '解答题', value: 'answer' },
]
const difficultyFilterOptions = [
  { label: '全部难度', value: 'all' },
  { label: '★ 基础', value: '1' },
  { label: '★★ 中等', value: '3' },
  { label: '★★★ 较难', value: '5' },
]
const tagFilterOptions = [
  { label: '全部标签', value: 'all' },
  { label: '压轴题', value: '压轴题' },
]

const isSelected = (id) => selectedIds.value.includes(id)
const toggle = (id) => {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}
const clearSelection = () => { selectedIds.value = [] }

const questionLabel = (q) => (q.question_no == null ? '?' : `${q.question_no}${q.sub_no ? `(${q.sub_no})` : ''}.`)
const typeLabel = (t) => ({ choice: '选择题', fill: '填空题', judge: '判断题', answer: '解答题' }[t] || '解答题')
const stars = (d) => '★'.repeat(Math.max(1, Math.min(3, d <= 2 ? 1 : d === 3 ? 2 : 3)))
// 列表缩略图走统一入口（OSS 追加 resize 参数），⛔ 不直接引原图
const thumbUrl = (url) => ossThumbUrl(url, 240) || url

// 答案来源四态：官方答案库 / 卷面印刷 / 老师手填 / AI 解出。
// ⛔ 必须在界面上区分 —— 「答案一定要对，不要去猜」，老师要能一眼看出这条答案是谁给的。
const ANSWER_SOURCE_LABELS = { official: '官方答案', printed: '卷面印刷', manual: '老师手填', ai: 'AI 解出' }
const answerSourceLabel = (s) => (ANSWER_SOURCE_LABELS[s] ? `（${ANSWER_SOURCE_LABELS[s]}）` : '')

const parseLabel = (p) => {
  const s = p.question_parse_status
  if (s === 'parsing') return `解析中 ${p.question_parse_done_pages || 0}/${p.question_parse_total_pages || '?'}`
  if (s === 'done') return '已解析'
  if (s === 'failed') return '解析失败'
  return '未解析'
}
const parseTone = (p) => {
  const s = p.question_parse_status
  if (s === 'done') return 'success'
  if (s === 'parsing') return 'info'
  if (s === 'failed') return 'danger'
  return 'neutral'
}

// 官方答案的解析状态（与题目解析是两条独立的链）
const answerParseLabel = (p) => {
  const s = p.parse_status
  if (s === 'parsing') return '答案解析中'
  if (p.answer_count > 0) return `答案 ${p.answer_count} 条`
  if (s === 'failed') return '答案解析失败'
  return '无答案'
}
const answerParseTone = (p) => {
  if (p.answer_count > 0) return 'success'
  if (p.parse_status === 'parsing') return 'info'
  if (p.parse_status === 'failed') return 'danger'
  return 'neutral'
}

const loadPapers = async () => {
  papers.value = await getPaperBankPapers()
}

const buildQuery = () => ({
  resourceIds: filterPaper.value === 'all' ? undefined : [filterPaper.value],
  questionNos: filterQuestionNos.value
    ? String(filterQuestionNos.value).split(/[,，\s]+/).map(Number).filter(Number.isFinite)
    : undefined,
  questionTypes: filterType.value === 'all' ? undefined : [filterType.value],
  difficulties: filterDifficulty.value === 'all' ? undefined : [Number(filterDifficulty.value)],
  tags: filterTag.value === 'all' ? undefined : [filterTag.value],
  keyword: filterKeyword.value || undefined,
  limit: 800,
})

const loadQuestions = async () => {
  loading.value = true
  try {
    questions.value = await searchPaperBankQuestions(buildQuery())
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '题目加载失败')
    questions.value = []
  } finally {
    loading.value = false
  }
}

const resetFilters = () => {
  filterPaper.value = 'all'
  filterQuestionNos.value = ''
  filterType.value = 'all'
  filterDifficulty.value = 'all'
  filterTag.value = 'all'
  filterKeyword.value = ''
}

const handleCreatePaper = async () => {
  if (!createForm.value.name.trim()) return ElMessage.warning('请填写试卷名称')
  creating.value = true
  try {
    await createPaperBankPaper({ ...createForm.value })
    ElMessage.success('已创建')
    showCreateDialog.value = false
    createForm.value = { name: '', grade: '', subject: '数学', examDate: null }
    await loadPapers()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

const openUploadDialog = (paperId, mode = 'questions') => {
  uploadPaperId.value = paperId || papers.value[0]?.id || ''
  uploadMode.value = mode
  pickedFiles.value = []
  showUploadDialog.value = true
}

const onFilesPicked = (ev) => {
  pickedFiles.value = Array.from(ev.target?.files || [])
  if (ev.target) ev.target.value = ''
}

const handleUpload = async () => {
  uploading.value = true
  try {
    if (uploadMode.value === 'answers') {
      await parsePaperBankAnswers(uploadPaperId.value, pickedFiles.value)
      ElMessage.success('答案已上传，正在后台解析')
    } else {
      await parsePaperBankPaper(uploadPaperId.value, pickedFiles.value)
      ElMessage.success('题目已上传，正在后台解析')
    }
    showUploadDialog.value = false
    pickedFiles.value = []
    await loadPapers()
    startPolling()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

const handleDeletePaper = async (p) => {
  try {
    await deletePaperBankPaper(p.id)
    ElMessage.success('已删除')
    await loadPapers()
    await loadQuestions()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '删除失败')
  }
}

// 解析在服务端后台跑：轮询卷状态，解析完成就刷新题目列表。
// 老师可以离开本页 —— 重新进来时 onMounted 会重新拉一次，状态不会丢。
// 题目解析与答案解析是两条独立的链，任一条在跑都要继续轮询。
const anyParsing = () => papers.value.some(
  p => p.question_parse_status === 'parsing' || p.parse_status === 'parsing'
)
const startPolling = () => {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      await loadPapers()
      if (!anyParsing()) {
        stopPolling()
        await loadQuestions()
        ElMessage.success('解析完成')
      }
    } catch { /* 轮询失败不打扰老师，下个 tick 再试 */ }
  }, 4000)
}
const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }

const handleExportHandout = async () => {
  const picked = questions.value.filter(q => selectedIds.value.includes(q.id))
  if (!picked.length) return ElMessage.warning('还没有勾选题目')
  exporting.value = true
  try {
    const groups = groupHandoutQuestions(picked)
    // 讲义版式：保留原卷题号、按卷分组（⛔ 不复用重练卷版式，那套会重排重编号）
    const bodyHtml = buildHandoutBody({
      title: handoutTitle(groups),
      groups,
      showAnswers: handoutWithAnswers.value,
      showImage: handoutWithImage.value,
    })
    const html = await renderCustomBodyToHTML({ bodyHtml, extraCss: buildHandoutCSS() })
    const filename = handoutTitle(groups)
    await exportServerPDF({ html, filename })
    ElMessage.success('讲义已生成')
  } catch (e) {
    ElMessage.error(e?.message || '生成讲义失败')
  } finally {
    exporting.value = false
  }
}

const handoutTitle = (groups) => {
  if (groups.length === 1) return `${groups[0].paperName} 讲题讲义`
  return `${groups.length} 套卷 讲题讲义`
}

watch([filterPaper, filterType, filterDifficulty, filterTag], () => { loadQuestions() })
watch([filterQuestionNos, filterKeyword], () => { loadQuestions() })

onMounted(async () => {
  loading.value = true
  try {
    await loadPapers()
    await loadQuestions()
    if (anyParsing()) startPolling()
  } finally {
    loading.value = false
  }
})
onUnmounted(stopPolling)
</script>

<style scoped>
.pb-summary { display: flex; flex-direction: column; gap: 2px; }
.pb-summary strong { font-size: 15px; }
.pb-summary span { font-size: 12px; color: #666; }
.pb-loading { padding: 12px 16px; display: grid; gap: 12px; }
.pb-rows { display: flex; flex-direction: column; }
.pb-row {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 10px 16px; border-bottom: 1px solid #f0f0f0; cursor: pointer;
}
.pb-row:hover { background: #fafafa; }
.pb-row.is-selected { background: #f5f6ff; }
.pb-row__body { flex: 1; min-width: 0; }
.pb-row__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.pb-row__num { font-weight: 600; white-space: nowrap; }
.pb-row__paper { font-size: 12px; color: #888; }
.pb-tag { font-size: 11px; color: #993c1d; background: #faece7; border: 1px solid #f0997b; border-radius: 4px; padding: 0 5px; }
.pb-row__diff { color: #f59e0b; font-size: 12px; }
.pb-row__type { font-size: 11px; color: #666; background: #f1efe8; border-radius: 4px; padding: 0 5px; }
.pb-row__text { font-size: 13px; line-height: 1.6; word-break: break-word; }
.pb-row__opts { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: #444; margin-top: 3px; }
.pb-row__answer { font-size: 12px; color: #4f46e5; margin-top: 3px; }
.pb-row__answer em { color: #993c1d; font-style: normal; }
.pb-row__answer em.is-warn { color: #a32d2d; font-weight: 500; }
.pb-row__answer.is-empty { color: #bbb; }
.pb-row__thumb { width: 120px; max-height: 120px; object-fit: contain; border: 1px solid #eee; border-radius: 4px; flex-shrink: 0; }
.pb-paper-list { display: flex; flex-direction: column; }
.pb-paper { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #f0f0f0; }
.pb-paper__main { flex: 1; display: flex; flex-direction: column; }
.pb-paper__main span { font-size: 12px; color: #888; }
.pb-actionbar {
  position: sticky; bottom: 0; z-index: 5;
  display: flex; align-items: center; gap: 16px;
  padding: 10px 24px; background: #fff; border-top: 1px solid #e5e5e5;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
}
.pb-actionbar > span { font-size: 13px; }
.pb-hint { font-size: 13px; color: #666; line-height: 1.7; margin-bottom: 12px; }
.pb-upload-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.pb-picked { font-size: 12px; color: #666; }
</style>
