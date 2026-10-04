<script setup>
/**
 * 学生横排选择器（r133 学习诊断重构 · 取代下拉框）。
 *
 * 为什么换掉下拉：
 *   下拉框一次只能看一个学生，老师想知道"谁在进步、谁停滞"必须一个个点开、一个个切回来。
 *   横排卡片把**全班战果同时摊开**，一眼横向对比 —— 这是下拉做不到的。
 *   21 个学生会滚动，滚到当前选中项自动滚进视野（scrollIntoView）。
 *
 * 卡片上直接给出「已拿下 N」——选学生这个动作本身就在回答"该看谁"。
 *
 * ⛔ 排序：已拿下多的排前面，其次是错题少的。选谁 = 看最有信息量的那个。
 * ⛔ 不在这里显示正确率：那属于「选定之后」的详情，放这里会挤爆卡片。
 */
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  // [{ id, name, grade, securedCount, wrongCount }]
  students: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'select'])

const root = ref(null)

// 排序：已拿下多 → 错题少 → 名字
const sorted = () => [...(props.students || [])]
  .filter(s => s && s.id)
  .sort((a, b) =>
    (b.securedCount || 0) - (a.securedCount || 0) ||
    (a.wrongCount || 0) - (b.wrongCount || 0) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
  )

// 选中学生滚进视野（21 人横排时不滚就看不到当前选中谁）
watch(() => props.modelValue, async () => {
  await nextTick()
  const el = root.value?.querySelector('.sp__item.is-on')
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
})

function pick(s) {
  emit('update:modelValue', s.id)
  emit('select', s)
}

// 姓名首字做头像（不请求图片，省一次失败请求）
const initial = (name) => String(name || '?').trim().slice(0, 1)
</script>

<template>
  <div ref="root" class="sp" role="tablist" aria-label="选择学生查看诊断">
    <button
      v-for="s in sorted()"
      :key="s.id"
      type="button"
      role="tab"
      class="sp__item"
      :class="{ 'is-on': s.id === modelValue }"
      :aria-selected="s.id === modelValue"
      @click="pick(s)"
    >
      <span class="sp__av">{{ initial(s.name) }}</span>
      <span class="sp__txt">
        <span class="sp__name">{{ s.name }}</span>
        <span class="sp__meta">
          <span v-if="s.grade">{{ s.grade }}</span>
          <span v-if="s.securedCount > 0" class="sp__win">已拿下 {{ s.securedCount }}</span>
          <span v-else-if="s.wrongCount > 0" class="sp__zero">还没拿下</span>
        </span>
      </span>
    </button>
    <p v-if="!sorted().length" class="sp__empty">还没有学生数据</p>
  </div>
</template>

<style scoped>
.sp{display:flex;gap:var(--wb-space-2);overflow-x:auto;padding-bottom:var(--wb-space-2);scrollbar-width:thin}
.sp__item{
  flex:0 0 auto;display:flex;align-items:center;gap:var(--wb-space-2);
  min-width:158px;padding:var(--wb-space-2) var(--wb-space-4) var(--wb-space-2) var(--wb-space-2);
  border:1px solid var(--wb-border);border-radius:var(--wb-radius-md);
  background:var(--wb-bg-card);cursor:pointer;transition:border-color .12s,background .12s;
}
.sp__item:hover{border-color:var(--wb-border-strong);background:var(--wb-bg-hover)}
.sp__item.is-on{border-color:var(--wb-status-info-fg);background:var(--wb-status-info-bg)}
.sp__item:focus-visible{outline:2px solid var(--wb-status-info-fg);outline-offset:1px}
.sp__av{
  width:32px;height:32px;border-radius:var(--wb-radius-pill);flex:0 0 auto;
  display:grid;place-items:center;font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-bold);
  color:var(--wb-text-inverse);background:var(--wb-status-neutral-fg);
}
.sp__item.is-on .sp__av{background:var(--wb-status-info-fg)}
.sp__txt{display:flex;flex-direction:column;gap:1px;min-width:0;text-align:left}
.sp__name{font-size:var(--wb-fs-body);font-weight:var(--wb-fw-semibold);color:var(--wb-text);white-space:nowrap}
.sp__meta{display:flex;gap:var(--wb-space-2);font-size:var(--wb-fs-caption);color:var(--wb-text-tertiary);white-space:nowrap}
.sp__win{color:var(--wb-status-success-fg);font-weight:var(--wb-fw-semibold)}
.sp__item.is-on .sp__win{color:var(--wb-status-success-fg)}
.sp__empty{padding:var(--wb-space-4) 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta)}
</style>
