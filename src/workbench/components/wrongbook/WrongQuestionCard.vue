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
import { computed } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import LazyImage from '../shared/LazyImage.vue'

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
const knowledgeTags = computed(() => {
  const q = question.value
  if (q.tags_source === 'manual') {
    return (q.manual_tags || []).map(name => ({ name, sourceType: 'manual' }))
  }
  return (q.ai_tags || []).map(name => ({ name, sourceType: 'ai' }))
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
</script>

<style scoped>
.wrong-question-card {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s, border-color 0.2s;
  border: 2px solid transparent;
}

.wrong-question-card.is-selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary);
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
  color: #8e8e93;
}

.merged-badge {
  font-size: 10px !important;
}

.date-text {
  font-size: 12px;
  color: #8e8e93;
}

.status-tag {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
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
  color: #1c1c1e;
  line-height: 1.6;
  margin-bottom: 8px;
}

.task-deleted-warning {
  font-size: 12px;
  color: #ff9500;
  background: #fff8e1;
  padding: 6px 10px;
  border-radius: 8px;
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
  background: #fff7e6;
  color: #fa8c16;
  border-color: transparent;
}

.tags-container :deep(.el-tag.ai) {
  background: #e8f4fd;
  color: var(--el-color-primary);
  border-color: transparent;
}

.card-footer {
  font-size: 13px;
  color: #8e8e93;
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
  color: #ff9500;
}

.error-count {
  font-size: 13px;
  color: #8e8e93;
}

.actions {
  display: flex;
  gap: 16px;
}
</style>
