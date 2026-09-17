<template>
  <div class="weekend-handout-page wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学资源 / 错题课件"
        title="周末班错题课件"
        description="按年级与时段聚合错题，选好题目一键生成可投屏的讲评 PPTX（多小问已合并成完整题）。"
      />

      <!-- 参数表单 -->
      <ContentCard title="生成参数" description="先圈定范围，预览题单后勾选题目">
        <div class="param-grid">
          <div class="param-field">
            <label>年级</label>
            <WorkbenchSelect
              v-model="params.grade"
              :options="gradeOptions"
              width="160px"
              aria-label="选择年级"
            />
          </div>
          <div class="param-field">
            <label>时段</label>
            <div class="period-row">
              <WorkbenchSelect
                v-model="periodPreset"
                :options="periodOptions"
                width="150px"
                aria-label="时段预设"
                @change="onPeriodPreset"
              />
              <WorkbenchInput
                v-if="periodPreset === 'custom'"
                v-model="params.from"
                placeholder="开始日期 如 2026-09-01"
                width="170px"
                aria-label="开始日期"
              />
              <WorkbenchInput
                v-if="periodPreset === 'custom'"
                v-model="params.to"
                placeholder="结束日期 如 2026-09-18"
                width="170px"
                aria-label="结束日期"
              />
            </div>
          </div>
          <div class="param-field">
            <label>学科</label>
            <WorkbenchInput
              v-model="params.subject"
              placeholder="如 数学（留空=全部）"
              width="200px"
              aria-label="学科"
            />
          </div>
          <div class="param-field">
            <label>学生</label>
            <WorkbenchSelect
              v-model="params.students"
              :options="studentOptions"
              multiple
              clearable
              placeholder="留空=年级全部学生"
              width="320px"
              aria-label="选择学生"
            />
          </div>
          <div class="param-field">
            <label>整份题数上限</label>
            <WorkbenchInput
              v-model.number="params.limit"
              type="number"
              placeholder="0=不限（一节课建议 20-24）"
              width="220px"
              aria-label="题数上限"
            />
          </div>
          <div class="param-field">
            <label>每天题数上限</label>
            <WorkbenchInput
              v-model.number="params.maxPerDay"
              type="number"
              placeholder="0=不限"
              width="160px"
              aria-label="每天题数上限"
            />
          </div>
          <div class="param-field">
            <label>版本</label>
            <WorkbenchSelect
              v-model="withAnswer"
              :options="[
                { label: '讲义版（含参考答案）', value: true },
                { label: '重练版（不含答案）', value: false },
              ]"
              width="220px"
              aria-label="版本"
            />
          </div>
          <div class="param-field">
            <label>薄天合并</label>
            <WorkbenchInput
              v-model.number="params.mergeThin"
              type="number"
              placeholder="0=不合并（如 3=少于3题的天并入下一节）"
              width="220px"
              aria-label="薄天合并阈值"
            />
          </div>
        </div>

        <div class="param-actions">
          <ActionButton
            variant="primary"
            :loading="previewing"
            :disabled="!params.grade"
            @click="runPreview"
          >
            <el-icon v-if="!previewing"><Search /></el-icon>
            {{ previewing ? '正在聚合错题…' : '预览题单' }}
          </ActionButton>
          <span v-if="previewMeta" class="preview-meta">
            {{ previewMeta }}
          </span>
        </div>
      </ContentCard>

      <!-- 题单预览 -->
      <ContentCard
        v-if="handout"
        class="deck-preview"
        title="题单预览"
        :description="`共 ${questionCount} 题 · 已选 ${selectedCount} 题${selectedCount !== questionCount ? '（未全选）' : ''}，勾选需要的题目后生成`"
      >
        <template #actions>
          <ActionButton
            variant="secondary"
            :disabled="selectedCount === 0"
            @click="openBoard"
          >
            <el-icon><MagicStick /></el-icon>
            白板模式
          </ActionButton>
          <ActionButton
            variant="primary"
            :loading="generating"
            :disabled="selectedCount === 0"
            @click="runGenerate"
          >
            <el-icon v-if="!generating"><Download /></el-icon>
            {{ generating ? '正在生成 PPTX…' : `生成 PPTX（${selectedCount} 题）` }}
          </ActionButton>
        </template>

        <!-- 全选工具条 -->
        <div class="select-toolbar">
          <el-checkbox
            :model-value="selectedCount === questionCount && questionCount > 0"
            :indeterminate="selectedCount > 0 && selectedCount < questionCount"
            @change="toggleAll"
          >
            全选
          </el-checkbox>
          <span class="toolbar-hint">按「日期倒序 → 每天由易到难」排列；同题多人错已合并</span>
        </div>

        <div v-if="previewing" class="preview-loading" aria-label="正在加载题单">
          <div v-for="i in 4" :key="i" class="skeleton-row">
            <el-skeleton animated>
              <template #template>
                <el-skeleton-item variant="text" style="width: 30%; margin-bottom: 8px" />
                <el-skeleton-item variant="text" style="width: 90%" />
                <el-skeleton-item variant="text" style="width: 70%" />
              </template>
            </el-skeleton>
          </div>
        </div>

        <div v-else-if="questionCount === 0" class="empty-hint">
          该时段没有符合条件的错题，调整参数后重试。
        </div>

        <div v-else class="deck-sections">
          <section
            v-for="sec in sectionSlides"
            :key="sec.label"
            class="deck-section"
          >
            <header class="section-head">
              <h3>{{ sec.label }}</h3>
              <span class="section-meta">
                {{ sec.topicCount }} 题 · {{ sec.studentCount }} 名学生
                <template v-if="sectionTierText(sec)"> · {{ sectionTierText(sec) }}</template>
              </span>
            </header>

            <article
              v-for="q in questionsOf(sec.label)"
              :key="q.index"
              class="deck-item"
              :class="{ 'item-selected': isSelected(q.index) }"
            >
              <div class="item-check">
                <el-checkbox
                  :model-value="isSelected(q.index)"
                  @change="val => toggleQuestion(q.index, !!val)"
                  :aria-label="`选择第 ${q.index} 题`"
                />
              </div>
              <div class="item-body">
                <div class="item-head">
                  <span class="item-seq">{{ q.index }}</span>
                  <span class="item-qn" v-if="q.questionNumber != null">第 {{ q.questionNumber }} 题</span>
                  <span class="item-tag type">{{ q.typeLabel || '未标题型' }}</span>
                  <span class="item-tag tier" :style="tierStyle(q.tier)">{{ q.tierLabel || '难度未判定' }}</span>
                  <span v-if="q.difficulty != null" class="item-diff">难度 {{ q.difficulty }}</span>
                  <span class="item-count">{{ q.studentCount }} 人错</span>
                  <span v-if="(q.subParts || []).length > 1" class="item-multi">
                    含 {{ q.subParts.length }} 小问（完整题）
                  </span>
                  <span v-if="(q.missingSubs || []).length" class="item-missing">
                    ⚠ 缺小问 {{ q.missingSubs.join('/') }}
                  </span>
                  <span v-if="!q.hasAnswer" class="item-no-answer">答案暂缺</span>
                </div>
                <div class="item-stem">
                  <template v-if="q.parentStem">{{ q.parentStem }}</template>
                  <template v-if="q.subParts && q.subParts.length > 1">
                    <div
                      v-for="sp in q.subParts"
                      :key="sp.subNo"
                      class="item-sub"
                    >({{ sp.subNo }}) {{ sp.content }}</div>
                  </template>
                  <template v-else>{{ q.stem }}</template>
                </div>
                <div class="item-answer" v-if="withAnswer">
                  <span class="ans-label">参考答案</span>
                  <span class="ans-text">{{ q.answer || '（库里为空，讲前请人工补）' }}</span>
                  <span v-if="q.answerRisk" class="ans-risk">⚠ {{ q.answerRisk }}</span>
                </div>
              </div>
            </article>
          </section>
        </div>
      </ContentCard>

      <EmptyState
        v-else
        :icon="Reading"
        title="还没有题单"
        description="设置上方的年级、时段与学生范围，点击「预览题单」聚合错题。"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download, MagicStick, Reading, Search } from '@element-plus/icons-vue'
import { apiRequest } from '../../services/apiService'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'

const TIER_COLORS = {
  basic: { fg: '#16A34A', bg: '#DCFCE7' },
  medium: { fg: '#6366F1', bg: '#EEF2FF' },
  hard: { fg: '#D97706', bg: '#FEF3C7' },
  unknown: { fg: '#64748B', bg: '#F1F5F9' },
}

const router = useRouter()

// ── 参数 ──
const params = ref({
  grade: '初三',
  subject: '',
  days: 7,
  from: '',
  to: '',
  students: [],
  limit: 0,
  maxPerDay: 0,
  mergeThin: 0,
})
const periodPreset = ref('days7')
const withAnswer = ref(true)
const previewing = ref(false)
const generating = ref(false)
const handout = ref(null)
const selected = ref(new Set())

const periodOptions = [
  { label: '最近 7 天', value: 'days7' },
  { label: '最近 14 天', value: 'days14' },
  { label: '最近 20 天', value: 'days20' },
  { label: '自定义时段', value: 'custom' },
]

function onPeriodPreset(val) {
  if (val === 'custom') {
    params.value.from = ''
    params.value.to = ''
  } else {
    params.value.days = Number(String(val).replace('days', ''))
    params.value.from = ''
    params.value.to = ''
  }
}

// ── 学生/年级 ──
const students = ref([])
const studentOptions = computed(() =>
  students.value
    .filter(s => !params.value.grade || s.grade === params.value.grade)
    .map(s => ({ label: s.name, value: s.name }))
)
const gradeOptions = computed(() => {
  const grades = [...new Set(students.value.map(s => s.grade).filter(Boolean))]
  return grades.map(g => ({ label: g, value: g }))
})

onMounted(async () => {
  try {
    const res = await apiRequest('/students')
    students.value = (res.students || []).filter(s => s.enrollment_status !== 'archived')
  } catch (e) {
    ElMessage.warning('学生列表加载失败：' + (e.message || '网络错误'))
  }
})

// ── 题单 ──
const sectionSlides = computed(() => (handout.value?.slides || []).filter(s => s.kind === 'section'))
const questionSlides = computed(() => (handout.value?.slides || []).filter(s => s.kind === 'question'))
const questionCount = computed(() => questionSlides.value.length)
const selectedCount = computed(() => selected.value.size)
const previewMeta = computed(() => {
  if (!handout.value) return ''
  const h = handout.value
  return `时段 ${h.periodLabel} · ${h.stats.rawRows} 条错题 → ${h.stats.topics} 题 · ${h.stats.students} 名学生`
})

function questionsOf(label) {
  return questionSlides.value.filter(q => q.sectionLabel === label)
}
function sectionTierText(sec) {
  const t = sec.tiers || {}
  const parts = []
  const map = { basic: '基础', medium: '中等', hard: '较难', unknown: '未判定' }
  for (const k of ['basic', 'medium', 'hard', 'unknown']) {
    if (t[k]) parts.push(`${map[k]} ${t[k]}`)
  }
  return parts.join(' · ')
}
function tierStyle(tier) {
  const c = TIER_COLORS[tier] || TIER_COLORS.unknown
  return { color: c.fg, background: c.bg, borderColor: c.fg + '33' }
}
function isSelected(idx) { return selected.value.has(idx) }
function toggleQuestion(idx, val) {
  const s = new Set(selected.value)
  if (val) s.add(idx); else s.delete(idx)
  selected.value = s
}
function toggleAll(val) {
  selected.value = val ? new Set(questionSlides.value.map(q => q.index)) : new Set()
}

// ── 预览 ──
async function runPreview() {
  previewing.value = true
  handout.value = null
  selected.value = new Set()
  try {
    const body = buildParamsBody()
    const res = await apiRequest('/weekend-ppt/preview', { method: 'POST', body })
    if (!res.success) throw new Error(res.error || '生成失败')
    handout.value = res.handout
    // 默认全选
    selected.value = new Set(res.handout.slides.filter(s => s.kind === 'question').map(q => q.index))
  } catch (e) {
    ElMessage.error('预览失败：' + (e.message || '网络错误'))
  } finally {
    previewing.value = false
  }
}

// ── 生成下载 ──
function buildParamsBody(extra = {}) {
  const body = {
    grade: params.value.grade,
    subject: params.value.subject,
    students: params.value.students,
    limit: Number(params.value.limit) || 0,
    maxPerDay: Number(params.value.maxPerDay) || 0,
    mergeThin: Number(params.value.mergeThin) || 0,
    withAnswer: withAnswer.value,
    ...extra,
  }
  if (periodPreset.value === 'custom') {
    body.from = params.value.from || undefined
    body.to = params.value.to || undefined
  } else {
    body.days = params.value.days
  }
  return body
}

/** 白板模式：携带筛选参数 + selected 题号跳转讲题白板 */
function openBoard() {
  if (selected.value.size === 0) {
    ElMessage.warning('请先勾选题目')
    return
  }
  const body = buildParamsBody()
  const query = {
    grade: body.grade,
    subject: body.subject || '',
    days: body.days ? String(body.days) : '',
    limit: body.limit ? String(body.limit) : '',
    maxPerDay: body.maxPerDay ? String(body.maxPerDay) : '',
    mergeThin: body.mergeThin ? String(body.mergeThin) : '',
    students: body.students.join(','),
    selected: [...selected.value].join(','),
  }
  if (body.from) query.from = body.from
  if (body.to) query.to = body.to
  router.push({ path: '/weekend-ppt/board', query })
}

async function runGenerate() {
  if (selected.value.size === 0) {
    ElMessage.warning('请先勾选题目')
    return
  }
  generating.value = true
  try {
    const body = buildParamsBody({ selected: [...selected.value] })
    const res = await fetch('/api/weekend-ppt/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const h = handout.value
    const fname = `${h.grade}${h.subject ? '_' + h.subject : ''}_周末班错题课件_${h.period.start}_${h.period.end}.pptx`
    a.href = url
    a.download = fname
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success(`已生成 ${selected.value.size} 题课件并开始下载`)
  } catch (e) {
    ElMessage.error('生成失败：' + (e.message || '网络错误'))
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.param-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px 20px;
}
.param-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wb-text-secondary, #64748b);
}
.period-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.param-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 18px;
}
.preview-meta {
  font-size: 12.5px;
  color: var(--wb-text-secondary, #64748b);
}
.select-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0 4px;
  border-bottom: 1px solid var(--wb-border, #e2e8f0);
  margin-bottom: 8px;
}
.toolbar-hint {
  font-size: 12px;
  color: var(--wb-text-secondary, #64748b);
}
.preview-loading {
  padding: 12px 0;
}
.skeleton-row {
  padding: 10px 0;
}
.empty-hint {
  padding: 28px 0;
  text-align: center;
  color: var(--wb-text-secondary, #64748b);
  font-size: 13.5px;
}
.deck-section {
  margin-top: 14px;
}
.section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 2px solid var(--wb-text, #1e293b);
}
.section-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 680;
  color: var(--wb-text, #1e293b);
}
.section-meta {
  font-size: 12.5px;
  color: var(--wb-text-secondary, #64748b);
}
.deck-item {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  margin: 10px 0;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 10px;
  background: #fff;
  transition: border-color 0.15s;
}
.deck-item.item-selected {
  border-color: var(--wb-primary, #6366f1);
}
.item-check {
  padding-top: 2px;
}
.item-body {
  flex: 1;
  min-width: 0;
}
.item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.item-seq {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--wb-primary, #6366f1);
  color: #fff;
  font-size: 12.5px;
  font-weight: 650;
}
.item-qn {
  font-size: 12.5px;
  color: var(--wb-text-secondary, #64748b);
}
.item-tag {
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--wb-border, #e2e8f0);
  color: var(--wb-text-secondary, #64748b);
}
.item-tag.tier {
  font-weight: 650;
}
.item-count {
  font-size: 12px;
  font-weight: 650;
  color: var(--wb-text, #1e293b);
}
.item-multi {
  font-size: 11.5px;
  color: #6d28d9;
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  padding: 2px 8px;
  border-radius: 999px;
}
.item-missing {
  font-size: 11.5px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  padding: 2px 8px;
  border-radius: 999px;
}
.item-no-answer {
  font-size: 11.5px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 2px 8px;
  border-radius: 999px;
}
.item-stem {
  font-size: 14px;
  line-height: 1.75;
  color: var(--wb-text, #1e293b);
}
.item-sub {
  margin-top: 2px;
}
.item-answer {
  margin-top: 10px;
  padding: 8px 12px;
  background: #eef2ff;
  border-left: 3px solid var(--wb-primary, #6366f1);
  border-radius: 0 8px 8px 0;
  font-size: 13px;
  line-height: 1.6;
}
.ans-label {
  font-size: 11px;
  font-weight: 650;
  color: var(--wb-primary, #6366f1);
  margin-right: 8px;
  letter-spacing: 0.3px;
}
.ans-text {
  font-weight: 550;
  color: var(--wb-text, #1e293b);
}
.ans-risk {
  font-size: 11px;
  color: #b45309;
  margin-left: 8px;
}
</style>
