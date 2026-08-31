<template>
  <el-select
    :model-value="modelValue"
    :placeholder="placeholder"
    :clearable="clearable"
    :disabled="disabled"
    :filterable="filterable"
    :loading="loading"
    :size="size"
    class="wb-select"
    :style="{ width }"
    :aria-label="ariaLabel || undefined"
    @update:model-value="val => $emit('update:modelValue', val)"
    @change="val => $emit('change', val)"
  >
    <el-option
      v-for="(opt, index) in options"
      :key="opt.value !== undefined && opt.value !== null ? opt.value : `opt-${index}`"
      :label="$slots.option ? undefined : opt.label"
      :value="opt.value"
    >
      <slot name="option" :opt="opt" :index="index">
        {{ opt.label }}
      </slot>
    </el-option>
    <template #empty>
      <slot name="empty">无数据</slot>
    </template>
  </el-select>
</template>

<script setup>
/**
 * WorkbenchSelect · 敏学 PC 工作台下拉选择统一组件
 *
 * 包裹 Element Plus el-select，对外暴露敏学 token 化的视觉规范：
 *   - 圆角 8px（--wb-radius-sm）
 *   - focus / hover 边框走 --wb-primary / --wb-border-strong
 *   - 高度 34px（与 ActionButton / input 一致）
 *
 * API（这些 prop 稳定工作）：
 *   - modelValue / options / placeholder / clearable / disabled
 *   - filterable / loading / size / width / ariaLabel
 *   - slot：#option（自定义 option 渲染）/ #empty（无数据时显示）
 *
 * 不通过此包装支持（需调用方直接用 el-select + class="wb-select"）：
 *   - multiple / allowCreate
 *
 * 原因：Element Plus 4.x el-select 内部对 v-bind 透传的 boolean / 复杂 prop
 * 不会渲染成预期 prop（实测 allProps 只有 ref / class / onMouseenter /
 * onMouseleave / style 5 个），调用方直接用 `<el-select multiple ...>` 形式
 * 反而能让 el-select 正确识别（class="wb-select" 仍享受 token 化样式）。
 *
 * 用法：
 *   <WorkbenchSelect
 *     v-model="value"
 *     :options="items"
 *     placeholder="请选择"
 *     clearable
 *     aria-label="选择项"
 *   />
 *
 *   <WorkbenchSelect :options="templates" v-model="templateId" @change="onChange">
 *     <template #option="{ opt }">
 *       <div class="template-option">
 *         <strong>{{ opt.label }}</strong>
 *         <small>{{ opt.description }}</small>
 *       </div>
 *     </template>
 *   </WorkbenchSelect>
 *
 *   <!-- multiple / allowCreate：直接用 el-select -->
 *   <el-select v-model="tags" multiple filterable allow-create class="wb-select" />
 */
defineProps({
  modelValue: { default: undefined },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  clearable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  filterable: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  size: { type: String, default: 'default' },
  width: { type: String, default: '160px' },
  ariaLabel: { type: String, default: '' }
})
defineEmits(['update:modelValue', 'change'])
</script>

<style>
.wb-select.el-select {
  width: 100%;
}
.wb-select .el-select__wrapper {
  min-height: 34px;
  border-radius: var(--wb-radius-sm);
  background: var(--wb-bg-card);
  box-shadow: 0 0 0 1px var(--wb-border) inset;
  transition: box-shadow var(--wb-motion-fast) var(--wb-motion-ease);
}
.wb-select .el-select__wrapper:hover {
  box-shadow: 0 0 0 1px var(--wb-border-strong) inset;
}
.wb-select .el-select__wrapper.is-focused {
  box-shadow: 0 0 0 2px var(--wb-primary) inset;
}
.wb-select .el-select__placeholder {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-body);
}
.wb-select .el-select__placeholder.is-transparent {
  color: var(--wb-text-tertiary);
}
.wb-select .el-select__selected-item {
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
}
.wb-select .el-select__caret {
  color: var(--wb-text-secondary);
  font-size: 14px;
}
.wb-select.el-select--large .el-select__wrapper {
  min-height: 40px;
  font-size: var(--wb-fs-body);
}
.wb-select.el-select--small .el-select__wrapper {
  min-height: 28px;
  font-size: var(--wb-fs-caption);
}
</style>
