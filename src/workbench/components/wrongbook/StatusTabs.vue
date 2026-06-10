<template>
  <div class="status-tabs">
    <div
      v-for="tab in tabs"
      :key="tab.key"
      class="status-tab"
      :class="{ active: activeStatus === tab.key }"
      :style="tabStyle(tab.key)"
      @click="$emit('change-status', tab.key)"
    >
      {{ tab.label }} {{ counts[tab.key] ?? 0 }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  activeStatus: {
    type: String,
    default: 'all'
  },
  counts: {
    type: Object,
    default: () => ({ all: 0, pending: 0, partial: 0, mastered: 0 })
  }
})

defineEmits(['change-status'])

const tabs = [
  { key: 'all', label: '全部', color: '#007aff' },
  { key: 'pending', label: '未掌握', color: '#ff3b30' },
  { key: 'partial', label: '有点掌握', color: '#ff9500' },
  { key: 'mastered', label: '完全掌握', color: '#34c759' }
]

function tabStyle(key) {
  const isActive = props.activeStatus === key
  const color = tabs.find(t => t.key === key)?.color || '#007aff'
  return {
    background: isActive ? color : '#f2f2f7',
    color: isActive ? '#fff' : '#8e8e93',
    fontWeight: isActive ? 600 : 400,
    boxShadow: isActive ? `0 2px 8px ${color}40` : 'none'
  }
}
</script>

<style scoped>
.status-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e5ea;
}

.status-tab {
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.status-tab:hover {
  opacity: 0.85;
}
</style>
