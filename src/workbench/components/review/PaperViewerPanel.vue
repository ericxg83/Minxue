<template>
  <div class="paper-viewer">
    <!-- 空状态 -->
    <div v-if="!store.currentTask" class="paper-empty">
      <el-icon size="48"><Picture /></el-icon>
      <span>请在上方选择学生和试卷</span>
    </div>

    <template v-else>
      <!-- 查看器容器 -->
      <div
        class="viewer-container"
        ref="containerRef"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      >
        <!-- 图片图层 -->
        <div class="image-layer" :style="imageLayerStyle">
          <img
            :src="store.currentPageImage"
            ref="imgRef"
            @load="onImgLoad"
            @error="onImgError"
            alt="试卷原图"
            draggable="false"
            class="paper-image"
          />

          <!-- 仅当前选中题目显示定位框（坐标系与当前页图一致时才画，优雅降级） -->
          <div
            v-if="showBbox && store.currentReviewQuestion && getBlockCoords(store.currentReviewQuestion)"
            class="question-overlay overlay-current"
            :style="getOverlayStyle(store.currentReviewQuestion)"
            :title="`第${store.currentReviewIndex + 1}题`"
          >
            <span class="overlay-number">
              {{ store.currentReviewIndex + 1 }}
              <span v-if="store.currentReviewQuestion.is_correct === true" class="overlay-icon correct">✓</span>
              <span v-else-if="store.currentReviewQuestion.is_correct === false" class="overlay-icon wrong">✗</span>
            </span>
          </div>
        </div>

        <!-- 缩放控制 -->
        <div class="zoom-controls">
          <el-button size="small" circle @click="zoomIn" :disabled="zoom >= 5">＋</el-button>
          <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
          <el-button size="small" circle @click="zoomOut" :disabled="zoom <= 0.2">－</el-button>
          <el-button size="small" @click="fitToContainer">适应</el-button>
        </div>

        <!-- 鼠标提示 -->
        <div class="drag-hint" v-if="zoom > 1.05">
          <span>拖拽平移 · 滚轮缩放</span>
        </div>

        <!-- 图片加载失败提示 -->
        <div v-if="imgError" class="img-error-overlay">
          <el-icon size="24"><WarningFilled /></el-icon>
          <span>图片加载失败</span>
          <el-button size="small" @click="retryLoad" style="margin-top: 8px;">重试</el-button>
        </div>
      </div>

      <!-- 页码标签 / 多页切换 -->
      <div class="page-bar">
        <template v-if="store.currentPaperPages.length > 1">
          <el-button
            size="small" text
            :disabled="store.currentPageIndex <= 0"
            @click="prevPage"
          >‹ 上一页</el-button>
          <span class="page-indicator">
            第 {{ store.currentPageIndex + 1 }} / {{ store.currentPaperPages.length }} 页
          </span>
          <el-button
            size="small" text
            :disabled="store.currentPageIndex >= store.currentPaperPages.length - 1"
            @click="nextPage"
          >下一页 ›</el-button>
        </template>
        <span v-else class="page-indicator">第 1 页</span>
      </div>

      <!-- 其他待复核页图缩略图（同一份练习卷的其他答题卡页，仅练习批改保留） -->
      <div v-if="store.reviewConfig.showOtherPapers && store.otherPendingPages.length > 0" class="pending-thumbnails">
        <div class="thumbnails-header">
          <span>其他待复核试卷 ({{ store.otherPendingPages.length }})</span>
        </div>
        <div class="thumbnails-scroll">
          <div
            v-for="(page, idx) in store.otherPendingPages"
            :key="page.id"
            class="thumbnail-card"
            @click="switchToPage(page, idx)"
          >
            <div class="thumbnail-img-wrap">
              <img :src="page.image_url" :alt="page.original_name" class="thumbnail-img" />
              <div class="thumbnail-overlay">
                <el-icon><View /></el-icon>
                <span>复核</span>
              </div>
            </div>
            <span class="thumbnail-name">{{ page.original_name || '未命名试卷' }}</span>
          </div>
        </div>
      </div>

      <!-- 已复核试卷（可折叠，仅练习批改保留） -->
      <div v-if="store.reviewConfig.showOtherPapers && store.reviewedTasks.length > 0" class="reviewed-thumbnails">
        <div class="thumbnails-header toggle-header" @click="showReviewed = !showReviewed">
          <el-icon class="toggle-arrow" :class="{ expanded: showReviewed }"><ArrowRight /></el-icon>
          <span>已复核试卷 ({{ store.reviewedTasks.length }})</span>
        </div>
        <div v-show="showReviewed" class="thumbnails-scroll">
          <div
            v-for="t in store.reviewedTasks"
            :key="t.id"
            class="thumbnail-card reviewed"
            @click="switchToTask(t)"
          >
            <div class="thumbnail-img-wrap">
              <img :src="t.image_url" :alt="t.original_name" class="thumbnail-img" />
              <div class="thumbnail-overlay">
                <el-icon><View /></el-icon>
                <span>查看</span>
              </div>
            </div>
            <span class="thumbnail-name">{{ t.original_name || '未命名试卷' }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { Picture, WarningFilled, View, ArrowRight } from '@element-plus/icons-vue'

const store = useReviewStore()

// 已复核试卷折叠状态
const showReviewed = ref(false)

// bbox 优雅降级：仅当题目坐标与当前页图坐标系一致时绘制。
// image 模式：坐标相对学生上传原图，可绘制。
// paper 模式：练习卷题目的 block_coordinates 相对「原始作业图」，与答题卡页图不对齐，
//            后端坐标管线就绪前不绘制（有坐标也不画），避免错位。
const showBbox = computed(() => store.source === 'image')

const containerRef = ref(null)
const imgRef = ref(null)

// 缩放状态
const zoom = ref(1)
const zoomStep = 0.15

// 平移状态
const panX = ref(0)
const panY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragPanX = ref(0)
const dragPanY = ref(0)

// 图片状态
const imgError = ref(false)
const imgLoaded = ref(false)
// 图片自然尺寸（用于将归一化 0-1000 坐标换算为像素）
const imgNaturalW = ref(0)
const imgNaturalH = ref(0)

// ─── 工具函数 ─────────────────────────────────────────────

/** 安全获取 block_coordinates（兼容 string/object） */
const getBlockCoords = (q) => {
  if (!q) return null
  const coords = q.block_coordinates
  if (!coords) return null
  if (typeof coords === 'string') {
    try { return JSON.parse(coords) } catch { return null }
  }
  if (typeof coords !== 'object') return null
  // 兼容 {x,y,width,height} 和 {left,top,width,height}
  return {
    x: coords.x ?? coords.left ?? 0,
    y: coords.y ?? coords.top ?? 0,
    width: coords.width ?? 0,
    height: coords.height ?? 0
  }
}

/** 定位框样式：block_coordinates 为归一化 0-1000 坐标，按图片自然尺寸换算为像素 */
const getOverlayStyle = (q) => {
  const bbox = getBlockCoords(q)
  if (!bbox) return { display: 'none' }
  const nW = imgNaturalW.value, nH = imgNaturalH.value
  if (!nW || !nH) return { display: 'none' }
  return {
    left: (bbox.x / 1000 * nW) + 'px',
    top: (bbox.y / 1000 * nH) + 'px',
    width: (bbox.width / 1000 * nW) + 'px',
    height: (bbox.height / 1000 * nH) + 'px'
  }
}

/** 图片图层样式：scale 前先 translate，保持拖拽在屏幕坐标空间 */
const imageLayerStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
  transformOrigin: '0 0',
  cursor: isDragging.value ? 'grabbing' : 'grab'
}))

// ─── 图片事件 ─────────────────────────────────────────────

const onImgLoad = () => {
  imgError.value = false
  imgLoaded.value = true
  if (imgRef.value) {
    imgNaturalW.value = imgRef.value.naturalWidth || 0
    imgNaturalH.value = imgRef.value.naturalHeight || 0
  }
  fitToContainer()
}

/** 自适应：将试卷完整显示在容器内 */
const fitToContainer = () => {
  if (!containerRef.value || !imgRef.value) return
  const cw = containerRef.value.clientWidth
  const ch = containerRef.value.clientHeight
  const iw = imgRef.value.naturalWidth
  const ih = imgRef.value.naturalHeight
  if (!cw || !ch || !iw || !ih) return

  const pad = 0.92
  const scaleX = (cw * pad) / iw
  const scaleY = (ch * pad) / ih
  zoom.value = Math.min(scaleX, scaleY, 1)

  panX.value = (cw - iw * zoom.value) / 2
  panY.value = (ch - ih * zoom.value) / 2
}

const onImgError = () => {
  imgError.value = true
  imgLoaded.value = false
}

const retryLoad = () => {
  imgError.value = false
  if (imgRef.value) {
    imgRef.value.src = store.currentPageImage || ''
  }
}

// ─── 多页切换 ─────────────────────────────────────────────
const prevPage = () => store.setPageIndex(store.currentPageIndex - 1)
const nextPage = () => store.setPageIndex(store.currentPageIndex + 1)

// 切换页图后重置自适应（等图片自然尺寸更新由 onImgLoad 处理，这里兜底）
watch(() => store.currentPageImage, () => {
  imgError.value = false
})

// ─── 缩放控制 ─────────────────────────────────────────────

const zoomIn = () => {
  zoom.value = Math.min(5, +(zoom.value + zoomStep).toFixed(2))
}

const zoomOut = () => {
  zoom.value = Math.max(0.2, +(zoom.value - zoomStep).toFixed(2))
}



/** 滚轮缩放：以光标所在位置为中心 */
const onWheel = (e) => {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  const oldZoom = zoom.value
  const delta = e.deltaY > 0 ? -zoomStep : zoomStep
  const newZoom = Math.max(0.2, Math.min(5, +(oldZoom + delta).toFixed(2)))
  if (newZoom === oldZoom) return

  const ratio = newZoom / oldZoom
  panX.value = mx - ratio * (mx - panX.value)
  panY.value = my - ratio * (my - panY.value)
  zoom.value = newZoom
}

// ─── 拖拽平移 ─────────────────────────────────────────────

const onMouseDown = (e) => {
  // 仅左键，且不点在 overlay 上（overlay 有 stopPropagation）
  if (e.button !== 0) return
  // 如果点在 缩放控件 上，不启动拖拽
  if (e.target.closest('.zoom-controls')) return
  isDragging.value = true
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY
  dragPanX.value = panX.value
  dragPanY.value = panY.value
}

const onMouseMove = (e) => {
  if (!isDragging.value) return
  const dx = e.clientX - dragStartX.value
  const dy = e.clientY - dragStartY.value
  panX.value = dragPanX.value + dx
  panY.value = dragPanY.value + dy
}

const onMouseUp = () => {
  isDragging.value = false
}

/** 切换到其他待复核试卷 */
const switchToTask = async (task) => {
  if (!task || task.id === store.currentTask?.id) return
  await store.selectTask(task)
  fitToContainer()
}

/** 切换到同一份练习卷的其他页图 */
const switchToPage = (page) => {
  if (!store.currentTask?._pageTasks) return
  const actualIndex = store.currentTask._pageTasks.findIndex(p => p.id === page.id)
  if (actualIndex >= 0) {
    store.setPageIndex(actualIndex)
  }
}


</script>

<style scoped>
.paper-viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: #f0f2f5;
  position: relative;
  overflow: hidden;
}

/* ── 查看器容器 ── */
.viewer-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background-color: #e8ebf0;
  background-image:
    radial-gradient(circle, #d0d5dd 1.2px, transparent 1.2px);
  background-size: 24px 24px;
}

.image-layer {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.paper-image {
  display: block;
  max-width: none;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

/* ── 题目定位框 ── */
.question-overlay {
  position: absolute;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  pointer-events: auto;
  z-index: 2;
  overflow: visible;
}

.overlay-current {
  border: 2.5px solid #409eff;
  background: rgba(64, 158, 255, 0.10);
  box-shadow: 0 0 0 1.5px rgba(64, 158, 255, 0.25), 0 0 12px rgba(64, 158, 255, 0.15);
  z-index: 3;
}

.overlay-confirmed {
  border: 2px solid #67c23a;
  background: rgba(103, 194, 58, 0.07);
}

.overlay-unconfirmed {
  border: 2px dashed #e6a23c;
  background: rgba(230, 162, 60, 0.04);
}

.overlay-low-confidence {
  animation: pulse-warn 2s ease-in-out infinite;
}

@keyframes pulse-warn {
  0%, 100% { border-color: #e6a23c; opacity: 0.9; }
  50% { border-color: #f56c6c; opacity: 0.6; }
}

.overlay-number {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px 1px 6px;
  border-radius: 3px;
  line-height: 1.6;
  margin: 3px;
}

.overlay-current .overlay-number {
  background: #409eff;
}

.overlay-icon {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.overlay-icon.correct {
  color: #a0f0a0;
}

.overlay-icon.wrong {
  color: #faa0a0;
}

/* ── 缩放控制 ── */
.zoom-controls {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.92);
  padding: 6px 12px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  z-index: 10;
}

.zoom-value {
  font-size: 13px;
  color: #606266;
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ── 拖拽提示 ── */
.drag-hint {
  position: absolute;
  bottom: 56px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: #909399;
  background: rgba(255, 255, 255, 0.85);
  padding: 3px 12px;
  border-radius: 10px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 9;
}

/* ── 图片加载失败 ── */
.img-error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.85);
  color: #909399;
  font-size: 14px;
  z-index: 5;
}

/* ── 页码条 ── */
.page-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  background: #fff;
  border-top: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.page-indicator {
  font-size: 13px;
  color: #909399;
}

/* ── 待复核试卷缩略图 ── */
.pending-thumbnails {
  flex-shrink: 0;
  background: #fff;
  border-top: 1px solid #e4e7ed;
  padding: 8px 12px;
}

.thumbnails-header {
  font-size: 12px;
  font-weight: 600;
  color: #909399;
  margin-bottom: 8px;
}

.thumbnails-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.thumbnail-card {
  flex-shrink: 0;
  width: 120px;
  cursor: pointer;
  border-radius: 6px;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 1px solid #ebeef5;
}

.thumbnail-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.thumbnail-img-wrap {
  position: relative;
  width: 120px;
  height: 80px;
  overflow: hidden;
  background: #f5f7fa;
}

.thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbnail-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s;
}

.thumbnail-card:hover .thumbnail-overlay {
  opacity: 1;
}

.thumbnail-name {
  display: block;
  padding: 4px 6px;
  font-size: 11px;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 已复核试卷缩略图（可折叠） ── */
.reviewed-thumbnails {
  flex-shrink: 0;
  background: #fafafa;
  border-top: 1px dashed #e4e7ed;
  padding: 6px 12px;
}

.toggle-header {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  color: #909399;
}

.toggle-header:hover {
  color: #606266;
}

.toggle-arrow {
  font-size: 12px;
  transition: transform 0.2s;
}

.toggle-arrow.expanded {
  transform: rotate(90deg);
}

.thumbnail-card.reviewed {
  opacity: 0.75;
}

.thumbnail-card.reviewed:hover {
  opacity: 1;
}
</style>
