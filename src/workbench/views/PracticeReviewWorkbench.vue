<template>
  <div class="practice-review-page">
    <!-- 错题重练入口：进入统一批改工作台（paper 模式） -->
    <ReviewWorkspace task-type="paper" />
  </div>
</template>

<script setup>
import ReviewWorkspace from '../components/review/ReviewWorkspace.vue'
</script>

<style scoped>
.practice-review-page {
  height: 100vh;
  overflow: hidden;
}
</style>
