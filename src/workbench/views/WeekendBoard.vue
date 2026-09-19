<template>
  <div
    ref="boardPageRef"
    class="board-page"
    :class="{ 'board-immersive': isImmersive }"
    @mousemove="onBoardMouseMove"
    @pointerdown.capture="onBoardPointerDown"
    @pointermove.capture="onBoardPointerMove"
    @pointerup.capture="onBoardPointerUp"
    @pointercancel.capture="onBoardPointerUp"
  >
    <!-- 顶栏：普通模式常驻；全屏讲题模式下变成悬浮在顶部的半透明控制条，
         鼠标移到顶部才显示，移开后自动隐藏，不再占掉白板内容空间。 -->
    <header
      class="board-topbar"
      :class="{
        'board-topbar--overlay': isImmersive,
        'board-topbar--hidden': isImmersive && !showTopbar,
        'board-topbar--fade-instant': suppressTopbarTransition,
      }"
      @mouseenter="showTopbar = true"
      @mouseleave="showTopbar = false"
    >
      <div class="tb-left">
        <button class="tb-back" type="button" title="返回选题" @click="goBack">
          <el-icon><Back /></el-icon>
        </button>
        <div class="tb-title">
          <strong>{{ handout?.grade || '初三' }}{{ handout?.subject ? ' · ' + handout.subject : '' }} · 周末讲题白板</strong>
          <span>第 {{ currentIndex + 1 }} / {{ questions.length }} 题 · {{ current?.day || '' }}</span>
        </div>
      </div>
      <div class="tb-right">
        <button class="tb-btn" type="button" :class="{ active: showAnswer }" @click="toggleAnswer">
          {{ showAnswer ? '隐藏答案' : '参考答案' }}
        </button>
        <button class="tb-btn" type="button" :class="{ active: showOriginal }" @click="toggleOriginal">
          原卷图
        </button>
        <button class="tb-btn tb-export" type="button" @click="exportBoard">
          <el-icon><Download /></el-icon>板书图
        </button>
        <button
          class="tb-btn tb-fullscreen"
          type="button"
          :class="{ active: isFsOn }"
          :title="fsTitle"
          @click="toggleFullscreen"
        >
          <el-icon><FullScreen /></el-icon>
          <span class="tb-btn__text">{{ isFsOn ? '退出全屏' : '全屏' }}</span>
        </button>
      </div>
    </header>

    <!-- 主区：题目（HTML 层）+ 手写层（Canvas 覆盖） -->
    <main class="board-main">
      <div
        v-if="current"
        class="question-wrap"
        ref="questionWrapRef"
        @pointerdown="onGestureStart"
        @pointermove="onGestureMove"
        @pointerup="onGestureEnd"
        @pointercancel="onGestureEnd"
        @wheel="onWheel"
      >
        <!-- 题目 HTML 层：纵向两区（题干区 / 配图区），两区都不被裁 -->
        <div class="question-layer" :class="{ 'has-answer': showAnswer }">
          <!-- 题干区：内容超出时自身滚动，滚动条常显；答案层贴在它的底部，不会盖住配图 -->
          <div ref="qBodyRef" class="q-body">
            <div class="q-head">
              <span class="q-badge">第 {{ currentIndex + 1 }} 题</span>
              <span class="q-meta">{{ current.day }} · {{ current.typeLabel || '未标题型' }} · {{ current.tierLabel || '难度未判定' }} · {{ current.studentCount }} 人错</span>
            </div>
            <MathRender v-if="current.parentStem" class="q-parent" :content="current.parentStem" auto-detect />
            <div v-if="(current.subParts || []).length > 1" class="q-subparts">
              <div v-for="sp in current.subParts" :key="sp.subNo" class="q-sub">
                <span class="q-subno">({{ sp.subNo }})</span>
                <MathRender class="q-sub-text" :content="sp.content" auto-detect tag="span" />
              </div>
            </div>
            <MathRender v-else class="q-stem" :content="current.stem" auto-detect />
            <!-- 选择题选项：题干已内联 A．B．C．D．时不再重复渲染 -->
            <div v-if="showOptions" class="q-options" :class="{ 'q-options--two': optionsCompact }">
              <div v-for="(opt, i) in current.options" :key="i" class="q-option">
                <span class="q-option__mark">{{ String.fromCharCode(65 + i) }}</span>
                <MathRender class="q-option__text" :content="opt" auto-detect tag="span" />
              </div>
            </div>
            <div v-if="(current.missingSubs || []).length" class="q-missing">
              ⚠ 本题错在第 {{ current.missingSubs.join('、') }} 问，但题库缺该小问题干 — 讲前请看原卷图
            </div>

            <!-- 答案层（sticky 贴题干区底部：题干长时钉在可视底部，题干短时紧跟题干） -->
            <transition name="ans-pop">
              <div v-if="showAnswer" class="answer-layer">
                <div class="ans-title">参考答案{{ current.answerSourceLabel ? ' · ' + current.answerSourceLabel : '' }}</div>
                <div class="ans-body"><MathRender :content="current.answer || '参考答案暂缺 — 讲前请人工补'" auto-detect :force-inline="answerIsShort" /></div>
                <div v-if="current.answerRisk" class="ans-risk">⚠ {{ current.answerRisk }}</div>
              </div>
            </transition>
          </div>

          <!-- 配图区：吃掉题干区之外的全部剩余高度，图按 contain 缩放，永远完整可见 -->
          <div v-if="displayFigureUrl" class="q-figure">
            <span v-if="!current.figure" class="q-figure__hint">题图（原题裁图）</span>
            <div class="q-figure__box">
              <img :src="displayFigureUrl" alt="题图" loading="lazy" />
            </div>
          </div>
        </div>

        <!-- 手写层（Canvas，透明覆盖整个题目区） -->
        <DrawingCanvas
          ref="canvasRef"
          v-model:tool="tool"
          v-model:color="color"
          v-model:size="penSize"
          :strokes="currentStrokes"
          :allow-touch="allowTouch"
          :export-title="exportTitle"
          :export-texts="exportTexts"
          :export-figure="displayFigureUrl"
          @update:strokes="onStrokesChange"
        />
      </div>

      <div v-else class="board-empty">
        <EmptyState :icon="Reading" title="没有题目" description="未获取到勾选的题目，返回重新选择。" />
      </div>

      <!-- 右侧工具栏：放在主区内（相对主区定位），避免顶到顶栏右侧的按钮 -->
      <aside v-if="current" class="board-toolbar">
        <div class="tool-group">
          <button
            v-for="c in penColors"
            :key="c.value"
            type="button"
            class="tool-color"
            :class="{ active: color === c.value }"
            :style="{ background: c.value }"
            :title="c.label"
            @click="setColor(c.value)"
          />
        </div>
        <div class="tool-group tool-size">
          <button
            v-for="s in penSizes"
            :key="s.value"
            type="button"
            class="tool-size-btn"
            :class="{ active: penSize === s.value && tool === 'pen' }"
            @click="setSize(s.value)"
          >
            <span class="size-dot" :style="{ width: s.dot, height: s.dot }" />
          </button>
        </div>
        <div class="tool-group">
          <button type="button" class="tool-btn" :class="{ active: tool === 'eraser' }" title="橡皮" @click="toggleEraser">
            <el-icon><Remove /></el-icon>
          </button>
          <button type="button" class="tool-btn" title="撤销（Z）" @click="undo">
            <el-icon><RefreshLeft /></el-icon>
          </button>
          <button type="button" class="tool-btn" title="清空本页" @click="clearAll">
            <el-icon><Delete /></el-icon>
          </button>
        </div>
        <div class="tool-group">
          <button
            type="button"
            class="tool-btn"
            :class="{ active: allowTouch }"
            :title="allowTouch ? '手指绘制已开启（触控笔优先）' : '手指绘制已关闭（防手掌误触）'"
            @click="toggleAllowTouch"
          >
            <el-icon><Pointer /></el-icon>
          </button>
        </div>
      </aside>

      <!-- 平板边缘翻题热区（触屏设备显示，避免手指够不到底栏） -->
      <button
        v-if="current && showEdgeNav"
        class="edge-nav edge-nav--prev"
        type="button"
        title="上一题（←）"
        :disabled="currentIndex === 0"
        @click="prevQuestion"
      >
        <el-icon><ArrowLeft /></el-icon>
      </button>
      <button
        v-if="current && showEdgeNav"
        class="edge-nav edge-nav--next"
        type="button"
        title="下一题（→）"
        :disabled="currentIndex === questions.length - 1"
        @click="nextQuestion"
      >
        <el-icon><ArrowRight /></el-icon>
      </button>

      <transition name="hint-fade">
        <div v-if="hint" class="board-hint">{{ hint }}</div>
      </transition>
    </main>


    <!-- 底栏：全屏讲题模式下隐藏，把屏幕完整留给题目与手写层；
         上一题/下一题仍可用键盘、快捷键或平板边缘热区操作。 -->
    <footer v-if="current" class="board-footer" :class="{ 'board-footer--hidden': isImmersive }">
      <button class="fb-btn" type="button" :disabled="currentIndex === 0" @click="prevQuestion">
        <el-icon><ArrowLeft /></el-icon>上一题
      </button>
      <div class="fb-progress">
        <span class="fb-dot" :class="{ current: i === currentIndex }" v-for="(q, i) in questions" :key="q.index" @click="gotoQuestion(i)" />
      </div>
      <button class="fb-btn" type="button" :disabled="currentIndex === questions.length - 1" @click="nextQuestion">
        下一题<el-icon><ArrowRight /></el-icon>
      </button>
      <span class="fb-hint">{{ navHint }}</span>
    </footer>

    <!-- 原卷图弹窗。
         注意 append-to-body 必须为 false：原生全屏时浏览器只渲染全屏元素（.board-page）
         及其子树，挂到 document.body 上的弹窗落在全屏元素之外，会被白板整块盖住——
         表现为「点原卷图没反应」。留在组件内即随全屏元素一起进顶层。 -->
    <el-dialog v-model="showOriginal" title="学生原卷（整页图）" width="min(94vw, 1400px)" :append-to-body="false">
      <div v-if="current?.students?.length" class="original-tip">点图放大看手写细节（再点还原）</div>
      <div class="original-grid">
        <figure v-for="(stu, i) in current?.students || []" :key="i" class="original-item">
          <img
            v-if="stu.docImage"
            :src="stu.docImage"
            :alt="stu.name + ' 原卷'"
            loading="lazy"
            :class="{ 'is-zoomed': zoomedSrc === stu.docImage }"
            @click="toggleZoom(stu.docImage)"
          />
          <div v-else class="no-img">无原卷图</div>
          <figcaption>{{ stu.name }}<span v-if="stu.wrongTimes > 1"> ×{{ stu.wrongTimes }}</span></figcaption>
        </figure>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowLeft, ArrowRight, Back, Delete, Download, FullScreen, Pointer, Reading, RefreshLeft, Remove,
} from '@element-plus/icons-vue'
import { apiRequest } from '../../services/apiService'
import { hasExplicitOptionMarkers } from '../../utils/questionCompleteness'
import DrawingCanvas from '../components/DrawingCanvas.vue'
import MathRender from '../components/MathRender.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const route = useRoute()
const router = useRouter()

const handout = ref(null)
const questions = ref([])
const currentIndex = ref(0)
const showAnswer = ref(false)
const showOriginal = ref(false)
const tool = ref('pen')
const color = ref('#E11D48')
const penSize = ref(3)
const allowTouch = ref(false)
const canvasRef = ref(null)
const questionWrapRef = ref(null)
// 题干滚动容器（.q-body）。手写 Canvas 盖在它上面且 touch-action:none，
// 会吃掉滚轮/手指滚动，所有滚动请求都要显式转发到这里。
const qBodyRef = ref(null)
const boardPageRef = ref(null)

const penColors = [
  { label: '红', value: '#E11D48' },
  { label: '蓝', value: '#2563EB' },
  { label: '绿', value: '#16A34A' },
  { label: '黑', value: '#1E293B' },
]
const penSizes = [
  { label: '细', value: 2, dot: '4px' },
  { label: '中', value: 3.5, dot: '7px' },
  { label: '大', value: 6, dot: '11px' },
]

const current = computed(() => questions.value[currentIndex.value] || null)

/**
 * 题干判定文本（公共题干 + 各小问正文）。
 * 多小问大题拆行落库后「如图」只留在 parentStem，只看 stem 会漏判。
 */
const figureJudgeText = computed(() => {
  const c = current.value
  if (!c) return ''
  const parts = [c.parentStem || '']
  if ((c.subParts || []).length > 1) {
    for (const sp of c.subParts) parts.push(sp.content || '')
  } else {
    parts.push(c.stem || '')
  }
  return parts.filter(Boolean).join(' ')
})

/**
 * 题干是否提到「图」。
 *
 * 注意：这**不是**完整性判定的 `hasFigureReference`（questionCompleteness.js），
 * 两者问的不是同一个问题，口径也不该相同：
 *   · `hasFigureReference` 问「题目引用了图、但题库没配图吗」，它决定题目算不算残缺，
 *     口径必须严格（如图 / 图1 / 图示 / 附图 / 见图），不能放宽；
 *   · 这里问「这张原题裁片对讲题有没有价值」，口径应当更宽：题干出现「图」字
 *     （如图 / 图像 / 作图 / 图中 / 下图…）就认为可能有图。漏判的代价是老师对着一道
 *     没有图的几何题讲不了，误判的代价只是多挂一张裁片 —— 两者不对称，所以宁可放宽。
 *
 * 实测（2026-09-18 白板题单）：
 *   初二 130 题：27 条只有原题裁片、无几何裁图，其中题干含「图」的 0 条；
 *   初三  49 题：14 条同上，其中含「图」的 3 条 —— 恰好是「平行线分线段的作图中」
 *   和两条「二次函数图像」题，用严格口径会把这 3 条需要的图误删。
 */
const stemMentionsFigure = computed(() => /图/.test(figureJudgeText.value))

/**
 * 讲题区配图。
 *
 * 1) `figure`（几何裁图）优先 —— 它只在题目真引图、且过了渲染闸之后才生成，直接可用。
 * 2) 历史题库没有裁图时，只有题干提到「图」才回退到原题裁片 `wbImage`。
 *    否则不回退：wbImage 是学生卷面上按 block_coordinates 裁的题目区域，
 *    对非图形题（如「计算：(√5)³-(5+√5)÷√5」）它只是题干复述 + 学生手写，
 *    对讲题零价值，还把书写痕迹带进讲题区。
 *    同理不回退 students[].docImage（整页学生作答卷）。
 */
const displayFigureUrl = computed(() => {
  const c = current.value
  if (!c) return ''
  if (c.figure) return c.figure
  if (!stemMentionsFigure.value) return ''
  return c.wbImage || ''
})

// 选择题选项：题干已内联 ≥2 个 A–D 标号说明选项写在题干里，避免重复渲染
const showOptions = computed(() => {
  const c = current.value
  if (!c || !Array.isArray(c.options) || c.options.length === 0) return false
  return !hasExplicitOptionMarkers(c.stem || '')
})

// 短答案（选择题字母、数值）保持行内排版：纯数学内容会被 renderContent 标成
// 独立公式，一个「A」会渲染成居中放大的斜体 A，既不像卷面也不像答案。
const answerIsShort = computed(() => String(current.value?.answer || '').trim().length <= 20)

// 选项排布：中考卷面短选项（≤4 条、单条 ≤14 字）走两列，长选项单列铺满
const optionsCompact = computed(() => {
  const opts = current.value?.options || []
  if (opts.length === 0 || opts.length > 4) return false
  return opts.every(o => String(o).length <= 14)
})

// 笔迹 localStorage key：按「参数+题目 index」隔离
const strokesKey = computed(() => {
  if (!handout.value || !current.value) return ''
  const h = handout.value
  const base = [h.grade, h.subject || '', h.period.start, h.period.end].join('_').replace(/[^\w\u4e00-\u9fa5]/g, '')
  return `wb_strokes_${base}_q${current.value.index}`
})
const currentStrokes = ref([])

// 导出用：题干文本
const exportTitle = computed(() => {
  if (!current.value) return ''
  return `${handout.value?.grade || ''} · ${current.value.day} · 第 ${currentIndex.value + 1} 题`
})
const exportTexts = computed(() => {
  if (!current.value) return []
  const out = []
  if (current.value.parentStem) out.push(current.value.parentStem)
  if ((current.value.subParts || []).length > 1) {
    for (const sp of current.value.subParts) out.push(`(${sp.subNo}) ${sp.content}`)
  } else if (current.value.stem) {
    out.push(current.value.stem)
  }
  return out
})

// ── 初始化：解析路由参数 → preview → 过滤 selected ──
onMounted(async () => {
  const q = route.query
  isTouchDevice.value = !!window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window
  const body = {
    grade: String(q.grade || '初三'),
    subject: String(q.subject || ''),
    days: Number(q.days) || 7,
    from: q.from || undefined,
    to: q.to || undefined,
    students: q.students ? String(q.students).split(',') : [],
    limit: Number(q.limit) || 0,
    maxPerDay: Number(q.maxPerDay) || 0,
    mergeThin: Number(q.mergeThin) || 0,
    difficulty: q.difficulty ? String(q.difficulty) : undefined,
    withAnswer: true,
  }
  try {
    const res = await apiRequest('/weekend-ppt/preview', { method: 'POST', body: JSON.stringify(body) })
    if (!res.success) throw new Error(res.error || '取题失败')
    handout.value = res.handout
    const selected = String(q.selected || '')
      .split(',')
      .map(Number)
      .filter(Boolean)
    const selSet = new Set(selected)
    questions.value = (res.handout.slides || []).filter(
      s => s.kind === 'question' && selSet.has(s.index)
    )
    if (questions.value.length === 0) {
      ElMessage.warning('没有获取到勾选的题目')
      return
    }
    currentIndex.value = 0
    loadStrokes()
  } catch (e) {
    ElMessage.error('加载题目失败：' + (e.message || '网络错误'))
  }

  // 全屏 / 键盘 / 触屏环境监听
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  window.addEventListener('keydown', onKeydown)

  // 从选题页「白板模式」进入时带 fs=1：直接进沉浸讲题模式，
  // 并在用户第一次触摸/按键时补一次原生全屏（全屏需要用户手势，无法在加载时自动调用）。
  if (String(q.fs || '') === '1') {
    isImmersive.value = true
    showTopbar.value = false
    armAutoFullscreen()
    showHint(
      isTouchDevice.value
        ? '全屏讲题模式：左右滑动切题 · 顶部下拉可唤出控制条，继续下拉退出全屏'
        : '全屏讲题模式：← → / 空格切题 · A 答案 · F 全屏 · Esc 退出',
      5600
    )
  }
})

// ── 全屏 / 沉浸模式 ──
// 平板讲题时把白板撑满全屏并隐藏工作台侧栏与顶栏（沉浸模式，纯 CSS，任何浏览器可用）；
// 同时尝试调用原生 Fullscreen API 隐藏浏览器工具栏。
// iOS Safari 不支持对任意元素调用全屏（只能对 video），此时仅保留沉浸模式，功能不受影响。
const isImmersive = ref(false)
const nativeFs = ref(false)
// 全屏讲题时顶部控制条默认收起（触屏同样收起），从屏幕顶部下拉可临时唤出；
// 继续下拉越过阈值则退出全屏。
const showTopbar = ref(false)
const suppressTopbarTransition = ref(false)
const isTouchDevice = ref(false)
const hint = ref('')
let hintTimer = null
let autoFsHandler = null
const isFsOn = computed(() => isImmersive.value || nativeFs.value)
const fsTitle = computed(() => (isFsOn.value ? '退出全屏（Esc）' : '全屏讲题（F）'))
const showEdgeNav = computed(() => isTouchDevice.value && questions.value.length > 1)
const navHint = computed(() => {
  if (allowTouch.value) return '手指绘制已开启 · 可用两侧箭头或底栏翻题'
  return isTouchDevice.value ? '左右滑动屏幕切题' : '← → 切题'
})

function currentFsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}
function showHint(text, ms = 4200) {
  hint.value = text
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { hint.value = '' }, ms)
}
function onFullscreenChange() {
  const wasNativeFs = nativeFs.value
  nativeFs.value = !!currentFsElement()
  // 用户按 Esc 退出浏览器全屏后，同步退出沉浸讲题模式，避免还要再按一次 Esc。
  if (wasNativeFs && !nativeFs.value) {
    isImmersive.value = false
    showTopbar.value = false
  }
}
function onBoardMouseMove(e) {
  if (isTouchDevice.value) return
  if (e.clientY <= 18) showTopbar.value = true
  else if (e.clientY > 90) showTopbar.value = false
}
// ── 顶部下拉手势：从屏幕顶部往下拉唤出控制条，继续下拉退出全屏 ──
const topPull = ref(null)
let topPullTimer = null
const TOP_PULL_EXIT = 110 // 下拉超过该距离视为退出全屏
const TOP_PULL_SHOW = 36 // 下拉超过该距离先唤出控制条
function onBoardPointerDown(e) {
  if (e.pointerType !== 'touch' || !isImmersive.value) return
  if (topPull.value) return
  if (e.clientY > 26) return
  topPull.value = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() }
}
function onBoardPointerMove(e) {
  const g = topPull.value
  if (!g || e.pointerId !== g.id) return
  const dy = e.clientY - g.y
  if (dy > TOP_PULL_SHOW) showTopbar.value = true
}
function onBoardPointerUp(e) {
  const g = topPull.value
  if (!g || e.pointerId !== g.id) return
  topPull.value = null
  const dy = e.clientY - g.y
  const dt = Date.now() - g.t
  if (dy >= TOP_PULL_EXIT && dt <= 900) {
    exitFullscreenMode()
    return
  }
  if (dy <= TOP_PULL_SHOW) {
    showTopbar.value = isTouchDevice.value ? false : true
    return
  }
  // 轻下拉后短暂停留，避免抬手瞬间又隐藏
  clearTimeout(topPullTimer)
  topPullTimer = setTimeout(() => {
    if (!isImmersive.value) return
    showTopbar.value = false
  }, 2600)
}
async function enterNativeFs() {
  const el = boardPageRef.value || document.documentElement
  const fn = el.requestFullscreen || el.webkitRequestFullscreen
  if (!fn) return false
  try {
    const ret = fn.call(el, { navigationUI: 'hide' })
    if (ret && typeof ret.then === 'function') await ret
    return true
  } catch {
    return false
  }
}
async function exitNativeFs() {
  if (!currentFsElement()) return
  const fn = document.exitFullscreen || document.webkitExitFullscreen
  if (!fn) return
  try {
    const ret = fn.call(document)
    if (ret && typeof ret.then === 'function') await ret
  } catch { /* 忽略：可能已被浏览器退出 */ }
}
async function enterFullscreenMode() {
  isImmersive.value = true
  showTopbar.value = false
  // 进入时先不播收起动画，避免顶栏从常驻位置跳到悬浮位置造成画面跳动
  suppressTopbarTransition.value = true
  const ok = await enterNativeFs()
  const el = boardPageRef.value || document.documentElement
  if (!ok && !(el.requestFullscreen || el.webkitRequestFullscreen)) {
    showHint('已进入讲题模式。iOS 可点「分享 → 添加到主屏幕」，从主屏打开即无浏览器边框。', 7000)
  }
  await nextTick()
  suppressTopbarTransition.value = false
}
async function exitFullscreenMode() {
  await exitNativeFs()
  isImmersive.value = false
  showTopbar.value = false
  suppressTopbarTransition.value = false
}
function toggleFullscreen() {
  if (isFsOn.value) exitFullscreenMode()
  else enterFullscreenMode()
}
// fs=1 进入时：第一次触摸/按键补一次原生全屏（借用户手势），只尝试一次
function armAutoFullscreen() {
  if (autoFsHandler) return
  autoFsHandler = () => {
    window.removeEventListener('pointerup', autoFsHandler, true)
    window.removeEventListener('keyup', autoFsHandler, true)
    autoFsHandler = null
    if (isImmersive.value && !currentFsElement()) enterNativeFs()
  }
  window.addEventListener('pointerup', autoFsHandler, true)
  window.addEventListener('keyup', autoFsHandler, true)
}

// ── 切题：保存当前笔迹 → 加载下一题笔迹 ──
function saveStrokes() {
  if (!strokesKey.value) return
  try {
    localStorage.setItem(strokesKey.value, JSON.stringify(currentStrokes.value))
  } catch { /* 存储满或隐私模式忽略 */ }
}
function loadStrokes() {
  currentStrokes.value = []
  if (!strokesKey.value) return
  try {
    const raw = localStorage.getItem(strokesKey.value)
    if (raw) currentStrokes.value = JSON.parse(raw)
  } catch {
    currentStrokes.value = []
  }
}

function onStrokesChange(val) {
  currentStrokes.value = val
  // 防抖保存（书写过程中也逐步落盘，切题/关页不丢）
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveStrokes, 300)
}
let saveTimer = null

// 切题入场动画（Web Animations API：同一方向连续切题也能重播）
let slideAnim = null
function playSlide(dir) {
  const el = questionWrapRef.value
  if (!el || typeof el.animate !== 'function') return
  try { slideAnim?.cancel() } catch { /* 忽略 */ }
  const from = dir >= 0 ? 46 : -46
  slideAnim = el.animate(
    [
      { transform: `translateX(${from}px)`, opacity: 0.3 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration: 200, easing: 'cubic-bezier(.22,.61,.36,1)' }
  )
}

function gotoQuestion(i, dir) {
  if (i < 0 || i >= questions.value.length || i === currentIndex.value) return
  saveStrokes()
  const d = dir ?? (i > currentIndex.value ? 1 : -1)
  currentIndex.value = i
  showAnswer.value = false
  showOriginal.value = false
  loadStrokes()
  if (qBodyRef.value) qBodyRef.value.scrollTop = 0
  if (hint.value) hint.value = ''
  playSlide(d)
}
const prevQuestion = () => gotoQuestion(currentIndex.value - 1)
const nextQuestion = () => gotoQuestion(currentIndex.value + 1)

// ── 平板手势：左右滑动切题 / 上下滑动滚动题干 ──
// Canvas 手写层覆盖整个题目区且 touch-action:none，会吃掉手指的原生滚动，
// 因此这里统一转发：横向 → 切题，纵向 → 手动滚动题干。
// 手指绘制开启时（allowTouch）手指优先写字，不做滑动切题，避免与笔迹冲突。
const SWIPE_TRIGGER = 56 // 触发切题的水平位移阈值（px）
const SWIPE_MAX_MS = 900 // 手势时长上限，超过视为慢拖不切题
let gesture = null

function onGestureStart(e) {
  if (e.pointerType !== 'touch' || allowTouch.value) return
  gesture = {
    x: e.clientX,
    y: e.clientY,
    t: Date.now(),
    axis: '',
    scrollTop: qBodyRef.value?.scrollTop || 0,
  }
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
}
function onGestureMove(e) {
  if (!gesture || e.pointerType !== 'touch') return
  const dx = e.clientX - gesture.x
  const dy = e.clientY - gesture.y
  if (!gesture.axis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
    gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
  }
  if (gesture.axis === 'y') {
    const layer = qBodyRef.value
    if (layer) layer.scrollTop = gesture.scrollTop - dy
  }
}
function onGestureEnd(e) {
  if (!gesture) return
  const g = gesture
  gesture = null
  try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* 忽略 */ }
  if (g.axis !== 'x') return
  if (Date.now() - g.t > SWIPE_MAX_MS) return
  const dx = e.clientX - g.x
  if (dx <= -SWIPE_TRIGGER) nextQuestion()
  else if (dx >= SWIPE_TRIGGER) prevQuestion()
}

// ── 鼠标滚轮：转发给光标下最近的可滚动区 ──
// 手写 Canvas 铺满整个题目区（z-index 3、touch-action:none），滚轮事件落在 Canvas 上，
// 而题干滚动区是它的兄弟节点，事件不会冒泡进去 —— 症状就是「明明有内容没显示，滚轮却没反应」。
// 这里在题目区统一接住滚轮，再交给光标下最近的可滚动元素（答案层自己也可能要滚）。
function findScroller(node) {
  let el = node instanceof Element ? node : null
  while (el && el !== questionWrapRef.value) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight - el.clientHeight > 2) return el
    el = el.parentElement
  }
  return null
}
function onWheel(e) {
  // deltaMode 1 = 按行滚动（部分鼠标驱动），换算成像素，否则一格几乎不动
  const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
  if (!step) return
  const el = findScroller(e.target) || qBodyRef.value
  if (!el || el.scrollHeight - el.clientHeight <= 2) return
  const before = el.scrollTop
  el.scrollTop = before + step
  // 已经滚到头时不再拦截，避免把滚动"吃掉"
  if (el.scrollTop !== before) e.preventDefault()
}

// ── 键盘快捷键（讲题时不必回到底栏） ──
function onKeydown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (showOriginal.value || !questions.value.length) return
  switch (e.key) {
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault(); prevQuestion(); break
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
    case 'Spacebar':
      e.preventDefault(); nextQuestion(); break
    case 'Home':
      e.preventDefault(); gotoQuestion(0, -1); break
    case 'End':
      e.preventDefault(); gotoQuestion(questions.value.length - 1, 1); break
    case 'a': case 'A': toggleAnswer(); break
    case 'o': case 'O': toggleOriginal(); break
    case 'f': case 'F': toggleFullscreen(); break
    case 'z': case 'Z': undo(); break
    case 'Escape':
      if (isImmersive.value) exitFullscreenMode()
      break
    default: break
  }
}

// ── 工具 ──
function setColor(c) { color.value = c; tool.value = 'pen' }
function setSize(s) { penSize.value = s; tool.value = 'pen' }
function toggleEraser() { tool.value = tool.value === 'eraser' ? 'pen' : 'eraser' }
function toggleAllowTouch() {
  allowTouch.value = !allowTouch.value
  showHint(allowTouch.value ? '手指绘制已开启：滑动切题暂停，可用两侧箭头翻题' : '手指绘制已关闭：左右滑动可切题')
}
function undo() {
  const arr = [...currentStrokes.value]
  if (arr.length === 0) return
  arr.pop()
  currentStrokes.value = arr
  saveStrokes()
}
function clearAll() {
  currentStrokes.value = []
  saveStrokes()
}
function toggleAnswer() { showAnswer.value = !showAnswer.value }
function toggleOriginal() { showOriginal.value = !showOriginal.value }
// 原卷图放大态：投屏时点图铺满整屏，再点还原
const zoomedSrc = ref('')
function toggleZoom(src) {
  if (!src) return
  zoomedSrc.value = zoomedSrc.value === src ? '' : src
}
// 弹窗关闭（Esc / 点遮罩 / 点 ×）时退出放大态，避免下次打开仍是放大图
watch(showOriginal, (v) => { if (!v) zoomedSrc.value = '' })

function exportBoard() {
  const c = current.value
  if (!c) return
  const name = `${handout.value?.grade || ''}_${c.day}_题${c.questionNumber ?? ''}_板书.png`
  canvasRef.value?.exportPng(name)
}

function goBack() {
  // 返回时保存当前笔迹并退出全屏，避免整页全屏状态带到选题页
  saveStrokes()
  if (isFsOn.value) exitFullscreenMode()
  router.push('/weekend-ppt')
}

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(hintTimer)
  clearTimeout(topPullTimer)
  if (autoFsHandler) {
    window.removeEventListener('pointerup', autoFsHandler, true)
    window.removeEventListener('keyup', autoFsHandler, true)
    autoFsHandler = null
  }
  try { slideAnim?.cancel() } catch { /* 忽略 */ }
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.board-page {
  position: relative;
  display: flex;
  flex-direction: column;
  /* 父容器是「工作台内容区」（100vh 减顶栏 52px）。这里必须用 100% 跟随父容器，
     用 100vh 会超出 52px 并被父级 overflow:hidden 裁掉——底栏「上一题/下一题」
     正是这样被裁到视口外的。 */
  height: 100%;
  min-height: 480px;
  background: #f8fafc;

  /* ── 投影字号体系 ──
     白板主要用于投屏讲课，字号按「教室后排能看清」定，对齐 PPT 正文量级
     （PPT 正文 18–24pt ≈ 24–32px）。内容字号 = 基准 px × --s，
     --s 由两档相乘，互不干扰：
       --s-mode   ：全屏讲题模式比窗口内再大一档
       --s-screen ：屏幕越大再大一档（接投影仪 1920 时正文≈27px）
     只作用于题目/答案/配图等内容，不动顶栏底栏等操作控件。 */
  --s-mode: 1;
  --s-screen: 1;
  --s: calc(var(--s-mode) * var(--s-screen));
  /* 配图区最多占题目面板的高度比例。配图区实际拿「面板高度 − 题干区高度」的剩余空间，
     用这个上限兜底：超长题干也至少留得住约 1/4 面板的文字。题干区自己滚动，
     所以配图永远不会被推到折线以下（2026-09-18 修复「图像看不全」）。 */
  --fig-max: 72%;
}
/* 沉浸模式：撑满视口并盖住工作台侧栏与顶栏（平板讲题场景） */
.board-page.board-immersive {
  position: fixed;
  inset: 0;
  z-index: 1500;
  height: 100vh;
  height: 100dvh;
  --s-mode: 1.34;
}
/* 大屏 / 投影：再放大一档，保证后排可读 */
@media (min-width: 1440px) {
  .board-page { --s-screen: 1.12; }
}
@media (min-width: 1800px) {
  .board-page { --s-screen: 1.24; }
}
/* 原生全屏时（Chrome/Edge/安卓）元素自身即视口，兜底给足尺寸 */
.board-page:fullscreen {
  width: 100%;
  height: 100%;
}

/* 顶栏 */
.board-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid var(--wb-border, #e2e8f0);
}
/* 全屏讲题：顶栏悬浮在画面顶部，默认不占高度；移动/触屏仍常驻展示 */
.board-topbar--overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 12;
  border-bottom: 1px solid rgba(226, 232, 240, 0.65);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.10);
  backdrop-filter: blur(14px);
}
.board-topbar--overlay.board-topbar--hidden {
  visibility: hidden;
  opacity: 0;
  transform: translateY(-100%);
  pointer-events: none;
  transition: transform 0.18s ease, opacity 0.18s ease, visibility 0.18s;
}
.board-topbar--overlay.board-topbar--fade-instant {
  transition: none;
}
.board-topbar--overlay:not(.board-topbar--hidden) {
  opacity: 1;
  transform: translateY(0);
  transition: transform 0.16s ease, opacity 0.16s ease;
}
/* 触屏全屏同样隐藏控制条；顶部下拉唤出，继续下拉退出全屏 */
@media (pointer: coarse) {
  .board-topbar--overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 12;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 4px 18px rgba(15, 23, 42, 0.10);
  }
  .board-topbar--overlay.board-topbar--hidden {
    visibility: hidden;
    opacity: 0;
    transform: translateY(-100%);
    pointer-events: none;
  }
}
.tb-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.tb-back {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  color: var(--wb-text-secondary, #64748b);
}
.tb-back:hover { color: var(--wb-primary, #6366f1); border-color: var(--wb-primary, #6366f1); }
.tb-title { min-width: 0; }
.tb-title strong { display: block; font-size: 15px; color: var(--wb-text, #1e293b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb-title span { font-size: 12.5px; color: var(--wb-text-secondary, #64748b); }
/* 全屏讲题时顶栏信息也放大一档（远距离看得清「第几题」） */
.board-immersive .tb-title strong { font-size: 17px; }
.board-immersive .tb-title span { font-size: 14px; }
.board-immersive .tb-btn { font-size: 14px; }
.tb-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  color: var(--wb-text-secondary, #64748b);
  cursor: pointer;
  white-space: nowrap;
}
.tb-btn:hover { color: var(--wb-primary, #6366f1); border-color: var(--wb-primary, #6366f1); }
.tb-btn.active { background: var(--wb-primary-mist, #eef2ff); color: var(--wb-primary, #6366f1); border-color: var(--wb-primary, #6366f1); }
.tb-export { color: #16a34a; border-color: #bbe7c9; }
.tb-export:hover { color: #16a34a; border-color: #16a34a; }
.tb-fullscreen { padding: 0 12px; }

/* 主区 */
.board-main {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin: 12px 16px;
}
.question-wrap {
  position: relative;
  height: 100%;
  background: #fff;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
}
.question-layer {
  position: absolute;
  inset: 0;
  padding: 22px 28px;
  z-index: 1;
  /* 纵向两区：题干区（自己滚）+ 配图区（吃剩余高度）。外层不再滚动——
     原来是「整层滚动」、配图排在末尾，屏幕一矮就被推到折线以下，看着就是被裁掉了。 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 题干区：内容超出时自身滚动。
   滚动条必须常显：Windows 默认「自动隐藏滚动条」，老师看不出还有内容没显示。 */
.q-body {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
}
.q-body::-webkit-scrollbar { width: 10px; }
.q-body::-webkit-scrollbar-track { background: #eef2f7; border-radius: 999px; }
.q-body::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border: 2px solid #eef2f7;
  border-radius: 999px;
}
.q-body::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
/* 显示答案时给题干区让位（答案层住在题干区里，见 .answer-layer） */
.question-layer.has-answer { --fig-max: 52%; }
.q-head { display: flex; align-items: center; gap: 10px; margin-bottom: calc(14px * var(--s)); flex-wrap: wrap; }
.q-badge {
  padding: calc(4px * var(--s)) calc(12px * var(--s));
  border-radius: 8px;
  background: var(--wb-primary, #6366f1);
  color: #fff;
  font-size: calc(14px * var(--s));
  font-weight: 600;
}
.q-meta { font-size: calc(13px * var(--s)); color: var(--wb-text-secondary, #64748b); }
.q-parent { font-size: calc(18px * var(--s)); font-weight: 650; line-height: 1.8; color: var(--wb-text, #1e293b); }
.q-subparts { margin-top: calc(10px * var(--s)); }
.q-sub { font-size: calc(16.5px * var(--s)); line-height: 1.85; color: var(--wb-text, #1e293b); margin-top: calc(6px * var(--s)); }
.q-subno { color: var(--wb-primary, #6366f1); font-weight: 600; margin-right: 4px; }
.q-stem { font-size: calc(16.5px * var(--s)); line-height: 1.85; color: var(--wb-text, #1e293b); margin-top: calc(10px * var(--s)); }
/* 选择题选项（中考样式）：A. 内容；短选项两列，长选项单列铺满 */
.q-options {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: calc(6px * var(--s)) calc(28px * var(--s));
  margin-top: calc(12px * var(--s));
}
.q-options--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.q-option {
  display: flex;
  align-items: baseline;
  gap: calc(6px * var(--s));
  font-size: calc(16.5px * var(--s));
  line-height: 1.75;
  color: var(--wb-text, #1e293b);
}
.q-option__mark {
  flex: 0 0 auto;
  font-weight: 650;
  color: var(--wb-primary, #6366f1);
}
.q-missing {
  margin-top: calc(12px * var(--s));
  padding: 8px 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  color: #b45309;
  font-size: calc(13.5px * var(--s));
}
.q-figure {
  /* 不拉伸（不放大低清裁片）、也不收缩（收缩让给题干区）：配图优先保住完整 */
  flex: 0 0 auto;
  min-height: 0;
  max-height: var(--fig-max);
  margin-top: calc(16px * var(--s));
  display: flex;
  flex-direction: column;
}
.q-figure__hint {
  display: block;
  flex: 0 0 auto;
  margin-bottom: 6px;
  color: var(--wb-text-secondary, #64748b);
  font-size: calc(12.5px * var(--s));
}
.q-figure__box { display: flex; flex: 1 1 auto; min-height: 0; align-items: center; }
.q-figure img {
  display: block;
  /* 配图跟着字号一起放大：投屏时图形太小同样看不清 */
  max-width: min(calc(680px * var(--s)), 100%);
  /* 高度跟着配图区走：宁可整图缩小，也不裁掉半张 */
  max-height: 100%;
  object-fit: contain;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
}

/* 答案层：住在题干区里、sticky 贴底——题干长时钉在可视底部，题干短时紧跟题干。
   刻意不再按整个题目面板定位：配图区现在占住面板下方，答案若仍悬浮在面板底部，
   一显示答案就把配图整块盖住。 */
.answer-layer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin-top: calc(14px * var(--s));
  padding: calc(14px * var(--s)) calc(18px * var(--s));
  background: #eef2ff;
  border-left: 4px solid var(--wb-primary, #6366f1);
  border-radius: 0 10px 10px 0;
  max-height: 82%;
  overflow-y: auto;
  box-shadow: 0 -4px 18px rgba(30, 41, 59, 0.08);
}
.ans-title { font-size: calc(12.5px * var(--s)); font-weight: 650; color: var(--wb-primary, #6366f1); letter-spacing: 0.3px; margin-bottom: 6px; }
.ans-body { font-size: calc(16px * var(--s)); font-weight: 550; line-height: 1.7; color: var(--wb-text, #1e293b); }
.ans-risk { font-size: calc(12.5px * var(--s)); color: #b45309; margin-top: 6px; }
.ans-pop-enter-active, .ans-pop-leave-active { transition: opacity 0.2s, transform 0.2s; }
.ans-pop-enter-from, .ans-pop-leave-to { opacity: 0; transform: translateY(10px); }

/* 手写层（z-index 3，覆盖在题目与答案之上，但答案层 z=2，书写优先） */
.drawing-canvas-host { position: absolute; inset: 0; }

/* 平板边缘翻题热区 */
.edge-nav {
  position: absolute;
  top: 50%;
  z-index: 9;
  display: grid;
  width: 46px;
  height: 46px;
  transform: translateY(-50%);
  place-items: center;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.1);
  color: var(--wb-text-secondary, #64748b);
  font-size: 20px;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s, background 0.15s;
}
.edge-nav:active { opacity: 1; background: #fff; }
.edge-nav:disabled { opacity: 0.16; cursor: not-allowed; }
.edge-nav--prev { left: 8px; }
.edge-nav--next { right: 78px; }

/* 操作提示条 */
.board-hint {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 11;
  transform: translateX(-50%);
  padding: 9px 18px;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.88);
  color: #fff;
  font-size: 13px;
  white-space: nowrap;
  pointer-events: none;
}
.hint-fade-enter-active, .hint-fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.hint-fade-enter-from, .hint-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(6px); }

/* 右侧工具栏（在主区内，随主区上下边距自动避开顶栏/底栏）。
   高度随内容自适应并垂直居中：主区高度随窗口变化，若强行 top/bottom 撑满，
   矮窗口下内容会溢出到面板外。max-height + overflow 只作极端窄高比的兜底。 */
.board-toolbar {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  max-height: calc(100% - 8px);
  box-sizing: border-box;
  overflow-y: auto;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  background: #fff;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 12px;
}
.tool-group { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.tool-group + .tool-group { border-top: 1px solid var(--wb-border-light, #f1f5f9); padding-top: 10px; }
.tool-color {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  outline: none;
}
.tool-color.active { border-color: #1e293b; box-shadow: 0 0 0 3px rgba(30, 41, 59, 0.12); }
.tool-size-btn {
  width: 30px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.tool-size-btn.active { border-color: var(--wb-primary, #6366f1); background: var(--wb-primary-mist, #eef2ff); }
.size-dot { border-radius: 50%; background: #475569; }
.tool-btn {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  color: var(--wb-text-secondary, #64748b);
  font-size: 16px;
}
.tool-btn:hover { background: var(--wb-bg-hover, #f1f5f9); }
.tool-btn.active { background: var(--wb-primary-mist, #eef2ff); color: var(--wb-primary, #6366f1); }

/* 底栏 */
.board-footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 10px 16px;
  background: #fff;
  border-top: 1px solid var(--wb-border, #e2e8f0);
  flex: 0 0 auto;
}
/* 全屏讲题：底栏收起，屏幕完整留给白板内容 */
.board-footer--hidden {
  display: none;
}
.fb-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
  font-size: 13.5px;
  color: var(--wb-text-secondary, #64748b);
  cursor: pointer;
}
.fb-btn:hover:not(:disabled) { color: var(--wb-primary, #6366f1); border-color: var(--wb-primary, #6366f1); }
.fb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.fb-progress { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; max-width: 480px; }
.fb-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--wb-border, #e2e8f0);
  cursor: pointer;
  transition: 0.15s;
}
.fb-dot:hover { background: #cbd5e1; }
.fb-dot.current { background: var(--wb-primary, #6366f1); transform: scale(1.2); }
.fb-hint { position: absolute; right: 20px; font-size: 12px; color: var(--wb-text-tertiary, #94a3b8); }

/* 原卷弹窗：投屏场景要能看清手写，图给足尺寸，点图可放大到整屏 */
.original-tip { margin-bottom: 10px; font-size: 12.5px; color: var(--wb-text-tertiary, #94a3b8); }
.original-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 16px; }
.original-item { margin: 0; }
.original-item img {
  display: block;
  width: 100%;
  max-height: 66vh;
  object-fit: contain;
  background: #fff;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 8px;
  cursor: zoom-in;
}
/* 放大态：整屏铺满（图在弹窗子树内，全屏时同样可见） */
.original-item img.is-zoomed {
  position: fixed;
  inset: 0;
  z-index: 3000;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  max-height: none;
  padding: 12px;
  border: 0;
  border-radius: 0;
  background: #0f172a;
  object-fit: contain;
  cursor: zoom-out;
}
.original-item figcaption { margin-top: 6px; font-size: 14px; color: var(--wb-text-secondary, #64748b); }
.no-img {
  display: grid;
  height: 160px;
  place-items: center;
  border: 1px dashed var(--wb-border, #e2e8f0);
  border-radius: 8px;
  color: var(--wb-text-tertiary, #94a3b8);
  font-size: 13px;
}

.board-empty { padding: 60px 0; }

/* 触屏设备（平板）：按钮加大，便于手持操作 */
@media (pointer: coarse) {
  .tb-btn { height: 42px; padding: 0 16px; font-size: 14px; }
  .tb-back { width: 42px; height: 42px; }
  .fb-btn { height: 48px; padding: 0 24px; font-size: 15px; }
  .fb-dot { width: 13px; height: 13px; }
  .fb-hint { display: none; }
  .tool-color { width: 34px; height: 34px; }
  .tool-size-btn { width: 40px; height: 34px; }
  .tool-btn { width: 40px; height: 40px; font-size: 19px; }
  .board-toolbar { gap: 16px; padding: 14px 10px; }
}
/* 窄屏（平板竖屏）：顶栏按钮只留图标 */
@media (max-width: 900px) {
  .tb-btn__text { display: none; }
  .tb-btn { padding: 0 11px; }
}
/* 矮屏（笔记本 / 平板横向分屏）：压缩工具栏，保证全部按钮都在面板内可见 */
@media (max-height: 700px) {
  .board-toolbar { gap: 6px; padding: 8px 6px; }
  .tool-group { gap: 6px; }
  .tool-group + .tool-group { padding-top: 6px; }
  .tool-color { width: 22px; height: 22px; }
  .tool-size-btn { width: 26px; height: 22px; }
  .tool-btn { width: 26px; height: 26px; font-size: 15px; }
}
</style>
