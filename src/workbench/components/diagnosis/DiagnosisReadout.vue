<script setup>
/**
 * 诊断读数条（r138 学习诊断页视觉重构 · 取代 r133 的 hero-strip 白卡）。
 *
 * 为什么不再用「正确率圆环 + 一排方格 KPI」：
 *   正确率是这一页唯一的一级结论，却原来被关在 1520px 宽的白卡里，
 *   视觉重量等于下面任意一张卡（r137 评审已定性为「Card Dashboard」）。
 *   r138 把它改成**无框排式**：全页最大数字在左，竖线分隔的指标在右，
 *   横向只用一条 hairline 落底—— 层级靠字号和留白建立，不靠容器。
 *
 * 口径纪律：
 *   - 指标只保留 3 项（批改题量 / 新增错题 / 待攻克），它们互不重复；
 *   - 「已记住」不再作为独立指标 —— 它与下方三态条显示同一批数据，
 *     且两处「已记住」指的不是一回事（此处原指 mastered+basic 合计，
 *     三态条里指 basic 单档）。口径冲突已合并到三态条一处。
 *   - 「完成作业」「有数据学生」降为副行小字，不与主指标抢位。
 *
 * ⛔ 色板全取工作台既有 token，不引入新色值，不加渐变/发光/阴影。
 */
import { computed } from 'vue'
import TrophyBar from './TrophyBar.vue'

const props = defineProps({
  // 正确率数值（null = 无题量，不显示百分比）
  accuracy: { type: Number, default: null },
  // 正确率显示文本（与 accuracy 分开：无题量时传 '—'）
  accuracyText: { type: String, default: '—' },
  // 左上角标题（学生名 / 「全班概览」）
  captionTitle: { type: String, default: '' },
  // 标题右侧的meta 行
  captionMeta: { type: String, default: '' },
  // 副行小字（完成作业 / 有数据学生等次要信息）
  note: { type: String, default: '' },
  // 3 个主指标 [{ label, value, tone }]
  metrics: { type: Array, default: () => [] },
  // 三态条数据
  mastered: { type: Number, default: 0 },
  basic: { type: Number, default: 0 },
  todo: { type: Number, default: 0 },
  practiced: { type: Number, default: 0 },
  // 无障碍标签
  ariaLabel: { type: String, default: '学习概览' }
})

// 语义色：≥80 绿 / ≥60 橙 / 其余红（沿用 r137 的 accuracyTone 口径，不新增规则）
const toneClass = (acc) => {
  if (acc == null) return ''
  if (acc >= 80) return 'is-good'
  if (acc >= 60) return 'is-warn'
  return 'is-bad'
}

const heroAcc = computed(() => toneClass(props.accuracy))
</script>

<template>
  <section class="readout" :aria-label="ariaLabel">
    <div class="readout__top">
      <!-- 一级结论：全页最大数字，无圆环（圆环的conic-gradient 也一并去掉） -->
      <div class="readout__figure">
        <strong :class="heroAcc">{{ accuracyText }}<small v-if="accuracy != null">%</small></strong>
        <span class="readout__figure-label">整体正确率</span>
      </div>

      <div class="readout__body">
        <div class="readout__caption">
          <strong v-if="captionTitle">{{ captionTitle }}</strong>
          <span v-if="captionMeta">{{ captionMeta }}</span>
        </div>

        <!-- 3 个主指标：竖线分隔，靠留白分组，无方格无边框 -->
        <div v-if="metrics.length" class="readout__metrics">
          <div v-for="metric in metrics" :key="metric.label" class="metric">
            <b :class="metric.tone">{{ metric.value }}</b>
            <span>{{ metric.label }}</span>
          </div>
        </div>

        <p v-if="note" class="readout__note">{{ note }}</p>
      </div>
    </div>

    <!-- 三态条：唯一显示「已记住 / 还在攻克」的地方（合并 hero KPI 的重复口径） -->
    <TrophyBar
      :mastered="mastered"
      :basic="basic"
      :todo="todo"
      :practiced="practiced"
    />
  </section>
</template>

<style scoped>
/* 无框：背景透明、无 border、无 radius —— 层级靠字号与 hairline */
.readout{padding:0 0 var(--wb-space-6);margin-bottom:var(--wb-space-8);border-bottom:1px solid var(--wb-border)}

.readout__top{display:flex;align-items:flex-start;gap:var(--wb-space-8)}

/* 一级结论：全页最大数字 */
.readout__figure{flex:0 0 auto;display:flex;flex-direction:column;gap:var(--wb-space-1);min-width:132px}
.readout__figure strong{
  color:var(--wb-text);
  font-size:var(--wb-fs-display);   /* 32px · 全页最大 */
  font-weight:var(--wb-fw-bold);
  line-height:var(--wb-lh-tight);
  letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;
}
.readout__figure strong small{font-size:var(--wb-fs-section);font-weight:var(--wb-fw-semibold)}
.readout__figure strong.is-good{color:var(--wb-status-success-fg)}
.readout__figure strong.is-warn{color:var(--wb-status-warning-fg)}
.readout__figure strong.is-bad{color:var(--wb-status-danger-fg)}
.readout__figure-label{color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}

.readout__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--wb-space-3)}
.readout__caption{display:flex;align-items:baseline;gap:var(--wb-space-3);flex-wrap:wrap}
.readout__caption strong{color:var(--wb-text);font-size:var(--wb-fs-card-title);font-weight:var(--wb-fw-semibold)}
.readout__caption span{color:var(--wb-text-secondary);font-size:var(--wb-fs-meta)}

/* 3 个主指标：竖线分隔（r135 已去掉方格，这里保留竖线但拉开间距） */
.readout__metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;max-width:520px}
.metric{padding:0 var(--wb-space-5);border-left:1px solid var(--wb-border-light)}
.metric:first-child{padding-left:0;border-left:0}
.metric b{display:block;color:var(--wb-text);font-size:var(--wb-fs-stat);font-weight:var(--wb-fw-bold);line-height:var(--wb-lh-tight);font-variant-numeric:tabular-nums}
.metric b.is-good{color:var(--wb-status-success-fg)}
.metric b.is-warn{color:var(--wb-status-warning-fg)}
.metric b.is-bad{color:var(--wb-status-danger-fg)}
.metric span{display:block;margin-top:var(--wb-space-1);color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}

.readout__note{margin:0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);line-height:var(--wb-lh-normal)}

/* 响应式：正确率数字与指标在窄屏改为上下排，避免挤压数字 */
@media(max-width:860px){
  .readout__top{flex-direction:column;gap:var(--wb-space-4)}
  .readout__metrics{max-width:none;width:100%}
}
@media(max-width:520px){
  .readout__metrics{grid-template-columns:1fr;gap:var(--wb-space-3)}
  .metric{padding:var(--wb-space-2) 0 0;border-left:0;border-top:1px solid var(--wb-border-light)}
  .metric:first-child{padding-top:0;border-top:0}
  .metric b{font-size:var(--wb-fs-section)}
}
</style>