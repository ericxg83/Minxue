<template>
  <div class="pagination-bar">
    <el-pagination
      v-model:current-page="currentPageProxy"
      v-model:page-size="pageSizeProxy"
      :page-sizes="[10, 20, 50, 100]"
      :total="total"
      :background="true"
      layout="total, sizes, prev, pager, next, jumper"
      @change="handleChange"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  currentPage: {
    type: Number,
    default: 1
  },
  totalPages: {
    type: Number,
    default: 1
  },
  pageSize: {
    type: Number,
    default: 20
  },
  total: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['page-change', 'size-change'])

const currentPageProxy = computed({
  get: () => props.currentPage,
  set: (val) => emit('page-change', val)
})

const pageSizeProxy = computed({
  get: () => props.pageSize,
  set: (val) => emit('size-change', val)
})

function handleChange() {
  // el-pagination handles both current-page and page-size changes
}
</script>

<style scoped>
.pagination-bar {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}
</style>
