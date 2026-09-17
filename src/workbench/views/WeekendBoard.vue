<template>
  <div class="board-page" :class="{ 'board-fullscreen': isFullscreen }">
    <!-- 顶栏 -->
    <header class="board-topbar">
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
        <button class="tb-btn tb-fullscreen" type="button" @click="toggleFullscreen">
          <el-icon><FullScreen /></el-icon>
        </button>
      </div>
    </header>

    <!-- 主区：题目（HTML 层）+ 手写层（Canvas 覆盖） -->
    <main class="board-main">
      <div v-if="current" class="question-wrap" ref="questionWrapRef">
        <!-- 题目 HTML 层 -->
        <div class="question-layer">
          <div class="q-head">
            <span class="q-badge">{{ current.questionNumber != null ? '第 ' + current.questionNumber + ' 题' : '题目' }}</span>
            <span class="q-meta">{{ current.day }} · {{ current.typeLabel || '未标题型' }} · {{ current.tierLabel || '难度未判定' }} · {{ current.studentCount }} 人错</span>
          </div>
          <div v-if="current.parentStem" class="q-parent">{{ current.parentStem }}</div>
          <div v-if="(current.subParts || []).length > 1" class="q-subparts">
            <div v-for="sp in current.subParts" :key="sp.subNo" class="q-sub">
              <span class="q-subno">({{ sp.subNo }})</span>{{ sp.content }}
            </div>
          </div>
          <div v-else class="q-stem">{{ current.stem }}</div>
          <div v-if="(current.missingSubs || []).length" class="q-missing">
            ⚠ 本题错在第 {{ current.missingSubs.join('、') }} 问，但题库缺该小问题干 — 讲前请看原卷图
          </div>
          <div v-if="current.figure" class="q-figure">
            <img :src="current.figure" alt="题图" loading="lazy" />
          </div>
        </div>

        <!-- 答案浮现层（覆盖题目下层，弹出式） -->
        <transition name="ans-pop">
          <div v-if="showAnswer" class="answer-layer">
            <div class="ans-title">参考答案{{ current.answerSourceLabel ? ' · ' + current.answerSourceLabel : '' }}</div>
            <div class="ans-body">{{ current.answer || '参考答案暂缺 — 讲前请人工补' }}</div>
            <div v-if="current.answerRisk" class="ans-risk">⚠ {{ current.answerRisk }}</div>
          </div>
        </transition>

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
          :export-figure="current?.figure || ''"
          @update:strokes="onStrokesChange"
        />
      </div>

      <div v-else class="board-empty">
        <EmptyState :icon="Reading" title="没有题目" description="未获取到勾选的题目，返回重新选择。" />
      </div>
    </main>

    <!-- 右侧工具栏 -->
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
        <button type="button" class="tool-btn" title="撤销" @click="undo">
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
          @click="allowTouch = !allowTouch"
        >
          <el-icon><Pointer /></el-icon>
        </button>
      </div>
    </aside>

    <!-- 底栏：翻题 -->
    <footer v-if="current" class="board-footer">
      <button class="fb-btn" type="button" :disabled="currentIndex === 0" @click="prevQuestion">
        <el-icon><ArrowLeft /></el-icon>上一题
      </button>
      <div class="fb-progress">
        <span class="fb-dot" :class="{ current: i === currentIndex }" v-for="(q, i) in questions" :key="q.index" @click="gotoQuestion(i)" />
      </div>
      <button class="fb-btn" type="button" :disabled="currentIndex === questions.length - 1" @click="nextQuestion">
        下一题<el-icon><ArrowRight /></el-icon>
      </button>
    </footer>

    <!-- 原卷图弹窗 -->
    <el-dialog v-model="showOriginal" title="学生原卷（整页图）" width="min(92vw, 900px)" append-to-body>
      <div class="original-grid">
        <figure v-for="(stu, i) in current?.students || []" :key="i" class="original-item">
          <img v-if="stu.docImage" :src="stu.docImage" :alt="stu.name + ' 原卷'" loading="lazy" />
          <div v-else class="no-img">无原卷图</div>
          <figcaption>{{ stu.name }}<span v-if="stu.wrongTimes > 1"> ×{{ stu.wrongTimes }}</span></figcaption>
        </figure>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  ArrowLeft, ArrowRight, Back, Delete, Download, FullScreen, Pointer, Reading, RefreshLeft, Remove,
} from '@element-plus/icons-vue'
import { apiRequest } from '../../services/apiService'
import DrawingCanvas from '../components/DrawingCanvas.vue'
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
const isFullscreen = ref(false)
const fullscreenChangeH = null

const penColors = [
  { label: '红', value: '#E11D48' },
  { label: '蓝', value: '#2563EB' },
  { label: '绿', value: '#16A34A' },
  { label: '黑', value: '#1E293B' },
]
const penSizes = [
  { label: '细', value: 2, dot: '4px' },
  { label: '中', value: 3.5, dot: '7px' },
  { label: '粗', value: 6, dot: '11px' },
]

const current = computed(() => questions.value[currentIndex.value] || null)

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
  return `${handout.value?.grade || ''} · ${current.value.day} · 第 ${current.value.questionNumber ?? ''} 题`
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
    withAnswer: true,
  }
  try {
    const res = await apiRequest('/weekend-ppt/preview', { method: 'POST', body })
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

  // 全屏状态监听
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})

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

function gotoQuestion(i) {
  if (i < 0 || i >= questions.value.length || i === currentIndex.value) return
  saveStrokes()
  currentIndex.value = i
  showAnswer.value = false
  showOriginal.value = false
  loadStrokes()
}
const prevQuestion = () => gotoQuestion(currentIndex.value - 1)
const nextQuestion = () => gotoQuestion(currentIndex.value + 1)

// ── 工具 ──
function setColor(c) { color.value = c; tool.value = 'pen' }
function setSize(s) { penSize.value = s; tool.value = 'pen' }
function toggleEraser() { tool.value = tool.value === 'eraser' ? 'pen' : 'eraser' }
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

function exportBoard() {
  const c = current.value
  if (!c) return
  const name = `${handout.value?.grade || ''}_${c.day}_题${c.questionNumber ?? ''}_板书.png`
  canvasRef.value?.exportPng(name)
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    document.documentElement.requestFullscreen?.()
  }
}

function goBack() {
  // 返回时保存当前笔迹
  saveStrokes()
  router.push('/weekend-ppt')
}
</script>

<style scoped>
.board-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 0px);
  min-height: 480px;
  background: #f8fafc;
}
.board-page.board-fullscreen {
  height: 100vh;
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
.tb-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tb-back {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  color: var(--wb-text-secondary, #64748b);
}
.tb-back:hover { color: var(--wb-primary, #6366f1); border-color: var(--wb-primary, #6366f1); }
.tb-title strong { display: block; font-size: 15px; color: var(--wb-text, #1e293b); }
.tb-title span { font-size: 12.5px; color: var(--wb-text-secondary, #64748b); }
.tb-right { display: flex; align-items: center; gap: 8px; }
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
}
.tb-btn:hover { color: var(--wb-primary, #6366f1); border-color: var(--wb-primary, #6366f1); }
.tb-btn.active { background: var(--wb-primary-mist, #eef2ff); color: var(--wb-primary, #6366f1); border-color: var(--wb-primary, #6366f1); }
.tb-export { color: #16a34a; border-color: #bbe7c9; }
.tb-export:hover { color: #16a34a; border-color: #16a34a; }

/* 主区 */
.board-main {
  position: relative;
  flex: 1;
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
  overflow-y: auto;
  z-index: 1;
}
.q-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.q-badge {
  padding: 4px 12px;
  border-radius: 8px;
  background: var(--wb-primary, #6366f1);
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
}
.q-meta { font-size: 12.5px; color: var(--wb-text-secondary, #64748b); }
.q-parent { font-size: 17px; font-weight: 650; line-height: 1.8; color: var(--wb-text, #1e293b); }
.q-subparts { margin-top: 10px; }
.q-sub { font-size: 15.5px; line-height: 1.85; color: var(--wb-text, #1e293b); margin-top: 6px; }
.q-subno { color: var(--wb-primary, #6366f1); font-weight: 600; margin-right: 4px; }
.q-stem { font-size: 15.5px; line-height: 1.85; color: var(--wb-text, #1e293b); margin-top: 10px; }
.q-missing {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  color: #b45309;
  font-size: 13px;
}
.q-figure { margin-top: 16px; }
.q-figure img {
  max-width: min(420px, 80%);
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 8px;
  background: #fff;
}

/* 答案浮现层 */
.answer-layer {
  position: absolute;
  left: 28px;
  right: 28px;
  bottom: 22px;
  z-index: 2;
  padding: 14px 18px;
  background: #eef2ff;
  border-left: 4px solid var(--wb-primary, #6366f1);
  border-radius: 0 10px 10px 0;
  max-height: 55%;
  overflow-y: auto;
  box-shadow: 0 4px 18px rgba(30, 41, 59, 0.08);
}
.ans-title { font-size: 12px; font-weight: 650; color: var(--wb-primary, #6366f1); letter-spacing: 0.3px; margin-bottom: 6px; }
.ans-body { font-size: 15px; font-weight: 550; line-height: 1.7; color: var(--wb-text, #1e293b); }
.ans-risk { font-size: 12px; color: #b45309; margin-top: 6px; }
.ans-pop-enter-active, .ans-pop-leave-active { transition: opacity 0.2s, transform 0.2s; }
.ans-pop-enter-from, .ans-pop-leave-to { opacity: 0; transform: translateY(10px); }

/* 手写层（z-index 3，覆盖在题目与答案之上，但答案层 z=2，书写优先） */
.drawing-canvas-host { position: absolute; inset: 0; }

/* 右侧工具栏 */
.board-toolbar {
  position: absolute;
  top: 12px;
  right: 16px;
  bottom: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 12px 8px;
  background: #fff;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 12px;
}
.tool-group { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.tool-group + .tool-group { border-top: 1px solid var(--wb-border-light, #f1f5f9); padding-top: 12px; }
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 10px 16px;
  background: #fff;
  border-top: 1px solid var(--wb-border, #e2e8f0);
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

/* 原卷弹窗 */
.original-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.original-item { margin: 0; }
.original-item img { width: 100%; border: 1px solid var(--wb-border, #e2e8f0); border-radius: 8px; }
.original-item figcaption { margin-top: 6px; font-size: 13px; color: var(--wb-text-secondary, #64748b); }
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
</style>
