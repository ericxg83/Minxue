<script setup>
/**
 * 家长产出预览（r134）—— 按 03-mockup-v2 的设计：让老师**先看到家长会拿到什么**，
 * 再决定要不要生成。这是 mockup 里最被低估的一块 —— 它把「转发」这个抽象动作
 * 变成一个可见的成品，老师的判断从「要不要点这个按钮」变成「这个画面给家长合不合适」。
 *
 * 口径与页面一致（r132/r133 决策）：
 *   主数字用「已记住 N 道」（答对 1 次即算），彻底掌握只作为补充说明。
 *   ⛔ 不用「完全掌握 N」当主数字 —— 现实里没时间让每道题做两次，
 *     拿苛刻门槛当主数字会低估孩子、也让家长看不到信心。
 *
 * ⛔ 没有数据时不渲染空壳：totalQuestions 为 0 直接说人话。
 */
import { computed } from 'vue'

const props = defineProps({
  studentName: { type: String, default: '' },
  totalQuestions: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  accuracy: { type: Number, default: null },
  secured: { type: Number, default: 0 },
  mastered: { type: Number, default: 0 },
  newWrong: { type: Number, default: 0 }
})

const hasData = computed(() => props.totalQuestions > 0)
const accText = computed(() => (props.accuracy == null ? '—' : `${props.accuracy}%`))
</script>

<template>
  <div v-if="!hasData" class="pop__empty">
    本周期还没有批改记录，暂时没有可发给家长的内容。
  </div>
  <div v-else class="pop">
    <div class="pop__head">
      <div class="pop__eyebrow">本周学习小结</div>
      <div class="pop__name">{{ studentName || '该学生' }}</div>
      <div class="pop__figures">
        <div>
          <span>已记住错题</span>
          <b class="is-win">{{ secured }} 道</b>
        </div>
        <div>
          <span>批改题量</span>
          <b>{{ totalQuestions }} 道</b>
        </div>
        <div>
          <span>整体正确率</span>
          <b>{{ accText }}</b>
        </div>
      </div>
    </div>
    <div class="pop__body">
      <p>
        本周批改 <b>{{ totalQuestions }}</b> 道题，其中 <b>{{ correctCount }}</b> 道答对。
        已经记住 <b>{{ secured }}</b> 道错题<template v-if="mastered > 0">，其中 <b>{{ mastered }}</b> 道彻底掌握</template>。
      </p>
    </div>
  </div>
</template>

<style scoped>
.pop{border:1px solid var(--wb-border);border-radius:var(--wb-radius-md);overflow:hidden}
.pop__head{padding:var(--wb-space-4);background:var(--wb-status-info-fg);color:#fff}
.pop__eyebrow{font-size:var(--wb-fs-caption);opacity:.8}
.pop__name{margin-top:3px;font-size:var(--wb-fs-card-title);font-weight:var(--wb-fw-bold)}
.pop__figures{display:flex;gap:var(--wb-space-5);margin-top:var(--wb-space-3)}
.pop__figures span{display:block;font-size:10px;opacity:.78}
.pop__figures b{display:block;margin-top:1px;font-size:var(--wb-fs-section);font-weight:var(--wb-fw-bold);font-variant-numeric:tabular-nums}
.pop__figures .is-win{color:#BBF7D0}
.pop__body{padding:var(--wb-space-3) var(--wb-space-4)}
.pop__body p{color:var(--wb-text-secondary);font-size:var(--wb-fs-caption);line-height:var(--wb-lh-relaxed)}
.pop__body b{color:var(--wb-text);font-weight:var(--wb-fw-semibold)}
.pop__empty{padding:var(--wb-space-5) var(--wb-space-3);color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);text-align:center;line-height:var(--wb-lh-relaxed)}
</style>
