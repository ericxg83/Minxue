<template>
  <div class="paper-bank wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学资源 / 题库"
        title="试卷题库"
        description="左边挑题，右边卷子实时长出来；不想要的题直接在卷面上叉掉"
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

      <div
        class="pb-layout"
        :style="{
          '--pw': previewWidth + 'px',
          ...(narrow ? { paddingBottom: paperCollapsed ? '62px' : 'calc(46vh + 18px)' } : {}),
        }"
      >
        <!-- 左：卷列表 -->
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
            <p>① 左侧选卷 → ② 中间勾题 → ③ 右边卷子实时变；不满意在卷面上叉掉。</p>
            <p>改分值：点卷面上的「4 分」。卷子太窄就拖右边框或点全屏。</p>
          </div>
        </aside>

        <!-- 中：题目区 -->
        <main class="pb-col pb-col--questions">
          <FilterBar class="pb-filter">
            <template #leading>
              <div class="pb-summary">
                <strong>{{ questions.length }}{{ truncated ? '+' : '' }} 道题</strong>
                <span>已选 {{ summary.count }} 题</span>
              </div>
            </template>
            <WorkbenchSelect v-model="filterType" :options="typeFilterOptions" width="100px" aria-label="按题型筛选" />
            <WorkbenchSelect v-model="filterDifficulty" :options="difficultyFilterOptions" width="100px" aria-label="按难度筛选" />
            <WorkbenchSelect v-model="filterTag" :options="tagFilterOptions" width="96px" aria-label="按标签筛选" />
            <WorkbenchInput v-model="filterQuestionNos" clearable placeholder="题号 19,24" width="112px" aria-label="按题号筛选" />
            <WorkbenchInput v-model="filterKeyword" clearable placeholder="搜索题干" width="124px" aria-label="搜索题干" />
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

        <!-- 右：试卷（常驻，勾题即长出来；每题可删、分值可点改） -->
        <aside
          class="pb-col pb-col--paper"
          :class="{
            'is-full': paperFull,
            'is-fixed': narrow && !paperFull,
            'is-collapsed': paperCollapsed && !paperFull,
          }"
          :style="narrow && !paperFull ? fixedStyle : null"
        >
          <div class="pb-drag" title="拖动调整卷面宽度" @mousedown="startDrag" />

          <div class="pb-paper-panel">
            <div class="pb-paper-panel__head">
              <button
                v-if="narrow"
                type="button"
                class="pb-icon-btn"
                :title="paperCollapsed ? '展开卷面' : '收起卷面'"
                @click="paperCollapsed = !paperCollapsed"
              >{{ paperCollapsed ? '▴' : '▾' }}</button>
              <div class="pb-tabs">
                <button
                  v-for="t in PREVIEW_TABS"
                  :key="t.key"
                  type="button"
                  class="pb-tab"
                  :class="{ 'is-active': previewKind === t.key }"
                  @click="switchPreviewKind(t.key)"
                >{{ t.label }}</button>
              </div>
              <div class="pb-paper-panel__ops">
                <span class="pb-paper-panel__meta">{{ paperMeta }}</span>
                <button type="button" class="pb-icon-btn" title="缩小" @click="setZoom(-0.1)">−</button>
                <button type="button" class="pb-icon-btn pb-icon-btn--pct" title="恢复「适应宽度」" @click="fitZoom(true)">
                  {{ Math.round(zoom * 100) }}%
                </button>
                <button type="button" class="pb-icon-btn" title="放大" @click="setZoom(0.1)">＋</button>
                <button type="button" class="pb-icon-btn" :title="paperFull ? '还原' : '全屏看卷子'" @click="paperFull = !paperFull">
                  {{ paperFull ? '⤡' : '⤢' }}
                </button>
              </div>
            </div>

            <div class="pb-paper-panel__form">
              <label class="pb-field">
                <span>卷名</span>
                <input v-model="composeTitle" placeholder="如：周末练习（三）" />
              </label>
              <label class="pb-check"><input v-model="composeWithImage" type="checkbox" />印原题图</label>
              <button type="button" class="pb-link" :disabled="!summary.count" @click="clearBasket">清空</button>
              <el-button type="primary" size="small" :loading="downloading" :disabled="!summary.count" @click="downloadPdf">
                下载 PDF
              </el-button>
            </div>

            <div ref="stageRef" class="pb-paper-panel__stage">
              <iframe
                v-show="summary.count"
                ref="previewFrame"
                class="pb-paper-panel__frame"
                title="卷面预览"
                sandbox="allow-same-origin allow-scripts"
              />
              <div v-if="!summary.count" class="pb-paper-panel__blank">
                <p>勾选的题会实时出现在这里</p>
                <span>卷面可滚动；题目上悬停出现 × 可以删掉</span>
              </div>
              <div v-if="repainting && summary.count" class="pb-paper-panel__mask">
                <span class="pb-spinner" aria-hidden="true"></span>
                <span>重排中…</span>
              </div>
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Plus, UploadFilled, Search, Tickets } from '@element-plus/icons-vue'
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
  addBasketItem,
  removeBasketItem,
  setBasketItemScore,
  isInBasket,
  groupBasket,
  basketSummary,
  composePaperTotals,
  composePaperFilename,
} from '../../utils/paperBasket'
import { renderCustomBodyToHTML, exportServerPDF, paintPreviewIntoIframe } from '../../utils/serverPdfExporter'
import { ossThumbUrl } from '../../utils/ossThumb'

const PAGE_SIZE = 200

const papers = ref([])
const questions = ref([])
const loading = ref(false)
const creating = ref(false)
const uploading = ref(false)
const truncated = ref(false)
const limit = ref(PAGE_SIZE)

const filterPaper = ref('all')
const filterQuestionNos = ref('')
const filterType = ref('all')
const filterDifficulty = ref('all')
const filterTag = ref('all')
const filterKeyword = ref('')
const tagOptions = ref([])

// 试题篮（前端状态，不落库）。卷面就是篮子 —— 不再有单独的篮子面板。
const basket = ref([])
const composeTitle = ref('')
const composeWithImage = ref(false)
const editingId = ref('')

// 右侧卷面（常驻，和题目列表同一页）
const previewKind = ref('student')
const previewFrame = ref(null)
const stageRef = ref(null)
const zoom = ref(1)
const userZoomed = ref(false)
const previewPages = ref(0)
const repainting = ref(false)
const downloading = ref(false)
const paperFull = ref(false)
// 窄屏（≤1239px）放不下「列表 + 可读的卷面」并排 ⇒ 卷面改成整宽的底部常驻面板，可收起。
const narrow = ref(false)
const paperCollapsed = ref(false)
// 卷面栏初始宽度：按窗口宽度取，窄屏别把题目列表挤死（老师随时可拖宽）
const previewWidth = ref(Math.round(Math.min(620, Math.max(560, (window.innerWidth || 1440) * 0.30))))
const PREVIEW_TABS = [
  { key: 'student', label: '练习卷' },
  { key: 'teacher', label: '教师卷' },
  { key: 'handout', label: '讲义' },
]

// 预览舞台样式（注入 iframe 文档）：灰底 + 居中白纸 + 每题悬停出现「×」、分值可点改。
// ⛔ 灰底/阴影/删除按钮绝不能写进 buildPaperCSS —— 那是打印样式，纸上不该有这些。
const PREVIEW_STAGE_CSS = `
html,body{background:#e6e4de}
body{padding:14px 0 28px}
.page{background:#fff;margin:0 auto;box-shadow:0 1px 10px rgba(0,0,0,.14)}
.question{position:relative}
.question > .pb-del{
  position:absolute;right:0;top:0;width:18px;height:18px;line-height:16px;padding:0;
  border:1px solid #E6C9C9;background:#fff;color:#B4436C;border-radius:50%;
  font-size:12px;cursor:pointer;opacity:0;transition:opacity .12s;
}
.question:hover > .pb-del{opacity:1}
.question > .pb-del:hover{background:#FDECEF;border-color:#D4537E}
.q-score{cursor:pointer;border-bottom:1px dashed #C9C6BE}
.q-score:hover{color:#185FA5;border-bottom-color:#185FA5}
.pb-score-input{width:46px;font-size:11px;padding:0 3px;border:1px solid #185FA5;border-radius:3px;text-align:right}
.question-group:has(> .question:hover) .q-stem{background:#fbfbfd}
`

const showCreateDialog = ref(false)
const showUploadDialog = ref(false)
const createForm = ref({ name: '', grade: '', subject: '数学', examDate: null })
const uploadPaperId = ref('')
// 'questions' = 题目 PDF/照片（进 resource_questions）；'answers' = 官方答案（进答案库）
const uploadMode = ref('questions')
const pickedFiles = ref([])
const fileInput = ref(null)

let pollTimer = null
let repaintTimer = null
let repaintToken = 0

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
// 组卷不提供手动排序：卷面按题型分大题，同题型内保持勾选顺序。
// moveBasketItem 仍留在 paperBasket.js（有回归锁），需要时再接 UI。
// 改分统一走卷面上点「4 分」→ beginScoreEdit → setBasketItemScore。
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
      `确定删除「${p.name}」及它的 ${p.question_count || 0} 道题？卷面上的题也会一起消失。`,
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

// ── 卷面（常驻，basket 一变就重排）──
//
// 排版动作复用 paintPreviewIntoIframe —— 与「导出 PDF」共用同一个 paintDocument，
// 同一份 bodyHtml + 同一个 buildPaperCSS，所以预览和下载不会各排一套。
// 下载仍走服务端 Chromium（矢量、字体、分页都对），点下载才生成。

/** 按版本产出 bodyHtml + 专属样式 + 文件名（预览与下载共用）。 */
const buildPaperHtml = (kind) => {
  if (kind === 'handout') {
    const groups = groupHandoutQuestions(basket.value.slice())
    // 讲义版式：保留原卷题号、按卷分组（⛔ 不复用组卷版式，那套会重排重编号）
    const title = groups.length === 1 ? `${groups[0].paperName} 讲题讲义` : `${groups.length} 套卷 讲题讲义`
    return {
      bodyHtml: buildHandoutBody({ title, groups, showAnswers: true, showImage: composeWithImage.value }),
      extraCss: buildHandoutCSS(),
      filename: title,
    }
  }
  const withAnswers = kind === 'teacher'
  return {
    bodyHtml: buildComposePaperBody({
      title: composeTitle.value,
      subtitle: composeSubtitle(),
      blocks: blocks.value,
      showAnswers: withAnswers,
      showImage: composeWithImage.value,
    }),
    extraCss: buildComposePaperCSS(),
    filename: composePaperFilename(composeTitle.value, totals.value.questionCount, todayStr())
      + (withAnswers ? '_教师卷' : ''),
  }
}

const applyZoom = () => {
  const doc = previewFrame.value?.contentDocument
  if (doc?.body) doc.body.style.zoom = String(zoom.value)
}

/**
 * 适应宽度：A4 卷面固定 794px，右栏一窄就被横向裁掉右半边（分值、选项全看不见）。
 * 所以默认按容器宽度算比例；老师手动缩放过就不再自动覆盖。
 * @param {boolean} [force] 点百分比数字时强制回到适应宽度
 */
const fitZoom = (force = false) => {
  if (userZoomed.value && !force) return
  if (force) userZoomed.value = false
  const box = stageRef.value?.clientWidth || 0
  if (!box) return
  const z = Math.min(1, Math.max(0.35, Math.round(((box - 22) / 794) * 100) / 100))
  zoom.value = z
  applyZoom()
}

const setZoom = (delta) => {
  userZoomed.value = true
  zoom.value = Math.min(1.6, Math.max(0.3, Math.round((zoom.value + delta) * 10) / 10))
  applyZoom()
}

/**
 * 给卷面注入「就地编辑」能力：
 *   · 每题右上角一个 ×（悬停出现）→ 移出卷子；
 *   · 「4 分」点一下变输入框 → 改分值。
 * 为什么注入而不是把按钮做进 composePaperPdf：那份 HTML 同时用于**打印**，
 * 打印件上不能出现删除按钮和输入框。交互只属于预览这一侧。
 */
const decoratePaper = (doc) => {
  if (!doc) return
  doc.querySelectorAll('.question[data-qid]').forEach((el) => {
    const id = el.getAttribute('data-qid')
    if (!id) return

    if (!el.querySelector(':scope > .pb-del')) {
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = 'pb-del'
      btn.textContent = '×'
      btn.title = '从卷子移出这道题'
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onRemove(id) })
      el.appendChild(btn)
    }

    const score = el.querySelector('.q-score')
    if (score && !score.dataset.bound) {
      score.dataset.bound = '1'
      score.title = '点一下改分值'
      score.addEventListener('click', () => beginScoreEdit(doc, id, score))
    }
  })
}

const beginScoreEdit = (doc, id, span) => {
  if (span.querySelector('input')) return
  const cur = String(parseFloat(String(span.textContent || '').replace(/[^\d.]/g, '')) || 0)
  const input = doc.createElement('input')
  input.type = 'number'
  input.min = '0'
  input.step = '0.5'
  input.value = cur
  input.className = 'pb-score-input'
  const text = span.textContent
  span.textContent = ''
  span.appendChild(input)
  input.focus()
  input.select()

  let done = false
  const restore = () => {
    // 提交后卷面会整体重排，这里的 DOM 会被替换；只有取消时才需要还原
    if (done) return
    done = true
    span.textContent = text
  }
  const commit = () => {
    if (done) return
    done = true
    basket.value = setBasketItemScore(basket.value, id, input.value)
  }
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    if (e.key === 'Escape') { e.preventDefault(); done = true; restore() }
  })
}

/** 真正重排一次。用 token 丢弃过期结果（连续删题时只认最后一次）。 */
const repaintPreview = async () => {
  if (!basket.value.length) {
    // 删空要立刻把「约 N 页」清掉，否则会残留上一次的页数
    repaintToken++
    repainting.value = false
    previewPages.value = 0
    return
  }
  const token = ++repaintToken
  repainting.value = true
  const keepScroll = previewFrame.value?.contentDocument?.documentElement?.scrollTop || 0
  try {
    const { bodyHtml, extraCss } = buildPaperHtml(previewKind.value)
    await nextTick()
    const doc = await paintPreviewIntoIframe(previewFrame.value, {
      bodyHtml,
      extraCss: `${extraCss}\n${PREVIEW_STAGE_CSS}`,
    })
    if (token !== repaintToken) return // 已经有更新的一次重排在跑，这次结果作废
    decoratePaper(doc)
    fitZoom() // 先按容器算比例（用户手动缩放过则跳过）
    // 改一题就把卷面滚回顶部很难用：保持原来的阅读位置
    if (keepScroll) doc.documentElement.scrollTop = keepScroll
    // scrollHeight 是**布局像素**，不受 zoom 影响，所以页数始终按 A4=1123px 算
    const h = doc?.body?.scrollHeight || 0
    previewPages.value = h ? Math.max(1, Math.ceil(h / 1123)) : 0
  } catch (e) {
    if (token === repaintToken) ElMessage.error(e?.payload?.message || e.message || '卷面渲染失败')
  } finally {
    if (token === repaintToken) repainting.value = false
  }
}

/** 防抖：连续勾/删几题只重排一次。 */
const scheduleRepaint = (delay = 200) => {
  clearTimeout(repaintTimer)
  repaintTimer = setTimeout(() => { repaintPreview() }, delay)
}

const switchPreviewKind = (kind) => {
  if (previewKind.value === kind) return
  previewKind.value = kind
  repaintToken++ // 让在跑的那次作废（版式都换了）
  repaintPreview()
}

// ── 拖拽调宽（卷面太窄看不清时自己拉）──
const startDrag = (ev) => {
  ev.preventDefault()
  const startX = ev.clientX
  const startW = previewWidth.value
  const onMove = (e) => {
    const next = Math.min(Math.max(startW + (startX - e.clientX), 320), 920)
    previewWidth.value = next
    fitZoom(true)
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    fitZoom(true)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 窄屏：卷面改成整宽底部常驻面板。left 要避开左侧导航，所以实测容器左边界。
const paperLeft = ref(0)
const measureLeft = () => {
  const el = document.querySelector('.paper-bank .wb-page__inner') || document.querySelector('.paper-bank')
  if (el) paperLeft.value = Math.max(0, Math.round(el.getBoundingClientRect().left))
}
const fixedStyle = computed(() => ({ left: `${paperLeft.value}px`, right: '12px' }))

const onWindowResize = () => {
  narrow.value = window.innerWidth <= 1499
  measureLeft()
  fitZoom()
}

const downloadPdf = async () => {
  if (!basket.value.length) return
  downloading.value = true
  try {
    const { bodyHtml, extraCss, filename } = buildPaperHtml(previewKind.value)
    const html = await renderCustomBodyToHTML({ bodyHtml, extraCss })
    await exportServerPDF({
      html,
      filename,
      // 讲义不印页码（按卷分组的讲题稿，页码没意义）
      pageNumbers: previewKind.value !== 'handout',
    })
    ElMessage.success(`已生成：${filename}.pdf`)
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '生成 PDF 失败')
  } finally {
    downloading.value = false
  }
}

const paperMeta = computed(() => {
  if (repainting.value) return '重排中…'
  if (!summary.value.count) return '还没有题'
  const pages = previewPages.value ? `约 ${previewPages.value} 页` : ''
  if (previewKind.value === 'handout') {
    return [`${summary.value.count} 题`, '原卷题号', pages].filter(Boolean).join(' · ')
  }
  return [`${summary.value.count} 题`, `${summary.value.totalScore} 分`, pages].filter(Boolean).join(' · ')
})

// basket 任何变化（勾/删/改分）都自动重排 —— 这就是「同一页面里实时预览」
watch(basket, () => { scheduleRepaint() }, { deep: true })
watch([composeTitle, composeWithImage], () => { scheduleRepaint(300) })
watch(paperFull, async () => { await nextTick(); fitZoom(true) })

watch([filterType, filterDifficulty, filterTag], () => { limit.value = PAGE_SIZE; loadQuestions() })
watch([filterQuestionNos, filterKeyword], () => { limit.value = PAGE_SIZE; loadQuestions() })

const onKeydown = (e) => {
  if (e.key === 'Escape' && paperFull.value) paperFull.value = false
}

onMounted(async () => {
  narrow.value = window.innerWidth <= 1499
  loading.value = true
  try {
    await loadPapers()
    await loadQuestions()
    if (!composeTitle.value.trim()) composeTitle.value = '组卷练习'
    if (anyParsing()) startPolling()
  } finally {
    loading.value = false
  }
  await nextTick()
  measureLeft()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  stopPolling()
  clearTimeout(repaintTimer)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
/* ── 三栏：卷列表 | 题目 | 卷面（常驻） ── */
.pb-layout {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr) var(--pw, 560px);
  gap: 12px;
  align-items: start;
}
@media (max-width: 1500px) {
  .pb-layout { grid-template-columns: 176px minmax(0, 1fr) min(var(--pw, 560px), 34vw); gap: 10px; }
}
/* 窄屏放不下「题目列表 + 能看清的卷面」并排：卷面改成整宽的底部常驻面板（同一页，可收起） */
@media (max-width: 1499px) {
  .pb-layout {
    grid-template-columns: 150px minmax(0, 1fr);
    grid-template-areas: 'papers questions' 'paper paper';
    row-gap: 10px;
    padding-bottom: 8px;
  }
  .pb-col--papers { grid-area: papers; }
  .pb-col--questions { grid-area: questions; }
  .pb-col--paper {
    grid-area: paper;
    position: relative;
    z-index: 6;
    height: clamp(260px, 46vh, 620px);
  }
  .pb-col--paper.is-fixed {
    position: fixed;
    /* ⛔ 必须显式 top:auto：基础规则里 .pb-col--paper 有 top:12px，
       fixed 下同时给 top 和 bottom 会变成「贴顶」，底部常驻就跑到页面上去了 */
    top: auto;
    bottom: 8px;
    z-index: 1200;
    height: clamp(260px, 46vh, 620px);
  }
  .pb-col--paper.is-collapsed { height: 42px; min-height: 0; }
  .pb-col--paper.is-collapsed .pb-paper-panel__form,
  .pb-col--paper.is-collapsed .pb-paper-panel__stage { display: none; }
  .pb-col--paper .pb-paper-panel {
    height: 100%;
    min-height: 0;
    box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.10);
  }
  .pb-drag { display: none; }
  .pb-panel--tip { display: none; }
}

/* 左：卷列表 */
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

/* 中：题目区 */
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
.pb-link:disabled { color: #ccc; cursor: default; text-decoration: none; }
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

/* 右：卷面面板 */
.pb-col--paper { position: sticky; top: 12px; min-width: 0; }
.pb-col--paper.is-full {
  position: fixed; inset: 12px; z-index: 2100;
  background: #fff; border-radius: 12px; border: 1px solid #e4e1d8;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  padding: 10px; display: flex;
}
.pb-drag {
  position: absolute; left: -7px; top: 0; bottom: 0; width: 12px;
  cursor: col-resize; z-index: 3;
}
.pb-drag::after {
  content: ''; position: absolute; left: 5px; top: 50%; width: 2px; height: 42px;
  margin-top: -21px; border-radius: 2px; background: #dcd9d0;
}
.pb-drag:hover::after { background: #185fa5; }
.pb-col--paper.is-full .pb-drag { display: none; }

.pb-paper-panel {
  background: #fff; border: 1px solid #e4e1d8; border-radius: 10px;
  display: flex; flex-direction: column; overflow: hidden;
  height: calc(100vh - 190px); min-height: 420px;
}
.pb-col--paper.is-full .pb-paper-panel { flex: 1; height: auto; border: 0; border-radius: 0; }

.pb-paper-panel__head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px; border-bottom: 1px solid #f0ede6;
}
.pb-tabs { display: flex; gap: 2px; }
.pb-tab {
  border: 0; background: transparent; padding: 4px 8px; border-radius: 6px;
  font-size: 12px; color: #666; cursor: pointer;
}
.pb-tab:hover { background: #f5f4f0; }
.pb-tab.is-active { background: #eef2ff; color: #185fa5; font-weight: 500; }
.pb-paper-panel__ops { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.pb-paper-panel__meta { font-size: 11px; color: #888; margin-right: 4px; white-space: nowrap; }
.pb-icon-btn {
  width: 22px; height: 22px; border: 1px solid #e2e0da; background: #fff;
  border-radius: 5px; cursor: pointer; line-height: 1; color: #555; font-size: 12px;
}
.pb-icon-btn:hover { border-color: #185fa5; color: #185fa5; }
.pb-icon-btn--pct { width: 44px; border-color: transparent; background: transparent; }
.pb-icon-btn--pct:hover { border-color: #e2e0da; }

.pb-paper-panel__form {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-bottom: 1px solid #f0ede6; background: #fbfaf7;
}
.pb-field { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #777; flex: 1; min-width: 0; }
.pb-field input { flex: 1; min-width: 0; font-size: 12px; padding: 3px 7px; border: 1px solid #ddd; border-radius: 5px; }
.pb-check { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #777; white-space: nowrap; }

.pb-paper-panel__stage { position: relative; flex: 1; min-height: 0; background: #e6e4de; }
.pb-paper-panel__frame { width: 100%; height: 100%; border: 0; background: transparent; display: block; }
.pb-paper-panel__blank {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; color: #999; font-size: 13px;
}
.pb-paper-panel__blank span { font-size: 11.5px; color: #aaa; }
.pb-paper-panel__mask {
  position: absolute; top: 8px; right: 8px;
  display: flex; align-items: center; gap: 6px;
  background: rgba(255, 255, 255, 0.92); border: 1px solid #e2e0da; border-radius: 14px;
  padding: 3px 10px 3px 6px; font-size: 11px; color: #666; pointer-events: none;
}
.pb-spinner {
  width: 12px; height: 12px; border: 2px solid #ddd; border-top-color: #185fa5;
  border-radius: 50%; animation: pb-spin 0.8s linear infinite;
}
@keyframes pb-spin { to { transform: rotate(360deg); } }

.pb-hint { font-size: 13px; color: #666; line-height: 1.7; margin-bottom: 12px; }
.pb-upload-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.pb-picked { font-size: 12px; color: #666; }
</style>
