<template>
  <div class="wrong-question-card" :class="{ 'is-selected': isSelected }">
    <!-- Header: checkbox, subject, category, date, status -->
    <div class="card-header">
      <div class="header-left">
        <el-checkbox
          :model-value="isSelected"
          @change="$emit('toggle-select')"
          @click.stop
        />
        <span class="meta-text">
          {{ wrongQuestion.subject || '数学' }} · {{ getCategoryLabel }}
        </span>
        <el-tag v-if="wrongQuestion.is_merged" size="small" type="danger" effect="dark" class="merged-badge">
          合并 {{ wrongQuestion.wrong_count }} 道
        </el-tag>
        <el-tag v-if="difficultyInfo" :type="difficultyInfo.type" size="small" effect="plain" class="difficulty-badge">
          {{ difficultyInfo.text }}
        </el-tag>
      </div>
      <div class="header-right">
        <span class="date-text">
          {{ formatDate }}
        </span>
        <span
          class="status-tag"
          :class="statusClass"
          :title="'点击切换掌握等级'"
          @click="handleToggleStatus"
        >
          {{ statusLabel }}
        </span>
      </div>
    </div>

    <!-- Question content -->
    <div class="question-content">
      {{ questionContent }}
    </div>

    <!-- Task deleted warning -->
    <div
      v-if="isTaskDeleted"
      class="task-deleted-warning"
    >
      <el-icon><WarningFilled /></el-icon>
      <span>原试卷已删除，但错题保留</span>
    </div>

    <!-- Knowledge tags -->
    <div v-if="knowledgeTags.length > 0" class="tags-container">
      <el-tag
        v-for="(tag, idx) in knowledgeTags"
        :key="idx"
        size="small"
        :class="tag.sourceType"
      >
        {{ tag.name }}
      </el-tag>
    </div>

    <!-- Variants section (按需展开) -->
    <div v-if="showVariants && questionId" class="variants-container">
      <div class="variants-header">
        <span class="variants-title">变式题练习</span>
        <el-button
          type="primary"
          link
          size="small"
          :loading="generatingVariants"
          @click.stop="handleGenerateVariants"
        >
          {{ variantsList.length > 0 ? '重新生成' : '生成变式题（AI）' }}
        </el-button>
      </div>
      <div v-if="variantsList.length === 0" class="variants-empty">
        <span v-if="generatingVariants">AI 正在生成 4 道变式题（改数字/改条件/逆命题/情境迁移）...</span>
        <span v-else>点击右上角"生成变式题"按钮，AI 会基于原题考点生成 4 道同类型题</span>
      </div>
      <div v-else class="variants-list">
        <div v-for="(v, idx) in variantsList" :key="v.id || idx" class="variant-item">
          <div class="variant-strategy">{{ strategyLabel(v.strategy) }}</div>
          <div class="variant-content">{{ v.content }}</div>
          <div v-if="Array.isArray(v.options) && v.options.length > 0" class="variant-options">
            <div v-for="(opt, oIdx) in v.options" :key="oIdx" class="variant-option-item">
              {{ String.fromCharCode(65 + oIdx) }}. {{ opt }}
            </div>
          </div>
          <details v-if="v.answer" class="variant-answer-details">
            <summary>查看答案</summary>
            <div class="variant-answer-body">
              <div><strong>答案：</strong>{{ v.answer }}</div>
              <div v-if="v.analysis"><strong>解析：</strong>{{ v.analysis }}</div>
            </div>
          </details>
        </div>
      </div>
    </div>

    <!-- Footer: error count, edit, delete -->
    <div class="card-footer">
      <div class="footer-left">
        <span class="error-count">错误次数：{{ errorCount }}次</span>
        <template v-if="wrongQuestion.is_merged">
          <span class="time-range">
            首次错误：{{ formatFirstWrongTime }} · 最近错误：{{ formatLastWrongTime }}
          </span>
        </template>
      </div>
      <div class="actions">
        <el-button type="info" link size="small" @click="showVariants = !showVariants">
          {{ showVariants ? '收起变式' : '变式题' }}
        </el-button>
        <el-button type="primary" link size="small" @click="$emit('edit', wrongQuestion)">
          编辑
        </el-button>
        <el-button type="danger" link size="small" @click.stop="$emit('delete', wrongQuestion)">
          删除
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import LazyImage from '../shared/LazyImage.vue'
import { getQuestionVariants, generateQuestionVariants, getQuestionKnowledge } from '../../../services/apiService'

const STRATEGY_LABELS = {
  change_number: '改数字',
  change_condition: '改条件',
  inverse: '逆命题',
  context_shift: '情境迁移',
}
const strategyLabel = (s) => STRATEGY_LABELS[s] || s || '变式'

const props = defineProps({
  wrongQuestion: {
    type: Object,
    required: true
  },
  isSelected: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['toggle-select', 'update-status', 'edit', 'delete'])

// Derived question object
const question = computed(() => props.wrongQuestion.question || props.wrongQuestion)

// Category label (wrong / unanswered)
const getCategoryLabel = computed(() => {
  const q = question.value
  const answerSource = q.answer_source || q._answer_source || 'recognized'
  const isBlank = answerSource === 'blank'
  const isCorrect = q.is_correct !== undefined ? q.is_correct : props.wrongQuestion.is_correct
  if (isBlank && isCorrect === null) return '未作答'
  return '错题'
})

// Formatted date
const formatDate = computed(() => {
  const date = props.wrongQuestion.added_at || props.wrongQuestion.created_at
  return dayjs(date).format('YYYY-MM-DD')
})

// 首次错误时间（合并题）
const formatFirstWrongTime = computed(() => {
  const date = props.wrongQuestion.first_wrong_time || props.wrongQuestion.added_at
  return dayjs(date).format('YYYY-MM-DD')
})

// 最近错误时间（合并题）
const formatLastWrongTime = computed(() => {
  const date = props.wrongQuestion.last_wrong_time || props.wrongQuestion.added_at
  return dayjs(date).format('YYYY-MM-DD')
})

// Whether task is deleted
const isTaskDeleted = computed(() => {
  return !question.value.task_id || props.wrongQuestion.task_deleted
})

// Knowledge tags with source type
// 优先级：1. 手动标签 → 2. 后端归一化知识树（/questions/:id/knowledge）→ 3. ai_tags 兜底
const normalizedKnowledge = ref([])
watch(questionId, async (qid) => {
  if (!qid) { normalizedKnowledge.value = []; return }
  try {
    const rows = await getQuestionKnowledge(qid)
    normalizedKnowledge.value = Array.isArray(rows) ? rows : []
  } catch (e) {
    normalizedKnowledge.value = []
  }
}, { immediate: true })

const knowledgeTags = computed(() => {
  const q = question.value
  if (q.tags_source === 'manual') {
    return (q.manual_tags || []).map(name => ({ name, sourceType: 'manual' }))
  }
  // 优先用归一化后的知识树节点
  if (normalizedKnowledge.value.length > 0) {
    return normalizedKnowledge.value.map(kp => ({
      name: kp.name,
      sourceType: kp.role === 'primary' ? 'kp-primary' : 'kp-secondary',
    }))
  }
  // 兜底用 AI 标签
  return (q.ai_tags || []).map(name => ({ name, sourceType: 'ai' }))
})

// 难度系数（1-5）
const difficultyInfo = computed(() => {
  const d = question.value?.difficulty
  if (d == null) return null
  const labelMap = { 1: '基础', 2: '简单', 3: '中等', 4: '较难', 5: '难题' }
  const typeMap = { 1: 'success', 2: 'success', 3: 'warning', 4: 'danger', 5: 'danger' }
  return { text: `难度${d}·${labelMap[d] || ''}`, type: typeMap[d] || 'info' }
})

// Error count
const errorCount = computed(() => {
  return question.value.wrong_count || 1
})

// Status label
const statusLabel = computed(() => {
  const map = { pending: '未掌握', partial: '有点掌握', mastered: '完全掌握' }
  return map[props.wrongQuestion.status] || '未掌握'
})

// Status CSS class
const statusClass = computed(() => {
  return `status-${props.wrongQuestion.status}`
})

// Toggle mastery status: pending → partial → mastered → pending
function handleToggleStatus() {
  const { status } = props.wrongQuestion
  let nextStatus
  switch (status) {
    case 'pending':
      nextStatus = 'partial'
      break
    case 'partial':
      nextStatus = 'mastered'
      break
    case 'mastered':
      nextStatus = 'pending'
      break
    default:
      nextStatus = 'pending'
  }
  emit('update-status', props.wrongQuestion, nextStatus)
}

// Question content text
const questionContent = computed(() => question.value.content || '')

// ===================== 变式题（按需展开） =====================
const questionId = computed(() => question.value.id || props.wrongQuestion.question_id || props.wrongQuestion.id)
const showVariants = ref(false)
const variantsList = ref([])
const generatingVariants = ref(false)

// 展开时自动拉一次（不强制覆盖本地已有的）
async function ensureVariantsLoaded() {
  if (!questionId.value || variantsList.value.length > 0) return
  try {
    const grouped = await getQuestionVariants(questionId.value)
    // grouped 是 { change_number: [], ... }；摊平
    variantsList.value = [
      ...(grouped.change_number || []),
      ...(grouped.change_condition || []),
      ...(grouped.inverse || []),
      ...(grouped.context_shift || []),
    ]
  } catch (e) {
    // 拉取失败不阻塞，只是不显示
    console.warn('拉取变式题失败:', e.message)
  }
}

watch(showVariants, (val) => {
  if (val) ensureVariantsLoaded()
})

async function handleGenerateVariants() {
  if (!questionId.value) {
    ElMessage.warning('该题未关联原题 ID，无法生成变式题')
    return
  }
  if (generatingVariants.value) return
  generatingVariants.value = true
  try {
    const kpName = (question.value.ai_tags || [])[0] || null
    const res = await generateQuestionVariants(questionId.value, kpName)
    if (res && Array.isArray(res.variants) && res.variants.length > 0) {
      variantsList.value = res.variants
      ElMessage.success(`已生成 ${res.generated || res.variants.length} 道变式题`)
    } else {
      ElMessage.warning('AI 暂未生成出变式题，请稍后再试')
    }
  } catch (e) {
    ElMessage.error('生成变式题失败：' + (e?.message || '未知错误'))
  } finally {
    generatingVariants.value = false
  }
}
</script>

<style scoped>
.wrong-question-card {
  background: #fff;
  border-radius: var(--wb-radius-md);
  padding: 16px;
  box-shadow: var(--wb-shadow-sm);
  transition: box-shadow 0.2s, border-color 0.2s;
  border: 2px solid transparent;
}

.wrong-question-card.is-selected {
  border-color: var(--wb-primary);
  box-shadow: 0 0 0 1px var(--wb-primary);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.meta-text {
  font-size: 14px;
  color: var(--wb-text-tertiary);
}

.merged-badge {
  font-size: 10px !important;
}

.date-text {
  font-size: 12px;
  color: var(--wb-text-tertiary);
}

.status-tag {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--wb-radius-md);
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.2s;
}

.status-tag:hover {
  opacity: 0.8;
}

.status-pending {
  color: #ff3b30;
  background: #ffedee;
}

.status-partial {
  color: #ff9500;
  background: #fff8e1;
}

.status-mastered {
  color: #34c759;
  background: #e8f5e9;
}

.question-content {
  font-size: 15px;
  color: var(--wb-text);
  line-height: 1.6;
  margin-bottom: 8px;
}

.task-deleted-warning {
  font-size: 12px;
  color: #ff9500;
  background: #fff8e1;
  padding: 6px 10px;
  border-radius: var(--wb-radius-sm);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-deleted-warning .el-icon {
  font-size: 14px;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.tags-container :deep(.el-tag.manual) {
  background: var(--wb-warning-soft);
  color: var(--wb-warning);
  border-color: transparent;
}

.tags-container :deep(.el-tag.ai) {
  background: var(--wb-primary-mist);
  color: var(--wb-primary);
  border-color: transparent;
}
.tags-container :deep(.el-tag.kp-primary) {
  background: linear-gradient(135deg, #6366F1, #8B5CF6);
  color: #fff;
  border-color: transparent;
  font-weight: 500;
}
.tags-container :deep(.el-tag.kp-secondary) {
  background: #F0F5FF;
  color: #3B82F6;
  border-color: transparent;
}

.card-footer {
  font-size: 13px;
  color: var(--wb-text-tertiary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.time-range {
  font-size: 11px;
  color: #8B5CF6;
}

.error-count {
  font-size: 13px;
  color: var(--wb-text-tertiary);
}

.actions {
  display: flex;
  gap: 16px;
}

/* 变式题区 */
.variants-container {
  margin-top: 8px;
  padding: 12px 14px;
  background: #F0F5FF;
  border: 1px solid #D6E4FF;
  border-radius: 8px;
}
.variants-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.variants-title {
  font-size: 13px;
  font-weight: 600;
  color: #1D2129;
}
.variants-empty {
  font-size: 12px;
  color: #86909C;
  padding: 6px 0;
}
.variants-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.variant-item {
  background: #fff;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  padding: 10px 12px;
}
.variant-strategy {
  display: inline-block;
  font-size: 11px;
  padding: 1px 8px;
  background: #3B82F6;
  color: #fff;
  border-radius: 4px;
  margin-bottom: 6px;
}
.variant-content {
  font-size: 13px;
  line-height: 1.6;
  color: #1D2129;
  margin-bottom: 6px;
}
.variant-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 16px;
  font-size: 12px;
  color: #4E5969;
  margin-bottom: 6px;
}
.variant-option-item {
  padding: 2px 0;
}
.variant-answer-details {
  font-size: 12px;
  margin-top: 4px;
}
.variant-answer-details summary {
  cursor: pointer;
  color: #3B82F6;
  user-select: none;
}
.variant-answer-body {
  background: #F7F8FA;
  padding: 8px 10px;
  border-radius: 4px;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #4E5969;
}
.variant-answer-body > div {
  margin-bottom: 4px;
}
.variant-answer-body > div:last-child {
  margin-bottom: 0;
}
</style>
