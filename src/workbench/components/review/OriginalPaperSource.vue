<template>
  <!--
    原卷出处（题干行内小入口）

    背景：错题重练卷是老师从错题本组的卷，题目取自更早的老卷子。老师批改时中间栏是
    重练答卷（白卷 + 学生手写），只看到 OCR 出来的题干文本，想不起这题当初出自哪次作业、
    原卷长什么样；OCR 题干残缺时更是无从判断。

    形态（2026-09-11 收敛）：不再是一张带缩略图/定位框的大卡片 —— 老师只需要在**题干旁边
    有一个小入口**，点开能看到这道题在原卷上的题干区域原图。故此处收敛为一个行内小眼睛
    （图标 + 「原卷」字样，挂在「题干」标签右侧），点击弹出查看器。

    展示口径（只读，不写任何数据）：只有「题目所属的原卷 ≠ 当前正在批的这份卷」才有意义。
      · 重练批改（paper）：题目行来自更早的原作业 task → 展示
      · 作业批改（image）：题目行就属于当前这份卷，中间栏展示的就是它本身 → 不展示
    页图取三级兜底：task_images[page_number-1]（tasks.images 是 JSONB 数组，顺序即 1-based
    页号）→ task_image_url（该卷首页）→ image_url（题目行自带，通常为空，别单独依赖它）。
  -->
  <span v-if="origin" class="orig-link">
    <el-tooltip content="查看这道题在原卷上的题干区域" placement="top" :show-after="200">
      <button type="button" class="orig-link__btn" @click="openViewer">
        <el-icon :size="12"><View /></el-icon>
        <span>原卷</span>
      </button>
    </el-tooltip>

    <el-dialog
      v-model="viewerVisible"
      :title="origin.pageLabel ? `原卷出处 · ${origin.pageLabel}` : '原卷出处'"
      width="60%"
      top="6vh"
      append-to-body
      destroy-on-close
    >
      <div class="orig-src__toolbar">
        <el-radio-group v-model="viewMode" size="small" @change="onModeChange">
          <el-radio-button value="stem" :disabled="!origin.crop">题干区域</el-radio-button>
          <el-radio-button value="page">整页</el-radio-button>
        </el-radio-group>
        <span class="orig-src__hint">
          {{ viewMode === 'stem' ? '这道题在原卷上的题干原貌' : '原卷整页，蓝框为本题位置' }}
        </span>
        <el-button size="small" link type="primary" @click="openInNewTab">
          <el-icon><Link /></el-icon> 新窗口打开
        </el-button>
      </div>

      <div class="orig-src__stage" :class="viewMode === 'stem' ? 'is-crop' : 'is-scroll'" ref="stageRef">
        <div class="orig-src__canvas">
          <img
            v-if="!failed"
            :src="origin.imageUrl"
            class="orig-src__stage-img"
            :style="viewMode === 'stem' ? cropStyle(origin.crop) : { width: '100%' }"
            @load="onStageLoad"
            @error="failed = true"
            draggable="false"
          />
          <div v-else class="orig-src__failed">原卷图片不可用（链接可能已失效）</div>
          <div v-if="origin.box && viewMode === 'page' && !failed" class="orig-src__box" :style="boxStyle"></div>
        </div>
      </div>
    </el-dialog>
  </span>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { getQuestionDisplayBox, bboxToPercentStyle } from '../../../utils/questionBbox'
import { View, Link } from '@element-plus/icons-vue'

const props = defineProps({
  question: { type: Object, default: null }
})

const store = useReviewStore()
const q = computed(() => props.question || store.currentReviewQuestion)

// ═══ 来源解析 ═══
// 题干定位框取自题目行（block_coordinates / text_bbox / image_bbox，见 utils/questionBbox.js）。
const origin = computed(() => {
  const cur = q.value
  if (!cur) return null

  // 只有"题目所属的原卷 ≠ 当前正在批的这份卷"时才展示。
  // image 模式下题目行就属于当前这份卷，中间栏展示的就是它本身，再挂入口纯属重复。
  const currentTaskId = store.currentTask?.id
  const fromOtherPaper = Boolean(cur.task_id && currentTaskId && cur.task_id !== currentTaskId)
  if (store.source !== 'paper' && !fromOtherPaper) return null

  const images = Array.isArray(cur.task_images) ? cur.task_images : []
  const pageIdx = Number(cur.page_number || 0) - 1
  const pageEntry = pageIdx >= 0 ? images[pageIdx] : null
  const pageImageUrl = typeof pageEntry === 'string' ? pageEntry : (pageEntry?.image_url || '')
  const imageUrl = pageImageUrl || cur.task_image_url || cur.image_url || ''
  if (!imageUrl) return null

  return {
    imageUrl,
    box: getQuestionDisplayBox(cur),
    crop: getQuestionDisplayBox(cur, { pad: 15 }),
    pageLabel: cur.page_number ? `原卷第 ${cur.page_number} 页` : ''
  }
})

const failed = ref(false)

// 归一化 0-1000 → CSS 百分比：width: 100000/w % 让 bbox 正好铺满容器宽度，
// translate 的百分比按图片自身尺寸算，正好等价于 -(x/1000)*图片宽。
const cropStyle = (b) => {
  if (!b) return {}
  return {
    width: `${100000 / b.width}%`,
    transform: `translate(-${b.x / 10}%, -${b.y / 10}%)`
  }
}
const boxStyle = computed(() => bboxToPercentStyle(origin.value?.box) || {})

const viewerVisible = ref(false)
const viewMode = ref('stem')
const stageRef = ref(null)

const openViewer = () => {
  if (!origin.value?.imageUrl) return
  // 默认给「题干区域」——老师点这个小眼睛就是为了看题干那一块
  viewMode.value = origin.value.crop ? 'stem' : 'page'
  failed.value = false
  viewerVisible.value = true
}

const onModeChange = () => {
  if (viewMode.value === 'page') {
    nextTick(scrollToBox)
  }
}

// 整页模式：滚到定位框附近，省得老师在大图里找
const scrollToBox = () => {
  const stage = stageRef.value
  if (!stage || !origin.value?.box) return
  stage.scrollTop = Math.max(0, (origin.value.box.y / 1000) * stage.scrollHeight - 24)
}

const onStageLoad = () => {
  failed.value = false
  if (viewMode.value === 'page') nextTick(scrollToBox)
}

const openInNewTab = () => {
  if (origin.value?.imageUrl) window.open(origin.value.imageUrl, '_blank', 'noopener')
}

// 切题重置：避免沿用上一题的加载失败标记
watch(() => [q.value?.id, origin.value?.imageUrl], () => { failed.value = false })
</script>

<style scoped>
/* 行内小入口：挂在「题干」标签右侧，不占版面、不喧宾夺主 */
.orig-link {
  display: inline-flex;
  align-items: center;
}
.orig-link__btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs, 4px);
  background: #fff;
  color: var(--wb-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.orig-link__btn:hover {
  color: var(--wb-primary);
  border-color: var(--wb-primary);
  background: var(--wb-primary-mist, rgba(99, 102, 241, 0.06));
}
.orig-link__btn:focus-visible {
  outline: 2px solid var(--wb-primary);
  outline-offset: 1px;
}

/* ── 查看器 ── */
.orig-src__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.orig-src__hint {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  margin-right: auto;
}
.orig-src__stage {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  background: #fafbfc;
  height: 60vh;
}
.orig-src__stage.is-crop {
  overflow: hidden;
}
.orig-src__stage.is-scroll {
  overflow: auto;
}
.orig-src__canvas {
  position: relative;
  width: 100%;
  line-height: 0;
}
.orig-src__stage-img {
  display: block;
  max-width: none;
  transform-origin: 0 0;
}
.orig-src__failed {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60vh;
  font-size: 13px;
  color: var(--wb-text-tertiary);
  line-height: 1.6;
}
.orig-src__box {
  position: absolute;
  border: 2px solid var(--wb-primary, #409eff);
  background: rgba(64, 158, 255, 0.12);
  pointer-events: none;
}
</style>
