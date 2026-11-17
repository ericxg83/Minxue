<template>
  <button
    type="button"
    class="curate-star"
    :class="{ 'is-active': curated, 'is-busy': busy }"
    :title="tip"
    :disabled="busy"
    @click.stop="toggle"
  >
    <el-icon><StarFilled v-if="curated" /><Star v-else /></el-icon>
    <span v-if="showLabel">{{ curated ? '已甄选' : '甄选' }}</span>
  </button>
</template>

<script setup>
/**
 * CurateStar — 好题甄选星标按钮（五处页面共用的唯一实现）
 *
 * 用法：<CurateStar sourceType="question" :sourceId="q.id" />
 *   sourceType: 'question'（错题/学生作答链路）| 'resource_question'（试卷题库）
 *
 * ⛔ 不各自查状态：由页面用 useCuratedStatus 批量查好后，通过 curated prop 传入，
 *    避免五个页面各写一套、也避免每颗星各发一次请求（N+1）。
 *    组件自身只负责「点击 → 调 API → 通知父级刷新」。
 */
import { ref, computed } from 'vue'
import { Star, StarFilled } from '@element-plus/icons-vue'
import { addCuratedQuestion, removeCuratedQuestion } from '../../../services/apiService'

const props = defineProps({
  sourceType: { type: String, required: true },
  sourceId: { type: String, default: '' },
  curated: { type: Boolean, default: false },
  showLabel: { type: Boolean, default: false },
  // 可选：收藏后立刻带上的标签（页面决定的场景标签）
  tags: { type: Array, default: () => [] },
})
const emit = defineEmits(['change'])

const busy = ref(false)
const localCurated = ref(props.curated)
// 父级批量状态变化（如筛选后重查）时同步
import { watch } from 'vue'
watch(() => props.curated, v => { localCurated.value = v })

const tip = computed(() => {
  if (!props.sourceId) return '题目无可用 ID，无法甄选'
  return localCurated.value ? '取消甄选（从好题甄选移除）' : '甄选为好题'
})

async function toggle() {
  if (busy.value || !props.sourceId) return
  busy.value = true
  const wasCurated = localCurated.value
  try {
    if (wasCurated) await removeCuratedQuestion(props.sourceType, props.sourceId)
    else await addCuratedQuestion(props.sourceType, props.sourceId, props.tags)
    localCurated.value = !wasCurated
    emit('change', { sourceType: props.sourceType, sourceId: props.sourceId, curated: localCurated.value })
  } catch (e) {
    // 核心写入失败不静默：console 留痕（toast 由页面按需接 change 后处理）
    console.error('[CurateStar] 操作失败:', e?.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.curate-star {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  color: var(--wb-text-muted, #909399);
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--wb-border, #dcdfe6);
  border-radius: 6px;
  cursor: pointer;
  transition: 0.15s;
}
.curate-star:hover:not(:disabled) {
  color: var(--wb-warning, #e6a23c);
  border-color: var(--wb-warning, #e6a23c);
}
.curate-star.is-active {
  color: #e6a23c;
  border-color: #e6a23c;
  background: rgba(230, 162, 60, 0.1);
}
.curate-star.is-busy { opacity: 0.6; cursor: wait; }
.curate-star:disabled { opacity: 0.45; cursor: not-allowed; }
.curate-star .el-icon { font-size: 14px; }
</style>
