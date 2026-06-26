<template>
  <div class="virtual-list" ref="containerRef" @scroll="handleScroll">
    <div class="virtual-list-phantom" :style="{ height: totalHeight + 'px' }"></div>
    <div class="virtual-list-content" :style="{ transform: `translateY(${offsetY}px)` }">
      <div
        v-for="item in visibleItems"
        :key="item[itemKey]"
        class="virtual-list-item"
        :style="{ height: itemHeight + 'px' }"
      >
        <slot :item="item" :index="item._index"></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  itemHeight: {
    type: Number,
    default: 100
  },
  itemKey: {
    type: String,
    default: 'id'
  },
  // 缓冲区数量（上下各渲染几个额外的元素，防止快速滚动时白屏）
  bufferSize: {
    type: Number,
    default: 5
  }
})

const containerRef = ref(null)
const scrollTop = ref(0)
const containerHeight = ref(0)

// 总高度
const totalHeight = computed(() => props.items.length * props.itemHeight)

// 可见区域的起始索引
const startIndex = computed(() => {
  const index = Math.floor(scrollTop.value / props.itemHeight)
  return Math.max(0, index - props.bufferSize)
})

// 可见区域的结束索引
const endIndex = computed(() => {
  const visibleCount = Math.ceil(containerHeight.value / props.itemHeight)
  const index = startIndex.value + visibleCount
  return Math.min(props.items.length, index + props.bufferSize)
})

// 可见的元素列表
const visibleItems = computed(() => {
  return props.items.slice(startIndex.value, endIndex.value).map((item, idx) => ({
    ...item,
    _index: startIndex.value + idx
  }))
})

// 偏移量
const offsetY = computed(() => startIndex.value * props.itemHeight)

// 滚动处理（使用 requestAnimationFrame 优化）
let rafId = null
const handleScroll = () => {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    if (containerRef.value) {
      scrollTop.value = containerRef.value.scrollTop
    }
    rafId = null
  })
}

// 更新容器高度
const updateContainerHeight = () => {
  if (containerRef.value) {
    containerHeight.value = containerRef.value.clientHeight
  }
}

// 监听窗口大小变化
let resizeObserver = null

onMounted(() => {
  updateContainerHeight()

  // 使用 ResizeObserver 监听容器大小变化
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerHeight()
    })
    if (containerRef.value) {
      resizeObserver.observe(containerRef.value)
    }
  } else {
    // 降级方案：使用 window resize
    window.addEventListener('resize', updateContainerHeight)
  }
})

onUnmounted(() => {
  if (rafId) {
    cancelAnimationFrame(rafId)
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
  } else {
    window.removeEventListener('resize', updateContainerHeight)
  }
})

// 重置滚动位置（当 items 变化时）
watch(() => props.items.length, () => {
  if (containerRef.value) {
    containerRef.value.scrollTop = 0
  }
  scrollTop.value = 0
})

// 暴露方法：滚动到指定索引
const scrollToIndex = (index) => {
  if (containerRef.value) {
    const targetScrollTop = Math.min(
      index * props.itemHeight,
      totalHeight.value - containerHeight.value
    )
    containerRef.value.scrollTop = Math.max(0, targetScrollTop)
  }
}

defineExpose({
  scrollToIndex
})
</script>

<style scoped>
.virtual-list {
  height: 100%;
  overflow-y: auto;
  position: relative;
}

.virtual-list-phantom {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  z-index: -1;
}

.virtual-list-content {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
}

.virtual-list-item {
  overflow: hidden;
}
</style>
