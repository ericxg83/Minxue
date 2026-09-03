<template>
  <div class="exam-mgr wb-page wb-page--bleed">
    <div class="page-header">
      <h2>试卷答案库管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon>
        新建试卷
      </el-button>
    </div>

    <el-table :data="exams" v-loading="loading" stripe style="width: 100%">
      <el-table-column label="名称" min-width="220">
        <template #default="{ row }">
          <div class="name-cell">
            <span class="name-cell__text">{{ row.name }}</span>
            <el-button
              size="small"
              link
              type="primary"
              class="name-cell__edit"
              @click="openRename(row)"
              aria-label="重命名"
            >
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </template>
      </el-table-column>
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
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="handleReReview(row)" :disabled="row.answer_count === 0">
            复核
          </el-button>
          <el-button
            size="small"
            :type="row.status === 'published' ? 'warning' : 'success'"
            :disabled="row.status !== 'published' && row.answer_status === 'ai_draft'"
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
          <WorkbenchInput v-model="createForm.name" placeholder="如：2024期末数学试卷" aria-label="试卷名称" />
        </el-form-item>
        <el-form-item label="科目">
          <WorkbenchSelect v-model="createForm.subject" :options="subjectOptions" placeholder="选择科目" aria-label="选择科目" />
        </el-form-item>
        <el-form-item label="年级">
          <WorkbenchInput v-model="createForm.grade" placeholder="如：六年级" aria-label="年级" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreate" :loading="creating">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showRenameDialog" title="重命名试卷答案库" width="420px">
      <el-form :model="renameForm" label-width="60px">
        <el-form-item label="名称">
          <WorkbenchInput v-model="renameForm.name" placeholder="新名称" aria-label="试卷名称" @keydown.enter="handleRename" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="handleRename" :loading="renaming">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showTaskPicker" title="选择批改任务" width="520px">
      <div class="task-picker-tip">
        该资源关联了多个批改任务。选择一份进入 PC 复核页；改题后将通过 <code>syncDraftAnswerBank</code> 实时同步到本资源。
      </div>
      <div v-if="taskPickerLoading" class="task-picker-loading">加载中...</div>
      <div v-else-if="taskPickerList.length === 0" class="task-picker-empty">
        该资源暂无可用任务（可能被清理过）。可以删除此资源后重新批改。
      </div>
      <ul v-else class="task-picker-list">
        <li
          v-for="t in taskPickerList"
          :key="t.id"
          class="task-picker-item"
          @click="enterTaskReview(t)"
        >
          <div class="task-picker-main">
            <strong>{{ t.student_name || '未知学生' }}</strong>
            <span class="task-picker-name">{{ t.original_name || '未命名' }}</span>
          </div>
          <div class="task-picker-meta">
            <el-tag size="small" :type="t.status === 'reviewed' ? 'success' : 'warning'">
              {{ t.status === 'reviewed' ? '已复核' : t.status === 'done' ? '已完成' : t.status }}
            </el-tag>
            <span>{{ formatDate(t.created_at) }}</span>
          </div>
        </li>
      </ul>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Edit, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getResources, getTasksByResource, createResource, deleteResource, updateResource } from '../../services/apiService.js'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'

const router = useRouter()
const exams = ref([])
const loading = ref(false)
const creating = ref(false)
const showCreateDialog = ref(false)
const createForm = ref({ name: '', subject: '', grade: '' })
const showRenameDialog = ref(false)
const renameForm = ref({ id: null, name: '' })
const renaming = ref(false)
const showTaskPicker = ref(false)
const taskPickerLoading = ref(false)
const taskPickerList = ref([])
const subjectOptions = [
  { label: '数学', value: '数学' },
  { label: '英语', value: '英语' },
  { label: '语文', value: '语文' }
]

const loadExams = async () => {
  loading.value = true
  try {
    exams.value = await getResources({ type: 'exam' })
  } catch (e) {
    console.error('加载试卷答案库失败:', e)
  }
  loading.value = false
}

const handleCreate = async () => {
  if (!createForm.value.name) return
  creating.value = true
  try {
    await createResource({ ...createForm.value, type: 'exam' })
    showCreateDialog.value = false
    createForm.value = { name: '', subject: '', grade: '' }
    loadExams()
  } catch (e) {
    console.error('创建失败:', e)
  }
  creating.value = false
}

const openRename = (row) => {
  renameForm.value = { id: row.id, name: row.name || '' }
  showRenameDialog.value = true
}

const handleRename = async () => {
  const newName = (renameForm.value.name || '').trim()
  if (!newName) return
  renaming.value = true
  try {
    const updated = await updateResource(renameForm.value.id, { name: newName })
    const idx = exams.value.findIndex(e => e.id === renameForm.value.id)
    if (idx >= 0 && updated) {
      exams.value[idx] = { ...exams.value[idx], ...updated, name: updated.name || newName }
    }
    showRenameDialog.value = false
    ElMessage.success('已重命名')
  } catch (e) {
    console.error('重命名失败:', e)
    ElMessage.error(e.message || '重命名失败')
  }
  renaming.value = false
}

const handleReReview = async (row) => {
  taskPickerLoading.value = true
  showTaskPicker.value = true
  taskPickerList.value = []
  try {
    const res = await getTasksByResource(row.id)
    const tasks = (res && res.tasks) || []
    if (tasks.length === 0) {
      taskPickerList.value = []
      return
    }
    if (tasks.length === 1) {
      enterTaskReview(tasks[0])
      return
    }
    taskPickerList.value = tasks
  } catch (e) {
    console.error('加载任务列表失败:', e)
    ElMessage.error('加载任务列表失败')
    showTaskPicker.value = false
  } finally {
    taskPickerLoading.value = false
  }
}

const enterTaskReview = (task) => {
  showTaskPicker.value = false
  router.push({
    path: '/grade/task',
    query: { studentId: task.student_id, taskId: task.id, source: 'homework' }
  })
}

const handleToggleStatus = async (row) => {
  try {
    const newStatus = row.status === 'published' ? 'draft' : 'published'
    await updateResource(row.id, { status: newStatus })
    loadExams()
  } catch (e) {
    console.error('切换状态失败:', e)
  }
}

const handleDelete = async (row) => {
  try {
    await deleteResource(row.id)
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
  background: var(--wb-bg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid var(--wb-border);
}

.page-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--wb-text);
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

.name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.name-cell__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wb-text);
}

.name-cell__edit {
  flex-shrink: 0;
  opacity: 0.55;
  transition: opacity 0.15s;
}

.name-cell:hover .name-cell__edit {
  opacity: 1;
}

.task-picker-tip {
  font-size: 13px;
  color: var(--wb-text-secondary);
  line-height: 1.6;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: var(--wb-bg-hover);
  border-left: 3px solid var(--wb-primary);
  border-radius: var(--wb-radius-xs);
}
.task-picker-tip code {
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.task-picker-loading,
.task-picker-empty {
  text-align: center;
  color: var(--wb-text-tertiary);
  font-size: 13px;
  padding: 30px 0;
}
.task-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow-y: auto;
}
.task-picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  margin-bottom: 8px;
  background: var(--wb-bg-card);
  cursor: pointer;
  transition: all 0.15s;
}
.task-picker-item:hover {
  border-color: var(--wb-primary);
  background: var(--wb-primary-mist);
}
.task-picker-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.task-picker-main strong {
  font-size: 14px;
  color: var(--wb-text);
}
.task-picker-name {
  font-size: 12px;
  color: var(--wb-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-picker-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--wb-text-tertiary);
  flex-shrink: 0;
}
</style>