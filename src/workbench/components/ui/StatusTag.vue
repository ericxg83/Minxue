<template>
  <span :class="['ds-status-tag', `is-${tone}`, { 'no-dot': !dot }]">
    <i v-if="dot" aria-hidden="true" />
    <slot>{{ label }}</slot>
  </span>
</template>

<script setup>
/**
 * StatusTag · 状态徽标唯一标准组件
 *
 * 唯一实现：禁止业务页自行实现 .status-badge / .risk-status / .mastery-status
 * 6 档状态：neutral | success | info | warning | danger | processing
 *
 * 用法：
 *   <StatusTag tone="success" label="已掌握" />
 *   <StatusTag tone="warning">待处理</StatusTag>
 *   <StatusTag tone="danger" :dot="false">处理异常</StatusTag>
 */
defineProps({
  label: { type: String, default: '' },
  tone: {
    type: String,
    default: 'neutral',
    validator: (v) => ['neutral', 'success', 'info', 'warning', 'danger', 'processing'].includes(v)
  },
  dot: { type: Boolean, default: true }
})
</script>

<style scoped>
.ds-status-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--wb-tag-gap);
  height: var(--wb-tag-height);
  padding: var(--wb-tag-padding);
  box-sizing: border-box;
  color: var(--wb-status-neutral-fg);
  font-size: var(--wb-tag-fs);
  font-weight: var(--wb-tag-fw);
  background: var(--wb-status-neutral-bg);
  border-radius: var(--wb-tag-radius);
  white-space: nowrap;
  letter-spacing: 0.01em;
}
.ds-status-tag i {
  width: var(--wb-tag-dot-size);
  height: var(--wb-tag-dot-size);
  background: var(--wb-status-neutral-fg);
  border-radius: 50%;
  flex-shrink: 0;
}
.ds-status-tag.no-dot { padding-left: 9px; }

.is-success { color: var(--wb-status-success-fg); background: var(--wb-status-success-bg); }
.is-success i { background: var(--wb-status-success-fg); }

.is-info { color: var(--wb-status-info-fg); background: var(--wb-status-info-bg); }
.is-info i { background: var(--wb-status-info-fg); }

.is-warning { color: var(--wb-status-warning-fg); background: var(--wb-status-warning-bg); }
.is-warning i { background: var(--wb-status-warning-fg); }

.is-danger { color: var(--wb-status-danger-fg); background: var(--wb-status-danger-bg); }
.is-danger i { background: var(--wb-status-danger-fg); }

.is-processing { color: var(--wb-status-processing-fg); background: var(--wb-status-processing-bg); }
.is-processing i { background: var(--wb-status-processing-fg); }
</style>