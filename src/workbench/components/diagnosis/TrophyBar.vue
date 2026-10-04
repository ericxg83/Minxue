<script setup>
/**
 * 三态进度条（r133 学习诊断重构 · 取代 r130 的 MasteryBar · r138 简化为读数条）。
 *
 * 口径决策（负责人 2026-10-04 明确）：
 *   主数字 = **已记住**（答对 1 次），不是「完全掌握」（答对 2 次）。
 *   原因：现实里没有时间让每道题都做两次；答对一次就是记住了，
 *   拿「完全掌握 2 道」当主数字会严重低估孩子，也让家长看不到信心。
 *   「彻底掌握」降级为徽章 —— 锦上添花，不抢主位。
 *
 * 第二个改进：**已练口径**。
 *   「74 道里拿下 16 道 = 22%」看着差，因为 58 道是还没练过的新错题在稀释分母。
 *   换成「练过 41 道 → 拿下 16 道 = 39%」才是真实努力的结果。
 *
 * ── r138 改动 ──
 *   1. 移除顶部「N 道错题，已拿下 M 道」的大数字块 —— 它与读数条的
 *      「已记住」指标显示同一数据，且「已记住」在两处指的不是一回事
 *      （此处原指 mastered+basic，读数条 KPI 也指合计）⇒ 口径重复，已合并。
 *      现在这里只显示「还差 N 道 / 全部拿下」+ 三态图例 + 已练口径。
 *   2. 进度条高度 10px → 6px：它现在是辅助读数，不该跟正确率数字抢视觉重量。
 *
 * ⛔ 全部用设计 token（8 档字号 / 4 档间距 / 5 档状态色），
 *   不引入新色值，不加渐变/发光/阴影。
 */
import { computed } from 'vue'

const props = defineProps({
  mastered: { type: Number, default: 0 },
  basic: { type: Number, default: 0 },
  todo: { type: Number, default: 0 },
  // 练过（practice_count >= 1）的错题数，用于已练口径
  practiced: { type: Number, default: 0 }
})

const total = computed(() => Math.max(0, props.mastered) + Math.max(0, props.basic) + Math.max(0, props.todo))
const secured = computed(() => Math.max(0, props.mastered) + Math.max(0, props.basic))
const pct = (n) => (total.value > 0 ? (Math.max(0, n) / total.value) * 100 : 0)

// 已练口径：只在「练过 > 0」时有意义，否则显示全量口径（不编造分母）
const practicedSecured = computed(() => (props.practiced > 0 ? secured.value : null))

const segments = computed(() => [
  { key: 'mastered', label: '彻底掌握', count: props.mastered || 0, width: pct(props.mastered), tone: 'is-mastered' },
  { key: 'basic', label: '已记住', count: props.basic || 0, width: pct(props.basic), tone: 'is-basic' },
  { key: 'todo', label: '还在攻克', count: props.todo || 0, width: pct(props.todo), tone: 'is-todo' }
].filter(s => s.width > 0))
</script>

<template>
  <div v-if="total > 0" class="trophy">
    <!-- r138：移除「N 道错题，已拿下 M 道」大数字块。
         它与读数条 KPI 的「已记住」显示同一数据 ⇒ 口径重复，已合并到读数条一处。
         这里只保留「还差多少」+ 三态图例 + 已练口径，作为辅助读数。 -->
    <div class="trophy__head">
      <span v-if="todo > 0" class="trophy__todo">还差 <b>{{ todo }}</b> 道全部清零</span>
      <span v-else class="trophy__todo is-done">全部拿下，没有待攻克的题</span>
      <span v-if="mastered > 0" class="trophy__badge">✓ {{ mastered }} 道彻底掌握</span>
      <span v-if="practicedSecured !== null" class="trophy__pace">
        练过 <b>{{ practiced }}</b> 道 · 拿下 <b>{{ secured }}</b> 道（{{ Math.round((secured / practiced) * 100) }}%）
      </span>
      <span v-else class="trophy__pace">还没安排重练，练过的题会单独算在这里</span>
    </div>
    <div class="trophy__track">
      <span
        v-for="segment in segments"
        :key="segment.key"
        class="trophy__seg"
        :class="segment.tone"
        :style="{ flexBasis: `${segment.width}%` }"
        :title="`${segment.label} ${segment.count} 道`"
      />
    </div>
    <ul class="trophy__legend">
      <li v-for="segment in segments" :key="segment.key" :class="segment.tone">
        <i />{{ segment.label }}<b>{{ segment.count }}</b>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* r138：无框读数条。不再有大数字，所以不需要上边距 */
.trophy{display:flex;flex-direction:column;gap:var(--wb-space-2)}
/* 结论句与图例同一行组：左「还差 N 道」，右「已练口径 + 彻底掌握徽章」 */
.trophy__head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--wb-space-4);flex-wrap:wrap}
.trophy__todo{font-size:var(--wb-fs-meta);color:var(--wb-text-secondary);font-weight:var(--wb-fw-semibold)}
.trophy__todo b{color:var(--wb-status-warning-fg);font-weight:var(--wb-fw-bold);font-variant-numeric:tabular-nums}
.trophy__todo.is-done{color:var(--wb-status-success-fg)}
.trophy__badge{
  padding:2px var(--wb-space-2);border-radius:var(--wb-radius-pill);
  background:var(--wb-status-success-bg);color:var(--wb-status-success-fg);
  font-size:var(--wb-fs-caption);font-weight:var(--wb-fw-semibold);
}
.trophy__pace{font-size:var(--wb-fs-caption);color:var(--wb-text-tertiary)}
.trophy__pace b{color:var(--wb-status-info-fg);font-weight:var(--wb-fw-semibold)}
/* r138：进度条 10px → 6px。它现在只是辅助读数，不该跟正确率主数字抢视觉重量 */
.trophy__track{display:flex;gap:2px;height:6px;border-radius:var(--wb-radius-pill);overflow:hidden;background:var(--wb-bg-mist)}
.trophy__seg{display:block;min-width:3px;height:100%}
/* 色类只作用在色条段上（scoped 到 .trophy__seg）——
   裸写 .is-mastered 会同时命中图例 <li>，把整块背景刷成色块（r133 首版实测踩到）。 */
.trophy__seg.is-mastered{background:var(--wb-status-success-fg)}
.trophy__seg.is-basic{background:var(--wb-status-info-fg)}
.trophy__seg.is-todo{background:var(--wb-status-warning-fg)}
.trophy__legend{display:flex;gap:var(--wb-space-5);margin:0;padding:0;list-style:none;flex-wrap:wrap}
.trophy__legend li{display:flex;align-items:center;gap:var(--wb-space-2);font-size:var(--wb-fs-caption);color:var(--wb-text-secondary)}
.trophy__legend i{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
/* ⛔ 只给图例里的圆点上色。r133 首版把 .is-* 用在 <li> 上，
   结果继承了 .is-mastered{background} 的整块背景，图例变成三个色块、文字糊掉。
   修饰类名必须区分「色条」与「图例」两种用途。 */
.trophy__legend .is-mastered i{background:var(--wb-status-success-fg)}
.trophy__legend .is-basic i{background:var(--wb-status-info-fg)}
.trophy__legend .is-todo i{background:var(--wb-status-warning-fg)}
.trophy__legend b{color:var(--wb-text);font-weight:var(--wb-fw-bold);font-variant-numeric:tabular-nums}
</style>
