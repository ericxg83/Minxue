<template>
  <div class="wrongbook-workbench">
    <!-- ===== 顶部工具栏 ===== -->
    <header class="workbench-header">
      <div class="header-left">
        <el-button type="info" plain @click="handleBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <ModeSwitcher />
      </div>
      <div class="header-center">
        <el-input
          v-model="searchQueryProxy"
          placeholder="搜索错题内容... (Ctrl+F)"
          clearable
          size="default"
          class="search-input"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button size="default" @click="handleSearch">
          <el-icon><Search /></el-icon>
          搜索
        </el-button>
      </div>
      <div class="header-right">
        <el-button
          v-if="selectedCount > 0"
          type="primary"
          size="default"
          @click="handleBatchPrint"
        >
          <el-icon><Printer /></el-icon>
          打印选中({{ selectedCount }})
        </el-button>
        <el-button
          v-if="selectedCount > 0"
          type="success"
          size="default"
          @click="handleBatchExport"
        >
          <el-icon><Download /></el-icon>
          导出选中({{ selectedCount }})
        </el-button>
        <div class="user-info">
          <el-avatar size="small" :src="userAvatar">{{ userInitial }}</el-avatar>
          <span class="username">{{ userName }}</span>
        </div>
      </div>
    </header>

    <div class="workbench-body">
      <!-- ===== 左侧边栏 ===== -->
      <aside class="left-sidebar">
        <!-- 学生切换 -->
        <StudentSwitcher
          v-model:visible="studentDialogVisible"
          :current-student="wrongBookStore.currentStudent"
          :student-list="studentList"
          :pending-count="wrongBookStore.stats.pending"
          @change-student="handleSwitchStudent"
        />

        <!-- 掌握状态标签 -->
        <StatusTabs
          :active-status="wrongBookStore.filters.status"
          :counts="statusCounts"
          @change-status="handleStatusChange"
        />

        <!-- 统计卡片 -->
        <div class="stats-section">
          <div
            v-for="stat in statsList"
            :key="stat.key"
            class="stat-card"
            :class="{ active: wrongBookStore.filters.status === stat.key }"
            @click="handleStatusChange(stat.key)"
          >
            <div class="stat-value" :style="{ color: stat.color }">
              {{ stat.value }}
            </div>
            <div class="stat-label">{{ stat.label }}</div>
          </div>
        </div>

        <!-- 快速筛选按钮 -->
        <div class="quick-filters">
          <div class="section-title">快速筛选</div>
          <el-button
            v-for="qf in quickFilters"
            :key="qf.key"
            size="small"
            :type="isQuickFilterActive(qf.key) ? 'primary' : 'default'"
            @click="handleQuickFilter(qf.key)"
          >
            {{ qf.label }}
          </el-button>
          <el-button size="small" @click="handleResetFilters">重置筛选</el-button>
        </div>

        <!-- 去重开关和统计 -->
        <div class="dedup-section">
          <div class="section-title">错题去重</div>
          <el-switch
            v-model="dedupEnabledProxy"
            active-text="开启"
            inactive-text="关闭"
            @change="handleDedupToggle"
          />
          <div v-if="wrongBookStore.stats.duplicateCount > 0" class="dedup-stats">
            <span class="dedup-stat-item">
              原始 <el-tag size="small" type="info">{{ wrongBookStore.stats.rawTotal }}</el-tag>
            </span>
            <span class="dedup-stat-arrow">→</span>
            <span class="dedup-stat-item">
              去重 <el-tag size="small" type="success">{{ wrongBookStore.stats.total }}</el-tag>
            </span>
            <span class="dedup-stat-item">
              合并 <el-tag size="small" type="danger">{{ wrongBookStore.stats.duplicateCount }}</el-tag>
            </span>
          </div>
        </div>
      </aside>

      <!-- ===== 主内容区 ===== -->
      <main class="main-content">
        <!-- 筛选工具栏 -->
        <div class="filter-toolbar">
          <div class="toolbar-left">
            <el-select
              v-model="subjectFilter"
              placeholder="科目"
              size="small"
              style="width: 100px"
              @change="val => wrongBookStore.setFilter('subject', val)"
            >
              <el-option label="全部科目" value="all" />
              <el-option label="数学" value="数学" />
              <el-option label="语文" value="语文" />
              <el-option label="英语" value="英语" />
              <el-option label="物理" value="物理" />
              <el-option label="化学" value="化学" />
            </el-select>

            <el-select
              v-model="errorCountFilter"
              placeholder="错误次数"
              size="small"
              style="width: 100px"
              @change="val => wrongBookStore.setFilter('errorCount', val)"
            >
              <el-option label="全部次数" value="all" />
              <el-option label="1次" value="1" />
              <el-option label="2-3次" value="2-3" />
              <el-option label="4-5次" value="4-5" />
              <el-option label="5次以上" value="5+" />
            </el-select>

            <el-select
              v-model="categoryFilter"
              placeholder="分类"
              size="small"
              style="width: 110px"
              @change="val => wrongBookStore.setFilter('category', val)"
            >
              <el-option label="全部分类" value="all" />
              <el-option label="错题" value="wrong" />
              <el-option label="未作答" value="unanswered" />
            </el-select>

            <el-select
              v-model="sortProxy"
              placeholder="排序"
              size="small"
              style="width: 120px"
            >
              <el-option label="最新加入" value="time_desc" />
              <el-option label="最早加入" value="time_asc" />
              <el-option label="错次最多" value="error_desc" />
              <el-option label="错次最少" value="error_asc" />
              <el-option label="按科目" value="subject" />
            </el-select>
          </div>
          <div class="toolbar-right">
            <el-checkbox
              v-model="isAllSelected"
              :indeterminate="isIndeterminate"
              @change="handleSelectAll"
            >
              全选
            </el-checkbox>
            <el-button text size="small" @click="showFilterPanel = !showFilterPanel">
              <el-icon><Filter /></el-icon>
              高级筛选
            </el-button>
          </div>
        </div>

        <!-- 高级筛选面板（抽屉式） -->
        <div v-if="showFilterPanel" class="filter-panel-wrapper">
          <FilterPanel
            :filters="wrongBookStore.filters"
            :sort-by="wrongBookStore.sortBy"
            :all-tags="wrongBookStore.getAllTags"
            @update-filter="handleUpdateFilter"
            @update-sort="handleUpdateSort"
            @reset="handleResetFilters"
            @confirm="showFilterPanel = false"
          />
        </div>

        <!-- 结果信息 -->
        <div class="result-info">
          <span>共 {{ wrongBookStore.filteredQuestions.length }} 道错题</span>
          <span v-if="wrongBookStore.selectedQuestions.length > 0" class="selected-info">
            已选中 {{ wrongBookStore.selectedQuestions.length }} 道
          </span>
        </div>

        <!-- 错题列表 -->
        <div v-loading="wrongBookStore.loading" class="question-list">
          <template v-if="paginatedQuestions.length > 0">
            <WrongQuestionCard
              v-for="wq in paginatedQuestions"
              :key="wq.id"
              :wrong-question="wq"
              :is-selected="isSelected(wq)"
              @toggle-select="wrongBookStore.toggleSelection(wq)"
              @update-status="handleUpdateStatus"
              @edit="handleEditQuestion"
              @delete="handleDeleteQuestion"
              @click="handleSelectQuestion(wq)"
            />
          </template>
          <el-empty v-else description="暂无符合条件的错题" />
        </div>

        <!-- 分页控件 -->
        <div v-if="wrongBookStore.totalPages > 1" class="pagination-wrapper">
          <PaginationBar
            :current-page="wrongBookStore.currentPage"
            :total-pages="wrongBookStore.totalPages"
            :page-size="wrongBookStore.pageSize"
            :total="wrongBookStore.filteredQuestions.length"
            @page-change="handlePageChange"
            @size-change="handleSizeChange"
          />
        </div>
      </main>

      <!-- ===== 右侧详情面板 ===== -->
      <aside v-if="selectedDetailQuestion" class="right-panel" :class="{ 'is-open': !!selectedDetailQuestion }">
        <div class="panel-header">
          <h3>题目详情</h3>
          <el-button text size="small" @click="selectedDetailQuestion = null">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>

        <div class="panel-content">
          <!-- 题目内容 -->
          <div class="detail-section">
            <div class="section-label">题目</div>
            <div class="detail-text">{{ questionDetail.content }}</div>
          </div>

          <!-- 选项 -->
          <div v-if="questionDetail.options?.length" class="detail-section">
            <div class="section-label">选项</div>
            <div class="options-list">
              <div
                v-for="(opt, idx) in questionDetail.options"
                :key="idx"
                class="option-item"
                :class="{
                  'is-correct': String.fromCharCode(65 + idx) === questionDetail.answer,
                  'is-student-answer': String.fromCharCode(65 + idx) === selectedDetailQuestion?.student_answer
                }"
              >
                <span class="option-label">{{ String.fromCharCode(65 + idx) }}.</span>
                <span class="option-text">{{ opt }}</span>
                <el-icon v-if="String.fromCharCode(65 + idx) === questionDetail.answer" class="correct-icon"><CircleCheckFilled /></el-icon>
              </div>
            </div>
          </div>

          <!-- 正确答案 -->
          <div class="detail-section">
            <div class="section-label">正确答案</div>
            <el-tag type="success" size="large">{{ questionDetail.answer }}</el-tag>
          </div>

          <!-- 学生答案 -->
          <div v-if="selectedDetailQuestion?.student_answer" class="detail-section">
            <div class="section-label">学生答案</div>
            <el-tag :type="selectedDetailQuestion.is_correct ? 'success' : 'danger'" size="large">
              {{ selectedDetailQuestion.student_answer }}
            </el-tag>
          </div>

          <!-- 解析 -->
          <div v-if="questionDetail.analysis" class="detail-section">
            <div class="section-label">解析</div>
            <div class="detail-text analysis-text">{{ questionDetail.analysis }}</div>
          </div>

          <!-- 题目信息 -->
          <div class="detail-section">
            <div class="section-label">题目信息</div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="科目">{{ selectedDetailQuestion.subject }}</el-descriptions-item>
              <el-descriptions-item label="分类">{{ selectedDetailQuestion.category }}</el-descriptions-item>
              <el-descriptions-item label="错误次数">{{ selectedDetailQuestion.error_count }}次</el-descriptions-item>
              <el-descriptions-item label="练习次数">{{ selectedDetailQuestion.practice_count }}次</el-descriptions-item>
              <el-descriptions-item label="加入时间">{{ formatDate(selectedDetailQuestion.added_at) }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <!-- 掌握状态操作 -->
          <div class="detail-section">
            <div class="section-label">更新掌握状态</div>
            <div class="status-actions">
              <el-button
                :type="selectedDetailQuestion.status === 'pending' ? 'danger' : 'default'"
                @click="handleStatusUpdate('pending')"
              >
                未掌握
              </el-button>
              <el-button
                :type="selectedDetailQuestion.status === 'partial' ? 'warning' : 'default'"
                @click="handleStatusUpdate('partial')"
              >
                有点掌握
              </el-button>
              <el-button
                :type="selectedDetailQuestion.status === 'mastered' ? 'success' : 'default'"
                @click="handleStatusUpdate('mastered')"
              >
                完全掌握
              </el-button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Search, Printer, Download, Filter, Close, CircleCheckFilled
} from '@element-plus/icons-vue'

// 引入组件
import ModeSwitcher from '../components/shared/ModeSwitcher.vue'
import StudentSwitcher from '../components/wrongbook/StudentSwitcher.vue'
import StatusTabs from '../components/wrongbook/StatusTabs.vue'
import FilterPanel from '../components/wrongbook/FilterPanel.vue'
import WrongQuestionCard from '../components/wrongbook/WrongQuestionCard.vue'
import PaginationBar from '../components/shared/PaginationBar.vue'

// 引入store
import { useWrongBookStore } from '../stores/wrongBookStore'
import { getStudents } from '../../services/apiService'

const router = useRouter()
const wrongBookStore = useWrongBookStore()
const studentList = ref([])

// ===== 状态 =====
const searchQueryProxy = computed({
  get: () => wrongBookStore.searchQuery,
  set: (val) => { wrongBookStore.searchQuery = val }
})

const sortProxy = computed({
  get: () => wrongBookStore.sortBy,
  set: (val) => { wrongBookStore.sortBy = val }
})

const subjectFilter = computed({
  get: () => wrongBookStore.filters.subject,
  set: (val) => wrongBookStore.setFilter('subject', val)
})

const errorCountFilter = computed({
  get: () => wrongBookStore.filters.errorCount,
  set: (val) => wrongBookStore.setFilter('errorCount', val)
})

const categoryFilter = computed({
  get: () => wrongBookStore.filters.category,
  set: (val) => wrongBookStore.setFilter('category', val)
})

const dedupEnabledProxy = computed({
  get: () => wrongBookStore.dedupEnabled,
  set: (val) => wrongBookStore.setDedupEnabled(val)
})

const studentDialogVisible = ref(false)
const showFilterPanel = ref(false)
const selectedDetailQuestion = ref(null)

// ===== 用户信息 =====
const userName = ref('管理员')
const userAvatar = ref('')
const userInitial = computed(() => userName.value.charAt(0))

// ===== 分页数据 =====
const paginatedQuestions = computed(() => wrongBookStore.paginatedQuestions)

// ===== 选中状态 =====
const selectedCount = computed(() => wrongBookStore.selectedQuestions.length)
const isAllSelected = computed(() => {
  const pageQuestions = paginatedQuestions.value
  if (pageQuestions.length === 0) return false
  return pageQuestions.every(q => isSelected(q))
})
const isIndeterminate = computed(() => {
  const pageQuestions = paginatedQuestions.value
  if (pageQuestions.length === 0) return false
  const selectedOnPage = pageQuestions.filter(q => isSelected(q)).length
  return selectedOnPage > 0 && selectedOnPage < pageQuestions.length
})

function isSelected(wq) {
  return wrongBookStore.selectedQuestions.some(sq => sq.id === wq.id)
}

// ===== 状态数量 =====
const statusCounts = computed(() => ({
  all: wrongBookStore.filteredQuestions.length,
  new: wrongBookStore.stats.new,
  review_1: wrongBookStore.stats.review_1,
  review_2: wrongBookStore.stats.review_2,
  mastered: wrongBookStore.stats.mastered
}))

// ===== 统计卡片 =====
const statsList = computed(() => [
  { key: 'all', label: '累计错题', value: wrongBookStore.stats.total, color: '#007aff' },
  { key: 'new', label: '新错题', value: wrongBookStore.stats.new, color: '#ff3b30' },
  { key: 'review_1', label: '第一次重练', value: wrongBookStore.stats.review_1, color: '#ff9500' },
  { key: 'review_2', label: '第二次重练', value: wrongBookStore.stats.review_2, color: '#5856d6' },
  { key: 'mastered', label: '已掌握', value: wrongBookStore.stats.mastered, color: '#34c759' },
  { key: 'pendingMaster', label: '待掌握', value: wrongBookStore.stats.pendingMaster, color: '#ff9500' },
  { key: 'masteryRate', label: '掌握率', value: wrongBookStore.stats.masteryRate + '%', color: '#34c759' }
])

// ===== 快速筛选 =====
const quickFilters = [
  { key: 'error_high', label: '高频错题(3次+)' },
  { key: 'recent', label: '本周新增' },
  { key: 'unanswered', label: '未作答' },
  { key: 'new_status', label: '新错题' },
  { key: 'review_1_status', label: '第一次重练' },
  { key: 'review_2_status', label: '第二次重练' }
]

function isQuickFilterActive(key) {
  const f = wrongBookStore.filters
  switch (key) {
    case 'error_high':
      return f.errorCount === '2-3' || f.errorCount === '4-5' || f.errorCount === '5+'
    case 'recent':
      return f.time === 'week'
    case 'unanswered':
      return f.category === 'unanswered'
    case 'new_status':
      return f.lifecycleStatus === 'new'
    case 'review_1_status':
      return f.lifecycleStatus === 'review_1'
    case 'review_2_status':
      return f.lifecycleStatus === 'review_2'
    case 'not_practice':
      return false
    default:
      return false
  }
}

function handleQuickFilter(key) {
  switch (key) {
    case 'error_high':
      if (wrongBookStore.filters.errorCount === '2-3') {
        wrongBookStore.setFilter('errorCount', '4-5')
      } else if (wrongBookStore.filters.errorCount === '4-5') {
        wrongBookStore.setFilter('errorCount', '5+')
      } else {
        wrongBookStore.setFilter('errorCount', '2-3')
      }
      break
    case 'recent':
      wrongBookStore.setFilter('time', wrongBookStore.filters.time === 'week' ? 'all' : 'week')
      break
    case 'unanswered':
      wrongBookStore.setFilter('category', wrongBookStore.filters.category === 'unanswered' ? 'all' : 'unanswered')
      break
    case 'new_status':
      wrongBookStore.setFilter('lifecycleStatus', wrongBookStore.filters.lifecycleStatus === 'new' ? 'all' : 'new')
      break
    case 'review_1_status':
      wrongBookStore.setFilter('lifecycleStatus', wrongBookStore.filters.lifecycleStatus === 'review_1' ? 'all' : 'review_1')
      break
    case 'review_2_status':
      wrongBookStore.setFilter('lifecycleStatus', wrongBookStore.filters.lifecycleStatus === 'review_2' ? 'all' : 'review_2')
      break
    case 'not_practice':
      ElMessage.info('筛选未练习题功能开发中')
      break
  }
}

// ===== 题目详情 =====
const questionDetail = computed(() => {
  if (!selectedDetailQuestion.value) return {}
  const q = selectedDetailQuestion.value.question || selectedDetailQuestion.value
  return q
})

// ===== 方法 =====

// 返回
function handleBack() {
  window.location.href = '/'
}

// 切换学生
function handleSwitchStudent(student) {
  wrongBookStore.setCurrentStudent(student)
  wrongBookStore.loadWrongQuestions(student.id)
  selectedDetailQuestion.value = null
  wrongBookStore.clearSelection()
}

// 切换状态
function handleStatusChange(status) {
  wrongBookStore.setFilter('status', status)
}

// 全选
function handleSelectAll() {
  wrongBookStore.selectAll()
}

// 搜索
function handleSearch() {
  wrongBookStore.currentPage = 1
  if (wrongBookStore.searchQuery) {
    ElMessage.info(`搜索 "${wrongBookStore.searchQuery}" 的结果`)
  }
}

// 更新筛选
function handleUpdateFilter(key, value) {
  wrongBookStore.setFilter(key, value)
}

// 更新排序
function handleUpdateSort(value) {
  wrongBookStore.sortBy = value
}

// 重置筛选
function handleResetFilters() {
  wrongBookStore.resetFilters()
  showFilterPanel.value = false
  ElMessage.success('已重置筛选条件')
}

// 去重开关切换
function handleDedupToggle(enabled) {
  wrongBookStore.setDedupEnabled(enabled)
  const count = wrongBookStore.stats.duplicateCount
  if (enabled && count > 0) {
    ElMessage.success(`已合并 ${count} 道重复错题，学生现在看到的是知识漏洞`)
  } else if (!enabled) {
    ElMessage.info('已关闭去重，显示所有错题记录')
  }
}

// 分页
function handlePageChange(page) {
  wrongBookStore.currentPage = page
}

function handleSizeChange(size) {
  wrongBookStore.pageSize = size
  wrongBookStore.currentPage = 1
}

// 选择题目查看详情
function handleSelectQuestion(wq) {
  selectedDetailQuestion.value = wq
}

// 更新状态
async function handleUpdateStatus(wq, newStatus) {
  const success = await wrongBookStore.updateStatus(wq.id, newStatus)
  if (success) {
    ElMessage.success('状态已更新')
    if (selectedDetailQuestion.value?.id === wq.id) {
      selectedDetailQuestion.value = { ...selectedDetailQuestion.value, status: newStatus }
    }
  } else {
    ElMessage.error('状态更新失败')
  }
}

function handleStatusUpdate(status) {
  if (!selectedDetailQuestion.value) return
  handleUpdateStatus(selectedDetailQuestion.value, status)
}

// 编辑题目
function handleEditQuestion(wq) {
  ElMessage.info('编辑功能开发中')
}

// 删除题目
async function handleDeleteQuestion(wq) {
  try {
    await ElMessageBox.confirm('确定要删除这道错题吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const success = await wrongBookStore.deleteQuestion(wq.id)
    if (success) {
      ElMessage.success('删除成功')
      if (selectedDetailQuestion.value?.id === wq.id) {
        selectedDetailQuestion.value = null
      }
    } else {
      ElMessage.error('删除失败')
    }
  } catch {
    // 取消
  }
}

// 批量打印
function handleBatchPrint() {
  ElMessage.info(`打印 ${wrongBookStore.selectedQuestions.length} 道选中的错题`)
}

// 批量导出
function handleBatchExport() {
  ElMessage.info(`导出 ${wrongBookStore.selectedQuestions.length} 道选中的错题`)
}

// 日期格式化
function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// ===== 键盘快捷键 =====
function handleKeyDown(e) {
  // Ctrl+F - 聚焦搜索
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault()
    document.querySelector('.search-input input')?.focus()
  }
  // Ctrl+S - 保存（预留）
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault()
    ElMessage.info('保存功能开发中')
  }
  // Ctrl+P - 打印
  if (e.ctrlKey && e.key === 'p') {
    e.preventDefault()
    if (wrongBookStore.selectedQuestions.length > 0) {
      handleBatchPrint()
    } else {
      ElMessage.info('请先选择要打印的错题')
    }
  }
  // Esc - 关闭详情面板
  if (e.key === 'Escape') {
    if (selectedDetailQuestion.value) {
      selectedDetailQuestion.value = null
    } else if (showFilterPanel.value) {
      showFilterPanel.value = false
    } else if (studentDialogVisible.value) {
      studentDialogVisible.value = false
    }
  }
  // 方向键翻页
  if (e.key === 'ArrowLeft' && wrongBookStore.currentPage > 1) {
    e.preventDefault()
    wrongBookStore.currentPage--
  }
  if (e.key === 'ArrowRight' && wrongBookStore.currentPage < wrongBookStore.totalPages) {
    e.preventDefault()
    wrongBookStore.currentPage++
  }
}

// ===== 初始化 =====
onMounted(async () => {
  try {
    // 加载学生列表
    const result = await getStudents(false)
    const list = result.data || result || []
    studentList.value = Array.isArray(list) ? list : []

    // 默认选择第一个学生并加载数据
    if (studentList.value.length > 0 && !wrongBookStore.currentStudent) {
      wrongBookStore.setCurrentStudent(studentList.value[0])
      await wrongBookStore.loadWrongQuestions(studentList.value[0].id)
    }
  } catch (e) {
    console.error('加载学生列表失败:', e)
  }

  // 注册键盘快捷键
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})
</script>

<style scoped>
/* ===== 整体布局 ===== */
.wrongbook-workbench {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  overflow: hidden;
}

/* ===== 顶部工具栏 ===== */
.workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  gap: 16px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-center {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 500px;
}

.search-input {
  flex: 1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 12px;
  border-left: 1px solid #e5e7eb;
}

.username {
  font-size: 14px;
  color: #374151;
  font-weight: 500;
}

/* ===== 主体区域 ===== */
.workbench-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ===== 左侧边栏 ===== */
.left-sidebar {
  width: 280px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

/* 统计卡片 */
.stats-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
}

.stat-card {
  padding: 12px;
  border-radius: 10px;
  background: #f9fafb;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.stat-card:hover {
  background: #f0f7ff;
}

.stat-card.active {
  border-color: var(--el-color-primary);
  background: #e8f4fd;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

/* 快速筛选 */
.quick-filters {
  padding: 16px;
}

.quick-filters .section-title {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 12px;
}

.quick-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-filters .el-button {
  justify-content: flex-start;
}

/* 去重区域 */
.dedup-section {
  padding: 16px;
  border-top: 1px solid #e5e7eb;
}

.dedup-section .section-title {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 12px;
}

.dedup-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px;
  background: #f9fafb;
  border-radius: 8px;
}

.dedup-stat-item {
  font-size: 12px;
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 4px;
}

.dedup-stat-arrow {
  font-size: 14px;
  color: #9ca3af;
}

/* ===== 主内容区 ===== */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* 筛选工具栏 */
.filter-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 高级筛选面板 */
.filter-panel-wrapper {
  border-bottom: 1px solid #e5e7eb;
}

/* 结果信息 */
.result-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  font-size: 13px;
  color: #6b7280;
  background: #fafafa;
}

.selected-info {
  color: var(--el-color-primary);
  font-weight: 500;
}

/* 错题列表 */
.question-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 分页 */
.pagination-wrapper {
  display: flex;
  justify-content: center;
  padding: 16px;
  background: #fff;
  border-top: 1px solid #e5e7eb;
}

/* ===== 右侧详情面板 ===== */
.right-panel {
  width: 0;
  overflow: hidden;
  background: #fff;
  border-left: 1px solid #e5e7eb;
  transition: width 0.3s ease;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.right-panel.is-open {
  width: 380px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* 详情区块 */
.detail-section {
  margin-bottom: 20px;
}

.section-label {
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-text {
  font-size: 15px;
  color: #111827;
  line-height: 1.7;
  white-space: pre-wrap;
}

.analysis-text {
  background: #f9fafb;
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
}

/* 选项列表 */
.options-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f9fafb;
  font-size: 14px;
}

.option-item.is-correct {
  background: #ecfdf5;
  border: 1px solid #6ee7b7;
}

.option-item.is-student-answer {
  background: #fef2f2;
  border: 1px solid #fca5a5;
}

.option-label {
  font-weight: 600;
  color: #6b7280;
  flex-shrink: 0;
}

.option-text {
  flex: 1;
}

.correct-icon {
  color: #10b981;
  font-size: 16px;
  flex-shrink: 0;
}

/* 状态操作 */
.status-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-actions .el-button {
  width: 100%;
  justify-content: flex-start;
}

/* 滚动条样式 */
.question-list::-webkit-scrollbar,
.panel-content::-webkit-scrollbar,
.left-sidebar::-webkit-scrollbar {
  width: 6px;
}

.question-list::-webkit-scrollbar-track,
.panel-content::-webkit-scrollbar-track,
.left-sidebar::-webkit-scrollbar-track {
  background: transparent;
}

.question-list::-webkit-scrollbar-thumb,
.panel-content::-webkit-scrollbar-thumb,
.left-sidebar::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 3px;
}

.question-list::-webkit-scrollbar-thumb:hover,
.panel-content::-webkit-scrollbar-thumb:hover,
.left-sidebar::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}
</style>
