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
        :class="{ active: idx === store.currentReviewIndex }"
        @click="onSelect(idx)"
      >
        <StatusIcon :state="store.getAiState(q)" :size="18" />
        <span class="item-label">{{ idx + 1 }}. {{ typeLabel(q.question_type) }}</span>
        <span
          v-if="q.difficulty != null"
          class="item-difficulty"
          :class="'diff-' + q.difficulty"
        >{{ difficultyText(q.difficulty) }}</span>
        <span
          v-if="store.getAiState(q) === 'exception'"
          class="item-confidence exception">未识别答案</span>
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

const store = useReviewStore()
const threshold = ref(store.confidenceThreshold)

const typeLabel = (type) => {
  const map = { choice: '选择题', fill: '填空题', answer: '解答题', judge: '判断题' }
  return map[type] || '?'
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
  border-right: 1px solid #e4e7ed;
  flex-shrink: 0;
}
.nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.nav-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.nav-stats {
  font-size: 13px;
}
.stat-attention {
  color: #f56c6c;
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
.nav-item:hover {
  background: #f5f7fa;
}
.nav-item.active {
  background: #ecf5ff;
  border-left-color: #409eff;
}
.item-label {
  flex: 1;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-confidence {
  font-size: 11px;
  color: #909399;
  background: #f4f4f5;
  padding: 0 6px;
  border-radius: 8px;
}
.item-confidence.low {
  color: #e6a23c;
  background: #fdf6ec;
}
.item-confidence.exception {
  color: #fa8c16;
  background: #fff4e6;
}
.item-confidence.processing {
  color: #9254de;
  background: #f5effd;
}
.item-difficulty {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 8px;
  white-space: nowrap;
  color: #67c23a;
  background: #f0f9eb;
}
.item-difficulty.diff-3 {
  color: #e6a23c;
  background: #fdf6ec;
}
.item-difficulty.diff-4,
.item-difficulty.diff-5 {
  color: #f56c6c;
  background: #fef0f0;
}
.nav-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 13px;
}
.nav-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
  flex-shrink: 0;
}
.threshold-label {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}
.threshold-value {
  font-size: 12px;
  color: #606266;
  min-width: 36px;
  text-align: right;
}
</style>
