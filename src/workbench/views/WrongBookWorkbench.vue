<template>
  <div class="wrongbook-workbench">
    <!-- 顶部 Header 栏 -->
    <header class="top-header">
      <div class="top-header__left">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" class="logo-icon" width="24" height="24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#1677FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="logo-text">敏学成长工作台</span>
        </div>
      </div>
      <div class="top-header__right">
        <div class="header-icon-btn" title="通知">
          <el-icon><Bell /></el-icon>
          <span class="header-badge">12</span>
        </div>
        <div class="header-icon-btn" title="帮助中心">
          <el-icon><QuestionFilled /></el-icon>
          <span class="header-icon-label">帮助中心</span>
        </div>
        <div class="header-user">
          <el-avatar :size="32" src="https://api.dicebear.com/7.x/avataaars/svg?seed=admin" />
          <span class="header-user-name">管理员</span>
          <el-icon class="header-dropdown-icon"><ArrowDown /></el-icon>
        </div>
      </div>
    </header>

    <!-- 三栏主内容区 -->
    <div class="main-layout">
      <!-- 第一栏：系统导航 -->
      <aside class="nav-sidebar">
        <div class="nav-menu">
          <div
            v-for="menu in navMenus"
            :key="menu.key"
            class="nav-menu-item"
            :class="{ 'nav-menu-item--active': currentMenu === menu.key, 'nav-menu-item--disabled': menu.disabled }"
            @click="handleNavMenuClick(menu.key)"
          >
            <div class="nav-menu-item__icon">
              <el-icon><component :is="menu.icon" /></el-icon>
            </div>
            <span class="nav-menu-item__text">{{ menu.label }}</span>
            <span v-if="menu.key === 'exam-import'" class="dev-badge">开发中</span>
          </div>
        </div>
      </aside>

      <!-- 第二栏：错题列表 -->
      <aside class="question-panel">
        <div class="question-panel__header">
          <span class="question-panel__title">错题库</span>
          <el-icon class="question-panel__close" @click="handleBack"><Close /></el-icon>
        </div>
        <div class="question-panel__search">
          <el-input
            v-model="searchQueryProxy"
            placeholder="搜索题目、知识点、题干"
            :prefix-icon="Search"
            clearable
            size="default"
          />
          <el-icon class="search-filter-icon"><Filter /></el-icon>
        </div>
        <div class="question-panel__filters">
          <el-dropdown trigger="click" @command="handleSubjectFilter">
            <span class="filter-tag">科目 <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="all">全部科目</el-dropdown-item>
                <el-dropdown-item command="数学">数学</el-dropdown-item>
                <el-dropdown-item command="语文">语文</el-dropdown-item>
                <el-dropdown-item command="英语">英语</el-dropdown-item>
                <el-dropdown-item command="物理">物理</el-dropdown-item>
                <el-dropdown-item command="化学">化学</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click" @command="handleGradeFilter">
            <span class="filter-tag">年级 <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="all">全部年级</el-dropdown-item>
                <el-dropdown-item command="初一">初一</el-dropdown-item>
                <el-dropdown-item command="初二">初二</el-dropdown-item>
                <el-dropdown-item command="初三">初三</el-dropdown-item>
                <el-dropdown-item command="高一">高一</el-dropdown-item>
                <el-dropdown-item command="高二">高二</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click" @command="handleTagFilter">
            <span class="filter-tag">知识点 <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="all">全部知识点</el-dropdown-item>
                <el-dropdown-item
                  v-for="tag in wrongBookStore.getAllTags"
                  :key="tag"
                  :command="tag"
                >{{ tag }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click" @command="handleMoreFilter">
            <span class="filter-tag">更多筛选 <el-icon><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="error_high">高频错题</el-dropdown-item>
                <el-dropdown-item command="recent">本周新增</el-dropdown-item>
                <el-dropdown-item command="unanswered">未作答</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="question-panel__count">共 {{ filteredQuestions.length }} 道错题</div>
        <div class="question-panel__list">
          <div
            v-for="wq in paginatedQuestions"
            :key="wq.id"
            class="question-card"
            :class="{ 'question-card--active': selectedDetailQuestion?.id === wq.id }"
            @click="handleSelectQuestion(wq)"
          >
            <div class="question-card__body">
              <div class="question-card__subject">
                <span class="subject-tag" :style="{ background: getSubjectColor(wq.subject) }">{{ wq.subject }}</span>
              </div>
              <div class="question-card__title">{{ getQuestionTitle(wq) }}</div>
              <div class="question-card__meta">
                <span class="question-card__grade">{{ getQuestionGrade(wq) }}</span>
                <span class="question-card__tag">{{ getQuestionTag(wq) }}</span>
              </div>
              <div class="question-card__bottom">
                <div class="question-card__error">
                  <el-icon class="error-icon"><WarningFilled /></el-icon>
                  被错 {{ getErrorCount(wq) }} 次
                </div>
                <div class="question-card__time">{{ getQuestionTime(wq) }}</div>
              </div>
            </div>
            <div class="question-card__thumb">
              <img v-if="getQuestionThumb(wq)" :src="getQuestionThumb(wq)" alt="题目" />
              <div v-else class="thumb-placeholder">
                <el-icon><Picture /></el-icon>
              </div>
            </div>
          </div>
        </div>
        <div class="question-panel__pagination" v-if="totalPages > 1">
          <el-pagination
            :current-page="currentPageProxy"
            :page-size="17"
            :total="filteredQuestions.length"
            layout="prev, pager, next"
            small
            @current-change="handlePageChange"
          />
        </div>
      </aside>

      <!-- 第三栏：题目详情区 -->
      <section class="detail-workspace" v-if="selectedDetailQuestion">
        <!-- 顶部信息栏 -->
        <div class="detail-header">
          <div class="detail-header__left">
            <span class="detail-subject-tag" :style="{ background: getSubjectColor(selectedDetailQuestion.subject) }">
              {{ selectedDetailQuestion.subject }}
            </span>
            <span class="detail-title">{{ getQuestionTitle(selectedDetailQuestion) }}</span>
            <span class="detail-error-count">
              <el-icon class="detail-error-icon"><WarningFilled /></el-icon>
              被错 {{ getErrorCount(selectedDetailQuestion) }} 次
            </span>
          </div>
          <div class="detail-header__meta">
            <span class="detail-meta-text">{{ getQuestionGrade(selectedDetailQuestion) }} · {{ getQuestionTag(selectedDetailQuestion) }} · 更新于：{{ getFullTime(selectedDetailQuestion) }}</span>
          </div>
          <div class="detail-header__actions">
            <el-button size="small" @click="handleEditQuestion(selectedDetailQuestion)">编辑题目</el-button>
            <el-dropdown trigger="click">
              <el-button size="small">
                更多操作 <el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="handleDeleteQuestion(selectedDetailQuestion)">删除</el-dropdown-item>
                  <el-dropdown-item @click="handlePrintQuestion(selectedDetailQuestion)">打印</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>

        <!-- 题目内容区 -->
        <div class="detail-content-area">
          <div class="detail-section">
            <div class="detail-section__label">题目内容</div>
            <div class="detail-section__content question-content-box">
              <div v-if="getQuestionContent(selectedDetailQuestion)" class="question-text">
                <MathRender :content="getQuestionContent(selectedDetailQuestion)" />
              </div>
              <div v-if="getQuestionOptions(selectedDetailQuestion)?.length" class="question-options">
                <div
                  v-for="(opt, idx) in getQuestionOptions(selectedDetailQuestion)"
                  :key="idx"
                  class="option-item"
                  :class="{ 'option-item--correct': String.fromCharCode(65 + idx) === getQuestionAnswer(selectedDetailQuestion) }"
                >
                  <span class="option-label">{{ String.fromCharCode(65 + idx) }}.</span>
                  <span class="option-text">{{ opt }}</span>
                </div>
              </div>
              <img v-if="getQuestionThumb(selectedDetailQuestion)" :src="getQuestionThumb(selectedDetailQuestion)" class="question-thumb-img" />
            </div>
          </div>

          <div class="detail-section">
            <div class="detail-section__label">正确答案</div>
            <div class="detail-section__content answer-box">
              {{ getQuestionAnswer(selectedDetailQuestion) || '-' }}
            </div>
          </div>

          <div class="detail-section">
            <div class="detail-section__label">知识点</div>
            <div class="detail-section__content">
              <el-tag
                v-for="tag in getQuestionTags(selectedDetailQuestion)"
                :key="tag"
                class="knowledge-tag"
                size="default"
              >{{ tag }}</el-tag>
              <span v-if="!getQuestionTags(selectedDetailQuestion).length" class="empty-text">暂无</span>
            </div>
          </div>

          <div class="detail-section">
            <div class="detail-section__label">解析</div>
            <div class="detail-section__content analysis-box">
              <MathRender :content="getQuestionAnalysis(selectedDetailQuestion) || '暂无解析'" />
            </div>
          </div>
        </div>

        <!-- 错题统计 -->
        <div class="detail-stats-area">
          <div class="detail-stats__title">错题统计</div>
          <div class="detail-stats__grid">
            <div class="stat-box">
              <div class="stat-box__label">被错次数</div>
              <div class="stat-box__value">{{ getErrorCount(selectedDetailQuestion) }} <span class="stat-box__unit">次</span></div>
              <div class="stat-box__change">较上周 <span class="change-up">+{{ getWeekIncrease(selectedDetailQuestion) }}</span></div>
            </div>
            <div class="stat-box">
              <div class="stat-box__label">错题学生数</div>
              <div class="stat-box__value">{{ getWrongStudentCount(selectedDetailQuestion) }} <span class="stat-box__unit">人</span></div>
              <div class="stat-box__change">较上周 <span class="change-up">+{{ getWeekStudentIncrease() }}</span></div>
            </div>
            <div class="stat-box">
              <div class="stat-box__label">最近错题时间</div>
              <div class="stat-box__value">{{ getLatestWrongTime(selectedDetailQuestion) }}</div>
              <div class="stat-box__change">较上周 <span class="change-up">+{{ getDaysSinceLastWeek() }}天</span></div>
            </div>
            <div class="stat-box">
              <div class="stat-box__label">正确率</div>
              <div class="stat-box__value">{{ getAccuracyRate(selectedDetailQuestion) }}%</div>
              <div class="stat-box__change">较上周 <span class="change-down">-{{ getAccuracyDrop() }}%</span></div>
            </div>
          </div>
        </div>

        <!-- 最近错题学生 -->
        <div class="recent-students-area">
          <div class="recent-students__header">
            <span class="recent-students__title">最近错题学生</span>
            <span class="recent-students__more">查看更多 <el-icon><ArrowRight /></el-icon></span>
          </div>
          <div class="recent-students__list">
            <div v-for="student in getRecentStudents()" :key="student.id" class="recent-student-card">
              <el-avatar :size="40" :src="student.avatar">
                {{ student.name.charAt(0) }}
              </el-avatar>
              <div class="recent-student__info">
                <div class="recent-student__name">{{ student.name }}</div>
                <div class="recent-student__class">{{ student.class }}</div>
              </div>
              <div class="recent-student__time">{{ student.time }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 未选择题目时的空状态 -->
      <section class="detail-workspace" v-else>
        <div class="empty-detail-state">
          <el-empty description="请从左侧选择一道错题查看详情" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Bell, QuestionFilled, ArrowDown, ArrowRight, Search, Filter, Close,
  WarningFilled, Picture
} from '@element-plus/icons-vue'
import { useWrongBookStore } from '../stores/wrongBookStore'
import { getStudents } from '../../services/apiService'
import dayjs from 'dayjs'
import MathRender from "../components/MathRender.vue"

const router = useRouter()
const wrongBookStore = useWrongBookStore()

// ===== 导航菜单 =====
const currentMenu = ref('wrong-book')
const navMenus = [
  { key: 'proofread', label: '题目校对', icon: 'DocumentChecked' },
  { key: 'wrong-book', label: '错题管理', icon: 'Collection' },
  { key: 'growth', label: '成长中心', icon: 'TrendCharts' },
  { key: 'exam-import', label: '试卷入库', icon: 'UploadFilled', disabled: true },
]

const handleNavMenuClick = (key) => {
  const menu = navMenus.find(m => m.key === key)
  if (menu?.disabled) return
  currentMenu.value = key
  const routeMap = {
    'proofread': '/',
    'wrong-book': '/wrongbook',
    'growth': '/growth',
    'exam-import': '/paper',
  }
  if (routeMap[key] && routeMap[key] !== router.currentRoute.value.path) {
    router.push(routeMap[key])
  }
}

// ===== 搜索 =====
const searchQueryProxy = computed({
  get: () => wrongBookStore.searchQuery,
  set: (val) => { wrongBookStore.searchQuery = val }
})

// ===== 分页 =====
const currentPageProxy = computed({
  get: () => wrongBookStore.currentPage,
  set: (val) => { wrongBookStore.currentPage = val }
})

const PAGE_SIZE = 17
wrongBookStore.pageSize = PAGE_SIZE

const filteredQuestions = computed(() => wrongBookStore.filteredQuestions)
const paginatedQuestions = computed(() => wrongBookStore.paginatedQuestions)
const totalPages = computed(() => Math.ceil(filteredQuestions.value.length / PAGE_SIZE))

const handlePageChange = (page) => {
  wrongBookStore.currentPage = page
}

// ===== 选中题目 =====
const selectedDetailQuestion = ref(null)

const handleSelectQuestion = (wq) => {
  selectedDetailQuestion.value = wq
}

// ===== 题目数据获取 =====
const getQuestion = (wq) => wq?.question || wq || {}

const getQuestionTitle = (wq) => {
  const q = getQuestion(wq)
  const content = q.content || wq.content || ''
  return content.length > 50 ? content.substring(0, 50) + '...' : content
}

const getQuestionContent = (wq) => {
  const q = getQuestion(wq)
  return q.content || wq.content || ''
}

const getQuestionOptions = (wq) => {
  const q = getQuestion(wq)
  return q.options || wq.options || []
}

const getQuestionAnswer = (wq) => {
  const q = getQuestion(wq)
  return q.answer || wq.answer || ''
}

const getQuestionTags = (wq) => {
  const q = getQuestion(wq)
  const tagsSource = q.tags_source || 'ai'
  return tagsSource === 'manual' ? (q.manual_tags || []) : (q.ai_tags || q.tags || [])
}

const getQuestionAnalysis = (wq) => {
  const q = getQuestion(wq)
  return q.analysis || wq.analysis || ''
}

const getQuestionTag = (wq) => {
  const tags = getQuestionTags(wq)
  return tags.length > 0 ? tags[0] : '-'
}

const getQuestionGrade = (wq) => {
  const q = getQuestion(wq)
  return q.grade || wq.grade || '-'
}

const getQuestionSubject = (wq) => {
  return wq?.subject || getQuestion(wq)?.subject || '-'
}

const getQuestionThumb = (wq) => {
  const q = getQuestion(wq)
  return q.image_url || q.thumbnail || q.originalImage || wq.image_url || wq.thumbnail || ''
}

const getErrorCount = (wq) => {
  return wq?.error_count || 1
}

const getQuestionTime = (wq) => {
  const time = wq?.added_at || wq?.created_at
  if (!time) return '-'
  const d = dayjs(time)
  const now = dayjs()
  if (d.isSame(now, 'day')) return `今天 ${d.format('HH:mm')}`
  if (d.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${d.format('HH:mm')}`
  return d.format('MM-DD HH:mm')
}

const getFullTime = (wq) => {
  const time = wq?.added_at || wq?.created_at
  if (!time) return '-'
  return dayjs(time).format('YYYY-MM-DD HH:mm')
}

const getSubjectColor = (subject) => {
  const colorMap = {
    '数学': '#1677FF',
    '语文': '#FA8C16',
    '英语': '#52C41A',
    '物理': '#722ED1',
    '化学': '#13C2C2',
  }
  return colorMap[subject] || '#86909C'
}

// ===== 统计数据 =====
const getWeekIncrease = (wq) => {
  return Math.floor(Math.random() * 5) + 1
}

const getWrongStudentCount = (wq) => {
  return Math.floor(Math.random() * 30) + 10
}

const getWeekStudentIncrease = () => {
  return Math.floor(Math.random() * 5) + 1
}

const getLatestWrongTime = (wq) => {
  return getQuestionTime(wq)
}

const getAccuracyRate = (wq) => {
  return Math.floor(Math.random() * 40) + 30
}

const getAccuracyDrop = () => {
  return Math.floor(Math.random() * 10) + 1
}

const getDaysSinceLastWeek = () => {
  return Math.floor(Math.random() * 3) + 1
}

// ===== 最近错题学生 =====
const getRecentStudents = () => {
  const baseStudents = [
    { id: 1, name: '蔡怡希', class: '初二(3)班', time: '刚刚', avatar: '' },
    { id: 2, name: '张小明', class: '初二(3)班', time: '16:30', avatar: '' },
    { id: 3, name: '李佳怡', class: '初二(2)班', time: '15:40', avatar: '' },
    { id: 4, name: '王浩然', class: '初二(1)班', time: '昨天 21:15', avatar: '' },
    { id: 5, name: '刘思涵', class: '初二(1)班', time: '昨天 20:10', avatar: '' },
  ]
  return baseStudents
}

// ===== 筛选 =====
const handleSubjectFilter = (val) => {
  wrongBookStore.setFilter('subject', val)
}

const handleGradeFilter = (val) => {
  wrongBookStore.setFilter('grade', val)
}

const handleTagFilter = (val) => {
  wrongBookStore.setFilter('tag', val)
}

const handleMoreFilter = (cmd) => {
  switch (cmd) {
    case 'error_high':
      wrongBookStore.setFilter('errorCount', wrongBookStore.filters.errorCount === '2-3' ? '4-5' : '2-3')
      break
    case 'recent':
      wrongBookStore.setFilter('time', wrongBookStore.filters.time === 'week' ? 'all' : 'week')
      break
    case 'unanswered':
      wrongBookStore.setFilter('category', wrongBookStore.filters.category === 'unanswered' ? 'all' : 'unanswered')
      break
  }
}

// ===== 操作 =====
const handleBack = () => {
  router.push('/')
}

const handleEditQuestion = (wq) => {
  ElMessage.info('编辑功能开发中')
}

const handleDeleteQuestion = async (wq) => {
  try {
    await ElMessageBox.confirm('确定要删除这道错题吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const success = await wrongBookStore.deleteQuestion(wq.id)
    if (success) {
      ElMessage.success('删除成功')
      if (selectedDetailQuestion.value?.id === wq.id) {
        selectedDetailQuestion.value = null
      }
    }
  } catch {
    // 取消
  }
}

const handlePrintQuestion = (wq) => {
  ElMessage.info('打印功能开发中')
}

// ===== 初始化 =====
onMounted(async () => {
  try {
    const result = await getStudents(false)
    const list = result.data || result || []
    if (list.length > 0 && !wrongBookStore.currentStudent) {
      wrongBookStore.setCurrentStudent(list[0])
      await wrongBookStore.loadWrongQuestions(list[0].id)
    }
  } catch (e) {
    console.error('加载学生列表失败:', e)
  }
})

onUnmounted(() => {
  // cleanup
})
</script>

<style scoped>
/* ===== CSS Variables ===== */
.wrongbook-workbench {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== Top Header ===== */
.top-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  flex-shrink: 0;
}

.top-header__left {
  display: flex;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-icon {
  width: 24px;
  height: 24px;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}

.top-header__right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.header-icon-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: #4E5969;
  font-size: 14px;
  transition: background 0.2s;
  position: relative;
}

.header-icon-btn:hover {
  background: #F2F3F5;
}

.header-icon-btn .el-icon {
  font-size: 18px;
}

.header-badge {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #F53F3F;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
}

.header-icon-label {
  font-size: 13px;
}

.header-user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.header-user:hover {
  background: #F2F3F5;
}

.header-user-name {
  font-size: 13px;
  color: #1D2129;
}

.header-dropdown-icon {
  font-size: 12px;
  color: #86909C;
}

/* ===== Main Layout ===== */
.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Nav Sidebar (第一栏: 220px) ===== */
.nav-sidebar {
  width: 220px;
  background: #fff;
  border-right: 1px solid #E5E6EB;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  color: #4E5969;
}

.nav-menu-item:hover {
  background: #F2F3F5;
}

.nav-menu-item--active {
  background: #E8F3FF;
  color: #1677FF;
  font-weight: 500;
}

.nav-menu-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 18px;
}

.nav-menu-item__text {
  flex: 1;
}

.nav-menu-item--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.dev-badge {
  display: inline-block;
  padding: 1px 6px;
  background: #FFF7E6;
  color: #FA8C16;
  font-size: 10px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
  border: 1px solid #FFD591;
}

/* ===== Question Panel (第二栏: ~320px) ===== */
.question-panel {
  width: 340px;
  background: #F5F7FA;
  border-right: 1px solid #E5E6EB;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.question-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 8px;
}

.question-panel__title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
}

.question-panel__close {
  font-size: 16px;
  color: #86909C;
  cursor: pointer;
}

.question-panel__close:hover {
  color: #1D2129;
}

.question-panel__search {
  display: flex;
  align-items: center;
  padding: 0 16px 8px;
  gap: 8px;
}

.question-panel__search :deep(.el-input) {
  flex: 1;
}

.search-filter-icon {
  font-size: 18px;
  color: #86909C;
  cursor: pointer;
  flex-shrink: 0;
}

.search-filter-icon:hover {
  color: #1677FF;
}

.question-panel__filters {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px 8px;
  flex-wrap: wrap;
}

.filter-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px 10px;
  background: #fff;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  font-size: 12px;
  color: #4E5969;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.filter-tag:hover {
  border-color: #1677FF;
  color: #1677FF;
}

.filter-tag .el-icon {
  font-size: 12px;
}

.question-panel__count {
  padding: 0 16px 8px;
  font-size: 12px;
  color: #86909C;
}

.question-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 8px;
}

/* Question Card */
.question-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.question-card:hover {
  border-color: #B4D6FF;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.08);
}

.question-card--active {
  border-color: #1677FF;
  background: #E8F3FF;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.12);
}

.question-card__body {
  flex: 1;
  min-width: 0;
}

.question-card__subject {
  margin-bottom: 4px;
}

.subject-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  color: #fff;
  font-weight: 500;
}

.question-card__title {
  font-size: 13px;
  font-weight: 500;
  color: #1D2129;
  line-height: 1.4;
  margin-bottom: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.question-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.question-card__grade {
  font-size: 11px;
  color: #86909C;
}

.question-card__tag {
  font-size: 11px;
  color: #86909C;
}

.question-card__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.question-card__error {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: #F53F3F;
}

.error-icon {
  font-size: 12px;
}

.question-card__time {
  font-size: 11px;
  color: #C9CDD4;
}

.question-card__thumb {
  width: 60px;
  height: 60px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #F2F3F5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.question-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #C9CDD4;
}

.thumb-placeholder .el-icon {
  font-size: 24px;
}

/* Pagination */
.question-panel__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  border-top: 1px solid #E5E6EB;
  background: #fff;
}

.question-panel__pagination :deep(.el-pagination) {
  font-size: 13px;
}

/* ===== Detail Workspace (第三栏: 自适应) ===== */
.detail-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #F5F7FA;
  overflow-y: auto;
}

.empty-detail-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Detail Header */
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  flex-shrink: 0;
  gap: 16px;
}

.detail-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.detail-subject-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: #fff;
  font-weight: 500;
  flex-shrink: 0;
}

.detail-title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-error-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #F53F3F;
  flex-shrink: 0;
}

.detail-error-icon {
  font-size: 14px;
}

.detail-header__meta {
  flex-shrink: 0;
}

.detail-meta-text {
  font-size: 12px;
  color: #86909C;
}

.detail-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Detail Content Area */
.detail-content-area {
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-section {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.detail-section__label {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  border-bottom: 1px solid #E5E6EB;
}

.detail-section__content {
  padding: 16px;
}

.question-content-box {
  line-height: 1.8;
  font-size: 15px;
  color: #1D2129;
}

.question-text {
  margin-bottom: 12px;
}

.question-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #F9FAFB;
  border-radius: 8px;
  border: 1px solid #E5E6EB;
  font-size: 14px;
  color: #1D2129;
}

.option-item--correct {
  background: #F0FFF4;
  border-color: #86EFAC;
}

.option-label {
  font-weight: 600;
  color: #6B7280;
  flex-shrink: 0;
}

.option-text {
  flex: 1;
}

.question-thumb-img {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 8px;
}

.answer-box {
  font-size: 16px;
  font-weight: 600;
  color: #22C55E;
  background: #F0FFF4;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #B2F5EA;
}

.knowledge-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}

.empty-text {
  font-size: 13px;
  color: #C9CDD4;
}

.analysis-box {
  font-size: 14px;
  color: #4E5969;
  line-height: 1.8;
  white-space: pre-wrap;
}

/* Stats Area */
.detail-stats-area {
  margin: 0 24px 16px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  padding: 16px;
}

.detail-stats__title {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  margin-bottom: 12px;
}

.detail-stats__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-box {
  padding: 12px;
  background: #F9FAFB;
  border-radius: 8px;
}

.stat-box__label {
  font-size: 12px;
  color: #86909C;
  margin-bottom: 6px;
}

.stat-box__value {
  font-size: 22px;
  font-weight: 700;
  color: #1D2129;
  line-height: 1.2;
}

.stat-box__unit {
  font-size: 13px;
  font-weight: 400;
  color: #86909C;
}

.stat-box__change {
  font-size: 11px;
  color: #86909C;
  margin-top: 4px;
}

.change-up {
  color: #F53F3F;
  font-weight: 500;
}

.change-down {
  color: #52C41A;
  font-weight: 500;
}

/* Recent Students Area */
.recent-students-area {
  margin: 0 24px 16px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #E5E6EB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  padding: 16px;
}

.recent-students__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.recent-students__title {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
}

.recent-students__more {
  font-size: 12px;
  color: #1677FF;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 2px;
}

.recent-students__list {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.recent-student-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 80px;
  cursor: pointer;
  transition: transform 0.2s;
}

.recent-student-card:hover {
  transform: translateY(-2px);
}

.recent-student__info {
  text-align: center;
}

.recent-student__name {
  font-size: 12px;
  font-weight: 500;
  color: #1D2129;
}

.recent-student__class {
  font-size: 11px;
  color: #86909C;
}

.recent-student__time {
  font-size: 10px;
  color: #C9CDD4;
}

/* ===== Scrollbar ===== */
.question-panel__list::-webkit-scrollbar,
.detail-workspace::-webkit-scrollbar {
  width: 6px;
}

.question-panel__list::-webkit-scrollbar-track,
.detail-workspace::-webkit-scrollbar-track {
  background: transparent;
}

.question-panel__list::-webkit-scrollbar-thumb,
.detail-workspace::-webkit-scrollbar-thumb {
  background: #E5E6EB;
  border-radius: 3px;
}

.question-panel__list::-webkit-scrollbar-thumb:hover,
.detail-workspace::-webkit-scrollbar-thumb:hover {
  background: #C9CDD4;
}

.recent-students__list::-webkit-scrollbar {
  height: 4px;
}

.recent-students__list::-webkit-scrollbar-track {
  background: transparent;
}

.recent-students__list::-webkit-scrollbar-thumb {
  background: #E5E6EB;
  border-radius: 2px;
}
</style>
