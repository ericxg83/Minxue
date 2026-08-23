<template>
  <span :class="['ds-status-tag', `is-${tone}`]">
    <i aria-hidden="true" />
    <slot>{{ label }}</slot>
  </span>
</template>

<script setup>
defineProps({
  label: String,
  tone: { type: String, default: 'default' }
})
</script>

<style scoped>
.ds-status-tag{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;box-sizing:border-box;color:var(--wb-text-secondary);font-size:10px;font-weight:600;background:var(--wb-bg-elevated);border-radius:5px;white-space:nowrap}.ds-status-tag i{width:6px;height:6px;background:var(--wb-text-tertiary);border-radius:50%}.is-primary{color:var(--wb-primary);background:var(--wb-primary-soft)}.is-primary i{background:var(--wb-primary)}.is-success{color:var(--wb-success);background:var(--wb-success-soft)}.is-success i{background:var(--wb-success)}.is-warning{color:var(--wb-warning);background:var(--wb-warning-soft)}.is-warning i{background:var(--wb-warning)}.is-danger{color:var(--wb-danger);background:var(--wb-danger-soft)}.is-danger i{background:var(--wb-danger)}
</style>
