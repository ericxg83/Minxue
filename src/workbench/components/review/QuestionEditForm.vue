<template>
  <div class="qef-card">
    <!-- 题干 -->
    <div class="qef-section">
      <div class="qef-label-row">
        <div class="qef-label">题干</div>
        <el-button v-if="showRecognizeQuestion" text size="small" type="primary"
          @click="$emit('question-recognize')">
          <el-icon><Refresh /></el-icon> 重新识别本题
        </el-button>
      </div>
      <el-input v-model="localForm.content" type="textarea" :rows="4" placeholder="请输入题目内容" />
      <div v-if="showRecognizeQuestion" class="qef-tip">
        整页识别漏掉选项时，点「重新识别本题」在原卷上框选该题区域，自动补全题干 / 选项 / 答案。
      </div>
    </div>

    <!-- 配图 -->
    <div class="qef-section qef-image-section">
      <div class="qef-label">{{ optionImages.length ? '选项图（四幅原卷裁片，卷面自带标号）' : (figureOption ? '选项图（A/B/C/D 四幅）' : '配图') }}</div>
      <div class="qef-image-wrap">
        <!-- 有逐幅图时优先四格只读预览；整条横带收进下方折叠链接，避免编辑态图又变回扁条 -->
        <div v-if="optionImages.length" class="qef-option-figures">
          <div v-for="(u, idx) in optionImages" :key="u" class="qef-option-figure">
            <img :src="u" :alt="`选项 ${String.fromCharCode(65 + idx)} 图`" />
          </div>
        </div>
        <img v-else-if="displayImageUrl" :src="displayImageUrl" class="qef-image" />
        <div v-else class="qef-no-image">
          <el-icon :size="24"><Picture /></el-icon>
          <span>暂无配图</span>
        </div>
        <div v-if="optionImages.length" class="qef-tip">
          四幅图来自原卷逐幅裁片。若需重裁，请用下方「原卷裁剪」重新框选（会更新整条选项图）。
        </div>
        <div class="qef-image-actions">
          <el-upload :show-file-list="false" :before-upload="handleImageUpload"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp">
            <el-button size="small" type="primary">
              <el-icon><Upload /></el-icon>{{ displayImageUrl ? '替换' : '上传' }}
            </el-button>
          </el-upload>
          <el-button v-if="showCrop" size="small" type="success" @click="$emit('image-crop')">
            <el-icon><Crop /></el-icon> 原卷裁剪
          </el-button>
          <el-button v-if="displayImageUrl" size="small" type="danger" @click="$emit('image-delete')">
            <el-icon><Delete /></el-icon> 删除
          </el-button>
        </div>
      </div>
    </div>

    <!-- 选项（仅选择题） -->
    <div class="qef-section" v-if="localForm.question_type === 'choice'">
      <div class="qef-label">选项</div>
      <div v-if="figureOption || localForm.options.length === 0" class="qef-tip qef-tip--warn">
        若卷面上 A/B/C/D 是四幅图：请用上方「原卷裁剪」把四幅图连同标号<b>整条</b>框成选项图，
        并在下面填每幅图的区分特征（如「图A：抛物线开口向下、直线斜率为正」）。
        纯文字「重新识别本题」补不出选项图本身。
      </div>
      <div v-for="(opt, idx) in localForm.options" :key="idx" class="qef-option-row">
        <span class="qef-opt-letter">{{ String.fromCharCode(65 + idx) }}.</span>
        <el-input v-model="localForm.options[idx]" size="default" :placeholder="'选项 ' + String.fromCharCode(65 + idx)" />
        <el-button text size="small" type="danger" @click="removeOption(idx)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
      <el-button text size="default" type="primary" @click="addOption">
        <el-icon><Plus /></el-icon> 添加选项
      </el-button>
    </div>

    <!-- 知识点标签 -->
    <div class="qef-section">
      <div class="qef-label">知识点标签</div>
      <div class="qef-tags">
        <el-tag v-for="tag in localForm.tags" :key="tag" size="default" closable @close="removeTag(tag)" round>{{ tag }}</el-tag>
        <el-button text size="default" type="primary" @click="$emit('open-tag-selector')">
          <el-icon><Plus /></el-icon> 添加
        </el-button>
      </div>
    </div>

    <!-- 解析字段已下线（2026-09-21）：解析改由题干行的「解析」按钮弹窗只读查看
         （AnalysisSource），编辑表单不再提供修改入口，避免老师手改 AI 解析导致
         与 ai_self_check 语义脱节。注意：form.analysis 仍由父组件持有并原样提交，
         这里只是不再暴露输入框，不会清空已有解析。 -->
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Picture, Upload, Crop, Delete, Plus, Refresh } from '@element-plus/icons-vue'

const props = defineProps({
  form: { type: Object, required: true },
  displayImageUrl: { type: String, default: '' },
  // 逐幅选项图（questions.option_images，A/B/C/D 顺序）。只读预览：
  // 编辑页不提供逐幅替换入口，避免在表单里引入第二套写库白名单。
  optionImages: { type: Array, default: () => [] },
  showCrop: { type: Boolean, default: false },
  // 是否提供「重新识别本题」入口（整页 OCR 漏识别选项时的补全手段）
  showRecognizeQuestion: { type: Boolean, default: false },
  // 本题 A/B/C/D 四个选项本身是图形（判据由父组件按落库字段给出）
  figureOption: { type: Boolean, default: false }
})

const emit = defineEmits([
  'update:form',
  'image-upload',
  'image-crop',
  'image-delete',
  'open-tag-selector',
  'question-recognize'
])

const localForm = computed({
  get: () => props.form,
  set: (val) => emit('update:form', val)
})

function handleImageUpload(file) {
  emit('image-upload', file)
  return false
}

function addOption() {
  const f = { ...props.form, options: [...props.form.options, ''] }
  emit('update:form', f)
}

function removeOption(idx) {
  const f = { ...props.form, options: props.form.options.filter((_, i) => i !== idx) }
  emit('update:form', f)
}

function removeTag(tag) {
  const f = { ...props.form, tags: props.form.tags.filter(t => t !== tag) }
  emit('update:form', f)
}
</script>

<style scoped>
.qef-card {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  background: #fff;
}

.qef-section {
  padding: 14px 16px;
}

.qef-section + .qef-section {
  border-top: 1px dashed var(--wb-border);
}

.qef-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--wb-text-secondary);
  margin-bottom: 8px;
}

.qef-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.qef-label-row .qef-label {
  margin-bottom: 0;
}

.qef-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wb-text-tertiary, #909399);
}

.qef-tip--warn {
  margin: 0 0 8px;
  padding: 6px 8px;
  border-radius: var(--wb-radius-xs, 4px);
  background: var(--wb-warning-light, #fdf6ec);
  color: var(--wb-warning-dark, #b88230);
}

.qef-image-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qef-image {
  max-width: 100%;
  max-height: 200px;
  border-radius: var(--wb-radius-xs);
  border: 1px solid var(--wb-border);
  object-fit: contain;
}

.qef-no-image {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--wb-text-tertiary);
  font-size: 13px;
  padding: 8px 0;
}

/* 逐幅选项图只读预览（与复核页四格同版式） */
.qef-option-figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.qef-option-figure {
  border: 1px solid transparent;
  border-radius: var(--wb-radius-xs, 4px);
  background: #fff;
  padding: 2px;
}
.qef-option-figure img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: contain;
}

.qef-image-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.qef-option-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.qef-opt-letter {
  font-weight: 700;
  color: var(--wb-text-tertiary);
  min-width: 20px;
  font-size: 14px;
  flex-shrink: 0;
}

.qef-option-row .el-input {
  flex: 1;
}

.qef-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
</style>
