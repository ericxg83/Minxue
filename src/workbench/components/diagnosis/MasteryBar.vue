<script setup>
/**
 * 错题掌握度三态条（r130）。
 *
 * 为什么加（负责人 2026-10-04 截图质疑「完全掌握只有 2，基本掌握是不是没计入」）：
 * 旧口径只有「完全掌握」和「待提升」两格，而「待提升」= 基本掌握 + 待复习，
 * 于是陆晨曦 74 道错题显示成「2 / 72」——实际已记住 16 道，页面只承认 2 道。
 * 这条把三层同时摊开，宽度按真实占比，家长一眼看到「绿色+蓝色占了一大半」。
 */
import { computed } from 'vue'

const props = defineProps({
  mastered: { type: Number, default: 0 },
  basic: { type: Number, default: 0 },
  todo: { type: Number, default: 0 }
})

const total = computed(() => Math.max(0, props.mastered) + Math.max(0, props.basic) + Math.max(0, props.todo))
const pct = (n) => (total.value > 0 ? (Math.max(0, n) / total.value) * 100 : 0)
// 只显示有占比的段，宽度用 inline style（flex-basis），零测量、不读 DOM
const segments = computed(() => [
  { key: 'mastered', label: '完全掌握', count: props.mastered || 0, width: pct(props.mastered), tone: 'is-mastered' },
  { key: 'basic', label: '基本掌握', count: props.basic || 0, width: pct(props.basic), tone: 'is-basic' },
  { key: 'todo', label: '待复习', count: props.todo || 0, width: pct(props.todo), tone: 'is-todo' }
].filter(s => s.width > 0))
</script>

<template>
  <div v-if="total > 0" class="mastery-bar">
    <div class="mastery-bar__caption">
      <span>错题掌握度（{{ total }} 道）</span>
      <strong>已掌握 {{ (mastered || 0) + (basic || 0) }} 道</strong>
    </div>
    <div class="mastery-bar__track">
      <span
        v-for="segment in segments"
        :key="segment.key"
        class="mastery-bar__seg"
        :class="segment.tone"
        :style="{ flexBasis: `${segment.width}%` }"
        :title="`${segment.label} ${segment.count} 道`"
      />
    </div>
    <ul class="mastery-bar__legend">
      <li v-for="segment in segments" :key="segment.key" :class="segment.tone">
        <i />{{ segment.label }}<b>{{ segment.count }}</b>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mastery-bar{margin-top:14px}
.mastery-bar__caption{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px}
.mastery-bar__caption span{color:var(--wb-text-tertiary);font-size:10px}
.mastery-bar__caption strong{color:var(--wb-success);font-size:12px;font-weight:600}
.mastery-bar__track{display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--wb-bg-elevated)}
.mastery-bar__seg{display:block;min-width:3px;height:100%}
.is-mastered{background:var(--wb-success)}
.is-basic{background:var(--wb-primary)}
.is-todo{background:var(--wb-warning)}
.mastery-bar__legend{display:flex;gap:16px;margin:8px 0 0;padding:0;list-style:none;flex-wrap:wrap}
.mastery-bar__legend li{display:flex;align-items:center;gap:5px;color:var(--wb-text-secondary);font-size:10px}
.mastery-bar__legend i{width:7px;height:7px;border-radius:2px;background:currentColor;opacity:.75}
.mastery-bar__legend b{color:var(--wb-text);font-size:11px;font-weight:600}
.mastery-bar__legend .is-mastered{color:var(--wb-success)}
.mastery-bar__legend .is-basic{color:var(--wb-primary)}
.mastery-bar__legend .is-todo{color:var(--wb-warning)}
</style>
