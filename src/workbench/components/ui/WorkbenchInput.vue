<template>
  <el-input
    :model-value="modelValue"
    :placeholder="placeholder"
    :maxlength="maxlength"
    :show-word-limit="showWordLimit"
    :clearable="clearable"
    :type="type"
    :rows="rows"
    :autosize="autosize"
    :disabled="disabled"
    class="wb-input"
    :style="{ width }"
    :aria-label="ariaLabel || undefined"
    @update:model-value="val => $emit('update:modelValue', val)"
    @keyup.enter="$emit('keyup.enter', $event)"
  >
    <template v-if="$slots.prefix" #prefix>
      <slot name="prefix" />
    </template>
    <template v-if="$slots.suffix" #suffix>
      <slot name="suffix" />
    </template>
    <template v-if="$slots.prepend" #prepend>
      <slot name="prepend" />
    </template>
    <template v-if="$slots.append" #append>
      <slot name="append" />
    </template>
  </el-input>
</template>

<script setup>
/**
 * WorkbenchInput · 敏学 PC 工作台输入框统一组件
 *
 * 包裹 Element Plus el-input，对外暴露敏学 token 化的视觉规范：
 *   - 圆角 8px（--wb-radius-sm，与 WorkbenchSelect 一致）
 *   - 高度 34px
 *   - 边框 1px --wb-border / focus 2px --wb-primary
 *   - 占位 --wb-text-tertiary
 *
 * 支持 prefix / suffix / prepend / append 4 个 slot（与 el-input 等价）。
 *
 * 用法：
 *   <WorkbenchInput
 *     v-model="search"
 *     placeholder="搜索学生"
 *     clearable
 *     aria-label="按学生姓名搜索"
 *   >
 *     <template #prefix><el-icon><Search /></el-icon></template>
 *   </WorkbenchInput>
 *
 *   <WorkbenchInput
 *     v-model="form.name"
 *     :maxlength="30"
 *     show-word-limit
 *     placeholder="请输入学生姓名"
 *     @keyup.enter="save"
 *   />
 */
defineProps({
  modelValue: { default: '' },
  placeholder: { type: String, default: '' },
  maxlength: { type: [String, Number], default: undefined },
  showWordLimit: { type: Boolean, default: false },
  clearable: { type: Boolean, default: false },
  type: { type: String, default: 'text' },
  rows: { type: Number, default: undefined },
  autosize: { type: [Boolean, Object], default: undefined },
  disabled: { type: Boolean, default: false },
  width: { type: String, default: '100%' },
  ariaLabel: { type: String, default: '' }
})
defineEmits(['update:modelValue', 'keyup.enter'])
</script>

<style>
/*
 * 全局样式（不 scoped）：覆盖 Element Plus el-input wrapper。
 * 应用 class="wb-input" 的 el-input 都生效。
 */
.wb-input.el-input {
  width: 100%;
}
.wb-input .el-input__wrapper {
  min-height: 34px;
  padding: 1px 11px;
  border-radius: var(--wb-radius-sm);
  background: var(--wb-bg-card);
  box-shadow: 0 0 0 1px var(--wb-border) inset;
  transition: box-shadow var(--wb-motion-fast) var(--wb-motion-ease);
}
.wb-input .el-input__wrapper:hover {
  box-shadow: 0 0 0 1px var(--wb-border-strong) inset;
}
.wb-input .el-input__wrapper.is-focus {
  box-shadow: 0 0 0 2px var(--wb-primary) inset;
}
.wb-input .el-input__inner {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  line-height: 1.4;
}
.wb-input .el-input__inner::placeholder {
  color: var(--wb-text-tertiary);
}
.wb-input .el-input__count {
  color: var(--wb-text-tertiary);
  font-size: 11px;
}
.wb-input .el-input__prefix,
.wb-input .el-input__suffix {
  color: var(--wb-text-secondary);
}
.wb-input .el-input__prefix-inner > .el-icon,
.wb-input .el-input__suffix-inner > .el-icon {
  font-size: 16px;
}
.wb-input.is-disabled .el-input__wrapper {
  background: var(--wb-bg-elevated);
  cursor: not-allowed;
}
</style>
