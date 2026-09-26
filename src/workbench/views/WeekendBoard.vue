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
        <!-- 讲题进度：解决「下次别再重复讲」的两个开关。
             判定本身零点击（见 useTeachingMarks），这里只负责让老师能按状态收窄题单。 -->
        <button
          class="tb-btn tb-progress"
          type="button"
          :class="{ active: unTaughtOnly }"
          :title="unTaughtOnly ? '显示全部题目' : `只看未讲的 ${unTaughtCount} 题`"
          @click="toggleUnTaughtOnly"
        >
          只看未讲<span class="tb-count">{{ unTaughtCount }}</span>
        </button>
        <button
          class="tb-btn"
          type="button"
          title="跳到第一道没讲过的题（也就是上次讲到哪儿）"
          @click="resumeLecture"
        >
          续讲
        </button>
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
              <span class="q-meta">{{ current.day }} · {{ current.typeLabel || '未标题型' }}</span>
              <!-- 难度：星级展示，与错题再测卷/周末班讲义同一口径 difficultyStars（1-2★ / 3★★ / 4-5★★★）。
                   不写「基础/中等/较难」这类中文标签 —— 老师在白板上讲题，星级能一眼读出量级，
                   中文标签既占位置又得先读字才能判断。 -->
              <span v-if="currentStars" class="q-diff" :title="`难度 ${current.difficulty}`">{{ currentStars }}</span>
              <span v-else class="q-meta">难度未判定</span>
              <span class="q-meta">{{ current.studentCount }} 人错</span>
              <!-- 讲题状态：未讲时不显示（不给画面添噪音）。
                   判定是零点击的：离开这一题时按「停留时长 / 有没有写板书 / 有没有看答案」自动得出。 -->
              <span
                v-if="currentMarkBadge"
                class="q-mark"
                :class="`q-mark--${currentMarkBadge.status}`"
                :title="currentMarkBadge.reworkDue
                  ? '上次讲完之后学生又做错了 —— 建议回炉重讲'
                  : (currentMarkBadge.source === 'auto' ? '按翻页停留自动判定，可长按底栏小圆点改' : '手动标记')"
              >
                {{ currentMarkBadge.label }}
                <span v-if="currentMarkBadge.reworkDue" class="q-mark__due">建议回炉</span>
              </span>
              <span v-if="currentTaughtLabel" class="q-meta q-taught">{{ currentTaughtLabel }}</span>
            </div>
            <MathRender v-if="current.parentStem" class="q-parent" :content="current.parentStem" auto-detect />
            <div v-if="(current.subParts || []).length > 1" class="q-subparts">
              <div v-for="sp in current.subParts" :key="sp.subNo" class="q-sub">
                <span class="q-subno">({{ sp.subNo }})</span>
                <MathRender class="q-sub-text" :content="sp.content" auto-detect tag="span" :force-inline="true" />
              </div>
            </div>
            <MathRender v-else class="q-stem" :content="current.stem" auto-detect />
            <!-- 选择题选项：题干已内联 A．B．C．D．时不再重复渲染 -->
            <div v-if="showOptions" class="q-options" :class="{ 'q-options--two': optionsCompact }">
              <div v-for="(opt, i) in current.options" :key="i" class="q-option">
                <span class="q-option__mark">{{ String.fromCharCode(65 + i) }}</span>
                <MathRender class="q-option__text" :content="opt" auto-detect tag="span" :force-inline="true" />
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

      <div v-else-if="loading" class="board-loading">
        <span class="board-loading__spin" aria-hidden="true" />
        <span>正在聚合勾选的错题…</span>
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
        :disabled="currentIndex === viewQuestions.length - 1"
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
      <!-- 这排小圆点就是讲题进度条：颜色是自动派生出来的，不需要老师维护 -->
      <div class="fb-progress">
        <span
          v-for="(q, i) in viewQuestions"
          :key="q.anchorKey || q.index"
          class="fb-dot"
          :class="[`fb-dot--${marks.statusOf(q)}`, { current: i === currentIndex }]"
          :title="dotTitle(q, i)"
          @click="onDotClick(i)"
          @pointerdown="onDotPointerDown(i, $event)"
          @pointerup="onDotPointerUp"
          @pointerleave="onDotPointerUp"
          @pointercancel="onDotPointerUp"
          @contextmenu="onDotContextMenu(i, $event)"
        />
      </div>
      <button class="fb-btn" type="button" :disabled="currentIndex === viewQuestions.length - 1" @click="nextQuestion">
        下一题<el-icon><ArrowRight /></el-icon>
      </button>
      <span class="fb-hint">{{ navHint }}</span>

      <!-- 长按小圆点的改判菜单（唯一需要老师动手的动作，且完全可选）。
           自己实现而不用 el-popover：原生全屏时浏览器只渲染全屏元素及其子树，
           teleport 到 body 的浮层会被整块盖住 —— el-dialog 已经踩过这个坑。 -->
      <div v-if="markMenu" class="fb-menu" :style="{ left: markMenu.x + 'px' }">
        <div class="fb-menu__title">第 {{ markMenu.index + 1 }} 题</div>
        <button
          v-for="opt in MARK_OPTIONS"
          :key="opt.value"
          type="button"
          class="fb-menu__item"
          :class="{ active: markMenu.q && marks.statusOf(markMenu.q) === opt.value }"
          :title="opt.hint"
          @click="chooseMark(opt.value)"
        >
          <span class="fb-menu__dot" :class="`fb-dot--${opt.value}`" />
          <span class="fb-menu__label">{{ opt.label }}</span>
        </button>
      </div>
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
          <!-- 空态要说清"为什么没有"：极少数历史错题行没有关联到任何卷
               （question_id 为空或题目未挂 task），这类题确实取不到整页图。
               其余情况后端都已兜底（resolveDocImage 三级回退）。 -->
          <div v-else class="no-img">
            <span>该题未关联到卷面原图</span>
            <span class="no-img__sub">（历史错题缺少出处信息，非加载失败）</span>
          </div>
          <figcaption>{{ stu.name }}<span v-if="stu.wrongTimes > 1"> ×{{ stu.wrongTimes }}</span><span v-if="stu.days?.length" class="stu-days">（{{ stu.days.join('、') }}）</span></figcaption>
        </figure>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, ArrowRight, Back, Delete, Download, FullScreen, Pointer, Reading, RefreshLeft, Remove,
} from '@element-plus/icons-vue'
import { apiRequest } from '../../services/apiService'
import { hasExplicitOptionMarkers } from '../../utils/questionCompleteness'
import { difficultyStars } from '../../utils/retryPaperOrder'
import DrawingCanvas from '../components/DrawingCanvas.vue'
import MathRender from '../components/MathRender.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { useTeachingMarks } from './useTeachingMarks'

const route = useRoute()
const router = useRouter()

const handout = ref(null)
const questions = ref([])
const loading = ref(false)
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

// ── 讲题状态（零点击自动判定）────────────────────────────────────
// 判定与落盘全在 useTeachingMarks 里；本页只负责在三个位置埋信号：
//   gotoQuestion()（切题）/ onStrokesChange()（写了字）/ toggleAnswer()（看了答案）
// 见 _周末班白板-讲题状态-产品评审-20260925.md §3.7。
const marks = useTeachingMarks({
  getGrade: () => handout.value?.grade || '',
  getSubject: () => handout.value?.subject || '',
  isImmersive: () => isImmersive.value,
})
// 只统计全屏讲题模式下的停留？—— 不。勘察发现 WeekendHandout 的 openBoard()
// 从不传 fs=1，白板也从不读 fs，全屏必须老师手动点；把它当硬门槛会让自动判定
// 在老师不点全屏时全军覆没。改用「停留分布 + 强信号」判据，快翻天然落进掠过分支。

// 「只看未讲」的可见题单。null = 不过滤。
// 刻意做成「切换时快照」而非响应式过滤：老师正在讲的题不能因为刚被自动标成
// 「已讲」就从列表里当场消失。要重算，再点一次开关即可。
const unTaughtOnly = ref(false)
const viewSnapshot = ref(null)
const viewQuestions = computed(() => viewSnapshot.value || questions.value)

// 底栏长按小圆点的改判菜单
const markMenu = ref(null) // { index, x, q }
let markPressTimer = null
let suppressDotClick = false
/** 页面可见性监听解绑函数（切后台时停表，避免「人不在」被算成讲解） */
let detachVisibility = null

const MARK_OPTIONS = [
  { value: 'done', label: '已讲 · 过关', hint: '讲清楚了，下次不再列出' },
  { value: 'rework', label: '已讲 · 要回炉', hint: '讲错 / 没讲透，下次排最前' },
  { value: 'skip', label: '不讲 · 跳过', hint: '不值得讲，从列表隐藏' },
  { value: 'new', label: '清除标记', hint: '恢复为未讲' },
]
const MARK_LABEL = {
  new: '未讲',
  done: '已讲 · 过关',
  rework: '已讲 · 要回炉',
  skip: '不讲 · 跳过',
}

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

// 当前题从「可见题单」取（可见题单受「只看未讲」影响）
const current = computed(() => viewQuestions.value[currentIndex.value] || null)

// ── 讲题状态展示 ──
const currentMarkStatus = computed(() => (current.value ? marks.statusOf(current.value) : 'new'))
const currentMarkDetail = computed(() => (current.value ? marks.detailOf(current.value) : null))
/** 讲题状态徽标：未讲时不显示（不给画面添噪音） */
const currentMarkBadge = computed(() => {
  const st = currentMarkStatus.value
  if (st === 'new') return null
  const d = currentMarkDetail.value
  return {
    status: st,
    label: MARK_LABEL[st] || st,
    // 「讲完之后又被学生做错」的服务端提示：只提示，不自动改状态
    reworkDue: !!d?.reworkDue && st === 'rework',
    taughtAt: d?.taughtAt || '',
    taughtTimes: d?.taughtTimes || 0,
    source: d?.source || null,
  }
})
const unTaughtCount = computed(() => questions.value.filter(q => marks.isUnTaught(q)).length)

function fmtTaughtAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const currentTaughtLabel = computed(() => {
  const b = currentMarkBadge.value
  if (!b || !b.taughtAt) return ''
  return `上次讲 ${fmtTaughtAt(b.taughtAt)}${b.taughtTimes > 1 ? ` · 共 ${b.taughtTimes} 次` : ''}`
})

// 难度星级：与错题再测卷、周末班讲义列表共用同一口径（difficultyStars：1-2★ / 3★★ / 4-5★★★）。
// 白板题头不写「基础 / 中等 / 较难」这类中文标签 —— 老师的视线在题干上，星级能一眼读出量级。
const currentStars = computed(() => difficultyStars(current.value?.difficulty))

/**
 * 讲题区配图。
 *
 * 只读 `figure`（几何裁图 = 题目配图 A）—— 它只在题目真引图、且过了渲染闸之后才生成，直接可用。
 *
 * [2026-09-21 整题裁片下线] 原先这里还有一条回退：历史题库没有配图、且题干提到「图」时，
 * 回退到原题裁片 `wbImage`（wrong_questions.question_image_url）。该字段已在写入侧正式下线
 * （用户口径：题目一律结构化入库；要留痕只需整页原图，不需要整题裁片），字段不再下发，
 * 回退分支随之移除。没有配图就不显示 —— 不再拿学生卷面上的裁片充当题图。
 * 同理不回退 students[].docImage（整页学生作答卷，属「留痕」不属于「配图」）。
 */
const displayFigureUrl = computed(() => {
  const c = current.value
  if (!c) return ''
  return c.figure || ''
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

// ── 笔迹 localStorage key：按「题目稳定锚点」隔离（2026-09-25 修）──
//
// 原来用「年级+学科+时段 + 题目 index」。但 index 是本次聚合内 seq++ 的顺序号
// （server/lib/weekendHandout.js），换个时段同一 index 会落到完全不同的题上 ——
// 症状就是「上周的板书串到别的题上」，这是本次评审顺带发现的真隐患。
//
// 现在以 slide.anchorKey（复用 topicKey：练习册走 worksheet+页码+题号+题干指纹，
// 其余走 normalizeStem 精确归一化）为键，跨时段稳定。
// 锚点缺失时（旧版题单、或后端未升级）退回旧键，保证不丢已有板书。
const legacyStrokesKey = computed(() => {
  if (!handout.value || !current.value) return ''
  const h = handout.value
  const base = [h.grade, h.subject || '', h.period.start, h.period.end].join('_').replace(/[^\w\u4e00-\u9fa5]/g, '')
  return `wb_strokes_${base}_q${current.value.index}`
})

/** FNV-1a 32 位：给超长锚点做短后缀，避免 localStorage 键过长 */
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

const strokesKey = computed(() => {
  const c = current.value
  if (!handout.value || !c) return ''
  const anchor = String(c.anchorKey || '')
  if (!anchor) return legacyStrokesKey.value
  // 短锚点直接可读（便于排查），超长锚点截断 + 哈希后缀防碰撞
  const tail = anchor.length <= 120 ? anchor : `${anchor.slice(0, 100)}~${fnv1a(anchor)}`
  return `wb_strokes_v2_${tail}`
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

  // 优先用选题页直接带入的题单（sessionStorage 跨同源新标签页共享）。
  // 不再二次拉取同一个慢聚合接口，也不再按「位置序号」跨两次聚合做匹配——
  // 序号在 added_at 同秒的行之间可能漂移，会让白板拿到空题单。
  let payload = null
  try { payload = JSON.parse(sessionStorage.getItem('weekendBoard:payload') || 'null') } catch { /* 解析失败则走回退 */ }
  if (payload?.questions?.length) {
    handout.value = {
      grade: payload.handout?.grade || '初三',
      subject: payload.handout?.subject || null,
      period: payload.handout?.period || { start: '', end: '' },
      withAnswer: payload.handout?.withAnswer !== false,
    }
    questions.value = payload.questions
    currentIndex.value = 0
    loadStrokes()
  } else {
    // 回退：直接打开白板（无 sessionStorage，例如刷新 / 书签进入）时再拉一次
    loading.value = true
    try {
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
        chapter: q.chapter ? String(q.chapter) : undefined,
        withAnswer: true,
      }
      const res = await apiRequest('/weekend-ppt/preview', { method: 'POST', body: JSON.stringify(body) })
      if (!res.success) throw new Error(res.error || '取题失败')
      handout.value = res.handout
      // 解析勾选题号：保留 0、过滤空串与 NaN，避免误删第 1 题或脏数据
      const selSet = new Set(
        String(q.selected || '')
          .split(',')
          .map(s => s.trim())
          .filter(s => s !== '')
          .map(Number)
          .filter(n => !Number.isNaN(n))
      )
      questions.value = (res.handout.slides || []).filter(
        s => s.kind === 'question' && selSet.has(s.index)
      )
      if (questions.value.length === 0) {
        // 用页内 hint 而不是 ElMessage：原生全屏时 body 上的 toast 落在
        // 全屏元素之外，老师根本看不见
        showHint('没有获取到勾选的题目 — 返回选题页重新勾选', 7000)
        return
      }
      currentIndex.value = 0
      loadStrokes()
    } catch (e) {
      showHint('加载题目失败：' + (e.message || '网络错误'), 8000)
    } finally {
      loading.value = false
    }
  }

  // 全屏 / 键盘 / 触屏环境监听。
  // 白板默认普通模式；全屏仅由用户点「全屏」按钮触发，进入时不再自动全屏，
  // 避免点「下一题 / 右箭头」被浏览器全屏盖住、打断讲题。
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  window.addEventListener('keydown', onKeydown)
  // 关页 / 切后台时把本次课讲的题尽量送达（keepalive），别让一节讲题白讲
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('click', onDocClick)
  detachVisibility = marks.attachVisibilityListener()
  // 初始进入第一题：不进入的话第一题的停留时长永远是 0，会被判成「掠过」而漏标。
  marks.enterQuestion(viewQuestions.value[0])
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
const isFsOn = computed(() => isImmersive.value || nativeFs.value)
const fsTitle = computed(() => (isFsOn.value ? '退出全屏（Esc）' : '全屏讲题（F）'))
const showEdgeNav = computed(() => isTouchDevice.value && viewQuestions.value.length > 1)
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
  // 浏览器层全屏被外部因素打断（系统通知、输入法候选框、F11、窗口失焦、
  // 误触 Esc……）时，讲题模式（沉浸版式）保持不退，只丢掉浏览器外壳。
  // 原先把两者绑死：任何一次浏览器全屏退出都会把老师踹回工作台布局 ——
  // 这就是「全屏老是退出」。真正想结束讲题：再按一次 Esc（下方 keydown
  // 处理）或点顶栏「退出全屏」。
  if (wasNativeFs && !nativeFs.value && isImmersive.value) {
    showHint('浏览器全屏已退出，讲题版式仍保持 · 按 Esc 或点「退出全屏」结束')
  }
}
function onBoardMouseMove(e) {
  if (isTouchDevice.value) return
  if (e.clientY <= 18) showTopbar.value = true
  else if (e.clientY > 90) showTopbar.value = false
}
// ── 顶部下拉手势：从屏幕顶部往下拉唤出控制条 ──
// 刻意不做「继续下拉退出全屏」：白板顶端就是书写区，写字时手掌 / 手指从
// 上边缘滑过就会被当成下拉手势，把全屏直接拉出去（「全屏老是退出」的主因）。
// 退出全屏只走两条明确路径：Esc 键、顶栏「退出全屏」按钮（下拉即出）。
const topPull = ref(null)
let topPullTimer = null
const TOP_PULL_SHOW = 36 // 下拉超过该距离唤出控制条
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
  const el = boardPageRef.value || document.documentElement
  const fn = el.requestFullscreen || el.webkitRequestFullscreen
  if (fn) {
    const ok = await enterNativeFs()
    // 讲题版式已生效，原生全屏失败只提示不阻断（例如被浏览器策略拦截）
    if (!ok) showHint('浏览器没有进入全屏（可能被拦截），讲题版式已生效')
  } else {
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
  // 吃掉按钮焦点：全屏后按空格 / 回车不应再次触发这个按钮（误退全屏）
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  if (isFsOn.value) exitFullscreenMode()
  else enterFullscreenMode()
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
  const key = strokesKey.value
  if (!key) return
  try {
    let raw = localStorage.getItem(key)
    if (!raw) {
      // 一次性迁移：笔迹键从「时段+index」改成「稳定锚点」后，同一时段重开白板时
      // 新键下还没有内容。这里兜底读一次旧键，读到就落到新键上，
      // 避免升级当堂把老师已经写在屏幕上的板书弄没。
      const legacy = legacyStrokesKey.value
      if (legacy && legacy !== key) {
        raw = localStorage.getItem(legacy)
        if (raw) localStorage.setItem(key, raw)
      }
    }
    if (raw) currentStrokes.value = JSON.parse(raw)
  } catch {
    currentStrokes.value = []
  }
}

function onStrokesChange(val) {
  currentStrokes.value = val
  // 在题上写了字 = 最强「讲过」信号（比停留时长可靠得多）
  marks.noteStrokes(current.value, Array.isArray(val) && val.some(s => s?.points?.length))
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
  const list = viewQuestions.value
  if (i < 0 || i >= list.length || i === currentIndex.value) return
  // 顺序要紧：saveStrokes() 依赖 current（旧题）算键，必须先存
  saveStrokes()
  // 结算上一题 → 自动判定「讲过没有」。这里带上两个当场信号：
  //   hasStrokes  —— 笔迹可能是上次留下的（从 localStorage 读回来的），也算讲过
  //   viewedAnswer —— 讲完对答案是最典型的「这题讲完了」
  marks.leaveQuestion({
    hasStrokes: currentStrokes.value.some(s => s?.points?.length),
    viewedAnswer: showAnswer.value,
  })
  const d = dir ?? (i > currentIndex.value ? 1 : -1)
  currentIndex.value = i
  showAnswer.value = false
  showOriginal.value = false
  loadStrokes()
  if (qBodyRef.value) qBodyRef.value.scrollTop = 0
  if (hint.value) hint.value = ''
  playSlide(d)
  marks.enterQuestion(list[i])
  closeMarkMenu()
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
      e.preventDefault(); gotoQuestion(viewQuestions.value.length - 1, 1); break
    case 'a': case 'A': toggleAnswer(); break
    case 'o': case 'O': toggleOriginal(); break
    case 'f': case 'F':
      // 长按 f 会连续翻转全屏，看起来就像「全屏自己退了」
      if (!e.repeat) toggleFullscreen()
      break
    case 'z': case 'Z': undo(); break
    case 'u': case 'U': toggleUnTaughtOnly(); break
    case 'r': case 'R': resumeLecture(); break
    case 'Escape':
      if (markMenu.value) { closeMarkMenu(); break }
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
function toggleAnswer() {
  showAnswer.value = !showAnswer.value
  // 点开参考答案 = 「这题讲完了，对一下答案」的强信号
  if (showAnswer.value) marks.noteAnswerViewed(current.value)
}
function toggleOriginal() { showOriginal.value = !showOriginal.value }

// ── 讲题状态：顶栏开关 ──────────────────────────────────────────
/** 「只看未讲」：把已讲 / 跳过的题从可见题单里摘掉，解决「下次别再重复讲」 */
function toggleUnTaughtOnly() {
  if (!unTaughtOnly.value) {
    const list = questions.value.filter(q => marks.isUnTaught(q))
    if (list.length === 0) {
      showHint('没有未讲的题了 —— 全部都已讲过或已跳过')
      return
    }
    unTaughtOnly.value = true
    viewSnapshot.value = list
    showHint(`只看未讲：${list.length} 题（已隐藏 ${questions.value.length - list.length} 题）`)
  } else {
    unTaughtOnly.value = false
    viewSnapshot.value = null
    showHint(`已显示全部 ${questions.value.length} 题`)
  }
  // 可见题单换了，回到第一题。顺序同 gotoQuestion：先存笔迹、再结算、再切
  saveStrokes()
  marks.leaveQuestion({
    hasStrokes: currentStrokes.value.some(s => s?.points?.length),
    viewedAnswer: showAnswer.value,
  })
  currentIndex.value = 0
  showAnswer.value = false
  showOriginal.value = false
  loadStrokes()
  marks.enterQuestion(viewQuestions.value[0])
  closeMarkMenu()
}

/** 「续讲」：跳到第一道没讲过的题 —— 也就是上次讲到哪儿 */
function resumeLecture() {
  const list = viewQuestions.value
  const idx = list.findIndex(q => marks.isUnTaught(q))
  if (idx < 0) {
    // 页内 hint：ElMessage 挂在 body 上，原生全屏时看不见
    showHint('这份题单已经全部讲过了')
    return
  }
  gotoQuestion(idx)
  showHint(idx === 0 ? '续讲：从第 1 题开始' : `续讲：跳到第 ${idx + 1} 题（前面 ${idx} 题已讲）`)
}

// ── 讲题状态：底栏小圆点 单击跳题 / 长按改判 ──
// 长按而不是单击切状态：讲课时手指就在屏幕上，单击直接改状态太容易误触。
function onDotPointerDown(i, ev) {
  suppressDotClick = false
  // 鼠标用右键改判（contextmenu），不做长按 —— 慢一点的单击不该被误判成长按
  if (ev?.pointerType === 'mouse') return
  clearTimeout(markPressTimer)
  markPressTimer = setTimeout(() => {
    markPressTimer = null
    suppressDotClick = true
    openMarkMenu(i, ev)
  }, 520)
}
function onDotPointerUp() {
  clearTimeout(markPressTimer)
  markPressTimer = null
}
function onDotClick(i) {
  // 长按已经弹过菜单，紧接着的 click 要吞掉，否则会顺手跳题
  if (suppressDotClick) {
    suppressDotClick = false
    return
  }
  gotoQuestion(i)
}
function onDotContextMenu(i, ev) {
  // PC 投屏时的右键等价于长按
  ev.preventDefault()
  openMarkMenu(i, ev)
}
function openMarkMenu(i, ev) {
  const el = ev?.currentTarget
  const x = el ? (el.offsetLeft || 0) + (el.offsetWidth || 0) / 2 : 0
  markMenu.value = { index: i, x, q: viewQuestions.value[i] || null }
}
function closeMarkMenu() { markMenu.value = null }
/** 小圆点 tooltip：把「为什么是这个颜色」说清楚，省得老师猜 */
function dotTitle(q, i) {
  const st = marks.statusOf(q)
  const d = marks.detailOf(q)
  const parts = [`第 ${i + 1} 题`, MARK_LABEL[st] || '未讲']
  if (d?.reworkDue && st === 'rework') parts.push('上次讲完还错')
  if (d?.taughtAt) parts.push(`上次讲 ${fmtTaughtAt(d.taughtAt)}`)
  parts.push('长按改判')
  return parts.join(' · ')
}
/** 点菜单外面 / 按 Esc 关掉改判菜单 */
function onDocClick(e) {
  if (!markMenu.value) return
  if (e.target?.closest?.('.fb-menu, .fb-dot')) return
  closeMarkMenu()
}
function chooseMark(status) {
  const q = markMenu.value?.q
  if (!q) return
  marks.setManual(q, status)
  showHint(status === 'new' ? '已清除标记' : `已标为「${MARK_LABEL[status]}」`)
  // 开着「只看未讲」时不自动重算可见题单：老师正在讲的题不能因为刚被标成
  // 「已讲」就从列表里当场消失。要重算，再点一次开关。
  closeMarkMenu()
}
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
  // 结算当前题（自动判定「讲过没有」）并把待落盘的标记送出去。
  // 不 await：返回选题页不该被网络请求卡住；失败会留在队列里，下次 flush 重发。
  marks.leaveQuestion({
    hasStrokes: currentStrokes.value.some(s => s?.points?.length),
    viewedAnswer: showAnswer.value,
  })
  marks.flushNow()
  if (isFsOn.value) exitFullscreenMode()
  router.push('/weekend-ppt')
}

// 关标签页 / 切后台被杀：用 keepalive 尽力送达，别让这次课讲的题白讲
function onPageHide() {
  marks.leaveQuestion({
    hasStrokes: currentStrokes.value.some(s => s?.points?.length),
    viewedAnswer: showAnswer.value,
  })
  marks.flushNow({ keepalive: true })
}

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(hintTimer)
  clearTimeout(topPullTimer)
  clearTimeout(markPressTimer)
  try { slideAnim?.cancel() } catch { /* 忽略 */ }
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('click', onDocClick)
  detachVisibility?.()
  // 组件卸载（路由离开）时兜一次：leaveQuestion 幂等，重复调用无副作用
  onPageHide()
  marks.dispose()
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
  /* 配图区最多占题目面板的高度比例。题干区自己滚动；
     配图与题干都要可收缩，长题干 + 大图时先缩图，保证题目可见。 */
  --fig-max: 58%;
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
  /* 顶栏现在多了「只看未讲 / 续讲」两个开关，窄屏（平板竖屏）要能换行而不是溢出 */
  flex-wrap: wrap;
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
.tb-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; }
/* 「只看未讲」后面的剩余题数角标 */
.tb-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--wb-primary-mist, #eef2ff);
  color: var(--wb-primary, #6366f1);
  font-size: 11.5px;
  line-height: 16px;
  text-align: center;
}
.tb-btn.active .tb-count { background: #fff; }
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
.question-layer.has-answer { --fig-max: 42%; }
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
/* 难度星级：字号略大于 meta，琥珀色，字距拉开让三格固定宽好横向对比（同讲义列表/重练卷预览） */
.q-diff {
  font-size: calc(14px * var(--s));
  color: #F59E0B;
  letter-spacing: 1px;
  white-space: nowrap;
  flex-shrink: 0;
}
/* 讲题状态徽标：未讲时不渲染（不给画面添噪音） */
.q-mark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: calc(3px * var(--s)) calc(10px * var(--s));
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: calc(12.5px * var(--s));
  white-space: nowrap;
  flex-shrink: 0;
}
.q-mark--done { background: #dcfce7; border-color: #86efac; color: #15803d; }
.q-mark--rework { background: #fef3c7; border-color: #fcd34d; color: #b45309; }
.q-mark--skip { background: #f1f5f9; border-color: #cbd5e1; color: #64748b; }
.q-mark__due { font-weight: 600; }
.q-taught { white-space: nowrap; }
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
  /* 不主动拉伸（不放大低清裁片），但允许收缩：长题干 + 大图时先让路给题目 */
  flex: 0 1 auto;
  width: 100%;
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
.fb-progress { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; max-width: 560px; }
.fb-dot {
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: 0.15s;
  /* 长按改判要吃掉浏览器的默认长按行为（iOS 的 callout / 文本选择），否则菜单弹不出来 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}
/* 四色讲题状态 —— 全部自动派生，老师不需要维护（见 useTeachingMarks） */
.fb-dot--new { background: #cbd5e1; }
.fb-dot--done { background: #16a34a; }
.fb-dot--rework { background: #f59e0b; }
.fb-dot--skip { background: #fff; border-color: #cbd5e1; }
.fb-dot:hover { filter: brightness(0.92); }
/* 当前题用「描边圈」而不是换填充色：原来直接改 background 会把状态色盖掉，白看 */
.fb-dot.current { border: 2px solid var(--wb-primary, #6366f1); transform: scale(1.12); }
.fb-hint { position: absolute; right: 20px; font-size: 12px; color: var(--wb-text-tertiary, #94a3b8); }

/* 长按小圆点的改判菜单（唯一需要老师动手的动作，完全可选） */
.fb-menu {
  position: absolute;
  bottom: calc(100% + 10px);
  transform: translateX(-50%);
  z-index: 20;
  min-width: 172px;
  padding: 6px;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
}
.fb-menu__title { padding: 4px 8px 6px; font-size: 12px; color: var(--wb-text-tertiary, #94a3b8); }
.fb-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font-size: 13px;
  color: var(--wb-text, #1e293b);
  text-align: left;
  cursor: pointer;
}
.fb-menu__item:hover { background: var(--wb-bg-hover, #f1f5f9); }
.fb-menu__item.active { background: var(--wb-primary-mist, #eef2ff); color: var(--wb-primary, #6366f1); }
/* 只声明宽/样式，不写 border 简写 —— 否则会把 .fb-dot--skip 的 border-color 重置掉 */
.fb-menu__dot { width: 10px; height: 10px; flex: 0 0 auto; border-width: 1px; border-style: solid; border-color: transparent; border-radius: 50%; box-sizing: border-box; }

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
.original-item figcaption .stu-days { margin-left: 2px; font-size: 12px; color: var(--wb-text-tertiary, #94a3b8); }
.no-img {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 4px;
  height: 160px;
  border: 1px dashed var(--wb-border, #e2e8f0);
  border-radius: 8px;
  color: var(--wb-text-tertiary, #94a3b8);
  font-size: 13px;
}

.no-img__sub { font-size: 12px; opacity: 0.75; }

.board-empty { padding: 60px 0; }

/* 加载态：聚合题单期间显示，替代误导性的「没有题目」空态 */
.board-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--wb-text-secondary, #64748b);
  font-size: 14px;
}
.board-loading__spin {
  width: 18px;
  height: 18px;
  border: 2px solid var(--wb-border, #e2e8f0);
  border-top-color: var(--wb-primary, #6366f1);
  border-radius: 50%;
  animation: board-spin 0.8s linear infinite;
}
@keyframes board-spin { to { transform: rotate(360deg); } }

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
