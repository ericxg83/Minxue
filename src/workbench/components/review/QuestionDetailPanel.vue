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
          <el-button v-if="!editing" size="small" type="primary" plain @click="handleEnterEdit">
            <el-icon><EditPen /></el-icon> 编辑
          </el-button>
          <el-tag v-else size="small" type="warning">编辑中</el-tag>
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
        <!-- 题干 -->
        <div class="ops-q-section" v-if="q.content || (editing && form.content)">
          <div class="ops-q-label">题干</div>
          <el-input v-if="editing" v-model="form.content" type="textarea" :rows="4" placeholder="请输入题目内容" />
          <div v-else class="ops-q-text">
            <MathRender :content="q.content" autoDetect />
          </div>
        </div>

        <!-- 选项 -->
        <div class="ops-q-section" v-if="optionsList.length > 0">
          <div class="ops-q-label">选项</div>
          <div v-for="(opt, idx) in editing ? form.options : optionsList" :key="idx"
            class="ops-option-row"
            :class="{ 'option-highlight': !editing && opt === q.answer }">
            <span class="ops-opt-letter">{{ String.fromCharCode(65 + idx) }}.</span>
            <el-input v-if="editing" v-model="form.options[idx]" size="default"
              :placeholder="'选项 ' + String.fromCharCode(65 + idx)" />
            <span v-else class="ops-opt-text">
              <MathRender :content="cleanOptPrefix(opt)" autoDetect tag="span" />
            </span>
            <el-button v-if="editing" text size="small" type="danger" @click="removeOption(idx)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
          <el-button v-if="editing" text size="default" type="primary" @click="addOption">
            <el-icon><Plus /></el-icon> 添加选项
          </el-button>
        </div>

        <!-- AI 解析（仅在编辑时展开） -->
        <div class="ops-q-section" v-if="editing">
          <div class="ops-q-label">AI 解析</div>
          <el-input v-model="form.analysis" type="textarea" :rows="3" placeholder="题目解析" />
        </div>

        <!-- 知识点标签（仅在编辑时显示） -->
        <div class="ops-q-section" v-if="editing">
          <div class="ops-q-label">知识点标签</div>
          <div class="ops-tags">
            <el-tag v-for="tag in form.tags" :key="tag" size="default" closable @close="removeTag(tag)" round>{{ tag }}</el-tag>
            <el-button text size="default" type="primary" @click="showTagSelector = true">
              <el-icon><Plus /></el-icon> 添加
            </el-button>
          </div>
        </div>

        <!-- 配图（始终显示，有图才展示） -->
        <div class="ops-q-section" v-if="displayImageUrl || editing">
          <div class="ops-q-label">配图</div>
          <div class="ops-image-wrap">
            <img v-if="displayImageUrl" :src="displayImageUrl" class="ops-image" @click="fullscreenImage = displayImageUrl" />
            <div v-else class="ops-no-image">
              <el-icon :size="24"><Picture /></el-icon>
              <span>暂无配图</span>
            </div>
            <div v-if="editing" class="ops-image-actions">
              <el-upload :show-file-list="false" :before-upload="handleImageUpload"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp">
                <el-button size="small" type="primary"><el-icon><Upload /></el-icon>{{ displayImageUrl ? '替换' : '上传' }}</el-button>
              </el-upload>
              <el-button v-if="displayImageUrl" size="small" type="danger" @click="deleteImage">
                <el-icon><Delete /></el-icon> 删除
              </el-button>
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
import { updateQuestion, clearStudentCaches } from '../../../services/apiService'
import { ElMessage, ElLoading } from 'element-plus'
import { DocumentChecked, Delete, Plus, Upload, Picture, EditPen, ArrowLeft, ArrowRight, RefreshLeft } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'

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
const form = ref({ content: '', options: [], answer: '', analysis: '', tags: [] })
const originalData = ref(null)
const localImageUrl = ref('')
const showTagSelector = ref(false)
const allKnowledgeTags = ref(['全等三角形判定', '角的关系推导', '线段等式证明', '平行线的性质', '角平分线定义', '三角形内角和定理', '等式性质', '勾股定理', '相似三角形', '圆的性质', '函数与图像', '概率统计'])

watch(q, (newQ) => {
  if (newQ) {
    form.value = {
      content: newQ.content || '',
      options: JSON.parse(JSON.stringify(newQ.options || [])),
      answer: newQ.answer || '',
      analysis: newQ.analysis || '',
      tags: JSON.parse(JSON.stringify(newQ.ai_tags || newQ.knowledge_points || []))
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
      geometry_image_url: localImageUrl.value || question.geometry_image_url, ai_tags: form.value.tags
    })
    Object.assign(question, { content: form.value.content, options: form.value.options, answer: form.value.answer, analysis: form.value.analysis, ai_tags: form.value.tags, geometry_image_url: localImageUrl.value })
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
</style>
