<template>
  <div class="review-workspace">
    <div class="review-identity-bar">
      <div class="review-identity">
        <span class="review-kicker">教师工作台</span>
        <strong>{{ store.reviewConfig.topTitle }}</strong>
        <span class="review-mode-pill">{{ store.reviewConfig.modeLabel }}</span>
      </div>
      <div class="review-shortcuts">左右键切题 · C 正确 · W 错误 · Shift + Z 撤销</div>
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
      </div>
    </div>
    <!-- 全部复核完成（空状态） -->
    <div v-if="store.reviewAllDone && store.currentStudent" class="all-done-state">
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
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck } from '@element-plus/icons-vue'
import { useReviewStore } from '../../stores/reviewStore'
import ReviewTopBar from './ReviewTopBar.vue'
import QuestionNavPanel from './QuestionNavPanel.vue'
import PaperViewerPanel from './PaperViewerPanel.vue'
import QuestionDetailPanel from './QuestionDetailPanel.vue'

const props = defineProps({
  // 批改场景（当前仅 homework 题目校对）
  taskType: { type: String, default: 'homework' },
})

const store = useReviewStore()
const route = useRoute()
const router = useRouter()
const reviewProgressPercent = computed(() => {
  const total = Number(store.reviewProgress.total) || 0
  const confirmed = Number(store.reviewProgress.confirmed) || 0
  return total > 0 ? Math.min(100, Math.round((confirmed / total) * 100)) : 0
})
const goToTodo = () => router.push('/todo')
const goToWrongBook = () => router.push({ path: '/wrongbook', query: { studentId: store.currentStudent?.id } })
const goToStudents = () => router.push('/students')

// ── 初始化：加载数据 ──
onMounted(async () => {
  // 同步注册键盘监听（与原 DashboardWorkbench 一致，避免快速切换累积监听）
  document.addEventListener('keydown', onKeydown)
  store.setTaskType(props.taskType)
  await store.initData()
  const requestedStudentId = route.query.studentId
  if (requestedStudentId) {
    const student = store.students.find(item => String(item.id) === String(requestedStudentId))
    if (student && student.id !== store.currentStudent?.id) {
      store.setCurrentStudent(student)
      await store.loadStudentTasks(student.id)
      await store.loadWrongQuestions(student.id)
      await store.autoSelectPendingTask?.()
    }
  }
  const requestedExamId = route.query.examId
  if (requestedExamId) {
    const task = store.studentTasks.find(item => String(item.id) === String(requestedExamId))
    if (task) await store.selectTask(task)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  // 退出时重置场景模式，避免污染后续入口
  store.resetReviewMode()
})

// ── 键盘快捷键 ──
const onKeydown = (e) => {
  if (e.repeat) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  const cfg = store.reviewConfig
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault(); store.prevQuestion(); break
    case 'ArrowRight':
      e.preventDefault(); store.nextQuestion(); break
    case 'c':
    case 'C':
      if (cfg.shortcuts.correct) handleQuickReview('correct'); break
    case 'w':
    case 'W':
      if (cfg.shortcuts.wrong) handleQuickReview('wrong'); break
    case 'e':
    case 'E':
      if (cfg.shortcuts.exclude) handleQuickReview('exclude'); break
    case 'z':
    case 'Z':
      if (e.shiftKey) store.undoLastReview(); break
  }
}

const handleQuickReview = async (result) => {
  const q = store.currentReviewQuestion
  if (!q) return
  // 错误题需完整性校验门禁
  if (result === 'wrong') {
    const blocked = store.reviewQuestion(q.id, result)
    if (blocked?.blocked) {
      const { ElMessageBox } = await import('element-plus')
      ElMessageBox.confirm(
        `题目不完整，无法加入错题本：<br><span style="color:var(--wb-warning)">${blocked.issues.map(i => '• ' + i).join('<br>')}</span><br><br>请先在右侧面板中编辑补充缺失信息。`,
        '题目不完整',
        { confirmButtonText: '知道了', cancelButtonText: '取消', type: 'warning', dangerouslyUseHTMLString: true }
      ).catch(() => {})
    }
  } else {
    store.reviewQuestion(q.id, result)
  }
}
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
.review-shortcuts { color: #AAB4C5; font-size: 11px; }
.review-context-bar { display: flex; align-items: center; justify-content: space-between; min-height: 54px; padding: 0 20px; background: var(--wb-bg-card); border-bottom: 1px solid var(--wb-border); }
.review-context-main { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.review-context-label { color: var(--wb-text-tertiary); font-size: 11px; }
.review-context-main strong { overflow: hidden; color: var(--wb-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.review-context-meta { color: var(--wb-text-secondary); font-size: 12px; }
.review-progress-summary { display: flex; align-items: center; gap: 10px; color: var(--wb-text-secondary); font-size: 12px; }
.review-progress-percent { color: var(--wb-text); font-weight: 650; font-variant-numeric: tabular-nums; }
.review-progress-alert { padding-left: 10px; border-left: 1px solid var(--wb-border); color: var(--wb-warning); font-size: 12px; }
.three-panel { min-height: 0; }
@media (max-width: 1100px) { .review-shortcuts { display: none; } .review-identity-bar { padding: 0 14px; } .review-context-bar { padding: 0 14px; } }
@media (max-width: 720px) { .review-context-bar { align-items: flex-start; flex-direction: column; gap: 8px; padding: 10px 14px; } .review-progress-summary { width: 100%; } }
</style>




