<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    :width="width"
    :close-on-click-modal="!loading"
    :close-on-press-escape="!loading"
    :show-close="!loading"
    destroy-on-close
    v-bind="$attrs"
    @update:model-value="val => $emit('update:modelValue', val)"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * WorkbenchDialog · 敏学 PC 工作台弹层统一组件
 *
 * 包裹 Element Plus el-dialog，对外暴露敏学 token 化的视觉规范：
 *   - 圆角 12px（--wb-radius-lg）
 *   - 阴影 0 16px 40px rgba(15,23,42,.14)（--wb-elev-modal）
 *   - 标题 17px / 650 / --wb-text（--wb-fs-section）
 *   - header / body / footer padding 对齐 ContentCard
 *   - footer 走 ActionButton，不用 el-button
 *
 * 用法：
 *   <WorkbenchDialog v-model="visible" title="编辑学生" :loading="saving" @closed="resetForm">
 *     <el-form>...</el-form>
 *     <template #footer>
 *       <ActionButton variant="ghost" @click="visible = false">取消</ActionButton>
 *       <ActionButton variant="primary" :loading="saving" @click="save">保存</ActionButton>
 *     </template>
 *   </WorkbenchDialog>
 *
 * loading=true 时：禁用遮罩点击关闭、Esc 关闭、关闭按钮，避免半保存状态。
 * 内部表单（el-form / el-form-item / el-input）由调用方自管，本组件不接管。
 */
defineOptions({ inheritAttrs: false })
defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: [String, Number], default: '420px' },
  loading: { type: Boolean, default: false }
})
defineEmits(['update:modelValue'])
</script>

<style>
/*
 * 样式用全局（非 scoped），因为 .el-dialog 是 Element Plus 在 #body 渲染的子元素，
 * scoped 属性不会传进去。这里复写弹层 token：圆角 / 阴影 / 标题 / padding。
 * 仅覆盖结构样式，表单输入等内部组件不动。
 */
.el-overlay-dialog .el-dialog {
  border-radius: var(--wb-radius-lg);
  box-shadow: var(--wb-elev-modal);
  overflow: hidden;
}
.el-overlay-dialog .el-dialog__header {
  padding: 18px 24px;
  border-bottom: 1px solid var(--wb-border-light);
}
.el-overlay-dialog .el-dialog__title {
  color: var(--wb-text);
  font-size: var(--wb-fs-section);
  font-weight: var(--wb-fw-semibold);
  letter-spacing: -.01em;
  line-height: var(--wb-lh-tight);
}
.el-overlay-dialog .el-dialog__body {
  padding: 20px 24px;
  color: var(--wb-text);
}
.el-overlay-dialog .el-dialog__footer {
  padding: 14px 24px;
  background: var(--wb-bg-card);
  border-top: 1px solid var(--wb-border-light);
}
.el-overlay-dialog .el-dialog__headerbtn {
  width: 36px;
  height: 36px;
  border-radius: var(--wb-radius-sm);
}
.el-overlay-dialog .el-dialog__headerbtn .el-dialog__close {
  color: var(--wb-text-secondary);
  font-size: 18px;
}
.el-overlay-dialog .el-dialog__headerbtn:hover {
  background: var(--wb-bg-hover);
}
.el-overlay-dialog .el-dialog__headerbtn:hover .el-dialog__close {
  color: var(--wb-text);
}
</style>
