<template>
  <div class="lazy-image-container" :style="containerStyle" ref="containerRef">
    <img
      v-if="loaded || error"
      :src="error ? placeholder : imageSrc"
      :alt="alt"
      :class="['lazy-image', { 'is-loaded': loaded, 'is-error': error }]"
      @load="onLoad"
      @error="onError"
    />
    <div v-else class="lazy-image-placeholder">
      <el-icon v-if="!loading"><Picture /></el-icon>
      <el-icon v-else class="is-loading"><Loading /></el-icon>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Picture, Loading } from '@element-plus/icons-vue'

const props = defineProps({
  src: {
    type: String,
    default: ''
  },
  alt: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  width: {
    type: [String, Number],
    default: '100%'
  },
  height: {
    type: [String, Number],
    default: 'auto'
  },
  // IntersectionObserver rootMargin (提前加载距离)
  rootMargin: {
    type: String,
    default: '50px'
  }
})

const imageSrc = ref('')
const loading = ref(false)
const loaded = ref(false)
const error = ref(false)
const containerRef = ref(null)
let observer = null

const containerStyle = computed(() => ({
  width: typeof props.width === 'number' ? `${props.width}px` : props.width,
  height: typeof props.height === 'number' ? `${props.height}px` : props.height
}))

const onLoad = () => {
  loaded.value = true
  loading.value = false
}

const onError = () => {
  error.value = true
  loading.value = false
}

const loadImage = () => {
  if (!props.src || loading.value || loaded.value) return
  loading.value = true
  imageSrc.value = props.src
}

onMounted(() => {
  // 使用 IntersectionObserver 实现懒加载
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadImage()
            if (observer && entry.target) {
              observer.unobserve(entry.target)
            }
          }
        })
      },
      {
        rootMargin: props.rootMargin
      }
    )

    if (containerRef.value) {
      observer.observe(containerRef.value)
    }
  } else {
    // 不支持 IntersectionObserver，直接加载
    loadImage()
  }
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
})
</script>

<style scoped>
.lazy-image-container {
  position: relative;
  overflow: hidden;
  background: #f5f7fa;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lazy-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.lazy-image.is-loaded {
  opacity: 1;
}

.lazy-image.is-error {
  opacity: 0.5;
}

.lazy-image-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 24px;
}

.lazy-image-placeholder .el-icon.is-loading {
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
