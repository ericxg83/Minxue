<template>
  <div class="student-detail-page">
    <div v-if="loading" class="detail-state"><el-icon class="is-loading"><Loading /></el-icon><span>正在加载学生学习记录…</span></div>
    <div v-else-if="!student" class="detail-state"><el-icon><User /></el-icon><strong>找不到这名学生</strong><el-button text type="primary" @click="go('/students')">返回学生列表</el-button></div>
    <template v-else>
      <header class="detail-header">
        <div class="detail-heading"><el-button text class="back-button" @click="go('/students')"><el-icon><ArrowLeft /></el-icon>学生</el-button><div class="student-identity"><el-avatar :size="46" :src="student.avatar">{{ initial(student.name) }}</el-avatar><div><div class="eyebrow">学生详情</div><h1>{{ student.name || '未命名学生' }}</h1><p>{{ student.grade || student.class || '暂无年级信息' }}</p></div></div></div>
        <div class="header-actions"><el-button @click="openEditDialog">编辑信息</el-button></div>
      </header>

      <nav class="detail-tabs" aria-label="学生详情导航">
        <button :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">概览</button>
        <button :class="{ active: activeTab === 'growth' }" @click="activeTab = 'growth'">学情</button>
        <button :class="{ active: activeTab === 'wrongbook' }" @click="activeTab = 'wrongbook'">错题</button>
        <button :class="{ active: activeTab === 'retry' }" @click="activeTab = 'retry'">重练</button>
      </nav>

      <!-- 概览 -->
      <div v-if="activeTab === 'overview'" class="tab-panel">
      <section class="summary-grid">
        <div class="metric"><span>作业记录</span><strong>{{ tasks.length }}</strong><small>份</small></div>
        <div class="metric"><span>待掌握错题</span><strong class="danger">{{ pendingWrongCount }}</strong><small>道</small></div>
        <div class="metric"><span>重练任务</span><strong class="accent">{{ exams.length }}</strong><small>份</small></div>
        <div class="metric"><span>知识点</span><strong>{{ mastery.length }}</strong><small>个</small></div>
      </section>

      <section class="detail-grid">
        <section class="surface">
          <div class="surface-header"><div><h2>当前需要关注</h2><p>根据最近学习记录整理</p></div><el-tag :type="pendingWrongCount ? 'warning' : 'success'" effect="plain">{{ pendingWrongCount ? '有待处理' : '状态正常' }}</el-tag></div>
          <div v-if="weakPoints.length" class="focus-list"><div v-for="point in weakPoints" :key="point.name" class="focus-row"><span class="focus-name">{{ point.name }}</span><span class="focus-meta">掌握度 {{ point.mastery }}% · 错题 {{ point.wrongCount }} 道</span><el-button text type="primary" @click="go('/wrongbook', { studentId: student.id })">查看</el-button></div></div>
          <div v-else class="inline-empty"><el-icon><CircleCheck /></el-icon><span>暂时没有需要优先处理的知识点</span></div>
        </section>
        <section class="surface">
          <div class="surface-header"><div><h2>最近作业</h2><p>最近 5 条任务记录</p></div><el-button text type="primary" @click="go('/review', { studentId: student.id })">开始批改</el-button></div>
          <div v-if="tasks.length" class="task-list"><div v-for="task in recentTasks" :key="task.id" class="task-row"><span class="task-copy"><strong>{{ task.original_name || task.originalName || '未命名作业' }}</strong><small>{{ task.subject || '未标注学科' }} · {{ formatDate(task.created_at || task.createdAt) }}</small></span><el-tag :type="task.status === 'done' ? 'success' : task.status === 'failed' ? 'danger' : 'warning'" size="small" effect="plain">{{ taskLabel(task.status) }}</el-tag></div></div>
          <div v-else class="inline-empty"><span>还没有作业记录</span></div>
        </section>
      </section>

      <section class="surface mastery-surface"><div class="surface-header"><div><h2>知识点掌握</h2><p>掌握度较低的知识点优先显示</p></div></div><div v-if="weakPoints.length" class="mastery-list"><div v-for="point in weakPoints" :key="point.name" class="mastery-row"><span>{{ point.name }}</span><div class="bar"><i :style="{ width: `${point.mastery}%` }"></i></div><strong>{{ point.mastery }}%</strong></div></div><div v-else class="inline-empty"><span>暂无知识点掌握数据，完成作业批改后会逐步生成。</span></div></section>
      </div>

      <!-- 学情 -->
      <div v-else-if="activeTab === 'growth'" class="tab-panel">
        <section class="summary-grid study-stats">
          <div class="metric"><span>待掌握错题</span><strong class="danger">{{ pendingWrongCount }}</strong><small>道</small></div>
          <div class="metric"><span>掌握率</span><strong>{{ masteryRate }}%</strong><small>—</small></div>
          <div class="metric"><span>薄弱知识点</span><strong class="accent">{{ weakness.length }}</strong><small>个</small></div>
          <div class="metric"><span>重练完成率</span><strong>{{ retryCompletion }}%</strong><small>{{ gradedExams }}/{{ exams.length }}</small></div>
        </section>
        <section class="surface weak-surface">
          <div class="surface-header"><div><h2>薄弱知识点</h2><p>掌握度偏低，建议优先安排定向重练</p></div></div>
          <div v-if="weakness.length" class="weak-list">
            <div v-for="point in weakness" :key="point.kpId" class="weak-row">
              <div class="weak-main">
                <span class="weak-name">{{ point.name }}<el-tag v-if="point.isUrgent" size="small" type="danger" effect="plain">紧急</el-tag></span>
                <span class="weak-meta">{{ point.subject }} · 涉及 {{ point.wrongQuestions }} 道错题</span>
              </div>
              <div class="weak-bar"><i :style="{ width: point.mastery + '%' }" :class="{ low: point.mastery < 30 }"></i></div>
              <strong class="weak-mastery">{{ point.mastery }}%</strong>
              <el-button size="small" type="primary" :loading="creatingExam" @click="createExamFromWeakPoint(point)">创建组卷</el-button>
            </div>
          </div>
          <div v-else class="inline-empty"><el-icon><CircleCheck /></el-icon><span>暂无薄弱知识点，掌握情况良好</span></div>
        </section>
      </div>

      <!-- 错题 -->
      <div v-else-if="activeTab === 'wrongbook'" class="tab-panel">
        <WrongBookCenterRedesign :embedded="true" :student-id="student.id" @exam-created="onExamCreated" />
      </div>

      <!-- 重练 -->
      <div v-else-if="activeTab === 'retry'" class="tab-panel">
        <section class="surface retry-surface">
          <div class="surface-header"><div><h2>重练记录</h2><p>该学生的错题重练卷与批改结果</p></div><el-button text type="primary" @click="refreshRetry">刷新</el-button></div>
          <div v-if="exams.length" class="retry-list">
            <div v-for="exam in exams" :key="exam.id" class="retry-row">
              <div class="retry-main">
                <strong>{{ exam.name }}</strong>
                <small>{{ formatDate(exam.created_at) }} · 共 {{ exam.total_count || exam.question_ids.length }} 题</small>
              </div>
              <el-tag :type="exam.status === 'graded' ? 'success' : 'warning'" size="small" effect="plain">{{ exam.status === 'graded' ? '已批改' : '待批改' }}</el-tag>
              <span class="retry-count" v-if="exam.status === 'graded'">{{ exam.correct_count }} 对 / {{ exam.wrong_count }} 错</span>
            </div>
          </div>
          <div v-else class="inline-empty"><el-icon><CircleCheck /></el-icon><span>还没有重练卷，去「错题」勾选题目创建第一份吧</span></div>
        </section>
      </div>
    </template>

    <el-dialog v-model="editDialogVisible" title="编辑学生信息" width="420px" destroy-on-close @closed="resetEditForm">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-position="top" @submit.prevent="saveStudent">
        <el-form-item label="学生姓名" prop="name">
          <el-input v-model="editForm.name" maxlength="30" show-word-limit placeholder="请输入学生姓名" @keyup.enter="saveStudent" />
        </el-form-item>
        <el-form-item label="年级" prop="grade">
          <el-input v-model="editForm.grade" maxlength="30" placeholder="例如：五年级（选填）" @keyup.enter="saveStudent" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveStudent">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, CircleCheck, Loading, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getStudentById, getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent, getKnowledgeMastery, updateStudent, getStudentWeakness, createGeneratedExam } from '../../services/apiService'
import { buildExamBaseName, buildExamNameWithSeq } from '../../domain/examNaming'
import WrongBookCenterRedesign from './WrongBookCenterRedesign.vue'

const route = useRoute(); const router = useRouter()
const loading = ref(true); const student = ref(null); const tasks = ref([]); const wrongQuestions = ref([]); const exams = ref([]); const mastery = ref([]); const weakness = ref([])
const activeTab = ref('overview'); const creatingExam = ref(false)
const editDialogVisible = ref(false); const saving = ref(false); const editFormRef = ref(); const editForm = ref({ name: '', grade: '' })
const editRules = { name: [{ required: true, message: '请输入学生姓名', trigger: 'blur' }, { min: 1, max: 30, message: '学生姓名长度应为 1-30 个字符', trigger: 'blur' }] }

const pendingWrongCount = computed(() => wrongQuestions.value.filter(item => item.lifecycle_status !== 'mastered').length)
const weakPoints = computed(() => mastery.value.map(item => ({ name: item.name || item.knowledge_name || '未命名知识点', mastery: Math.round(item.mastery || 0), wrongCount: item.wrong_questions || 0 })).sort((a, b) => a.mastery - b.mastery).slice(0, 5))
const recentTasks = computed(() => tasks.value.slice(0, 5))
const gradedExams = computed(() => exams.value.filter(e => e.status === 'graded').length)
const retryCompletion = computed(() => exams.value.length ? Math.round(gradedExams.value / exams.value.length * 100) : 0)
const masteryRate = computed(() => {
  if (!wrongQuestions.value.length) return 0
  const mastered = wrongQuestions.value.filter(i => i.lifecycle_status === 'mastered').length
  return Math.round(mastered / wrongQuestions.value.length * 100)
})
const initial = (name) => (name || '?').slice(0, 1)
const go = (path, query = {}) => router.push({ path, query })
const formatDate = (value) => { if (!value) return '时间未知'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '时间未知' : `${date.getMonth() + 1}月${date.getDate()}日` }
const taskLabel = (status) => ({ done: '已完成', failed: '处理异常', reviewed: '已复核' }[status] || '处理中')
const TAB_KEYS = ['overview', 'growth', 'wrongbook', 'retry']
const setTabFromQuery = () => { const t = route.query.tab; if (t && TAB_KEYS.includes(t)) activeTab.value = t }

onMounted(async () => {
  try {
    const id = route.params.id
    const [studentData, taskList, wrongList, examList, masteryList, weaknessList] = await Promise.all([
      getStudentById(id),
      getTasksByStudent(id, false),
      getWrongQuestionsByStudent(id, false),
      getGeneratedExamsByStudent(id, false),
      getKnowledgeMastery(id).catch(() => []),
      getStudentWeakness(id, { limit: 12 }).catch(() => [])
    ])
    student.value = studentData
    tasks.value = Array.isArray(taskList) ? taskList : []
    wrongQuestions.value = Array.isArray(wrongList) ? wrongList : []
    exams.value = Array.isArray(examList) ? examList : []
    mastery.value = Array.isArray(masteryList) ? masteryList : []
    weakness.value = Array.isArray(weaknessList) ? weaknessList : []
    setTabFromQuery()
  } catch (error) { student.value = null } finally { loading.value = false }
})
watch(() => route.query.tab, setTabFromQuery)

// 错题 tab 内创建重练后：刷新重练列表并切到「重练」tab
async function onExamCreated() {
  if (!student.value) return
  try { exams.value = await getGeneratedExamsByStudent(student.value.id, false) } catch (e) {}
  activeTab.value = 'retry'
}

// 学情 -> 薄弱点 -> 创建定向重练卷（按学科范围，question_ids 取题库题目 ID）
async function createExamFromWeakPoint(point) {
  if (!student.value) return
  const items = wrongQuestions.value.filter(wq => wq.subject === point.subject && wq.lifecycle_status !== 'mastered' && wq.question_id)
  const questionIds = items.map(wq => wq.question_id)
  if (!questionIds.length) { ElMessage.warning('该学科暂无可组卷的待重练错题'); return }
  creatingExam.value = true
  try {
    const existing = await getGeneratedExamsByStudent(student.value.id, false).catch(() => [])
    const baseName = buildExamBaseName(items)
    const examName = buildExamNameWithSeq(baseName, existing, student.value.id)
    const exam = await createGeneratedExam({ student_id: student.value.id, name: examName, question_ids: questionIds })
    if (!exam?.id) throw new Error('创建重练卷失败')
    ElMessage.success(`已为「${point.name}」生成定向重练卷，共 ${questionIds.length} 题`)
    onExamCreated(exam)
  } catch (error) { ElMessage.error(error.message || '创建重练卷失败，请稍后重试') } finally { creatingExam.value = false }
}

async function refreshRetry() {
  if (!student.value) return
  try { exams.value = await getGeneratedExamsByStudent(student.value.id, false); ElMessage.success('已刷新重练记录') } catch (e) { ElMessage.error('刷新失败') }
}

const openEditDialog = () => { editForm.value = { name: student.value?.name || '', grade: student.value?.grade || student.value?.class || '' }; editDialogVisible.value = true }
const resetEditForm = () => { editForm.value = { name: '', grade: '' } }
const saveStudent = async () => {
  if (saving.value || !student.value) return
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const updated = await updateStudent(student.value.id, { name: editForm.value.name.trim(), grade: editForm.value.grade.trim() })
    student.value = { ...student.value, ...updated }
    editDialogVisible.value = false
    ElMessage.success('学生信息已保存')
  } catch (error) { ElMessage.error(error.message || '保存失败，请稍后重试') } finally { saving.value = false }
}
</script>

<style scoped>
.student-detail-page { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 24px 36px 48px; background: var(--wb-bg); }.detail-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 16px; }.back-button { padding-left: 0; color: var(--wb-text-secondary); }.student-identity { display: flex; align-items: center; gap: 14px; }.student-identity :deep(.el-avatar) { color: var(--wb-primary); background: var(--wb-primary-soft); }.eyebrow { color: var(--wb-text-tertiary); font-size: 12px; }.student-identity h1 { margin: 4px 0; color: var(--wb-text); font-size: 24px; font-weight: 650; }.student-identity p { margin: 0; color: var(--wb-text-secondary); font-size: 13px; }.header-actions { display: flex; gap: 8px; }.detail-tabs { display: flex; gap: 18px; margin-bottom: 16px; border-bottom: 1px solid var(--wb-border); }.detail-tabs button { padding: 10px 2px; color: var(--wb-text-secondary); background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; }.detail-tabs button.active { color: var(--wb-primary); font-weight: 600; border-bottom-color: var(--wb-primary); }.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 16px; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }.metric { display: flex; align-items: baseline; gap: 8px; padding: 17px 20px; border-right: 1px solid var(--wb-border-light); }.metric:last-child { border-right: 0; }.metric span { color: var(--wb-text-secondary); font-size: 13px; }.metric strong { margin-left: auto; color: var(--wb-text); font-size: 24px; font-variant-numeric: tabular-nums; }.metric small { color: var(--wb-text-tertiary); }.metric .danger { color: var(--wb-danger); }.metric .accent { color: var(--wb-accent); }.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }.surface { min-width: 0; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: 10px; }.surface-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; border-bottom: 1px solid var(--wb-border-light); }.surface-header h2 { margin: 0 0 4px; color: var(--wb-text); font-size: 15px; }.surface-header p { margin: 0; color: var(--wb-text-secondary); font-size: 12px; }.focus-list, .task-list { padding: 4px 10px 10px; }.focus-row, .task-row { display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 10px; border-bottom: 1px solid var(--wb-border-light); }.focus-row:last-child, .task-row:last-child { border-bottom: 0; }.focus-name { min-width: 110px; color: var(--wb-text); font-size: 13px; font-weight: 600; }.focus-meta, .task-copy small { flex: 1; color: var(--wb-text-secondary); font-size: 12px; }.task-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; }.task-copy strong { overflow: hidden; color: var(--wb-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.inline-empty, .detail-state { display: flex; align-items: center; justify-content: center; min-height: 180px; flex-direction: column; gap: 8px; color: var(--wb-text-tertiary); font-size: 13px; }.inline-empty .el-icon, .detail-state .el-icon { color: var(--wb-success); font-size: 30px; }.detail-state { height: 100%; }.mastery-surface { margin-top: 16px; }.mastery-list { display: grid; gap: 16px; padding: 20px; }.mastery-row { display: grid; grid-template-columns: 160px 1fr 52px; align-items: center; gap: 16px; color: var(--wb-text); font-size: 13px; }.bar { height: 7px; overflow: hidden; background: var(--wb-border-light); border-radius: 10px; }.bar i { display: block; height: 100%; background: var(--wb-primary); border-radius: inherit; }.mastery-row strong { color: var(--wb-text-secondary); font-size: 12px; text-align: right; }.detail-state strong { color: var(--wb-text); font-size: 14px; }
@media (max-width: 900px) { .student-detail-page { padding: 20px 24px 32px; }.detail-header { align-items: flex-start; flex-direction: column; }.header-actions { width: 100%; }.header-actions .el-button { flex: 1; }.summary-grid { grid-template-columns: repeat(2, 1fr); }.summary-grid .metric:nth-child(2) { border-right: 0; }.summary-grid .metric:nth-child(-n+2) { border-bottom: 1px solid var(--wb-border-light); }.detail-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .student-detail-page { padding: 16px; }.student-identity h1 { font-size: 21px; }.summary-grid { grid-template-columns: 1fr; }.summary-grid .metric, .summary-grid .metric:nth-child(2) { border-right: 0; border-bottom: 1px solid var(--wb-border-light); }.summary-grid .metric:last-child { border-bottom: 0; }.mastery-row { grid-template-columns: 1fr 42px; }.mastery-row .bar { grid-column: 1 / -1; grid-row: 2; } }
.tab-panel { margin-top: 4px }
.study-stats { margin-bottom: 16px }
.weak-surface, .retry-surface { margin-top: 16px }
.weak-list, .retry-list { padding: 6px 10px 12px }
.weak-row { display: grid; grid-template-columns: minmax(0, 1fr) 160px 52px auto; align-items: center; gap: 16px; min-height: 60px; padding: 10px; border-bottom: 1px solid var(--wb-border-light) }
.weak-row:last-child { border-bottom: 0 }
.weak-main { display: flex; flex-direction: column; gap: 4px; min-width: 0 }
.weak-name { display: flex; align-items: center; gap: 8px; color: var(--wb-text); font-size: 13px; font-weight: 600 }
.weak-meta { color: var(--wb-text-secondary); font-size: 12px }
.weak-bar { height: 7px; overflow: hidden; background: var(--wb-border-light); border-radius: 10px }
.weak-bar i { display: block; height: 100%; background: var(--wb-primary) }
.weak-bar i.low { background: var(--wb-danger) }
.weak-mastery { color: var(--wb-text-secondary); font-size: 12px; text-align: right }
.retry-list { padding: 6px 10px 12px }
.retry-row { display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 10px; border-bottom: 1px solid var(--wb-border-light) }
.retry-row:last-child { border-bottom: 0 }
.retry-main { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px }
.retry-main strong { color: var(--wb-text); font-size: 13px }
.retry-main small { color: var(--wb-text-secondary); font-size: 12px }
.retry-count { color: var(--wb-text-secondary); font-size: 12px }
@media (max-width: 720px) {
  .weak-row { grid-template-columns: 1fr auto }
  .weak-bar, .weak-mastery { grid-column: 1 / -1 }
  .weak-mastery { text-align: left }
}
</style>



