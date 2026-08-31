<template>
  <div class="student-detail-page wb-page">
    <a class="skip-link" href="#detail-main">跳到主体内容</a>
    <div v-if="loading" class="detail-state" role="status" aria-live="polite">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在加载学生学习记录…</span>
    </div>
    <div v-else-if="loadError" class="detail-state error-state" role="alert">
      <el-icon><WarningFilled /></el-icon>
      <strong>读不到学生档案</strong>
      <span>{{ loadError }}</span>
      <div class="error-state__actions">
        <ActionButton @click="retryLoad">重新加载</ActionButton>
        <ActionButton variant="ghost" @click="go('/students')">返回学生列表</ActionButton>
      </div>
    </div>
    <div v-else-if="!student" class="detail-state" role="status">
      <el-icon><User /></el-icon>
      <strong>找不到这名学生</strong>
      <span>该学生可能已转学或被删除。</span>
      <ActionButton @click="go('/students')">返回学生列表</ActionButton>
    </div>
    <template v-else>
      <!-- 身份区：学生档案卡（设计系统 28.1 允许的渐变范本） -->
      <header class="identity-card">
        <div class="identity-left">
          <ActionButton variant="ghost" class="back-button" @click="go('/students')">
            <el-icon><ArrowLeft /></el-icon>返回学生列表
          </ActionButton>
          <el-avatar :size="52" :src="student.avatar" class="identity-avatar">{{ initial(student.name) }}</el-avatar>
          <div class="identity-meta">
            <div class="identity-eyebrow">学生档案</div>
            <h1>{{ student.name || '未命名学生' }}</h1>
            <div class="identity-tags">
              <StatusTag :tone="student.is_active === false ? 'neutral' : 'success'">
                {{ student.is_active === false ? '已停课' : '在读' }}
              </StatusTag>
              <span class="identity-grade">{{ student.grade || student.class || '未设置年级' }}</span>
            </div>
          </div>
        </div>
        <div class="identity-right">
          <ActionButton @click="openEditDialog">编辑信息</ActionButton>
        </div>
      </header>

      <!-- 下一步建议：把数字翻译成人话 + 一个动作（保留 4 级优先级逻辑） -->
      <section v-if="nextAction" class="next-action">
        <div class="next-action__icon"><el-icon><Aim /></el-icon></div>
        <div class="next-action__body">
          <div class="next-action__eyebrow">下一步建议</div>
          <div class="next-action__text">{{ nextAction.text }}</div>
          <div v-if="nextAction.evidence" class="next-action__evidence">说明：{{ nextAction.evidence }}</div>
        </div>
        <div class="next-action__cta">
          <ActionButton variant="primary" @click="go(nextAction.to, { studentId: student.id })">
            {{ nextAction.cta }}<el-icon class="el-icon--right"><ArrowRight /></el-icon>
          </ActionButton>
        </div>
      </section>

      <!-- 4 块核心指标（原 5 段状态行 + 4 张 StatsCard 合并） -->
      <KpiStrip aria-label="学生关键指标" :items="kpiItems" />

      <!-- 主体：薄弱点 / 最近作业 / 最近重练 -->
      <section id="detail-main" class="main-grid" aria-label="学生学习详情">
        <ContentCard title="薄弱知识点" description="掌握度偏低，建议优先安排定向重练" class="span-2">
          <div v-if="weakness.length" class="weak-list">
            <div v-for="point in weakness" :key="point.kpId" class="weak-row">
              <div class="weak-main">
                <div class="weak-name">
                  <span>{{ point.name }}</span>
                  <StatusTag v-if="point.isUrgent" tone="danger">急需重练</StatusTag>
                </div>
                <div class="weak-meta">{{ point.subject }} · 涉及 {{ point.wrongQuestions }} 道错题</div>
                <div v-if="point.lossPositions" class="weak-loss">失分位置：{{ point.lossPositions }}</div>
              </div>
              <div class="weak-bar"><i :style="{ width: point.mastery + '%' }" :class="{ low: point.mastery < 30 }"></i></div>
              <div class="weak-mastery">
                <strong>{{ point.mastery }}%</strong>
                <ActionButton
                  variant="ghost"
                  :loading="creatingExam && creatingPoint === point.kpId"
                  @click="createExamFromWeakPoint(point)"
                >
                  创建组卷
                </ActionButton>
              </div>
            </div>
          </div>
          <EmptyState v-else title="暂无薄弱知识点" description="当前知识点掌握情况良好" />
        </ContentCard>

        <ContentCard title="最近作业" description="最近 5 条任务记录">
          <template #actions>
            <ActionButton variant="ghost" @click="go('/grade', { studentId: student.id })">
              开始批改<el-icon class="el-icon--right"><ArrowRight /></el-icon>
            </ActionButton>
          </template>
          <div v-if="recentTasks.length" class="task-list">
            <div v-for="task in recentTasks" :key="task.id" class="task-row">
              <div class="task-main">
                <strong>{{ task.original_name || task.originalName || '未命名作业' }}</strong>
                <small>{{ task.subject || '未标注学科' }} · {{ formatDate(task.created_at || task.createdAt) }}</small>
              </div>
              <StatusTag :tone="taskTone(task.status)">{{ taskLabel(task.status) }}</StatusTag>
            </div>
          </div>
          <EmptyState v-else title="还没有作业记录" description="上传第一份作业后这里会显示批改进度" />
        </ContentCard>

        <ContentCard title="最近重练" description="重练卷与批改结果">
          <template #actions>
            <ActionButton variant="ghost" @click="refreshRetry">
              刷新<el-icon class="el-icon--right"><Refresh /></el-icon>
            </ActionButton>
          </template>
          <div v-if="recentExams.length" class="retry-list">
            <div v-for="exam in recentExams" :key="exam.id" class="retry-row">
              <div class="retry-main">
                <strong>{{ exam.name }}</strong>
                <small>{{ formatDate(exam.created_at) }} · 共 {{ exam.total_count || exam.question_ids.length }} 题</small>
              </div>
              <StatusTag :tone="exam.status === 'graded' ? 'success' : 'warning'">
                {{ exam.status === 'graded' ? '已批改' : '待批改' }}
              </StatusTag>
              <span v-if="exam.status === 'graded'" class="retry-count">{{ exam.correct_count }} 对 / {{ exam.wrong_count }} 错</span>
            </div>
          </div>
          <EmptyState v-else title="还没有重练卷" description="去「错题本」勾选题目创建第一份吧" />
        </ContentCard>
      </section>

      <!-- 行动入口 3 块（去 transform / shadow / icon 块） -->
      <ContentCard title="进入详细分析" description="错题、重练与掌握度是独立的功能页">
        <div class="action-grid">
          <button
            class="action-tile"
            type="button"
            :aria-label="`进入错题本，待处理 ${pendingWrongCount} 道，重复出错 ${repeatWrongCount} 道`"
            @click="go('/wrongbook', { studentId: student.id })"
          >
            <div class="action-tile__body">
              <div class="action-tile__title">错题本</div>
              <div class="action-tile__meta">待处理 {{ pendingWrongCount }} 道 · 重复出错 {{ repeatWrongCount }} 道</div>
            </div>
            <el-icon class="action-tile__arrow"><ArrowRight /></el-icon>
          </button>
          <button
            class="action-tile"
            type="button"
            :aria-label="`进入重练记录，已批改 ${gradedExams} 份，待批改 ${pendingExams} 份`"
            @click="go('/grade', { studentId: student.id, source: 'retry' })"
          >
            <div class="action-tile__body">
              <div class="action-tile__title">重练记录</div>
              <div class="action-tile__meta">已批改 {{ gradedExams }} 份 · 待批改 {{ pendingExams }} 份</div>
            </div>
            <el-icon class="action-tile__arrow"><ArrowRight /></el-icon>
          </button>
          <button
            class="action-tile"
            type="button"
            :aria-label="`进入知识点掌握，薄弱 ${weakness.length} 个，已掌握 ${masteredKpCount} 个`"
            @click="go('/growth', { studentId: student.id })"
          >
            <div class="action-tile__body">
              <div class="action-tile__title">知识点掌握</div>
              <div class="action-tile__meta">薄弱 {{ weakness.length }} 个 · 已掌握 {{ masteredKpCount }} 个</div>
            </div>
            <el-icon class="action-tile__arrow"><ArrowRight /></el-icon>
          </button>
        </div>
      </ContentCard>
    </template>

    <WorkbenchDialog v-model="editDialogVisible" title="编辑学生信息" :loading="saving" @closed="resetEditForm">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-position="top" @submit.prevent="saveStudent">
        <el-form-item label="学生姓名" prop="name">
          <WorkbenchInput v-model="editForm.name" :maxlength="30" show-word-limit placeholder="请输入学生姓名" aria-label="学生姓名" @keyup.enter="saveStudent" />
        </el-form-item>
        <el-form-item label="年级" prop="grade">
          <WorkbenchInput v-model="editForm.grade" :maxlength="30" placeholder="例如：五年级（选填）" aria-label="年级" @keyup.enter="saveStudent" />
        </el-form-item>
      </el-form>
      <template #footer>
        <ActionButton variant="ghost" @click="editDialogVisible = false">取消</ActionButton>
        <ActionButton variant="primary" :loading="saving" @click="saveStudent">保存</ActionButton>
      </template>
    </WorkbenchDialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Aim, ArrowLeft, ArrowRight, Loading, Refresh, User, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getStudentById, getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent, getKnowledgeMastery, updateStudent, getStudentWeakness, createGeneratedExam } from '../../services/apiService'
import { humanizeError } from '../utils/humanizeError'
import { buildExamBaseName, buildExamNameWithSeq } from '../../domain/examNaming'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import KpiStrip from '../components/ui/KpiStrip.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchDialog from '../components/ui/WorkbenchDialog.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const loadError = ref('')
const student = ref(null)
const tasks = ref([])
const wrongQuestions = ref([])
const exams = ref([])
const mastery = ref([])
const weakness = ref([])
const creatingExam = ref(false)
const creatingPoint = ref(null)
const editDialogVisible = ref(false)
const saving = ref(false)
const editFormRef = ref()
const editForm = ref({ name: '', grade: '' })
const editRules = {
  name: [
    { required: true, message: '请输入学生姓名', trigger: 'blur' },
    { min: 1, max: 30, message: '学生姓名长度应为 1-30 个字符', trigger: 'blur' }
  ]
}

const pendingWrongCount = computed(() => wrongQuestions.value.filter(item => item.lifecycle_status !== 'mastered').length)
const masteredWrongCount = computed(() => wrongQuestions.value.filter(item => item.lifecycle_status === 'mastered').length)
const repeatWrongCount = computed(() => wrongQuestions.value.filter(item => (item.error_count || 0) >= 2).length)
const pendingExams = computed(() => exams.value.filter(e => e.status !== 'graded').length)
const gradedExams = computed(() => exams.value.filter(e => e.status === 'graded').length)
const recentTasks = computed(() => tasks.value.slice(0, 5))
const recentExams = computed(() => exams.value.slice(0, 5))
const masteredKpCount = computed(() => weakness.value.filter(w => w.mastery >= 80).length)

const kpiItems = computed(() => {
  const sid = student.value?.id
  return [
    {
      key: 'tasks',
      value: tasks.value.length,
      unit: '份',
      label: '作业记录',
      tone: 'primary',
      actionLabel: '看作业',
      actionIcon: ArrowRight,
      onClick: () => sid && go('/grade', { studentId: sid })
    },
    {
      key: 'wrong',
      value: pendingWrongCount.value,
      unit: '道',
      label: '待掌握错题',
      tone: pendingWrongCount.value ? 'danger' : 'success',
      actionLabel: '看错题',
      actionIcon: ArrowRight,
      onClick: () => sid && go('/wrongbook', { studentId: sid })
    },
    {
      key: 'exams',
      value: exams.value.length,
      unit: '份',
      label: '重练任务',
      tone: 'primary',
      actionLabel: '看重练',
      actionIcon: ArrowRight,
      onClick: () => sid && go('/grade', { studentId: sid, source: 'retry' })
    },
    {
      key: 'retryProgress',
      value: `${gradedExams.value}/${exams.value.length}`,
      label: '重练完成',
      tone: exams.value.length && gradedExams.value === exams.value.length ? 'success' : 'default',
      actionLabel: '看重练',
      actionIcon: ArrowRight,
      onClick: () => sid && go('/grade', { studentId: sid, source: 'retry' })
    }
  ]
})

const nextAction = computed(() => {
  if (!student.value) return null
  const urgent = weakness.value.find(w => w.isUrgent)
  if (urgent) {
    return {
      text: `${student.value.name} 在「${urgent.name}」上反复出错，建议创建一份定向重练卷。`,
      evidence: `${urgent.subject} · 掌握度 ${urgent.mastery}% · 涉及 ${urgent.wrongQuestions} 道错题${urgent.lossPositions ? ' · 失分位置：' + urgent.lossPositions : ''}`,
      to: '/wrongbook',
      cta: '去错题本创建'
    }
  }
  if (pendingWrongCount.value >= 5) {
    return {
      text: `还有 ${pendingWrongCount.value} 道错题未掌握，建议先在错题本里回顾并安排重练。`,
      evidence: `累计错题 ${wrongQuestions.value.length} 道 · 重复出错 ${repeatWrongCount.value} 道`,
      to: '/wrongbook',
      cta: '进入错题本'
    }
  }
  if (pendingExams.value > 0) {
    return {
      text: `有 ${pendingExams.value} 份重练卷待批改，先批完才能反馈掌握度。`,
      evidence: `已批改 ${gradedExams.value} 份 · 累计 ${exams.value.length} 份`,
      to: '/grade',
      cta: '去批改'
    }
  }
  if (!tasks.value.length) {
    return {
      text: `还没有 ${student.value.name} 的作业记录，上传第一份作业后会自动出诊断。`,
      evidence: '',
      to: '/upload',
      cta: '上传作业'
    }
  }
  return null
})

const taskTone = status => {
  if (status === 'failed') return 'danger'
  if (status === 'done' || status === 'reviewed') return 'success'
  if (status === 'processing' || status === 'pending') return 'processing'
  return 'warning'
}

const initial = (name) => (name || '?').slice(0, 1)
const go = (path, query = {}) => router.push({ path, query })
const formatDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日`
}
const taskLabel = (status) => ({ done: '已完成', failed: '处理异常', reviewed: '已复核' }[status] || '处理中')

async function loadStudentData() {
  loading.value = true
  loadError.value = ''
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
    if (!studentData) {
      student.value = null
    } else {
      student.value = studentData
      tasks.value = Array.isArray(taskList) ? taskList : []
      wrongQuestions.value = Array.isArray(wrongList) ? wrongList : []
      exams.value = Array.isArray(examList) ? examList : []
      mastery.value = Array.isArray(masteryList) ? masteryList : []
      weakness.value = Array.isArray(weaknessList) ? weaknessList : []
    }
  } catch (error) {
    const message = error?.message || ''
    if (/不存在|已删除|未找到|not found/i.test(message)) {
      student.value = null
      loadError.value = ''
    } else {
      loadError.value = humanizeError(message, { entity: '学生档案' })
      student.value = null
    }
  } finally {
    loading.value = false
  }
}

async function retryLoad() {
  await loadStudentData()
}

watch(() => route.params.id, (newId) => {
  if (newId) loadStudentData()
})

onMounted(loadStudentData)

async function createExamFromWeakPoint(point) {
  if (!student.value) return
  const items = wrongQuestions.value.filter(wq => wq.subject === point.subject && wq.lifecycle_status !== 'mastered' && wq.question_id)
  const questionIds = items.map(wq => wq.question_id)
  if (!questionIds.length) { ElMessage.warning('该学科暂无可组卷的待重练错题'); return }
  creatingExam.value = true
  creatingPoint.value = point.kpId
  try {
    const existing = await getGeneratedExamsByStudent(student.value.id, false).catch(() => [])
    const baseName = buildExamBaseName(items)
    const examName = buildExamNameWithSeq(baseName, existing, student.value.id)
    const exam = await createGeneratedExam({ student_id: student.value.id, name: examName, question_ids: questionIds })
    if (!exam?.id) throw new Error('创建重练卷失败')
    ElMessage.success(`已为「${point.name}」生成定向重练卷，共 ${questionIds.length} 题`)
    exams.value = await getGeneratedExamsByStudent(student.value.id, false)
  } catch (error) {
    ElMessage.error(error.message || '创建重练卷失败，请稍后重试')
  } finally {
    creatingExam.value = false
    creatingPoint.value = null
  }
}

async function refreshRetry() {
  if (!student.value) return
  try {
    exams.value = await getGeneratedExamsByStudent(student.value.id, false)
    ElMessage.success('已刷新重练记录')
  } catch (e) {
    ElMessage.error('刷新失败')
  }
}

const openEditDialog = () => {
  editForm.value = { name: student.value?.name || '', grade: student.value?.grade || student.value?.class || '' }
  editDialogVisible.value = true
}
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
  } catch (error) {
    ElMessage.error(error.message || '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.student-detail-page { width: min(100%, var(--wb-container-workspace)); margin: 0 auto; }

.skip-link {
  position: absolute;
  top: -40px;
  left: 16px;
  z-index: 100;
  padding: 8px 12px;
  background: var(--wb-primary);
  color: var(--wb-text-inverse);
  border-radius: var(--wb-radius-sm);
  text-decoration: none;
  transition: top var(--wb-motion-fast) var(--wb-motion-ease);
}
.skip-link:focus { top: 8px; }

/* ── 身份区（设计系统 28.1 允许的渐变范本） ── */
.identity-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-4);
  padding: 20px 24px;
  margin-bottom: var(--wb-space-3);
  background: linear-gradient(135deg, var(--wb-primary-mist) 0%, var(--wb-bg-card) 100%);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
}
.identity-left { display: flex; align-items: center; gap: var(--wb-space-4); }
.back-button { margin-right: 4px; }
.identity-avatar :deep(.el-avatar__inner) {
  color: var(--wb-primary);
  background: var(--wb-bg-card);
  font-weight: var(--wb-fw-semibold);
  font-size: 20px;
}
.identity-eyebrow {
  color: var(--wb-primary);
  font-size: var(--wb-fs-eyebrow);
  font-weight: var(--wb-fw-semibold);
  letter-spacing: 0.05em;
}
.identity-meta h1 {
  margin: 2px 0 6px;
  color: var(--wb-text);
  font-size: var(--wb-fs-page);
  font-weight: var(--wb-fw-bold);
  line-height: 1.25;
}
.identity-tags { display: flex; align-items: center; gap: var(--wb-space-2); }
.identity-grade { color: var(--wb-text-secondary); font-size: var(--wb-fs-body); }
.identity-right { display: flex; gap: var(--wb-space-2); }

/* ── 下一步建议（设计系统 28.1 允许的渐变范本） ── */
.next-action {
  display: flex;
  align-items: center;
  gap: var(--wb-space-4);
  padding: var(--wb-space-4) var(--wb-space-5);
  margin-bottom: var(--wb-space-4);
  background: linear-gradient(135deg, var(--wb-primary-mist) 0%, var(--wb-bg-card) 80%);
  border: 1px solid var(--wb-primary-light-5);
  border-left: 3px solid var(--wb-primary);
  border-radius: var(--wb-radius-md);
}
.next-action__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  color: var(--wb-primary);
  background: var(--wb-bg-card);
  border-radius: 50%;
  font-size: 18px;
}
.next-action__body { flex: 1; min-width: 0; }
.next-action__eyebrow {
  color: var(--wb-primary);
  font-size: var(--wb-fs-eyebrow);
  font-weight: var(--wb-fw-semibold);
  letter-spacing: 0.05em;
}
.next-action__text {
  margin-top: 4px;
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  font-weight: var(--wb-fw-semibold);
  line-height: 1.5;
}
.next-action__evidence { margin-top: 4px; color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); }
.next-action__cta { flex-shrink: 0; }

/* ── 主体网格：薄弱点跨 2 列 ── */
.main-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--wb-space-4);
  margin-bottom: var(--wb-space-4);
}
.span-2 { grid-column: span 2; }
@media (max-width: 1100px) {
  .main-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: span 1; }
}

/* ── 薄弱点列表 ── */
.weak-list { padding: 4px 4px 8px; }
.weak-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) 1fr 110px;
  align-items: center;
  gap: var(--wb-space-4);
  padding: 14px 12px;
  border-bottom: 1px solid var(--wb-border-light);
}
.weak-row:last-child { border-bottom: 0; }
.weak-main { min-width: 0; }
.weak-name { display: flex; align-items: center; gap: var(--wb-space-2); color: var(--wb-text); font-size: var(--wb-fs-body); font-weight: var(--wb-fw-semibold); }
.weak-meta { margin-top: 4px; color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); }
.weak-loss { margin-top: 4px; color: var(--wb-danger); font-size: var(--wb-fs-meta); }
.weak-bar { height: 6px; overflow: hidden; background: var(--wb-border-light); border-radius: 999px; }
.weak-bar i { display: block; height: 100%; background: var(--wb-primary); border-radius: inherit; }
.weak-bar i.low { background: var(--wb-danger); }
.weak-mastery { display: flex; align-items: center; justify-content: space-between; gap: var(--wb-space-2); }
.weak-mastery strong { color: var(--wb-text); font-size: var(--wb-fs-body); font-variant-numeric: tabular-nums; }

/* ── 任务 / 重练列表 ── */
.task-list, .retry-list { padding: 4px 4px 8px; }
.task-row, .retry-row {
  display: flex;
  align-items: center;
  gap: var(--wb-space-3);
  padding: 10px 12px;
  border-bottom: 1px solid var(--wb-border-light);
}
.task-row:last-child, .retry-row:last-child { border-bottom: 0; }
.task-main, .retry-main { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.task-main strong, .retry-main strong {
  overflow: hidden;
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-main small, .retry-main small { color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); }
.retry-count { color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); font-variant-numeric: tabular-nums; }

/* ── 行动入口（去 transform / shadow / 36px icon 块） ── */
.action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--wb-space-3); }
.action-tile {
  display: flex;
  align-items: center;
  gap: var(--wb-space-3);
  padding: var(--wb-space-4) var(--wb-space-5);
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  text-align: left;
  transition: background var(--wb-motion-fast) var(--wb-motion-ease), border-color var(--wb-motion-fast) var(--wb-motion-ease);
}
.action-tile:hover { border-color: var(--wb-primary); background: var(--wb-primary-mist); }
.action-tile:focus-visible { outline: 2px solid var(--wb-primary); outline-offset: 2px; }
.action-tile__body { flex: 1; min-width: 0; }
.action-tile__title { color: var(--wb-text); font-size: var(--wb-fs-body); font-weight: var(--wb-fw-semibold); }
.action-tile__meta { margin-top: 2px; color: var(--wb-text-secondary); font-size: var(--wb-fs-meta); }
.action-tile__arrow { color: var(--wb-text-tertiary); font-size: 14px; }
.action-tile:hover .action-tile__arrow { color: var(--wb-primary); }

/* ── 状态：加载 / 错误 / 找不到 ── */
.detail-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
  flex-direction: column;
  gap: var(--wb-space-2);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-body);
  text-align: center;
}
.detail-state strong { color: var(--wb-text); font-size: var(--wb-fs-body); }
.detail-state > .el-icon { color: var(--wb-primary); font-size: 30px; }
.error-state > .el-icon { color: var(--wb-danger); }
.error-state__actions { display: flex; gap: var(--wb-space-2); margin-top: var(--wb-space-2); }

/* ── 响应式 ── */
@media (min-width: 1521px) {
  .main-grid { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr); }
  .main-grid .span-2 { grid-column: span 1; }
}
@media (max-width: 900px) {
  .action-grid { grid-template-columns: 1fr; }
  .weak-row { grid-template-columns: 1fr; }
  .weak-bar, .weak-mastery { grid-column: 1 / -1; }
}
@media (max-width: 560px) {
  .identity-card { flex-direction: column; align-items: flex-start; gap: var(--wb-space-3); padding: var(--wb-space-4); }
  .next-action { flex-direction: column; align-items: flex-start; }
  .next-action__cta { width: 100%; }
  .next-action__cta .ds-action-button { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .action-tile, .skip-link, .identity-card, .next-action { transition: none !important; }
  .el-icon.is-loading { animation: none !important; }
}
</style>
