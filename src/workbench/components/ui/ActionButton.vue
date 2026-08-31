<template>
  <el-button
    class="ds-action-button"
    :class="[`is-${variant}`, { 'is-icon-only': iconOnly }]"
    :type="elType"
    :plain="variant === 'secondary'"
    :text="variant === 'ghost'"
    :bg="variant === 'ghost'"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </el-button>
</template>

<script setup>
/**
 * ActionButton · 敏学 PC 工作台按钮唯一标准
 *
 * 4 档（Phase 5 扩展）：
 *   primary    主操作（页面最重的 1 个动作）
 *   secondary  次要操作
 *   ghost      文字按钮（取代 <el-button text type="primary">，评审 A6）
 *   danger     危险操作
 *
 * 评审 A30：自带 :focus-visible 描边（与 workbench-theme.css 全局协调）
 */
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  variant: {
    type: String,
    default: 'secondary',
    validator: (v) => ['primary', 'secondary', 'ghost', 'danger'].includes(v)
  },
  disabled: { type: Boolean, default: false },
  iconOnly: { type: Boolean, default: false }
})

const elType = computed(() => {
  if (props.variant === 'primary') return 'primary'
  if (props.variant === 'danger') return 'danger'
  return ''
})
</script>

<style scoped>
.ds-action-button { min-height: 34px; border-radius: 8px; font-weight: 550; }
/* ghost 档：去掉 padding 显得轻量，hover 出现淡背景 */
.ds-action-button.is-ghost { min-height: 30px; padding: 4px 8px; font-weight: 550; }
.ds-action-button.is-ghost:hover { background: var(--wb-bg-hover); }
/* iconOnly 圆形按钮 */
.ds-action-button.is-icon-only { padding: 6px; min-width: 34px; }
/* 评审 A30：focus-visible 在 scoped 模式下不生效，落到 workbench-theme.css 全局 */
</style>
