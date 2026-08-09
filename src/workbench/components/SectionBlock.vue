<template>
  <div class="section-block">
    <span 
      class="editable-text section-content"
      @click="$emit('edit', block)"
    >{{ block.content }}</span>
  </div>
</template>

<script setup>
defineProps({
  block: { type: Object, required: true },
  pageNo: { type: Number, default: 1 },
  blockIndex: { type: Number, default: -1 }
})

defineEmits(['edit'])
</script>

<style scoped>
.section-block {
  margin: 16px 0 8px;
  padding: 8px;
  background: #f9fafb;
  border-radius: var(--wb-radius-xs);
  border-left: 3px solid var(--wb-primary);
}

.section-content {
  font-size: 14px;
  font-weight: 600;
  color: #1e40af;
}

.editable-text {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--wb-radius-xs);
  transition: background 0.2s;
}

.editable-text:hover {
  background: #eff6ff;
}
</style>
