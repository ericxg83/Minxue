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
        <div class="panel-title">
          <span>PDF预览</span>
          <el-button
            v-if="hasQuestionPdf && hasAnswerPdf"
            size="small"
            text
            @click="pdfMode = pdfMode === 'question' ? 'answer' : 'question'"
          >
            <el-icon><View /></el-icon>
            {{ pdfMode === 'question' ? '查看答案PDF' : '查看题目PDF' }}
          </el-button>
        </div>
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
          <el-select v-if="units.length > 0" v-model="unitFilter" size="small" style="width:220px;margin-left:8px" placeholder="筛选单元">
            <el-option label="全部单元" value="all" />
            <el-option v-for="u in units" :key="u.key" :label="u.title" :value="u.key" />
          </el-select>
        </div>
        <div class="answer-list">
          <template v-for="item in displayList" :key="item.type === 'header' ? 'h:' + item.key : item.type === 'section' ? 's:' + item.key : item.a.id">
            <div v-if="item.type === 'header'" class="unit-header">{{ item.title }}</div>
            <div v-else-if="item.type === 'section'" class="section-header">{{ item.title }}</div>
            <div
              v-else
              class="answer-item"
              :class="{ active: selectedAnswer?.id === item.a.id, low: item.a.confidence < 0.85 }"
              @click="selectAnswer(item.a)"
            >
              <span class="qno">{{ item.a.question_no }}{{ item.a.sub_no ? '(' + item.a.sub_no + ')' : '' }}</span>
              <span class="qans">{{ item.a.answer }}</span>
              <span class="qconf" :class="confClass(item.a.confidence)">{{ (item.a.confidence * 100).toFixed(0) }}%</span>
            </div>
          </template>
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
import { ArrowLeft, View } from '@element-plus/icons-vue'
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
const unitFilter = ref('all')
const editForm = ref({ answer: '', answer_type: 'choice' })
const saving = ref(false)
const pdfMode = ref('question') // 'question' | 'answer'

const pdfProxyUrl = computed(() => {
  if (!worksheet.value) return null
  if (pdfMode.value === 'question' && worksheet.value.question_pdf_url) {
    return `/api/worksheets/${worksheetId}/question-pdf`
  }
  if (worksheet.value.pdf_url) {
    return `/api/worksheets/${worksheetId}/pdf`
  }
  // 有 question_pdf_url 但当前是 answer 模式且没有 pdf_url，回退到 question
  if (worksheet.value.question_pdf_url) {
    return `/api/worksheets/${worksheetId}/question-pdf`
  }
  return null
})

const hasQuestionPdf = computed(() => !!worksheet.value?.question_pdf_url)
const hasAnswerPdf = computed(() => !!worksheet.value?.pdf_url)

// 单元列表按接口返回顺序（unit_seq 书内顺序）去重；无 unit 的旧数据归入「未分组」
const UNGROUPED = '__ungrouped__'
const unitKeyOf = (a) => a.unit_key || UNGROUPED
const unitTitleOf = (a) => a.unit_title || '未分组'

const units = computed(() => {
  const seen = new Set()
  const list = []
  for (const a of answers.value) {
    const key = unitKeyOf(a)
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ key, title: unitTitleOf(a) })
  }
  return list
})

const filteredAnswers = computed(() => {
  let list = answers.value
  if (unitFilter.value !== 'all') {
    list = list.filter(a => unitKeyOf(a) === unitFilter.value)
  }
  if (filterMode.value === 'low') {
    list = list.filter(a => a.confidence < 0.85)
  }
  return list
})

// 列表项：单元变化处插入标题行，大题组变化处插入子标题，与 PDF 排版一致
const displayList = computed(() => {
  const items = []
  let lastUnitKey = null
  let lastSection = null
  for (const a of filteredAnswers.value) {
    const key = unitKeyOf(a)
    // 单元标题
    if (key !== lastUnitKey) {
      items.push({ type: 'header', key, title: unitTitleOf(a) })
      lastUnitKey = key
      lastSection = null // 新单元重置大题组
    }
    // 大题组子标题（一、填空题 / 二、选择题 / 三、解答题）
    if (a.section && a.section !== lastSection) {
      items.push({ type: 'section', key: key + '|' + a.section, title: a.section })
      lastSection = a.section
    }
    items.push({ type: 'answer', a })
  }
  return items
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
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  padding: 5px 12px;
  border-radius: var(--wb-radius-xs);
  cursor: pointer;
  transition: background 0.15s;
  font-size: 13px;
}

.answer-item:hover {
  background: var(--wb-bg-hover);
}

.answer-item.active {
  background: var(--wb-primary-mist);
}

.answer-item.low {
  border-left: 3px solid var(--wb-danger);
}

.unit-header {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 12px;
  margin: 8px 0 2px;
  font-size: 13px;
  font-weight: 700;
  color: var(--wb-primary);
  background: var(--wb-bg-card);
  border-bottom: 2px solid var(--wb-primary);
}

.section-header {
  position: sticky;
  top: 33px;
  z-index: 1;
  padding: 4px 12px;
  margin: 4px 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--wb-text-secondary);
  background: var(--wb-bg-hover);
  border-radius: var(--wb-radius-xs);
}

.qno {
  min-width: 32px;
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

.qconf.high { color: var(--wb-success); }
.qconf.mid { color: var(--wb-warning); }
.qconf.low { color: var(--wb-danger); }

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