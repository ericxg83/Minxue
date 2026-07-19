<template>
  <div class="worksheet-mgr">
    <div class="page-header">
      <h2>练习册管理</h2>
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon>
        新建练习册
      </el-button>
    </div>

    <el-table :data="worksheets" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="grade" label="年级" width="100" />
      <el-table-column prop="subject" label="科目" width="100" />
      <el-table-column label="答案数" width="90">
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
          <el-button size="small" @click="handleUploadPdf(row)">上传 PDF</el-button>
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

    <el-dialog v-model="showPdfDialog" title="上传练习册内容" width="580px" @close="onPdfDialogClose">
      <div v-if="parseStatus !== 'parsing' && parseStatus !== 'done'">
        <!-- 合并/分开模式切换 -->
        <div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <el-checkbox v-model="isCombined" label="答案与题目在同一份PDF中" />
        </div>

        <!-- 题目PDF上传（分开模式） -->
        <div v-if="!isCombined" style="margin-bottom:16px;padding:12px;border:1px dashed #dcdfe6;border-radius:6px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#606266;">题目PDF（学生做题时看到的试卷）</div>
          <el-upload
            drag
            accept=".pdf"
            :auto-upload="false"
            :on-change="handleQuestionPdfSelect"
            :limit="1"
          >
            <el-icon class="el-icon--upload" :size="48"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽题目 PDF 到此处，或 <em>点击选择</em></div>
          </el-upload>
          <div v-if="selectedQuestionPdf" class="pdf-info">
            <p>已选择题目: {{ selectedQuestionPdf.name }}</p>
          </div>
        </div>

        <el-tabs v-model="uploadTab">
          <el-tab-pane label="PDF上传" name="pdf">
            <el-upload
              drag
              accept=".pdf"
              :auto-upload="false"
              :on-change="handlePdfSelect"
              :limit="1"
            >
              <el-icon class="el-icon--upload" :size="48"><UploadFilled /></el-icon>
              <div class="el-upload__text">拖拽 PDF 到此处，或 <em>点击选择</em></div>
              <template #tip>
                <div class="el-upload__tip">请上传纯答案页 PDF（建议先裁掉题干页，解析更快更准）</div>
              </template>
            </el-upload>
            <div v-if="selectedPdf" class="pdf-info">
              <p>已选择答案: {{ selectedPdf.name }}</p>
              <el-button type="primary" @click="startParse" :loading="parsing" class="mt-3">
                {{ parsing ? '上传中...' : (isCombined ? '开始解析（题目+答案）' : '开始解析答案') }}
              </el-button>
            </div>
          </el-tab-pane>
          <el-tab-pane label="图片上传" name="image">
            <el-upload
              multiple
              accept="image/jpeg,image/png,image/webp"
              :auto-upload="false"
              :on-change="handleImageSelect"
              :limit="30"
              :file-list="[]"
            >
              <el-icon class="el-icon--upload" :size="48"><PictureFilled /></el-icon>
              <div class="el-upload__text">拖拽图片到此处，或 <em>点击选择</em></div>
              <template #tip>
                <div class="el-upload__tip">支持 JPEG/PNG/WebP，最多 30 张，每张最大 20MB（原图直传，无需裁剪）</div>
              </template>
            </el-upload>
            <div v-if="selectedImages.length > 0" class="image-previews">
              <div v-for="(img, i) in selectedImages" :key="i" class="img-thumb-item">
                <img :src="img.url" class="img-thumb" />
                <span class="img-name">{{ img.name }}</span>
                <el-button size="small" type="danger" circle @click="removeImage(i)" class="img-remove">×</el-button>
              </div>
              <div class="image-actions">
                <el-button type="primary" @click="startImageParse" :loading="parsing">
                  {{ parsing ? '上传中...' : `开始解析（${selectedImages.length} 张）` }}
                </el-button>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
      <div v-else-if="parseStatus === 'parsing'" class="parse-result">
        <el-result icon="info" title="正在解析">
          <template #sub-title>
            <p>{{ parseMessage }}</p>
            <el-icon class="is-loading" :size="32" style="margin-top:12px;color:var(--el-color-primary)">
              <Loading />
            </el-icon>
          </template>
        </el-result>
      </div>
      <div v-else class="parse-result">
        <el-result :icon="parseWarning ? 'warning' : 'success'" title="解析完成">
          <template #sub-title>
            <p>共解析出 <strong>{{ parseCount }}</strong> 条答案</p>
          </template>
          <template #extra>
            <el-alert
              v-if="parseWarning"
              :title="parseWarning"
              type="warning"
              :closable="false"
              class="parse-warning"
            />
            <el-button type="primary" @click="gotoReview" :disabled="parseCount === 0">审核答案</el-button>
            <el-button @click="resetUpload">重新上传</el-button>
          </template>
        </el-result>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, UploadFilled, Loading, PictureFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  getWorksheets,
  createWorksheet,
  deleteWorksheet,
  updateWorksheetStatus,
  uploadPdf,
  uploadImages,
  getWorksheet,
  uploadQuestionPdf,
} from '../../services/apiService.js'

const router = useRouter()
const worksheets = ref([])
const loading = ref(false)
const showCreateDialog = ref(false)
const creating = ref(false)
const createForm = ref({ name: '', subject: '', grade: '' })

const showPdfDialog = ref(false)
const selectedPdf = ref(null)
const selectedQuestionPdf = ref(null)
const isCombined = ref(true) // 默认同一份PDF包含答案和题目
const parsing = ref(false)
const pdfUploaded = ref(false)
const parseCount = ref(0)
const parseWarning = ref(null)
const parseStatus = ref('idle')
const parseMessage = ref('')
let parsePollTimer = null
let parseMessageTimer = null
const currentWorksheetId = ref(null)

const loadData = async () => {
  loading.value = true
  try {
    worksheets.value = await getWorksheets()
  } catch (e) {
    ElMessage.error('加载练习册列表失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

const statusType = (status) => {
  if (status === 'published') return 'success'
  if (status === 'reviewing') return 'warning'
  return 'info'
}

const statusLabel = (status) => {
  if (status === 'published') return '已发布'
  if (status === 'reviewing') return '审核中'
  return '草稿'
}

const formatDate = (value) => {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const handleCreate = async () => {
  if (!createForm.value.name) {
    ElMessage.warning('请输入练习册名称')
    return
  }

  creating.value = true
  try {
    await createWorksheet(createForm.value)
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    createForm.value = { name: '', subject: '', grade: '' }
    await loadData()
  } catch (e) {
    ElMessage.error('创建失败: ' + e.message)
  } finally {
    creating.value = false
  }
}

const handleDelete = async (row) => {
  try {
    await deleteWorksheet(row.id)
    ElMessage.success('已删除')
    await loadData()
  } catch (e) {
    ElMessage.error('删除失败: ' + e.message)
  }
}

const handleToggleStatus = async (row) => {
  const newStatus = row.status === 'published' ? 'draft' : 'published'
  try {
    await updateWorksheetStatus(row.id, newStatus)
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
  selectedQuestionPdf.value = null
  isCombined.value = true
  parseWarning.value = null
  parseCount.value = 0
  parseStatus.value = 'idle'
  parseMessage.value = ''
  if (parsePollTimer) {
    clearInterval(parsePollTimer)
    parsePollTimer = null
  }
  if (parseMessageTimer) {
    clearTimeout(parseMessageTimer)
    parseMessageTimer = null
  }
}

const handlePdfSelect = (uploadFile) => {
  selectedPdf.value = uploadFile.raw
}

const handleQuestionPdfSelect = (uploadFile) => {
  selectedQuestionPdf.value = uploadFile.raw
}

const pollParseStatus = async () => {
  if (!currentWorksheetId.value) return
  try {
    const ws = await getWorksheet(currentWorksheetId.value)
    if (!ws) return
    parseStatus.value = ws.parse_status || 'idle'

    if (ws.parse_status === 'done') {
      parseCount.value = ws.parse_count || 0
      parseWarning.value = ws.parse_warning || null
      pdfUploaded.value = true
      parsing.value = false
      if (parsePollTimer) {
        clearInterval(parsePollTimer)
        parsePollTimer = null
      }
      if (parseMessageTimer) {
        clearTimeout(parseMessageTimer)
        parseMessageTimer = null
      }
      if (ws.parse_warning) {
        ElMessage.warning(ws.parse_warning)
      } else {
        ElMessage.success(`解析完成，共 ${parseCount.value} 条答案`)
      }
      await loadData()
    } else if (ws.parse_status === 'failed') {
      parseCount.value = 0
      parseWarning.value = null
      pdfUploaded.value = false
      parsing.value = false
      if (parsePollTimer) {
        clearInterval(parsePollTimer)
        parsePollTimer = null
      }
      if (parseMessageTimer) {
        clearTimeout(parseMessageTimer)
        parseMessageTimer = null
      }
      ElMessage.error('解析失败: ' + (ws.parse_error || '未知错误'))
      await loadData()
    }
    // 'parsing' — continue polling
  } catch (e) {
    // poll error, keep trying
  }
}

const startParse = async () => {
  if (!currentWorksheetId.value) return

  // 合并模式：必须上传答案PDF
  if (isCombined.value && !selectedPdf.value) {
    ElMessage.warning('请上传PDF文件')
    return
  }

  // 分开模式：必须上传题目PDF和答案PDF
  if (!isCombined.value && (!selectedQuestionPdf.value || !selectedPdf.value)) {
    ElMessage.warning('请上传题目PDF和答案PDF')
    return
  }

  parsing.value = true
  parseStatus.value = 'parsing'
  parseMessage.value = '已上传 PDF，后台正在解析答案...'

  // 如果超过 15 秒还没解析完，提示用户正在耗时的 OCR 识别中
  parseMessageTimer = setTimeout(() => {
    if (parseStatus.value === 'parsing') {
      parseMessage.value = '正在逐页 OCR 识别中（扫描版 PDF 耗时较长，请耐心等待...）'
    }
  }, 15000)

  try {
    if (isCombined.value) {
      // 合并模式：一份PDF同时作为题目和答案源
      await uploadPdf(currentWorksheetId.value, selectedPdf.value, null, true)
    } else {
      // 分开模式：先上传题目PDF，再上传答案PDF并解析
      if (selectedQuestionPdf.value) {
        await uploadQuestionPdf(currentWorksheetId.value, selectedQuestionPdf.value)
      }
      await uploadPdf(currentWorksheetId.value, selectedPdf.value, null, false)
    }

    // 上传成功，立即给用户反馈
    ElMessage.success('上传成功，开始解析...')

    // 立即开始轮询解析状态
    // 先等 2 秒让后端写上 parse_status='parsing'
    setTimeout(() => {
      pollParseStatus()
      parsePollTimer = setInterval(pollParseStatus, 2000)
    }, 2000)
  } catch (e) {
    parsing.value = false
    parseStatus.value = 'idle'
    if (parseMessageTimer) {
      clearTimeout(parseMessageTimer)
      parseMessageTimer = null
    }
    ElMessage.error('上传失败: ' + e.message)
  }
}

const resetPdfUpload = () => {
  pdfUploaded.value = false
  selectedPdf.value = null
  selectedQuestionPdf.value = null
  isCombined.value = true
  parseWarning.value = null
  parseCount.value = 0
  parseStatus.value = 'idle'
  parseMessage.value = ''
  if (parsePollTimer) {
    clearInterval(parsePollTimer)
    parsePollTimer = null
  }
  if (parseMessageTimer) {
    clearTimeout(parseMessageTimer)
    parseMessageTimer = null
  }
}

const onPdfDialogClose = () => {
  if (parsePollTimer) {
    clearInterval(parsePollTimer)
    parsePollTimer = null
  }
  if (parseMessageTimer) {
    clearTimeout(parseMessageTimer)
    parseMessageTimer = null
  }
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
}

.parse-result {
  padding: 8px 0;
}

.parse-warning {
  margin-bottom: 16px;
  text-align: left;
}
</style>
