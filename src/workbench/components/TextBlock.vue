<template>
  <div class="text-block" :class="{ 'low-conf': block.confidence < 0.7 }">
    <span 
      class="editable-text text-content"
      @click="$emit('edit', block)"
    >{{ block.content }}</span>
    <el-tooltip v-if="block.confidence < 0.7" :content="`置信度: ${Math.round(block.confidence * 100)}%`">
      <el-icon class="warning-icon"><WarningFilled /></el-icon>
    </el-tooltip>
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
.text-block {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 8px;
  padding: 4px 8px;
  border-radius: 4px;
}

.text-block.low-conf {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
}

.text-content {
  font-size: 14px;
  line-height: 1.6;
  color: #374151;
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
