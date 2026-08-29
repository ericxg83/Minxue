<template>
  <span
    class="status-icon"
    :class="'status-' + state"
    :style="{ width: size + 'px', height: size + 'px' }"
    :title="label"
    role="img"
    :aria-label="label"
  >
    <svg :viewBox="viewBox" :width="size" :height="size" aria-hidden="true">
      <!-- 圆形底（correct / wrong / pending / processing） -->
      <circle
        v-if="shape === 'circle'"
        :cx="size / 2"
        :cy="size / 2"
        :r="size / 2 - 1"
        :fill="color"
      />
      <!-- 三角形底（exception） -->
      <path
        v-else
        :d="trianglePath"
        :fill="color"
      />

      <!-- correct: ✓ -->
      <path
        v-if="state === 'correct'"
        :d="checkPath"
        fill="none"
        :stroke="'#fff'"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <!-- wrong: ✗ -->
      <path
        v-else-if="state === 'wrong'"
        :d="crossPath"
        fill="none"
        stroke="#fff"
        stroke-width="2"
        stroke-linecap="round"
      />
      <!-- pending / exception: ! -->
      <g v-else-if="state === 'pending' || state === 'exception'">
        <rect
          :x="size / 2 - 1"
          :y="size * 0.24"
          width="2"
          :height="size * 0.34"
          rx="1"
          fill="#fff"
        />
        <circle :cx="size / 2" :cy="size * 0.7" r="1.3" fill="#fff" />
      </g>
      <!-- processing: … -->
      <g v-else-if="state === 'processing'">
        <circle :cx="size * 0.3" :cy="size / 2" r="1.4" fill="#fff" />
        <circle :cx="size * 0.5" :cy="size / 2" r="1.4" fill="#fff" />
        <circle :cx="size * 0.7" :cy="size / 2" r="1.4" fill="#fff" />
      </g>
    </svg>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { REVIEW_STATE_LABELS } from '../../../utils/reviewDecision'

const props = defineProps({
  state: { type: String, default: 'pending' }, // correct | wrong | pending | exception | processing
  size: { type: Number, default: 18 }
})

const COLORS = {
  // 语义色收敛到 --wb-* token（一类事实一个主要来源）
  correct: 'var(--wb-success)',
  wrong: 'var(--wb-danger)',
  pending: 'var(--wb-warning)',
  exception: 'var(--wb-accent)',
  processing: 'var(--wb-processing)'
}

const color = computed(() => COLORS[props.state] || COLORS.pending)
// 文案表同源：src/utils/reviewDecision.js 的 REVIEW_STATE_LABELS
const label = computed(() => REVIEW_STATE_LABELS[props.state] || '')
const shape = computed(() => (props.state === 'exception' ? 'triangle' : 'circle'))
const viewBox = computed(() => `0 0 ${props.size} ${props.size}`)

// 三角形（exception）：等边三角形，底部水平，尖端朝上，留 1px 边距
const trianglePath = computed(() => {
  const s = props.size
  const m = 1
  const top = m
  const bottom = s - m
  const halfBase = (s - 2 * m) / 2
  const midX = s / 2
  return `M ${midX} ${top} L ${midX + halfBase} ${bottom} L ${midX - halfBase} ${bottom} Z`
})

// ✓ 对勾路径（相对 size 缩放）
const checkPath = computed(() => {
  const s = props.size
  const x1 = s * 0.28, y1 = s * 0.52
  const x2 = s * 0.43, y2 = s * 0.67
  const x3 = s * 0.73, y3 = s * 0.34
  return `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3}`
})

// ✗ 叉号路径
const crossPath = computed(() => {
  const s = props.size
  const a = s * 0.32, b = s * 0.68
  return `M ${a} ${a} L ${b} ${b} M ${b} ${a} L ${a} ${b}`
})
</script>

<style scoped>
.status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 0;
}
.status-icon svg {
  display: block;
}
</style>
