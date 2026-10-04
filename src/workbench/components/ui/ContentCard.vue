<template><section :class="['ds-content-card',{'is-flush':flush,'is-bare':variant==='bare'}]"><header v-if="title||description||$slots.header||$slots.actions"><div><slot name="header"><h2>{{ title }}</h2><p v-if="description">{{ description }}</p></slot></div><div v-if="$slots.actions" class="actions"><slot name="actions" /></div></header><div class="body"><slot /></div><footer v-if="$slots.footer"><slot name="footer" /></footer></section></template>
<script setup>
/**
 * ContentCard · 工作台内容卡片。
 *
 * variant（r138 新增，**纯加法**：默认 'card' 的行为与旧版逐字一致）：
 *   - 'card'（默认）：白底 + 1px border + 圆角。其他 9 个引用方零影响。
 *   - 'bare'：无背景、无 border、无圆角，header 下方只留一条 hairline。
 *     给「轻量信息流」形态用 —— 层级靠排版与分隔线建立，不靠容器。
 *     学习诊断页（r138）用它替代通栏大白卡。
 *
 * ⛔ 不加渐变/ 发光 / 玻璃拟态 / 阴影（工作台原则：默认无阴影，靠 border 分层）。
 */
defineProps({
  title: String,
  description: String,
  flush: Boolean,
  variant: { type: String, default: 'card' }
})
</script>
<style scoped>.ds-content-card{min-width:0;background:var(--wb-bg-card);border:1px solid var(--wb-border);border-radius:var(--wb-radius-panel)}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 20px;border-bottom:1px solid var(--wb-border-light)}h2{margin:0;color:var(--wb-text);font-size:15px;font-weight:650}p{margin:5px 0 0;color:var(--wb-text-secondary);font-size:12px}.actions{display:flex;align-items:center;gap:8px}.body{padding:20px}.is-flush .body{padding:0}footer{padding:14px 20px;border-top:1px solid var(--wb-border-light)}
/* ── variant='bare'：无容器形态（r138）──
   去背景 / 去边框 / 去圆角，标题降一档，字号改走 token。
   header 保留 hairline —— 这是「结构即信息」的分界，不是装饰。 */
.is-bare{background:transparent;border:0;border-radius:0}
.is-bare header{padding:0 0 var(--wb-space-3);border-bottom:1px solid var(--wb-border-light)}
.is-bare h2{font-size:var(--wb-fs-section);font-weight:var(--wb-fw-semibold)}
.is-bare p{margin-top:var(--wb-space-1);font-size:var(--wb-fs-meta)}
.is-bare .body{padding:var(--wb-space-5) 0 0}
.is-bare footer{padding:var(--wb-space-4) 0 0}
</style>