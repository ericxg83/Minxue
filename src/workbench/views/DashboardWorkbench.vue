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

const handleQuickReview = (result) => {
  const q = store.currentReviewQuestion
  if (!q) return
  store.reviewQuestion(q.id, result)
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
