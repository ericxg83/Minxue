<template>
  <div class="wb-page wb-page--workspace">
    <div class="wb-page__inner wq-search-inner">
      <PageHeader
        eyebrow="教学工作"
        title="错题管理"
        description="输入题干或答案里的关键字，跨全部学生查找一道错题；找到后可直达原卷编辑。"
      />

      <section class="search-bar">
        <WorkbenchInput
          v-model="query"
          clearable
          placeholder="例如：相似三角形 / 比例中项 / 二次根式…"
          aria-label="按关键字搜索错题"
          @update:model-value="onInput"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </WorkbenchInput>
        <div class="search-meta" aria-live="polite">
          <template v-if="query.trim()">
            <span v-if="loading">搜索中…</span>
            <span v-else-if="total > 0">共 {{ total }} 条{{ truncated ? `，仅显示前 ${items.length} 条（换个更具体的关键字）` : '' }}</span>
            <span v-else>没有匹配的错题</span>
          </template>
          <span v-else>不用先选学生，直接输题目里的词就能搜</span>
        </div>
      </section>

      <section v-if="items.length" class="result-list">
        <article v-for="item in items" :key="item.id" class="result-card">
          <div class="result-main">
            <p class="stem">{{ stemOf(item) }}</p>
            <div class="meta">
              <span class="student">{{ item.student_name || '未知学生' }}</span>
              <span class="sep">·</span>
              <StatusTag :tone="lcOf(item).tone" :label="lcOf(item).label" />
              <template v-if="(item.error_count || 1) > 1">
                <span class="sep">·</span>
                <span class="err">错过 {{ item.error_count }} 次</span>
              </template>
              <span class="sep">·</span>
              <span class="time">{{ formatDate(item.added_at) }}</span>
            </div>
          </div>
          <div class="result-action">
            <ActionButton
              v-if="item.question_id && item.task_id"
              variant="primary"
              @click="goEditOriginal(item)"
            >去原卷编辑</ActionButton>
            <span v-else class="no-origin">无原卷档案，无法定位</span>
          </div>
        </article>
      </section>

      <section v-else-if="!loading" class="empty-hint">
        <EmptyState
          :icon="Reading"
          :title="query.trim() ? '没有匹配的错题' : '输入关键字开始检索'"
          :description="query.trim()
            ? '试试更短的关键字，比如只输题目里的一个词。'
            : '不用先选学生，直接搜题干；想按答案找题也可以搜答案里的关键字。'"
        />
      </section>
    </div>
  </div>
</template>

<script setup>
// ── 错题检索页（r260 · 2026-10-10 负责人拍板方案 A：侧栏直达 + 跨学生模糊匹配）──
//
// 为什么：老师想找"某道题"时往往不预设学生，而此前唯一入口在学生档案页内
//   （先点学生 → 输入名字 → 长下拉 → 错题区）。本页是检索直达，不是 r91 下线的
//   「错题分析页」回流——不放统计卡/图表，只做"找到题 → 行动"一件事。
// 行动出口复用「去原题编辑」唯一链路（B1）：/grade/task?studentId=&taskId=&q=题目id，
//   复核页加载后自动定位到该题并打开编辑面板。无原卷档案（question_id 为空的
//   无档案错题）不给入口——与错题本详情同口径：跳到错的卷比不给入口更糟。
// UI 全部走工作台标准组件（PageHeader/WorkbenchInput/StatusTag/ActionButton/
//   EmptyState）与 --wb-* token；容器档位 Workspace（设计系统 4.1：WrongBook 归属）。
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Reading, Search } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { searchWrongQuestions } from '../../services/apiService'
import { debounce } from '../utils/performance'
import PageHeader from '../components/ui/PageHeader.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import ActionButton from '../components/ui/ActionButton.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const router = useRouter()
const query = ref('')
const items = ref([])
const total = ref(0)
const truncated = ref(false)
const loading = ref(false)

// 生命周期 → StatusTag 标准语义（warning=待处理 / info=进行中 / success=已达成）
const LC_MAP = {
  new: { label: '待掌握', tone: 'warning' },
  review_1: { label: '复习中', tone: 'info' },
  review_2: { label: '复习中', tone: 'info' },
  mastered: { label: '已掌握', tone: 'success' }
}
const lcOf = (item) => LC_MAP[item.lifecycle_status || 'new'] || LC_MAP.new
const stemOf = (item) => {
  const text = item.content || ''
  return text.length > 90 ? `${text.slice(0, 90)}…` : text
}
const formatDate = (d) => (d ? dayjs(d).format('MM-DD HH:mm') : '')

const doSearch = async () => {
  const q = query.value.trim()
  if (!q) { items.value = []; total.value = 0; truncated.value = false; return }
  loading.value = true
  try {
    const data = await searchWrongQuestions(q, { limit: 50 })
    items.value = data.items
    total.value = data.total
    truncated.value = data.truncated
  } catch (e) {
    console.error('错题检索失败:', e)
    ElMessage.error('检索失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
// 防抖 300ms，与错题本搜索同一节奏（wrongBookStore.debouncedSetSearch）
const debouncedSearch = debounce(doSearch, 300)
const onInput = () => { debouncedSearch() }

// 复用「去原题编辑」唯一链路（B1）：复核页 focusQuestionFromQuery 消费 ?q=
const goEditOriginal = (item) => {
  const studentId = item.student_id
  const taskId = item.task_id
  const questionId = item.question_id
  if (!studentId || !taskId || !questionId) {
    ElMessage.warning('这道题没有关联的原始作业，无法定位到原卷')
    return
  }
  // 与错题本详情同口径：不传 source（复核页不读它，source 只是批改中心的分流参数）
  router.push({ path: '/grade/task', query: { studentId, taskId, q: questionId } })
}

onMounted(() => {
  // WorkbenchInput 未暴露 focus；进页即聚焦搜索框是本页主任务的起点
  document.querySelector('.wq-search-inner .wb-input input')?.focus?.()
})
</script>

<style scoped>
.search-bar {
  margin-top: var(--wb-space-5);
}
.search-meta {
  margin-top: var(--wb-space-2);
  min-height: 18px;
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}
.result-list {
  display: flex;
  flex-direction: column;
  gap: var(--wb-space-3);
  margin-top: var(--wb-space-4);
}
.result-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-4);
  padding: var(--wb-space-4) var(--wb-space-5);
  background: var(--wb-bg-elevated, #fff);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  transition: border-color var(--wb-motion-fast) var(--wb-motion-ease);
}
.result-card:hover {
  border-color: var(--wb-primary);
}
.result-main {
  flex: 1;
  min-width: 0;
}
.stem {
  margin: 0;
  color: var(--wb-text);
  font-size: var(--wb-fs-body);
  line-height: var(--wb-lh-normal);
  white-space: pre-wrap;
  word-break: break-word;
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--wb-space-2);
  margin-top: var(--wb-space-2);
  color: var(--wb-text-secondary);
  font-size: var(--wb-fs-meta);
  flex-wrap: wrap;
}
.meta .student {
  color: var(--wb-text);
  font-weight: var(--wb-fw-semibold);
}
.meta .sep {
  color: var(--wb-text-tertiary);
}
.meta .time {
  color: var(--wb-text-tertiary);
}
.err {
  color: var(--wb-status-danger-fg);
}
.result-action {
  flex: 0 0 auto;
}
.no-origin {
  color: var(--wb-text-tertiary);
  font-size: var(--wb-fs-meta);
}
.empty-hint {
  margin-top: var(--wb-space-6);
}
</style>
