<template>
  <div class="review-workspace">
    <ReviewTopBar />

    <!-- 全部复核完成（空状态） -->
    <div v-if="store.reviewAllDone && store.currentStudent" class="all-done-state">
      <el-icon size="56"><CircleCheck /></el-icon>
      <div class="all-done-title">该名同学暂无要处理复核的试卷</div>
      <div class="all-done-sub">
        {{ store.reviewedTasks.length }} 份试卷已完成复核
      </div>
      <div class="all-done-hint">可在上方切换其他学生继续处理</div>
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
import { onMounted, onUnmounted } from 'vue'
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

// ── 初始化：加载数据 ──
onMounted(async () => {
  // 同步注册键盘监听（与原 DashboardWorkbench 一致，避免快速切换累积监听）
  document.addEventListener('keydown', onKeydown)
  store.setTaskType(props.taskType)
  await store.initData()
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
        `题目不完整，无法加入错题本：<br><span style="color:#e6a23c">${blocked.issues.map(i => '• ' + i).join('<br>')}</span><br><br>请先在右侧面板中编辑补充缺失信息。`,
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
  background: #f5f7fa;
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
  color: #909399;
}
.all-done-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}
.all-done-sub {
  font-size: 14px;
  color: #67c23a;
}
.all-done-hint {
  font-size: 13px;
  color: #c0c4cc;
  margin-top: 4px;
}

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
  border-radius: 8px;
  background: #f5f7fa;
}
.stat-label { font-size: 14px; color: #86909C; }
.stat-value { font-size: 14px; font-weight: 600; color: #1D2129; }
.stat-value--success { color: #67C23A; }
.stat-value--primary { color: #1677FF; }
.stat-value--danger { color: #F56C6C; }
</style>
