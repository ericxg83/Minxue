<template>
  <div class="worksheet-mgr">
    <div class="page-header">
      <h2>练习册管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon> 新建练习册
      </el-button>
    </div>

    <!-- 练习册列表 -->
    <el-table :data="worksheets" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="grade" label="年级" width="100" />
      <el-table-column prop="subject" label="科目" width="100" />
      <el-table-column label="答案数" width="80">
        <template #default="{ row }">{{ row.answer_count || 0 }} 题</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">
            {{ statusLabel(row.status) }}
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
          <el-button size="small" @click="handleUploadPdf(row)">上传PDF</el-button>
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

    <el-empty v-if="!loading && worksheets.length === 0" description="暂无练习册，点击右上角新建" />

    <!-- 新建对话框 -->
    <el-dialog v-model="showCreateDialog" title="新建练习册" width="420px">
      <el-form :model="createForm" label-width="60px">
        <el-form-item label="名称">
          <el-input v-model="createForm.name" placeholder="如：六上数学小初衔接" />
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

    <!-- PDF上传对话框 -->
    <el-dialog v-model="showPdfDialog" title="上传答案PDF" width="500px">
      <div v-if="!pdfUploaded">
        <el-upload
          drag
          accept=".pdf"
          :auto-upload="false"
          :on-change="handlePdfSelect"
          :limit="1"
        >
          <el-icon class="el-icon--upload" :size="48"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽PDF到此处，或<em>点击选择</em></div>
          <template #tip>
            <div class="el-upload__tip">支持含参考答案的练习册PDF（含题目+答案页 或 纯答案页）</div>
          </template>
        </el-upload>
        <div v-if="selectedPdf" class="pdf-info">
          <p>已选择: {{ selectedPdf.name }}</p>
          <el-button type="primary" @click="startParse" :loading="parsing" class="mt-3">
            开始解析
          </el-button>
        </div>
      </div>
      <div v-else class="parse-result">
        <el-result icon="success" title="解析完成">
          <template #sub-title>
            <p>共解析出 <strong>{{ parseCount }}</strong> 条答案</p>
          </template>
          <template #extra>
            <el-button type="primary" @click="gotoReview">审核答案</el-button>
            <el-button @click="resetPdfUpload">继续上传</el-button>
          </template>
        </el-result>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getWorkbooks, createWorkbook, deleteWorkbook, updateWorkbookStatus, uploadPdf } from '../api/worksheetApi.js'

const router = useRouter()
const worksheets = ref([])
const loading = ref(false)
const showCreateDialog = ref(false)
const creating = ref(false)
const createForm = ref({ name: '', subject: '', grade: '' })

// PDF upload
const showPdfDialog = ref(false)
const selectedPdf = ref(null)
const parsing = ref(false)
const pdfUploaded = ref(false)
const parseCount = ref(0)
const currentWorksheetId = ref(null)

const loadData = async () => {
  loading.value = true
  try {
    worksheets.value = await getWorkbooks()
  } catch (e) {
    ElMessage.error('加载练习册列表失败: ' + e.message)
  }
  loading.value = false
}

onMounted(loadData)

const statusType = (s) => {
  if (s === 'published') return 'success'
  if (s === 'reviewing') return 'warning'
  return 'info'
}

const statusLabel = (s) => {
  if (s === 'published') return '已发布'
  if (s === 'reviewing') return '审核中'
  return '草稿'
}

const formatDate = (d) => {
  if (!d) return ''
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const handleCreate = async () => {
  if (!createForm.value.name) {
    ElMessage.warning('请输入练习册名称')
    return
  }
  creating.value = true
  try {
    await createWorkbook(createForm.value)
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    createForm.value = { name: '', subject: '', grade: '' }
    await loadData()
  } catch (e) {
    ElMessage.error('创建失败: ' + e.message)
  }
  creating.value = false
}

const handleDelete = async (row) => {
  try {
    await deleteWorkbook(row.id)
    ElMessage.success('已删除')
    await loadData()
  } catch (e) {
    ElMessage.error('删除失败: ' + e.message)
  }
}

const handleToggleStatus = async (row) => {
  const newStatus = row.status === 'published' ? 'draft' : 'published'
  try {
    await updateWorkbookStatus(row.id, newStatus)
    ElMessage.success(newStatus === 'published' ? '已发布' : '已撤回')
    await loadData()
  } catch (e) {
    ElMessage.error('操作失败: ' + e.message)
  }
}

const handleReview = (row) => {
  router.push(`/worksheets/${row.id}/review`)
}

const handleUploadPdf = (row) => {
  currentWorksheetId.value = row.id
  showPdfDialog.value = true
  pdfUploaded.value = false
  selectedPdf.value = null
}

const handlePdfSelect = (uploadFile) => {
  selectedPdf.value = uploadFile.raw
}

const startParse = async () => {
  if (!selectedPdf.value || !currentWorksheetId.value) return
  parsing.value = true
  try {
    const result = await uploadPdf(currentWorksheetId.value, selectedPdf.value)
    parseCount.value = result.count || 0
    pdfUploaded.value = true
    ElMessage.success(`解析完成，共 ${parseCount.value} 条答案`)
    await loadData()
  } catch (e) {
    ElMessage.error('解析失败: ' + e.message)
  }
  parsing.value = false
}

const resetPdfUpload = () => {
  pdfUploaded.value = false
  selectedPdf.value = null
}

const gotoReview = () => {
  showPdfDialog.value = false
  router.push(`/worksheets/${currentWorksheetId.value}/review`)
}
</script>

<style scoped>
.worksheet-mgr {
  padding: 24px;
  height: 100%;
  overflow-y: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.pdf-info {
  margin-top: 16px;
  text-align: center;
}

.parse-result {
  text-align: center;
}

.mt-3 {
  margin-top: 12px;
}
</style>