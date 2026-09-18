<template>
  <div class="drawing-canvas" ref="wrapRef">
    <canvas
      ref="canvasRef"
      class="dc-canvas"
      :class="{ 'dc-eraser': tool === 'eraser' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerUp"
    />
  </div>
</template>

<script setup>
/**
 * DrawingCanvas · 白板手写层（Canvas 2D + Pointer Events）
 *
 * 用途：周末班讲题白板的手写标注层。覆盖在题目 HTML 上方，透明背景，
 * 笔迹与题目分层叠加（清笔画不破坏题目）。统一支持鼠标 / 触控笔（含压感）/
 * 触摸屏（Pointer Events 原生能力）。
 *
 * 功能：换色 / 换粗细 / 橡皮 / 撤销 / 清空 / 导出板书图（白底 + 题干文本 +
 * 配图 + 笔迹 → PNG 下载）。
 *
 * 数据流：组件内部维护 localStrokes 作为唯一书写源；外部「切题替换笔迹」
 * 通过 props.strokes 传入，watch 覆盖本地并重绘；每次书写后 emit
 * 'update:strokes' 通知父组件持久化（localStorage）。
 */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  strokes: { type: Array, default: () => [] },
  exportTitle: { type: String, default: '' },
  exportTexts: { type: Array, default: () => [] },
  exportFigure: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  // 防手掌误触（2026-09-17 平板+笔场景）：默认只有触控笔/鼠标可书写，
  // 手指（touch）默认忽略——平板写字时手掌贴在屏幕不会误画。
  // 需要手指绘图时由页面工具栏显式开启。
  allowTouch: { type: Boolean, default: false },
})
const emit = defineEmits(['update:strokes'])

const tool = defineModel('tool', { type: String, default: 'pen' })
const color = defineModel('color', { type: String, default: '#E11D48' })
const size = defineModel('size', { type: Number, default: 3 })

const wrapRef = ref(null)
const canvasRef = ref(null)

// 本地书写源（唯一可变数据）；props.strokes 仅作「外部替换」输入
const localStrokes = ref([])
let ctx = null
let drawing = false
let rafId = null

function dpr() { return Math.min(window.devicePixelRatio || 1, 2) }

function syncSize() {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  const w = wrap.clientWidth
  const h = wrap.clientHeight
  if (w === 0 || h === 0) return
  const ratio = dpr()
  canvas.width = Math.round(w * ratio)
  canvas.height = Math.round(h * ratio)
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  ctx = canvas.getContext('2d')
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  redraw()
}

let resizeObserver = null
onMounted(() => {
  syncSize()
  resizeObserver = new ResizeObserver(() => syncSize())
  if (wrapRef.value) resizeObserver.observe(wrapRef.value)
})
onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (rafId) cancelAnimationFrame(rafId)
})

// 外部替换笔迹（切题）→ 覆盖本地。
// immediate:true 必需：本组件若在「已有笔迹」的情况下挂载（首次进入某题、
// 或切题时重建画布），初始 props.strokes 不会触发 watch，笔迹不会绘制；
// 更糟的是随后第一笔会以空数组为底写入，把已存的笔迹覆盖掉。
watch(() => props.strokes, (val) => {
  if (val !== localStrokes.value) {
    localStrokes.value = Array.isArray(val) ? val : []
  }
  redraw()
}, { deep: false, immediate: true })

function pointFromEvent(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    p: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
  }
}

function onPointerDown(e) {
  if (props.disabled) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  // 平板防手掌误触：默认忽略手指，仅触控笔(pen)与鼠标可写
  if (e.pointerType === 'touch' && !props.allowTouch) return
  canvasRef.value.setPointerCapture(e.pointerId)
  drawing = true
  const stroke = {
    tool: tool.value,
    color: color.value,
    size: size.value,
    points: [pointFromEvent(e)],
  }
  localStrokes.value = [...localStrokes.value, stroke]
  emit('update:strokes', localStrokes.value)
}

function onPointerMove(e) {
  if (!drawing) return
  const pt = pointFromEvent(e)
  const arr = localStrokes.value
  const cur = arr[arr.length - 1]
  if (!cur) return
  const last = cur.points[cur.points.length - 1]
  if (last && last.x === pt.x && last.y === pt.y) return
  cur.points.push(pt)
  emit('update:strokes', [...arr])
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => redraw())
}

function onPointerUp() {
  if (!drawing) return
  drawing = false
  redraw()
}

function lineWidth(stroke) {
  return stroke.tool === 'eraser' ? (stroke.size || 3) * 7 : (stroke.size || 3)
}

function redraw() {
  if (!ctx || !canvasRef.value) return
  const ratio = dpr()
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, canvasRef.value.width / ratio, canvasRef.value.height / ratio)
  for (const s of localStrokes.value) {
    if (!s.points || s.points.length === 0) continue
    ctx.strokeStyle = s.tool === 'eraser' ? '#FFFFFF' : (s.color || '#E11D48')
    ctx.lineWidth = lineWidth(s)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const pts = s.points
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const cur = pts[i]
      const mx = (prev.x + cur.x) / 2
      const my = (prev.y + cur.y) / 2
      const press = cur.p && cur.p > 0 ? cur.p : 0.5
      ctx.lineWidth = lineWidth(s) * (0.7 + 0.6 * press)
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(mx, my)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
    ctx.stroke()
  }
}

// ── 导出板书图：白底 + 题干文本 + 配图 + 笔迹 → PNG ──
function wrapText(octx, text, maxW) {
  const lines = []
  let cur = ''
  for (const ch of String(text || '')) {
    const test = cur + ch
    if (octx.measureText(test).width > maxW && cur) {
      lines.push(cur)
      cur = ch
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

function exportPng(filename = '板书.png') {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const W = wrap.clientWidth
  const H = wrap.clientHeight
  const out = document.createElement('canvas')
  out.width = Math.round(W * ratio)
  out.height = Math.round(H * ratio)
  const octx = out.getContext('2d')
  octx.setTransform(ratio, 0, 0, ratio, 0, 0)
  octx.fillStyle = '#FFFFFF'
  octx.fillRect(0, 0, W, H)

  octx.fillStyle = '#1E293B'
  octx.font = '600 18px "Microsoft YaHei", sans-serif'
  let y = 40
  if (props.exportTitle) {
    octx.fillText(props.exportTitle.slice(0, 60), 24, y)
    y += 34
  }
  octx.font = '15px "Microsoft YaHei", sans-serif'
  for (const t of props.exportTexts || []) {
    const lines = wrapText(octx, t, W - 48)
    for (const ln of lines) {
      octx.fillText(ln, 24, y)
      y += 26
      if (y > H - 20) break
    }
    if (y > H - 20) break
  }

  const finish = () => {
    for (const s of localStrokes.value) {
      if (!s.points || s.points.length === 0) continue
      octx.strokeStyle = s.tool === 'eraser' ? '#FFFFFF' : (s.color || '#E11D48')
      octx.lineWidth = lineWidth(s)
      octx.lineCap = 'round'
      octx.lineJoin = 'round'
      octx.beginPath()
      const pts = s.points
      octx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1]
        const cur = pts[i]
        const mx = (prev.x + cur.x) / 2
        const my = (prev.y + cur.y) / 2
        octx.quadraticCurveTo(prev.x, prev.y, mx, my)
        octx.stroke()
        octx.beginPath()
        octx.moveTo(mx, my)
      }
      octx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
      octx.stroke()
    }
    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  if (props.exportFigure) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const iw = img.width
      const ih = img.height
      const maxW = W - 48
      const maxH = Math.max(120, H - y - 30)
      const r = Math.min(maxW / iw, maxH / ih, 1.5)
      octx.drawImage(img, 24, Math.min(y + 10, H - (ih * r) - 10), iw * r, ih * r)
      finish()
    }
    img.onerror = finish
    img.src = props.exportFigure
    return
  }
  finish()
}

defineExpose({ exportPng, redraw, syncSize })
</script>

<style scoped>
.drawing-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 3;
}
.dc-canvas {
  display: block;
  cursor: crosshair;
  touch-action: none;
}
.dc-canvas.dc-eraser {
  cursor: cell;
}
</style>
