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
          <el-tag :type="typeTagType" size="small" effect="dark" class="ops-type-tag">
            {{ typeLabel }}
          </el-tag>
          <span class="ops-qnum">#{{ store.currentReviewIndex + 1 }}</span>
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
          <span v-else class="ops-cmp-value correct-val">
            <MathRender :content="q.answer || '—'" autoDetect tag="span" />
          </span>
        </div>
      </div>

      <!-- AI 判定 -->
      <div class="ops-ai-row" v-if="q.is_correct != null">
        <span class="ops-ai-icon" :class="q.is_correct ? 'ai-ok' : 'ai-fail'">{{ q.is_correct ? '✓' : '✗' }}</span>
        <span class="ops-ai-text">{{ q.is_correct ? 'AI 判定正确' : 'AI 判定错误' }}</span>
        <el-progress v-if="q.confidence != null" :percentage="Math.round(q.confidence * 100)"
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
              <img :src="displayImageUrl" class="ops-image" @click="fullscreenImage = displayImageUrl" />
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
            <button class="ops-btn ops-btn-correct" @click="handleReview('correct')">
              <span class="ops-btn-icon">✓</span>
              <span>正确</span>
            </button>
            <button class="ops-btn ops-btn-wrong" @click="handleReview('wrong')">
              <span class="ops-btn-icon">✗</span>
              <span>错误</span>
            </button>
            <button class="ops-btn ops-btn-exclude" @click="handleReview('exclude')">
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
import { ref, computed, watch } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { updateQuestion, rejudgeQuestion, clearStudentCaches, uploadImage } from '../../../services/apiService'
import { processExamImage } from '../../../utils/imageProcessor'
import { ElMessage, ElLoading } from 'element-plus'
import { DocumentChecked, Delete, Plus, Upload, Picture, EditPen, ArrowLeft, ArrowRight, RefreshLeft, Crop } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'
import QuestionEditForm from './QuestionEditForm.vue'

const store = useReviewStore()
const q = computed(() => store.currentReviewQuestion)

const typeLabel = computed(() => {
  if (!q.value) return ''
  const map = { choice: '选择题', fill: '填空题', answer: '解答题' }
  return map[q.value.question_type] || q.value.question_type || '未知题型'
})
const typeTagType = computed(() => {
  const map = { choice: '', fill: 'success', answer: 'warning' }
  return map[q.value?.question_type] || 'info'
})
const optionsList = computed(() => q.value?.options || [])

/** 去掉选项文本中已有的字母前缀（如 "A."、"A)"、"A、"），避免显示为 "A.A. 内容" */
const cleanOptPrefix = (text) => {
  if (!text || typeof text !== 'string') return text
  return text.replace(/^[A-Da-d][.、)）\s]?\s*/, '')
}

const displayImageUrl = ref('')
const fullscreenImage = ref('')
watch(() => q.value?.geometry_image_url || q.value?.image_url, (url) => { displayImageUrl.value = url || '' }, { immediate: true })
const imageUrl = computed(() => q.value?.geometry_image_url || q.value?.image_url || '')

const editing = ref(false)
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
    // 使用 imageProcessor.js 的 processExamImage 进行白底化 + 去脏边 + 增强
    const processedDataUrl = await processExamImage(cropPreviewUrl.value, {
      autoEnhance: true,
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
}, { immediate: true })

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
  const resultText = { correct: '已标记为正确', wrong: '已标记为错误', exclude: '已排除本题' }
  store.reviewQuestion(question.id, result)
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
.ops-cmp-divider {
  width: 1px;
  background: #e4e7ed;
  margin: 0 12px;
  flex-shrink: 0;
}

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
.ops-ai-icon {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.ai-ok { background: #67c23a; }
.ai-fail { background: #f56c6c; }
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
