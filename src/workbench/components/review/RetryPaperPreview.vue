<template>
  <div class="rpp">
    <!-- 加载中 -->
    <div v-if="loading" class="rpp-state" role="status" aria-live="polite">
      <el-icon class="is-loading"><Loading /></el-icon>
      <strong>正在加载重练卷题目</strong>
      <span>按打印版同一口径渲染</span>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadError" class="rpp-state" role="alert">
      <el-icon><WarningFilled /></el-icon>
      <strong>读不到这份重练卷的题目</strong>
      <span>{{ loadError }}</span>
      <el-button size="small" @click="load">重试</el-button>
    </div>

    <!-- 空卷 -->
    <div v-else-if="blocks.length === 0" class="rpp-state">
      <el-icon><Document /></el-icon>
      <strong>这份重练卷没有题目</strong>
      <span>可能是题单为空，请回批改中心确认</span>
    </div>

    <!-- 卷面 -->
    <div v-else class="rpp-sheet" aria-label="重练卷卷面预览">
      <header class="rpp-head">
        <h3 class="rpp-title">{{ title || '错题重练' }}</h3>
        <p v-if="studentName" class="rpp-sub">{{ studentName }}</p>
        <div class="rpp-info">
          <span>姓名：<i class="rpp-blank"></i></span>
          <span>班级：<i class="rpp-blank"></i></span>
          <span>得分：<i class="rpp-blank"></i></span>
        </div>
        <p class="rpp-total">共 {{ questions.length }} 题 · 卷面预览（与打印版同口径，未含判定结果）</p>
      </header>

      <section
        v-for="blk in blocks"
        :key="blk.key"
        class="rpp-block"
      >
        <h4 class="rpp-block__title">{{ blk.label }}</h4>

        <div
          v-for="(row, idx) in blk.rows"
          :key="row.key"
          class="rpp-q"
          :class="{ 'rpp-q--cont': row.isContinuation }"
        >
          <div v-if="row.parentStem && !row.isContinuation" class="rpp-q-stem">
            <MathRender :content="row.parentStem" autoDetect />
          </div>
          <div class="rpp-q-head">
            <span class="rpp-q-num">{{ row.label }}.</span>
            <MathRender class="rpp-q-text" :content="row.content" autoDetect />
          </div>
          <div v-if="row.illustration" class="rpp-q-image">
            <img :src="row.illustration" alt="题目配图" loading="lazy" />
          </div>
          <div
            v-if="row.options.length"
            class="rpp-opts"
            :class="`rpp-opts--${row.optionCols}`"
          >
            <span v-for="(opt, i) in row.options" :key="i" class="rpp-opt">
              <b>{{ letter(i) }}.</b>
              <MathRender :content="opt" autoDetect tag="span" />
            </span>
          </div>
          <div v-if="row.type === 'fill'" class="rpp-fill-line"></div>
          <div v-if="row.type === 'answer'" class="rpp-ans-area">
            <i v-for="n in 4" :key="n" class="rpp-ans-line"></i>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
/**
 * RetryPaperPreview · 错题重练卷「只读卷面预览」
 *
 * 用途：
 *   老师侧看不到重练卷长什么样。此前批改中心「重练批改」把**未交答卷**的卷也放进
 *   复核队列，点进去中间栏无图（图片加载失败）、左右栏是原始作业的旧判定。
 *   修复后未交卷的卷不再进批改页，改为打开本组件 —— 老师能看到打印出去的那张卷。
 *
 * 口径一致性（重要）：
 *   渲染逻辑与 server/services/wrongRetryPdfService.buildPaperBody 保持同构：
 *     · 按题型分块（选择题 / 填空题 / 解答题）
 *     · 同一 (task_id, page_number, question_number) 的连续小问连排成一个题组块，
 *       编号写成 10(1). / 10(2).，公共题干 parent_stem 只在组内首题渲染一次
 *     · 填空题给横线、解答题给作答区
 *   题干/小问号取自 src/utils/questionStem.js（与 PC / 移动端 / PDF 三处共用）。
 *   若上述口径变化，必须同步本组件，否则老师看到的预览会和打印出来的卷对不上。
 *
 * 数据独立性：
 *   组件**自行拉取题目**，不读批改工作台的 allQuestions —— 未交卷的卷本不该把
 *   原始作业的旧判定（is_correct / confidence）带进批改页，这里是干净的只读通道。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Document, Loading, WarningFilled } from '@element-plus/icons-vue'
import { getQuestionsByIds } from '../../../services/apiService'
import { resolveQuestionDisplayStem, getQuestionGroupKey } from '../../../utils/questionStem'
import MathRender from '../MathRender.vue'

const props = defineProps({
  questionIds: { type: Array, default: () => [] },
  title: { type: String, default: '' },
  studentName: { type: String, default: '' },
})

const loading = ref(false)
const loadError = ref('')
const questions = ref([])

const letter = (i) => String.fromCharCode(65 + i)

/** 归一化 options（数组 / JSON 字符串 / null 都安全）—— 与服务端 normalizeOpts 同口径 */
const normalizeOpts = (raw) => {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** 题目配图：与服务端 getQuestionIllustration 同口径 */
const getIllustration = (q) => {
  if (!q) return null
  if (q.clean_geometry_svg && /<svg/i.test(String(q.clean_geometry_svg))) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.clean_geometry_svg)}`
  }
  if (q.tikz_svg_url) return q.tikz_svg_url
  if (q.clean_geometry_image_url && /^https?:\/\//.test(String(q.clean_geometry_image_url))) {
    return q.clean_geometry_image_url
  }
  if (q.clean_geometry_image_url && /<svg/i.test(String(q.clean_geometry_image_url))) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.clean_geometry_image_url)}`
  }
  if (q.geometry_image_url) return q.geometry_image_url
  return null
}

/** SQL `ORDER BY page_number, question_number, sub_no NULLS LAST` 的等价实现 */
const toSortNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}
const sortForPaper = (list) =>
  list.slice().sort((a, b) => {
    const pa = toSortNum(a?.page_number)
    const pb = toSortNum(b?.page_number)
    if (pa !== pb) return pa - pb
    const na = toSortNum(a?.question_number)
    const nb = toSortNum(b?.question_number)
    if (na !== nb) return na - nb
    return toSortNum(a?.sub_no) - toSortNum(b?.sub_no)
  })

const load = async () => {
  const ids = (props.questionIds || []).filter(Boolean)
  if (ids.length === 0) {
    questions.value = []
    loadError.value = ''
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const list = await getQuestionsByIds(ids)
    // 打印版顺序：SQL `ORDER BY page_number, question_number, sub_no NULLS LAST`
    // （见 exportWrongRetryPdf 的取数），不是 generated_exams.question_ids 的勾选顺序
    questions.value = sortForPaper(Array.isArray(list) ? list : [])
  } catch (e) {
    console.error('[RetryPaperPreview] 拉取题目失败:', e)
    questions.value = []
    loadError.value = e?.message || '网络或服务异常，请稍后重试'
  } finally {
    loading.value = false
  }
}

/**
 * 卷面行：分块 + 题组连排。
 * 编号规则与服务端 buildPaperBody 完全一致：
 *   非连排行 num++；连排行沿用上一行编号并写成 N(小问号).
 */
const blocks = computed(() => {
  const defs = [
    { key: 'choice', label: '一、选择题' },
    { key: 'fill', label: '二、填空题' },
    { key: 'answer', label: '三、解答题' },
  ]
  const out = []
  let lastGroupKey = ''
  let num = 0

  for (const def of defs) {
    const items = questions.value.filter(q => {
      const t = q?.question_type === 'choice' ? 'choice'
        : q?.question_type === 'fill' ? 'fill'
        : 'answer'
      return t === def.key
    })
    if (items.length === 0) continue

    const rows = []
    for (const q of items) {
      const { parentStem, content } = resolveQuestionDisplayStem(q)
      const groupKey = getQuestionGroupKey(q)
      const subNo = q?.sub_no == null ? '' : String(q.sub_no).trim()
      const isContinuation = !!groupKey && groupKey === lastGroupKey && !!subNo
      if (!isContinuation) num++
      lastGroupKey = groupKey

      const opts = normalizeOpts(q?.options)
      const maxLen = opts.length ? Math.max(...opts.map(o => String(o || '').length)) : 0

      rows.push({
        key: q?.id || `${def.key}-${rows.length}`,
        type: def.key,
        isContinuation,
        parentStem,
        content,
        label: subNo ? `${num}(${subNo})` : String(num),
        options: opts,
        optionCols: opts.length === 0 ? 0 : maxLen <= 8 ? 4 : maxLen <= 20 ? 2 : 1,
        illustration: getIllustration(q),
      })
    }
    out.push({ ...def, rows })
  }
  return out
})

onMounted(load)
watch(() => props.questionIds, load, { deep: true })
</script>

<style scoped>
.rpp { width: 100%; }

/* ── 状态块 ── */
.rpp-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 16px;
  color: var(--wb-text-tertiary);
  text-align: center;
}
.rpp-state strong { color: var(--wb-text); font-size: var(--wb-fs-body); }
.rpp-state span { font-size: var(--wb-fs-meta); }
.rpp-state .is-loading { color: var(--wb-primary); }

/* ── 卷面 ── */
.rpp-sheet {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 28px;
  background: #fff;
  border: 1px solid var(--wb-border-light);
  border-radius: var(--wb-radius-md);
  color: #1a1a1a;
  font-size: 13px;
  line-height: 1.7;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.rpp-head { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 12px; }
.rpp-title { font-size: 19px; font-weight: var(--wb-fw-bold); letter-spacing: 1px; margin: 0; }
.rpp-sub { margin: 2px 0 0; color: #555; font-size: 12px; }
.rpp-info {
  display: flex;
  gap: 36px;
  font-size: 13px;
  margin-top: 8px;
  color: #1a1a1a;
}
.rpp-blank {
  display: inline-block;
  width: 84px;
  border-bottom: 1px solid #333;
  height: 14px;
}
.rpp-total { margin: 6px 0 0; color: #666; font-size: 12px; }

.rpp-block { margin-top: 12px; }
.rpp-block__title {
  font-size: 14px;
  font-weight: var(--wb-fw-bold);
  margin: 0 0 8px;
  padding: 4px 0 4px 10px;
  border-left: 4px solid var(--wb-primary);
  background: var(--wb-primary-soft);
  color: var(--wb-text);
}

.rpp-q { margin-bottom: 12px; page-break-inside: avoid; }
.rpp-q--cont { margin-top: -4px; }
.rpp-q-stem {
  margin: 0 0 2px 32px;
  padding-left: 8px;
  border-left: 3px solid var(--wb-border);
  color: #333;
}
.rpp-q-head { display: flex; gap: 6px; }
.rpp-q-num { font-weight: var(--wb-fw-bold); white-space: nowrap; min-width: 26px; }
.rpp-q-text { flex: 1; min-width: 0; }

.rpp-q-image { text-align: center; margin: 6px 0 6px 32px; }
.rpp-q-image img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 4px;
}

.rpp-opts {
  display: grid;
  gap: 4px 14px;
  padding-left: 32px;
  margin-bottom: 2px;
}
.rpp-opts--1 { grid-template-columns: 1fr; }
.rpp-opts--2 { grid-template-columns: 1fr 1fr; }
.rpp-opts--4 { grid-template-columns: repeat(4, 1fr); }
.rpp-opt { font-size: 12px; line-height: 1.5; word-break: break-word; }
.rpp-opt b { font-weight: var(--wb-fw-bold); margin-right: 2px; }

.rpp-fill-line {
  width: 200px;
  border-bottom: 1.5px solid #333;
  margin: 5px 0 2px 32px;
  height: 24px;
}
.rpp-ans-area { margin: 4px 0 2px 32px; }
.rpp-ans-line {
  display: block;
  border-bottom: 1px solid #d0d0d0;
  height: 26px;
  margin-bottom: 3px;
}

/* ── 抽屉内嵌提示 ── */
.paper-preview-drawer__hint {
  margin: 0 0 12px;
  padding: 8px 12px;
  font-size: var(--wb-fs-meta);
  color: var(--wb-text-secondary);
  background: var(--wb-bg-hover);
  border-radius: var(--wb-radius-sm);
}
</style>
