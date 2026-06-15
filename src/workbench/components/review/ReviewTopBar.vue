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
      <span v-if="store.allQuestions.length > 0" class="complete-status">
        {{ store.reviewProgress.confirmed }}/{{ store.reviewProgress.total }} 已确认
      </span>
      <el-button size="default" type="success"
        :disabled="store.reviewProgress.confirmed !== store.reviewProgress.total || store.reviewProgress.total === 0"
        @click="handleComplete">
        ✓ 完成复核
      </el-button>
      <el-button size="default" type="primary" :disabled="!canNextTask" @click="goNextTask">
        ▶ 下一份
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useReviewStore } from '../../stores/reviewStore'

const store = useReviewStore()

const selectedStudentId = ref('')
const selectedTaskId = ref('')

// 当 store 中 currentStudent 变化时同步下拉框
watch(() => store.currentStudent?.id, (id) => {
  selectedStudentId.value = id || ''
})

// 当 store 中 currentTask 变化时同步下拉框
watch(() => store.currentTask?.id, (id) => {
  selectedTaskId.value = id || ''
})

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
  // 自动选择第一份待复核试卷（优先 done）
  const firstPending = store.studentTasks.find(t => t.status === 'done')
  const target = firstPending || store.studentTasks[0]
  if (target) {
    selectedTaskId.value = target.id
    await store.selectTask(target)
  }
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

const handleComplete = async () => {
  try {
    await store.completeTaskReview()
    ElMessage.success('试卷复核完成，已保存')
    // 自动跳转到下一份待复核试卷
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
.complete-status {
  font-size: 13px;
  color: #67c23a;
  font-weight: 500;
  white-space: nowrap;
}
</style>
