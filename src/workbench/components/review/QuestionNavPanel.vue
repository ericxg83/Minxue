<template>
  <div class="nav-panel">
    <div class="nav-header">
      <span class="nav-title">题目列表</span>
      <span class="nav-stats">
        <span class="stat-unconfirmed">⚠ {{ store.reviewProgress.unconfirmed }}</span>
        <span class="stat-sep">·</span>
        <span class="stat-confirmed">● {{ store.reviewProgress.confirmed }}</span>
      </span>
    </div>

    <div class="nav-list" v-if="store.allQuestions.length > 0">
      <div
        v-for="(q, idx) in store.allQuestions"
        :key="q.id"
        class="nav-item"
        :class="{ active: idx === store.currentReviewIndex, confirmed: isConfirmed(q), unconfirmed: !isConfirmed(q) }"
        @click="onSelect(idx)"
      >
        <span class="item-icon">{{ isConfirmed(q) ? '●' : '⚠' }}</span>
        <span class="item-label">{{ idx + 1 }}. {{ typeLabel(q.question_type) }}</span>
        <span class="item-confidence" v-if="q.confidence != null" :class="{ low: q.confidence < store.confidenceThreshold }">
          {{ Math.round(q.confidence * 100) }}
        </span>
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

const store = useReviewStore()
const threshold = ref(store.confidenceThreshold)

const isConfirmed = (q) => {
  return !!(q.review_status || (q.confidence != null && q.confidence >= store.confidenceThreshold))
}

const typeLabel = (type) => {
  const map = { choice: '选择题', fill: '填空题', answer: '解答题' }
  return map[type] || '?'
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
.stat-unconfirmed { color: #e6a23c; margin-right: 3px; }
.stat-sep { color: #dcdfe6; margin: 0 4px; }
.stat-confirmed { color: #67c23a; }
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
.nav-item.confirmed .item-icon { color: #67c23a; }
.nav-item.unconfirmed .item-icon { color: #e6a23c; }
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
