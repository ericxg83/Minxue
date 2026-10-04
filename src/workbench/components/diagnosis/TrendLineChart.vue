<script setup>
/**
 * 正确率折线图（r30 新增，纯 SVG，不用 ECharts）。
 *
 * 为什么手写 SVG 而不是引 echarts：
 *   - DashboardWorkbench 已经引了 echarts，但它用的是 core + 按需注册那套；
 *     学习诊断只需要一条线 + 几个点，引入整套 core 依赖不划算。
 *   - 纯 SVG 无需 resize 监听、无需 nextTick 初始化，卸载零清理。
 *
 * 为什么必须有（负责人 2026-10-04 反馈「页面没有折线图」）：
 *   旧版「周期内学习趋势」只在周模式渲染，且读的字段名（day/total）与后端
 *   返回的（date/count）对不上 → 恒为 4% 空柱 + '-' 标签。全部/月模式则整块不渲染。
 *   这里统一消费后端 periodTrend（周=日桶 / 月与全部按实际跨度自适应分桶）。
 *
 * 空态原则：点数 < 2 时不画空图，直接说人话。
 */
import { computed } from 'vue'

const props = defineProps({
  points: { type: Array, default: () => [] }
})

const W = 720
const H = 200
const PAD = { top: 16, right: 16, bottom: 28, left: 38 }

// 只取有题量的点；accuracy 为 null 的点不画（折线断开，不插值伪造数据）
const valid = computed(() =>
  (props.points || [])
    .filter(p => p && Number(p.count) > 0 && p.accuracy != null)
    .map(p => ({ date: p.date, accuracy: Number(p.accuracy), count: p.count }))
)

const coords = computed(() => {
  const pts = valid.value
  if (pts.length === 0) return []
  // 单点时放在正中，折线退化成一个点 + 竖直标记，不画一条假趋势
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const xAt = (i) => (pts.length === 1 ? PAD.left + innerW / 2 : PAD.left + (innerW * i) / (pts.length - 1))
  // 纵轴 0~100 固定：正确率是百分比，固定量程比自适应量程更诚实（不会把 60%→80% 画成天壤之别）
  const yAt = (acc) => PAD.top + innerH * (1 - Math.max(0, Math.min(100, acc)) / 100)
  return pts.map((p, i) => ({ ...p, x: xAt(i), y: yAt(p.accuracy) }))
})

const polyline = computed(() => coords.value.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '))
const areaPath = computed(() => {
  const cs = coords.value
  if (cs.length < 2) return ''
  const base = H - PAD.bottom
  return `M ${cs.map(c => `${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' L ')} L ${cs[cs.length - 1].x.toFixed(1)} ${base} L ${cs[0].x.toFixed(1)} ${base} Z`
})
const gridLines = [0, 25, 50, 75, 100]
const yAt = (v) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / 100)
// X 轴标签最多 7 个，均匀抽样，避免密集时糊成一片
const xLabels = computed(() => {
  const cs = coords.value
  if (cs.length <= 7) return cs
  const step = Math.ceil(cs.length / 7)
  return cs.filter((_, i) => i % step === 0 || i === cs.length - 1)
})
// r132：点数变多（按天最多几十个）后，每个点都标数值会糊成一片。
// 稀疏时全标；密集时只标「首 / 末 / 最高 / 最低」四个关键点。
const valueLabels = computed(() => {
  const cs = coords.value
  if (cs.length <= 8) return cs
  const highest = cs.reduce((a, b) => (b.accuracy > a.accuracy ? b : a))
  const lowest = cs.reduce((a, b) => (b.accuracy < a.accuracy ? b : a))
  const picked = new Set([cs[0].date, cs[cs.length - 1].date, highest.date, lowest.date])
  return cs.filter(c => picked.has(c.date))
})
// 一天的标签太宽（'2026-09-10'），只留 MM-DD
const shortDate = (d) => String(d || '').slice(5) || d
const tone = computed(() => {
  const cs = coords.value
  if (cs.length < 2) return 'default'
  const delta = cs[cs.length - 1].accuracy - cs[0].accuracy
  if (delta >= 3) return 'up'
  if (delta <= -3) return 'down'
  return 'flat'
})
</script>

<template>
  <div class="trend-line">
    <div v-if="coords.length === 0" class="trend-line__empty">
      本周期没有批改记录，正确率走势需要至少 1 段有数据的时段
    </div>
    <div v-else-if="coords.length === 1" class="trend-line__single">
      <div class="trend-line__single-value">{{ coords[0].accuracy }}<small>%</small></div>
      <div class="trend-line__single-meta">{{ coords[0].date }} · 批改 {{ coords[0].count }} 题</div>
      <div class="trend-line__single-hint">只有一个时段的数据，出现第二段后这里会变成走势曲线</div>
    </div>
    <div v-else class="trend-line__canvas">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`正确率走势，${coords.length} 个时段，${tone === 'up' ? '整体上升' : tone === 'down' ? '整体下降' : '基本持平'}`">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--wb-primary)" stop-opacity="0.20" />
            <stop offset="100%" stop-color="var(--wb-primary)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <g class="trend-line__grid">
          <template v-for="value in gridLines" :key="value">
            <line :x1="PAD.left" :y1="yAt(value)" :x2="W - PAD.right" :y2="yAt(value)" />
            <text :x="PAD.left - 6" :y="yAt(value) + 3" text-anchor="end">{{ value }}%</text>
          </template>
        </g>
        <path v-if="areaPath" :d="areaPath" fill="url(#trendFill)" />
        <polyline :points="polyline" class="trend-line__stroke" :class="`is-${tone}`" />
        <g v-for="point in coords" :key="point.date">
          <circle :cx="point.x" :cy="point.y" :r="coords.length > 20 ? 2.5 : 3.5" class="trend-line__dot" :class="`is-${tone}`">
            <title>{{ shortDate(point.date) }} · {{ point.correct }}/{{ point.count }} 题 · {{ point.accuracy }}%</title>
          </circle>
        </g>
        <g v-for="label in valueLabels" :key="`v-${label.date}`">
          <text :x="label.x" :y="label.y - 9" text-anchor="middle" class="trend-line__value">{{ label.accuracy }}%</text>
        </g>
        <g class="trend-line__x">
          <text v-for="label in xLabels" :key="label.date" :x="label.x" :y="H - 8" text-anchor="middle">{{ shortDate(label.date) }}</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.trend-line{width:100%}
.trend-line__empty{padding:44px 20px;color:var(--wb-text-tertiary);font-size:12px;text-align:center}
.trend-line__single{display:flex;padding:22px 4px;flex-direction:column;gap:6px}
.trend-line__single-value{color:var(--wb-text);font-size:34px;font-weight:700;line-height:1.1}
.trend-line__single-value small{font-size:16px;font-weight:600}
.trend-line__single-meta{color:var(--wb-text-secondary);font-size:12px}
.trend-line__single-hint{margin-top:8px;color:var(--wb-text-tertiary);font-size:11px}
.trend-line__canvas svg{display:block;width:100%;height:auto}
.trend-line__grid line{stroke:var(--wb-border-light);stroke-width:1;stroke-dasharray:3 3}
.trend-line__grid text{fill:var(--wb-text-tertiary);font-size:9px}
.trend-line__stroke{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.trend-line__stroke.is-up{stroke:var(--wb-success)}
.trend-line__stroke.is-down{stroke:var(--wb-danger)}
.trend-line__stroke.is-flat{stroke:var(--wb-primary)}
.trend-line__dot{stroke:#fff;stroke-width:2}
.trend-line__dot.is-up{fill:var(--wb-success)}
.trend-line__dot.is-down{fill:var(--wb-danger)}
.trend-line__dot.is-flat{fill:var(--wb-primary)}
.trend-line__value{fill:var(--wb-text-secondary);font-size:10px;font-weight:600}
.trend-line__x text{fill:var(--wb-text-tertiary);font-size:9px}
</style>
