<script setup>
/**
 * 下一步动作清单（r133 学习诊断重构）。
 *
 * 交互改造的核心：旧页面是「看图 → 自己想接下来干什么」，
 * 这一块把结论直接变成可点的动作 —— 看完不用自己想下一步。
 *
 * 排序规则（不是随便排的）：
 *   高优先级 = 数据支撑强 + 老师当天就能做。
 *   score 越高越靠前，页面据此排序；名次按排完的次序给（不写死）。
 *
 * ⛔ 每个动作都必须有真实的数字来源；拿不到数就不渲染这一条
 *    （宁可少一条，也不能给一个「大概类似」的假建议）。
 *
 * ⛔ r141（负责人验收）：CTA 文案不许承诺本页做不到的事，动作必须跳到
 *    「真能把这事做完」的地方。两个真实缺陷：
 *      ① 三条动作的 run() 一律 push('/students') —— 那是学生**列表**页，
 *         和「重练卷」毫无关系；老师点完还得自己在列表里再找一遍这个学生。
 *         真出口是学生档案页的错题清单（r91 起「错题中心」并入档案页），
 *         那里有勾选框与「生成重练卷」按钮（接移动端同一导出引擎）。
 *         故动作一律带 studentId 落到 `/students/:id`。
 *      ② knowledge 动作 push('/weekly-report') = 跳本页自己 ⇒ 点了毫无反应，
 *         看起来就是个坏按钮。它原本要开的知识点下钻接口已随 r137 下线，
 *         负责人 2026-10-05 裁决「备课功能暂不开发」⇒ 这条**显式禁用**，
 *         不再靠「跳本页」假装能用（要恢复：接知识点下钻并把 disabled 去掉）。
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
  zeroAccuracyTags: { type: Array, default: () => [] },
  // 当前诊断的学生 —— 动作要跳到「这个学生」的错题清单，缺它就落不到人身上
  studentId: { type: String, default: '' }
})

const router = useRouter()

// 错题清单在学生档案页（r91 起错题中心并入档案页），并自带「生成重练卷」按钮 ⇒
// 「去组专项卷」的真实落点就是这里。没有 studentId 就不给这条动作（宁可少一条）。
const wrongListPath = computed(() => (props.studentId ? `/students/${props.studentId}` : ''))

const actions = computed(() => {
  const list = []

  const top = (props.errorCauses || [])[0]
  if (top && top.count >= 3 && wrongListPath.value) {
    list.push({
      id: 'error-cause',
      score: 100 + top.count,
      title: `${top.count} 道「${top.errorType}」→ 专项练`,
      detail: `占全部错题 ${top.ratio}%，是最大的一块。这 ${top.count} 道在错题清单里都带「${top.errorType}」标签，勾上就能组一份专项卷`,
      cta: '去错题清单',
      tone: 'danger',
      to: wrongListPath.value
    })
  }

  if (props.repeatWrongCount >= 3 && wrongListPath.value) {
    list.push({
      id: 'repeat',
      score: 90 + props.repeatWrongCount,
      title: `${props.repeatWrongCount} 道反复错 → 优先回炉`,
      detail: '错 2 次以上说明上次没真懂。这几道在错题清单里点「重复出错」就能筛出来，勾选后直接生成重练卷',
      cta: '去错题清单',
      tone: 'warning',
      to: wrongListPath.value
    })
  }

  if (props.basicCount > 0 && wrongListPath.value) {
    list.push({
      id: 'basic',
      score: 70,
      title: `${props.basicCount} 道已记住 → 本周重练做二次验证`,
      detail: '已经答对过 1 次（还不算彻底掌握）。本周重练卷会自动带上它们，再对一次就能升级为彻底掌握',
      cta: '去错题清单',
      tone: 'info',
      to: wrongListPath.value
    })
  }

  const zero = (props.zeroAccuracyTags || []).slice(0, 3)
  if (zero.length >= 2) {
    list.push({
      id: 'knowledge',
      score: 60 + zero.length,
      title: `${zero.length} 个知识点全错 → 合并讲一节`,
      detail: `${zero.join('、')} 等都还没对过 —— 多半是同一块内容拆成了多个标签，建议一次讲透再重练`,
      cta: '备课视图待开发',
      tone: 'info',
      // ⛔ 显式禁用，不跳任何路由。原抽屉接口 /teaching/diagnosis/:tag 随 r137 下线，
      //    负责人 2026-10-05 裁决备课功能暂不开发 —— 那就诚实地不可点，
      //    而不是跳回本页假装有反应（跳本页 = 坏按钮，视觉上与BUG 无异）。
      disabled: true
    })
  }

  // 名次按排序结果给：r133 三条动作都写死 rank:1，页面会出现三个「①」。
  return list.sort((a, b) => b.score - a.score).map((action, i) => ({ ...action, rank: i + 1 }))
})

function run(action) {
  // 禁用的动作不跳任何地方（native <button disabled> 也会挡住，这里是第二道）
  if (action.disabled) return
  if (!action.to) return
  router.push(action.to)
}
</script>

<template>
  <div v-if="actions.length" class="nextlist">
    <!-- ⛔ 禁用的动作渲染成 div 而不是 disabled <button>：原生 disabled 按钮不可聚焦，
         但视觉与可点按钮几乎一样，读屏软件也会念它 —— 都会让「暂不可用」看着像能用。
         改成 div + aria-disabled，语义与视觉同时说清「这条现在点不了」。 -->
    <div
      v-for="action in actions"
      :key="action.id"
      class="nx"
      :class="[`is-${action.tone}`, { 'is-off': action.disabled }]"
      :role="action.disabled ? undefined : 'button'"
      :tabindex="action.disabled ? undefined : 0"
      :aria-disabled="action.disabled ? 'true' : undefined"
      @click="run(action)"
      @keydown.enter.prevent="run(action)"
      @keydown.space.prevent="run(action)"
    >
      <span class="nx__rank">{{ action.rank }}</span>
      <span class="nx__body">
        <strong class="nx__title">{{ action.title }}</strong>
        <span class="nx__detail">{{ action.detail }}</span>
      </span>
      <span class="nx__cta">{{ action.cta }}<el-icon v-if="!action.disabled"><ArrowRight /></el-icon></span>
    </div>
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
/* 禁用态：去掉手型与 hover 反馈，CTA 文字改为中性灰 —— 一眼看得出这条现在点不了 */
.nx.is-off{cursor:default;background:var(--wb-bg-elevated)}
.nx.is-off:hover{background:var(--wb-bg-elevated);border-color:var(--wb-border)}
.nx.is-off .nx__rank{background:var(--wb-text-tertiary)}
.nx.is-off .nx__cta{color:var(--wb-text-tertiary);font-weight:var(--wb-fw-medium)}
.nextlist__empty{padding:var(--wb-space-6) 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);text-align:center}
</style>
