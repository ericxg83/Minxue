<template>
  <div class="question-block" :class="{ 'low-conf': block.confidence < 0.7 }">
    <div class="question-header">
      <span 
        class="editable-text question-content"
        @click="$emit('edit', block)"
      >{{ block.content }}</span>
      <el-tooltip v-if="block.confidence < 0.7" :content="`置信度: ${Math.round(block.confidence * 100)}%`">
        <el-icon class="warning-icon"><WarningFilled /></el-icon>
      </el-tooltip>
    </div>
    <div v-if="block.options && block.options.length > 0" class="options-grid">
      <div 
        v-for="(opt, i) in block.options" 
        :key="i" 
        class="option-item"
        @click="$emit('edit', block, { field: 'options', index: i })"
      >
        {{ opt }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { WarningFilled } from '@element-plus/icons-vue'

defineProps({
  block: { type: Object, required: true },
  pageNo: { type: Number, default: 1 },
  blockIndex: { type: Number, default: -1 }
})

defineEmits(['edit'])
</script>

<style scoped>
.question-block {
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.question-block:hover {
  background: #f9fafb;
}

.question-block.low-conf {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
}

.question-header {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.question-content {
  font-size: 14px;
  line-height: 1.6;
  color: #111827;
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 16px;
  margin-top: 8px;
  padding-left: 16px;
}

.option-item {
  font-size: 13px;
  line-height: 1.5;
  color: #374151;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 2px;
}

.option-item:hover {
  background: #eff6ff;
}

.warning-icon {
  color: #d97706;
  font-size: 14px;
  flex-shrink: 0;
}

.editable-text {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.editable-text:hover {
  background: #eff6ff;
}
</style>
