<template>
  <el-dialog
    :model-value="modelValue"
    title="识别结果预览"
    width="520px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:modelValue', v)"
    @close="onClose"
  >
    <div class="ar-preview">
      <div v-if="previewUrl" class="ar-thumb-wrap">
        <img :src="previewUrl" class="ar-thumb" alt="原图预览" />
      </div>

      <div class="ar-section">
        <div class="ar-label">识别出的答案（KaTeX 格式）</div>
        <div class="ar-answer">
          <MathRender :content="result?.answer || '（未识别到答案）'" autoDetect tag="div" />
        </div>
        <div v-if="result?.answer" class="ar-answer-raw">
          <code>{{ result.answer }}</code>
        </div>
      </div>

      <div v-if="result?.analysis" class="ar-section">
        <div class="ar-label">解析（仅记录，不会写入）</div>
        <div class="ar-analysis">
          <MathRender :content="result.analysis" autoDetect tag="div" />
        </div>
      </div>

      <div v-if="!result?.answer" class="ar-empty">
        模型没拿到清晰的答案，请换一张更清晰的截图，或手动输入。
      </div>
    </div>

    <template #footer>
      <el-button @click="onClose">取消</el-button>
      <el-button
        type="primary"
        :disabled="!result?.answer"
        @click="onApply"
      >
        应用到答案
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import MathRender from '../MathRender.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  result: { type: Object, default: () => null },
  previewUrl: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'apply'])

function onApply() {
  if (!props.result?.answer) return
  emit('apply', props.result.answer)
  emit('update:modelValue', false)
}

function onClose() {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.ar-preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ar-thumb-wrap {
  display: flex;
  justify-content: center;
  background: var(--wb-bg-soft, #f7f8fa);
  border-radius: 6px;
  padding: 8px;
}

.ar-thumb {
  max-width: 100%;
  max-height: 160px;
  object-fit: contain;
  border-radius: 4px;
}

.ar-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ar-label {
  font-size: 12px;
  color: var(--wb-text-sub, #909399);
  font-weight: 500;
}

.ar-answer {
  padding: 10px 12px;
  border: 1px solid var(--wb-border, #e4e7ed);
  border-radius: 6px;
  background: #fffbea;
  font-size: 15px;
  line-height: 1.6;
  min-height: 32px;
  word-break: break-all;
}

.ar-answer-raw {
  font-size: 12px;
  color: var(--wb-text-sub, #909399);
  margin-top: 2px;
}

.ar-answer-raw code {
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: 'SF Mono', Consolas, monospace;
}

.ar-analysis {
  padding: 8px 10px;
  border: 1px solid var(--wb-border, #e4e7ed);
  border-radius: 6px;
  background: #fafafa;
  font-size: 13px;
  line-height: 1.5;
  color: var(--wb-text-main, #303133);
}

.ar-empty {
  padding: 12px;
  background: #fef0f0;
  border: 1px dashed #f56c6c;
  border-radius: 6px;
  color: #f56c6c;
  font-size: 13px;
  text-align: center;
}
</style>