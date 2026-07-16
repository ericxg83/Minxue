<template>
  <div class="review-page" v-loading="loading">
    <!-- 顶部栏 -->
    <div class="review-header">
      <el-button text @click="goBack">
        <el-icon><ArrowLeft /></el-icon> 返回
      </el-button>
      <h3>{{ worksheet?.name || '答案审核' }}</h3>
      <div class="header-actions">
        <el-tag :type="statusType" size="small">{{ statusLabel }}</el-tag>
        <el-button type="primary" @click="handlePublish" :disabled="!canPublish">
          {{ worksheet?.status === 'published' ? '已发布' : '确认发布' }}
        </el-button>
      </div>
    </div>

    <div class="review-body">
      <!-- 左栏: PDF预览 -->
      <div class="panel pdf-panel">
        <div class="panel-title">PDF预览</div>
        <div class="panel-content">
          <iframe v-if="pdfProxyUrl" :src="pdfProxyUrl" class="pdf-preview" frameborder="0"></iframe>
          <el-empty v-else description="无PDF文件" />
        </div>
      </div>

      <!-- 中栏: 题号列表 -->
      <div class="panel list-panel">
        <div class="panel-title">题号列表 ({{ answers.length }})</div>
        <div class="list-filters">
          <el-radio-group v-model="filterMode" size="small">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="low">低置信度</el-radio-button>
          </el-radio-group>
        </div>
        <div class="answer-list">
          <div
            v-for="a in filteredAnswers"
            :key="a.id"
            class="answer-item"
            :class="{ active: selectedAnswer?.id === a.id, low: a.confidence < 0.85 }"
            @click="selectAnswer(a)"
          >
            <span class="qno">{{ a.question_no }}</span>
            <span class="qans">{{ a.answer }}</span>
            <span class="qconf" :class="confClass(a.confidence)">{{ (a.confidence * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>

      <!-- 右栏: 答案编辑 -->
      <div class="panel edit-panel">
        <div class="panel-title">答案编辑</div>
        <div v-if="selectedAnswer" class="edit-form">
          <el-form label-width="60px">
            <el-form-item label="题号">
              <el-input :model-value="selectedAnswer.question_no" disabled />
            </el-form-item>
            <el-form-item label="答案">
              <el-input v-model="editForm.answer" />
            </el-form-item>
            <el-form-item label="题型">
              <el-select v-model="editForm.answer_type">
                <el-option label="选择题" value="choice" />
                <el-option label="填空题" value="fill" />
                <el-option label="简答题" value="answer" />
              </el-select>
            </el-form-item>
            <el-form-item label="来源">
              <el-tag size="small">{{ selectedAnswer.source }}</el-tag>
            </el-form-item>
            <el-form-item label="置信度">
              <el-progress :percentage="Math.round(selectedAnswer.confidence * 100)" :status="confProgress(selectedAnswer.confidence)" />
            </el-form-item>
          </el-form>
          <div class="edit-actions">
            <el-button type="primary" @click="saveAnswer" :loading="saving">保存</el-button>
            <el-button @click="nextAnswer">下一条</el-button>
          </div>
        </div>
        <el-empty v-else description="请选择一道题" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getWorkbooks, getWorkbookAnswers, updateWorkbookAnswer, updateWorkbookStatus
} from '../api/worksheetApi.js'

const route = useRoute()
const router = useRouter()
const worksheetId = route.params.id

const loading = ref(false)
const worksheet = ref(null)
const answers = ref([])
const selectedAnswer = ref(null)
const filterMode = ref('all')
const editForm = ref({ answer: '', answer_type: 'choice' })
const saving = ref(false)

const pdfProxyUrl = computed(() => {
  return worksheet.value?.pdf_url ? `/api/worksheets/${worksheetId}/pdf` : null
})

const filteredAnswers = computed(() => {
  if (filterMode.value === 'low') {
    return answers.value.filter(a => a.confidence < 0.85)
  }
  return answers.value
})

const statusType = computed(() => {
  if (worksheet.value?.status === 'published') return 'success'
  if (worksheet.value?.status === 'reviewing') return 'warning'
  return 'info'
})

const statusLabel = computed(() => {
  if (worksheet.value?.status === 'published') return '已发布'
  if (worksheet.value?.status === 'reviewing') return '审核中'
  return '草稿'
})

const canPublish = computed(() => {
  return worksheet.value && worksheet.value.status !== 'published'
})

onMounted(async () => {
  loading.value = true
  try {
    const all = await getWorkbooks()
    worksheet.value = all.find(w => w.id === worksheetId)
    answers.value = await getWorkbookAnswers(worksheetId)
  } catch (e) {
    ElMessage.error('加载失败: ' + e.message)
  }
  loading.value = false
})

const goBack = () => {
  router.push('/worksheets')
}

const selectAnswer = (a) => {
  selectedAnswer.value = a
  editForm.value = { answer: a.answer, answer_type: a.answer_type || 'choice' }
}

const nextAnswer = () => {
  const idx = filteredAnswers.value.findIndex(a => a.id === selectedAnswer.value?.id)
  if (idx < filteredAnswers.value.length - 1) {
    selectAnswer(filteredAnswers.value[idx + 1])
  }
}

const saveAnswer = async () => {
  if (!selectedAnswer.value) return
  saving.value = true
  try {
    await updateWorkbookAnswer(worksheetId, selectedAnswer.value.id, editForm.value)
    selectedAnswer.value.answer = editForm.value.answer
    selectedAnswer.value.answer_type = editForm.value.answer_type
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  }
  saving.value = false
}

const handlePublish = async () => {
  try {
    await updateWorkbookStatus(worksheetId, 'published')
    worksheet.value.status = 'published'
    ElMessage.success('已发布')
  } catch (e) {
    ElMessage.error('发布失败: ' + e.message)
  }
}

const confClass = (c) => {
  if (c >= 0.95) return 'high'
  if (c >= 0.85) return 'mid'
  return 'low'
}

const confProgress = (c) => {
  if (c >= 0.95) return 'success'
  if (c >= 0.85) return 'warning'
  return 'exception'
}
</script>

<style scoped>
.review-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.review-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--wb-border);
  background: var(--wb-bg-card);
  flex-shrink: 0;
}

.review-header h3 {
  flex: 1;
  margin: 0;
  font-size: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-body {
  flex: 1;
  display: flex;
  gap: 1px;
  background: var(--wb-border);
  overflow: hidden;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--wb-bg-card);
  min-width: 0;
}

.pdf-panel {
  flex: 2;
}

.panel-title {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--wb-text-secondary);
  border-bottom: 1px solid var(--wb-border);
  flex-shrink: 0;
}

.panel-content {
  flex: 1;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.pdf-preview {
  width: 100%;
  height: 100%;
  border: none;
}

.list-filters {
  padding: 8px 12px;
  flex-shrink: 0;
}

.answer-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.answer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.answer-item:hover {
  background: var(--wb-bg-hover);
}

.answer-item.active {
  background: var(--el-color-primary-light-9);
}

.answer-item.low {
  border-left: 3px solid var(--el-color-danger);
}

.qno {
  width: 32px;
  font-weight: 600;
  font-size: 13px;
}

.qans {
  flex: 1;
  font-size: 13px;
  font-family: monospace;
}

.qconf {
  font-size: 11px;
  width: 40px;
  text-align: right;
}

.qconf.high { color: var(--el-color-success); }
.qconf.mid { color: var(--el-color-warning); }
.qconf.low { color: var(--el-color-danger); }

.edit-form {
  padding: 16px;
  flex: 1;
  overflow-y: auto;
}

.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>