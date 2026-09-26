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
      @lostpointercapture="finishStroke"
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
 * 通过 props.strokes 传入，watch 覆盖本地并重绘；每一笔「收笔」时 emit
 * 'update:strokes' 通知父组件持久化（localStorage）。
 *
 * ── 2026-09-26 书写体验重构（卡顿 / 掉笔 / 橡皮盖题干）───────────────
 * 1. 书写过程完全不进 Vue 响应式：进行中的一笔存普通对象，收笔才提交并
 *    emit。原先每个 pointermove 都 emit 全量数组 → 父组件 setState → prop
 *    回流 → watch 覆盖本地 → 触发重绘，一遍响应式回流叠加「全量重绘所有
 *    笔画」，写多几笔就开始卡。
 * 2. 增量绘制：书写中只画新增长出的线段（几何与全量重绘逐段一致，见
 *    drawSegment 注释），全量重绘只在切题 / 撤销 / 清空 / 尺寸变化时发生。
 * 3. getCoalescedEvents：笔的原始采样率（120-240Hz）高于 pointermove 的
 *    派发频率，合并事件里的原始点全部收进笔迹 —— 快写不断线、曲线更顺。
 * 4. 「写下去不出字」三处修复：
 *      ① 触控笔不再要求 button===0 —— 握笔时误碰笔杆键会让整笔丢失：
 *         笔杆键悬空按下就会先触发一次 button=2 的 pointerdown（旧代码直接
 *         丢弃），随后笔尖贴屏不会补发 pointerdown，整笔就没了。现在笔杆
 *         按下进入「待命」，笔尖贴屏（pointermove 里 buttons 含笔尖位）时
 *         补起笔；单独的笔杆单击不落墨。笔的「橡皮端」贴屏（button=5）
 *         当作橡皮。
 *      ② setPointerCapture 包 try —— 指针已消失时它会抛 NotFoundError，
 *         原先整个 pointerdown 由此中断，一笔都画不出来。
 *      ③ pointermove 里 buttons 归零视为抬笔 —— 快速提笔时 pointerup 可能
 *         丢失，原先会带着 drawing 状态悬空乱画。
 * 5. 橡皮改为 destination-out 真擦除：原先在透明画布上涂白色，会把橡皮
 *    轨迹下的题目文本一起盖掉。导出图改为在独立透明层上按同样语义先画
 *    笔迹再合成，橡皮不再擦掉导出图里的题干。
 * 6. getContext({ desynchronized: true })：Chrome/Edge 下降低落笔到出墨的
 *    合成延迟；不支持时浏览器自动忽略。
 */
import { onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

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

// 已收笔的笔迹（唯一可变数据）。shallowRef：一笔几百个点位，深度响应式代理
// 是纯开销 —— 重绘由本组件手动触发，父组件只会整组替换这个数组。
const localStrokes = shallowRef([])

let ctx = null
let drawing = false
let activePointerId = null
// 笔杆键悬空按下后的「待命」态：等笔尖贴屏再真正起笔（见 onPointerDown）
let penArmed = false
// 进行中的一笔：普通对象，刻意不进响应式（见文件头注释 1）
let liveStroke = null
// 已增量画出的段数（段 i 以 pts[i] 的中点收尾）；与全量重绘逐段几何一致
let liveDrawnSegs = 0
// 本笔开始时缓存的画布矩形。getBoundingClientRect 会强制排版，原先每个
// pointermove 都调一次；一笔之内画布位置不变，缓存即可，syncSize 时失效。
let cachedRect = null
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
  ctx = canvas.getContext('2d', { desynchronized: true })
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  cachedRect = null
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

// 外部替换笔迹（切题 / 撤销 / 清空）→ 覆盖本地并重绘。
// immediate:true 必需：本组件若在「已有笔迹」的情况下挂载（首次进入某题、
// 或切题时重建画布），初始 props.strokes 不会触发 watch，笔迹不会绘制；
// 更糟的是随后第一笔会以空数组为底写入，把已存的笔迹覆盖掉。
// 自身收笔 emit 的数组回流（同一引用）在这里被识别并跳过，不做无谓重绘。
watch(() => props.strokes, (val) => {
  if (val === localStrokes.value) return
  // 切题 / 撤销发生在一笔未收时：直接丢弃进行中的一笔（尚未提交，不会串题）
  drawing = false
  penArmed = false
  activePointerId = null
  liveStroke = null
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  localStrokes.value = Array.isArray(val) ? val : []
  redraw()
}, { deep: false, immediate: true })

function pointFromEvent(e) {
  const rect = cachedRect || (cachedRect = canvasRef.value.getBoundingClientRect())
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    p: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
  }
}

// ── 落笔 ────────────────────────────────────────────────────────────
function onPointerDown(e) {
  if (props.disabled) return
  if (e.pointerType === 'touch' && !props.allowTouch) return
  // 鼠标仍要求左键；触控笔不挑 button（见文件头注释 4①）
  if (e.pointerType === 'mouse' && e.button !== 0) return
  // 一笔没收完前忽略新的落笔（双指 / 手掌不会叠出第二笔）
  if (drawing && activePointerId !== e.pointerId) return
  try { canvasRef.value.setPointerCapture(e.pointerId) } catch { /* 指针已消失：仍可画，只是失去捕获 */ }
  activePointerId = e.pointerId
  // 触控笔的笔杆键悬空按下（buttons=32、无笔尖）会先触发一次 pointerdown：
  // 此时进入「待命」而不落墨 —— 握笔误碰笔杆不应在悬空点留杂点。笔尖随后
  // 贴屏不会再补发 pointerdown，由 pointermove 里检测到笔尖贴上时补起笔，
  // 这样「碰着笔杆写字」的整笔不会丢（旧代码两头都丢，一笔画不出）。
  if (e.pointerType === 'pen' && (e.buttons & 1) !== 1 && e.button !== 5) {
    penArmed = true
    return
  }
  startStroke(e, e.pointerType === 'pen' && e.button === 5)
}

/** 真正起笔：建笔画、缓存矩形、落墨点 */
function startStroke(e, eraserEnd) {
  drawing = true
  penArmed = false
  cachedRect = canvasRef.value.getBoundingClientRect()
  liveStroke = {
    tool: eraserEnd ? 'eraser' : tool.value,
    color: color.value,
    size: size.value,
    points: [pointFromEvent(e)],
  }
  liveDrawnSegs = 0
  // 落笔即出墨点：单击 / 顿笔也要立刻可见
  drawDot(ctx, liveStroke)
}

// ── 行笔：只收点 + 增量画新段。不碰响应式、不 emit、不全量重绘 ──────
function onPointerMove(e) {
  if (!drawing) {
    // 「待命」中的笔杆键 + 笔尖此刻贴屏 → 补起笔
    if (penArmed && e.pointerId === activePointerId
        && e.pointerType === 'pen' && (e.buttons & 1) === 1) {
      startStroke(e, false)
    }
    return
  }
  if (e.pointerId !== activePointerId) return
  // 抬笔事件丢失（快速提笔超出感应范围）的兜底：buttons 归零 = 这一笔已结束
  if (e.buttons === 0) { finishStroke(); return }
  // 合并事件里的原始采样点全部收进来（120-240Hz），快写不断线
  const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null
  if (coalesced && coalesced.length > 0) {
    for (const ce of coalesced) appendLivePoint(pointFromEvent(ce))
  } else {
    appendLivePoint(pointFromEvent(e))
  }
  scheduleLiveRender()
}

function appendLivePoint(pt) {
  const pts = liveStroke.points
  const last = pts[pts.length - 1]
  if (last && last.x === pt.x && last.y === pt.y) return
  pts.push(pt)
}

function scheduleLiveRender() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (!liveStroke) return
    drawLiveSegments(ctx, liveStroke, liveDrawnSegs)
    liveDrawnSegs = liveStroke.points.length - 1
  })
}

// ── 收笔（pointerup / cancel / 捕获丢失 / buttons 归零共用）─────────
function onPointerUp(e) {
  // 待命中的笔杆键抬起了（没等到笔尖贴屏）：撤销待命，不出墨
  if (!drawing) {
    if (penArmed && e.pointerId === activePointerId) penArmed = false
    return
  }
  if (e.pointerId !== activePointerId) return
  // 抬笔位置也收进笔迹，比最后一个 move 更贴近真实停笔点
  appendLivePoint(pointFromEvent(e))
  finishStroke()
}

function finishStroke() {
  if (!drawing) return
  drawing = false
  penArmed = false
  activePointerId = null
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  const stroke = liveStroke
  liveStroke = null
  if (!stroke || !ctx) return
  // 补画未渲染的段 + 收尾直线段（与全量重绘同一几何）
  drawLiveSegments(ctx, stroke, liveDrawnSegs)
  if (stroke.points.length >= 2) drawTail(ctx, stroke)
  // 提交 + 通知父组件（localStorage 防抖保存、讲题信号都挂在这一刻）
  localStrokes.value = [...localStrokes.value, stroke]
  emit('update:strokes', localStrokes.value)
}

// ── 笔迹渲染 ────────────────────────────────────────────────────────
function lineWidth(stroke) {
  return stroke.tool === 'eraser' ? (stroke.size || 3) * 7 : (stroke.size || 3)
}

/** 段样式：橡皮 destination-out 真擦除；粗细随压感逐段变化 */
function applyStrokeStyle(g, stroke, pt) {
  g.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
  if (stroke.tool !== 'eraser') g.strokeStyle = stroke.color || '#E11D48'
  const press = pt && pt.p && pt.p > 0 ? pt.p : 0.5
  g.lineWidth = lineWidth(stroke) * (0.7 + 0.6 * press)
  g.lineCap = 'round'
  g.lineJoin = 'round'
}

/** 墨点（单击 / 顿笔）：零长度线段 + 圆帽会画出一个圆点 */
function drawDot(g, stroke) {
  if (!g) return
  const p0 = stroke.points[0]
  applyStrokeStyle(g, stroke, p0)
  g.beginPath()
  g.moveTo(p0.x, p0.y)
  g.lineTo(p0.x, p0.y)
  g.stroke()
}

/**
 * 画第 i 段（i≥1）。几何与逐段循环的全量重绘完全一致：
 *   起点 = 上一段的终点（首段为 pts[0]），控制点 pts[i-1]，终点 = pts[i-1]/pts[i] 中点。
 * 因此书写中增量画出的笔迹和事后全量重绘像素级一致。
 */
function drawSegment(g, s, i) {
  const pts = s.points
  const prev = pts[i - 1]
  const cur = pts[i]
  const mx = (prev.x + cur.x) / 2
  const my = (prev.y + cur.y) / 2
  const start = i === 1
    ? pts[0]
    : { x: (pts[i - 2].x + pts[i - 1].x) / 2, y: (pts[i - 2].y + pts[i - 1].y) / 2 }
  applyStrokeStyle(g, s, cur)
  g.beginPath()
  g.moveTo(start.x, start.y)
  g.quadraticCurveTo(prev.x, prev.y, mx, my)
  g.stroke()
}

/** 收尾段：从最后一个中点直线连到末落点 */
function drawTail(g, s) {
  const pts = s.points
  const n = pts.length
  applyStrokeStyle(g, s, pts[n - 1])
  g.beginPath()
  g.moveTo((pts[n - 2].x + pts[n - 1].x) / 2, (pts[n - 2].y + pts[n - 1].y) / 2)
  g.lineTo(pts[n - 1].x, pts[n - 1].y)
  g.stroke()
}

/** 从第 fromSegs+1 段开始增量画到最新（书写中 / 收笔补画共用） */
function drawLiveSegments(g, s, fromSegs) {
  if (!g) return
  for (let i = fromSegs + 1; i < s.points.length; i++) drawSegment(g, s, i)
}

/** 全量重绘（切题 / 撤销 / 清空 / 尺寸变化时） */
function redraw() {
  if (!ctx || !canvasRef.value) return
  const ratio = dpr()
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, canvasRef.value.width / ratio, canvasRef.value.height / ratio)
  for (const s of localStrokes.value) {
    if (!s.points || s.points.length === 0) continue
    if (s.points.length === 1) { drawDot(ctx, s); continue }
    for (let i = 1; i < s.points.length; i++) drawSegment(ctx, s, i)
    drawTail(ctx, s)
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
    // 笔迹先画在独立透明层上（橡皮 = destination-out 只擦笔迹层），再整体
    // 合成到白底导出图 —— 橡皮不该把题干文本也一起擦掉
    const ink = document.createElement('canvas')
    ink.width = out.width
    ink.height = out.height
    const ictx = ink.getContext('2d')
    ictx.setTransform(ratio, 0, 0, ratio, 0, 0)
    for (const s of localStrokes.value) {
      if (!s.points || s.points.length === 0) continue
      if (s.points.length === 1) { drawDot(ictx, s); continue }
      for (let i = 1; i < s.points.length; i++) drawSegment(ictx, s, i)
      drawTail(ictx, s)
    }
    octx.save()
    octx.setTransform(1, 0, 0, 1, 0, 0)
    octx.drawImage(ink, 0, 0)
    octx.restore()
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
