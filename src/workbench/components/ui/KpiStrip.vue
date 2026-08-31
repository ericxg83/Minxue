<template>
  <section :class="['ds-kpi-strip', { 'is-clickable': clickable, 'has-icons': hasIcons, 'has-sparkline': hasSparkline }]" :aria-label="ariaLabel">
    <component
      :is="item.href ? 'a' : 'button'"
      v-for="(item, index) in items"
      :key="item.key || item.label || index"
      :href="item.href"
      :type="item.href ? undefined : 'button'"
      :class="['kpi-cell', { 'is-last': index === items.length - 1, 'is-danger': item.tone === 'danger' }]"
      :disabled="item.disabled || undefined"
      @click="item.onClick && !item.disabled && item.onClick(item)"
    >
      <span v-if="item.icon" class="kpi-icon" :class="`is-${item.tone || 'default'}`">
        <el-icon><component :is="item.icon" /></el-icon>
      </span>
      <span :class="['kpi-value', `is-${item.tone || 'default'}`]">
        {{ item.value }}<small v-if="item.unit">{{ item.unit }}</small>
      </span>
      <span class="kpi-label">{{ item.label }}</span>
      <span v-if="item.sparkline && item.sparkline.length" class="kpi-sparkline" :aria-label="`${item.label} 趋势`">
        <svg :viewBox="`0 0 ${sparklineWidth} ${sparklineHeight}`" :width="sparklineWidth" :height="sparklineHeight" preserveAspectRatio="none">
          <path :d="fillPath(item.sparkline)" :fill="`var(--wb-sparkline-fill)`" opacity="0.5" />
          <path :d="linePath(item.sparkline)" fill="none" :stroke="`var(--wb-sparkline-stroke)`" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
      </span>
      <span v-if="item.actionLabel" class="kpi-action">
        {{ item.actionLabel }}<el-icon v-if="item.actionIcon"><component :is="item.actionIcon" /></el-icon>
      </span>
    </component>
  </section>
</template>

<script setup>
/**
 * KpiStrip · 敏学 PC 工作台 KPI 官方标准组件
 *
 * 基准来自 DashboardWorkbench 的 .summary-strip 模式：
 *   - 4 列等宽，靠 border 分隔建立层级
 *   - 数字 + label 为主，tabular-nums 对齐
 *   - 整行可点击，整行 hover 高亮
 *
 * Phase 5 扩展（C28 大彩色 icon / C26 sparkline / A14 0 值禁用）：
 *   - item.icon    Element Plus icon 组件，渲染为左侧 40px 圆形带色块
 *   - item.sparkline  数字数组，渲染 88×28 SVG 折线
 *   - item.disabled  灰显 + 不可点击
 *   - tone colors: default / primary / success / info / warning / danger / processing
 */
import { computed } from 'vue'

const props = defineProps({
  items: {
    type: Array,
    required: true,
    validator: (arr) => arr.every((it) => it && it.label != null && it.value != null)
  },
  ariaLabel: { type: String, default: '关键指标' },
  clickable: { type: Boolean, default: true }
})

const hasIcons = computed(() => props.items.some((it) => it.icon))
const hasSparkline = computed(() => props.items.some((it) => it.sparkline && it.sparkline.length))

const sparklineWidth = 88
const sparklineHeight = 28

const normalize = (data) => {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  return data.map((v) => (v - min) / range)
}

const linePath = (data) => {
  const norm = normalize(data)
  const stepX = sparklineWidth / Math.max(1, data.length - 1)
  return norm.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${(sparklineHeight - y * sparklineHeight).toFixed(2)}`).join(' ')
}

const fillPath = (data) => {
  const line = linePath(data)
  return `${line} L${sparklineWidth.toFixed(2)},${sparklineHeight.toFixed(2)} L0,${sparklineHeight.toFixed(2)} Z`
}
</script>

<style scoped>
.ds-kpi-strip {
  display: grid;
  grid-template-columns: repeat(v-bind('items.length'), minmax(0, 1fr));
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  overflow: hidden;
}
.kpi-cell {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  column-gap: var(--wb-space-3);
  row-gap: var(--wb-space-1);
  min-height: 82px;
  padding: var(--wb-space-4) var(--wb-space-5);
  box-sizing: border-box;
  text-align: left;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--wb-border-light);
  color: inherit;
  cursor: default;
  font: inherit;
  text-decoration: none;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.is-clickable .kpi-cell { cursor: pointer; }
.is-clickable .kpi-cell:hover { background: var(--wb-primary-mist); }
.is-clickable .kpi-cell:hover .kpi-icon { transform: scale(1.04); }
.kpi-cell.is-last { border-right: 0; }
.kpi-cell:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
.kpi-cell:disabled:hover { background: transparent; }

/* 评审 C28：大号彩色 icon 块（临时覆盖 DS 27.1） */
.has-icons .kpi-cell { grid-template-columns: auto 1fr; column-gap: var(--wb-space-3); }
.kpi-icon {
  grid-row: span 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--wb-radius-md);
  background: var(--wb-primary-soft);
  color: var(--wb-primary);
  flex-shrink: 0;
  transition: transform var(--wb-motion-base) var(--wb-motion-ease);
}
.kpi-icon .el-icon { font-size: 20px; }
.kpi-icon.is-primary { background: var(--wb-primary-soft); color: var(--wb-primary); }
.kpi-icon.is-success { background: var(--wb-status-success-bg); color: var(--wb-status-success-fg); }
.kpi-icon.is-info { background: var(--wb-status-info-bg); color: var(--wb-status-info-fg); }
.kpi-icon.is-warning { background: var(--wb-status-warning-bg); color: var(--wb-status-warning-fg); }
.kpi-icon.is-danger { background: var(--wb-status-danger-bg); color: var(--wb-status-danger-fg); }
.kpi-icon.is-processing { background: var(--wb-status-processing-bg); color: var(--wb-status-processing-fg); }
.kpi-icon.is-default { background: var(--wb-bg-hover); color: var(--wb-text-secondary); }

.kpi-value {
  grid-row: span 2;
  color: var(--wb-text);
  font-size: var(--wb-fs-stat);
  font-weight: var(--wb-fw-bold);
  line-height: var(--wb-lh-tight);
  font-variant-numeric: tabular-nums;
}
.kpi-value small {
  margin-left: var(--wb-space-1);
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
}
.kpi-value.is-primary { color: var(--wb-primary); }
.kpi-value.is-success { color: var(--wb-status-success-fg); }
.kpi-value.is-info { color: var(--wb-status-info-fg); }
.kpi-value.is-warning { color: var(--wb-status-warning-fg); }
.kpi-value.is-danger { color: var(--wb-status-danger-fg); }
.kpi-value.is-processing { color: var(--wb-status-processing-fg); }
.kpi-label {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi-sparkline {
  grid-column: 2;
  display: block;
  width: var(--wb-sparkline-width);
  height: var(--wb-sparkline-height);
  margin-top: 2px;
}
.kpi-sparkline svg { display: block; width: 100%; height: 100%; }
.has-icons .kpi-sparkline { grid-column: 2 / -1; }

.kpi-action {
  grid-column: 2;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
}
.kpi-action .el-icon { font-size: 12px; }

@media (max-width: 1000px) {
  .ds-kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpi-cell:nth-child(2) { border-right: 0; }
  .kpi-cell:nth-child(-n+2) { border-bottom: 1px solid var(--wb-border-light); }
}
@media (max-width: 640px) {
  .ds-kpi-strip { grid-template-columns: 1fr; }
  .kpi-cell { border-right: 0; border-bottom: 1px solid var(--wb-border-light); }
  .kpi-cell:last-child { border-bottom: 0; }
}
</style>
