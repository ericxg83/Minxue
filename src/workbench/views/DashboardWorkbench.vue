<template>
  <div class="proofread-page">
    <!-- 题目校对入口：进入统一批改工作台（homework 模式） -->
    <ReviewWorkspace task-type="homework" />
  </div>
</template>

<script setup>
import ReviewWorkspace from '../components/review/ReviewWorkspace.vue'
</script>

<style scoped>
.proofread-page {
  height: 100vh;
  overflow: hidden;
}
</style>
