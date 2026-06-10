<template>
  <div class="filter-panel">
    <!-- Subject filter -->
    <div class="filter-section">
      <div class="section-title">科目</div>
      <div class="options">
        <div
          v-for="option in subjectOptions"
          :key="option.key"
          class="option-chip"
          :class="{ active: filters.subject === option.key }"
          @click="$emit('update-filter', 'subject', option.key)"
        >
          {{ option.label }}
        </div>
      </div>
    </div>

    <!-- Time filter -->
    <div class="filter-section">
      <div class="section-title">加入时间</div>
      <div class="options">
        <div
          v-for="option in timeOptions"
          :key="option.key"
          class="option-chip"
          :class="{ active: filters.time === option.key }"
          @click="$emit('update-filter', 'time', option.key)"
        >
          {{ option.label }}
        </div>
      </div>
    </div>

    <!-- Error count filter -->
    <div class="filter-section">
      <div class="section-title">错误次数</div>
      <div class="options">
        <div
          v-for="option in errorCountOptions"
          :key="option.key"
          class="option-chip"
          :class="{ active: filters.errorCount === option.key }"
          @click="$emit('update-filter', 'errorCount', option.key)"
        >
          {{ option.label }}
        </div>
      </div>
    </div>

    <!-- Category filter -->
    <div class="filter-section">
      <div class="section-title">分类</div>
      <div class="options">
        <div
          v-for="option in categoryOptions"
          :key="option.key"
          class="option-chip"
          :class="{ active: filters.category === option.key }"
          @click="$emit('update-filter', 'category', option.key)"
        >
          {{ option.label }}
        </div>
      </div>
    </div>

    <!-- Tag filter -->
    <div v-if="allTags.length > 0" class="filter-section">
      <div class="section-title">知识点标签</div>
      <div class="options">
        <div
          class="option-chip"
          :class="{ active: filters.tag === 'all' }"
          @click="$emit('update-filter', 'tag', 'all')"
        >
          全部标签
        </div>
        <div
          v-for="tag in allTags"
          :key="tag"
          class="option-chip tag-chip"
          :class="{ active: filters.tag === tag }"
          @click="$emit('update-filter', 'tag', tag)"
        >
          {{ tag }}
        </div>
      </div>
    </div>

    <!-- Sort options -->
    <div class="filter-section">
      <div class="section-title">排序方式</div>
      <div class="options">
        <div
          v-for="option in sortOptions"
          :key="option.key"
          class="option-chip"
          :class="{ active: sortBy === option.key }"
          @click="$emit('update-sort', option.key)"
        >
          {{ option.label }}
        </div>
      </div>
    </div>

    <!-- Bottom actions -->
    <div class="filter-actions">
      <el-button class="action-btn" @click="$emit('reset')">重置</el-button>
      <el-button type="primary" class="action-btn confirm-btn" @click="$emit('confirm')">
        确定
      </el-button>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  filters: {
    type: Object,
    default: () => ({
      subject: 'all',
      time: 'all',
      errorCount: 'all',
      category: 'all',
      tag: 'all'
    })
  },
  sortBy: {
    type: String,
    default: 'time_desc'
  },
  allTags: {
    type: Array,
    default: () => []
  }
})

defineEmits(['update-filter', 'update-sort', 'reset', 'confirm'])

const subjectOptions = [
  { key: 'all', label: '全部科目' },
  { key: '数学', label: '数学' },
  { key: '语文', label: '语文' },
  { key: '英语', label: '英语' },
  { key: '物理', label: '物理' },
  { key: '化学', label: '化学' }
]

const timeOptions = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '最近7天' },
  { key: 'month', label: '最近30天' },
  { key: 'quarter', label: '最近3个月' }
]

const errorCountOptions = [
  { key: 'all', label: '全部次数' },
  { key: '1', label: '1次' },
  { key: '2-3', label: '2-3次' },
  { key: '4-5', label: '4-5次' },
  { key: '5+', label: '5次以上' }
]

const categoryOptions = [
  { key: 'all', label: '全部分类' },
  { key: 'wrong', label: '错题' },
  { key: 'unanswered', label: '未作答' }
]

const sortOptions = [
  { key: 'time_desc', label: '最新加入' },
  { key: 'time_asc', label: '最早加入' },
  { key: 'error_desc', label: '错次最多' },
  { key: 'error_asc', label: '错次最少' },
  { key: 'subject', label: '按科目' }
]
</script>

<style scoped>
.filter-panel {
  padding: 16px;
  background: #fff;
  max-height: 80vh;
  overflow-y: auto;
}

.filter-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 15px;
  color: #1c1c1e;
  margin-bottom: 12px;
  font-weight: 500;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option-chip {
  padding: 10px 18px;
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
  background: #f2f2f7;
  color: #8e8e93;
  font-weight: 400;
  transition: all 0.2s;
  user-select: none;
}

.option-chip:hover {
  opacity: 0.85;
}

.option-chip.active {
  background: var(--el-color-primary);
  color: #fff;
  font-weight: 500;
}

.option-chip.tag-chip.active {
  background: #fa8c16;
  color: #fff;
}

.filter-actions {
  display: flex;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid #e5e5ea;
}

.action-btn {
  flex: 1;
  border-radius: 10px;
}

.confirm-btn {
  background: var(--el-color-primary);
}
</style>
