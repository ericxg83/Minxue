<template>
  <div class="top-bar">
    <div class="top-bar-left">
      <el-select
        v-model="selectedStudentId"
        placeholder="选择学生"
        size="default"
        style="width: 200px"
        @change="onStudentChange"
      >
        <el-option
          v-for="s in store.students"
          :key="s.id"
          :label="s.name"
          :value="s.id"
        />
      </el-select>

      <el-select
        v-model="selectedTaskId"
        placeholder="选择试卷"
        size="default"
        style="width: 300px; margin-left: 16px"
        :disabled="!store.currentStudent"
        @change="onTaskChange"
      >
        <el-option-group v-if="store.pendingTasks.length > 0" label="待复核">
          <el-option
            v-for="t in store.pendingTasks"
            :key="t.id"
            :label="t.original_name || '未命名试卷'"
            :value="t.id"
          />
        </el-option-group>
        <el-option-group v-if="store.reviewedTasks.length > 0" label="已复核">
          <el-option
            v-for="t in store.reviewedTasks"
            :key="t.id"
            :label="`✓ ${t.original_name || '未命名试卷'}`"
            :value="t.id"
          />
        </el-option-group>
      </el-select>
    </div>

    <div class="top-bar-right">
      <div v-if="store.allQuestions.length > 0" class="status-chips">
        <span class="status-chip chip-correct">
          <StatusIcon state="correct" :size="16" />
          <span class="chip-label">AI正确</span>
          <span class="chip-count">{{ store.aiStateStats.correct }}</span>
        </span>
        <span class="status-chip chip-wrong">
          <StatusIcon state="wrong" :size="16" />
          <span class="chip-label">AI错误</span>
          <span class="chip-count">{{ store.aiStateStats.wrong }}</span>
        </span>
        <span class="status-chip chip-pending">
          <StatusIcon state="pending" :size="16" />
          <span class="chip-label">待复核</span>
          <span class="chip-count">{{ store.aiStateStats.pending }}</span>
        </span>
        <span class="status-chip chip-exception">
          <StatusIcon state="exception" :size="16" />
          <span class="chip-label">AI未判定</span>
          <span class="chip-count">{{ store.aiStateStats.exception }}</span>
        </span>
        <span class="status-chip chip-processing">
          <StatusIcon state="processing" :size="16" />
          <span class="chip-label">处理中</span>
          <span class="chip-count">{{ store.aiStateStats.processing }}</span>
        </span>
      </div>
      <!-- 置信阈值全局提示：与左栏 slider 相同一变量（store.confidenceThreshold），
           提升"AI 正确免复核"判定的可见性；不改判定来源 -->
      <el-tooltip
        content="AI 置信度 ≥ 该阈值时自动判定为「正确」无需复核；低于阈值的自动判定将进入待复核。拖动左栏下方滑块可即时调整。"
        placement="bottom"
      >
        <span class="threshold-badge" :class="{ 'threshold-warn': store.confidenceThreshold >= 0.85 }">
          AI置信 ≥ {{ (store.confidenceThreshold * 100).toFixed(0) }}% 免复核
        </span>
      </el-tooltip>
      <el-button size="default" :disabled="!store.canUndo" @click="handleUndoLast">
        ↩ 撤销上一笔
      </el-button>
      <el-button size="default" type="warning"
        :disabled="!store.currentTask" :loading="retryLoading"
        @click="handleRetryTask">
        ⟳ 重新处理
      </el-button>
      <el-button size="default" type="success"
        :disabled="store.reviewProgress.confirmed !== store.reviewProgress.total || store.reviewProgress.total === 0"
        @click="handleComplete">
        ✓ {{ store.reviewConfig.completeLabel }}
      </el-button>
      <el-button size="default" type="primary" :disabled="!canNextTask" @click="goNextTask">
        ▶ 下一份
      </el-button>
    </div>
  </div>

  <!-- 错题处理决策门禁 -->
  <el-dialog v-model="store.wrongGateVisible" title="请确认错题处理方式" width="640px" :close-on-click-modal="false">
    <div class="wrong-gate-tip">以下题目已判定为错误，但尚未完成错题处理。请选择加入错题本，或说明本次不加入。</div>
    <div class="wrong-gate-note">“本次不加入”仍会保留做错记录；如果题目本身无效，请返回题目并使用“排除”。</div>
    <ul class="wrong-gate-list">
      <li v-for="item in store.wrongGateList" :key="item.questionId" class="wrong-gate-item">
        <div class="wrong-gate-info">
          <span class="wrong-gate-no">第 {{ item.index + 1 }} 题</span>
          <span v-if="store.isQuestionInBook(item.questionId)" class="wrong-gate-badge done">已加入错题本</span>
          <span v-else-if="item.reason === 'incomplete'" class="wrong-gate-badge warn">题目元素不完整：{{ item.issues.join('、') }}</span>
          <span v-else class="wrong-gate-badge warn">等待处理决定</span>
          <el-select v-if="item.showSkipReasons" v-model="item.skipReason" class="wrong-gate-reason" size="small" placeholder="选择不加入原因" @change="handleSkipBook(item)">
            <el-option v-for="reason in skipReasonOptions" :key="reason.value" :label="reason.label" :value="reason.value" />
          </el-select>
        </div>
        <div class="wrong-gate-actions">
          <template v-if="!store.isQuestionInBook(item.questionId) && item.reason === 'complete'">
            <el-button size="small" type="primary" :loading="item.adding" @click="handleAddToBook(item)">加入错题本</el-button>
            <el-button size="small" :loading="item.skipping" @click="showSkipReasons(item)">本次不加入</el-button>
          </template>
          <el-button v-if="!store.isQuestionInBook(item.questionId) && item.reason === 'incomplete'" size="small" type="warning" @click="store.focusQuestionForEdit(item.questionId)">去编辑或排除</el-button>
        </div>
      </li>
    </ul>
    <template #footer>
      <el-button @click="store.wrongGateVisible = false">稍后处理</el-button>
      <el-button type="success" :disabled="store.unresolvedWrongQuestions.length > 0" @click="handleGateComplete">完成复核</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useReviewStore } from '../../stores/reviewStore'
import { retryTask } from '../../../services/apiService'
import StatusIcon from './StatusIcon.vue'
import { WRONG_BOOK_SKIP_REASONS } from '../../../utils/reviewDecision'

const store = useReviewStore()

const selectedStudentId = ref('')
const selectedTaskId = ref('')
const retryLoading = ref(false)
const skipReasonOptions = WRONG_BOOK_SKIP_REASONS

// 当 store 中 currentStudent 变化时同步下拉框（immediate：remount 时 store 为单例，
// 需立即回填本地选择，避免下拉显示空「选择学生」）
watch(() => store.currentStudent?.id, (id) => {
  selectedStudentId.value = id || ''
}, { immediate: true })

// 当 store 中 currentTask 变化时同步下拉框
watch(() => store.currentTask?.id, (id) => {
  selectedTaskId.value = id || ''
}, { immediate: true })

const canNextTask = computed(() => {
  if (!store.currentTask || store.pendingTasks.length === 0) return false
  const idx = store.pendingTasks.findIndex(t => t.id === store.currentTask.id)
  return idx >= 0 && idx < store.pendingTasks.length - 1
})

const onStudentChange = async (studentId) => {
  const student = store.students.find(s => s.id === studentId)
  if (!student) return
  store.setCurrentStudent(student)
  await store.loadStudentTasks(studentId)
  // 仅自动打开「待复核」试卷；无则展示空状态（已复核试卷可手动从下拉查看）
  const target = await store.autoSelectPendingTask()
  selectedTaskId.value = target?.id || ''
}

const onTaskChange = async (taskId) => {
  const task = store.studentTasks.find(t => t.id === taskId)
  if (!task) return
  await store.selectTask(task)
}

const goNextTask = async () => {
  const next = store.nextTask()
  if (next) {
    selectedTaskId.value = next.id
    await store.selectTask(next)
  } else {
    ElMessage.info('已处理完所有待复核试卷')
  }
}

// 完成批改
const handleComplete = async () => {
  // 门禁 → 完成复核 → 自动跳下一份
  const list = store.getUnresolvedWrong()
  if (list.length > 0) {
    store.openWrongGate(list)
    return
  }
  await doComplete()
}

// 真正执行完成复核 + 自动跳下一份
const doComplete = async () => {
  try {
    await store.completeTaskReview()
    ElMessage.success('试卷复核完成，已保存')
    const next = store.nextTask()
    if (next) {
      selectedTaskId.value = next.id
      await store.selectTask(next)
      ElMessage.info(`已切换到下一份试卷: ${next.original_name || '未命名试卷'}`)
    }
  } catch (err) {
    console.error('保存失败:', err)
    ElMessage.error('保存失败，请重试')
  }
}

// 错题清单弹窗中「加入错题本」
const handleAddToBook = async (item) => {
  item.adding = true
  try {
    await store.addQuestionToBook(item.questionId)
  } catch (error) {
    ElMessage.error(error.message || '加入错题本失败，请重试')
  } finally {
    item.adding = false
  }
}

const showSkipReasons = (item) => {
  item.showSkipReasons = !item.showSkipReasons
  if (!item.showSkipReasons) item.skipReason = ''
}

const handleSkipBook = async (item) => {
  if (!item.skipReason || item.skipping) return
  item.skipping = true
  try {
    await store.markWrongNoBook(item.questionId, item.skipReason)
    item.showSkipReasons = false
    ElMessage.success('已记录本次不加入错题本')
  } catch (error) {
    item.skipReason = ''
    ElMessage.error(error.message || '保存处理决定失败，请重试')
  } finally {
    item.skipping = false
  }
}

const handleGateComplete = async () => {
  if (store.unresolvedWrongQuestions.length > 0) return
  store.wrongGateVisible = false
  await doComplete()
}

// 撤销最近一次人工判定（仅回退前端状态，不反向写库）
const handleUndoLast = () => {
  const prev = store.undoLastReview()
  if (prev) {
    ElMessage({ type: 'info', message: '已撤销上一笔判定（当前页面状态已回退，不影响已保存记录）', duration: 2200 })
  }
}

// 重新处理当前试卷
const handleRetryTask = async () => {
  if (!store.currentTask?.id) return
  try {
    await ElMessageBox.confirm(
      '重新处理会清空当前识别结果并重新走 OCR + 批改流程，是否继续？',
      '确认重新处理',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  retryLoading.value = true
  try {
    await retryTask(store.currentTask.id)
    ElMessage.success('已重新提交处理队列，请稍后刷新或重新选择该试卷')
    if (store.currentStudent?.id) {
      await store.loadStudentTasks(store.currentStudent.id)
    }
  } catch (err) {
    console.error('重新处理失败:', err)
    ElMessage.error('重新处理失败: ' + (err.message || '未知错误'))
  } finally {
    retryLoading.value = false
  }
}
</script>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--wb-border);
  flex-shrink: 0;
}
.top-bar-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.top-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--wb-radius-md);
  font-size: 12px;
  font-weight: 500;
  border: 1px solid;
  white-space: nowrap;
}
.chip-label { color: var(--wb-text-secondary); }
.chip-count { font-weight: 700; }
.chip-correct { background: var(--wb-success-soft); border-color: var(--wb-success-soft); }
.chip-correct .chip-count { color: var(--wb-success); }
.chip-wrong { background: var(--wb-danger-soft); border-color: var(--wb-danger-soft); }
.chip-wrong .chip-count { color: var(--wb-danger); }
.chip-pending { background: var(--wb-warning-soft); border-color: var(--wb-warning-soft); }
.chip-pending .chip-count { color: var(--wb-warning); }
.chip-exception { background: var(--wb-accent-soft); border-color: var(--wb-accent-soft); }
.chip-exception .chip-count { color: var(--wb-accent); }
.chip-processing { background: var(--wb-processing-soft); border-color: var(--wb-processing-soft); }
.chip-processing .chip-count { color: var(--wb-processing); }

/* 置信阈值全局提示 */
.threshold-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--wb-radius-md);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--wb-text-secondary);
  background: var(--wb-bg-hover);
  border: 1px solid var(--wb-border);
  cursor: help;
  transition: all 0.2s;
}
.threshold-badge:hover {
  border-color: var(--wb-primary-soft);
  color: var(--wb-primary);
}
.threshold-badge.threshold-warn {
  color: var(--wb-warning);
  background: var(--wb-warning-soft);
  border-color: var(--wb-warning-soft);
}

.back-btn {
  font-size: 13px;
  color: var(--wb-text-secondary) !important;
}
.exam-mode-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--wb-text);
  margin-left: 4px;
}

/* ── 错题拦截清单弹窗 ── */
.wrong-gate-tip {
  font-size: 13px;
  color: var(--wb-text-secondary);
  margin-bottom: 12px;
  line-height: 1.6;
}
.wrong-gate-note {
  margin-bottom: 14px;
  padding: 9px 11px;
  color: var(--wb-text-secondary);
  font-size: 12px;
  line-height: 1.55;
  background: var(--wb-warning-soft);
  border-left: 3px solid var(--wb-warning);
  border-radius: var(--wb-radius-xs);
}.wrong-gate-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow-y: auto;
}
.wrong-gate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  margin-bottom: 8px;
  background: var(--wb-bg-hover);
}
.wrong-gate-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.wrong-gate-no {
  font-size: 14px;
  font-weight: 600;
  color: var(--wb-text);
}
.wrong-gate-badge {
  font-size: 12px;
  line-height: 1.5;
}
.wrong-gate-badge.warn {
  color: var(--wb-warning);
}
.wrong-gate-badge.done {
  color: var(--wb-success);
  font-weight: 600;
}
.wrong-gate-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
.wrong-gate-reason { width: 220px; margin-top: 4px; }
@media (max-width: 640px) {
  .wrong-gate-item { align-items: stretch; flex-direction: column; }
  .wrong-gate-actions { justify-content: flex-end; }
  .wrong-gate-reason { width: 100%; }
}


.top-bar { height: 58px; padding: 0 20px; background: var(--wb-bg-card); border-bottom: 1px solid var(--wb-border); }
.top-bar-left { gap: 8px; min-width: 0; }
.top-bar-left :deep(.el-select:first-child) { width: 150px !important; }
.top-bar-left :deep(.el-select:nth-child(2)) { width: 260px !important; margin-left: 0 !important; }
.top-bar-right { gap: 6px; }
.status-chips { gap: 4px; }
.status-chip { padding: 3px 7px; border-radius: 5px; font-size: 11px; }
.threshold-badge { padding: 4px 8px; border-radius: 5px; font-size: 11px; }
.top-bar-right :deep(.el-button) { min-height: 30px; padding: 6px 10px; border-radius: 6px; font-size: 12px; }
.top-bar-right :deep(.el-button--success) { color: #fff; background: var(--wb-success); border-color: var(--wb-success); }
.top-bar-right :deep(.el-button--primary) { color: #fff; background: var(--wb-primary); border-color: var(--wb-primary); }
.top-bar-right :deep(.el-button--warning) { color: var(--wb-warning); background: var(--wb-warning-soft); border-color: var(--wb-warning-soft); }
@media (max-width: 1200px) { .status-chips .status-chip:nth-child(n+4), .threshold-badge { display: none; } .top-bar-right :deep(.el-button) { padding: 6px 8px; } }
@media (max-width: 900px) { .top-bar { align-items: flex-start; height: auto; min-height: 58px; flex-direction: column; gap: 8px; padding: 10px 14px; } .top-bar-right { width: 100%; overflow-x: auto; padding-bottom: 2px; } }
</style>
