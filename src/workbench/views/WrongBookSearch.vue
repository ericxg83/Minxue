<template>
  <div class="wb-page wb-page--workspace">
    <div class="wb-page__inner wq-search-inner">
      <PageHeader
        eyebrow="教学工作"
        title="错题管理"
        description="两个用途：按关键字跨学生找一道错题去修；或按知识点把全班的错题组成一张专项训练卷。"
      />

      <el-radio-group v-model="mode" class="mode-switch" size="default">
        <el-radio-button value="search">搜索错题</el-radio-button>
        <el-radio-button value="build">按知识点组卷</el-radio-button>
      </el-radio-group>

      <!-- ═══════════ 模式一：搜索错题（原有能力，2026-10-13 补参考答案与来源标注）═══════════ -->
      <template v-if="mode === 'search'">
        <section class="search-bar">
          <WorkbenchInput
            v-model="query"
            clearable
            placeholder="例如：相似三角形 / 比例中项 / 二次根式…"
            aria-label="按关键字搜索错题"
            @update:model-value="onInput"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </WorkbenchInput>
          <div class="search-meta" aria-live="polite">
            <template v-if="query.trim()">
              <span v-if="loading">搜索中…</span>
              <span v-else-if="total > 0">共 {{ total }} 条{{ truncated ? `，仅显示前 ${items.length} 条（换个更具体的关键字）` : '' }}</span>
              <span v-else>没有匹配的错题</span>
            </template>
            <span v-else>不用先选学生，直接输题目里的词就能搜</span>
          </div>
        </section>

        <section v-if="items.length" class="result-list">
          <article v-for="item in items" :key="item.id" class="result-card">
            <div class="result-main">
              <p class="stem">{{ stemOf(item) }}</p>
              <!-- 参考答案 + 来源签（2026-10-13 错题管理扩展 M1）：
                   老师最怕「AI 猜的答案被当成标准答案」，所以答案必须显示，
                   且必须标出它是练习册答案库给的还是 AI 自动求解的。
                   来源判定唯一收敛在 reviewDecision.js#getReferenceAnswerOrigin，
                   本页只消费它的 label/tone/hint，不自行判断。 -->
              <div class="answer-line">
                <span class="answer-label">参考答案</span>
                <span v-if="item.correct_answer" class="answer-text">{{ answerOf(item) }}</span>
                <span v-else class="answer-missing">未录入</span>
                <StatusTag
                  v-if="originOf(item)"
                  :tone="originOf(item).tone"
                  :label="originOf(item).label"
                  :dot="false"
                  :title="originOf(item).hint"
                />
              </div>
              <div class="meta">
                <span class="student">{{ item.student_name || '未知学生' }}</span>
                <span class="sep">·</span>
                <StatusTag :tone="lcOf(item).tone" :label="lcOf(item).label" />
                <template v-if="(item.error_count || 1) > 1">
                  <span class="sep">·</span>
                  <span class="err">错过 {{ item.error_count }} 次</span>
                </template>
                <span class="sep">·</span>
                <span class="time">{{ formatDate(item.added_at) }}</span>
              </div>
            </div>
            <div class="result-action">
              <ActionButton
                v-if="item.question_id && item.task_id"
                variant="primary"
                @click="goEditOriginal(item)"
              >去原卷编辑</ActionButton>
              <span v-else class="no-origin">无原卷档案，无法定位</span>
            </div>
          </article>
        </section>

        <section v-else-if="!loading" class="empty-hint">
          <EmptyState
            :icon="Reading"
            :title="query.trim() ? '没有匹配的错题' : '输入关键字开始检索'"
            :description="query.trim()
              ? '试试更短的关键字，比如只输题目里的一个词。'
              : '不用先选学生，直接搜题干；想按答案找题也可以搜答案里的关键字。'"
          />
        </section>
      </template>

      <!-- ═══════════ 模式二：按知识点组卷（2026-10-13 新增 M4）═══════════
           三栏：知识点 → 候选题（按共错人数降序）→ 组卷篮（备课预览 / 出两个版本）
           数据全部来自考法库已有接口（kp-ranking / kp-questions），后端无新增聚合。
           ⛔ 这是「班级卷」：不落 generated_exams、不带批改二维码，只出 PDF。 -->
      <section v-else class="paper-builder">
        <aside class="pane kp-pane">
          <header class="pane-head">
            <h3>知识点</h3>
            <WorkbenchSelect
              v-model="kpDays"
              :options="daysOptions"
              width="92px"
              aria-label="统计时段"
              @change="loadKpRanking"
            />
          </header>
          <div v-if="kpLoading" class="pane-body"><el-skeleton :rows="6" animated /></div>
          <div v-else-if="!kpNodes.length" class="pane-body">
            <EmptyState :icon="Reading" title="近期没有错题" description="换个更长的时间段看看。" />
          </div>
          <div v-else class="pane-body kp-list">
            <button
              v-for="kp in kpNodes"
              :key="kp.id"
              type="button"
              :class="['kp-row', { active: selectedKpId === kp.id }]"
              :style="{ paddingLeft: `${10 + (kp.level || 0) * 14}px` }"
              @click="selectKp(kp)"
            >
              <span class="kp-name">{{ kp.name }}</span>
              <span class="kp-count">{{ kp.wrong_count }}</span>
            </button>
          </div>
        </aside>

        <section class="pane cand-pane">
          <header class="pane-head">
            <h3>候选题{{ candScope ? ` · ${candScope}` : '' }}</h3>
            <span class="pane-hint">{{ candidates.length }} 道 · 按共错人数排序</span>
          </header>
          <div v-if="!selectedKpId" class="pane-body">
            <EmptyState :icon="Reading" title="先选一个知识点" description="左边点一个考点，这里会列出全班在这个考点上错过的题。" />
          </div>
          <div v-else-if="candLoading" class="pane-body"><el-skeleton :rows="6" animated /></div>
          <div v-else-if="!candidates.length" class="pane-body">
            <EmptyState :icon="Reading" title="这个考点暂时没有错题" description="换个知识点，或把时段调长一点。" />
          </div>
          <div v-else class="pane-body cand-list">
            <article
              v-for="q in candidates"
              :key="q.questionId"
              :class="['cand-row', { picked: isPicked(q.questionId) }]"
              @click="togglePick(q)"
            >
              <el-checkbox :model-value="isPicked(q.questionId)" @click.stop @change="togglePick(q)" />
              <div class="cand-main">
                <p class="cand-stem">{{ stemOfCandidate(q) }}</p>
                <div class="cand-meta">
                  <span class="cand-badge">{{ q.studentCount }} 人错过</span>
                  <span v-if="q.wrongCount > q.studentCount" class="cand-sub">共错 {{ q.wrongCount }} 次</span>
                  <span class="cand-students">{{ (q.students || []).join('、') }}</span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <aside class="pane basket-pane">
          <header class="pane-head">
            <h3>组卷篮 · {{ picked.length }} 题</h3>
            <button v-if="picked.length" type="button" class="link-btn" @click="picked = []">清空</button>
          </header>
          <div class="pane-body basket-list">
            <EmptyState
              v-if="!picked.length"
              :icon="Reading"
              title="还没选题目"
              description="从中间的候选里勾选，或点「取前 10 道」快速起一张卷。"
            />
            <template v-else>
              <div v-for="(q, i) in picked" :key="q.questionId" class="basket-row">
                <span class="basket-num">{{ i + 1 }}</span>
                <span class="basket-text">{{ stemOfCandidate(q, 26) }}</span>
                <button type="button" class="basket-remove" aria-label="移出组卷篮" @click="togglePick(q)">×</button>
              </div>
            </template>
          </div>
          <footer class="pane-foot">
            <ActionButton v-if="candidates.length" :disabled="!candidates.length" @click="takeTop(10)">取前 10 道</ActionButton>
            <ActionButton :disabled="!picked.length" @click="openPreview">备课预览</ActionButton>
            <ActionButton variant="primary" :disabled="!picked.length || !!exporting" :loading="exporting === 'student'" @click="exportPaper('student')">生成学生版</ActionButton>
            <ActionButton :disabled="!picked.length || !!exporting" :loading="exporting === 'teacher'" @click="exportPaper('teacher')">生成教师版</ActionButton>
            <p class="foot-note">
              学生版：留白作答，可当堂发。教师版：含参考答案（标来源）与解析，用于提前备课。
              两张都不带批改二维码 —— 这是「课上讲」的卷，不是给学生的作业。
            </p>
          </footer>
        </aside>
      </section>
    </div>

    <!-- 备课预览：导出前先在系统里连续看一遍（题目 + 答案 + 来源 + 解析 + 谁错了） -->
    <WorkbenchDialog v-model="previewVisible" title="备课预览" width="920px" top="4vh">
      <div class="preview-body">
        <p class="preview-tip">这是导出前在系统内的预览，不会生成文件。满意后再点「生成学生版 / 教师版」。</p>
        <article v-for="(q, i) in picked" :key="q.questionId" class="preview-q">
          <div class="preview-head">
            <span class="preview-num">{{ i + 1 }}</span>
            <span class="preview-badge">{{ q.studentCount }} 人错过</span>
            <span class="preview-students">{{ (q.students || []).join('、') }}</span>
          </div>
          <MathRender v-if="q.parentStem" class="preview-parent" :content="q.parentStem" auto-detect />
          <MathRender class="preview-stem" :content="q.content" auto-detect />
          <div v-if="optionsOf(q).length" class="preview-opts">
            <span v-for="(opt, oi) in optionsOf(q)" :key="oi" class="preview-opt">
              <MathRender :content="`${String.fromCharCode(65 + oi)}. ${opt}`" auto-detect tag="span" :force-inline="true" />
            </span>
          </div>
          <div class="preview-answer">
            <span class="preview-label">参考答案</span>
            <MathRender v-if="q.answer" class="preview-answer-text" :content="q.answer" auto-detect tag="span" :force-inline="true" />
            <span v-else class="preview-answer-missing">本卷未录入</span>
            <StatusTag
              v-if="originOfQ(q)"
              :tone="originOfQ(q).tone"
              :label="originOfQ(q).label"
              :dot="false"
              :title="originOfQ(q).hint"
            />
          </div>
          <div class="preview-analysis">
            <span class="preview-label">解析</span>
            <MathRender v-if="q.analysis" class="preview-analysis-text" :content="q.analysis" auto-detect tag="span" />
            <span v-else class="preview-answer-missing">暂无</span>
          </div>
        </article>
      </div>
      <template #footer>
        <ActionButton variant="ghost" @click="previewVisible = false">关闭</ActionButton>
        <ActionButton :disabled="!!exporting" :loading="exporting === 'student'" @click="exportPaper('student')">生成学生版</ActionButton>
        <ActionButton variant="primary" :disabled="!!exporting" :loading="exporting === 'teacher'" @click="exportPaper('teacher')">生成教师版</ActionButton>
      </template>
    </WorkbenchDialog>
  </div>
</template>

<script setup>
// ── 错题管理页（r260 起为跨学生检索；2026-10-13 扩展为「检索 + 组卷」双模式）──
//
// 模式一「搜索错题」：不预设学生，按关键字跨全库找题 → 去原卷编辑（原有链路不动）。
//   本轮新增：结果卡片显示参考答案 + 来源签（答案库 / AI 解答）。
// 模式二「按知识点组卷」：班级卷。按知识点（含章节层级，= 知识点树父节点递归展开）
//   把全班错题聚出来 → 老师勾选 → 备课预览 → 导出学生版 / 教师版。
//
// ⛔ 三条口径（勿改）：
//   1. 班级卷**不落 generated_exams**（该表按 student_id 归属，班级卷没有对应学生，
//      硬塞会污染「待批改」口径）。
//   2. 班级卷**不传 qrContent**（没有二维码 = 不进批改链路）。它是「课上讲」的卷，
//      不是给学生做、要拍照交的作业。
//   3. 答案来源判定唯一收敛在 reviewDecision.js#getReferenceAnswerOrigin，
//      本页与 PDF 渲染都只消费它，不各写一套。
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Reading, Search } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { searchWrongQuestions, getKpRanking, getKpQuestions } from '../../services/apiService'
import { exportWrongBookPDF } from '../../utils/wrongBookPdfExporter'
import { getReferenceAnswerOrigin } from '../../utils/reviewDecision'
import { normalizeOptions } from '../../utils/optionText'
import { debounce } from '../utils/performance'
import PageHeader from '../components/ui/PageHeader.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import WorkbenchDialog from '../components/ui/WorkbenchDialog.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import ActionButton from '../components/ui/ActionButton.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import MathRender from '../components/MathRender.vue'

const router = useRouter()
const mode = ref('search')

// ─────────────────────────── 模式一：搜索 ───────────────────────────
const query = ref('')
const items = ref([])
const total = ref(0)
const truncated = ref(false)
const loading = ref(false)

// 生命周期 → StatusTag 标准语义（warning=待处理 / info=进行中 / success=已达成）
const LC_MAP = {
  new: { label: '待掌握', tone: 'warning' },
  review_1: { label: '复习中', tone: 'info' },
  review_2: { label: '复习中', tone: 'info' },
  mastered: { label: '已掌握', tone: 'success' }
}
const lcOf = (item) => LC_MAP[item.lifecycle_status || 'new'] || LC_MAP.new
const stemOf = (item) => {
  const text = item.content || ''
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}
// 参考答案：过长截断，保证卡片高度稳定
const answerOf = (item) => {
  const text = item.correct_answer || ''
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
// 来源签：把搜索结果字段喂给唯一判定口径（getReferenceAnswerOrigin 读的是
// answer / answer_source 两个字段名，这里做一次字段名映射，不改判定逻辑）
const originOf = (item) => getReferenceAnswerOrigin({
  answer: item.correct_answer,
  answer_source: item.answer_source,
})
const formatDate = (d) => (d ? dayjs(d).format('MM-DD HH:mm') : '')

const doSearch = async () => {
  const q = query.value.trim()
  if (!q) { items.value = []; total.value = 0; truncated.value = false; return }
  loading.value = true
  try {
    const data = await searchWrongQuestions(q, { limit: 50 })
    items.value = data.items
    total.value = data.total
    truncated.value = data.truncated
  } catch (e) {
    console.error('错题检索失败:', e)
    ElMessage.error('检索失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
// 防抖 300ms，与错题本搜索同一节奏（wrongBookStore.debouncedSetSearch）
const debouncedSearch = debounce(doSearch, 300)
const onInput = () => { debouncedSearch() }

// 复用「去原题编辑」唯一链路（B1）：复核页 focusQuestionFromQuery 消费 ?q=
const goEditOriginal = (item) => {
  const studentId = item.student_id
  const taskId = item.task_id
  const questionId = item.question_id
  if (!studentId || !taskId || !questionId) {
    ElMessage.warning('这道题没有关联的原始作业，无法定位到原卷')
    return
  }
  // 与错题本详情同口径：不传 source（复核页不读它，source 只是批改中心的分流参数）
  router.push({ path: '/grade/task', query: { studentId, taskId, q: questionId } })
}

// ────────────────────── 模式二：按知识点组卷 ──────────────────────
const daysOptions = [
  { label: '近 14 天', value: 14 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
  { label: '全部', value: 180 },
]
const kpDays = ref(30)
const kpNodes = ref([])
const kpLoading = ref(false)
const selectedKpId = ref('')
const candScope = ref('')
const candidates = ref([])
const candLoading = ref(false)
const picked = ref([])
const previewVisible = ref(false)
const exporting = ref('')

const stemOfCandidate = (q, max = 78) => {
  const text = q.content || ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}
const optionsOf = (q) => normalizeOptions(q.options)
// 候选题的答案来源签：kp-questions 返回 camelCase（answerSource），
// 做一次字段名映射喂给唯一判定口径
const originOfQ = (q) => getReferenceAnswerOrigin({ answer: q.answer, answer_source: q.answerSource })
const isPicked = (id) => picked.value.some((q) => q.questionId === id)
const togglePick = (q) => {
  const idx = picked.value.findIndex((p) => p.questionId === q.questionId)
  if (idx >= 0) picked.value.splice(idx, 1)
  else picked.value.push(q)
}
const takeTop = (n) => {
  picked.value = candidates.value.slice(0, n)
}

const loadKpRanking = async () => {
  kpLoading.value = true
  try {
    const data = await getKpRanking({ days: kpDays.value, limit: 0 })
    // 只列「近期有错题」的考点：错题数 0 的节点对组卷没意义，
    // 全量铺开会把真正的候选项淹掉（考法库页同款处理）。
    kpNodes.value = (data.nodes || []).filter((n) => (n.wrong_count || 0) > 0)
    if (selectedKpId.value && !kpNodes.value.some((n) => n.id === selectedKpId.value)) {
      selectedKpId.value = ''
      candidates.value = []
      candScope.value = ''
    }
  } catch (e) {
    console.error('知识点排序加载失败:', e)
    ElMessage.error('知识点加载失败，请稍后重试')
  } finally {
    kpLoading.value = false
  }
}

const selectKp = async (kp) => {
  selectedKpId.value = kp.id
  candScope.value = kp.name || ''
  candLoading.value = true
  candidates.value = []
  try {
    // includeChildren=1：选父节点（≈章节）时递归展开到全部子孙；
    // onlyWrong=1：只拉有人错过的题（组卷只用错题，与「通用题库」划清界限）。
    const data = await getKpQuestions({
      kpId: kp.id,
      days: 0,
      limit: 200,
      includeChildren: true,
      onlyWrong: true,
    })
    // ⛔ 前端按「共错人数」重排：后端按错次排（wrong_count DESC），
    //   但「5 人各错 1 次」比「1 人错 5 次」更该全班讲。不改后端排序
    //   （kp-questions 同时被考法库页与周末班课件消费）。
    candidates.value = [...data.questions].sort(
      (a, b) => (b.studentCount || 0) - (a.studentCount || 0) || (b.wrongCount || 0) - (a.wrongCount || 0)
    )
    if (data.scope?.truncated) {
      ElMessage.info(`这个考点共 ${data.scope.totalMatched} 道错题，已显示前 ${data.questions.length} 道`)
    }
  } catch (e) {
    console.error('考点题目加载失败:', e)
    ElMessage.error(e?.message || '加载考点题目失败')
  } finally {
    candLoading.value = false
  }
}

const openPreview = () => {
  if (!picked.value.length) { ElMessage.warning('请先勾选题目'); return }
  previewVisible.value = true
}

// 出卷：学生版 = 留白作答；教师版 = 参考答案（带来源）+ 解析。
// ⛔ 两张都不传 qrContent（无二维码 → 不进批改链路），也不建 generated_exams。
const exportPaper = async (kind) => {
  if (!picked.value.length) { ElMessage.warning('请先勾选题目'); return }
  if (exporting.value) return
  exporting.value = kind
  const questionIds = picked.value.map((q) => q.questionId).filter(Boolean)
  const scopeName = candScope.value || '错题'
  const stamp = dayjs().format('YYYYMMDD')
  const title = `${scopeName} · 专项训练（${picked.value.length} 题）`
  const filename = `${scopeName}_专项训练_${kind === 'teacher' ? '教师版' : '学生版'}_${stamp}`
  try {
    const result = await exportWrongBookPDF({
      questionIds,
      title,
      filename,
      showAnswers: kind === 'teacher',
      showAnalysis: kind === 'teacher',
    })
    if (!result) { ElMessage.error('导出失败，请稍后重试'); return }
    ElMessage.success(
      kind === 'teacher'
        ? `教师版已生成（含参考答案与解析，共 ${questionIds.length} 题）`
        : `学生版已生成（留白作答，共 ${questionIds.length} 题）`
    )
  } catch (e) {
    console.error('组卷导出失败:', e)
    ElMessage.error(e?.message || '导出失败，请稍后重试')
  } finally {
    exporting.value = ''
  }
}

onMounted(() => {
  // WorkbenchInput 未暴露 focus；进页即聚焦搜索框是本页主任务的起点
  document.querySelector('.wq-search-inner .wb-input input')?.focus?.()
})

// 切到组卷模式时才拉知识点（懒加载：搜索模式下不需要这份数据）。
// 只在「还没加载过」时拉一次，来回切模式不会反复打接口。
watch(mode, (next) => {
  if (next === 'build' && !kpNodes.value.length && !kpLoading.value) loadKpRanking()
})
</script>

<style scoped>
.search-bar {
  margin-top: var(--wb-space-4);
}
.search-meta {
  margin-top: var(--wb-space-2);
  min-height: 18px;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}
.result-list {
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-3);
  margin-top: var(--wb-space-4);
}
.result-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-4);
  padding: var(--wb-space-4) var(--wb-space-5);
  background: var(--wb-bg-elevated, #fff);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  transition: border-color var(--wb-motion-fast) var(--wb-motion-ease);
}
.result-card:hover {
  border-color: var(--wb-primary);
}
.result-main {
  flex: 1;
  min-width: 0;
}
.stem {
  margin: 0;
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  line-height: var(--wb-lh-normal);
  white-space: pre-wrap;
  word-break: break-word;
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--wb-space-2);
  margin-top: var(--wb-space-2);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  flex-wrap: wrap;
}
/* 参考答案行：与题干同宽，答案文字用正文色，来源签紧随其后 */
.answer-line {
  display: flex;
  align-items: baseline;
  gap: var(--wb-space-2);
  margin-top: var(--wb-space-2);
  font-size: var(--wb-fs-meta);
  line-height: var(--wb-lh-normal);
}
.answer-label {
  flex: 0 0 auto;
  color: var(--wb-text-tertiary);
}
.answer-text {
  flex: 1;
  min-width: 0;
  color: var(--wb-text);
  word-break: break-word;
}
.answer-missing {
  flex: 1;
  color: var(--wb-text-tertiary);
}
.meta .student {
  color: var(--wb-text);
  font-weight: var(--wb-fw-semibold);
}
.meta .sep {
  color: var(--wb-text-tertiary);
}
.meta .time {
  color: var(--wb-text-tertiary);
}
.err {
  color: var(--wb-status-danger-fg);
}
.result-action {
  flex: 0 0 auto;
}
.no-origin {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}
.empty-hint {
  margin-top: var(--wb-space-6);
}

/* ── 模式二：组卷 ── */
.mode-switch {
  margin-top: var(--wb-space-4);
}
.paper-builder {
  display: grid;
  grid-template-columns: minmax(200px, 240px) minmax(0, 1fr) minmax(260px, 300px);
  gap: var(--wb-space-4);
  margin-top: var(--wb-space-4);
  align-items: start;
}
.pane {
  display: flex;
  flex-direction: column;
  min-height: 420px;
  max-height: calc(100vh - 260px);
  background: var(--wb-bg-elevated, #fff);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-2);
  flex: 0 0 auto;
  padding: var(--wb-space-3) var(--wb-space-4);
  border-bottom: 1px solid var(--wb-border-light);
}
.pane-head h3 {
  margin: 0;
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  color: var(--wb-text);
}
.pane-hint {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}
.pane-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--wb-space-3);
}
.pane-foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-2);
  padding: var(--wb-space-3) var(--wb-space-4);
  border-top: 1px solid var(--wb-border-light);
  background: var(--wb-bg-subtle);
}
.foot-note {
  margin: 0;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-eyebrow);
  line-height: 1.6;
}
.link-btn {
  padding: 0;
  color: var(--wb-primary);
  font-size: var(--wb-fs-meta);
  background: transparent;
  border: 0;
  cursor: pointer;
}

/* 知识点列表 */
.kp-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-2);
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  color: var(--wb-text);
  font-size: var(--wb-fs-meta);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.kp-row:hover {
  background: var(--wb-bg-hover);
}
.kp-row.active {
  color: var(--wb-primary);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-primary-soft);
}
.kp-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kp-count {
  flex: 0 0 auto;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-eyebrow);
  font-variant-numeric: tabular-nums;
}

/* 候选题列表 */
.cand-list {
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-2);
}
.cand-row {
  display: flex;
  align-items: flex-start;
  gap: var(--wb-space-3);
  padding: var(--wb-space-3);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  transition: border-color var(--wb-motion-fast) var(--wb-motion-ease);
}
.cand-row:hover {
  border-color: var(--wb-primary);
}
.cand-row.picked {
  border-color: var(--wb-primary);
  background: var(--wb-primary-soft);
}
.cand-main {
  flex: 1;
  min-width: 0;
}
.cand-stem {
  margin: 0;
  color: var(--wb-text);
  font-size: var(--wb-fs-meta);
  line-height: var(--wb-lh-normal);
  word-break: break-word;
}
.cand-meta {
  display: flex;
  align-items: center;
  gap: var(--wb-space-2);
  margin-top: 6px;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-eyebrow);
  flex-wrap: wrap;
}
.cand-badge {
  padding: 1px 7px;
  color: var(--wb-status-warning-fg);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-status-warning-bg);
  border-radius: 999px;
}
.cand-sub {
  color: var(--wb-text-tertiary);
}
.cand-students {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 组卷篮 */
.basket-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.basket-row {
  display: flex;
  align-items: center;
  gap: var(--wb-space-2);
  padding: 6px var(--wb-space-2);
  background: var(--wb-bg-subtle);
  border-radius: var(--wb-radius-xs);
}
.basket-num {
  flex: 0 0 auto;
  width: 18px;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-eyebrow);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.basket-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--wb-text);
  font-size: var(--wb-fs-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.basket-remove {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  color: var(--wb-text-tertiary);
  font-size: 15px;
  line-height: 1;
  background: transparent;
  border: 0;
  border-radius: var(--wb-radius-xs);
  cursor: pointer;
}
.basket-remove:hover {
  color: var(--wb-status-danger-fg);
  background: var(--wb-status-danger-bg);
}

/* 备课预览 */
.preview-body {
  max-height: 70vh;
  overflow-y: auto;
  padding-right: var(--wb-space-2);
}
.preview-tip {
  margin: 0 0 var(--wb-space-3);
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}
.preview-q {
  padding: var(--wb-space-4);
  margin-bottom: var(--wb-space-3);
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-sm);
}
.preview-head {
  display: flex;
  align-items: center;
  gap: var(--wb-space-2);
  margin-bottom: var(--wb-space-2);
}
.preview-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--wb-primary);
  font-size: var(--wb-fs-eyebrow);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-primary-soft);
  border-radius: 50%;
}
.preview-badge {
  padding: 1px 8px;
  color: var(--wb-status-warning-fg);
  font-size: var(--wb-fs-eyebrow);
  font-weight: var(--wb-fw-semibold);
  background: var(--wb-status-warning-bg);
  border-radius: 999px;
}
.preview-students {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-eyebrow);
}
.preview-parent {
  padding-left: 12px;
  margin-bottom: 4px;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  line-height: var(--wb-lh-normal);
  border-left: 3px solid var(--wb-border);
}
.preview-stem {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  line-height: var(--wb-lh-normal);
}
.preview-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px var(--wb-space-4);
  margin-top: 6px;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
}
.preview-answer,
.preview-analysis {
  display: flex;
  align-items: baseline;
  gap: var(--wb-space-2);
  margin-top: var(--wb-space-3);
  padding-top: var(--wb-space-2);
  border-top: 1px dashed var(--wb-border-light);
  font-size: var(--wb-fs-meta);
  line-height: var(--wb-lh-normal);
}
.preview-label {
  flex: 0 0 auto;
  color: var(--wb-text-tertiary);
}
.preview-answer-text {
  flex: 1;
  min-width: 0;
  color: var(--wb-text);
}
.preview-analysis-text {
  flex: 1;
  min-width: 0;
  color: var(--wb-text-secondary);
}
.preview-answer-missing {
  flex: 1;
  color: var(--wb-text-tertiary);
}

@media (max-width: 1180px) {
  .paper-builder {
    grid-template-columns: minmax(180px, 200px) minmax(0, 1fr) minmax(240px, 270px);
  }
}
</style>
