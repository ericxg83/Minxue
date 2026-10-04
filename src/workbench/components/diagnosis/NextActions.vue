<script setup>
/**
 * 下一步动作清单（r133 学习诊断重构）。
 *
 * 交互改造的核心：旧页面是「看图 → 自己想接下来干什么」，
 * 这一块把结论直接变成可点的动作 —— 看完不用自己想下一步。
 *
 * 排序规则（不是随便排的）：
 *   高优先级 = 数据支撑强 + 老师当天就能做。
 *   score 越高越靠前，页面据此排序。
 *
 * ⛔ 每个动作都必须有真实的数字来源；拿不到数就不渲染这一条
 *    （宁可少一条，也不能给一个「大概类似」的假建议）。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight } from '@element-plus/icons-vue'

const props = defineProps({
  // { errorType, count, ratio }[] —— 用于「按某类错因专项练」
  errorCauses: { type: Array, default: () => [] },
  // 反复错题数（error_count >= 2）
  repeatWrongCount: { type: Number, default: 0 },
  // 已答对 1 次的基本掌握数
  basicCount: { type: Number, default: 0 },
  // 待复习数
  todoCount: { type: Number, default: 0 },
  // 正确率 0% 的知识点（出题 >=2 全错）
  zeroAccuracyTags: { type: Array, default: () => [] }
})

const router = useRouter()

const actions = computed(() => {
  const list = []

  const top = (props.errorCauses || [])[0]
  if (top && top.count >= 3) {
    list.push({
      id: 'error-cause',
      score: 100 + top.count,
      rank: 1,
      title: `${top.count} 道「${top.errorType}」→ 专项练`,
      detail: `占全部错题 ${top.ratio}%，是最大的一块。已按这类预筛好，点开直接发卷`,
      cta: '发重练卷',
      tone: 'danger'
    })
  }

  if (props.repeatWrongCount >= 3) {
    list.push({
      id: 'repeat',
      score: 90 + props.repeatWrongCount,
      rank: 1,
      title: `${props.repeatWrongCount} 道反复错 → 优先回炉`,
      detail: '错 2 次以上说明上次没真懂，重做同类题收效最快',
      cta: '发重练卷',
      tone: 'warning'
    })
  }

  if (props.basicCount > 0) {
    list.push({
      id: 'basic',
      score: 70,
      rank: 1,
      title: `${props.basicCount} 道已记住 → 本周重练做二次验证`,
      detail: '已经答对过 1 次，本周重练卷会自动带上它们，再对一次就能升级为彻底掌握',
      cta: '发重练卷',
      tone: 'info'
    })
  }

  const zero = (props.zeroAccuracyTags || []).slice(0, 3)
  if (zero.length >= 2) {
    list.push({
      id: 'knowledge',
      score: 60 + zero.length,
      rank: 1,
      title: `${zero.length} 个知识点全错 → 合并讲一节`,
      detail: `${zero.join('、')} 等都还没对过 —— 多半是同一块内容拆成了多个标签，建议一次讲透再重练`,
      cta: '看知识点',
      tone: 'info',
      to: '/weekly-report'
    })
  }

  return list.sort((a, b) => b.score - a.score)
})

function run(action) {
  // ⛔ 本轮不接发卷接口（会动组卷链路，C 级敏感区）。
  //  先跳到错题中心，那里有现成的勾选与发卷入口 —— 一步到位，不绕路。
  if (action.id === 'knowledge') {
    router.push({ path: '/weekly-report' })
    return
  }
  router.push({ path: '/students' })
}
</script>

<template>
  <div v-if="actions.length" class="nextlist">
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      class="nx"
      :class="`is-${action.tone}`"
      @click="run(action)"
    >
      <span class="nx__rank">{{ action.rank }}</span>
      <span class="nx__body">
        <strong class="nx__title">{{ action.title }}</strong>
        <span class="nx__detail">{{ action.detail }}</span>
      </span>
      <span class="nx__cta">{{ action.cta }}<el-icon><ArrowRight /></el-icon></span>
    </button>
  </div>
  <div v-else class="nextlist__empty">
    本周期还没有需要立刻处理的动作 —— 等新的批改数据进来再安排。
  </div>
</template>

<style scoped>
.nextlist{display:flex;flex-direction:column;gap:var(--wb-space-2)}
.nx{
  display:flex;align-items:flex-start;gap:var(--wb-space-3);width:100%;text-align:left;
  padding:var(--wb-space-3) var(--wb-space-4);border:1px solid var(--wb-border);
  border-radius:var(--wb-radius-sm);background:var(--wb-bg-card);cursor:pointer;
  transition:border-color .12s,background .12s;
}
.nx:hover{background:var(--wb-bg-hover);border-color:var(--wb-border-strong)}
.nx:focus-visible{outline:2px solid var(--wb-status-info-fg);outline-offset:1px}
.nx__rank{
  flex:0 0 auto;width:20px;height:20px;border-radius:var(--wb-radius-pill);
  display:grid;place-items:center;font-size:var(--wb-fs-caption);font-weight:var(--wb-fw-bold);
  color:var(--wb-text-inverse);background:var(--wb-status-neutral-fg);margin-top:2px;
}
.nx.is-danger .nx__rank{background:var(--wb-status-danger-fg)}
.nx.is-warning .nx__rank{background:var(--wb-status-warning-fg)}
.nx.is-info .nx__rank{background:var(--wb-status-info-fg)}
.nx__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.nx__title{font-size:var(--wb-fs-body);font-weight:var(--wb-fw-semibold);color:var(--wb-text);line-height:var(--wb-lh-tight)}
.nx__detail{font-size:var(--wb-fs-caption);color:var(--wb-text-secondary);line-height:var(--wb-lh-relaxed)}
.nx__cta{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:2px;align-self:center;
  font-size:var(--wb-fs-caption);font-weight:var(--wb-fw-semibold);
  color:var(--wb-status-info-fg);white-space:nowrap;
}
.nextlist__empty{padding:var(--wb-space-6) 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);text-align:center}
</style>
