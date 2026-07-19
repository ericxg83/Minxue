<template>
  <div class="review-page" v-loading="loading">
    <!-- 顶部栏 -->
    <div class="review-header">
      <el-button text @click="goBack">
        <el-icon><ArrowLeft /></el-icon> 返回
      </el-button>
      <h3>{{ resource?.name || '试卷答案审核' }}</h3>
      <div class="header-actions">
        <el-tag :type="answerStatusType" size="small">{{ answerStatusLabel }}</el-tag>
        <el-button type="primary" @click="handlePublish" :disabled="!canPublish">
          {{ resource?.status === 'published' ? '已发布' : '确认发布' }}
        </el-button>
      </div>
    </div>

    <div class="review-body">
      <!-- 左栏: 使用历史 -->
      <div class="panel usage-panel">
        <div class="panel-title">使用记录 ({{ tasks.length }})</div>
        <div class="usage-list">
          <div v-if="tasks.length === 0" class="empty-hint">暂无使用记录</div>
          <div v-for="t in tasks" :key="t.id" class="usage-item">
            <div class="usage-student">{{ t.student_name || '未知学生' }}</div>
            <div class="usage-meta">
              <span>{{ formatDate(t.created_at) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 中栏: 题号列表 -->
      <div class="panel list-panel">
        <div class="panel-title">答案列表 ({{ answers.length }})</div>
        <div class="list-filters">
          <el-radio-group v-model="filterMode" size="small">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="verified">已审核</el-radio-button>
            <el-radio-button value="draft">草稿</el-radio-button>
          </el-radio-group>
        </div>
        <div class="answer-list">
          <div
            v-for="a in filteredAnswers"
            :key="a.id"
            class="answer-item"
            :class="{ active: selectedAnswer?.id === a.id, draft: a.answer_status === 'ai_draft' }"
            @click="selectAnswer(a)"
          >
            <span class="qno">{{ a.question_no }}</span>
            <span class="qans">{{ a.answer }}</span>
            <el-tag v-if="a.answer_status === 'ai_draft'" size="small" type="warning" class="qtag">草稿</el-tag>
            <el-tag v-else-if="a.answer_status === 'teacher_verified'" size="small" type="primary" class="qtag">已审核</el-tag>
            <el-tag v-else size="small" type="success" class="qtag">官方</el-tag>
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
                <el-option label="解答题" value="answer" />
                <el-option label="判断题" value="judge" />
              </el-select>
            </el-form-item>
            <el-form-item label="题干">
              <el-input v-model="editForm.content" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="状态">
              <el-tag :type="statusTagType(selectedAnswer.answer_status)" size="small">
                {{ statusTagLabel(selectedAnswer.answer_status) }}
              </el-tag>
            </el-form-item>
          </el-form>
          <div class="edit-actions">
            <el-button type="primary" @click="handleSaveAnswer" :loading="saving">保存修改</el-button>
            <el-button v-if="selectedAnswer.answer_status === 'ai_draft'" @click="handleMarkVerified">
              标记为已审核
            </el-button>
          </div>
        </div>
        <el-empty v-else description="请选择题目" />
      </div>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="hasDraftAnswers" class="batch-bar">
      <el-button type="primary" @click="handleBatchVerify" :loading="batchLoading">
        批量标记为已审核 ({{ draftCount }} 项)
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, View } from '@element-plus/icons-vue'
import { getExamAnswers, updateExamAnswerStatus, updateExamResource } from '../api/examApi.js'
import axios from 'axios'

const route = useRoute()
const router = useRouter()
const resourceId = route.params.id

const loading = ref(false)
const saving = ref(false)
const batchLoading = ref(false)
const resource = ref(null)
const answers = ref([])
const tasks = ref([])
const selectedAnswer = ref(null)
const editForm = ref({ answer: '', answer_type: 'choice', content: '' })
const filterMode = ref('all')

const filteredAnswers = computed(() => {
  if (filterMode.value === 'all') return answers.value
  if (filterMode.value === 'verified') return answers.value.filter(a => a.answer_status !== 'ai_draft')
  if (filterMode.value === 'draft') return answers.value.filter(a => a.answer_status === 'ai_draft')
  return answers.value
})

const hasDraftAnswers = computed(() => answers.value.some(a => a.answer_status === 'ai_draft'))
const draftCount = computed(() => answers.value.filter(a => a.answer_status === 'ai_draft').length)

const canPublish = computed(() =>
  resource.value?.status !== 'published' && answers.value.length > 0
)

const answerStatusType = computed(() => {
  switch (resource.value?.answer_status) {
    case 'official_verified': return 'success'
    case 'teacher_verified': return 'primary'
    case 'ai_draft': return 'warning'
    default: return 'info'
  }
})

const answerStatusLabel = computed(() => {
  switch (resource.value?.answer_status) {
    case 'official_verified': return '官方答案'
    case 'teacher_verified': return '已审核'
    case 'ai_draft': return 'AI草稿'
    default: return '无答案'
  }
})

const loadData = async () => {
  loading.value = true
  try {
    // Load resource info
    const res = await axios.get(`/api/resources/${resourceId}`)
    resource.value = res.data.resource

    // Load answers
    answers.value = await getExamAnswers(resourceId)

    // Load tasks that used this resource
    const taskRes = await axios.get(`/api/tasks/resource/${resourceId}`)
    tasks.value = (taskRes.data.tasks || []).map(t => ({
      id: t.id,
      student_name: t.student_name || '未知',
      created_at: t.created_at
    }))
  } catch (e) {
    console.error('加载数据失败:', e)
  }
  loading.value = false
}

const selectAnswer = (a) => {
  selectedAnswer.value = a
  editForm.value = {
    answer: a.answer || '',
    answer_type: a.answer_type || 'choice',
    content: a.content || ''
  }
}

const handleSaveAnswer = async () => {
  if (!selectedAnswer.value) return
  saving.value = true
  try {
    const { answer, answer_type, content } = editForm.value
    // Update via resource answers PUT endpoint
    await axios.put(`/api/resources/${resourceId}/answers`, {
      answers: answers.value.map(a =>
        a.id === selectedAnswer.value.id
          ? { ...a, answer, answer_type, content }
          : a
      )
    })
    // Reload
    answers.value = await getExamAnswers(resourceId)
    selectedAnswer.value = answers.value.find(a => a.id === selectedAnswer.value.id)
  } catch (e) {
    console.error('保存失败:', e)
  }
  saving.value = false
}

const handleMarkVerified = async () => {
  if (!selectedAnswer.value) return
  try {
    // Update individual answer status via batch update
    const updated = answers.value.map(a =>
      a.id === selectedAnswer.value.id
        ? { ...a, answer_status: 'teacher_verified' }
        : a
    )
    await axios.put(`/api/resources/${resourceId}/answers`, { answers: updated })
    answers.value = await getExamAnswers(resourceId)
    selectedAnswer.value = answers.value.find(a => a.id === selectedAnswer.value.id)
  } catch (e) {
    console.error('标记失败:', e)
  }
}

const handleBatchVerify = async () => {
  batchLoading.value = true
  try {
    const updated = answers.value.map(a =>
      a.answer_status === 'ai_draft'
        ? { ...a, answer_status: 'teacher_verified' }
        : a
    )
    await axios.put(`/api/resources/${resourceId}/answers`, { answers: updated })
    answers.value = await getExamAnswers(resourceId)
  } catch (e) {
    console.error('批量标记失败:', e)
  }
  batchLoading.value = false
}

const handlePublish = async () => {
  try {
    // Update resource status to published
    await updateExamResource(resourceId, { status: 'published', answerStatus: 'teacher_verified' })
    resource.value = { ...resource.value, status: 'published', answer_status: 'teacher_verified' }
  } catch (e) {
    console.error('发布失败:', e)
  }
}

const goBack = () => {
  router.push('/paper')
}

const formatDate = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const statusTagType = (status) => {
  switch (status) {
    case 'official_verified': return 'success'
    case 'teacher_verified': return 'primary'
    default: return 'warning'
  }
}

const statusTagLabel = (status) => {
  switch (status) {
    case 'official_verified': return '官方已审核'
    case 'teacher_verified': return '教师已审核'
    default: return 'AI草稿'
  }
}

onMounted(loadData)
</script>

<style scoped>
.review-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.review-header {
  display: flex;
  align-items: center;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  gap: 16px;
  flex-shrink: 0;
}

.review-header h3 {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-body {
  flex: 1;
  display: flex;
  gap: 12px;
  padding: 12px 24px;
  overflow: hidden;
  min-height: 0;
}

.panel {
  background: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-title {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #4E5969;
  border-bottom: 1px solid #E5E6EB;
  flex-shrink: 0;
}

.panel-content {
  flex: 1;
  overflow: auto;
}

.usage-panel {
  width: 240px;
  flex-shrink: 0;
}

.usage-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.usage-item {
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 4px;
  background: #F9FAFB;
}

.usage-student {
  font-size: 13px;
  font-weight: 500;
  color: #1D2129;
}

.usage-meta {
  font-size: 12px;
  color: #86909C;
  margin-top: 4px;
}

.empty-hint {
  text-align: center;
  color: #86909C;
  font-size: 13px;
  padding: 40px 0;
}

.list-panel {
  width: 300px;
  flex-shrink: 0;
}

.list-filters {
  padding: 8px 12px;
  border-bottom: 1px solid #E5E6EB;
  flex-shrink: 0;
}

.answer-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.answer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid #F5F7FA;
}

.answer-item:hover {
  background: #F5F7FA;
}

.answer-item.active {
  background: #E8F4FF;
}

.answer-item.draft {
  opacity: 0.7;
}

.qno {
  font-size: 13px;
  font-weight: 600;
  color: #1D2129;
  min-width: 28px;
}

.qans {
  flex: 1;
  font-size: 13px;
  color: #4E5969;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qtag {
  flex-shrink: 0;
}

.edit-panel {
  flex: 1;
}

.edit-form {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.batch-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 24px;
  background: #fff;
  border-top: 1px solid #E5E6EB;
  flex-shrink: 0;
}
</style>