<template>
  <div class="exam-mgr">
    <div class="page-header">
      <h2>试卷答案库管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon>
        新建试卷
      </el-button>
    </div>

    <el-table :data="exams" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="grade" label="年级" width="100" />
      <el-table-column prop="subject" label="科目" width="100" />
      <el-table-column label="答案数" width="90">
        <template #default="{ row }">{{ row.answer_count || 0 }} 题</template>
      </el-table-column>
      <el-table-column label="答案状态" width="120">
        <template #default="{ row }">
          <el-tag :type="answerStatusType(row.answer_status)" size="small">
            {{ answerStatusLabel(row.answer_status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">
            {{ row.status === 'published' ? '已发布' : '草稿' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="handleReview(row)" :disabled="row.answer_count === 0">
            审核答案
          </el-button>
          <el-button
            size="small"
            :type="row.status === 'published' ? 'warning' : 'success'"
            @click="handleToggleStatus(row)"
          >
            {{ row.status === 'published' ? '撤回' : '发布' }}
          </el-button>
          <el-popconfirm title="确定删除？" @confirm="handleDelete(row)">
            <template #reference>
              <el-button size="small" type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && exams.length === 0" description="暂无试卷答案库，请先在 AI 批改复审中心审核后存档" />

    <el-dialog v-model="showCreateDialog" title="新建试卷答案库" width="420px">
      <el-form :model="createForm" label-width="60px">
        <el-form-item label="名称">
          <el-input v-model="createForm.name" placeholder="如：2024期末数学试卷" />
        </el-form-item>
        <el-form-item label="科目">
          <el-select v-model="createForm.subject" placeholder="选择科目" style="width: 100%">
            <el-option label="数学" value="数学" />
            <el-option label="英语" value="英语" />
            <el-option label="语文" value="语文" />
          </el-select>
        </el-form-item>
        <el-form-item label="年级">
          <el-input v-model="createForm.grade" placeholder="如：六年级" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreate" :loading="creating">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import { getExamResources, createExamResource, deleteExamResource, updateExamResource } from '../api/examApi.js'

const router = useRouter()
const exams = ref([])
const loading = ref(false)
const creating = ref(false)
const showCreateDialog = ref(false)
const createForm = ref({ name: '', subject: '', grade: '' })

const loadExams = async () => {
  loading.value = true
  try {
    exams.value = await getExamResources()
  } catch (e) {
    console.error('加载试卷答案库失败:', e)
  }
  loading.value = false
}

const handleCreate = async () => {
  if (!createForm.value.name) return
  creating.value = true
  try {
    await createExamResource(createForm.value)
    showCreateDialog.value = false
    createForm.value = { name: '', subject: '', grade: '' }
    loadExams()
  } catch (e) {
    console.error('创建失败:', e)
  }
  creating.value = false
}

const handleReview = (row) => {
  router.push(`/paper/${row.id}/review`)
}

const handleToggleStatus = async (row) => {
  try {
    const newStatus = row.status === 'published' ? 'draft' : 'published'
    await updateExamResource(row.id, { status: newStatus })
    loadExams()
  } catch (e) {
    console.error('切换状态失败:', e)
  }
}

const handleDelete = async (row) => {
  try {
    await deleteExamResource(row.id)
    loadExams()
  } catch (e) {
    console.error('删除失败:', e)
  }
}

const answerStatusType = (status) => {
  switch (status) {
    case 'official_verified': return 'success'
    case 'teacher_verified': return 'primary'
    case 'ai_draft': return 'warning'
    default: return 'info'
  }
}

const answerStatusLabel = (status) => {
  switch (status) {
    case 'official_verified': return '官方'
    case 'teacher_verified': return '已审核'
    case 'ai_draft': return 'AI草稿'
    default: return '无'
  }
}

const formatDate = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(loadExams)
</script>

<style scoped>
.exam-mgr {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
}

.page-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: #1D2129;
  margin: 0;
}

.page-header :deep(.el-button) {
  display: flex;
  align-items: center;
  gap: 4px;
}

.el-table {
  flex: 1;
  margin: 16px 24px;
  width: auto !important;
}

.el-empty {
  margin-top: 80px;
}
</style>