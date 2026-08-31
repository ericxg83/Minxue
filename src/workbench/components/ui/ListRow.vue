<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    :class="['ds-list-row', `is-${variant}`, { 'is-clickable': clickable, 'is-disabled': disabled }]"
    :disabled="clickable ? disabled : undefined"
    @click="onClick"
  >
    <span v-if="$slots.leading" class="row-leading"><slot name="leading" /></span>
    <span class="row-content">
      <strong v-if="title || $slots.title" class="row-title">
        <slot name="title">{{ title }}</slot>
      </strong>
      <small v-if="description || $slots.description" class="row-description">
        <slot name="description">{{ description }}</slot>
      </small>
    </span>
    <span v-if="$slots.meta" class="row-meta"><slot name="meta" /></span>
    <span v-if="$slots.trailing" class="row-trailing"><slot name="trailing" /></span>
  </component>
</template>

<script setup>
/**
 * ListRow · 列表行 雏形（Phase 5 · 评审 B23）
 *
 * 抽离自 DashboardWorkbench 的 .todo-row / .student-row。
 * 当前为雏形：覆盖 PC 桌面场景，行高走 --wb-row-min-height，移动端走 --wb-row-min-height-touch。
 *
 * variant: todo | student | generic
 * clickable: 整行作为 <button>，可键盘 Tab + Enter/Space
 * disabled: 灰显 + cursor not-allowed
 */
defineProps({
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  variant: {
    type: String,
    default: 'generic',
    validator: (v) => ['todo', 'student', 'generic'].includes(v)
  },
  clickable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['click'])
const onClick = (e) => emit('click', e)
</script>

<style scoped>
.ds-list-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: var(--wb-space-3);
  min-height: var(--wb-row-min-height);
  padding: var(--wb-space-3) var(--wb-space-3);
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--wb-border-light);
  box-sizing: border-box;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.ds-list-row:last-child { border-bottom: 0; }
.is-clickable { cursor: pointer; }
.is-clickable:hover { background: var(--wb-bg-hover); }
.is-clickable:active { background: var(--wb-bg-hover); }
.is-disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }

.row-leading { flex: 0 0 auto; display: inline-flex; align-items: center; }
.row-content { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
.row-title { overflow: hidden; color: var(--wb-text); font-size: var(--wb-fs-body); font-weight: var(--wb-fw-semibold); text-overflow: ellipsis; white-space: nowrap; }
.row-description { overflow: hidden; color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); text-overflow: ellipsis; white-space: nowrap; }
.row-meta { flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--wb-space-2); color: var(--wb-text-tertiary); font-size: var(--wb-fs-meta); }
.row-trailing { flex: 0 0 auto; color: var(--wb-text-tertiary); display: inline-flex; align-items: center; }

.is-student { padding: var(--wb-space-3) var(--wb-space-3); }
.is-todo { padding: var(--wb-space-3) var(--wb-space-2); }

@media (max-width: 640px) {
  .ds-list-row { min-height: var(--wb-row-min-height-touch); }
}
</style>
