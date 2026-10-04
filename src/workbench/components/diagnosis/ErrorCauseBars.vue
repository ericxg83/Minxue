<script setup>
/**
 * 错因分布条（r133 学习诊断重构）。
 *
 * 为什么从「一张表格」改成「横向条」：
 * 老师要的不是"错因清单"，而是"哪一类最该先抓"。条形宽度直接编码占比，
 * 扫一眼就知道优先级；表格做不到（要横向对比 8 行的数字很费力）。
 *
 * ⛔ 排序固定为「按占比降序」——不排序的话老师每次都要自己找最大值。
 * ⛔ 占比为 0 的错因不显示（那不叫分布，叫噪声）。
 *
 * 颜色：只用 --wb-status-* 系列（5 档标准状态色），不引入新色值。
 * 首项（占比最高者）用 danger 强调 —— 它就是「最该抓的那一类」。
 */
import { computed } from 'vue'

const props = defineProps({
  // [{ errorType: string, count: number, ratio: number }]
  items: { type: Array, default: () => [] },
  // 已分析错题总数，用于「未分析」兜底行
  total: { type: Number, default: 0 }
})

const emit = defineEmits(['select'])

// 占比 ≥1% 且有 count 的才排进来；降序
const rows = computed(() =>
  (props.items || [])
    .filter(e => e && e.count > 0 && (e.ratio ?? 0) >= 1)
    .slice()
    .sort((a, b) => b.count - a.count)
)
// 最大值作为条宽基准（100% = 最高那一项），避免第一名永远顶格、后面全挤在左边
const maxCount = computed(() => (rows.value.length ? rows.value[0].count : 0))
const topRatio = computed(() => (rows.value.length ? rows.value[0].ratio : 0))

// 语义色：前两名（真正要抓的）用 danger/warning，其余用 info 降调
const toneOf = (index) => {
  if (index === 0) return 'danger'
  if (index === 1) return 'warning'
  if (index === 2) return 'info'
  return 'neutral'
}
</script>

<template>
  <div class="errdist">
    <div v-if="!rows.length" class="errdist__empty">
      还没有错因数据。错因会在每周一凌晨自动回填，或随批改逐步补齐。
    </div>
    <template v-else>
      <!-- r138：轻量分析列表。行间只靠 hairline 分隔（原来靠 8px gap 撑开，
           在无容器布局里会读成散落的行而不是一张表）。
           首行加「最需要关注」标记 —— 它就是最该抓的那一类。 -->
      <div class="errdist__head" aria-hidden="true">
        <span>错因</span><span>占比</span>
      </div>
      <button
        v-for="(row, i) in rows"
        :key="row.errorType"
        type="button"
        class="errdist__row"
        :class="[`is-${toneOf(i)}`, { 'is-top': i === 0 }]"
        :aria-label="`${row.errorType}，${row.count} 道，占 ${row.ratio}%，点击查看题目`"
        @click="emit('select', row)"
      >
        <span class="errdist__name">
          <i v-if="i === 0" class="errdist__flag">最需要关注</i>{{ row.errorType }}
        </span>
        <span class="errdist__track">
          <span
            class="errdist__fill"
            :style="{ width: `${maxCount > 0 ? (row.count / maxCount) * 100 : 0}%` }"
          />
        </span>
        <span class="errdist__num">
          <b>{{ row.count }}</b>道
          <em>{{ row.ratio }}%</em>
        </span>
      </button>
      <p v-if="topRatio >= 50 && topRatio < 100" class="errdist__hint">
        一半以上集中在「{{ rows[0].errorType }}」—— 这是最值得先抓的一类。
      </p>
    </template>
  </div>
</template>

<style scoped>
.errdist{display:flex;flex-direction:column}
/* 表头：极轻的一行标签，让「占比」列有对齐基准（结构即信息，不是装饰） */
.errdist__head{
  display:grid;grid-template-columns:var(--errdist-name-w) 1fr var(--errdist-num-w);
  gap:var(--wb-space-4);padding:0 var(--wb-space-2) var(--wb-space-2);
  color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);
}
.errdist__head span:last-child{text-align:right}
.errdist__empty{padding:var(--wb-space-6) 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);text-align:center}
/* 行间用 hairline（不是 gap）—— 让它读成一张紧凑的表，而不是散落的行 */
.errdist__row{
  --errdist-name-w:150px;
  --errdist-num-w:104px;
  display:grid;grid-template-columns:var(--errdist-name-w) 1fr var(--errdist-num-w);
  align-items:center;gap:var(--wb-space-4);
  width:100%;padding:var(--wb-space-3) var(--wb-space-2);
  border:0;border-bottom:1px solid var(--wb-border-light);
  background:transparent;cursor:pointer;text-align:left;
  transition:background var(--wb-motion-fast) var(--wb-motion-ease);
}
.errdist__row:hover{background:var(--wb-bg-hover)}
.errdist__row:focus-visible{outline:2px solid var(--wb-status-info-fg);outline-offset:-2px}
/* 首行稍加重：占比最高的那类就是结论本身 */
.errdist__row.is-top .errdist__name{font-weight:var(--wb-fw-semibold)}
.errdist__name{display:flex;align-items:center;gap:var(--wb-space-2);font-size:var(--wb-fs-body);color:var(--wb-text);font-weight:var(--wb-fw-medium)}
/* 「最需要关注」是文字标记，不是色块 —— 少一个矩形就少一个容器感 */
.errdist__flag{font-style:normal;font-size:var(--wb-fs-caption);color:var(--wb-status-danger-fg);font-weight:var(--wb-fw-semibold)}
/* r138：条高 8px → 5px，改成细分析列表的辅助刻度，不与主数字抢重量 */
.errdist__track{height:5px;background:var(--wb-bg-mist);border-radius:var(--wb-radius-pill);overflow:hidden}
.errdist__fill{display:block;height:100%;border-radius:var(--wb-radius-pill)}
.errdist__num{display:flex;align-items:baseline;justify-content:flex-end;gap:4px;font-variant-numeric:tabular-nums;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}
.errdist__num b{font-size:var(--wb-fs-body);font-weight:var(--wb-fw-bold);color:var(--wb-text)}
.errdist__num em{font-style:normal;font-size:var(--wb-fs-caption);color:var(--wb-text-tertiary);min-width:34px;text-align:right}

.is-danger .errdist__fill{background:var(--wb-status-danger-fg)}
.is-warning .errdist__fill{background:var(--wb-status-warning-fg)}
.is-info .errdist__fill{background:var(--wb-status-info-fg)}
.is-neutral .errdist__fill{background:var(--wb-status-neutral-fg)}
.is-danger .errdist__name{color:var(--wb-status-danger-fg)}
.is-warning .errdist__name{color:var(--wb-status-warning-fg)}

/* 窄屏：名称列收窄，条形区保住最小可读长度 */
@media(max-width:640px){
  .errdist__row,.errdist__head{--errdist-name-w:104px;--errdist-num-w:88px;gap:var(--wb-space-3)}
  .errdist__flag{display:none}
}

.errdist__hint{
  margin:var(--wb-space-3) 0 0;padding:var(--wb-space-3) var(--wb-space-4);
  background:var(--wb-status-warning-bg);border-left:3px solid var(--wb-status-warning-fg);
  border-radius:var(--wb-radius-xs);color:#78350F;font-size:var(--wb-fs-meta);line-height:var(--wb-lh-relaxed);
}
</style>
