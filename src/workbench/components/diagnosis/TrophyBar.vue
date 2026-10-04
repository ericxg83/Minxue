<script setup>
/**
 * 战果条（r133 学习诊断重构 · 取代 r130 的 MasteryBar）。
 *
 * 口径决策（负责人 2026-10-04 明确）：
 *   主数字 = **已记住**（答对 1 次），不是「完全掌握」（答对 2 次）。
 *   原因：现实里没有时间让每道题都做两次；答对一次就是记住了，
 *   拿「完全掌握 2 道」当主数字会严重低估孩子，也让家长看不到信心。
 *   「彻底掌握」降级为右侧小徽章 —— 锦上添花，不抢主位。
 *
 * 第二个改进：**已练口径**。
 *   「74 道里拿下 16 道 = 22%」看着差，因为 58 道是还没练过的新错题在稀释分母。
 *   换成「练过 41 道 → 拿下 16 道 = 39%」才是真实努力的结果。
 *
 * ⛔ 全部用设计 token（8 档字号 / 4 档间距 / 5 档状态色），
 *   旧版硬编码了 5 个字号 + 4 个色值，是页面「视觉噪音」的来源之一。
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
    <div class="trophy__head">
      <div class="trophy__figure">
        <strong class="trophy__num">{{ total }}</strong>
        <span class="trophy__unit">道错题，已拿下 <b>{{ secured }}</b> 道</span>
      </div>
      <div class="trophy__right">
        <span v-if="mastered > 0" class="trophy__badge">✓ {{ mastered }} 道彻底掌握</span>
        <span v-if="practicedSecured !== null" class="trophy__pace">
          练过 <b>{{ practiced }}</b> 道 · 拿下 <b>{{ secured }}</b> 道（{{ Math.round((secured / practiced) * 100) }}%）
        </span>
        <span v-else class="trophy__pace">还没安排重练，练过的题会单独算在这里</span>
      </div>
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
.trophy{margin-top:var(--wb-space-4)}
.trophy__head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--wb-space-4);flex-wrap:wrap;margin-bottom:var(--wb-space-3)}
.trophy__figure{display:flex;align-items:baseline;gap:var(--wb-space-2)}
.trophy__num{font-size:var(--wb-fs-display);font-weight:var(--wb-fw-bold);letter-spacing:-.02em;line-height:var(--wb-lh-tight);color:var(--wb-text);font-variant-numeric:tabular-nums}
.trophy__unit{font-size:var(--wb-fs-body);color:var(--wb-text-secondary)}
.trophy__unit b{color:var(--wb-text);font-weight:var(--wb-fw-bold);font-size:var(--wb-fs-section)}
.trophy__right{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.trophy__badge{
  padding:2px var(--wb-space-2);border-radius:var(--wb-radius-pill);
  background:var(--wb-status-success-bg);color:var(--wb-status-success-fg);
  font-size:var(--wb-fs-caption);font-weight:var(--wb-fw-semibold);
}
.trophy__pace{font-size:var(--wb-fs-caption);color:var(--wb-text-tertiary)}
.trophy__pace b{color:var(--wb-status-info-fg);font-weight:var(--wb-fw-semibold)}
.trophy__track{display:flex;gap:2px;height:10px;border-radius:var(--wb-radius-pill);overflow:hidden;background:var(--wb-bg-mist)}
.trophy__seg{display:block;min-width:3px;height:100%}
.is-mastered{background:var(--wb-status-success-fg)}
.is-basic{background:var(--wb-status-info-fg)}
.is-todo{background:var(--wb-status-warning-fg)}
.trophy__legend{display:flex;gap:var(--wb-space-5);margin:var(--wb-space-2) 0 0;padding:0;list-style:none;flex-wrap:wrap}
.trophy__legend li{display:flex;align-items:center;gap:var(--wb-space-2);font-size:var(--wb-fs-caption);color:var(--wb-text-secondary)}
.trophy__legend i{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.trophy__legend .is-mastered i{background:var(--wb-status-success-fg)}
.trophy__legend .is-basic i{background:var(--wb-status-info-fg)}
.trophy__legend .is-todo i{background:var(--wb-status-warning-fg)}
.trophy__legend b{color:var(--wb-text);font-weight:var(--wb-fw-bold);font-variant-numeric:tabular-nums}
</style>
