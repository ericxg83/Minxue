<template><section class="ds-filter-bar" :class="{ 'is-bare': variant === 'bare' }"><div v-if="$slots.leading" class="leading"><slot name="leading" /></div><div class="filters"><slot /></div><div v-if="$slots.actions" class="actions"><slot name="actions" /></div></section></template>
<script setup>
/**
 * FilterBar · 工作台筛选条。
 *
 * variant（r138 新增，**纯加法**：默认 'card' 行为与旧版逐字一致）：
 *   - 'card'（默认）：白底 + border + 圆角。其他 5 个引用方零影响。
 *   - 'bare'：无背景 / 无边框 / 无圆角，只保留下方一条 hairline。
 *     筛选条承载的是「上下文」（我是谁、看哪段），不该比「结论」框得更重
 *     —— r138 学习诊断页改用它。
 */
defineProps({ variant: { type: String, default: 'card' } })
</script>
<style scoped>.ds-filter-bar{display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 14px;box-sizing:border-box;background:var(--wb-bg-card);border:1px solid var(--wb-border);border-radius:var(--wb-radius-panel)}.leading{display:flex;align-items:center;gap:8px;padding-right:12px;border-right:1px solid var(--wb-border-light)}.filters{display:flex;align-items:center;gap:10px;min-width:0;flex:1;flex-wrap:wrap}.actions{display:flex;align-items:center;gap:8px;margin-left:auto}
/* ── variant='bare'：无容器形态（r138）—— 只留 hairline，取消 58px 固定高度 ── */
.is-bare{min-height:0;padding:0 0 var(--wb-space-3);background:transparent;border:0;border-bottom:1px solid var(--wb-border-light);border-radius:0}
@media(max-width:860px){.ds-filter-bar{align-items:stretch;flex-direction:column}.leading{padding:0 0 10px;border-right:0;border-bottom:1px solid var(--wb-border-light)}.actions{margin-left:0}}
</style>