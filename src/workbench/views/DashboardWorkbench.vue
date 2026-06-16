<template>
  <div class="proofread-page">
    <ReviewTopBar />
    <div class="three-panel">
      <QuestionNavPanel />
      <PaperViewerPanel />
      <QuestionDetailPanel />
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useReviewStore } from '../stores/reviewStore'
import ReviewTopBar from '../components/review/ReviewTopBar.vue'
import QuestionNavPanel from '../components/review/QuestionNavPanel.vue'
import PaperViewerPanel from '../components/review/PaperViewerPanel.vue'
import QuestionDetailPanel from '../components/review/QuestionDetailPanel.vue'

const store = useReviewStore()

// ── 初始化 ──
onMounted(async () => {
  await store.initData()
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

// ── 键盘快捷键 ──
const onKeydown = (e) => {
  // 如果焦点在输入框中，不处理快捷键
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault()
      store.prevQuestion()
      break
    case 'ArrowRight':
      e.preventDefault()
      store.nextQuestion()
      break
    case 'c':
    case 'C':
      handleQuickReview('correct')
      break
    case 'w':
    case 'W':
      handleQuickReview('wrong')
      break
    case 'e':
    case 'E':
      handleQuickReview('exclude')
      break
  }
}

const handleQuickReview = async (result) => {
  const q = store.currentReviewQuestion
  if (!q) return
  if (result === 'wrong') {
    const blocked = store.reviewQuestion(q.id, result)
    if (blocked?.blocked) {
      const { ElMessageBox } = await import('element-plus')
      ElMessageBox.confirm(
        `题目不完整，无法加入错题本：<br><span style="color:#e6a23c">${blocked.issues.map(i => '• ' + i).join('<br>')}</span><br><br>请先在右侧面板中编辑补充缺失信息。`,
        '题目不完整',
        { confirmButtonText: '知道了', cancelButtonText: '取消', type: 'warning', dangerouslyUseHTMLString: true }
      ).catch(() => {})
      return
    }
  } else {
    store.reviewQuestion(q.id, result)
  }
}
</script>

<style scoped>
.proofread-page {
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
</style>
