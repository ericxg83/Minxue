<template>
  <el-dialog
    :model-value="modelValue"
    title="重新识别结果预览"
    width="560px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:modelValue', v)"
    @opened="initPicked"
  >
    <div class="qr-preview">
      <!-- 定位错位告警：识别出的题干与本题对不上，说明框选区域很可能偏到了相邻题目。
           必须挡在最前面 —— 若这一步没拦住，老师会把**别的题的选项**补进这道题，
           比缺选项更糟（会按错误的选项批改）。 -->
      <el-alert
        v-if="stemMismatch"
        type="error"
        show-icon
        :closable="false"
        title="识别结果和这道题对不上"
        description="可能框选位置偏了，框到了相邻的题目。请取消后重新框选，把这道题的题干和选项一起框进来。"
      />

      <div v-if="previewUrl" class="qr-thumb-wrap">
        <img :src="previewUrl" class="qr-thumb" alt="裁剪区域预览" />
      </div>

      <!-- 题干 -->
      <div class="qr-section" v-if="result?.content">
        <label class="qr-head">
          <el-checkbox v-model="picked.content" />
          <span class="qr-label">题干</span>
          <el-tag v-if="!isEmptyCurrent('content')" size="small" type="warning" effect="plain">
            已有内容，勾选后将覆盖
          </el-tag>
        </label>
        <div class="qr-text"><MathRender :content="result.content" autoDetect tag="div" /></div>
      </div>

      <!-- 选项 -->
      <div class="qr-section" v-if="result?.options?.length">
        <label class="qr-head">
          <el-checkbox v-model="picked.options" />
          <span class="qr-label">选项（{{ result.options.length }} 项）</span>
          <el-tag v-if="!isEmptyCurrent('options')" size="small" type="warning" effect="plain">
            已有内容，勾选后将覆盖
          </el-tag>
        </label>
        <div class="qr-options">
          <div v-for="(opt, idx) in result.options" :key="idx" class="qr-option-row">
            <span class="qr-opt-letter">{{ String.fromCharCode(65 + idx) }}.</span>
            <span class="qr-opt-text"><MathRender :content="opt" autoDetect tag="span" /></span>
          </div>
        </div>
        <div v-if="!isEmptyCurrent('options')" class="qr-hint">
          当前题目已有 {{ currentOptions.length }} 个选项，勾选将整组替换为上面这组。
        </div>
      </div>

      <!-- 原图/模型都没给出选项：明确告诉老师，别以为界面坏了 -->
      <el-alert
        v-else
        type="warning"
        show-icon
        :closable="false"
        title="本次没有识别到选项"
        description="可能裁剪区域没框到选项行，请重新框选（把选项一起框进来）再试。"
      />

      <!-- 答案 -->
      <div class="qr-section" v-if="result?.answer">
        <label class="qr-head">
          <el-checkbox v-model="picked.answer" />
          <span class="qr-label">参考答案</span>
          <el-tag v-if="!isEmptyCurrent('answer')" size="small" type="warning" effect="plain">
            已有内容，勾选后将覆盖
          </el-tag>
        </label>
        <div class="qr-text"><MathRender :content="result.answer" autoDetect tag="div" /></div>
        <div class="qr-hint">原图没印答案时由模型推断得出，请核对后再采用。</div>
      </div>

      <!-- 解析 -->
      <div class="qr-section" v-if="result?.analysis">
        <label class="qr-head">
          <el-checkbox v-model="picked.analysis" />
          <span class="qr-label">解析</span>
        </label>
        <div class="qr-text qr-text--muted"><MathRender :content="result.analysis" autoDetect tag="div" /></div>
      </div>

      <!-- 题型被模型改写时提示 -->
      <div v-if="typeChanged" class="qr-hint">
        模型判断这是「{{ typeLabel(result.question_type) }}」，当前题目是「{{ typeLabel(current?.question_type) }}」。
        采用「选项」时会自动把题型设为选择题；其他情况请在编辑面板里改。
      </div>
    </div>

    <template #footer>
      <el-button @click="onClose">取消</el-button>
      <el-button type="primary" :disabled="!anyPicked" @click="onApply">
        应用选中项
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import MathRender from '../MathRender.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  result: { type: Object, default: () => null },
  previewUrl: { type: String, default: '' },
  // 当前题目已有值（用于判断"是否覆盖"与默认勾选）
  current: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['update:modelValue', 'apply'])

const picked = ref({ content: false, options: false, answer: false, analysis: false })

const isEmpty = (v) => {
  if (v == null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

const currentOptions = computed(() => (Array.isArray(props.current?.options) ? props.current.options : []))
const isEmptyCurrent = (field) => {
  if (field === 'options') return currentOptions.value.length === 0
  return isEmpty(props.current?.[field])
}

const anyPicked = computed(() =>
  !!(picked.value.content || picked.value.options || picked.value.answer || picked.value.analysis)
)

const TYPE_LABEL = { choice: '选择题', fill: '填空题', answer: '解答题', judge: '判断题' }
const typeLabel = (t) => TYPE_LABEL[t] || t || '未知'
const typeChanged = computed(() =>
  !!props.result?.question_type &&
  !!props.current?.question_type &&
  props.result.question_type !== props.current.question_type
)

// 题干一致性：与后端 backfill-choice-options.mjs 的闸门口径保持一致
// （去题号前缀、去空白标点、NFKC、小写；互相包含或前 14 字相同即视为同题）。
// 原卷定位框在部分题目上会错位到邻题，识别回来的题干就是别的题 —— 必须让老师看见。
const normalizeStem = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/^\s*\d+\s*[.、．)）]\s*/, '')
  .replace(/[\s，,。.、；;：:（）()【】\[\]「」“”"'’‘]/g, '')
  .toLowerCase()

const stemMismatch = computed(() => {
  const cur = normalizeStem(props.current?.content)
  const rec = normalizeStem(props.result?.content)
  if (!cur || !rec) return false
  if (cur === rec) return false
  if (cur.includes(rec) || rec.includes(cur)) return false
  const n = Math.min(cur.length, rec.length, 14)
  return n > 0 && cur.slice(0, n) !== rec.slice(0, n)
})

// 默认策略：题目里**空着的字段**默认勾选（就是要补它），已有内容的默认不勾选（避免把对的改坏）。
// 题干对不上时一律不预勾 —— 此时结果不可信，不该替老师做选择。
const computeDefaults = () => {
  const r = props.result || {}
  if (stemMismatch.value) return { content: false, options: false, answer: false, analysis: false }
  return {
    content: !!r.content && isEmptyCurrent('content'),
    options: Array.isArray(r.options) && r.options.length > 0 && isEmptyCurrent('options'),
    answer: !!r.answer && isEmptyCurrent('answer'),
    // 解析只作参考，默认不写入（避免覆盖老师已经手工整理过的解析）
    analysis: false
  }
}

const initPicked = () => { picked.value = computeDefaults() }

// 兼容「弹窗已打开时 result 才异步到位」的情况
watch(() => props.result, () => { if (props.modelValue) initPicked() })

const onApply = () => {
  if (!anyPicked.value) return
  const r = props.result || {}
  const payload = {}
  if (picked.value.content && r.content) payload.content = r.content
  if (picked.value.options && Array.isArray(r.options) && r.options.length) payload.options = r.options
  if (picked.value.answer && r.answer) payload.answer = r.answer
  if (picked.value.analysis && r.analysis) payload.analysis = r.analysis
  emit('apply', payload)
  emit('update:modelValue', false)
}

const onClose = () => { emit('update:modelValue', false) }
</script>

<style scoped>
.qr-preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 60vh;
  overflow-y: auto;
}

.qr-thumb-wrap {
  display: flex;
  justify-content: center;
  background: var(--wb-bg-soft, #f7f8fa);
  border-radius: 6px;
  padding: 8px;
}

.qr-thumb {
  max-width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: 4px;
}

.qr-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qr-head {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.qr-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--wb-text-secondary, #606266);
}

.qr-text {
  padding: 10px 12px;
  border: 1px solid var(--wb-border, #e4e7ed);
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
}

.qr-text--muted {
  background: #fafafa;
  font-size: 13px;
  color: var(--wb-text-secondary, #606266);
}

.qr-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--wb-border, #e4e7ed);
  border-radius: 6px;
  background: #fff;
}

.qr-option-row {
  display: flex;
  gap: 8px;
  font-size: 14px;
  line-height: 1.7;
}

.qr-opt-letter {
  font-weight: 700;
  color: var(--wb-text-tertiary, #909399);
  min-width: 18px;
  flex-shrink: 0;
}

.qr-opt-text {
  flex: 1;
  word-break: break-word;
}

.qr-hint {
  font-size: 12px;
  color: var(--wb-text-tertiary, #909399);
  line-height: 1.6;
}
</style>
