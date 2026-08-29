<template>
  <div class="student-detail-page wb-page">
    <div v-if="loading" class="detail-state"><el-icon class="is-loading"><Loading /></el-icon><span>正在加载学生学习记录…</span></div>
    <div v-else-if="!student" class="detail-state"><el-icon><User /></el-icon><strong>找不到这名学生</strong><el-button text type="primary" @click="go('/students')">返回学生列表</el-button></div>
    <template v-else>
      <!-- 身份区：学生档案卡 -->
      <header class="identity-card">
        <div class="identity-left">
          <el-button text class="back-button" @click="go('/students')"><el-icon><ArrowLeft /></el-icon>学生</el-button>
          <el-avatar :size="52" :src="student.avatar" class="identity-avatar">{{ initial(student.name) }}</el-avatar>
          <div class="identity-meta">
            <div class="eyebrow">学生档案</div>
            <h1>{{ student.name || '未命名学生' }}</h1>
            <div class="identity-tags">
              <el-tag size="small" :type="student.is_active === false ? 'info' : 'success'" effect="plain">{{ student.is_active === false ? '已停课' : '在读' }}</el-tag>
              <span class="identity-grade">{{ student.grade || student.class || '未设置年级' }}</span>
            </div>
          </div>
        </div>
        <div class="identity-right">
          <el-button @click="openEditDialog">编辑信息</el-button>
        </div>
      </header>

      <!-- 状态行：把"这个学生现在怎么样"压成一行 -->
      <div class="status-bar">
        <div class="status-item">
          <el-icon><Calendar /></el-icon>
          <span class="status-label">最近作业</span>
          <strong>{{ lastTaskDate || '尚无作业' }}</strong>
        </div>
        <div class="status-divider" />
        <div class="status-item">
          <el-icon><Document /></el-icon>
          <span class="status-label">累计作业</span>
          <strong>{{ tasks.length }} 份</strong>
        </div>
        <div class="status-divider" />
        <div class="status-item" :class="{ 'is-danger': pendingWrongCount > 0 }">
          <el-icon><Warning /></el-icon>
          <span class="status-label">待掌握</span>
          <strong>{{ pendingWrongCount }} 道</strong>
        </div>
        <div class="status-divider" />
        <div class="status-item">
          <el-icon><DataLine /></el-icon>
          <span class="status-label">掌握率</span>
          <strong>{{ masteryRate }}%</strong>
        </div>
        <div class="status-divider" />
        <div class="status-item">
          <el-icon><Refresh /></el-icon>
          <span class="status-label">重练完成</span>
          <strong>{{ gradedExams }}/{{ exams.length }} 份</strong>
        </div>
      </div>

      <!-- 下一步建议：把数字翻译成人话 + 一个动作（学图 6 数据化解读） -->
      <section v-if="nextAction" class="next-action">
        <div class="next-action__icon"><el-icon><Aim /></el-icon></div>
        <div class="next-action__body">
          <div class="next-action__eyebrow">下一步建议</div>
          <div class="next-action__text">{{ nextAction.text }}</div>
          <div v-if="nextAction.evidence" class="next-action__evidence">依据：{{ nextAction.evidence }}</div>
        </div>
        <div class="next-action__cta">
          <el-button type="primary" @click="go(nextAction.to)">{{ nextAction.cta }}<el-icon class="el-icon--right"><ArrowRight /></el-icon></el-button>
        </div>
      </section>

      <!-- 4 个核心指标 -->
      <div class="wb-stats-grid">
        <StatsCard label="作业记录" :value="tasks.length" unit="份" :tone="tasks.length ? 'primary' : 'default'" />
        <StatsCard label="待掌握错题" :value="pendingWrongCount" unit="道" :tone="pendingWrongCount ? 'danger' : 'success'" />
        <StatsCard label="重练任务" :value="exams.length" unit="份" :tone="exams.length ? 'accent' : 'default'" />
        <StatsCard label="知识点" :value="mastery.length" unit="个" description="掌握度数据" />
      </div>

      <!-- 主体：左侧薄弱点 / 右侧时间序列 -->
      <div class="main-grid">
        <ContentCard title="薄弱知识点" description="掌握度偏低，建议优先安排定向重练" class="span-2">
          <div v-if="weakness.length" class="weak-list">
            <div v-for="point in weakness" :key="point.kpId" class="weak-row">
              <div class="weak-main">
                <div class="weak-name">
                  <span>{{ point.name }}</span>
                  <el-tag v-if="point.isUrgent" size="small" type="danger" effect="plain">紧急</el-tag>
                </div>
                <div class="weak-meta">{{ point.subject }} · 涉及 {{ point.wrongQuestions }} 道错题</div>
                <div v-if="point.lossPositions" class="weak-loss">失分位置：{{ point.lossPositions }}</div>
              </div>
              <div class="weak-bar"><i :style="{ width: point.mastery + '%' }" :class="{ low: point.mastery < 30 }"></i></div>
              <div class="weak-mastery">
                <strong>{{ point.mastery }}%</strong>
                <el-button size="small" type="primary" link :loading="creatingExam && creatingPoint === point.kpId" @click="createExamFromWeakPoint(point)">创建组卷</el-button>
              </div>
            </div>
          </div>
          <EmptyState v-else icon="success" title="暂无薄弱知识点" description="当前知识点掌握情况良好" />
        </ContentCard>

        <ContentCard title="最近作业" description="最近 5 条任务记录">
          <template #actions>
            <el-button text type="primary" @click="go('/review', { studentId: student.id })">开始批改<el-icon class="el-icon--right"><ArrowRight /></el-icon></el-button>
          </template>
          <div v-if="recentTasks.length" class="task-list">
            <div v-for="task in recentTasks" :key="task.id" class="task-row">
              <div class="task-main">
                <strong>{{ task.original_name || task.originalName || '未命名作业' }}</strong>
                <small>{{ task.subject || '未标注学科' }} · {{ formatDate(task.created_at || task.createdAt) }}</small>
              </div>
              <el-tag :type="task.status === 'done' ? 'success' : task.status === 'failed' ? 'danger' : 'warning'" size="small" effect="plain">{{ taskLabel(task.status) }}</el-tag>
            </div>
          </div>
          <EmptyState v-else icon="document" title="还没有作业记录" description="上传第一份作业后这里会显示批改进度" />
        </ContentCard>

        <ContentCard title="最近重练" description="重练卷与批改结果">
          <template #actions>
            <el-button text type="primary" @click="refreshRetry">刷新<el-icon class="el-icon--right"><Refresh /></el-icon></el-button>
          </template>
          <div v-if="recentExams.length" class="retry-list">
            <div v-for="exam in recentExams" :key="exam.id" class="retry-row">
              <div class="retry-main">
                <strong>{{ exam.name }}</strong>
                <small>{{ formatDate(exam.created_at) }} · 共 {{ exam.total_count || exam.question_ids.length }} 题</small>
              </div>
              <el-tag :type="exam.status === 'graded' ? 'success' : 'warning'" size="small" effect="plain">{{ exam.status === 'graded' ? '已批改' : '待批改' }}</el-tag>
              <span v-if="exam.status === 'graded'" class="retry-count">{{ exam.correct_count }} 对 / {{ exam.wrong_count }} 错</span>
            </div>
          </div>
          <EmptyState v-else icon="success" title="还没有重练卷" description="去「错题本」勾选题目创建第一份吧" />
        </ContentCard>
      </div>

      <!-- 进入详细分析：3 个行动入口（不嵌组件，跳转独立页） -->
      <ContentCard title="进入详细分析" description="错题、重练与掌握度是独立的功能页">
        <div class="action-grid">
          <button class="action-tile" type="button" @click="go('/wrongbook', { studentId: student.id })">
            <div class="action-tile__icon is-danger"><el-icon><EditPen /></el-icon></div>
            <div class="action-tile__body">
              <div class="action-tile__title">错题本</div>
              <div class="action-tile__meta">待处理 {{ pendingWrongCount }} 道 · 重复出错 {{ repeatWrongCount }} 道</div>
            </div>
            <el-icon class="action-tile__arrow"><ArrowRight /></el-icon>
          </button>
          <button class="action-tile" type="button" @click="go('/review', { studentId: student.id })">
            <div class="action-tile__icon is-primary"><el-icon><Refresh /></el-icon></div>
            <div class="action-tile__body">
              <div class="action-tile__title">重练记录</div>
              <div class="action-tile__meta">已批改 {{ gradedExams }} 份 · 待批改 {{ pendingExams }} 份</div>
            </div>
            <el-icon class="action-tile__arrow"><ArrowRight /></el-icon>
          </button>
          <button class="action-tile" type="button" @click="go('/growth', { studentId: student.id })">
            <div class="action-tile__icon is-accent"><el-icon><DataLine /></el-icon></div>
            <div class="action-tile__body">
              <div class="action-tile__title">知识点掌握</div>
              <div class="action-tile__meta">薄弱 {{ weakness.length }} 个 · 已掌握 {{ masteredKpCount }} 个</div>
            </div>
            <el-icon class="action-tile__arrow"><ArrowRight /></el-icon>
          </button>
        </div>
      </ContentCard>
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
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Aim, ArrowLeft, ArrowRight, Calendar, DataLine, Document, EditPen, Loading, Refresh, User, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getStudentById, getTasksByStudent, getWrongQuestionsByStudent, getGeneratedExamsByStudent, getKnowledgeMastery, updateStudent, getStudentWeakness, createGeneratedExam } from '../../services/apiService'
import { buildExamBaseName, buildExamNameWithSeq } from '../../domain/examNaming'
import StatsCard from '../components/ui/StatsCard.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const route = useRoute(); const router = useRouter()
const loading = ref(true); const student = ref(null); const tasks = ref([]); const wrongQuestions = ref([]); const exams = ref([]); const mastery = ref([]); const weakness = ref([])
const creatingExam = ref(false); const creatingPoint = ref(null)
const editDialogVisible = ref(false); const saving = ref(false); const editFormRef = ref(); const editForm = ref({ name: '', grade: '' })
const editRules = { name: [{ required: true, message: '请输入学生姓名', trigger: 'blur' }, { min: 1, max: 30, message: '学生姓名长度应为 1-30 个字符', trigger: 'blur' }] }

const pendingWrongCount = computed(() => wrongQuestions.value.filter(item => item.lifecycle_status !== 'mastered').length)
const masteredWrongCount = computed(() => wrongQuestions.value.filter(item => item.lifecycle_status === 'mastered').length)
const repeatWrongCount = computed(() => wrongQuestions.value.filter(item => (item.error_count || 0) >= 2).length)
const pendingExams = computed(() => exams.value.filter(e => e.status !== 'graded').length)
const gradedExams = computed(() => exams.value.filter(e => e.status === 'graded').length)
const recentTasks = computed(() => tasks.value.slice(0, 5))
const recentExams = computed(() => exams.value.slice(0, 5))
const masteryRate = computed(() => {
  if (!wrongQuestions.value.length) return 0
  return Math.round(masteredWrongCount.value / wrongQuestions.value.length * 100)
})
const masteredKpCount = computed(() => weakness.value.filter(w => w.mastery >= 80).length)
const lastTaskDate = computed(() => {
  if (!tasks.value.length) return ''
  const sorted = [...tasks.value].sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
  return formatDate(sorted[0].created_at || sorted[0].createdAt)
})

// 把数字翻译成一句人话 + 一个动作（学图 6 数据化解读）
const nextAction = computed(() => {
  if (!student.value) return null
  // 优先级 1：有紧急薄弱点 → 创建组卷
  const urgent = weakness.value.find(w => w.isUrgent)
  if (urgent) {
    return {
      text: `${student.value.name} 在「${urgent.name}」上反复出错，建议创建一份定向重练卷。`,
      evidence: `${urgent.subject} · 掌握度 ${urgent.mastery}% · 涉及 ${urgent.wrongQuestions} 道错题${urgent.lossPositions ? ' · 失分位置：' + urgent.lossPositions : ''}`,
      to: '/wrongbook',
      cta: '去错题本创建'
    }
  }
  // 优先级 2：待掌握 ≥ 5 → 进错题本
  if (pendingWrongCount.value >= 5) {
    return {
      text: `还有 ${pendingWrongCount.value} 道错题未掌握，建议先在错题本里回顾并安排重练。`,
      evidence: `累计错题 ${wrongQuestions.value.length} 道 · 重复出错 ${repeatWrongCount.value} 道`,
      to: '/wrongbook',
      cta: '进入错题本'
    }
  }
  // 优先级 3：有未批改重练卷 → 去批改
  if (pendingExams.value > 0) {
    return {
      text: `有 ${pendingExams.value} 份重练卷待批改，先批完才能反馈掌握度。`,
      evidence: `已批改 ${gradedExams.value} 份 · 累计 ${exams.value.length} 份`,
      to: '/review',
      cta: '去批改'
    }
  }
  // 优先级 4：暂无作业 → 上传第一份
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

const initial = (name) => (name || '?').slice(0, 1)
const go = (path, query = {}) => router.push({ path, query })
const formatDate = (value) => { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日` }
const taskLabel = (status) => ({ done: '已完成', failed: '处理异常', reviewed: '已复核' }[status] || '处理中')

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
  } catch (error) { student.value = null } finally { loading.value = false }
})

async function createExamFromWeakPoint(point) {
  if (!student.value) return
  const items = wrongQuestions.value.filter(wq => wq.subject === point.subject && wq.lifecycle_status !== 'mastered' && wq.question_id)
  const questionIds = items.map(wq => wq.question_id)
  if (!questionIds.length) { ElMessage.warning('该学科暂无可组卷的待重练错题'); return }
  creatingExam.value = true; creatingPoint.value = point.kpId
  try {
    const existing = await getGeneratedExamsByStudent(student.value.id, false).catch(() => [])
    const baseName = buildExamBaseName(items)
    const examName = buildExamNameWithSeq(baseName, existing, student.value.id)
    const exam = await createGeneratedExam({ student_id: student.value.id, name: examName, question_ids: questionIds })
    if (!exam?.id) throw new Error('创建重练卷失败')
    ElMessage.success(`已为「${point.name}」生成定向重练卷，共 ${questionIds.length} 题`)
    exams.value = await getGeneratedExamsByStudent(student.value.id, false)
  } catch (error) { ElMessage.error(error.message || '创建重练卷失败，请稍后重试') } finally { creatingExam.value = false; creatingPoint.value = null }
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
.student-detail-page { width: min(100%, var(--wb-content-max)); margin: 0 auto; }

/* ── 身份区（档案卡）── */
.identity-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; margin-bottom: 12px; background: linear-gradient(135deg, var(--wb-primary-mist) 0%, var(--wb-bg-card) 100%); border: 1px solid var(--wb-border); border-radius: var(--wb-radius-panel); }
.identity-left { display: flex; align-items: center; gap: 16px; }
.back-button { margin-right: 4px; color: var(--wb-text-secondary); font-size: 12px; }
.identity-avatar :deep(.el-avatar__inner) { color: var(--wb-primary); background: var(--wb-bg-card); font-weight: 600; font-size: 20px; }
.eyebrow { color: var(--wb-text-tertiary); font-size: 11px; font-weight: 500; letter-spacing: 0.4px; }
.identity-meta h1 { margin: 2px 0 6px; color: var(--wb-text); font-size: 22px; font-weight: 650; line-height: 1.2; }
.identity-tags { display: flex; align-items: center; gap: 8px; }
.identity-grade { color: var(--wb-text-secondary); font-size: 13px; }
.identity-right { display: flex; gap: 8px; }

/* ── 状态行：把"这个学生现在怎么样"压成一行 ── */
.status-bar { display: flex; align-items: center; gap: 18px; padding: 14px 24px; margin-bottom: 16px; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: var(--wb-radius-panel); }
.status-item { display: flex; align-items: center; gap: 6px; color: var(--wb-text-secondary); font-size: 13px; }
.status-item .el-icon { font-size: 14px; color: var(--wb-text-tertiary); }
.status-item strong { color: var(--wb-text); font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.status-item.is-danger strong { color: var(--wb-danger); }
.status-item.is-danger .el-icon { color: var(--wb-danger); }
.status-label { color: var(--wb-text-tertiary); font-size: 12px; }
.status-divider { width: 1px; height: 18px; background: var(--wb-border); }

/* ── 下一步建议（学图 6 数据化解读）── */
.next-action { display: flex; align-items: center; gap: 16px; padding: 16px 20px; margin-bottom: 16px; background: linear-gradient(135deg, var(--wb-primary-mist) 0%, var(--wb-bg-card) 80%); border: 1px solid var(--wb-primary-light-5); border-left: 3px solid var(--wb-primary); border-radius: var(--wb-radius-panel); }
.next-action__icon { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; color: var(--wb-primary); background: var(--wb-bg-card); border-radius: 50%; font-size: 18px; box-shadow: var(--wb-shadow-sm); }
.next-action__body { flex: 1; min-width: 0; }
.next-action__eyebrow { color: var(--wb-primary); font-size: 11px; font-weight: 600; letter-spacing: 0.4px; }
.next-action__text { margin-top: 4px; color: var(--wb-text); font-size: 14px; font-weight: 550; line-height: 1.5; }
.next-action__evidence { margin-top: 4px; color: var(--wb-text-secondary); font-size: 12px; }
.next-action__cta { flex-shrink: 0; }

/* ── 主体网格：薄弱点跨 2 列 ── */
.main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.span-2 { grid-column: span 2; }
@media (max-width: 1100px) { .main-grid { grid-template-columns: 1fr; } .span-2 { grid-column: span 1; } }

/* ── 薄弱点列表 ── */
.weak-list { padding: 4px 4px 8px; }
.weak-row { display: grid; grid-template-columns: minmax(0, 1.6fr) 1fr 110px; align-items: center; gap: 16px; padding: 14px 12px; border-bottom: 1px solid var(--wb-border-light); }
.weak-row:last-child { border-bottom: 0; }
.weak-main { min-width: 0; }
.weak-name { display: flex; align-items: center; gap: 8px; color: var(--wb-text); font-size: 14px; font-weight: 600; }
.weak-meta { margin-top: 4px; color: var(--wb-text-secondary); font-size: 12px; }
.weak-loss { margin-top: 4px; color: var(--wb-danger); font-size: 12px; }
.weak-bar { height: 6px; overflow: hidden; background: var(--wb-border-light); border-radius: 999px; }
.weak-bar i { display: block; height: 100%; background: var(--wb-primary); border-radius: inherit; }
.weak-bar i.low { background: var(--wb-danger); }
.weak-mastery { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.weak-mastery strong { color: var(--wb-text); font-size: 14px; font-variant-numeric: tabular-nums; }

/* ── 任务 / 重练列表 ── */
.task-list, .retry-list { padding: 4px 4px 8px; }
.task-row, .retry-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--wb-border-light); }
.task-row:last-child, .retry-row:last-child { border-bottom: 0; }
.task-main, .retry-main { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.task-main strong, .retry-main strong { overflow: hidden; color: var(--wb-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.task-main small, .retry-main small { color: var(--wb-text-secondary); font-size: 12px; }
.retry-count { color: var(--wb-text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }

/* ── 行动入口（不嵌组件，跳转独立页）── */
.action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.action-tile { display: flex; align-items: center; gap: 14px; padding: 16px 18px; background: var(--wb-bg-card); border: 1px solid var(--wb-border); border-radius: var(--wb-radius-sm); cursor: pointer; text-align: left; transition: all 0.18s ease; }
.action-tile:hover { border-color: var(--wb-primary); box-shadow: var(--wb-shadow-sm); transform: translateY(-1px); }
.action-tile:active { transform: translateY(0); }
.action-tile__icon { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; font-size: 18px; border-radius: 8px; }
.action-tile__icon.is-primary { color: var(--wb-primary); background: var(--wb-primary-soft); }
.action-tile__icon.is-danger { color: var(--wb-danger); background: var(--wb-danger-soft); }
.action-tile__icon.is-accent { color: var(--wb-accent); background: var(--wb-accent-soft); }
.action-tile__body { flex: 1; min-width: 0; }
.action-tile__title { color: var(--wb-text); font-size: 14px; font-weight: 600; }
.action-tile__meta { margin-top: 2px; color: var(--wb-text-secondary); font-size: 12px; }
.action-tile__arrow { color: var(--wb-text-tertiary); font-size: 14px; }
.action-tile:hover .action-tile__arrow { color: var(--wb-primary); }

/* ── 状态：加载 / 找不到学生 ── */
.detail-state { display: flex; align-items: center; justify-content: center; min-height: 360px; flex-direction: column; gap: 8px; color: var(--wb-text-tertiary); font-size: 13px; }
.detail-state strong { color: var(--wb-text); font-size: 14px; }
.detail-state .is-loading { animation: rotating 1s linear infinite; }
@keyframes rotating { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ── 响应式 ── */
@media (max-width: 900px) {
  .status-bar { flex-wrap: wrap; gap: 10px 14px; padding: 12px 16px; }
  .status-divider { display: none; }
  .action-grid { grid-template-columns: 1fr; }
  .weak-row { grid-template-columns: 1fr; }
  .weak-bar, .weak-mastery { grid-column: 1 / -1; }
}
@media (max-width: 560px) {
  .identity-card { flex-direction: column; align-items: flex-start; gap: 12px; padding: 16px; }
  .next-action { flex-direction: column; align-items: flex-start; }
  .next-action__cta { width: 100%; }
  .next-action__cta .el-button { width: 100%; }
}
</style>
