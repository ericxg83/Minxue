<template>
  <div class="question-bank-container">
    <!-- 顶部导航 -->
    <div class="header">
      <div class="header-left">
        <el-button @click="$router.push('/')" :icon="ArrowLeft">返回</el-button>
        <h2>题库管理中心</h2>
      </div>
      <div class="header-right">
        <el-button @click="questionStore.loadAllQuestions" :loading="questionStore.loading" type="primary">
          刷新数据
        </el-button>
      </div>
    </div>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="questionStore.isEditing"
      title="编辑题目"
      width="60%"
      :close-on-click-modal="false"
    >
      <div v-if="questionStore.currentQuestion" class="edit-form">
        <el-form label-width="80px">
          <el-form-item label="题目标题">
            <el-input 
              v-model="questionStore.currentQuestion.content" 
              type="textarea" 
              :rows="4" 
            />
          </el-form-item>
          
          <el-form-item label="题目类型">
            <el-select v-model="questionStore.currentQuestion.question_type" style="width: 100%">
              <el-option 
                v-for="(label, key) in QUESTION_TYPE_LABELS" 
                :key="key" 
                :label="label" 
                :value="key" 
              />
            </el-select>
          </el-form-item>

          <el-form-item label="科目">
            <el-input v-model="questionStore.currentQuestion.subject" />
          </el-form-item>

          <el-form-item label="标准答案">
            <el-input v-model="questionStore.currentQuestion.answer" />
          </el-form-item>

          <el-form-item label="解析">
            <el-input 
              v-model="questionStore.currentQuestion.analysis" 
              type="textarea" 
              :rows="3" 
            />
          </el-form-item>

          <el-form-item label="图片URL">
            <el-input v-model="questionStore.currentQuestion.image_url" />
          </el-form-item>

          <el-form-item label="AI标签">
            <el-tag 
              v-for="tag in (questionStore.currentQuestion.ai_tags || [])" 
              :key="tag" 
              closable 
              @close="removeTag('ai_tags', tag)"
              style="margin-right: 8px"
            >
              {{ tag }}
            </el-tag>
            <el-input 
              v-model="newTag" 
              placeholder="输入标签后回车" 
              size="small" 
              style="width: 120px"
              @keyup.enter="addTag('ai_tags')"
            />
          </el-form-item>

          <el-form-item label="手动标签">
            <el-tag 
              v-for="tag in (questionStore.currentQuestion.manual_tags || [])" 
              :key="tag" 
              closable 
              @close="removeTag('manual_tags', tag)"
              style="margin-right: 8px"
            >
              {{ tag }}
            </el-tag>
            <el-input 
              v-model="newTag" 
              placeholder="输入标签后回车" 
              size="small" 
              style="width: 120px"
              @keyup.enter="addTag('manual_tags')"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="questionStore.cancelEdit">取消</el-button>
        <el-button type="primary" @click="handleSaveEdit" :loading="questionStore.loading">
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 搜索筛选区 -->
    <div class="filter-bar">
      <div class="filter-left">
        <el-input 
          v-model="searchKeyword" 
          placeholder="搜索题目内容、答案、标签..." 
          clearable 
          @input="handleSearch"
          style="width: 300px"
        />
        
        <el-select v-model="questionStore.filters.type" @change="handleFilterChange" style="width: 120px">
          <el-option label="所有类型" value="all" />
          <el-option 
            v-for="(label, key) in QUESTION_TYPE_LABELS" 
            :key="key" 
            :label="label" 
            :value="key" 
          />
        </el-select>

        <el-select v-model="questionStore.filters.subject" @change="handleFilterChange" style="width: 120px">
          <el-option label="所有科目" value="all" />
          <el-option 
            v-for="subject in subjects" 
            :key="subject" 
            :label="subject" 
            :value="subject" 
          />
        </el-select>
      </div>

      <div class="filter-right">
        <el-button-group>
          <el-button 
            :type="questionStore.filters.sortBy === 'last_seen' ? 'primary' : ''"
            @click="questionStore.setSort('last_seen')"
          >
            最近出现
          </el-button>
          <el-button 
            :type="questionStore.filters.sortBy === 'reference_count' ? 'primary' : ''"
            @click="questionStore.setSort('reference_count')"
          >
            引用次数
          </el-button>
          <el-button 
            :type="questionStore.filters.sortBy === 'student_count' ? 'primary' : ''"
            @click="questionStore.setSort('student_count')"
          >
            关联学生
          </el-button>
        </el-button-group>
      </div>
    </div>

    <!-- 统计信息 -->
    <div class="stats-bar">
      <span>共 {{ questionStore.pagination.total }} 道题目</span>
      <span v-if="questionStore.selectedCount > 0">
        已选 {{ questionStore.selectedCount }} 道
        <el-button size="small" type="danger" @click="handleBatchDelete">批量删除</el-button>
      </span>
    </div>

    <!-- 题目列表 -->
    <el-table 
      :data="questionStore.filteredQuestions" 
      v-loading="questionStore.loading"
      @selection-change="handleSelectionChange"
      stripe
    >
      <el-table-column type="selection" width="55" />
      
      <el-table-column label="题目标题" min-width="300">
        <template #default="{ row }">
          <div class="question-title">
            <el-link type="primary" @click="questionStore.startEdit(row)">
              {{ truncateText(row.content, 50) }}
            </el-link>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag size="small">
            {{ QUESTION_TYPE_LABELS[row.question_type] || row.question_type || '未知' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="引用次数" width="100" sortable prop="_referenceCount">
        <template #default="{ row }">
          {{ row._referenceCount || 0 }}
        </template>
      </el-table-column>

      <el-table-column label="关联学生" width="100">
        <template #default="{ row }">
          <el-tooltip :content="`关联 ${row._studentCount || 0} 个学生`" placement="top">
            <el-tag type="success" size="small">{{ row._studentCount || 0 }}</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>

      <el-table-column label="最近出现" width="120">
        <template #default="{ row }">
          {{ formatDate(row._lastSeen) }}
        </template>
      </el-table-column>

      <el-table-column label="标签" width="200">
        <template #default="{ row }">
          <div class="tags-cell">
            <el-tag 
              v-for="tag in (row.ai_tags || []).slice(0, 2)" 
              :key="tag" 
              size="small" 
              type="info"
              style="margin-right: 4px"
            >
              {{ tag }}
            </el-tag>
            <el-tag 
              v-for="tag in (row.manual_tags || []).slice(0, 2)" 
              :key="tag" 
              size="small" 
              style="margin-right: 4px"
            >
              {{ tag }}
            </el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="questionStore.startEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-bar">
      <el-pagination
        v-model:current-page="questionStore.pagination.page"
        v-model:page-size="questionStore.pagination.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="questionStore.pagination.total"
        layout="total, sizes, prev, pager, next"
        @size-change="questionStore.setPageSize"
        @current-change="questionStore.setPage"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuestionStore, QUESTION_TYPE_LABELS } from '../stores/questionStore'
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const questionStore = useQuestionStore()

const searchKeyword = ref('')
const newTag = ref('')

// 科目列表
const subjects = computed(() => {
  const set = new Set()
  questionStore.allQuestions.forEach(q => {
    if (q.subject) set.add(q.subject)
  })
  return Array.from(set)
})

// 搜索
const handleSearch = () => {
  questionStore.search(searchKeyword.value)
}

// 筛选变化
const handleFilterChange = () => {
  questionStore.setPage(1)
}

// 表格选择变化
const handleSelectionChange = (selection) => {
  questionStore.selectedQuestions = selection.map(q => q.id)
}

// 保存编辑
const handleSaveEdit = async () => {
  const success = await questionStore.saveEdit()
  if (success) {
    ElMessage.success('保存成功，所有引用该题目的学生错题记录已自动同步更新')
  } else {
    ElMessage.error('保存失败')
  }
}

// 批量删除
const handleBatchDelete = async () => {
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${questionStore.selectedCount} 道题目吗？此操作将影响所有关联的学生错题记录。`,
      '批量删除确认',
      { type: 'warning' }
    )
    // 批量删除逻辑待实现
    ElMessage.info('批量删除功能待后端支持')
  } catch {
    // 取消
  }
}

// 添加标签
const addTag = (field) => {
  const tag = newTag.value.trim()
  if (!tag) return
  
  const question = questionStore.currentQuestion
  if (!question[field]) {
    question[field] = []
  }
  
  if (!question[field].includes(tag)) {
    question[field].push(tag)
  }
  
  newTag.value = ''
}

// 移除标签
const removeTag = (field, tag) => {
  const question = questionStore.currentQuestion
  if (question[field]) {
    question[field] = question[field].filter(t => t !== tag)
  }
}

// 截断文本
const truncateText = (text, maxLength) => {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN')
}

onMounted(() => {
  questionStore.loadAllQuestions()
})
</script>

<style scoped>
.question-bank-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.header {
  background: #fff;
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-left h2 {
  margin: 0;
  font-size: 20px;
}

.filter-bar {
  background: #fff;
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
}

.filter-left, .filter-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

.stats-bar {
  background: #fff;
  padding: 8px 24px;
  border-bottom: 1px solid #eee;
  font-size: 14px;
  color: #666;
}

.stats-bar span {
  margin-right: 16px;
}

.pagination-bar {
  background: #fff;
  padding: 16px 24px;
  display: flex;
  justify-content: center;
  border-top: 1px solid #eee;
}

.question-title {
  line-height: 1.5;
}

.tags-cell {
  display: flex;
  flex-wrap: wrap;
}

.edit-form {
  max-height: 70vh;
  overflow-y: auto;
}
</style>
