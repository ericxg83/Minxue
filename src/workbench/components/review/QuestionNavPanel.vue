<template>
  <div class="nav-panel">
    <div class="nav-header">
      <span class="nav-title">题目列表</span>
      <span class="nav-stats">
        <span class="stat-attention">需处理 {{ store.needsAttentionCount }}</span>
      </span>
    </div>

    <div class="nav-list" v-if="store.allQuestions.length > 0">
      <div
        v-for="(q, idx) in store.allQuestions"
        :key="q.id"
        class="nav-item"
        :class="{
          active: idx === store.currentReviewIndex,
          'paper-start': paperLabels[idx] && idx > 0
        }"
        @click="onSelect(idx)"
      >
        <StatusIcon :state="store.getAiState(q)" :size="18" />
        <span class="item-label">{{ idx + 1 }}. {{ typeLabel(q) }}</span>
        <span
          v-if="paperLabels[idx]"
          class="item-paper-tag"
        >{{ paperLabels[idx] }}</span>
        <span
          v-if="q.difficulty != null"
          class="item-difficulty"
          :class="'diff-' + q.difficulty"
        >{{ difficultyText(q.difficulty) }}</span>
        <span
          v-if="store.getAiState(q) === 'exception'"
          class="item-confidence exception">{{ stateLabel(q) }}</span>
        <span
          v-else-if="store.getAiState(q) === 'processing'"
          class="item-confidence processing">处理中</span>
        <span
          v-else-if="q.confidence != null"
          class="item-confidence"
          :class="{ low: q.confidence < store.confidenceThreshold }"
        >{{ Math.round(q.confidence * 100) }}</span>
      </div>
    </div>

    <div class="nav-empty" v-else>
      <span>请选择学生和试卷</span>
    </div>

    <!-- 快捷键提示（纯展示，不参与判定） -->
    <div v-if="store.allQuestions.length > 0" class="nav-shortcuts">
      <span class="shortcut-row">
        <span class="key">←</span><span class="key">→</span> 切换
        <span class="key">C</span>正确
        <span class="key">W</span>错误
        <span class="key">E</span>删除
        <span class="key">Z</span>撤销
      </span>
    </div>

    <div class="nav-footer">
      <span class="threshold-label">置信阈值</span>
      <el-slider
        v-model="threshold"
        :min="0.5"
        :max="1.0"
        :step="0.05"
        size="small"
        style="width: 140px"
        @input="onThresholdChange"
      />
      <span class="threshold-value">{{ threshold.toFixed(2) }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import StatusIcon from './StatusIcon.vue'
import { getReviewStateLabel } from '../../../utils/reviewDecision'

const store = useReviewStore()
const threshold = ref(store.confidenceThreshold)

// 状态文案走同源函数：exception 桶里"学生未作答"与"AI 判不出"是两回事，
// 旧版一律写死「未识别答案」，会让答案明明已识别的题看着像 OCR 故障。
const stateLabel = (q) => getReviewStateLabel(q, store.confidenceThreshold)

// 题目归属试卷序号标签（仅每卷首题显示）
// 两种来源：
// 1. 多试卷聚合模式：按 questionToTaskMap 映射到任务序号
// 2. 单任务多图（一次上传多张试卷）：按题目 page_number 映射到页序号
const paperLabels = computed(() => {
  const map = store.questionToTaskMap
  if (map && Object.keys(map).length > 0) {
    const taskIds = [...new Set(Object.values(map))]
    const taskOrder = store.studentTasks
      .filter(t => taskIds.includes(t.id))
      .map(t => t.id)
    const labels = []
    let currentPaperId = null
    for (const q of store.allQuestions) {
      const tid = map[q.id]
      const isFirst = tid !== currentPaperId
      if (isFirst) currentPaperId = tid
      const paperIdx = taskOrder.indexOf(tid)
      labels.push(isFirst && paperIdx >= 0 ? `卷${paperIdx + 1}` : '')
    }
    return labels
  }
  // 单任务多图：同一个任务里的多页（一次上传的多张图片），每页首题标注「第N页」，
  // 按上传顺序（page_number）编号。注意与 case 1 的「卷N」区分——
  // 这些是同一个任务的页，不是多份独立试卷，用「第N页」避免让人误以为被拆成多份。
  const pages = store.currentPaperPages
  if (pages.length > 1) {
    const pageOrder = pages.map(p => p.page_number)
    const labels = []
    let currentPage = null
    for (const q of store.allQuestions) {
      const pn = q.page_number || 1
      const isFirst = pn !== currentPage
      if (isFirst) currentPage = pn
      const pageIdx = pageOrder.indexOf(pn)
      labels.push(isFirst && pageIdx >= 0 ? `第${pageIdx + 1}页` : '')
    }
    return labels
  }
  return []
})

// 题型中文映射表（question_type 字段合法值）
const TYPE_MAP = { choice: '选择题', fill: '填空题', answer: '解答题', judge: '判断题' }

// 把 question_type 归一为合法值。AI 老 prompt 偶发会把整个枚举字符串
// "choice/fill/judge/answer" 整段塞进 question_type，导致前端显示为 "1.?"
// 乱码。出现这种"枚举字符串"或含 '/' 的值时，按题目内容启发式兜底：
//   有 options → choice；含"对/错/√/×"或判断题标记 → judge；含"____"空格 → fill；其它 → answer
const normalizeType = (q) => {
  const t = String(q?.question_type || '').trim().toLowerCase()
  if (TYPE_MAP[t]) return t
  // 旧脏数据：整个枚举字符串 / 多个值拼接 / 空 / null
  const isEnumString = t.includes('/') || t.includes('|') || t.includes(',')
  if (isEnumString || !t) {
    if (Array.isArray(q?.options) && q.options.length > 0) return 'choice'
    const content = String(q?.content || '')
    if (/_{2,}|（\s*）|\(\s*\)|□/.test(content)) return 'fill'
    if (/(对|错|正确|错误|√|×|✓|✗)/.test(content) && content.length < 60) return 'judge'
    return 'answer'
  }
  return t
}

const typeLabel = (q) => {
  // 兼容老数据：把"choice/fill/judge/answer"这种枚举串也走一遍归一
  return TYPE_MAP[normalizeType(q)] || '?'
}

// 难度等级（1-5）简短标签
const difficultyText = (d) => {
  const map = { 1: '难度1', 2: '难度2', 3: '难度3', 4: '难度4', 5: '难度5' }
  return map[d] || ''
}

const onSelect = (idx) => {
  store.jumpToQuestion(idx)
}

const onThresholdChange = (val) => {
  store.confidenceThreshold = val
}
</script>

<style scoped>
.nav-panel {
  width: 260px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--wb-border);
  flex-shrink: 0;
}
.nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wb-border);
  flex-shrink: 0;
}
.nav-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--wb-text);
}
.nav-stats {
  font-size: 13px;
}
.stat-attention {
  color: var(--wb-danger);
  font-weight: 600;
  white-space: nowrap;
}
.nav-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.nav-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 14px;
  border-left: 3px solid transparent;
  transition: background 0.15s;
  gap: 8px;
}
.nav-item.paper-start {
  border-top: 1px dashed var(--wb-border);
  margin-top: 2px;
}
.nav-item.paper-start:first-child {
  border-top: none;
}
.nav-item:hover {
  background: var(--wb-bg);
}
.nav-item.active {
  background: var(--wb-primary-mist);
  border-left-color: var(--wb-primary);
}
.item-label {
  flex: 1;
  color: var(--wb-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-confidence {
  font-size: 11px;
  color: var(--wb-text-tertiary);
  background: var(--wb-bg-hover);
  padding: 0 6px;
  border-radius: var(--wb-radius-sm);
}
.item-confidence.low {
  color: var(--wb-warning);
  background: var(--wb-warning-soft);
}
.item-confidence.exception {
  color: var(--wb-accent);
  background: var(--wb-accent-soft);
}
.item-confidence.processing {
  color: var(--wb-processing);
  background: var(--wb-processing-soft);
}
.item-difficulty {
  font-size: 11px;
  padding: 0 6px;
  border-radius: var(--wb-radius-sm);
  white-space: nowrap;
  color: var(--wb-success);
  background: var(--wb-success-soft);
}
.item-paper-tag {
  font-size: 10px;
  padding: 0 5px;
  border-radius: var(--wb-radius-xs);
  white-space: nowrap;
  color: var(--wb-primary);
  background: var(--wb-primary-mist);
  border: 1px solid var(--wb-primary-soft);
  flex-shrink: 0;
}
.item-difficulty.diff-3 {
  color: var(--wb-warning);
  background: var(--wb-warning-soft);
}
.item-difficulty.diff-4,
.item-difficulty.diff-5 {
  color: var(--wb-danger);
  background: var(--wb-danger-soft);
}
.nav-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wb-text-tertiary);
  font-size: 13px;
}
.nav-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--wb-border);
  flex-shrink: 0;
}

/* ── 快捷键提示条 ── */
.nav-shortcuts {
  padding: 4px 12px 2px;
  border-top: 1px solid var(--wb-border-light);
  flex-shrink: 0;
}
.nav-shortcuts .shortcut-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--wb-text-tertiary);
}
.nav-shortcuts .key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  background: var(--wb-bg-elevated);
  color: var(--wb-text-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.threshold-label {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  white-space: nowrap;
}
.threshold-value {
  font-size: 12px;
  color: var(--wb-text-secondary);
  min-width: 36px;
  text-align: right;
}
</style>
