<template>
  <div class="paper-bank wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学资源 / 题库"
        title="试卷题库"
        description="把纸质卷（拍照或 PDF）转成结构化题目；挑题进试题篮 → 出练习卷 / 教师卷，或按原卷题号出讲题讲义"
      >
        <template #actions>
          <ActionButton variant="secondary" @click="openCreateDialog">
            <el-icon><Plus /></el-icon>新建试卷
          </ActionButton>
          <ActionButton variant="primary" :disabled="!papers.length" @click="openUploadDialog(null, 'questions')">
            <el-icon><UploadFilled /></el-icon>上传并解析
          </ActionButton>
        </template>
      </PageHeader>

      <div class="pb-layout">
        <!-- ═══ 左：卷列表 ═══ -->
        <aside class="pb-col pb-col--papers">
          <div class="pb-panel">
            <div class="pb-panel__head">
              <strong>卷子</strong>
              <span>{{ papers.length }} 套 · {{ totalQuestionCount }} 题</span>
            </div>

            <button
              type="button"
              class="pb-paper"
              :class="{ 'is-active': filterPaper === 'all' }"
              @click="pickPaper('all')"
            >
              <span class="pb-paper__name">全部卷子</span>
              <span class="pb-paper__meta">{{ totalQuestionCount }} 题</span>
            </button>

            <div v-for="p in papers" :key="p.id" class="pb-paper-wrap" :class="{ 'is-active': filterPaper === p.id }">
              <button type="button" class="pb-paper" @click="pickPaper(p.id)">
                <span class="pb-paper__name" :title="p.name">{{ p.name }}</span>
                <span class="pb-paper__meta">{{ p.question_count || 0 }} 题</span>
                <span v-if="isParsing(p)" class="pb-paper__parsing">解析中 {{ p.question_parse_done_pages || 0 }}/{{ p.question_parse_total_pages || '?' }}</span>
              </button>
              <div class="pb-paper__ops">
                <button type="button" title="上传题目/照片" @click.stop="openUploadDialog(p.id, 'questions')">题目</button>
                <button type="button" title="上传官方答案" @click.stop="openUploadDialog(p.id, 'answers')">答案</button>
                <button type="button" class="is-danger" title="删除这套卷及其题目" @click.stop="askDeletePaper(p)">删除</button>
              </div>
            </div>

            <div v-if="!papers.length" class="pb-panel__empty">
              还没有卷子。先「新建试卷」，再把卷子拍照或上传 PDF。
            </div>
          </div>

          <div class="pb-panel pb-panel--tip">
            <strong>怎么用</strong>
            <p>① 左侧选卷 → ② 中间挑题加入试题篮 → ③ 右上角出卷。</p>
            <p>「出练习卷」重排题号、留答题空；「讲义」保留原卷题号，讲题时对得上。</p>
          </div>
        </aside>

        <!-- ═══ 中：题目区 ═══ -->
        <main class="pb-col pb-col--questions">
          <FilterBar class="pb-filter">
            <template #leading>
              <div class="pb-summary">
                <strong>{{ questions.length }}{{ truncated ? '+' : '' }} 道题</strong>
                <span>{{ filterSummary }}</span>
              </div>
            </template>
            <WorkbenchSelect v-model="filterType" :options="typeFilterOptions" width="104px" aria-label="按题型筛选" />
            <WorkbenchSelect v-model="filterDifficulty" :options="difficultyFilterOptions" width="104px" aria-label="按难度筛选" />
            <WorkbenchSelect v-model="filterTag" :options="tagFilterOptions" width="100px" aria-label="按标签筛选" />
            <WorkbenchInput v-model="filterQuestionNos" clearable placeholder="题号 19,24" width="116px" aria-label="按题号筛选" />
            <WorkbenchInput v-model="filterKeyword" clearable placeholder="搜索题干" width="132px" aria-label="搜索题干" />
            <template #actions><el-button text @click="resetFilters">重置</el-button></template>
          </FilterBar>

          <div v-if="loading" class="pb-loading"><el-skeleton v-for="i in 5" :key="i" :rows="2" animated /></div>

          <EmptyState
            v-else-if="!papers.length"
            :icon="Tickets"
            title="还没有试卷"
            description="先新建一份试卷，再把卷子拍照或上传 PDF —— 系统会自动拆成一道道题。"
          >
            <template #actions>
              <ActionButton variant="primary" @click="openCreateDialog"><el-icon><Plus /></el-icon>新建试卷</ActionButton>
            </template>
          </EmptyState>

          <EmptyState
            v-else-if="!questions.length"
            :icon="Search"
            title="没有符合筛选条件的题目"
            :description="emptyHint"
          >
            <template #actions>
              <ActionButton @click="resetFilters">重置筛选</ActionButton>
              <ActionButton v-if="filterPaper !== 'all'" @click="pickPaper('all')">看全部卷子</ActionButton>
            </template>
          </EmptyState>

          <div v-else class="pb-rows">
            <article v-for="q in questions" :key="q.id" class="pb-row" :class="{ 'is-selected': isInBasket(basket, q.id) }">
              <el-checkbox class="pb-row__check" :model-value="isInBasket(basket, q.id)" @change="toggle(q)" />

              <div class="pb-row__body">
                <div class="pb-row__head">
                  <span class="pb-row__num">{{ questionLabel(q) }}</span>
                  <span class="pb-row__type">{{ typeLabel(q.question_type) }}</span>
                  <span v-if="q.difficulty" class="pb-row__diff">{{ stars(q.difficulty) }}</span>
                  <span v-for="t in (q.tags || [])" :key="t" class="pb-tag">{{ t }}</span>
                  <span class="pb-row__paper">{{ q.resource_name }}</span>
                </div>

                <div v-if="q.parent_stem" class="pb-row__stem">
                  <MathRender :content="q.parent_stem" auto-detect />
                </div>
                <div class="pb-row__text"><MathRender :content="q.content" auto-detect /></div>

                <div v-if="(q.options || []).length" class="pb-row__opts">
                  <span v-for="(o, i) in q.options" :key="i" class="pb-opt">
                    {{ String.fromCharCode(65 + i) }}.<MathRender :content="String(o)" auto-detect tag="span" force-inline />
                  </span>
                </div>

                <div v-if="q.answer" class="pb-row__answer">
                  <span class="pb-row__answer-label">参考答案</span>
                  <MathRender :content="q.answer" auto-detect tag="span" force-inline />
                  <em v-if="q.answer_source">{{ answerSourceLabel(q.answer_source) }}</em>
                  <em v-if="q.answer_conflict_count > 1" class="is-warn">
                    答案册里有 {{ q.answer_conflict_count }} 条同题号答案，需人工确认
                  </em>
                </div>
                <div v-else class="pb-row__answer is-empty">未录入参考答案</div>

                <div class="pb-row__foot">
                  <button type="button" class="pb-link" @click="toggleEditor(q.id)">
                    {{ editingId === q.id ? '收起编辑' : '改难度 / 标签' }}
                  </button>
                  <a v-if="q.image_url" class="pb-link" :href="q.image_url" target="_blank" rel="noopener">看原题图</a>
                </div>

                <div v-if="editingId === q.id" class="pb-editor">
                  <label>难度
                    <select :value="q.difficulty == null ? '' : String(q.difficulty)" @change="saveDifficulty(q, $event)">
                      <option value="">未判定</option>
                      <option value="1">★ 基础</option>
                      <option value="3">★★ 中等</option>
                      <option value="5">★★★ 较难</option>
                    </select>
                  </label>
                  <label class="pb-editor__tags">标签
                    <input :value="(q.tags || []).join(',')" placeholder="逗号分隔，如 压轴题,易错" @change="saveTags(q, $event)" />
                  </label>
                  <span class="pb-editor__hint">改完立刻保存，全库筛选项跟着变</span>
                </div>
              </div>

              <img v-if="q.image_url" class="pb-row__thumb" :src="thumbUrl(q.image_url)" alt="原题" loading="lazy" />
            </article>

            <button v-if="truncated" type="button" class="pb-more" @click="loadMore">
              还有更多题，点这里再多加载 200 道
            </button>
          </div>
        </main>

        <!-- ═══ 右：试题篮 ═══ -->
        <aside class="pb-col pb-col--basket">
          <div class="pb-basket">
            <div class="pb-basket__head">
              <strong>试题篮</strong>
              <span v-if="summary.count">{{ summary.count }} 题 · {{ summary.totalScore }} 分</span>
              <span v-else>空</span>
            </div>

            <template v-if="summary.count">
              <div class="pb-basket__dist">
                <span v-for="b in PAPER_BASKET_BLOCKS" :key="b.key" v-show="summary.byType[b.key].count">
                  {{ b.label }} {{ summary.byType[b.key].count }}
                </span>
              </div>
              <div v-if="summary.missingAnswer" class="pb-basket__warn">
                其中 {{ summary.missingAnswer }} 题没有参考答案，教师卷会印「未录入」
              </div>

              <div class="pb-basket__list">
                <div v-for="b in blocks" :key="b.key" class="pb-bk-block">
                  <div class="pb-bk-block__head">{{ b.label }} · {{ b.count }} 题 · {{ b.score }} 分</div>
                  <div v-for="g in b.groups" :key="g.no" class="pb-bk-group">
                    <div v-for="it in g.items" :key="it.id" class="pb-bk-item">
                      <span class="pb-bk-item__no">{{ it.sub_label }}</span>
                      <span class="pb-bk-item__src" :title="it.resource_name">{{ it.resource_name }}</span>
                      <input
                        class="pb-bk-item__score"
                        type="number"
                        min="0"
                        step="0.5"
                        :value="it.score"
                        aria-label="本题分值"
                        @change="onScoreChange(it.id, $event)"
                      />
                      <span class="pb-bk-item__unit">分</span>
                      <button type="button" class="pb-bk-item__op" title="上移" @click="onMove(it.id, -1)">↑</button>
                      <button type="button" class="pb-bk-item__op" title="下移" @click="onMove(it.id, 1)">↓</button>
                      <button type="button" class="pb-bk-item__op is-danger" title="移出" @click="onRemove(it.id)">×</button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="pb-basket__form">
                <label class="pb-field">
                  <span>卷名</span>
                  <input v-model="composeTitle" placeholder="如：周末练习（三）" />
                </label>
                <label class="pb-check"><input v-model="composeWithImage" type="checkbox" />印原题图（几何题需要）</label>
              </div>

              <div class="pb-basket__actions">
                <ActionButton variant="primary" :loading="exporting === 'student'" @click="exportCompose(false)">
                  <el-icon><Document /></el-icon>出练习卷
                </ActionButton>
                <ActionButton :loading="exporting === 'teacher'" @click="exportCompose(true)">
                  <el-icon><DocumentCopy /></el-icon>出教师卷（含答案）
                </ActionButton>
                <el-button text :loading="exporting === 'handout'" @click="exportHandout">按原卷题号出讲义</el-button>
                <el-button text @click="clearBasket">清空</el-button>
              </div>
            </template>

            <div v-else class="pb-basket__empty">
              在中间题目上打勾，题目会进到这里。<br />
              可拖动排序、逐题改分值，卷面会按题型自动分大题。
            </div>
          </div>
        </aside>
      </div>
    </div>

    <!-- 新建试卷 -->
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
        <el-button type="primary" :loading="creating" @click="handleCreatePaper">创建并上传</el-button>
      </template>
    </el-dialog>

    <!-- 上传 -->
    <el-dialog v-model="showUploadDialog" :title="uploadMode === 'answers' ? '上传官方答案' : '上传试卷题目'" width="520px">
      <p v-if="uploadMode === 'answers'" class="pb-hint">
        上传这份卷子的<strong>官方答案</strong>（PDF 或答案页照片）。答案会存进答案库并标为「官方」，
        出教师卷时优先用它，<strong>不会用 AI 猜</strong>。答案按<strong>题号</strong>与题目自动对上。
      </p>
      <p v-else class="pb-hint">
        支持 <strong>PDF</strong>（推荐，无拍照变形）或 <strong>多张照片</strong>（JPEG / PNG / WebP）。
        上传后系统在后台拆题，可以离开本页，解析完再回来。
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
import { Plus, UploadFilled, Search, Document, DocumentCopy, Tickets } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '../components/ui/PageHeader.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ActionButton from '../components/ui/ActionButton.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import MathRender from '../components/MathRender.vue'
import {
  getPaperBankPapers,
  createPaperBankPaper,
  deletePaperBankPaper,
  parsePaperBankPaper,
  parsePaperBankAnswers,
  searchPaperBankQuestions,
  updatePaperBankQuestion,
} from '../../services/apiService.js'
import { buildHandoutBody, buildHandoutCSS, groupHandoutQuestions } from '../../utils/handoutPdf'
import { buildComposePaperBody, buildComposePaperCSS } from '../../utils/composePaperPdf'
import {
  PAPER_BASKET_BLOCKS,
  addBasketItem,
  removeBasketItem,
  setBasketItemScore,
  moveBasketItem,
  isInBasket,
  groupBasket,
  basketSummary,
  composePaperTotals,
  composePaperFilename,
} from '../../utils/paperBasket'
import { renderCustomBodyToHTML, exportServerPDF } from '../../utils/serverPdfExporter'
import { ossThumbUrl } from '../../utils/ossThumb'

const PAGE_SIZE = 200

const papers = ref([])
const questions = ref([])
const loading = ref(false)
const creating = ref(false)
const uploading = ref(false)
const exporting = ref('')
const truncated = ref(false)
const limit = ref(PAGE_SIZE)

const filterPaper = ref('all')
const filterQuestionNos = ref('')
const filterType = ref('all')
const filterDifficulty = ref('all')
const filterTag = ref('all')
const filterKeyword = ref('')
const tagOptions = ref([])

// 试题篮（前端状态，不落库）
const basket = ref([])
const composeTitle = ref('')
const composeWithImage = ref(false)
const editingId = ref('')

const showCreateDialog = ref(false)
const showUploadDialog = ref(false)
const createForm = ref({ name: '', grade: '', subject: '数学', examDate: null })
const uploadPaperId = ref('')
// 'questions' = 题目 PDF/照片（进 resource_questions）；'answers' = 官方答案（进答案库）
const uploadMode = ref('questions')
const pickedFiles = ref([])
const fileInput = ref(null)

let pollTimer = null

const totalQuestionCount = computed(() => papers.value.reduce((n, p) => n + (p.question_count || 0), 0))
const blocks = computed(() => groupBasket(basket.value))
const summary = computed(() => basketSummary(basket.value))
const totals = computed(() => composePaperTotals(blocks.value))

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
const tagFilterOptions = computed(() => ([
  { label: '全部标签', value: 'all' },
  ...tagOptions.value.map(t => ({ label: t, value: t })),
]))

const filterSummary = computed(() => `已选 ${summary.value.count} 题`)

// 筛选后为空时给可行动提示（⛔ 不能只写「没有题目」）
const emptyHint = computed(() => {
  const bits = []
  if (filterPaper.value !== 'all') bits.push('只看当前这套卷')
  if (filterType.value !== 'all') bits.push('指定了题型')
  if (filterDifficulty.value !== 'all') bits.push('指定了难度')
  if (filterTag.value !== 'all') bits.push('指定了标签')
  if (filterQuestionNos.value) bits.push('填了题号')
  if (filterKeyword.value) bits.push('搜了题干关键字')
  if (!bits.length) return '这套卷还没解析出题目，先上传题目文件并解析。'
  return `当前条件（${bits.join('、')}）下没有题。题库里难度标签大多还没补，先把难度改成「全部难度」再看。`
})

const isParsing = (p) => p.question_parse_status === 'parsing' || p.parse_status === 'parsing'

const questionLabel = (q) => (q.question_no == null ? '?' : `${q.question_no}${q.sub_no ? `(${q.sub_no})` : ''}.`)
const typeLabel = (t) => ({ choice: '选择题', fill: '填空题', judge: '判断题', answer: '解答题' }[t] || '解答题')
const stars = (d) => '★'.repeat(Math.max(1, Math.min(3, d <= 2 ? 1 : d === 3 ? 2 : 3)))
// 列表缩略图走统一入口（OSS 追加 resize 参数），⛔ 不直接引原图
const thumbUrl = (url) => ossThumbUrl(url, 240) || url

// 答案来源四态：官方答案库 / 卷面印刷 / 老师手填 / AI 解出。
// ⛔ 必须在界面上区分 —— 「答案一定要对，不要去猜」，老师要能一眼看出这条答案是谁给的。
const ANSWER_SOURCE_LABELS = { official: '官方答案', printed: '卷面印刷', manual: '老师手填', ai: 'AI 解出' }
const answerSourceLabel = (s) => (ANSWER_SOURCE_LABELS[s] ? `（${ANSWER_SOURCE_LABELS[s]}）` : '')

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
  // 多取一条用来判断「还有更多」
  limit: limit.value + 1,
})

const loadQuestions = async () => {
  loading.value = true
  try {
    const rows = await searchPaperBankQuestions(buildQuery())
    truncated.value = rows.length > limit.value
    const list = truncated.value ? rows.slice(0, limit.value) : rows
    questions.value = list
    // 标签候选从当前结果里收（题库的标签是自由文本，没有字典表）
    const set = new Set(tagOptions.value)
    for (const q of list) for (const t of (q.tags || [])) set.add(t)
    tagOptions.value = Array.from(set).filter(Boolean).sort()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '题目加载失败')
    questions.value = []
    truncated.value = false
  } finally {
    loading.value = false
  }
}

const loadMore = () => {
  limit.value += PAGE_SIZE
  loadQuestions()
}

const pickPaper = (id) => {
  filterPaper.value = id
  limit.value = PAGE_SIZE
  loadQuestions()
}

const resetFilters = () => {
  filterType.value = 'all'
  filterDifficulty.value = 'all'
  filterTag.value = 'all'
  filterQuestionNos.value = ''
  filterKeyword.value = ''
  limit.value = PAGE_SIZE
  loadQuestions()
}

// ── 试题篮 ──

const toggle = (q) => {
  basket.value = isInBasket(basket.value, q.id)
    ? removeBasketItem(basket.value, q.id)
    : addBasketItem(basket.value, q)
  if (!composeTitle.value.trim()) composeTitle.value = defaultTitle()
}

const onRemove = (id) => { basket.value = removeBasketItem(basket.value, id) }
const onMove = (id, delta) => { basket.value = moveBasketItem(basket.value, id, delta) }
const onScoreChange = (id, ev) => {
  basket.value = setBasketItemScore(basket.value, id, ev?.target?.value)
}
const clearBasket = () => { basket.value = [] }

const defaultTitle = () => {
  const ids = new Set(basket.value.map(it => it.resource_id))
  if (ids.size === 1) {
    const p = papers.value.find(x => x.id === basket.value[0].resource_id)
    if (p) return `${p.name} 选题练习`
  }
  return '组卷练习'
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const composeSubtitle = () => {
  const ids = new Set(basket.value.map(it => it.resource_id))
  if (ids.size !== 1) return `${ids.size} 套卷 · ${todayStr()}`
  const p = papers.value.find(x => x.id === basket.value[0].resource_id)
  if (!p) return todayStr()
  return [p.subject, p.grade, todayStr()].filter(Boolean).join(' · ')
}

// ── 难度 / 标签行内编辑 ──
// updatePaperBankQuestion 早就存在但此前全仓无人调用 ⇒ 难度筛选恒空（改不了就没有数据）。
const toggleEditor = (id) => { editingId.value = editingId.value === id ? '' : id }

const applyQuestionPatch = async (q, patch, okMsg) => {
  try {
    const updated = await updatePaperBankQuestion(q.id, patch)
    Object.assign(q, patch)
    if (updated) Object.assign(q, updated, patch)
    // 篮子里的同一题要同步，否则出卷还是旧难度/标签
    basket.value = basket.value.map(it => (it.id === q.id ? { ...it, ...patch } : it))
    ElMessage.success(okMsg)
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '保存失败')
  }
}

const saveDifficulty = (q, ev) => {
  const raw = ev?.target?.value
  const val = raw === '' ? null : Number(raw)
  applyQuestionPatch(q, { difficulty: val }, val == null ? '难度已清空' : '难度已保存')
}

const saveTags = (q, ev) => {
  const list = String(ev?.target?.value || '')
    .split(/[,，\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
  applyQuestionPatch(q, { tags: list }, '标签已保存')
}

// ── 新建 / 上传 / 删除 ──

const openCreateDialog = () => {
  createForm.value = { name: '', grade: '', subject: '数学', examDate: null }
  showCreateDialog.value = true
}

const handleCreatePaper = async () => {
  if (!createForm.value.name.trim()) return ElMessage.warning('请填写试卷名称')
  creating.value = true
  try {
    const paper = await createPaperBankPaper({ ...createForm.value })
    ElMessage.success('已创建，接着上传卷子文件')
    showCreateDialog.value = false
    await loadPapers()
    // 建完直接进上传：老师的下一个动作一定是传卷子，不要让他再点一次
    if (paper?.id) openUploadDialog(paper.id, 'questions')
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

const askDeletePaper = async (p) => {
  try {
    await ElMessageBox.confirm(
      `确定删除「${p.name}」及它的 ${p.question_count || 0} 道题？已放进试题篮的题也会一起消失。`,
      '删除试卷',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 取消
  }
  try {
    await deletePaperBankPaper(p.id)
    ElMessage.success('已删除')
    if (filterPaper.value === p.id) filterPaper.value = 'all'
    basket.value = basket.value.filter(it => it.resource_id !== p.id)
    await loadPapers()
    await loadQuestions()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '删除失败')
  }
}

// 解析在服务端后台跑：轮询卷状态，解析完成就刷新题目列表。
// 老师可以离开本页 —— 重新进来时 onMounted 会重新拉一次，状态不会丢。
// 题目解析与答案解析是两条独立的链，任一条在跑都要继续轮询。
const anyParsing = () => papers.value.some(isParsing)
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

// ── 三个出口 ──

const exportCompose = async (withAnswers) => {
  if (!basket.value.length) return ElMessage.warning('试题篮是空的')
  exporting.value = withAnswers ? 'teacher' : 'student'
  try {
    const bodyHtml = buildComposePaperBody({
      title: composeTitle.value,
      subtitle: composeSubtitle(),
      blocks: blocks.value,
      showAnswers: withAnswers,
      showImage: composeWithImage.value,
    })
    const html = await renderCustomBodyToHTML({ bodyHtml, extraCss: buildComposePaperCSS() })
    const filename = composePaperFilename(
      composeTitle.value,
      totals.value.questionCount,
      todayStr()
    ) + (withAnswers ? '_教师卷' : '')
    await exportServerPDF({ html, filename, pageNumbers: true })
    ElMessage.success(withAnswers ? '教师卷已生成' : '练习卷已生成')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '生成 PDF 失败')
  } finally {
    exporting.value = ''
  }
}

const exportHandout = async () => {
  if (!basket.value.length) return ElMessage.warning('试题篮是空的')
  exporting.value = 'handout'
  try {
    const picked = basket.value.slice()
    const groups = groupHandoutQuestions(picked)
    // 讲义版式：保留原卷题号、按卷分组（⛔ 不复用组卷版式，那套会重排重编号）
    const bodyHtml = buildHandoutBody({
      title: groups.length === 1 ? `${groups[0].paperName} 讲题讲义` : `${groups.length} 套卷 讲题讲义`,
      groups,
      showAnswers: true,
      showImage: composeWithImage.value,
    })
    const html = await renderCustomBodyToHTML({ bodyHtml, extraCss: buildHandoutCSS() })
    const filename = (groups.length === 1 ? `${groups[0].paperName} 讲题讲义` : `${groups.length} 套卷 讲题讲义`)
    await exportServerPDF({ html, filename })
    ElMessage.success('讲义已生成')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '生成讲义失败')
  } finally {
    exporting.value = ''
  }
}

watch([filterType, filterDifficulty, filterTag], () => { limit.value = PAGE_SIZE; loadQuestions() })
watch([filterQuestionNos, filterKeyword], () => { limit.value = PAGE_SIZE; loadQuestions() })

onMounted(async () => {
  loading.value = true
  try {
    await loadPapers()
    await loadQuestions()
    if (!composeTitle.value.trim()) composeTitle.value = '组卷练习'
    if (anyParsing()) startPolling()
  } finally {
    loading.value = false
  }
})
onUnmounted(stopPolling)
</script>

<style scoped>
.pb-layout {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr) 284px;
  gap: 14px;
  align-items: start;
}
@media (max-width: 1400px) {
  .pb-layout { grid-template-columns: 200px minmax(0, 1fr) 256px; gap: 12px; }
}
@media (max-width: 1180px) {
  .pb-layout { grid-template-columns: 176px minmax(0, 1fr) 236px; gap: 10px; }
  .pb-panel--tip { display: none; }
}

/* ── 左：卷列表 ── */
.pb-col--papers { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 12px; }
.pb-panel { background: #fff; border: 1px solid #ebe9e4; border-radius: 10px; padding: 10px; }
.pb-panel__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.pb-panel__head strong { font-size: 13px; }
.pb-panel__head span { font-size: 11px; color: #999; }
.pb-panel__empty { font-size: 12px; color: #999; line-height: 1.7; padding: 6px 2px; }
.pb-panel--tip { background: #faf9f6; }
.pb-panel--tip strong { font-size: 12px; }
.pb-panel--tip p { font-size: 11px; color: #777; line-height: 1.7; margin: 4px 0 0; }

.pb-paper-wrap { border-radius: 8px; }
.pb-paper-wrap .pb-paper__ops { display: none; }
.pb-paper-wrap:hover .pb-paper__ops { display: flex; }
.pb-paper-wrap.is-active .pb-paper,
.pb-paper.is-active { background: #eef2ff; }
.pb-paper {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 7px 8px; border: 0; background: transparent; border-radius: 8px;
  font-size: 12px; color: #333; text-align: left; cursor: pointer;
}
.pb-paper:hover { background: #f5f4f0; }
.pb-paper__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-paper__meta { font-size: 11px; color: #999; flex-shrink: 0; }
.pb-paper__parsing { font-size: 10px; color: #185fa5; flex-shrink: 0; }
.pb-paper__ops { display: flex; gap: 6px; padding: 0 8px 6px 8px; }
.pb-paper__ops button {
  border: 0; background: transparent; padding: 0; font-size: 11px; color: #666; cursor: pointer;
}
.pb-paper__ops button:hover { color: #185fa5; text-decoration: underline; }
.pb-paper__ops button.is-danger:hover { color: #a32d2d; }

/* ── 中：题目区 ── */
.pb-col--questions { min-width: 0; }
.pb-summary { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.pb-summary strong { font-size: 13px; }
.pb-summary span { font-size: 11px; color: #888; }
.pb-loading { padding: 12px 0; display: grid; gap: 12px; }
.pb-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.pb-row {
  display: flex; gap: 10px; align-items: flex-start;
  background: #fff; border: 1px solid #ebe9e4; border-radius: 10px;
  padding: 12px 14px;
}
.pb-row:hover { border-color: #d9d5cc; }
.pb-row.is-selected { border-color: #a9b4f0; background: #fbfbff; }
.pb-row__check { margin-top: 2px; flex-shrink: 0; }
.pb-row__body { flex: 1; min-width: 0; }
.pb-row__head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 5px; }
.pb-row__num { font-weight: 500; font-size: 13px; white-space: nowrap; }
.pb-row__paper { font-size: 11px; color: #999; margin-left: auto; }
.pb-row__type { font-size: 11px; color: #555; background: #f1efe8; border-radius: 4px; padding: 0 5px; }
.pb-tag { font-size: 11px; color: #993c1d; background: #faece7; border: 1px solid #f0997b; border-radius: 4px; padding: 0 5px; }
.pb-row__diff { color: #f59e0b; font-size: 11px; letter-spacing: 1px; }
.pb-row__stem {
  font-size: 13px; line-height: 1.75; color: #444;
  padding: 6px 8px; background: #faf9f6; border-left: 2px solid #ddd9d0; border-radius: 4px;
  margin-bottom: 4px;
}
.pb-row__text { font-size: 13px; line-height: 1.75; word-break: break-word; }
.pb-row__opts { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 12.5px; color: #444; margin-top: 5px; }
.pb-opt { display: inline-flex; align-items: baseline; gap: 2px; }
.pb-row__answer { display: flex; align-items: baseline; gap: 4px; font-size: 12px; color: #4f46e5; margin-top: 5px; }
.pb-row__answer-label { color: #888; }
.pb-row__answer em { color: #993c1d; font-style: normal; }
.pb-row__answer em.is-warn { color: #a32d2d; font-weight: 500; }
.pb-row__answer.is-empty { color: #bbb; }
.pb-row__foot { display: flex; gap: 12px; margin-top: 6px; }
.pb-link { border: 0; background: transparent; padding: 0; font-size: 11px; color: #8a8a8a; cursor: pointer; text-decoration: none; }
.pb-link:hover { color: #185fa5; text-decoration: underline; }
.pb-editor { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ececec; }
.pb-editor label { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #777; }
.pb-editor select, .pb-editor input {
  font-size: 12px; padding: 3px 6px; border: 1px solid #ddd; border-radius: 5px; background: #fff;
}
.pb-editor__tags input { width: 190px; }
.pb-editor__hint { font-size: 10px; color: #aaa; }
.pb-row__thumb { width: 116px; max-height: 116px; object-fit: contain; border: 1px solid #eee; border-radius: 6px; flex-shrink: 0; }
.pb-more {
  width: 100%; padding: 10px; border: 1px dashed #ddd; border-radius: 8px;
  background: #fff; color: #666; font-size: 12px; cursor: pointer;
}
.pb-more:hover { border-color: #a9b4f0; color: #185fa5; }

/* ── 右：试题篮 ── */
.pb-col--basket { position: sticky; top: 12px; }
.pb-basket { background: #fff; border: 1px solid #e4e1d8; border-radius: 10px; padding: 12px; }
.pb-basket__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.pb-basket__head strong { font-size: 13px; }
.pb-basket__head span { font-size: 11px; color: #666; }
.pb-basket__dist { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: #777; margin-bottom: 6px; }
.pb-basket__warn { font-size: 11px; color: #993c1d; background: #fdf3ee; border-radius: 5px; padding: 4px 6px; margin-bottom: 6px; line-height: 1.5; }
.pb-basket__list { max-height: 42vh; overflow-y: auto; margin: 0 -4px 8px; padding: 0 4px; }
.pb-bk-block__head { font-size: 11px; color: #555; font-weight: 500; margin: 8px 0 4px; }
.pb-bk-item { display: flex; align-items: center; gap: 4px; font-size: 11.5px; padding: 3px 0; }
.pb-bk-item__no { font-weight: 500; min-width: 26px; }
.pb-bk-item__src { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #999; font-size: 10.5px; }
.pb-bk-item__score {
  width: 42px; font-size: 11px; padding: 2px 3px; text-align: right;
  border: 1px solid #ddd; border-radius: 4px;
}
.pb-bk-item__unit { font-size: 10px; color: #aaa; }
.pb-bk-item__op { border: 0; background: transparent; color: #999; font-size: 12px; cursor: pointer; padding: 0 1px; }
.pb-bk-item__op:hover { color: #185fa5; }
.pb-bk-item__op.is-danger:hover { color: #a32d2d; }
.pb-basket__form { border-top: 1px solid #f0ede6; padding-top: 8px; }
.pb-field { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #777; margin-bottom: 6px; }
.pb-field input { flex: 1; min-width: 0; font-size: 12px; padding: 4px 7px; border: 1px solid #ddd; border-radius: 5px; }
.pb-check { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #777; margin-bottom: 8px; }
.pb-basket__actions { display: flex; flex-direction: column; gap: 6px; }
.pb-basket__empty { font-size: 11.5px; color: #999; line-height: 1.8; padding: 10px 2px; }

.pb-hint { font-size: 13px; color: #666; line-height: 1.7; margin-bottom: 12px; }
.pb-upload-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.pb-picked { font-size: 12px; color: #666; }
</style>
