<template>
  <div class="review-workspace">
    <!-- [header 三合一] 深色 identity 条已整条删除；进度/欠账/归档态已并入 ReviewTopBar 单条 header。 -->
    <!-- [P0-1 完成引导] 右栏完成态出口转发给顶栏：handleComplete 自带错题门禁，
         goNextTask 维护试卷下拉选中态——业务留在原处，这里只做事件转发。 -->
    <ReviewTopBar ref="reviewTopBarRef" />


    <!-- [header 三合一] 原上下文条（当前复核标题/进度/还差N题/缺元素/归档态）已整条删除：
         标题与顶栏下拉重复→去重；进度/欠账/归档态→已并入 ReviewTopBar 单条 header。 -->
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
      <QuestionDetailPanel
        @complete-review="reviewTopBarRef?.handleComplete?.()"
        @next-task="reviewTopBarRef?.goNextTask?.()"
        @prev-task="reviewTopBarRef?.goPrevTask?.()"
      />
    </div>

    <!-- [④ 撤销 snackbar] 判定后底部持久提示：点「撤销」或按 ⌘Z/Ctrl+Z 回退上一笔（仅本页内存） -->
    <div v-if="store.undoHint" class="undo-snackbar" role="status" aria-live="polite">
      <span class="undo-snackbar__text">{{ store.undoHint.text }}</span>
      <button type="button" class="undo-snackbar__btn" :disabled="!store.canUndo" @click="handleUndoHint">撤销</button>
      <button type="button" class="undo-snackbar__close" aria-label="关闭提示" @click="store.undoHint = null">×</button>
    </div>

    <!-- [⑤ ⌘K 命令面板] 完成复核带错题门禁，逻辑在 ReviewTopBar，这里 emit 转发 -->
    <ReviewCommandPalette @run-complete="reviewTopBarRef?.handleComplete?.()" />

    <!-- [B2-3 快捷键速查] ? 键与顶栏「更多 → 快捷键速查」打开同一浮层 -->
    <el-dialog v-model="store.shortcutsVisible" title="快捷键速查" width="440px" append-to-body>
      <table class="shortcut-table">
        <tbody>
          <tr><td><kbd>Space</kbd></td><td>标对（判定后自动到下一未确认题）</td></tr>
          <tr><td><kbd>X</kbd></td><td>标错（判定后自动到下一未确认题）</td></tr>
          <tr><td><kbd>Shift</kbd>+<kbd>X</kbd></td><td>删除本题（需二次确认，不可在本页找回）</td></tr>
          <tr><td><kbd>E</kbd></td><td>编辑本题（编辑态内：<kbd>S</kbd> 保存，<kbd>Esc</kbd> 取消）</td></tr>
          <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>上一题 / 下一题（仅导航，不判定）</td></tr>
          <tr><td><kbd>Enter</kbd></td><td>完成复核（全卷确认后可用）</td></tr>
          <tr><td><kbd>T</kbd> / <kbd>Shift</kbd>+<kbd>T</kbd></td><td>下一份 / 上一份待复核试卷</td></tr>
          <tr><td><kbd>?</kbd></td><td>打开本速查</td></tr>
        </tbody>
      </table>
      <div class="shortcut-tip">判定后自动跳下一题可在顶栏「⋯ 更多」中关闭。</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, Clock, WarningFilled } from '@element-plus/icons-vue'
import { useReviewStore } from '../../stores/reviewStore'
import { getResource } from '../../../services/apiService'
import ReviewTopBar from './ReviewTopBar.vue'
import QuestionNavPanel from './QuestionNavPanel.vue'
import PaperViewerPanel from './PaperViewerPanel.vue'
import QuestionDetailPanel from './QuestionDetailPanel.vue'
import RetryPaperPreview from './RetryPaperPreview.vue'
import ReviewCommandPalette from './ReviewCommandPalette.vue'
import { RETRY_PAPER_STATE } from '../../utils/retryPaperState'

const props = defineProps({
  // 批改场景（当前仅 homework 题目校对）
  taskType: { type: String, default: 'homework' },
})

const store = useReviewStore()
const route = useRoute()
const router = useRouter()
// [P0-1 完成引导] 右栏完成态按钮经由这里转发到顶栏的 handleComplete / goNextTask
const reviewTopBarRef = ref(null)
const goToTodo = () => router.push('/todo')
// 第 91 轮：错题中心页面下线，清单并入学生档案页（没有学生上下文时落到学生列表，
// 避免拼出 /students/undefined）
const goToWrongBook = () => router.push(
  store.currentStudent?.id ? { path: `/students/${store.currentStudent.id}` } : { path: '/students' }
)
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

// [④ 撤销 snackbar] 撤销动作 + 全局 ⌘Z / Ctrl+Z（输入焦点让位原生文本撤销）
const handleUndoHint = () => { store.undoLastReview() }
const isEditableTarget = (el) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
const onUndoKey = (e) => {
  // [⑤ ⌘K] 命令面板开关（输入框内也允许，⌘K 非原生文本操作）
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    store.commandPaletteVisible = !store.commandPaletteVisible
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    if (isEditableTarget(e.target)) return
    if (!store.canUndo) return
    e.preventDefault()
    store.undoLastReview()
  }
}
onMounted(() => window.addEventListener('keydown', onUndoKey))

onUnmounted(() => {
  window.removeEventListener('keydown', onUndoKey)
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


/* [header 三合一] identity 条与上下文条已删除，其专属样式（review-identity / review-context / review-progress / gate-skip 系列）同步移除；
   进度/欠账/归档样式已随功能迁至 ReviewTopBar。 */

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
.three-panel { min-height: 0; }
@media (max-width: 1100px) { .review-coverage-notice { padding: 7px 14px; } }

/* [B2-3 快捷键速查] 浮层内键位表（append-to-body 渲染，走 :deep 无必要——
   dialog 内容仍在本组件作用域内编译） */
.shortcut-table { width: 100%; border-collapse: collapse; }
.shortcut-table td { padding: 7px 10px; border-bottom: 1px solid var(--wb-border); font-size: 13px; color: var(--wb-text-primary); }
.shortcut-table td:first-child { width: 130px; white-space: nowrap; }
.shortcut-table kbd {
  display: inline-block; min-width: 20px; padding: 1px 6px;
  border: 1px solid var(--wb-border); border-radius: 4px;
  background: var(--wb-bg-secondary, #f5f7fa);
  font-family: inherit; font-size: 12px; text-align: center;
}
.shortcut-tip { margin-top: 10px; font-size: 12px; color: var(--wb-text-tertiary); }

/* [④ 撤销 snackbar] 底部居中持久提示（复用现有色与 token，不新增视觉变量） */
.undo-snackbar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 16px;
  background: #172033;
  color: #fff;
  border-radius: var(--wb-radius-md);
  box-shadow: var(--wb-elev-modal);
  font-size: 13px;
}
.undo-snackbar__text { white-space: nowrap; }
.undo-snackbar__btn {
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, .28);
  border-radius: var(--wb-radius-sm);
  background: transparent;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.undo-snackbar__btn:hover:not(:disabled) { background: rgba(255, 255, 255, .12); }
.undo-snackbar__btn:disabled { opacity: .45; cursor: not-allowed; }
.undo-snackbar__close {
  width: 26px; height: 26px;
  border: 0; border-radius: var(--wb-radius-sm);
  background: transparent; color: rgba(255, 255, 255, .7);
  font-size: 18px; line-height: 1; cursor: pointer;
}
.undo-snackbar__close:hover { background: rgba(255, 255, 255, .12); color: #fff; }
</style>




