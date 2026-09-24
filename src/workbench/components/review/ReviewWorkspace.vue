<template>
  <div class="review-workspace">
    <div class="review-identity-bar">
      <div class="review-identity">
        <span class="review-kicker">教师工作台</span>
        <strong>{{ store.reviewConfig.topTitle }}</strong>
        <span class="review-mode-pill">{{ store.reviewConfig.modeLabel }}</span>
      </div>
    </div>
    <ReviewTopBar />


    <div v-if="store.currentTask && store.allQuestions.length > 0" class="review-context-bar">
      <div class="review-context-main">
        <span class="review-context-label">当前复核</span>
        <strong>{{ store.currentTask.original_name || '当前试卷' }}</strong>
        <span class="review-context-meta">{{ store.currentStudent?.name || '未选择学生' }}</span>
      </div>
      <div class="review-progress-summary">
        <span>已确认 {{ store.reviewProgress.confirmed }} / {{ store.reviewProgress.total }}</span>
        <el-progress :percentage="reviewProgressPercent" :stroke-width="6" :show-text="false" status="success" style="width: 120px" />
        <span class="review-progress-percent">{{ reviewProgressPercent }}%</span>
        <!-- 未确认 > 0 时给出明确入口：口径与 6 态同源后，未确认题 = 待复核/AI未判定/处理中，
             点击直接跳到下一道（循环），老师不用再在列表里猜「还差的题在哪」 -->
        <button
          v-if="store.reviewProgress.unconfirmed > 0"
          class="review-progress-todo"
          type="button"
          title="跳到下一道待确认的题（待复核 / AI未判定 / 处理中）"
          @click="jumpToNextUnconfirmed"
        >还差 {{ store.reviewProgress.unconfirmed }} 题 · 去确认</button>
      </div>
      <div class="review-context-actions">
        <el-tag v-if="archiveState === 'published'" type="success" size="small" effect="plain">
          <el-icon><Check /></el-icon>
          <span style="margin-left: 4px">已发布到答案库</span>
        </el-tag>
        <el-tag v-else-if="archiveState === 'draft'" type="warning" size="small" effect="plain">
          <el-icon><Document /></el-icon>
          <span style="margin-left: 4px">草稿（完成复核后自动发布）</span>
        </el-tag>
      </div>
    </div>
    <!-- 重练答卷覆盖度提示（缺页 / 缺题）。
         答卷图上找不到记录的题会落成「AI 未判定」（exception，老师必须逐题处理），
         但界面上过去没有任何线索说明"为什么这几题没判定"——左栏页标已在
         bc94558 关闭（paper 模式不渲染），中央页指示器又只在 pages>1 时出现，
         于是少拍一页 = 信息黑洞（2026-09-15 错题再测-0911 陈昊煜实锤：11/16）。
         这里只陈述事实 + 两种处置建议，**不替老师改判定**。 -->
    <div v-if="store.retryCoverage" class="review-coverage-notice">
      <el-icon class="coverage-icon"><WarningFilled /></el-icon>
      <span class="coverage-text">
        本卷共 <strong>{{ store.retryCoverage.total }}</strong> 题，本次上传的答卷图上只找到
        <strong>{{ store.retryCoverage.matched }}</strong> 题的作答记录{{ retryCoveragePageText }}；
        <strong>第 {{ retryCoverageLabelText }} 题</strong>在图上没有任何作答痕迹。
      </span>
      <span class="coverage-hint">
        若学生这几题本来空着没做，可直接按「未作答」处理；若是漏拍了一页，请让学生补传该页后重新处理。
      </span>
    </div>
    <!-- 重练卷不可复核（学生还没交卷 / AI 处理中） -->
    <!-- 必须先于 all-done / 三栏判断：这批卷的学生答卷不存在，三栏里的
         AI 统计、原卷出处、完成批改按钮都会拿原始作业的旧判定冒充本次结果 -->
    <div v-if="reviewBlocked" class="review-blocked-state">
      <el-icon size="48"><Clock /></el-icon>
      <div class="review-blocked-title">这份重练卷还不能复核</div>
      <div class="review-blocked-sub">
        {{ store.currentStudent?.name || '该学生' }} 的「{{ store.currentTask?.original_name }}」已布置，
        {{ blockedReason }}。学生扫码提交答卷并完成 AI 批改后，这里才会出现待复核内容。
      </div>
      <div class="review-blocked-hint">
        下方是这张卷的纸面预览（与打印版同口径，不含判定结果）。
      </div>
      <div class="review-blocked-actions">
        <el-button plain @click="goGradeCenter">返回批改中心</el-button>
        <el-button text @click="goWrongBook">查看错题池</el-button>
      </div>
      <RetryPaperPreview
        v-if="blockedQuestionIds.length"
        class="review-blocked-preview"
        :question-ids="blockedQuestionIds"
        :title="store.currentTask?.original_name"
        :student-name="store.currentStudent?.name"
      />
    </div>

    <!-- 全部复核完成（空状态） -->
    <div v-else-if="store.reviewAllDone && store.currentStudent" class="all-done-state">
      <el-icon size="56"><CircleCheck /></el-icon>
      <div class="all-done-title">该名同学暂无要处理复核的试卷</div>
      <div class="all-done-sub">
        {{ store.reviewedTasks.length }} 份试卷已完成复核
      </div>
      <div class="all-done-hint">可在上方切换其他学生继续处理</div>
      <div class="all-done-actions">
        <el-button type="primary" @click="goToTodo">查看待办</el-button>
        <el-button plain @click="goToWrongBook">查看错题池</el-button>
        <el-button text @click="goToStudents">切换学生</el-button>
      </div>
    </div>

    <!-- 三栏主体 -->
    <div v-else class="three-panel">
      <QuestionNavPanel />
      <PaperViewerPanel />
      <QuestionDetailPanel />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, CircleCheck, Clock, Document, WarningFilled } from '@element-plus/icons-vue'
import { useReviewStore } from '../../stores/reviewStore'
import { getResource } from '../../../services/apiService'
import ReviewTopBar from './ReviewTopBar.vue'
import QuestionNavPanel from './QuestionNavPanel.vue'
import PaperViewerPanel from './PaperViewerPanel.vue'
import QuestionDetailPanel from './QuestionDetailPanel.vue'
import RetryPaperPreview from './RetryPaperPreview.vue'
import { RETRY_PAPER_STATE } from '../../utils/retryPaperState'

const props = defineProps({
  // 批改场景（当前仅 homework 题目校对）
  taskType: { type: String, default: 'homework' },
})

const store = useReviewStore()
const route = useRoute()
const router = useRouter()
const reviewProgressPercent = computed(() => {
  const total = Number(store.reviewProgress.total) || 0
  const count = Number(store.reviewProgress.confirmed) || 0
  return total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0
})

// 「还差 N 题 · 去确认」：跳到当前题之后的下一道未确认题（循环兜回头部）。
// 未确认口径与 questionConfirmationMap（6 态同源）一致，跳转目标一定能在
// 左侧列表里看到对应状态（待复核 / AI未判定 / 处理中）。
const jumpToNextUnconfirmed = () => {
  const unconfirmedIdxs = []
  store.allQuestions.forEach((q, i) => {
    if (store.questionConfirmationMap[q.id] === false) unconfirmedIdxs.push(i)
  })
  if (unconfirmedIdxs.length === 0) return
  const cur = store.currentReviewIndex
  const next = unconfirmedIdxs.find(i => i > cur) ?? unconfirmedIdxs[0]
  store.jumpToQuestion(next)
}
const goToTodo = () => router.push('/todo')
const goToWrongBook = () => router.push({ path: '/wrongbook', query: { studentId: store.currentStudent?.id } })
const goToStudents = () => router.push('/students')
const goGradeCenter = () => router.push('/grade')

// ── 重练答卷覆盖度提示文案 ──
// 页码说明：只上传 1 页是最需要点名的情况（卷面跨 2 页却只有 1 页图 = 缺页的实锤）。
const retryCoveragePageText = computed(() => {
  const c = store.retryCoverage
  if (!c) return ''
  return c.pageCount <= 1 ? '（本次答卷只上传了 1 页）' : `（本次答卷共 ${c.pageCount} 页）`
})

// 卷面编号压成区间：12、13、14、15、16 → 12~16；散号保持顿号罗列。
// 卷面编号可能是 '4(1)' 这类带小问号的非纯数字，遇非数字一律退回顿号罗列。
const retryCoverageLabelText = computed(() => {
  const labels = store.retryCoverage?.missingLabels || []
  if (labels.length < 3) return labels.join('、')
  const nums = labels.map(Number)
  if (!nums.every(n => Number.isFinite(n))) return labels.join('、')
  const sorted = nums.slice().sort((a, b) => a - b)
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)
  return contiguous ? `${sorted[0]}~${sorted[sorted.length - 1]}` : labels.join('、')
})

// ── 重练卷不可复核（2026-09-12 修复）──
// 学生还没交卷 / AI 还在跑的卷不允许进入复核视图。
// 兜底场景：批改中心的旧链接、Dashboard 深链、老师打开的瞬间学生才交卷。
const reviewBlocked = computed(() =>
  !!store.currentTask && !store.currentPaperReviewable
)

const blockedReason = computed(() => {
  if (store.currentPaperState === RETRY_PAPER_STATE.GRADING) return 'AI 正在识别与判题'
  return '学生还没有提交答卷'
})

// 卷面预览用的题单。reviewStore 的 paper 映射字段是 _questionIds，
// 批改中心卡片是 questionIds —— 两处来源不同，这里统一兜住。
const blockedQuestionIds = computed(() => {
  const t = store.currentTask
  return (t?._questionIds || t?.questionIds || []).filter(Boolean)
})

// 当前 task 关联 resource 的实际 status。
// 必须用 GET /resources/:id 拿真实状态，不能从 task.status 推（B 学生复用 A 答案库时
// task.status 仍是 done，会被误判为 draft，触发错误的"首次留底"弹窗）。
const currentResourceStatus = ref(null)
const loadResourceStatus = async (resourceId) => {
  if (!resourceId) {
    currentResourceStatus.value = null
    return
  }
  try {
    const r = await getResource(resourceId)
    currentResourceStatus.value = r?.status || null
  } catch (e) {
    console.warn('[archive] 加载 resource 状态失败:', e?.message)
    currentResourceStatus.value = null
  }
}
watch(() => store.currentTask?.resource_id, (rid) => {
  loadResourceStatus(rid)
}, { immediate: true })

// v4 答案库状态展示：
//   hidden    → 非 exam 任务 / 没关联 resource，不展示
//   draft     → exam 任务且 resource.status === 'draft'（首次复核，会触发留底确认）
//   published → resource.status === 'published'（已留底，B/C/D 学生复核时）
const archiveState = computed(() => {
  const t = store.currentTask
  if (!t) return 'hidden'
  if (t.task_type !== 'exam') return 'hidden'
  if (!t.resource_id) return 'hidden'
  return currentResourceStatus.value === 'published' ? 'published' : 'draft'
})

// 暴露给 ReviewTopBar.handleComplete 弹"留底"确认用
provide('archiveState', archiveState)

// ── 初始化：加载数据 ──
onMounted(async () => {
  store.setTaskType(props.taskType)

  // 任务列表/外部入口跳转：openTask 永远带 studentId + taskId（retry 的 taskId 是 exam.id），
  // 必须以 studentId 为准定位学生，绝不能先默认选第一个学生再用 getTaskById 反查——
  // 否则 retry 的 exam.id 命中 /tasks/:examId 会 404，loadTaskById 失败，
  // 页面就停在默认第一个学生（丁嘉炜）的空状态，这就是「定位到错误学生」的根因。
  const requestedStudentId = route.query.studentId
  const requestedTaskId = route.query.taskId || route.query.examId

  // 先加载学生列表（不在这里默认选第一个学生，避免污染后续定位）
  await store.loadStudents()

  // 1) 入口已明确带 studentId：以它为准，绝不落到默认第一个学生
  if (requestedStudentId) {
    const student = store.students.find(item => String(item.id) === String(requestedStudentId))
    if (student) {
      if (!store.currentStudent || String(store.currentStudent.id) !== String(student.id)) {
        store.setCurrentStudent(student)
      }
      // 加载该学生的任务（homework 任务或 retry 练习卷）与错题
      await Promise.all([
        store.loadStudentTasks(student.id),
        store.loadWrongQuestions(student.id)
      ])
      // 2) 在该学生上下文里定位具体试卷（retry 的 exam 已映射到 studentTasks）
      const task = requestedTaskId
        ? store.studentTasks.find(t => String(t.id) === String(requestedTaskId))
        : null
      if (task) {
        await store.selectTask(task)
      } else if (requestedTaskId) {
        // 试卷不在该学生任务列表（异常/草稿态等）：保留原反查兜底
        await store.loadTaskById(requestedTaskId)
      } else {
        await store.autoSelectPendingTask?.()
      }
      return
    }
    // studentId 带错（找不到该学生）：落到默认行为
  }

  // 2) 未带 studentId：维持原默认行为（选第一个学生 + 反查 task）
  await store.initData()
  if (requestedTaskId) {
    await store.loadTaskById(requestedTaskId)
    return
  }
  const fallbackStudentId = route.query.studentId
  if (fallbackStudentId) {
    const student = store.students.find(item => String(item.id) === String(fallbackStudentId))
    if (student && student.id !== store.currentStudent?.id) {
      store.setCurrentStudent(student)
      await store.loadStudentTasks(student.id)
      await store.loadWrongQuestions(student.id)
      await store.autoSelectPendingTask?.()
    }
  }
})

onUnmounted(() => {
  // 退出时重置场景模式，避免污染后续入口
  store.resetReviewMode()
})
</script>

<style scoped>
.review-workspace {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--wb-bg);
  overflow: hidden;
}

.three-panel {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.all-done-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--wb-text-tertiary);
}
.all-done-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--wb-text);
}
.all-done-sub {
  font-size: 14px;
  color: var(--wb-success);
}
.all-done-hint {
  font-size: 13px;
  color: var(--wb-text-tertiary);
  margin-top: 4px;
}

.all-done-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }

/* ── 重练卷不可复核（学生还没交卷 / AI 处理中）──
   与 all-done 空态同视觉语言，但可滚动：下方带卷面预览，让老师知道卷子长什么样 */
.review-blocked-state {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 24px 32px;
  color: var(--wb-text-tertiary);
}
.review-blocked-state > .el-icon { color: var(--wb-text-tertiary); }
.review-blocked-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--wb-text);
}
.review-blocked-sub {
  max-width: 560px;
  text-align: center;
  font-size: 14px;
  line-height: 1.7;
  color: var(--wb-text-secondary);
}
.review-blocked-hint {
  font-size: 13px;
  color: var(--wb-text-tertiary);
}
.review-blocked-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 10px;
}
.review-blocked-preview { width: 100%; max-width: 780px; margin: 0 auto; }

/* ── 完成汇总弹窗 ── */
.completion-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 24px 0 8px;
}
.completion-stats {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 16px;
  border-radius: var(--wb-radius-sm);
  background: var(--wb-bg);
}
.stat-label { font-size: 14px; color: var(--wb-text-tertiary); }
.stat-value { font-size: 14px; font-weight: 600; color: var(--wb-text); }
.stat-value--success { color: var(--wb-success); }
.stat-value--primary { color: var(--wb-primary); }
.stat-value--danger { color: var(--wb-danger); }


.review-identity-bar { display: flex; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 20px; background: #172033; color: #fff; }
.review-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.review-kicker { color: #AAB4C5; font-size: 11px; }
.review-identity strong { font-size: 14px; font-weight: 650; }
.review-mode-pill { padding: 3px 8px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; color: #DCE3F1; font-size: 11px; }
.review-context-bar { display: flex; align-items: center; justify-content: space-between; min-height: 54px; padding: 0 20px; background: var(--wb-bg-card); border-bottom: 1px solid var(--wb-border); }
.review-context-main { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.review-context-label { color: var(--wb-text-tertiary); font-size: 11px; }
.review-context-main strong { overflow: hidden; color: var(--wb-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.review-context-meta { color: var(--wb-text-secondary); font-size: 12px; }
.review-progress-summary { display: flex; align-items: center; gap: 10px; color: var(--wb-text-secondary); font-size: 12px; }
.review-progress-percent { color: var(--wb-text); font-weight: 650; font-variant-numeric: tabular-nums; }
.review-progress-todo {
  padding: 2px 10px;
  border: 1px solid var(--wb-warning-soft);
  border-radius: 999px;
  background: var(--wb-warning-soft);
  color: var(--wb-warning);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: filter 0.15s;
}
.review-progress-todo:hover { filter: brightness(0.96); }
/* ── 重练答卷覆盖度提示（缺页 / 缺题）──
   注意：正文用 --wb-text 而非 --wb-warning —— #D97706 压在 #FEF3C7 上对比度不足，
   12px 小字会糊。警示语义靠左侧色条 + 数字着色承载。 */
.review-coverage-notice {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 7px 20px;
  background: var(--wb-warning-soft);
  border-bottom: 1px solid var(--wb-border);
  border-left: 3px solid var(--wb-warning);
  color: var(--wb-text);
  font-size: 12px;
  line-height: 1.7;
}
.review-coverage-notice .coverage-icon {
  align-self: center;
  flex-shrink: 0;
  color: var(--wb-warning);
  font-size: 14px;
}
.review-coverage-notice .coverage-text strong {
  color: var(--wb-warning);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.review-coverage-notice .coverage-hint { color: var(--wb-text-secondary); }
.review-progress-alert { padding-left: 10px; border-left: 1px solid var(--wb-border); color: var(--wb-warning); font-size: 12px; }
.review-context-actions { display: flex; align-items: center; gap: 8px; margin-left: 12px; flex-shrink: 0; }
.review-context-actions :deep(.el-button) { display: inline-flex; align-items: center; gap: 4px; }
.three-panel { min-height: 0; }
@media (max-width: 1100px) { .review-identity-bar { padding: 0 14px; } .review-context-bar { padding: 0 14px; } .review-coverage-notice { padding: 7px 14px; } }
@media (max-width: 720px) { .review-context-bar { align-items: flex-start; flex-direction: column; gap: 8px; padding: 10px 14px; } .review-progress-summary { width: 100%; } }
</style>




