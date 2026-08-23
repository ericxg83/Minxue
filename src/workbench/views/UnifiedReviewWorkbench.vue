<template>
  <div class="unified-review-page">
    <ReviewWorkspace :task-type="reviewType" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ReviewWorkspace from '../components/review/ReviewWorkspace.vue'

const props = defineProps({ legacySource: { type: String, default: '' } })
const route = useRoute()
const reviewType = computed(() => (props.legacySource === 'retry' || route.query.source === 'retry' ? 'paper' : 'homework'))
</script>

<style scoped>
.unified-review-page { height: 100%; overflow: hidden; }
</style>
