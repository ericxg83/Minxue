<script setup>
/**
 * 下一步动作清单（r133 学习诊断重构 · r138 改为无容器编号清单）。
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
 *
 * ── r138 视觉改造 ──
 *   它是全页的**一级结论**，却原来被挂在 356px 右栏第二屏、且每条自带
 *   一层卡片（卡片套卡片）。现改为：全宽、裸排版、编号 hairline 清单。
 *   层级靠「序号 + 结论句 + 依据 + 动作」四段式建立，不靠容器。
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
      v-for="(action, index) in actions"
      :key="action.id"
      type="button"
      class="nx"
      :class="`is-${action.tone}`"
      @click="run(action)"
    >
      <!-- 序号即优先级（列表已按 score 降序），不是装饰性编号 -->
      <span class="nx__rank">{{ index + 1 }}</span>
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
/* r138：无卡片套卡片。条目之间只用 hairline，hover 给极浅行底色提示可点。 */
.nextlist{display:flex;flex-direction:column}
.nx{
  display:flex;align-items:flex-start;gap:var(--wb-space-4);width:100%;text-align:left;
  padding:var(--wb-space-4) var(--wb-space-2);
  border:0;border-bottom:1px solid var(--wb-border-light);
  background:transparent;cursor:pointer;font:inherit;color:inherit;
  transition:background var(--wb-motion-fast) var(--wb-motion-ease);
}
.nx:first-child{padding-top:var(--wb-space-2)}
.nx:last-child{border-bottom:0}
.nx:hover{background:var(--wb-bg-hover)}
.nx:focus-visible{outline:2px solid var(--wb-status-info-fg);outline-offset:-2px}

/* 序号用语义色，不用色块 —— 颜色表优先级，不制造新的视觉块 */
.nx__rank{
  flex:0 0 auto;width:22px;height:22px;border-radius:var(--wb-radius-pill);
  display:grid;place-items:center;
  font-size:var(--wb-fs-caption);font-weight:var(--wb-fw-bold);
  font-variant-numeric:tabular-nums;
  color:var(--wb-status-neutral-fg);margin-top:1px;
}
.nx.is-danger .nx__rank{color:var(--wb-status-danger-fg)}
.nx.is-warning .nx__rank{color:var(--wb-status-warning-fg)}
.nx.is-info .nx__rank{color:var(--wb-status-info-fg)}

.nx__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--wb-space-1)}
.nx__title{font-size:var(--wb-fs-card-title);font-weight:var(--wb-fw-semibold);color:var(--wb-text);line-height:var(--wb-lh-tight)}
.nx__detail{font-size:var(--wb-fs-meta);color:var(--wb-text-secondary);line-height:var(--wb-lh-relaxed)}

.nx__cta{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:2px;align-self:center;
  font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-semibold);
  color:var(--wb-status-info-fg);white-space:nowrap;
}
.nextlist__empty{padding:var(--wb-space-6) 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);text-align:center}

@media(max-width:720px){
  .nx{flex-wrap:wrap}
  .nx__cta{margin-left:calc(22px + var(--wb-space-4))}
}
</style>