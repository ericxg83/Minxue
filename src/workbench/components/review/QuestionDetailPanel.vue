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
          <span class="ops-cmp-label">学生答案</span>
          <span class="ops-cmp-value student-val">
            <MathRender :content="q.student_answer || '—'" autoDetect tag="span" />
          </span>
        </div>
        <div class="ops-cmp-divider"></div>
        <div class="ops-compare-item">
          <div class="ops-cmp-label-row">
            <span class="ops-cmp-label">
              参考答案
              <span v-if="editing" style="color:var(--wb-warning);font-weight:400;"> 编辑</span>
            </span>
            <!-- 截图/拍照 → 后端视觉模型识别 → 弹窗预览 → 一键填入。
                 老师手敲 \frac、\sqrt 等 KaTeX 命令极易出错，这个按钮直接解决。 -->
            <el-upload v-if="editing"
              :show-file-list="false"
              :before-upload="handleRecognizeAnswerBeforeUpload"
              accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif">
              <el-button type="default" :loading="recognizeLoading" class="ops-ans-recognize-btn">
                <el-icon><Camera /></el-icon> 📷 截图识别答案
              </el-button>
            </el-upload>
          </div>
          <!-- AI 解析自检未通过时标红 + 给老师"答案可能错"的红色横幅。
               数据来自 worker.js 调 aiParseSelfCheck 写入 questions.ai_self_check_issues。
               移动端 Grading\index.jsx:538 已对齐相同 UX，避免老师改题无据可依。 -->
          <span v-if="q.ai_self_check_passed === false"
                class="ops-self-check-tag"
                :title="`AI 解析可能不准确：${(q.ai_self_check_issues || []).join(' / ')}`">
            ⚠ AI 不可信
          </span>
          <div v-if="editing">
            <el-input v-model="form.answer" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="标准答案（支持从 AI 解答页面粘贴特殊字符 ± √ 等）" />
          </div>
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

      <!-- ═══ 解析（折叠，默认收起；与移动端 ExamReview 对齐，2026-09-01）═══
           渲染 q.analysis（AI 批改时生成的解题过程 + 标准答案推导），
           老师展开看 AI 是怎么判的，怀疑判错时有据可依。 -->
      <div v-if="q.analysis || true" class="ops-analysis">
        <button
          type="button"
          class="ops-analysis__toggle"
          :aria-expanded="showAnalysis"
          @click="showAnalysis = !showAnalysis"
        >
          <el-icon :size="14"><component :is="showAnalysis ? 'ArrowDown' : 'ArrowRight'" /></el-icon>
          <span>{{ showAnalysis ? '收起解析' : '查看解析' }}</span>
        </button>
        <div v-if="showAnalysis" class="ops-analysis__body">
          <MathRender
            v-if="q.analysis"
            :content="q.analysis"
            autoDetect
          />
          <span v-else class="ops-analysis__empty">暂无解析</span>
        </div>
      </div>

      <!-- AI 判定 -->
      <div class="ops-ai-row" v-if="q.is_correct != null || q.review_status || getAiState(q) === 'exception'">
        <span class="ops-ai-icon" :class="getAiStateClass(q)">{{ getAiStateIcon(q) }}</span>
        <span class="ops-ai-text">{{ getAiStateText(q) }}</span>
        <!-- 判不出的原因：让老师知道为什么这题要自己定，而不是以为系统坏了 -->
        <span v-if="unjudgedReason" class="ops-ai-reason">{{ unjudgedReason }}</span>
        <el-progress v-if="q.confidence != null && getAiState(q) === 'pending'" :percentage="Math.round(q.confidence * 100)"
          :stroke-width="8" :color="q.confidence >= store.confidenceThreshold ? 'var(--wb-success)' : 'var(--wb-warning)'"
          style="width:100px;margin-left:auto;" />
      </div>

      <!-- 图题风险提示：客观题 + 配图（geometry/chart）时 AI 视觉推理不擅长，
           软提示老师核对参考答案。wrong/correct 状态都展示，避免把"AI 错误"信以为真。 -->
      <el-alert
        v-if="aiAnswerRiskReason"
        :title="aiAnswerRiskReason"
        type="warning"
        show-icon
        :closable="false"
        class="ops-image-risk"
      />

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
          <el-button v-if="!showOriginal && q.geometry_image_url" size="small" plain @click="showOriginal = true">
            显示原图
          </el-button>
          <el-button v-else-if="showOriginal" size="small" type="primary" plain @click="showOriginal = false">
            采用TikZ图
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
        <el-tag v-else-if="tikzStatus === 'none'" size="small" type="info" effect="plain"
                :title="q.asset_last_error || '视觉模型判定此图无法重建，已回退到裁剪原图'">
          使用原图
        </el-tag>
        <el-tag v-if="geometryConsistency && !geometryConsistency.skipped" size="small" :type="geometryConsistency.pass ? 'success' : 'danger'" effect="dark">
          几何自洽{{ geometryConsistency.pass ? '通过' : '存疑' }}
        </el-tag>
        <el-tag v-else-if="geometryConsistency && geometryConsistency.skipped" size="small" type="info" effect="plain">
          几何无需校验
        </el-tag>
      </div>
    </div>
  </div>
          <div class="ops-q-section" v-if="optionsList.length > 0">
            <div class="ops-q-label">选项</div>
            <div v-for="(opt, idx) in optionsList" :key="idx" class="ops-option-row"
              :class="{ 'option-highlight': opt === q.answer }">
              <span class="ops-opt-letter">{{ String.fromCharCode(65 + idx) }}.</span>
              <span class="ops-opt-text"><MathRender :content="opt" autoDetect tag="span" /></span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ 底部操作区（固定） ═══ -->
      <div class="ops-actions">
        <template v-if="!editing">
          <!-- [P5] 几何自洽性审计 → 复核结论提示 -->
          <el-alert
            v-if="geometryReviewHint"
            :title="geometryReviewHint.text"
            :type="geometryReviewHint.level"
            show-icon
            :closable="false"
            class="ops-geom-hint"
          />
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
              <span class="ops-btn-icon">✕</span>
              <span>删除</span>
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

    <!-- 答案 OCR 识别弹窗：识别结果预览，确认后一键填入答案框 -->
    <AnswerRecognizeDialog v-model="recognizeDialogVisible"
      :result="recognizeResult"
      :preview-url="recognizePreviewUrl"
      @apply="handleApplyRecognized" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { updateQuestion, rejudgeQuestion, retryGeometry, clearStudentCaches, uploadImage, getQuestionAssets } from '../../../services/apiService'
import { recognizeAnswer } from '../../../api/answerOCR'
import { processExamImage } from '../../../utils/imageProcessor'
import { getGeometryDisplayUrl, getTikzStatus } from '../../../utils/geometryDisplay'
import { tikzToSvg } from '../../../utils/tikzGenerator'
import { normalizeOptions } from '../../../utils/optionText'
import { getReviewStateLabel, getUnjudgedReasonText, getAiAnswerRiskText } from '../../../utils/reviewDecision'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import { DocumentChecked, Delete, Plus, Upload, Picture, EditPen, ArrowLeft, ArrowRight, ArrowDown, RefreshLeft, Crop, Camera } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'
import QuestionEditForm from './QuestionEditForm.vue'
import AnswerRecognizeDialog from './AnswerRecognizeDialog.vue'

const store = useReviewStore()
const q = computed(() => store.currentReviewQuestion)

// 题型中文映射表（question_type 字段合法值）
const TYPE_MAP = { choice: '选择题', fill: '填空题', answer: '解答题', judge: '判断题' }

// 归一题型：把"choice/fill/judge/answer"这种枚举字符串或非法值按题目内容兜底
//   有 options → choice；含"对/错/√/×"或判断题标记 → judge；含"____"空格 → fill；其它 → answer
const normalizeType = (q) => {
  const t = String(q?.question_type || '').trim().toLowerCase()
  if (TYPE_MAP[t]) return t
  const isEnumString = t.includes('/') || t.includes('|') || t.includes(',')
  if (isEnumString || !t) {
    if (Array.isArray(q?.options) && q.options.length > 0) return 'choice'
    const content = String(q?.content || '')
    if (/_{2,}|（\s*）|\(\s*\)|□/.test(content)) return 'fill'
    if (/(对|错|正确|错误|√|×|✓|✗)/.test(content) && content.length < 60) return 'judge'
    return 'answer'
  }
  return t
}

const typeLabel = computed(() => {
  if (!q.value) return ''
  return TYPE_MAP[normalizeType(q.value)] || '未知题型'
})
const typeTagType = computed(() => {
  const map = { choice: '', fill: 'success', answer: 'warning', judge: 'primary' }
  return map[normalizeType(q.value)] || 'info'
})
const optionsList = computed(() => normalizeOptions(q.value?.options || []))

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
  const map = { correct: '已标记正确', wrong: '已标记错误', wrong_no_book: '错误，本次不入册', exclude: '已删除' }
  return map[q.value.review_status] || ''
})
const reviewStatusTagType = computed(() => {
  const map = { correct: 'success', wrong: 'danger', wrong_no_book: 'warning', exclude: 'info' }
  return map[q.value?.review_status] || 'info'
})

// AI 状态判定不在本组件重复实现：直接用 store.getAiState（内部即 src/utils/reviewDecision.js）。
// 此前本地抄了一份同样的分支，两处一改一漏就会出现"左栏与详情说法不一致"。
const getAiState = (q) => store.getAiState(q)

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

// 文案同源：exception 桶按 answer_source 细分为「未作答」/「AI未判定」
const getAiStateText = (q) => getReviewStateLabel(q, store.confidenceThreshold)
// 「AI未判定」的原因（缺参考答案 / 参考答案无法核对）。纯展示，不参与判定。
const unjudgedReason = computed(() => getUnjudgedReasonText(q.value, store.confidenceThreshold))

// 「AI 答案存疑」原因 —— AI 已给出正误，但参考本身可能不可靠（图题视觉推理）。
// 即使在 wrong 状态也展示，避免老师把"AI 错误"信以为真。纯展示，不参与判定。
const aiAnswerRiskReason = computed(() => getAiAnswerRiskText(q.value))

// 用户手动覆盖：默认 false → 显示 TikZ（AI 重画的 clean_geometry_svg）；
// true → 显示原图（geometry_image_url 裁剪原图）。这是临时 UI 状态，
// 不写回 DB；切换题目自动重置。
const showOriginal = ref(false)
watch(() => q.value?.id, () => { showOriginal.value = false })

const displayImageUrl = computed(() => {
  if (showOriginal.value && q.value?.geometry_image_url) {
    return q.value.geometry_image_url
  }
  return getGeometryDisplayUrl(q.value).url
})
const displayType = computed(() => {
  if (showOriginal.value && q.value?.geometry_image_url) {
    return 'raw'
  }
  return getGeometryDisplayUrl(q.value).type
})
const tikzStatus = computed(() => getTikzStatus(q.value))
const fullscreenImage = ref('')
const fullscreenSvg = ref('')
const showFullscreenSvg = ref(false)

// [P4 影子模式] 几何自洽性审计字段展示：拉取该题的几何资产生成记录，读取 tikz_json.consistency
const geometryConsistency = ref(null)
watch(
  () => q.value?.id,
  async (id) => {
    geometryConsistency.value = null
    if (!id) return
    try {
      const assets = await getQuestionAssets(id, 'geometry_image')
      const hit = (assets || []).find((a) => a && a.tikz_json && a.tikz_json.consistency)
      geometryConsistency.value = hit ? hit.tikz_json.consistency : null
    } catch (e) {
      geometryConsistency.value = null
    }
  },
  { immediate: true }
)

// [P5] 把几何自洽性审计信号接到「复核结论提示」：在复核操作区给出结论性提示，提示人工核对而非自动拦截
const geometryReviewHint = computed(() => {
  const c = geometryConsistency.value
  if (!c || c.skipped) return null
  // 求解后仍不自洽：图与题设存在不可调和的矛盾，强提示
  if (!c.pass) {
    return { level: 'error', text: '图与题设不符，建议人工核对图形及标注' }
  }
  // 原图不自洽但可解出自洽解：原图标注可能有误，求解已校正
  if (c.rawPass === false) {
    return { level: 'warning', text: '原图与题设存在偏差，求解已校正，建议核对图形标注' }
  }
  // 退化几何（共线/重合等）
  if (c.degenerate) {
    return { level: 'warning', text: '检测到退化几何（共线/重合等），建议人工核对' }
  }
  return null
})

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
// 解析展开（默认收起；与移动端 ExamReview 同款）
const showAnalysis = ref(false)
const form = ref({ content: '', options: [], answer: '', analysis: '', tags: [], question_type: 'choice', subject: '' })
const originalData = ref(null)
const localImageUrl = ref('')
const showTagSelector = ref(false)
const allKnowledgeTags = ref(['全等三角形判定', '角的关系推导', '线段等式证明', '平行线的性质', '角平分线定义', '三角形内角和定理', '等式性质', '勾股定理', '相似三角形', '圆的性质', '函数与图像', '概率统计'])

// 答案 OCR 识别：弹窗状态 + 识别中锁 + 原图预览 + 识别结果
const recognizeDialogVisible = ref(false)
const recognizeLoading = ref(false)
const recognizeResult = ref(null)
const recognizePreviewUrl = ref('')
let recognizePreviewUrlToRevoke = ''

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
  if (!task) {
    ElMessage.warning('当前试卷无原图')
    return
  }
  // 多页试卷：按当前题目的 page_number 找到对应页的原图；
  // 单页/找不到页图时兜底用首页或 task.image_url。
  const question = store.currentReviewQuestion
  const pageNum = question?.page_number
  const pages = store.currentPaperPages
  let pageImage = ''
  if (pageNum != null && pages.length > 0) {
    const page = pages.find(p => p.page_number === pageNum)
    pageImage = page?.image_url || ''
  }
  if (!pageImage) pageImage = pages[0]?.image_url || task.image_url || ''
  if (!pageImage) {
    ElMessage.warning('当前试卷无原图')
    return
  }
  cropImageSource.value = pageImage
  cropSelection.value = null
  cropPreviewUrl.value = ''
  cropSizeLabel.value = ''
  cropDialogVisible.value = true
}

const parseBbox = (b) => {
  if (!b) return null
  if (typeof b === 'string') { try { b = JSON.parse(b) } catch { return null } }
  if (!b || typeof b !== 'object') return null
  const x = b.x ?? b.x_min ?? b.left
  const y = b.y ?? b.y_min ?? b.top
  const width = b.width ?? b.w ?? (b.x_max != null && x != null ? b.x_max - x : 0)
  const height = b.height ?? b.h ?? (b.y_max != null && y != null ? b.y_max - y : 0)
  if ([x, y, width, height].some(v => typeof v !== 'number' || Number.isNaN(v))) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

const unionBbox = (a, b) => {
  if (!a) return b
  if (!b) return a
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
    height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y)
  }
}

const generateCropPreview = () => {
  const sel = cropSelection.value
  if (!sel || sel.w < 5 || sel.h < 5) return
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

const cropImageLoaded = () => {
  // 按题目 bbox（text_bbox ∪ image_bbox）自动预选裁剪框，省去老师手动框
  const img = cropImageRef.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const box = unionBbox(parseBbox(q.value?.text_bbox), parseBbox(q.value?.image_bbox))
  if (!box) return
  // 归一化 0-1000 坐标 → 显示像素
  let x = (box.x / 1000) * rect.width
  let y = (box.y / 1000) * rect.height
  let w = (box.width / 1000) * rect.width
  let h = (box.height / 1000) * rect.height
  // 外扩一圈 padding（8px），让裁出来的图比 bbox 略大（保住题号/解题过程）
  const PAD = 8
  x = Math.max(0, x - PAD)
  y = Math.max(0, y - PAD)
  w = Math.min(rect.width - x, w + 2 * PAD)
  h = Math.min(rect.height - y, h + 2 * PAD)
  if (w < 20 || h < 20) return // bbox 太小或缺数据则不强预选
  cropSelection.value = { x, y, w, h }
  cropSizeLabel.value = `${Math.round(w)} × ${Math.round(h)}`
  generateCropPreview()
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
  generateCropPreview()
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
      options: normalizeOptions(JSON.parse(JSON.stringify(newQ.options || []))),
      answer: newQ.answer || '',
      analysis: newQ.analysis || '',
      tags: JSON.parse(JSON.stringify(newQ.ai_tags || newQ.knowledge_points || [])),
      question_type: newQ.question_type || 'choice',
      subject: newQ.subject || ''
    }
    // 配图仅取题干裁剪图；image_url 是整页试卷图，不能作为配图展示
    localImageUrl.value = newQ.geometry_image_url || ''
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

// el-upload before-upload：拦截文件 → 调识别接口 → 弹预览弹窗
const handleRecognizeAnswerBeforeUpload = async (file) => {
  if (!q.value?.id) {
    ElMessage.warning('当前题目未选中')
    return false
  }
  if (recognizeLoading.value) return false

  if (recognizePreviewUrlToRevoke) {
    URL.revokeObjectURL(recognizePreviewUrlToRevoke)
    recognizePreviewUrlToRevoke = ''
  }
  // 直接走原生 URL.createObjectURL 给预览；HEIC 由后端 fixFileIfNeeded 转码，
  // 前端 heicPreview 依赖 heic-decode 包会拖垮批改中心 bundle（vite 解析失败）。
  recognizePreviewUrl.value = URL.createObjectURL(file)
  recognizePreviewUrlToRevoke = recognizePreviewUrl.value

  recognizeLoading.value = true
  try {
    recognizeResult.value = await recognizeAnswer(q.value.id, file)
    recognizeDialogVisible.value = true
  } catch (err) {
    ElMessage.error(`识别失败：${err.message || err}`)
  } finally {
    recognizeLoading.value = false
  }
  return false  // 阻止 el-upload 自行上传
}

const handleApplyRecognized = (answer) => {
  form.value = { ...form.value, answer }
  ElMessage.success('已填入答案，点「保存」即可入库')
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

const handleReview = async (result) => {
  const question = q.value
  if (!question) return
  const btn = store.reviewConfig.buttons
  const resultText = {
    correct: `已标记为${btn.correct}`,
    wrong: `已标记为${btn.wrong}`,
    exclude: '已删除本题'
  }
  // 标记"错误"需完整性检查（错误题要入错题本）
  if (result === 'wrong') {
    const blocked = store.reviewQuestion(question.id, result)
    if (blocked?.blocked) {
      ElMessageBox.confirm(
        `题目不完整，无法加入错题本：<br><span style="color:var(--wb-warning)">${blocked.issues.map(i => '• ' + i).join('<br>')}</span><br><br>是否现在编辑以补充缺失信息？`,
        '题目不完整',
        { confirmButtonText: '去编辑', cancelButtonText: '取消', type: 'warning', dangerouslyUseHTMLString: true }
      ).then(() => {
        handleEnterEdit()
      }).catch(() => {})
      return
    }
  } else {
    // wrong→correct 时弹"误判类型"下拉，便于事后统计 AI 误判归因（2026-09-01 上线问题 6）
    // 老师可跳过；跳过则 misjudgeType 留空，admin 统计归为 'unset'。
    if (result === 'correct' && question.is_correct === false) {
      try {
        const { value } = await ElMessageBox({
          title: '这是什么类型的误判？',
          message: 'AI 把这题判错了。请选择原因（帮助我们改进判题规则）：',
          showInput: true,
          inputOptions: [
            { value: 'equivalent_form', label: '等价形式（如 x²、分数顺序、约分）' },
            { value: 'parse_error', label: 'AI 提取学生答案错误' },
            { value: 'typo', label: '学生笔误/小计算错误' },
            { value: 'wrong_rule', label: '判题规则本身有误' },
            { value: 'other', label: '其他' }
          ],
          inputPlaceholder: '请选择',
          showCancelButton: true,
          confirmButtonText: '确定',
          cancelButtonText: '跳过',
          inputValidator: (val) => !!val || '请选择一项'
        })
        store.reviewQuestion(question.id, result, { misjudgeType: value })
      } catch {
        // 老师跳过，照常标 correct
        store.reviewQuestion(question.id, result)
      }
    } else {
      store.reviewQuestion(question.id, result)
    }
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
  background: var(--wb-bg);
  border-left: 1px solid var(--wb-border);
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
  color: var(--wb-text-tertiary);
  font-size: 14px;
}

/* ── 顶栏 ── */
.ops-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid var(--wb-border);
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
  color: var(--wb-text);
}
.ops-confidence {
  font-size: 12px;
  font-weight: 600;
  color: var(--wb-success);
  background: var(--wb-success-soft);
  padding: 2px 10px;
  border-radius: var(--wb-radius-md);
}
.ops-confidence.conf-low { color: var(--wb-warning); background: var(--wb-warning-soft); }

/* AI 自检未通过红色标签（题 14 案：answer 写 √5，分析算 11/5） */
.ops-self-check-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: var(--fs-10);
  font-weight: 600;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  cursor: help;
}

/* ── 答案对照条 ── */
.ops-compare-bar {
  display: flex;
  align-items: stretch;
  background: #fff;
  margin: 8px 10px 0;
  padding: 10px 14px;
  border-radius: var(--wb-radius-xs);
  box-shadow: var(--wb-shadow-sm);
  flex: 0 1 auto;
  min-height: 0;
  max-height: 38vh;
}
.ops-compare-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  min-height: 0;
}
.ops-cmp-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--wb-text-tertiary);
  letter-spacing: 0.5px;
}
.ops-cmp-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ops-ans-recognize-btn {
  font-size: 12px !important;
  padding: 5px 12px !important;
  height: 30px !important;
}

.ops-cmp-value {
  display: block;
  font-size: 16px;
  font-weight: 600;
  padding: 5px 8px;
  border-radius: var(--wb-radius-xs);
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: anywhere;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 30vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.ops-cmp-value::-webkit-scrollbar { width: 8px; }
.ops-cmp-value::-webkit-scrollbar-thumb {
  background: #B6C2D2;
  border-radius: var(--wb-radius-xs);
}
.ops-cmp-value::-webkit-scrollbar-thumb:hover { background: #8E9DB2; }
.student-val { background: var(--wb-bg); color: var(--wb-text); }
.correct-val { color: var(--wb-success); }
.ref-answer-val {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  word-break: normal;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.ops-cmp-divider {
  width: 1px;
  background: var(--wb-border);
  margin: 0 12px;
  flex-shrink: 0;
}

/* ── 快速填写标准答案 ── */
.quick-answer-wrap { min-height: 32px; display: flex; align-items: center; }
.missing-val {
  color: var(--wb-text-tertiary); cursor: pointer; transition: color 0.15s;
  display: inline-flex; align-items: center; gap: 6px; font-size: 18px;
}
.missing-val:hover { color: var(--wb-primary); }
.quick-edit-hint { font-size: 12px; font-weight: 400; color: var(--wb-primary); }
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
  border-bottom: 1px solid var(--wb-bg-hover);
  flex-shrink: 0;
}

/* ── 解析（折叠式，与移动端 ExamReview 对齐）── */
.ops-analysis {
  background: #fff;
  margin: 0 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-bg-hover);
  flex-shrink: 0;
}
.ops-analysis__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 0;
  padding: 4px 0;
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--wb-motion-fast) var(--wb-motion-ease);
}
.ops-analysis__toggle:hover { color: var(--wb-primary); }
.ops-analysis__toggle:focus-visible {
  outline: 2px solid var(--wb-primary);
  outline-offset: 2px;
  border-radius: var(--wb-radius-sm);
}
.ops-analysis__body {
  margin-top: 6px;
  padding: 10px 12px;
  background: var(--wb-bg-hover);
  border-radius: var(--wb-radius-sm);
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  line-height: 1.6;
  /* 长解析限高+滚动，避免详情面板被撑得很长，老师 ctrl+F 时容易跳过其他题 */
  max-height: 280px;
  overflow-y: auto;
}
.ops-analysis__empty {
  color: var(--wb-text-tertiary);
  font-style: italic;
}

/* ── 顶栏模式标题 ── */
.ops-mode-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wb-text);
  margin-right: 4px;
}
.ops-ai-icon {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.ai-ok { background: var(--wb-success); }
.ai-fail { background: var(--wb-danger); }
.ai-pending { background: var(--wb-warning); }
.ai-exception { background: var(--wb-accent); }
.ai-processing { background: var(--wb-processing); }
.ops-ai-text { font-size: 13px; color: var(--wb-text-secondary); }
.ops-ai-reason { font-size: 12px; color: var(--wb-warning); }

/* 图题风险提示：客观题 + 几何/图表配图时，软提示老师核对参考答案 */
.ops-image-risk {
  flex-shrink: 0;
  margin: 8px 10px 0;
  padding: 6px 10px;
}
.ops-image-risk :deep(.el-alert__title) {
  font-size: 12px;
  font-weight: 500;
  color: var(--wb-warning);
}

/* ═══ 完整题目内容区（可滚动） ═══ */
.ops-question-body {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 120px;
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
  color: var(--wb-text-tertiary);
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.ops-q-text {
  font-size: 15px;
  line-height: 1.7;
  color: var(--wb-text);
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
  color: var(--wb-text-tertiary);
  min-width: 20px;
  font-size: 14px;
  flex-shrink: 0;
  padding-top: 2px;
}
.ops-opt-text {
  font-size: 15px;
  color: var(--wb-text);
  line-height: 1.6;
}
.option-highlight .ops-opt-letter,
.option-highlight .ops-opt-text { color: var(--wb-success); font-weight: 600; }

/* 配图 */
.ops-image-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ops-image {
  max-width: 100%;
  max-height: 240px;
  border-radius: var(--wb-radius-xs);
  cursor: zoom-in;
  border: 1px solid var(--wb-border);
  object-fit: contain;
}
.tikz-svg-container {
  max-width: 100%;
  max-height: 280px;
  border-radius: var(--wb-radius-xs);
  cursor: zoom-in;
  border: 1px solid var(--wb-border);
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
  color: var(--wb-text-tertiary);
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
  border-top: 1px solid var(--wb-border);
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ops-geom-hint { margin: 0; }
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
  border-radius: var(--wb-radius-sm);
  border: 2px solid;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  background: #fff;
}
.ops-btn-icon { font-size: 18px; }

.ops-btn-correct { color: var(--wb-success); border-color: var(--wb-success-soft); background: var(--wb-success-soft); }
.ops-btn-correct:hover { background: var(--wb-success-soft); border-color: var(--wb-success); }
.ops-btn-wrong { color: var(--wb-danger); border-color: var(--wb-danger-soft); background: var(--wb-danger-soft); }
.ops-btn-wrong:hover { background: var(--wb-danger-soft); border-color: var(--wb-danger); }
.ops-btn-exclude { color: var(--wb-text-tertiary); border-color: var(--wb-border); background: var(--wb-bg-hover); }
.ops-btn-exclude:hover { background: var(--wb-bg-mist); border-color: var(--wb-border); }

/* 复审状态标记 */
.ops-review-badge { margin-left: 4px; }

/* 复审按钮激活状态 */
.ops-btn-active {
  transform: scale(1.05);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.3);
  border-color: var(--wb-primary) !important;
}
.ops-btn-active.ops-btn-correct { border-color: var(--wb-success) !important; box-shadow: 0 0 0 3px rgba(22,163,74,0.3); }
.ops-btn-active.ops-btn-wrong { border-color: var(--wb-danger) !important; box-shadow: 0 0 0 3px rgba(220,38,38,0.3); }
.ops-btn-active.ops-btn-exclude { border-color: var(--wb-text-tertiary) !important; box-shadow: 0 0 0 3px rgba(148,163,184,0.3); }

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
  padding: 6px 14px; border: 1px solid var(--wb-border); border-radius: var(--wb-radius-lg);
  font-size: 13px; color: var(--wb-text-secondary); cursor: pointer; transition: all 0.2s; user-select: none;
}
.tag-option:hover { border-color: var(--wb-primary); color: var(--wb-primary); }
.tag-selected { background: var(--wb-primary-mist); border-color: var(--wb-primary); color: var(--wb-primary); font-weight: 500; }

/* ═══ 题干+配图+选项 统一卡片 ═══ */
.ops-content-card {
  background: #fff;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ops-image-section {
  border-top: 1px dashed var(--wb-border);
  border-bottom: 1px dashed var(--wb-border);
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
  border: 2px dashed var(--wb-primary);
  background: rgba(99, 102, 241, 0.12);
  pointer-events: none;
  z-index: 10;
}
.crop-size-label {
  position: absolute;
  bottom: -26px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  color: var(--wb-primary);
  font-weight: 600;
  background: rgba(255,255,255,0.9);
  padding: 2px 10px;
  border-radius: var(--wb-radius-xs);
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
  border-top: 1px solid var(--wb-border);
}
.crop-preview-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--wb-text-tertiary);
  flex-shrink: 0;
}
.crop-preview-img {
  max-height: 100px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  object-fit: contain;
}
</style>
