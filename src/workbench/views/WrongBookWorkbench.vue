<template>
  <div class="wrongbook-workbench">
    <div class="main-layout">
      <!-- 第一栏：错题列表 -->
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
          <!-- Skeleton loading -->
          <template v-if="wrongBookStore.loading">
            <QuestionCardSkeleton v-for="i in 5" :key="i" style="margin-bottom: 8px;" />
          </template>
          <!-- Virtual list for questions -->
          <VirtualList
            v-else-if="paginatedQuestions.length > 20"
            :items="paginatedQuestions"
            :item-height="120"
            item-key="id"
            :buffer-size="3"
          >
            <template #default="{ item: wq }">
              <div
                class="question-card"
                :class="{ 'question-card--active': selectedDetailQuestion?.id === wq.id }"
                @click="handleSelectQuestion(wq)"
                style="margin-bottom: 8px;"
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
                  <LazyImage
                    v-if="getQuestionThumb(wq)"
                    :src="getQuestionThumb(wq)"
                    alt="题目缩略图"
                    width="60"
                    height="60"
                    root-margin="100px"
                  />
                  <div v-else class="thumb-placeholder">
                    <el-icon><Picture /></el-icon>
                  </div>
                </div>
              </div>
            </template>
          </VirtualList>
          <!-- Regular list for small datasets -->
          <template v-else>
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
                <LazyImage
                  v-if="getQuestionThumb(wq)"
                  :src="getQuestionThumb(wq)"
                  alt="题目缩略图"
                  width="60"
                  height="60"
                  root-margin="100px"
                />
                <div v-else class="thumb-placeholder">
                  <el-icon><Picture /></el-icon>
                </div>
              </div>
            </div>
          </template>
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
          <div class="detail-header__actions" v-if="!editing">
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
          <div class="detail-header__actions" v-else>
            <el-button size="small" @click="handleCancelEdit">取消</el-button>
            <el-button size="small" type="success" :loading="saving" @click="handleSave">
              <el-icon><DocumentChecked /></el-icon> 保存
            </el-button>
          </div>
        </div>

        <!-- 题目内容区 -->
        <!-- 只读模式 -->
        <div class="detail-content-area" v-if="!editing">
          <!-- 题干 + 配图 + 选项 统一卡片 -->
          <div class="detail-section">
            <div class="detail-section__label">题目内容</div>
            <div class="detail-section__content">
              <div class="unified-card">
                <div class="unified-section" v-if="getQuestionContent(selectedDetailQuestion)">
                  <div class="unified-label">题干</div>
                  <div class="unified-text"><MathRender :content="getQuestionContent(selectedDetailQuestion)" /></div>
                </div>
                <div class="unified-section unified-image-section" v-if="getQuestionThumb(selectedDetailQuestion)">
                  <div class="unified-label">配图</div>
                  <LazyImage
                    :src="getQuestionThumb(selectedDetailQuestion)"
                    alt="题目配图"
                    width="100%"
                    height="200px"
                    class="unified-image"
                  />
                </div>
                <div class="unified-section" v-if="getQuestionOptions(selectedDetailQuestion)?.length && getQuestion(selectedDetailQuestion).question_type === 'choice'">
                  <div class="unified-label">选项</div>
                  <div v-for="(opt, idx) in getQuestionOptions(selectedDetailQuestion)" :key="idx"
                    class="unified-option-row"
                    :class="{ 'option-correct': String.fromCharCode(65 + idx) === getQuestionAnswer(selectedDetailQuestion) }">
                    <span class="unified-opt-letter">{{ String.fromCharCode(65 + idx) }}.</span>
                    <span class="unified-opt-text"><MathRender :content="opt" autoDetect tag="span" /></span>
                  </div>
                </div>
              </div>
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

        <!-- 编辑模式 -->
        <div class="edit-form-area" v-else>
          <QuestionEditForm
            v-model:form="form"
            :display-image-url="displayImageUrl"
            :show-crop="false"
            @image-upload="handleImageUpload"
            @image-delete="deleteImage"
            @open-tag-selector="showTagSelector = true"
          />
          <!-- 题型+学科(额外放在QuestionEditForm的header插槽下方) -->
          <div class="edit-type-subject-row">
            <el-select v-model="form.question_type" style="flex:1" @change="onTypeChange">
              <el-option label="选择题" value="choice" />
              <el-option label="填空题" value="fill" />
              <el-option label="解答题" value="answer" />
            </el-select>
            <el-select v-model="form.subject" style="flex:1" allow-create filterable placeholder="学科">
              <el-option label="数学" value="数学" />
              <el-option label="物理" value="物理" />
              <el-option label="化学" value="化学" />
              <el-option label="英语" value="英语" />
              <el-option label="语文" value="语文" />
            </el-select>
          </div>
          <el-input v-model="form.answer" size="default" placeholder="标准答案" style="margin-top:12px;" />
        </div>

        <!-- 错题统计 -->
        <div class="detail-stats-area" v-if="!editing">
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
        <div class="recent-students-area" v-if="!editing">
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

  <!-- 知识点选择器 -->
  <el-dialog v-model="showTagSelector" title="选择知识点" width="380px">
    <div class="tag-grid">
      <div v-for="tag in allKnowledgeTags" :key="tag" class="tag-option"
        :class="{ 'tag-selected': form.tags?.includes(tag) }" @click="toggleTag(tag)">{{ tag }}</div>
    </div>
    <template #footer><el-button @click="showTagSelector = false">关闭</el-button></template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import {
  ArrowDown, ArrowRight, Search, Filter, Close,
  WarningFilled, Picture, Delete, Plus, Upload,
  DocumentChecked, RefreshLeft
} from '@element-plus/icons-vue'
import { useWrongBookStore } from '../stores/wrongBookStore'
import { getStudents, updateQuestion, rejudgeQuestion } from '../../services/apiService'
import dayjs from 'dayjs'
import MathRender from "../components/MathRender.vue"
import QuestionEditForm from "../components/review/QuestionEditForm.vue"
import LazyImage from "../components/shared/LazyImage.vue"
import QuestionCardSkeleton from "../components/shared/QuestionCardSkeleton.vue"
import VirtualList from "../components/shared/VirtualList.vue"

const router = useRouter()
const wrongBookStore = useWrongBookStore()

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

// ===== 编辑状态 =====
const editing = ref(false)
const saving = ref(false)
const form = ref(createEmptyForm())
const originalData = ref(null)
const displayImageUrl = ref('')
const localImageUrl = ref('')
const showTagSelector = ref(false)
const allKnowledgeTags = ref([
  '全等三角形判定', '角的关系推导', '线段等式证明', '平行线的性质',
  '角平分线定义', '三角形内角和定理', '等式性质', '勾股定理',
  '相似三角形', '圆的性质', '函数与图像', '概率统计',
  '有理数运算', '一元二次方程', '二元一次方程组', '分式方程',
  '因式分解', '二次函数', '反比例函数', '三角函数'
])

function createEmptyForm() {
  return { content: '', options: [], answer: '', analysis: '', question_type: 'choice', subject: '', tags: [] }
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
  return q.geometry_image_url || q.image_url || q.thumbnail || wq.geometry_image_url || wq.image_url || wq.thumbnail || ''
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
  return Math.min(wq.error_count || 0, 99)
}

const getWrongStudentCount = (wq) => {
  return wq.student_count || wq.wrong_student_count || 1
}

const getWeekStudentIncrease = () => {
  return 0
}

const getLatestWrongTime = (wq) => {
  return getQuestionTime(wq)
}

const getAccuracyRate = (wq) => {
  const total = (wq.practice_count || 0) + (wq.error_count || 0)
  if (total === 0) return 0
  return Math.round((1 - (wq.error_count || 0) / total) * 100)
}

const getAccuracyDrop = () => {
  return 0
}

const getDaysSinceLastWeek = () => {
  return 0
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

// ===== 编辑操作 =====
const handleEditQuestion = (wq) => {
  const q = getQuestion(wq)
  editing.value = true
  form.value = {
    content: q.content || wq.content || '',
    options: JSON.parse(JSON.stringify(q.options || wq.options || [])),
    answer: q.answer || wq.answer || '',
    analysis: q.analysis || wq.analysis || '',
    question_type: q.question_type || wq.question_type || 'choice',
    subject: q.subject || wq.subject || '',
    tags: JSON.parse(JSON.stringify(getQuestionTags(wq)))
  }
  originalData.value = JSON.parse(JSON.stringify(form.value))
  displayImageUrl.value = getQuestionThumb(wq)
  localImageUrl.value = displayImageUrl.value
}

const handleCancelEdit = () => {
  editing.value = false
  form.value = createEmptyForm()
  displayImageUrl.value = ''
  localImageUrl.value = ''
}

const handleSave = async () => {
  const q = getQuestion(selectedDetailQuestion.value)
  const questionId = q.id || selectedDetailQuestion.value.question_id
  if (!questionId) return
  saving.value = true
  try {
    await updateQuestion(questionId, {
      content: form.value.content,
      options: form.value.options,
      answer: form.value.answer,
      analysis: form.value.analysis,
      question_type: form.value.question_type,
      subject: form.value.subject,
      ai_tags: form.value.tags,
      geometry_image_url: localImageUrl.value
    })
    // 保存后自动重批改
    try {
      const rejudgeResult = await rejudgeQuestion(questionId)
      if (rejudgeResult.success && q) {
        q.is_correct = rejudgeResult.is_correct
      }
    } catch (rejudgeErr) {
      console.warn('重批改失败（不影响保存）:', rejudgeErr.message)
    }
    ElMessage.success('保存成功')
    editing.value = false
    // 刷新数据
    if (wrongBookStore.currentStudent?.id) {
      await wrongBookStore.loadWrongQuestions(wrongBookStore.currentStudent.id)
    }
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

const onTypeChange = (val) => {
  if (val !== 'choice') {
    form.value.options = []
  } else if (form.value.options.length === 0) {
    form.value.options = ['', '', '', '']
  }
}

const addOption = () => { form.value.options.push('') }
const removeOption = (idx) => { form.value.options.splice(idx, 1) }
const removeTag = (tag) => { form.value.tags = form.value.tags.filter(t => t !== tag) }
const toggleTag = (tag) => {
  const idx = form.value.tags.indexOf(tag)
  if (idx === -1) form.value.tags.push(tag)
  else form.value.tags.splice(idx, 1)
}

const handleImageUpload = async (file) => {
  const reader = new FileReader()
  reader.onload = (e) => { displayImageUrl.value = e.target?.result || '' }
  reader.readAsDataURL(file)
  try {
    const formData = new FormData()
    formData.append('files', file)
    const response = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!response.ok) throw new Error('上传失败')
    const result = await response.json()
    displayImageUrl.value = localImageUrl.value = result.url
    ElMessage.success('配图上传成功')
  } catch (err) {
    console.error('图片上传失败:', err)
    ElMessage.error('图片上传失败')
  }
  return false
}

const deleteImage = () => {
  localImageUrl.value = displayImageUrl.value = ''
  ElMessage.success('配图已删除')
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
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* ===== Main Layout ===== */
.main-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Question Panel (第一栏: ~320px) ===== */
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

/* ===== Unified Card (题干+配图+选项 一体) ===== */
.unified-card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.unified-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.unified-section + .unified-section {
  border-top: 1px dashed #ebeef5;
  padding-top: 12px;
}
.unified-label {
  font-size: 11px;
  font-weight: 600;
  color: #909399;
  letter-spacing: 0.5px;
}
.unified-text {
  font-size: 15px;
  line-height: 1.7;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-word;
}
.unified-image {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
  object-fit: contain;
}
.unified-option-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
}
.unified-option-row.option-correct .unified-opt-letter,
.unified-option-row.option-correct .unified-opt-text {
  color: #67c23a;
  font-weight: 600;
}
.unified-opt-letter {
  font-weight: 700;
  color: #909399;
  min-width: 20px;
  font-size: 14px;
  flex-shrink: 0;
  padding-top: 2px;
}
.unified-opt-text {
  font-size: 15px;
  color: #303133;
  line-height: 1.6;
}
.edit-type-subject-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* ===== Edit Form ===== */
.edit-form-area {
  padding: 16px 24px;
  flex: 1;
  overflow-y: auto;
}

.edit-form-area .el-form-item {
  margin-bottom: 16px;
}

.option-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.option-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.option-letter {
  font-weight: 700;
  color: #909399;
  min-width: 20px;
  font-size: 14px;
  flex-shrink: 0;
}

.option-row .el-input {
  flex: 1;
}

.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.image-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-image {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
  object-fit: contain;
}

.no-image {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #c0c4cc;
  font-size: 13px;
  padding: 8px 0;
}

.image-actions {
  display: flex;
  gap: 6px;
}

.tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-option {
  padding: 6px 14px;
  border: 1px solid #dcdfe6;
  border-radius: 16px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.tag-option:hover {
  border-color: #409eff;
  color: #409eff;
}

.tag-selected {
  background: #ecf5ff;
  border-color: #409eff;
  color: #409eff;
  font-weight: 500;
}
</style>
