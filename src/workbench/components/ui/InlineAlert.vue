<template>
  <div
    :class="['ds-inline-alert', `is-${tone}`, { 'is-clickable': clickable, 'is-dismissible': dismissible }]"
    :role="clickable ? 'button' : 'status'"
    :tabindex="clickable ? 0 : -1"
    :aria-label="ariaLabel || title"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
  >
    <el-icon v-if="iconName" class="alert-icon" :class="`is-${tone}`">
      <component :is="iconComp" />
    </el-icon>
    <div class="alert-body">
      <strong v-if="title" class="alert-title">{{ title }}</strong>
      <p v-if="description" class="alert-description">{{ description }}</p>
    </div>
    <button v-if="dismissible" class="alert-close" type="button" aria-label="关闭" @click.stop="$emit('dismiss')">
      <el-icon><Close /></el-icon>
    </button>
  </div>
</template>

<script setup>
/**
 * InlineAlert · 敏学 PC 工作台 inline 提示
 *
 * 取代 <el-alert type="error"> 等 Element Plus 默认组件（评审 A7）
 * 原因：el-alert 颜色不接 Minxue --wb-status-* token，hover 无 focus 反馈（A10）
 *
 * tone: danger | warning | info | success | neutral
 *
 * 用法：
 *   <InlineAlert tone="danger" title="..." description="..." @click="go" />
 *   <InlineAlert tone="warning" title="..." dismissible @dismiss="..." />
 */
import { computed } from 'vue'
import { CircleClose, WarningFilled, InfoFilled, CircleCheck, Close } from '@element-plus/icons-vue'

const props = defineProps({
  tone: {
    type: String,
    default: 'info',
    validator: (v) => ['danger', 'warning', 'info', 'success', 'neutral'].includes(v)
  },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  clickable: { type: Boolean, default: false },
  dismissible: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' }
})

defineEmits(['activate', 'dismiss'])

const iconName = computed(() => {
  switch (props.tone) {
    case 'danger': return 'CircleClose'
    case 'warning': return 'WarningFilled'
    case 'success': return 'CircleCheck'
    case 'neutral': return null
    default: return 'InfoFilled'
  }
})

const iconComp = computed(() => {
  switch (props.tone) {
    case 'danger': return CircleClose
    case 'warning': return WarningFilled
    case 'success': return CircleCheck
    default: return InfoFilled
  }
})

const onActivate = (e) => {
  if (!props.clickable) return
  // 透传 activate 事件
  // 父组件可用 @activate 接管；这里简化为不内置路由跳转，避免与原生 click 重复
  // 实际：父组件用 @click 监听
}
</script>

<style scoped>
.ds-inline-alert {
  display: flex;
  align-items: flex-start;
  gap: var(--wb-space-3);
  padding: var(--wb-space-3) var(--wb-space-4);
  background: var(--wb-status-info-bg);
  border: 1px solid transparent;
  border-radius: var(--wb-radius-md);
  color: var(--wb-text);
  transition: background var(--wb-motion-fast) var(--wb-motion-ease),
              border-color var(--wb-motion-fast) var(--wb-motion-ease);
}
/* tone 配色：接 Minxue status token */
.is-danger { background: var(--wb-status-danger-bg); border-color: rgba(220, 38, 38, 0.16); }
.is-warning { background: var(--wb-status-warning-bg); border-color: rgba(217, 119, 6, 0.18); }
.is-info { background: var(--wb-status-info-bg); border-color: rgba(99, 102, 241, 0.14); }
.is-success { background: var(--wb-status-success-bg); border-color: rgba(22, 163, 74, 0.16); }
.is-neutral { background: var(--wb-status-neutral-bg); border-color: var(--wb-border); }

.alert-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.alert-icon.is-danger { color: var(--wb-status-danger-fg); }
.alert-icon.is-warning { color: var(--wb-status-warning-fg); }
.alert-icon.is-info { color: var(--wb-status-info-fg); }
.alert-icon.is-success { color: var(--wb-status-success-fg); }

.alert-body { flex: 1; min-width: 0; }
.alert-title { display: block; color: var(--wb-text); font-size: var(--wb-fs-body); font-weight: var(--wb-fw-semibold); line-height: var(--wb-lh-normal); }
.alert-description { margin: 2px 0 0; color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); line-height: var(--wb-lh-normal); }

/* 评审 A10：可点击 affordance 必须三件套 */
.is-clickable { cursor: pointer; user-select: none; }
.is-clickable:hover { border-color: currentColor; }
.is-clickable.is-danger:hover { background: #FECACA; }
.is-clickable.is-warning:hover { background: #FDE68A; }
.is-clickable.is-info:hover { background: var(--wb-primary-soft); }
/* focus-visible 描边由 workbench-theme.css 全局规则提供 */

.alert-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -2px -2px 0 0;
  padding: 0;
  color: var(--wb-text-tertiary);
  background: transparent;
  border: 0;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease);
}
.alert-close:hover { background: rgba(15, 23, 42, 0.06); color: var(--wb-text); }
</style>
