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
 * ⛔ r141（负责人验收）：CTA 文案不许承诺本页做不到的事，动作必须落到
 *    「真能把这事做完」的地方。当时三条动作一律 push('/students')（学生**列表**页），
 *    与「重练卷」毫无关系；knowledge 动作 push('/weekly-report') = 跳本页自己
 *    ⇒ 点了毫无反应，看着像个坏按钮。knowledge 那条已显式禁用
 *    （负责人 2026-10-05 裁决「备课功能暂不开发」）。
 *
 * ⛔ r142（负责人验收）：jump 到档案页**仍然**不算做完 —— 原话「点击去错题清单之后
 *    也没有很顺手的页面，体验很差」。档案页那 49 道题要自己在长列表里逐条勾，
 *    且勾选状态与本页的「49 道同类错因」没有任何关系（等于把筛选重做一遍）。
 *    ⇒ 三条动作改为**就地打开重练卷预览弹窗**：按错因预筛、默认全选、
 *    可逐题减选、确认后组卷出纸（走移动端同一条管线）。
 *    所以本组件不再自己跳路由，而是 emit('preview', scope) 交父组件开弹窗；
 *    wrongListPath 只作为弹窗里的「查看完整错题清单」次级出口保留。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight } from '@element-plus/icons-vue'
import RetryPaperPreviewDialog from './RetryPaperPreviewDialog.vue'

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
  // 当前诊断的学生 —— 重练卷要发给这个人，缺它就不给任何动作（宁可少一条）
  studentId: { type: String, default: '' },
  // 卷面标题与 PDF 文件名要用（弹窗内也会兜底再查一次）
  studentName: { type: String, default: '' }
})

const emit = defineEmits(['exam-created'])

const router = useRouter()

// 完整错题清单在学生档案页（r91 起错题中心并入档案页）。
// r142 起它只是弹窗里的**次级**出口（要看全部错因/全部题才去），主出口是就地预览组卷。
const wrongListPath = computed(() => (props.studentId ? `/students/${props.studentId}` : ''))

// ── 预览弹窗状态（r142）──
const previewVisible = ref(false)
const previewScope = ref(null)

function openPreview(scope) {
  previewScope.value = scope
  previewVisible.value = true
}

const actions = computed(() => {
  const list = []

  const top = (props.errorCauses || [])[0]
  if (top && top.count >= 3 && props.studentId) {
    list.push({
      id: 'error-cause',
      score: 100 + top.count,
      title: `${top.count} 道「${top.errorType}」→ 专项练`,
      detail: `占全部错题 ${top.ratio}%，是最大的一块。这 ${top.count} 道都带「${top.errorType}」标签，打开预览默认全选，嫌多可以逐题取消`,
      cta: '预览并组卷',
      tone: 'danger',
      scope: { kind: 'error-cause', errorType: top.errorType }
    })
  }

  if (props.repeatWrongCount >= 3 && props.studentId) {
    list.push({
      id: 'repeat',
      score: 90 + props.repeatWrongCount,
      title: `${props.repeatWrongCount} 道反复错 → 优先回炉`,
      detail: '错 2 次以上说明上次没真懂。打开预览会把这几道全部勾上，勾完直接出卷',
      cta: '预览并组卷',
      tone: 'warning',
      scope: { kind: 'repeat' }
    })
  }

  if (props.basicCount > 0 && props.studentId) {
    list.push({
      id: 'basic',
      score: 70,
      title: `${props.basicCount} 道已记住 → 本周重练做二次验证`,
      detail: '已经答对过 1 次（还不算彻底掌握）。本周重练卷会自动带上它们，再对一次就能升级为彻底掌握',
      cta: '预览并组卷',
      tone: 'info',
      scope: { kind: 'basic' }
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
  // 禁用的动作不触发任何事（native <button disabled> 也会挡住，这里是第二道）
  if (action.disabled) return
  // r142：能组卷的三条一律就地开预览弹窗（而不是跳档案页让老师自己重筛一遍）
  if (action.scope) { openPreview(action.scope); return }
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

    <!-- 次级出口：想看全部错因 / 全部题（含已掌握的）时才去完整清单。
         r142 起它不再是主路径 —— 主路径是上面点哪条就预览哪条。 -->
    <button v-if="wrongListPath" type="button" class="nextlist__more" @click="router.push(wrongListPath)">
      查看这名学生的完整错题清单
    </button>
  </div>
  <div v-else class="nextlist__empty">
    本周期还没有需要立刻处理的动作 —— 等新的批改数据进来再安排。
  </div>

  <!-- r142：专项重练卷预览弹窗。就地预筛 + 勾选 + 确认出卷，
       组卷与出纸复用 PC 错题清单同一条管线（createGeneratedExam + exportWrongBookPDF）。 -->
  <RetryPaperPreviewDialog
    v-model="previewVisible"
    :student-id="studentId"
    :student-name="studentName"
    :scope="previewScope"
    @created="(exam) => emit('exam-created', exam)"
  />
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
/* 次级出口：完整错题清单。视觉必须明显弱于上面三条动作（那是主路径）。 */
.nextlist__more{
  align-self:flex-start;margin-top:var(--wb-space-1);padding:4px 0;border:0;background:none;
  color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);cursor:pointer;
}
.nextlist__more:hover{color:var(--wb-status-info-fg);text-decoration:underline}
.nextlist__more:focus-visible{outline:2px solid var(--wb-status-info-fg);outline-offset:2px}
</style>
