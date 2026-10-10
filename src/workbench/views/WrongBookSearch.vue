<template>
  <div class="wb-page wq-search-page">
    <header class="page-head">
      <div>
        <h1>错题检索</h1>
        <p class="sub">输入题干或答案里的关键字，跨全部学生查找一道错题；找到后可直达原卷编辑。</p>
      </div>
    </header>

    <section class="search-bar">
      <el-input
        ref="searchInput"
        v-model="query"
        size="large"
        clearable
        placeholder="例如：相似三角形 / 比例中项 / 二次根式…"
        :prefix-icon="Search"
        @input="onInput"
      />
      <div class="search-meta">
        <template v-if="query.trim()">
          <span v-if="loading">搜索中…</span>
          <span v-else-if="total > 0">共 {{ total }} 条{{ truncated ? `，仅显示前 ${items.length} 条（换个更具体的关键字）` : '' }}</span>
          <span v-else-if="!loading">没有匹配的错题</span>
        </template>
        <span v-else>库中共 {{ grandTotal }} 条错题，支持模糊匹配</span>
      </div>
    </section>

    <section v-if="items.length" class="result-list">
      <article v-for="item in items" :key="item.id" class="result-card">
        <div class="result-main">
          <p class="stem">{{ stemOf(item) }}</p>
          <div class="meta">
            <span class="student">{{ item.student_name || '未知学生' }}</span>
            <span class="dot">·</span>
            <span :class="['lc', `lc-${item.lifecycle_status || 'new'}`]">{{ lifecycleLabel(item.lifecycle_status) }}</span>
            <span v-if="(item.error_count || 1) > 1" class="dot">·</span>
            <span v-if="(item.error_count || 1) > 1" class="err">错过 {{ item.error_count }} 次</span>
            <span class="dot">·</span>
            <span class="time">{{ formatDate(item.added_at) }}</span>
          </div>
        </div>
        <div class="result-action">
          <button
            v-if="item.question_id && item.task_id"
            type="button"
            class="go-edit"
            @click="goEditOriginal(item)"
          >去原卷编辑</button>
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
          : '不用先选学生，直接搜题干；找公式的题也可以搜答案里的关键字。'"
      />
    </section>
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
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Reading, Search } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { searchWrongQuestions } from '../../services/apiService'
import { debounce } from '../utils/performance'
import EmptyState from '../components/ui/EmptyState.vue'

const router = useRouter()
const query = ref('')
const items = ref([])
const total = ref(0)
const truncated = ref(false)
const loading = ref(false)
const grandTotal = ref(0)
const searchInput = ref(null)

// 空库总量：第一次搜索成功后用 total 记录全库量（q 为空时后端返回空集拿不到，
// 所以干脆不预取——文案退化为不含总量的通用提示，避免为一句文案多打一次接口）
grandTotal.value = 0

const LC_LABELS = { new: '待掌握', review_1: '复习中', review_2: '复习中', mastered: '已掌握' }
const lifecycleLabel = (s) => LC_LABELS[s || 'new'] || '待掌握'
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
    if (data.total > 0 && q === query.value.trim()) grandTotal.value = Math.max(grandTotal.value, 0)
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

onMounted(() => { searchInput.value?.focus?.() })
</script>

<style scoped>
.wq-search-page {
  max-width: 860px;
}
.page-head h1 {
  margin: 0;
  color: var(--wb-text);
  font-size: 22px;
}
.page-head .sub {
  margin: 6px 0 0;
  color: var(--wb-text-secondary);
  font-size: 13px;
}
.search-bar {
  margin-top: 18px;
}
.search-meta {
  margin-top: 8px;
  min-height: 18px;
  color: var(--wb-text-tertiary);
  font-size: 12px;
}
.result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.result-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--wb-surface, #fff);
  border: 1px solid var(--wb-border, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  transition: border-color 0.15s;
}
.result-card:hover {
  border-color: var(--wb-primary, #6366f1);
}
.result-main {
  flex: 1;
  min-width: 0;
}
.stem {
  margin: 0;
  color: var(--wb-text);
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  color: var(--wb-text-secondary);
  font-size: 12px;
  flex-wrap: wrap;
}
.meta .student {
  color: var(--wb-text);
  font-weight: 600;
}
.dot {
  color: var(--wb-text-tertiary);
}
.lc {
  padding: 1px 8px;
  border-radius: 9999px;
  font-size: 11px;
}
.lc-new {
  color: #854f0b;
  background: #faeeda;
}
.lc-review_1,
.lc-review_2 {
  color: #185fa5;
  background: #e6f1fb;
}
.lc-mastered {
  color: #3b6d11;
  background: #eaf3de;
}
.err {
  color: #a32d2d;
}
.result-action {
  flex: 0 0 auto;
}
.go-edit {
  padding: 7px 14px;
  color: #fff;
  font-size: 13px;
  background: var(--wb-primary, #6366f1);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.go-edit:hover {
  opacity: 0.9;
}
.no-origin {
  color: var(--wb-text-tertiary);
  font-size: 12px;
}
.empty-hint {
  margin-top: 24px;
}
</style>
