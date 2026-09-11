<template>
  <!--
    原卷出处（错题重练卷批改）
    背景：错题重练卷是打印出来的白卷，老师批改时只看到空白题面 + OCR 文本，
    想不起这题当初出自哪次作业、原卷长什么样，OCR 题干残缺时更是无从判断。
    两条数据链路，均为只读展示，不写任何数据：
    ① paper 模式（重练批改）：重练卷的 question_ids 指向 questions 表原题记录，
       其 image_url 就是原作业页图，block_coordinates 是题干定位框，
       /api/questions/batch 已随 q.* 一起返回。
    ② image 模式（作业批改）：打印的重练卷常被当作普通作业拍照上传，题目是本次
       新建的行，与原卷无外键关联。此时用项目统一的「同一题」口径
       （src/domain/questionIdentity.js，归一化题干精确匹配，无相似度阈值）
       在当前学生的错题本里找同题旧记录，展示那条记录的原卷页图与定位框。
       匹配不上就不显示，不猜。
    image 模式下若本题是首次出现（错题本无同题旧记录），本卡片不渲染。
  -->
  <div v-if="origin" class="orig-src">
    <div class="orig-src__head">
      <span class="orig-src__title">原卷出处</span>
      <el-tag v-if="origin.fromWrongBook" size="small" type="warning" effect="plain" class="orig-src__tag">来自错题本</el-tag>
      <span v-if="origin.pageLabel" class="orig-src__page">{{ origin.pageLabel }}</span>
      <el-button size="small" link type="primary" class="orig-src__more" @click="openViewer">
        <el-icon><ZoomIn /></el-icon> 放大查看
      </el-button>
    </div>

    <!-- 缩略图：有定位框时直接裁出题干部位（矩形小图）；无定位框时退化为整页缩略 -->
    <div class="orig-src__thumb" :class="{ 'is-page': !origin.crop }" @click="openViewer" title="点击查看原卷">
      <img
        v-if="!failed"
        :src="origin.imageUrl"
        :style="origin.crop ? cropStyle(origin.crop) : null"
        :class="origin.crop ? 'orig-src__img-crop' : 'orig-src__img-page'"
        @load="failed = false"
        @error="failed = true"
        draggable="false"
      />
      <div v-if="failed" class="orig-src__failed">原卷图片不可用（链接可能已失效）</div>
      <div v-else-if="!origin.crop" class="orig-src__nobox">该页无定位框</div>
    </div>

    <el-dialog
      v-model="viewerVisible"
      title="原卷出处"
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
          {{ viewMode === 'stem'
            ? (origin.fromWrongBook ? '按错题本定位框裁出的原卷题干' : '按 OCR 定位框裁出的题干原貌')
            : '原卷整页，蓝框为本题位置' }}
        </span>
        <el-button size="small" link type="primary" @click="openInNewTab">
          <el-icon><Link /></el-icon> 新窗口打开
        </el-button>
      </div>

      <div class="orig-src__stage" :class="viewMode === 'stem' ? 'is-crop' : 'is-scroll'" ref="stageRef">
        <div class="orig-src__canvas">
          <img
            :src="origin.imageUrl"
            class="orig-src__stage-img"
            :style="viewMode === 'stem' ? cropStyle(origin.crop) : { width: '100%' }"
            @load="onStageLoad"
            draggable="false"
          />
          <div v-if="origin.box && viewMode === 'page'" class="orig-src__box" :style="boxStyle"></div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { getQuestionDisplayBox, bboxToPercentStyle } from '../../../utils/questionBbox'
import { normalizeStem } from '../../../domain/questionIdentity'
import { ZoomIn, Link } from '@element-plus/icons-vue'

const props = defineProps({
  question: { type: Object, default: null }
})

const store = useReviewStore()
const q = computed(() => props.question || store.currentReviewQuestion)

// ═══ 来源解析 ═══
// paper 模式：题目行本身就是原题记录，image_url 即原作业页图。
const paperOrigin = computed(() => {
  if (store.source !== 'paper') return null
  const cur = q.value
  if (!cur?.image_url) return null
  return {
    imageUrl: cur.image_url,
    box: getQuestionDisplayBox(cur),
    crop: getQuestionDisplayBox(cur, { pad: 15 }),
    pageLabel: cur.page_number ? `原卷第 ${cur.page_number} 页` : '',
    fromWrongBook: false
  }
})

// image 模式：本次批改新建的题目行 → 用归一化题干在错题本里找同题旧记录。
// 只精确匹配，不猜：匹配不上（首次出现的题）就隐藏卡片。
//
// 展示层专用宽松键：在 normalizeStem 之上再去掉开头的括号来源标签
// （如「（沪教·中考）」「(沪教版七中)」，重练卷重新 OCR 时有无不定）。
// 注意：这是确定性字符串匹配，不是相似度阈值；只服务本卡片提示，
// 不参与 questionIdentity 的错题合并/去重口径，也不写任何数据。
const LEADING_TAG_RE = /^[（(][^（）()]*[)）]/
const displayKey = (raw) => {
  let s = normalizeStem(raw)
  for (;;) {
    const next = s.replace(LEADING_TAG_RE, '')
    if (next === s) return s
    s = next
  }
}

const stemIndex = computed(() => {
  const map = new Map()
  for (const wq of store.wrongQuestions || []) {
    const stem = displayKey(wq.question?.content || wq.content)
    if (!stem) continue
    if (!map.has(stem)) map.set(stem, [])
    map.get(stem).push(wq)
  }
  return map
})

const wrongBookOrigin = computed(() => {
  if (store.source !== 'image') return null
  const cur = q.value
  const stem = displayKey(cur?.content)
  if (!stem) return null
  for (const wq of stemIndex.value.get(stem) || []) {
    // 本次批改刚写入的错题（同一行）不算「原卷」，左侧查看器本来就是它
    if (wq.question_id && wq.question_id === cur.id) continue
    // 同一次作业里的重复出现也不算，原卷就是当前这张图
    const origTaskId = wq.question?.task_id
    if (origTaskId && origTaskId === cur.task_id) continue
    const imageUrl = wq.question?.full_image_url || wq.question?.image_url || wq.question_image_url || ''
    if (!imageUrl) continue
    // 错题本记录的定位框：嵌套 question 的坐标优先，自包含坐标兜底
    const coordSource = {
      text_bbox: wq.question?.text_bbox,
      image_bbox: wq.question?.image_bbox,
      block_coordinates: wq.question?.block_coordinates || wq.block_coordinates
    }
    return {
      imageUrl,
      box: getQuestionDisplayBox(coordSource),
      crop: getQuestionDisplayBox(coordSource, { pad: 15 }),
      pageLabel: wq.question?.page_number ? `原卷第 ${wq.question.page_number} 页` : '',
      fromWrongBook: true
    }
  }
  return null
})

const origin = computed(() => paperOrigin.value || wrongBookOrigin.value)

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
  viewMode.value = origin.value.crop ? 'stem' : 'page'
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
.orig-src {
  background: #fff;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.orig-src__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.orig-src__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--wb-text-tertiary);
  letter-spacing: 0.5px;
}
.orig-src__tag {
  flex-shrink: 0;
}
.orig-src__page {
  font-size: 12px;
  color: var(--wb-text-tertiary);
}
.orig-src__more {
  margin-left: auto;
  font-size: 12px !important;
  height: 24px !important;
  padding: 0 4px !important;
}

/* 缩略图容器：固定高度 + 裁剪；整页退化模式用 object-fit */
.orig-src__thumb {
  position: relative;
  height: 150px;
  overflow: hidden;
  border-radius: var(--wb-radius-xs);
  border: 1px solid var(--wb-border);
  background: #fafbfc;
  cursor: zoom-in;
  line-height: 0;
}
.orig-src__thumb.is-page {
  background: #fff;
}
.orig-src__img-crop {
  display: block;
  max-width: none;
  transform-origin: 0 0;
}
.orig-src__img-page {
  width: 100%;
  height: 150px;
  object-fit: cover;
  object-position: top center;
}
.orig-src__failed {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--wb-text-tertiary);
  background: #fafbfc;
  line-height: 1.5;
}
.orig-src__nobox {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 11px;
  color: var(--wb-text-tertiary);
  background: rgba(255, 255, 255, 0.9);
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1.4;
}

/* ── 放大查看 ── */
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
.orig-src__box {
  position: absolute;
  border: 2px solid var(--wb-primary, #409eff);
  background: rgba(64, 158, 255, 0.12);
  pointer-events: none;
}
</style>
