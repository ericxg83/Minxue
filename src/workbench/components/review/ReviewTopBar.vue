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
          <span class="chip-label">AI异常</span>
          <span class="chip-count">{{ store.aiStateStats.exception }}</span>
        </span>
        <span class="status-chip chip-processing">
          <StatusIcon state="processing" :size="16" />
          <span class="chip-label">处理中</span>
          <span class="chip-count">{{ store.aiStateStats.processing }}</span>
        </span>
      </div>
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

  <!-- 错题未入册拦截清单 -->
  <el-dialog
    v-model="store.wrongGateVisible"
    title="有错题尚未进入错题本，无法完成复核"
    width="560px"
    :close-on-click-modal="false"
  >
    <div class="wrong-gate-tip">
      以下标记为错误的题目必须成功加入错题本后，才能完成复核：
    </div>
    <ul class="wrong-gate-list">
      <li v-for="item in store.wrongGateList" :key="item.questionId" class="wrong-gate-item">
        <div class="wrong-gate-info">
          <span class="wrong-gate-no">第 {{ item.index + 1 }} 题</span>
          <span
            v-if="store.isQuestionInBook(item.questionId)"
            class="wrong-gate-badge done">已加入 ✓</span>
          <span v-else-if="item.reason === 'incomplete'" class="wrong-gate-badge warn">
            题目元素不完整：{{ item.issues.join('；') }}，请先编辑并保存
          </span>
          <span v-else class="wrong-gate-badge warn">尚未加入错题本</span>
        </div>
        <div class="wrong-gate-actions">
          <el-button
            v-if="!store.isQuestionInBook(item.questionId) && item.reason === 'complete'"
            size="small" type="primary" :loading="item.adding"
            @click="handleAddToBook(item)">加入错题本</el-button>
          <el-button
            v-if="!store.isQuestionInBook(item.questionId) && item.reason === 'incomplete'"
            size="small" type="warning"
            @click="store.focusQuestionForEdit(item.questionId)">去编辑</el-button>
        </div>
      </li>
    </ul>
    <template #footer>
      <el-button @click="store.wrongGateVisible = false">稍后再说</el-button>
      <el-button
        type="success"
        :disabled="store.unresolvedWrongQuestions.length > 0"
        @click="handleGateComplete">完成复核</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useReviewStore } from '../../stores/reviewStore'
import StatusIcon from './StatusIcon.vue'

const store = useReviewStore()

const selectedStudentId = ref('')
const selectedTaskId = ref('')

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

// 错题清单弹窗中「完成复核」
const handleGateComplete = async () => {
  if (store.unresolvedWrongQuestions.length > 0) return
  store.wrongGateVisible = false
  await doComplete()
}

// 错题清单弹窗中「加入错题本」
const handleAddToBook = async (item) => {
  item.adding = true
  try {
    await store.addQuestionToBook(item.questionId)
  } finally {
    item.adding = false
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
  border-bottom: 1px solid #e4e7ed;
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
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid;
  white-space: nowrap;
}
.chip-label { color: #606266; }
.chip-count { font-weight: 700; }
.chip-correct { background: #f0f9eb; border-color: #c2e7b0; }
.chip-correct .chip-count { color: #67c23a; }
.chip-wrong { background: #fef0f0; border-color: #fbc4c4; }
.chip-wrong .chip-count { color: #f56c6c; }
.chip-pending { background: #fdf6ec; border-color: #faecd8; }
.chip-pending .chip-count { color: #e6a23c; }
.chip-exception { background: #fff4e6; border-color: #ffd8a8; }
.chip-exception .chip-count { color: #fa8c16; }
.chip-processing { background: #f5effd; border-color: #e3d4fb; }
.chip-processing .chip-count { color: #9254de; }

.back-btn {
  font-size: 13px;
  color: #606266 !important;
}
.exam-mode-name {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
  margin-left: 4px;
}

/* ── 错题拦截清单弹窗 ── */
.wrong-gate-tip {
  font-size: 13px;
  color: #606266;
  margin-bottom: 12px;
  line-height: 1.6;
}
.wrong-gate-list {
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
  border: 1px solid #ebeef5;
  border-radius: 6px;
  margin-bottom: 8px;
  background: #fafafa;
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
  color: #303133;
}
.wrong-gate-badge {
  font-size: 12px;
  line-height: 1.5;
}
.wrong-gate-badge.warn {
  color: #e6a23c;
}
.wrong-gate-badge.done {
  color: #67c23a;
  font-weight: 600;
}
.wrong-gate-actions {
  flex-shrink: 0;
}
</style>
