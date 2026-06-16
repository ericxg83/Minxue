<template>
  <div class="qef-card">
    <!-- 题干 -->
    <div class="qef-section">
      <div class="qef-label">题干</div>
      <el-input v-model="localForm.content" type="textarea" :rows="4" placeholder="请输入题目内容" />
    </div>

    <!-- 配图 -->
    <div class="qef-section qef-image-section">
      <div class="qef-label">配图</div>
      <div class="qef-image-wrap">
        <img v-if="displayImageUrl" :src="displayImageUrl" class="qef-image" />
        <div v-else class="qef-no-image">
          <el-icon :size="24"><Picture /></el-icon>
          <span>暂无配图</span>
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

    <!-- AI 解析 -->
    <div class="qef-section">
      <div class="qef-label">AI 解析</div>
      <el-input v-model="localForm.analysis" type="textarea" :rows="3" placeholder="题目解析" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Picture, Upload, Crop, Delete, Plus } from '@element-plus/icons-vue'

const props = defineProps({
  form: { type: Object, required: true },
  displayImageUrl: { type: String, default: '' },
  showCrop: { type: Boolean, default: false }
})

const emit = defineEmits([
  'update:form',
  'image-upload',
  'image-crop',
  'image-delete',
  'open-tag-selector'
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
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
}

.qef-section {
  padding: 14px 16px;
}

.qef-section + .qef-section {
  border-top: 1px dashed #ebeef5;
}

.qef-label {
  font-size: 13px;
  font-weight: 600;
  color: #4E5969;
  margin-bottom: 8px;
}

.qef-image-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qef-image {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
  object-fit: contain;
}

.qef-no-image {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #c0c4cc;
  font-size: 13px;
  padding: 8px 0;
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
  color: #909399;
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
