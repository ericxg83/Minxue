<template>
  <div class="unified-review-page">
    <ReviewWorkspace :task-type="reviewType" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ReviewWorkspace from '../components/review/ReviewWorkspace.vue'

const route = useRoute()
// 第 137 轮：死路由 /exam-history/review 已删，legacySource prop 随之移除，
// source 统一走 query（/grade/task 由批改中心带 task.source 跳转）。
const reviewType = computed(() => (route.query.source === 'retry' ? 'paper' : 'homework'))
</script>

<style scoped>
.unified-review-page { height: 100%; overflow: hidden; }
</style>
