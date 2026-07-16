<template>
  <div class="ops-panel">
    <!-- 空状态 -->
    <div v-if="!q" class="ops-empty">
      <el-icon size="40"><DocumentChecked /></el-icon>
      <span>请从左侧选择题目</span>
    </div>

    <template v-else>
      <!-- ═══ 顶栏 ═══ -->
      <div class="ops-header">
        <div class="ops-header__left">
          <span class="ops-mode-title">{{ store.reviewConfig.detailTitle }}</span>
          <el-tag :type="typeTagType" size="small" effect="dark" class="ops-type-tag">
            {{ typeLabel }}
          </el-tag>
          <span class="ops-qnum">#{{ store.currentReviewIndex + 1 }}</span>
          <el-tag v-if="difficultyLabel" :type="difficultyTagType" size="small" effect="plain" class="ops-difficulty-badge">
            {{ difficultyLabel }}
          </el-tag>
          <el-tag v-if="q.review_status" :type="reviewStatusTagType" size="small" effect="dark" class="ops-review-badge">
            {{ reviewStatusLabel }}
          </el-tag>
        </div>
        <div class="ops-header__right">
          <span v-if="q.confidence != null" class="ops-confidence"
            :class="{ 'conf-low': q.confidence < store.confidenceThreshold }">
            {{ Math.round(q.confidence * 100) }}%
          </span>
          <el-tag v-if="q.answer_source" size="small"
            :type="q.answer_source === 'blank' ? 'warning' : 'info'" effect="plain">
            {{ q.answer_source === 'blank' ? '未作答' : q.answer_source === 'recognized' ? '识别' : q.answer_source }}
          </el-tag>
          <template v-if="!editing">
            <el-button size="small" type="primary" plain @click="handleEnterEdit">
              <el-icon><EditPen /></el-icon> 编辑
            </el-button>
          </template>
          <template v-else>
            <el-button size="small" @click="handleCancelEdit">
              <el-icon><RefreshLeft /></el-icon> 取消
            </el-button>
            <el-button size="small" type="success" @click="handleSave">
              <el-icon><DocumentChecked /></el-icon> 保存
            </el-button>
          </template>
        </div>
      </div>

      <!-- ═══ 答案对照（紧凑） ═══ -->
      <div class="ops-compare-bar">
        <div class="ops-compare-item">
          <span class="ops-cmp-label">学生</span>
          <span class="ops-cmp-value student-val">
            <MathRender :content="q.student_answer || '—'" autoDetect tag="span" />
          </span>
        </div>
        <div class="ops-cmp-divider"></div>
        <div class="ops-compare-item">
          <span class="ops-cmp-label">
            标准
            <span v-if="editing" style="color:#e6a23c;font-weight:400;"> 编辑</span>
          </span>
          <el-input v-if="editing" v-model="form.answer" size="default" placeholder="标准答案" />
          <span v-else-if="q.answer" class="ops-cmp-value correct-val">
            <MathRender :content="q.answer" autoDetect tag="span" />
          </span>
          <span v-else-if="q.analysis" class="ops-cmp-value correct-val ref-answer-val">
            <MathRender :content="q.analysis" autoDetect tag="span" />
          </span>
          <div v-else class="quick-answer-wrap">
            <div v-if="!quickAnswerEditing" class="ops-cmp-value missing-val" @click="startQuickAnswerEdit">
              — <span class="quick-edit-hint">点击填写</span>
            </div>
            <div v-else class="quick-answer-edit">
              <el-input v-model="quickAnswerText" size="small" placeholder="输入标准答案" @keyup.enter="saveQuickAnswer" ref="quickInputRef" />
              <div class="quick-answer-actions">
                <el-button size="small" type="primary" :loading="quickAnswerSaving" @click="saveQuickAnswer">保存</el-button>
                <el-button size="small" @click="cancelQuickAnswerEdit">取消</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- AI 判定 -->
      <div class="ops-ai-row" v-if="q.is_correct != null || q.review_status">
        <span class="ops-ai-icon" :class="getAiStateClass(q)">{{ getAiStateIcon(q) }}</span>
        <span class="ops-ai-text">{{ getAiStateText(q) }}</span>
        <el-progress v-if="q.confidence != null && getAiState(q) === 'pending'" :percentage="Math.round(q.confidence * 100)"
          :stroke-width="8" :color="q.confidence >= store.confidenceThreshold ? '#67c23a' : '#e6a23c'"
          style="width:100px;margin-left:auto;" />
      </div>

      <!-- ═══ 完整题目内容（始终可见，不折叠） ═══ -->
      <div class="ops-question-body">
        <!-- 题型 & 学科（仅在编辑时显示） -->
        <div v-if="editing" class="ops-q-section">
          <div class="ops-q-label">题型 · 学科</div>
          <div class="ops-type-subject-row">
            <el-select v-model="form.question_type" style="flex:1">
              <el-option label="选择题" value="choice" />
              <el-option label="填空题" value="fill" />
              <el-option label="判断题" value="judge" />
              <el-option label="解答题" value="answer" />
            </el-select>
            <el-select v-model="form.subject" style="flex:1" allow-create filterable placeholder="学科">
              <el-option label="数学" value="数学" />
              <el-option label="物理" value="物理" />
              <el-option label="化学" value="化学" />
              <el-option label="英语" value="英语" />
              <el-option label="语文" value="语文" />
            </el-select>
          </div>
        </div>

        <!-- ═══ 编辑模式：共享编辑表单 ═══ -->
        <div v-if="editing" class="ops-edit-form-wrapper">
          <QuestionEditForm
            v-model:form="form"
            :display-image-url="displayImageUrl"
            :show-crop="true"
            @image-upload="handleImageUpload"
            @image-crop="handleCropFromPaper"
            @image-delete="deleteImage"
            @open-tag-selector="showTagSelector = true"
          />
        </div>

        <!-- ═══ 预览模式：题干 + 配图 + 选项（统一卡片） ═══ -->
        <div v-else class="ops-content-card">
          <div class="ops-q-section" v-if="q.content">
            <div class="ops-q-label">题干</div>
            <div class="ops-q-text"><MathRender :content="q.content" autoDetect /></div>
          </div>
          <div class="ops-q-section ops-image-section" v-if="displayImageUrl">
    <div class="ops-q-label">配图</div>
    <div class="ops-image-wrap">
      <!-- 干净 SVG 源码（几何重建）→ 直接内联渲染 -->
      <div v-if="displayType === 'svg_code'" class="tikz-svg-container"
           v-html="displayImageUrl" @click="openFullscreen"></div>
      <!-- TikZ 代码 → tikzToSvg 转换后内联 SVG -->
      <div v-else-if="displayType === 'tikz_code'" class="tikz-svg-container"
           v-html="renderTikzSvg(displayImageUrl)" @click="openFullscreen"></div>
      <!-- URL → <img> 标签 -->
      <img v-else :src="displayImageUrl" class="ops-image" @click="fullscreenImage = displayImageUrl" />
      <div style="display:flex; gap:6px; margin-top:4px;">
        <template v-if="tikzStatus === 'done'">
          <el-button v-if="!isTikzActive" size="small" type="primary" plain @click="handleUseTikz">
            采用TikZ图
          </el-button>
          <el-button v-else size="small" plain @click="handleUseClean">
            显示原图
          </el-button>
        </template>
        <el-tag v-else-if="tikzStatus === 'pending'" size="small" type="warning" effect="dark">
          几何图重建中...
        </el-tag>
        <el-tag v-else-if="tikzStatus === 'processing'" size="small" type="info" effect="dark">
          几何图重建中...
        </el-tag>
        <template v-else-if="tikzStatus === 'failed'">
          <el-tag size="small" type="danger" effect="dark">重建失败</el-tag>
          <el-button size="small" type="warning" plain :loading="retryGeometryLoading" @click="handleRetryGeometry">
            重新生成
          </el-button>
        </template>
      </div>
    </div>
  </div>
          <div class="ops-q-section" v-if="optionsList.length > 0">
            <div class="ops-q-label">选项</div>
            <div v-for="(opt, idx) in optionsList" :key="idx" class="ops-option-row"
              :class="{ 'option-highlight': opt === q.answer }">
              <span class="ops-opt-letter">{{ String.fromCharCode(65 + idx) }}.</span>
              <span class="ops-opt-text"><MathRender :content="cleanOptPrefix(opt)" autoDetect tag="span" /></span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ 底部操作区（固定） ═══ -->
      <div class="ops-actions">
        <template v-if="!editing">
          <div class="ops-buttons-primary">
            <button class="ops-btn ops-btn-correct"
              :class="{ 'ops-btn-active': q.review_status === 'correct', 'animate': animatingBtn === 'correct' }"
              @click="handleReview('correct')">
              <span class="ops-btn-icon">✓</span>
              <span>{{ store.reviewConfig.buttons.correct }}</span>
            </button>
            <button class="ops-btn ops-btn-wrong"
              :class="{ 'ops-btn-active': q.review_status === 'wrong', 'animate': animatingBtn === 'wrong' }"
              @click="handleReview('wrong')">
              <span class="ops-btn-icon">✗</span>
              <span>{{ store.reviewConfig.buttons.wrong }}</span>
            </button>
            <button v-if="store.reviewConfig.showExclude" class="ops-btn ops-btn-exclude"
              :class="{ 'ops-btn-active': q.review_status === 'exclude', 'animate': animatingBtn === 'exclude' }"
              @click="handleReview('exclude')">
              <span class="ops-btn-icon">⊘</span>
              <span>排除</span>
            </button>
          </div>
          <div class="ops-buttons-secondary">
            <el-button size="default" @click="prevQ" :disabled="store.currentReviewIndex === 0">
              <el-icon><ArrowLeft /></el-icon> 上一题
            </el-button>
            <el-button size="default" type="primary" @click="handleEnterEdit">
              <el-icon><EditPen /></el-icon> 编辑
            </el-button>
            <el-button size="default" @click="nextQ" :disabled="store.currentReviewIndex >= store.allQuestions.length - 1">
              下一题 <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </template>
        <template v-else>
          <div class="ops-buttons-primary">
            <el-button size="large" @click="handleCancelEdit" style="flex:1">
              <el-icon><RefreshLeft /></el-icon> 取消
            </el-button>
            <el-button size="large" type="success" @click="handleSave" style="flex:1">
              <el-icon><DocumentChecked /></el-icon> 保存
            </el-button>
          </div>
        </template>
      </div>
    </template>

    <!-- ═══ 原卷裁剪对话框 ═══ -->
    <el-dialog v-model="cropDialogVisible" title="从原卷截图" width="auto"
      :close-on-click-modal="false" destroy-on-close append-to-body>
      <div class="crop-container" ref="cropContainerRef">
        <img :src="cropImageSource" class="crop-image" ref="cropImageRef"
          @load="cropImageLoaded"
          @error="cropImageError"
          @mousedown="onCropMouseDown" @mousemove="onCropMouseMove" @mouseup="onCropMouseUp"
          @mouseleave="onCropMouseUp" draggable="false" />
        <div v-if="cropSelection" class="crop-selection"
          :style="{
            left: cropSelection.x + 'px', top: cropSelection.y + 'px',
            width: cropSelection.w + 'px', height: cropSelection.h + 'px'
          }"></div>
        <div v-if="cropSizeLabel" class="crop-size-label">{{ cropSizeLabel }}</div>
      </div>
      <div v-if="cropPreviewUrl" class="crop-preview-bar">
        <span class="crop-preview-label">预览</span>
        <img :src="cropPreviewUrl" class="crop-preview-img" />
      </div>
      <template #footer>
        <el-button @click="cropDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!cropPreviewUrl" :loading="cropLoading" @click="confirmCrop">确认裁剪</el-button>
      </template>
    </el-dialog>

    <el-image-viewer v-if="fullscreenImage" :url-list="[fullscreenImage]" @close="fullscreenImage = ''" />
    <el-dialog v-model="showFullscreenSvg" title="几何矢量图" width="480px" :close-on-click-modal="true" @close="fullscreenSvg = ''">
      <div class="tikz-fullscreen-svg" v-html="fullscreenSvg" style="display:flex;justify-content:center;"></div>
    </el-dialog>
    <el-dialog v-model="showTagSelector" title="选择知识点" width="380px">
      <div class="tag-grid">
        <div v-for="tag in allKnowledgeTags" :key="tag" class="tag-option"
          :class="{ 'tag-selected': form.tags.includes(tag) }" @click="toggleTag(tag)">{{ tag }}</div>
      </div>
      <template #footer><el-button @click="showTagSelector = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { updateQuestion, rejudgeQuestion, retryGeometry, clearStudentCaches, uploadImage } from '../../../services/apiService'
import { processExamImage } from '../../../utils/imageProcessor'
import { getGeometryDisplayUrl, getTikzStatus } from '../../../utils/geometryDisplay'
import { tikzToSvg } from '../../../utils/tikzGenerator'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import { DocumentChecked, Delete, Plus, Upload, Picture, EditPen, ArrowLeft, ArrowRight, RefreshLeft, Crop } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'
import QuestionEditForm from './QuestionEditForm.vue'

const store = useReviewStore()
const q = computed(() => store.currentReviewQuestion)

const typeLabel = computed(() => {
  if (!q.value) return ''
  const map = { choice: '选择题', fill: '填空题', answer: '解答题', judge: '判断题' }
  return map[q.value.question_type] || q.value.question_type || '未知题型'
})
const typeTagType = computed(() => {
  const map = { choice: '', fill: 'success', answer: 'warning', judge: 'primary' }
  return map[q.value?.question_type] || 'info'
})
const optionsList = computed(() => q.value?.options || [])

// 难度系数（1-5）显示
const difficultyLabel = computed(() => {
  const d = q.value?.difficulty
  if (d == null) return ''
  const map = { 1: '基础', 2: '简单', 3: '中等', 4: '较难', 5: '难题' }
  return `难度${d}·${map[d] || ''}`
})
const difficultyTagType = computed(() => {
  const map = { 1: 'success', 2: 'success', 3: 'warning', 4: 'danger', 5: 'danger' }
  return map[q.value?.difficulty] || 'info'
})

const reviewStatusLabel = computed(() => {
  if (!q.value?.review_status) return ''
  const map = { correct: '已标记正确', wrong: '已标记错误', exclude: '已排除' }
  return map[q.value.review_status] || ''
})
const reviewStatusTagType = computed(() => {
  const map = { correct: 'success', wrong: 'danger', exclude: 'info' }
  return map[q.value?.review_status] || 'info'
})

//AI状态相关方法（与store保持一致）
const getAiState = (q) => {
  if (!q) return 'processing'

  // 人工已复核 → 以人工结论为最高优先级
  if (q.review_status === 'correct') return 'correct'
  if (q.review_status === 'wrong') return 'wrong'

  // AI 异常：未识别答案 / OCR 失败
  if (q.answer_source === 'blank') return 'exception'

  // 处理中：AI 尚未出任何判定
  if (q.is_correct == null && q.confidence == null) return 'processing'

  // AI 错误：判定学生答案错误
  if (q.is_correct === false) return 'wrong'

  // AI 正确 + 已确认（人工复核 或 置信度达标）
  const manual = !!q.review_status
  // 注意：Pinia 自动解包 ref，store.confidenceThreshold 已是数字，不能加 .value
  const confirmed = manual || (q.confidence != null && q.confidence >= store.confidenceThreshold)
  if (q.is_correct === true && confirmed) return 'correct'

  // 其余 → 待复核（置信度不足 / AI 不确定）
  return 'pending'
}

const getAiStateClass = (q) => {
  const state = getAiState(q)
  const map = {
    correct: 'ai-ok',
    wrong: 'ai-fail',
    pending: 'ai-pending',
    exception: 'ai-exception',
    processing: 'ai-processing'
  }
  return map[state] || 'ai-pending'
}

const getAiStateIcon = (q) => {
  const state = getAiState(q)
  const map = {
    correct: '✓',
    wrong: '✗',
    pending: '!',
    exception: '!',
    processing: '…'
  }
  return map[state] || '!'
}

const getAiStateText = (q) => {
  const state = getAiState(q)
  const map = {
    correct: 'AI 判定正确',
    wrong: 'AI 判定错误',
    pending: '待复核',
    exception: 'AI异常',
    processing: '处理中'
  }
  return map[state] || 'AI判定中'
}

/** 去掉选项文本中已有的字母前缀（如 "A."、"A)"、"A、"），避免显示为 "A.A. 内容" */
const cleanOptPrefix = (text) => {
  if (!text || typeof text !== 'string') return text
  return text.replace(/^[A-Da-d][.、)）\s]?\s*/, '')
}

const displayImageUrl = computed(() => getGeometryDisplayUrl(q.value).url)
const displayType = computed(() => getGeometryDisplayUrl(q.value).type)
const tikzStatus = computed(() => getTikzStatus(q.value))
const isTikzActive = computed(() => q.value?.display_image_type === 'tikz')
const fullscreenImage = ref('')
const fullscreenSvg = ref('')
const showFullscreenSvg = ref(false)
const imageUrl = computed(() => q.value?.geometry_image_url || q.value?.image_url || '')

/** 将 TikZ 代码渲染为 SVG 字符串 */
const renderTikzSvg = (code) => {
  if (!code) return ''
  return tikzToSvg(code) || ''
}

/** 点击 SVG 全屏查看 */
const openFullscreen = () => {
  // svg_code 已是 SVG 源码，直接用；tikz_code 需转换
  const svg = displayType.value === 'svg_code'
    ? displayImageUrl.value
    : renderTikzSvg(displayImageUrl.value)
  if (svg) {
    fullscreenSvg.value = svg
    showFullscreenSvg.value = true
  }
}

const editing = ref(false)
const animatingBtn = ref('')
// 错题拦截弹窗「去编辑」触发：监听 store.pendingEditQuestionId 自动打开编辑面板
const editMode = ref(false)
const expandEditPanel = ref(false)
watch(() => store.pendingEditQuestionId, async (id) => {
  if (id && q.value && q.value.id === id) {
    await nextTick()
    handleEnterEdit()
    store.pendingEditQuestionId = null
  }
})
const quickAnswerEditing = ref(false)
const quickAnswerText = ref('')
const quickAnswerSaving = ref(false)
const quickInputRef = ref(null)
const form = ref({ content: '', options: [], answer: '', analysis: '', tags: [], question_type: 'choice', subject: '' })
const originalData = ref(null)
const localImageUrl = ref('')
const showTagSelector = ref(false)
const allKnowledgeTags = ref(['全等三角形判定', '角的关系推导', '线段等式证明', '平行线的性质', '角平分线定义', '三角形内角和定理', '等式性质', '勾股定理', '相似三角形', '圆的性质', '函数与图像', '概率统计'])

// ═══ 原卷裁剪相关 ═══
const cropDialogVisible = ref(false)
const cropImageSource = ref('')
const cropContainerRef = ref(null)
const cropImageRef = ref(null)
const cropSelection = ref(null)
const cropStart = ref(null)
const cropMaxWidth = ref(800)
const cropSizeLabel = ref('')
const cropPreviewUrl = ref('')
const cropLoading = ref(false)

const handleCropFromPaper = () => {
  const task = store.currentTask
  if (!task?.image_url) {
    ElMessage.warning('当前试卷无原图')
    return
  }
  // 直接用原图 URL 加载显示（<img> 标签支持跨域）
  cropImageSource.value = task.image_url
  cropSelection.value = null
  cropPreviewUrl.value = ''
  cropSizeLabel.value = ''
  cropDialogVisible.value = true
}

const cropImageLoaded = () => {
  // 原图加载完成，可以裁剪
}
const cropImageError = () => {
  console.error('原卷图片加载失败:', cropImageSource.value)
  ElMessage.error('原卷图片加载失败，请检查试卷图片是否存在')
}

const getCropRect = () => {
  const img = cropImageRef.value
  if (!img || !cropSelection.value) return null
  const rect = img.getBoundingClientRect()
  const scaleX = img.naturalWidth / rect.width
  const scaleY = img.naturalHeight / rect.height
  const sel = cropSelection.value
  return { sx: sel.x * scaleX, sy: sel.y * scaleY, sw: sel.w * scaleX, sh: sel.h * scaleY }
}

const onCropMouseDown = (e) => {
  const img = cropImageRef.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  const x = Math.max(0, e.clientX - rect.left)
  const y = Math.max(0, e.clientY - rect.top)
  cropStart.value = { x, y }
  cropSelection.value = { x, y, w: 0, h: 0 }
  cropPreviewUrl.value = ''
}

const onCropMouseMove = (e) => {
  if (!cropStart.value) return
  const img = cropImageRef.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  const curX = Math.min(Math.max(0, e.clientX - rect.left), rect.width)
  const curY = Math.min(Math.max(0, e.clientY - rect.top), rect.height)
  const x = Math.min(cropStart.value.x, curX)
  const y = Math.min(cropStart.value.y, curY)
  const w = Math.abs(curX - cropStart.value.x)
  const h = Math.abs(curY - cropStart.value.y)
  cropSelection.value = { x, y, w, h }
  cropSizeLabel.value = `${Math.round(w)} × ${Math.round(h)}`
}

const onCropMouseUp = () => {
  if (!cropStart.value || !cropSelection.value) return
  cropStart.value = null
  const sel = cropSelection.value
  if (sel.w < 5 || sel.h < 5) {
    cropSelection.value = null
    cropPreviewUrl.value = ''
    cropSizeLabel.value = ''
    return
  }
  // 通过 /api/proxy-image 加载原图（同源，canvas 不跨域）
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(cropImageSource.value)}`
  const loadImg = new Image()
  loadImg.crossOrigin = 'anonymous'
  loadImg.onload = () => {
    const cr = getCropRect()
    if (!cr) return
    const canvas = document.createElement('canvas')
    canvas.width = cr.sw
    canvas.height = cr.sh
    const ctx = canvas.getContext('2d')
    // 先填充白色背景，确保裁剪图在试卷上完美融合
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(loadImg, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, cr.sw, cr.sh)
    cropPreviewUrl.value = canvas.toDataURL('image/png')
  }
  loadImg.onerror = () => {
    console.error('代理加载原图失败')
    ElMessage.warning('裁剪预览生成失败（原图加载异常）')
  }
  loadImg.src = proxyUrl
}

const confirmCrop = async () => {
  if (!cropPreviewUrl.value || !q.value?.id) return
  cropLoading.value = true
  try {
    // 使用 imageProcessor.js 的 processExamImage 进行白底化 + 去脏边 + 去手写 + 增强
    const processedDataUrl = await processExamImage(cropPreviewUrl.value, {
      autoEnhance: true,
      removeHandwriting: true,
      padding: 5
    })

    const blob = await (await fetch(processedDataUrl)).blob()
    const file = new File([blob], 'crop.png', { type: 'image/png' })
    const url = await uploadImage(file, store.currentTask?.student_id || store.currentStudent?.id)
    if (!url) throw new Error('上传返回无 URL')
    localImageUrl.value = url
    displayImageUrl.value = url
    if (q.value) q.value.geometry_image_url = url
    cropDialogVisible.value = false
    ElMessage.success('裁剪图片已上传并处理')
  } catch (err) {
    console.error('裁剪上传失败:', err)
    ElMessage.error('裁剪图片上传失败')
  } finally {
    cropLoading.value = false
  }
}

watch(q, (newQ) => {
  if (newQ) {
    form.value = {
      content: newQ.content || '',
      options: JSON.parse(JSON.stringify(newQ.options || [])),
      answer: newQ.answer || '',
      analysis: newQ.analysis || '',
      tags: JSON.parse(JSON.stringify(newQ.ai_tags || newQ.knowledge_points || [])),
      question_type: newQ.question_type || 'choice',
      subject: newQ.subject || ''
    }
    localImageUrl.value = newQ.geometry_image_url || newQ.image_url || ''
    originalData.value = JSON.parse(JSON.stringify(form.value))
    originalData.value.geometryImageUrl = localImageUrl.value
  } else {
    form.value = { content: '', options: [], answer: '', analysis: '', tags: [] }
    localImageUrl.value = ''
  }
  editing.value = false
  quickAnswerEditing.value = false
  quickAnswerText.value = ''
}, { immediate: true })

const startQuickAnswerEdit = () => {
  quickAnswerText.value = q.value?.answer || ''
  quickAnswerEditing.value = true
  nextTick(() => {
    quickInputRef.value?.focus()
  })
}
const cancelQuickAnswerEdit = () => {
  quickAnswerEditing.value = false
  quickAnswerText.value = ''
}
const saveQuickAnswer = async () => {
  const question = q.value
  if (!question?.id) return
  const text = quickAnswerText.value?.trim()
  if (!text) {
    ElMessage.warning('请输入标准答案')
    return
  }
  quickAnswerSaving.value = true
  try {
    await updateQuestion(question.id, { answer: text })
    question.answer = text
    quickAnswerEditing.value = false
    quickAnswerText.value = ''
    ElMessage.success('标准答案已保存')
  } catch (err) {
    console.error('保存标准答案失败:', err)
    ElMessage.error('保存失败，请重试')
  } finally {
    quickAnswerSaving.value = false
  }
}

const handleEnterEdit = () => {
  originalData.value = JSON.parse(JSON.stringify(form.value))
  originalData.value.geometryImageUrl = localImageUrl.value
  editing.value = true
}
const handleCancelEdit = () => {
  if (originalData.value) {
    form.value = JSON.parse(JSON.stringify(originalData.value))
    localImageUrl.value = originalData.value.geometryImageUrl || ''
  }
  editing.value = false
}
const addOption = () => { form.value.options.push('') }
const removeOption = (idx) => { form.value.options.splice(idx, 1) }
const removeTag = (tag) => { form.value.tags = form.value.tags.filter(t => t !== tag) }
const toggleTag = (tag) => {
  const idx = form.value.tags.indexOf(tag)
  if (idx === -1) form.value.tags.push(tag)
  else form.value.tags.splice(idx, 1)
}

const handleSave = async () => {
  const question = q.value
  if (!question?.id) return
  const loading = ElLoading.service({ lock: true, text: '保存中...', background: 'rgba(0,0,0,0.7)' })
  try {
    await updateQuestion(question.id, {
      content: form.value.content, options: form.value.options, answer: form.value.answer,
      analysis: form.value.analysis, student_answer: question.student_answer,
      geometry_image_url: localImageUrl.value || question.geometry_image_url, ai_tags: form.value.tags,
      question_type: form.value.question_type, subject: form.value.subject
    })
    Object.assign(question, { content: form.value.content, options: form.value.options, answer: form.value.answer, analysis: form.value.analysis, ai_tags: form.value.tags, geometry_image_url: localImageUrl.value, question_type: form.value.question_type, subject: form.value.subject })
    // 保存后自动重批改
    try {
      const rejudgeResult = await rejudgeQuestion(question.id)
      if (rejudgeResult.success) {
        question.is_correct = rejudgeResult.is_correct
      }
    } catch (rejudgeErr) {
      console.warn('重批改失败（不影响保存）:', rejudgeErr.message)
    }
    const studentId = store.currentStudent?.id
    if (studentId) clearStudentCaches(studentId)
    editing.value = false
    loading.close()
    ElMessage.success('修改已保存')
  } catch (err) {
    loading.close()
    console.error('保存失败:', err)
    ElMessage.error('保存失败，请重试')
  }
}

const handleReview = (result) => {
  const question = q.value
  if (!question) return
  const btn = store.reviewConfig.buttons
  const resultText = {
    correct: `已标记为${btn.correct}`,
    wrong: `已标记为${btn.wrong}`,
    exclude: '已排除本题'
  }
  // 标记"错误"需完整性检查（错误题要入错题本）
  if (result === 'wrong') {
    const blocked = store.reviewQuestion(question.id, result)
    if (blocked?.blocked) {
      ElMessageBox.confirm(
        `题目不完整，无法加入错题本：<br><span style="color:#e6a23c">${blocked.issues.map(i => '• ' + i).join('<br>')}</span><br><br>是否现在编辑以补充缺失信息？`,
        '题目不完整',
        { confirmButtonText: '去编辑', cancelButtonText: '取消', type: 'warning', dangerouslyUseHTMLString: true }
      ).then(() => {
        handleEnterEdit()
      }).catch(() => {})
      return
    }
  } else {
    store.reviewQuestion(question.id, result)
  }
  // 按钮动画反馈
  animatingBtn.value = result
  setTimeout(() => { animatingBtn.value = '' }, 400)
  ElMessage.success(resultText[result])
}
const nextQ = () => { store.nextQuestion() }
const prevQ = () => { store.prevQuestion() }

const handleImageUpload = async (file) => {
  const question = q.value
  if (!question?.id) { ElMessage.error('题目ID不存在'); return false }
  const reader = new FileReader()
  reader.onload = (e) => { localImageUrl.value = e.target?.result || '' }
  reader.readAsDataURL(file)
  try {
    const formData = new FormData()
    formData.append('files', file)
    const response = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!response.ok) throw new Error('上传失败')
    const result = await response.json()
    displayImageUrl.value = localImageUrl.value = result.url
    question.geometry_image_url = result.url
    ElMessage.success('配图上传成功')
  } catch (err) {
    console.error('图片上传失败:', err)
    ElMessage.error('图片上传失败')
  }
  return false
}
const deleteImage = () => {
  localImageUrl.value = displayImageUrl.value = ''
  if (q.value) q.value.geometry_image_url = ''
  ElMessage.success('配图已删除')
}

const handleUseTikz = async () => {
  const question = q.value
  if (!question?.id) return
  try {
    await updateQuestion(question.id, { display_image_type: 'tikz' })
    question.display_image_type = 'tikz'
    ElMessage.success('已切换为TikZ图显示')
  } catch (err) {
    console.error('切换TikZ图失败:', err)
    ElMessage.error('切换失败，请重试')
  }
}

const handleUseClean = async () => {
  const question = q.value
  if (!question?.id) return
  try {
    await updateQuestion(question.id, { display_image_type: 'clean' })
    question.display_image_type = 'clean'
    ElMessage.success('已切换为净化图显示')
  } catch (err) {
    console.error('切换净化图失败:', err)
    ElMessage.error('切换失败，请重试')
  }
}

const retryGeometryLoading = ref(false)

const handleRetryGeometry = async () => {
  const question = q.value
  if (!question?.id) return
  retryGeometryLoading.value = true
  try {
    const result = await retryGeometry(question.id)
    if (result.success) {
      question.tikz_status = 'pending'
      ElMessage.success('已重新提交几何图重建任务')
    } else {
      ElMessage.error(result.error || '重新提交失败')
    }
  } catch (err) {
    console.error('几何图重试失败:', err)
    ElMessage.error('重新提交失败，请稍后重试')
  } finally {
    retryGeometryLoading.value = false
  }
}
</script>

<style scoped>
/* ── 容器 ── */
.ops-panel {
  width: 520px;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  border-left: 1px solid #e4e7ed;
  flex-shrink: 0;
  overflow: hidden;
}
.ops-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #c0c4cc;
  font-size: 14px;
}

/* ── 顶栏 ── */
.ops-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.ops-header__left, .ops-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ops-type-tag { font-weight: 600; }
.ops-qnum {
  font-size: 16px;
  font-weight: 700;
  color: #303133;
}
.ops-confidence {
  font-size: 12px;
  font-weight: 600;
  color: #67c23a;
  background: #f0f9eb;
  padding: 2px 10px;
  border-radius: 12px;
}
.ops-confidence.conf-low { color: #e6a23c; background: #fdf6ec; }

/* ── 答案对照条 ── */
.ops-compare-bar {
  display: flex;
  align-items: stretch;
  background: #fff;
  margin: 8px 10px 0;
  padding: 10px 14px;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  flex-shrink: 0;
}
.ops-compare-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ops-cmp-label {
  font-size: 11px;
  font-weight: 600;
  color: #909399;
  letter-spacing: 0.5px;
}
.ops-cmp-value {
  font-size: 16px;
  font-weight: 600;
  padding: 5px 8px;
  border-radius: 4px;
  line-height: 1.4;
  word-break: break-all;
}
.student-val { background: #f5f7fa; color: #303133; }
.correct-val { color: #67c23a; }
.ref-answer-val {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  word-break: normal;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
}
.ops-cmp-divider {
  width: 1px;
  background: #e4e7ed;
  margin: 0 12px;
  flex-shrink: 0;
}

/* ── 快速填写标准答案 ── */
.quick-answer-wrap { min-height: 32px; display: flex; align-items: center; }
.missing-val {
  color: #c0c4cc; cursor: pointer; transition: color 0.15s;
  display: inline-flex; align-items: center; gap: 6px; font-size: 18px;
}
.missing-val:hover { color: #409eff; }
.quick-edit-hint { font-size: 12px; font-weight: 400; color: #409eff; }
.quick-answer-edit {
  display: flex; flex-direction: column; gap: 6px;
}
.quick-answer-actions { display: flex; gap: 4px; }

/* ── AI 判定 ── */
.ops-ai-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  margin: 0 10px;
  padding: 8px 14px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}

/* ── 顶栏模式标题 ── */
.ops-mode-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-right: 4px;
}
.ops-ai-icon {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.ai-ok { background: #67c23a; }
.ai-fail { background: #f56c6c; }
.ai-pending { background: #e6a23c; }
.ai-exception { background: #fa8c16; }
.ai-processing { background: #9254de; }
.ops-ai-text { font-size: 13px; color: #606266; }

/* ═══ 完整题目内容区（可滚动） ═══ */
.ops-question-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ops-q-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ops-q-label {
  font-size: 11px;
  font-weight: 600;
  color: #909399;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.ops-q-text {
  font-size: 15px;
  line-height: 1.7;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 选项 */
.ops-option-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
}
.ops-opt-letter {
  font-weight: 700;
  color: #909399;
  min-width: 20px;
  font-size: 14px;
  flex-shrink: 0;
  padding-top: 2px;
}
.ops-opt-text {
  font-size: 15px;
  color: #303133;
  line-height: 1.6;
}
.option-highlight .ops-opt-letter,
.option-highlight .ops-opt-text { color: #67c23a; font-weight: 600; }

/* 配图 */
.ops-image-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ops-image {
  max-width: 100%;
  max-height: 240px;
  border-radius: 6px;
  cursor: zoom-in;
  border: 1px solid #ebeef5;
  object-fit: contain;
}
.tikz-svg-container {
  max-width: 100%;
  max-height: 280px;
  border-radius: 6px;
  cursor: zoom-in;
  border: 1px solid #ebeef5;
  background: #fff;
  padding: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.tikz-svg-container :deep(svg) {
  max-width: 100%;
  height: auto;
}
.ops-no-image {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #c0c4cc;
  font-size: 13px;
  padding: 12px 0;
}
.ops-image-actions { display: flex; gap: 6px; }

/* 标签 */
.ops-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* ═══ 底部操作区（固定） ═══ */
.ops-actions {
  flex-shrink: 0;
  padding: 12px 16px 16px;
  border-top: 1px solid #e4e7ed;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ops-buttons-primary {
  display: flex;
  gap: 8px;
}
.ops-buttons-secondary {
  display: flex;
  gap: 8px;
}
.ops-buttons-secondary .el-button { flex: 1; }

.ops-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border-radius: 8px;
  border: 2px solid;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  background: #fff;
}
.ops-btn-icon { font-size: 18px; }

.ops-btn-correct { color: #67c23a; border-color: #b7eb8f; background: #f0f9eb; }
.ops-btn-correct:hover { background: #e1f3d8; border-color: #95d475; }
.ops-btn-wrong { color: #f56c6c; border-color: #fbc4c4; background: #fef0f0; }
.ops-btn-wrong:hover { background: #fde2e2; border-color: #f89898; }
.ops-btn-exclude { color: #909399; border-color: #dcdfe6; background: #f4f4f5; }
.ops-btn-exclude:hover { background: #e9e9eb; border-color: #c8c9cc; }

/* 复审状态标记 */
.ops-review-badge { margin-left: 4px; }

/* 复审按钮激活状态 */
.ops-btn-active {
  transform: scale(1.05);
  box-shadow: 0 0 0 3px rgba(64,158,255,0.3);
  border-color: #409eff !important;
}
.ops-btn-active.ops-btn-correct { border-color: #67c23a !important; box-shadow: 0 0 0 3px rgba(103,194,58,0.3); }
.ops-btn-active.ops-btn-wrong { border-color: #f56c6c !important; box-shadow: 0 0 0 3px rgba(245,108,108,0.3); }
.ops-btn-active.ops-btn-exclude { border-color: #909399 !important; box-shadow: 0 0 0 3px rgba(144,147,153,0.3); }

/* 按钮点击脉冲动画 */
.ops-btn.animate {
  animation: btn-pulse 0.4s ease;
}
@keyframes btn-pulse {
  0% { transform: scale(1); }
  25% { transform: scale(1.08); }
  50% { transform: scale(0.96); }
  70% { transform: scale(1.03); }
  100% { transform: scale(1); }
}

.tag-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.tag-option {
  padding: 6px 14px; border: 1px solid #dcdfe6; border-radius: 16px;
  font-size: 13px; color: #606266; cursor: pointer; transition: all 0.2s; user-select: none;
}
.tag-option:hover { border-color: #409eff; color: #409eff; }
.tag-selected { background: #ecf5ff; border-color: #409eff; color: #409eff; font-weight: 500; }

/* ═══ 题干+配图+选项 统一卡片 ═══ */
.ops-content-card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ops-image-section {
  border-top: 1px dashed #ebeef5;
  border-bottom: 1px dashed #ebeef5;
  padding: 10px 0;
  margin: 2px 0;
}

/* ═══ 题型 · 学科 ═══ */
.ops-type-subject-row {
  display: flex;
  gap: 8px;
}

/* ═══ 原卷裁剪 ═══ */
.crop-container {
  position: relative;
  display: inline-block;
  cursor: crosshair;
  user-select: none;
  line-height: 0;
}
.crop-image {
  max-width: 780px;
  max-height: 70vh;
  display: block;
}
.crop-selection {
  position: absolute;
  border: 2px dashed #409eff;
  background: rgba(64, 158, 255, 0.12);
  pointer-events: none;
  z-index: 10;
}
.crop-size-label {
  position: absolute;
  bottom: -26px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  color: #409eff;
  font-weight: 600;
  background: rgba(255,255,255,0.9);
  padding: 2px 10px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 11;
}
.crop-preview-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  padding-top: 12px;
  border-top: 1px solid #e4e7ed;
}
.crop-preview-label {
  font-size: 13px;
  font-weight: 600;
  color: #909399;
  flex-shrink: 0;
}
.crop-preview-img {
  max-height: 100px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  object-fit: contain;
}
</style>
