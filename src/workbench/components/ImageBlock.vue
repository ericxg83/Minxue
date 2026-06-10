<template>
  <div class="image-block">
    <div class="image-wrapper">
      <img v-if="block.src" :src="block.src" :alt="block.caption" class="image-content" />
      <div v-else class="image-placeholder">
        <el-icon size="24"><Picture /></el-icon>
        <span>[图: {{ block.caption || '待插入' }}]</span>
      </div>
    </div>
    <div class="image-caption">{{ block.caption || '未命名图片' }}</div>
  </div>
</template>

<script setup>
import { Picture } from '@element-plus/icons-vue'

defineProps({
  block: { type: Object, required: true },
  pageNo: { type: Number, default: 1 },
  blockIndex: { type: Number, default: -1 }
})
</script>

<style scoped>
.image-block {
  margin: 12px 0;
  text-align: center;
}

.image-wrapper {
  display: inline-block;
  max-width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
  background: #f9fafb;
}

.image-content {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
}

.image-placeholder {
  width: 200px;
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #9ca3af;
  border: 2px dashed #e5e7eb;
  border-radius: 4px;
}

.image-caption {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}
</style>
