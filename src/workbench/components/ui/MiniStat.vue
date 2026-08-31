<template>
  <div :class="['ds-mini-stat', { 'is-emphasis': emphasis }]">
    <dt class="label">{{ label }}</dt>
    <dd class="value">
      <strong :class="['value-num', `is-${tone}`]">{{ value }}</strong>
      <small v-if="unit" class="unit">{{ unit }}</small>
    </dd>
    <p v-if="description" class="description">{{ description }}</p>
  </div>
</template>

<script setup>
/**
 * MiniStat · 卡片内嵌迷你统计
 *
 * 用于 ContentCard 内部或同行多列的迷你数字（如批改中心任务摘要的 题目/状态/错题）。
 * 不带边框、不带 padding，遵循父容器节奏。
 *
 * 6 档状态色与 StatusTag 一致。
 *
 * 用法：
 *   <dl class="ds-mini-stat-grid">
 *     <MiniStat label="题目" :value="12" unit="题" />
 *     <MiniStat label="错题" :value="3" unit="题" tone="danger" emphasis />
 *     <MiniStat label="处理状态" value="已批改" />
 *   </dl>
 */
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  unit: { type: String, default: '' },
  description: { type: String, default: '' },
  tone: {
    type: String,
    default: 'default',
    validator: (v) => ['default', 'success', 'info', 'warning', 'danger', 'processing'].includes(v)
  },
  emphasis: { type: Boolean, default: false }
})
</script>

<style scoped>
.ds-mini-stat {
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-1);
  min-width: 0;
}
.label {
  margin: 0;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
  letter-spacing: 0.01em;
}
.value {
  display: flex;
  align-items: baseline;
  gap: var(--wb-space-1);
  margin: 0;
}
.value-num {
  color: var(--wb-text);
  font-size: var(--wb-fs-card-title);
  font-weight: var(--wb-fw-bold);
  line-height: var(--wb-lh-tight);
  font-variant-numeric: tabular-nums;
}
.is-emphasis .value-num { font-size: var(--wb-fs-stat); }
.unit {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
  font-weight: var(--wb-fw-medium);
}
.description {
  margin: var(--wb-space-1) 0 0;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-caption);
  line-height: var(--wb-lh-normal);
}

.is-success { color: var(--wb-status-success-fg); }
.is-info { color: var(--wb-status-info-fg); }
.is-warning { color: var(--wb-status-warning-fg); }
.is-danger { color: var(--wb-status-danger-fg); }
.is-processing { color: var(--wb-status-processing-fg); }
</style>