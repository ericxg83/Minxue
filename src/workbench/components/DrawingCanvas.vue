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
 * 6. getContext 不使用 desynchronized（2026-09-26 撤回）：曾短暂改为
 *    `getContext('2d', { desynchronized: true })` 想降低合成延迟，实测在
 *    Windows Chrome / 部分 GPU 驱动下，透明画布会被合成为纯黑 —— 白板一
 *    打开整块题目区变黑（笔迹浮在黑底上），且落笔反而更迟滞。故回到默认
 *    合成路径，透明叠加恢复正常。
 */
import { onMounted, onBeforeUnmount, ref, shallowRef, toRaw, watch } from 'vue'

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
const emit = defineEmits(['update:strokes', 'pinchstart', 'pinchend'])

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

// ── 无限向下生长的虚拟画布 + 纸面缩放（2026-09-26/27）────────────────
// 画布 DOM 尺寸恒等于可视面板（内存有界，不做超高 canvas），笔迹坐标存
// 「板面空间」。视图变换（纸面 → 屏幕）：screen = board × zoom − pan。
// zoom=1 时 panX 恒为 0（横向不出界）。panY 越大 = 视图越往下移，露出更多
// 下方板书；写到接近可视底边时自动增大 panY 跟随笔尖 → 「无限往下写」。
// 双指捏合 / Ctrl+滚轮可缩放纸面（笔迹随纸面一起放大，像真纸）。
let zoom = 1
const ZOOM_MAX = 4
let panX = 0
let panY = 0
let contentMaxY = 0 // 已写笔迹的最大板面 Y，决定手动下滚的边界
let contentMaxX = 0 // 最大板面 X（放大平移后导出板书图要用）
const PAN_EDGE = 72 // 距可视底边多少 px 触发自动下滚跟随

// 滚轮平滑拉板的状态与取消（动画本体见文件尾 wheelPanBy）。声明必须在最前：
// strokes watch 是 immediate:true，setup 期间就会走切题路径调到 cancelWheelPan，
// 放在后面会踩 TDZ（Cannot access before initialization），整块题目区渲染失败。
let wheelTargetY = null
let wheelRafId = 0
function cancelWheelPan() {
  if (wheelRafId) { clearTimeout(wheelRafId); wheelRafId = 0 }
  wheelTargetY = null
}

// ── 双指捏合缩放（仅笔模式 allowTouch=false；手指绘画模式两指就是两笔画）──
// 触点记在这里，第二个触点落下才开始捏合。书写中 / 笔尖悬停时两个 touch 更
// 可能是手掌，拒绝缩放；收笔后只留 500ms 短窗口 —— 老师写完立刻捏合要跟手，
// 不能沿用 WeekendBoard 题干手势的 1200ms 长窗。
const PEN_PINCH_GRACE = 500
const touchPts = new Map() // 进行中的 touch 指针：pointerId → {x,y}
let pinch = null // 捏合会话：{ rect, startDist, startZoom, anchorBx, anchorBy }
let lastPenActiveAt = 0

/** 可视视口下各方向允许的平移上限（屏幕像素）。
 *  横向按「纸面宽度」：板面纸宽 = 视口宽（zoom 1 时恰好铺满），放大后可平移
 *  看右半张纸 —— 不能用墨迹边界做上限，否则缩放锚点需要的平移量会被钳掉，
 *  锚点跟随被破坏（点会跳位）。纵向纸面向下无限：内容底 + 一个 zoom 视口的
 *  空白纸面，写进去后 contentMaxY 生长，上限随之扩展。 */
function panYMax() {
  const H = wrapRef.value?.clientHeight || 0
  return Math.max(0, (contentMaxY + H) * zoom)
}
function panXMax() {
  const W = wrapRef.value?.clientWidth || 0
  return Math.max(0, W * (zoom - 1))
}

function dpr() { return Math.min(window.devicePixelRatio || 1, 2) }

/** 统一设置绘制变换：设备像素比 × 纸面缩放 + 板面→屏幕的 -pan 平移 */
function applyTransform() {
  if (!ctx) return
  const ratio = dpr()
  ctx.setTransform(ratio * zoom, 0, 0, ratio * zoom, -panX * ratio, -panY * ratio)
}

/** 重算已写内容的板面边界（切题 / 收笔后调用） */
function recomputeContentMax() {
  let mx = 0
  let my = 0
  for (const s of localStrokes.value) {
    for (const p of (s.points || [])) {
      if (p.y > my) my = p.y
      if (p.x > mx) mx = p.x
    }
  }
  contentMaxY = my
  contentMaxX = mx
}

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
  // 不能用 desynchronized:true —— 见文件头注释 6，会把透明层渲染成黑屏
  ctx = canvas.getContext('2d')
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
  cancelWheelPan()
})

// 外部替换笔迹（切题 / 撤销 / 清空）→ 覆盖本地并重绘。
// immediate:true 必需：本组件若在「已有笔迹」的情况下挂载（首次进入某题、
// 或切题时重建画布），初始 props.strokes 不会触发 watch，笔迹不会绘制；
// 更糟的是随后第一笔会以空数组为底写入，把已存的笔迹覆盖掉。
// 自身收笔 emit 的数组回流（同一引用）在这里被识别并跳过，不做无谓重绘。
watch(() => props.strokes, (val) => {
  // 回流识别要用 toRaw：父组件若是深度 ref，模板解包传回来的是响应式代理
  // （数组与内部笔画对象都被代理），严格等值比较必然失败 → 每笔收笔都被
  // 误判为「外部替换」而把视图归零（书写中上下弹动的元凶）。
  if (val === localStrokes.value || toRaw(val) === toRaw(localStrokes.value)) return
  // 切题 / 撤销发生在一笔未收时：直接丢弃进行中的一笔（尚未提交，不会串题）
  drawing = false
  penArmed = false
  activePointerId = null
  liveStroke = null
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  localStrokes.value = Array.isArray(val) ? val : []
  // 切题 / 外部替换：视图回原位（顶部 + 1:1），重算边界，丢弃进行中的捏合
  cancelWheelPan()
  if (pinch) { pinch = null; touchPts.clear(); emit('pinchend') }
  zoom = 1
  panX = 0
  panY = 0
  recomputeContentMax()
  redraw()
}, { deep: false, immediate: true })

function pointFromEvent(e) {
  const rect = cachedRect || (cachedRect = canvasRef.value.getBoundingClientRect())
  return {
    x: (e.clientX - rect.left + panX) / zoom,
    y: (e.clientY - rect.top + panY) / zoom,
    p: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
  }
}

// ── 双指捏合：跟踪触点 → 第二触点落下进入捏合 → 移动更新视图 ─────────
function trackTouchDown(e) {
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch || touchPts.size < 2) return
  // 正在书写 / 笔尖刚离屏片刻（悬停也算）：双触点是手掌，不缩放
  if (drawing || liveStroke || Date.now() - lastPenActiveAt < PEN_PINCH_GRACE) {
    touchPts.delete(e.pointerId)
    return
  }
  const [a, b] = [...touchPts.values()]
  const rect = canvasRef.value.getBoundingClientRect()
  pinch = {
    rect,
    startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    startZoom: zoom,
    // 锚点 = 捏合开始时中点下的板面坐标；缩放/平移全程保持它贴住中点
    anchorBx: ((a.x + b.x) / 2 - rect.left + panX) / zoom,
    anchorBy: ((a.y + b.y) / 2 - rect.top + panY) / zoom,
  }
  cancelWheelPan()
  emit('pinchstart')
}

function schedulePinchRender() {
  // 同步重算视图（pointermove 频率 60-120Hz，全量重绘毫秒级，可承受）；
  // 不走 rAF 节流 —— 后台/节流场景 rAF 不触发会让缩放完全失效
  const pts = [...touchPts.values()]
  if (pts.length < 2) return
  const [a, b] = pts
  const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
  const midX = (a.x + b.x) / 2 - pinch.rect.left
  const midY = (a.y + b.y) / 2 - pinch.rect.top
  zoom = Math.min(ZOOM_MAX, Math.max(1, pinch.startZoom * dist / pinch.startDist))
  panX = Math.min(Math.max(0, pinch.anchorBx * zoom - midX), panXMax())
  panY = Math.min(Math.max(0, pinch.anchorBy * zoom - midY), panYMax())
  redraw()
}

function endPinch() {
  const wasPinching = !!pinch
  pinch = null
  if (wasPinching) {
    panX = Math.min(Math.max(0, panX), panXMax())
    panY = Math.min(Math.max(0, panY), panYMax())
    redraw()
    emit('pinchend')
  }
}

// ── 落笔 ────────────────────────────────────────────────────────────
function onPointerDown(e) {
  if (props.disabled) return
  if (e.pointerType === 'pen') lastPenActiveAt = Date.now()
  if (e.pointerType === 'touch') {
    // 手指绘画开启时手指就是笔，两指 = 两笔画，不做捏合；笔模式下跟踪触点，
    // 第二个触点落下进入捏合缩放
    if (!props.allowTouch) trackTouchDown(e)
    return
  }
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
  // 落笔即出墨点：单击 / 顿笔也要立刻可见（先对齐含 zoom/pan 的变换）
  applyTransform()
  drawDot(ctx, liveStroke)
}

// ── 行笔：只收点 + 增量画新段。不碰响应式、不 emit、不全量重绘 ──────
function onPointerMove(e) {
  // 捏合中的双指触点：更新位置并按 rAF 节流重算视图
  if (e.pointerType === 'touch' && touchPts.has(e.pointerId)) {
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch) schedulePinchRender()
    return
  }
  if (e.pointerType === 'pen') lastPenActiveAt = Date.now()
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

/** 写到接近可视底边 → 下移视图跟随笔尖（无限往下）。平移后需整体重绘。
 *  返回 true 表示本帧已整体重绘，调用方无需再增量画。 */
function maybeAutoPan() {
  if (!liveStroke || !cachedRect) return false
  const H = cachedRect.height
  const last = liveStroke.points[liveStroke.points.length - 1]
  const screenY = last.y * zoom - panY
  if (screenY > H - PAN_EDGE) {
    cancelWheelPan() // 书写跟随接管视图，滚轮动画立即停
    panY += screenY - (H - PAN_EDGE)
    renderLiveFully()
    return true
  }
  return false
}

/** 整体重绘：已提交笔迹 + 进行中的一笔（自动下滚后增量段失效时用） */
function renderLiveFully() {
  redraw()
  if (!liveStroke || !ctx) return
  applyTransform()
  const s = liveStroke
  if (s.points.length === 1) {
    drawDot(ctx, s)
  } else {
    for (let i = 1; i < s.points.length; i++) drawSegment(ctx, s, i)
    drawTail(ctx, s)
  }
  liveDrawnSegs = s.points.length - 1
}

function scheduleLiveRender() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (!liveStroke) return
    // 自动下滚每帧至多一次（会整体重绘），避免逐 pointermove 反复全量重绘
    if (maybeAutoPan()) return
    drawLiveSegments(ctx, liveStroke, liveDrawnSegs)
    liveDrawnSegs = liveStroke.points.length - 1
  })
}

// ── 收笔（pointerup / cancel / 捕获丢失 / buttons 归零共用）─────────
function onPointerUp(e) {
  // 捏合 / 待跟踪的 touch 触点抬起：清触点，双指不足则结束捏合
  if (e.pointerType === 'touch' && touchPts.has(e.pointerId)) {
    touchPts.delete(e.pointerId)
    if (pinch && touchPts.size < 2) endPinch()
    return
  }
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
  for (const p of stroke.points) {
    if (p.y > contentMaxY) contentMaxY = p.y
    if (p.x > contentMaxX) contentMaxX = p.x
  }
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
  // 清屏用屏幕空间（不含 zoom/pan），把整块可视区擦净
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, canvasRef.value.width / ratio, canvasRef.value.height / ratio)
  // 笔迹按板面空间绘制（含 zoom/pan 变换）
  applyTransform()
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
  // 导出宽度/高度按板面内容的实际边界（缩放平移后笔迹可能超出可视区），至少一屏
  const W = Math.max(wrap.clientWidth, Math.ceil(contentMaxX) + 40)
  const H = Math.max(wrap.clientHeight, Math.ceil(contentMaxY) + 40)
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

/** 手动上下平移板书（工具栏 ▲/▼）。dir<0 上翻、dir>0 下翻；下滚不超过已写内容底边 */
function panBoard(dy) {
  cancelWheelPan()
  const next = Math.min(Math.max(0, panY + dy), Math.max(0, contentMaxY * zoom - (wrapRef.value?.clientHeight || 0) + 60))
  if (next === panY) return
  panY = next
  redraw()
}
/** 回到原位（顶部 + 1:1，露出题干） */
function resetView() {
  cancelWheelPan()
  if (panY !== 0 || panX !== 0 || zoom !== 1) {
    panX = 0
    panY = 0
    zoom = 1
    redraw()
  }
}

/** 以屏幕点 (clientX, clientY) 为锚缩放纸面（Ctrl+滚轮；捏合走 trackTouchDown 一路） */
function zoomAt(factor, clientX, clientY) {
  cancelWheelPan()
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  const z2 = Math.min(ZOOM_MAX, Math.max(1, zoom * factor))
  if (z2 === zoom) return
  // 保持锚点下的板面坐标贴住屏幕点
  const bx = (clientX - rect.left + panX) / zoom
  const by = (clientY - rect.top + panY) / zoom
  zoom = z2
  panX = Math.min(Math.max(0, bx * zoom - (clientX - rect.left)), panXMax())
  panY = Math.min(Math.max(0, by * zoom - (clientY - rect.top)), panYMax())
  liveStroke ? renderLiveFully() : redraw()
}

// ── 滚轮丝滑拉板（2026-09-27）───────────────────────────────────────
// 滚轮由 WeekendBoard 链式转发到这里：向下先把题干滚完、再往下拉板书。
// 板书侧做指数趋近平滑动画（网页滚轮手感），并允许向下拉出已写内容下方
// 约一屏的新空白纸面 —— 写进去后 contentMaxY 生长，可拉上限随之扩展。
// （wheelTargetY / wheelRafId / cancelWheelPan 声明在文件头 panY 旁）

function wheelMaxScroll() {
  return panYMax()
}

function animateWheelPan() {
  // 用 16ms 定时器而非 rAF：rAF 绑定合成器帧，窗口被遮挡 / 省电节流时完全
  // 停摆，滚轮会「拉不动」；定时器在任何可见性状态下都确定性运行，指数趋近
  // 的缓动手感不受影响。
  wheelRafId = setTimeout(() => {
    wheelRafId = 0
    if (wheelTargetY === null) return
    const diff = wheelTargetY - panY
    if (Math.abs(diff) < 1) {
      panY = wheelTargetY
      wheelTargetY = null
      liveStroke ? renderLiveFully() : redraw()
      return
    }
    panY += diff * 0.28
    // 书写中滚轮：redraw 会把进行中的一笔擦掉，必须连它一起重画
    liveStroke ? renderLiveFully() : redraw()
    animateWheelPan()
  }, 16)
}

function wheelPanBy(delta) {
  if (wheelTargetY === null) wheelTargetY = panY
  wheelTargetY = Math.min(Math.max(0, wheelTargetY + delta), wheelMaxScroll())
  if (!wheelRafId) animateWheelPan()
}

defineExpose({
  exportPng, redraw, syncSize, panBoard, resetView, wheelPanBy, zoomAt,
  boardScrolled: () => panY > 0,
  pinchActive: () => !!pinch,
  zoomLevel: () => zoom,
  viewState: () => ({ zoom, panX, panY }),
})
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
