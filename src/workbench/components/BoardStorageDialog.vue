<template>
  <el-dialog
    :model-value="modelValue"
    title="本机板书管理"
    width="min(92vw, 560px)"
    :append-to-body="false"
    @update:model-value="(v) => emit('update:modelValue', v)"
    @open="refresh"
  >
    <!-- 为什么需要这个入口：板书按题目永久存在本机、全仓没有清理逻辑，5MB 迟早写满。
         写满时白板会给页内提示，但原来**没有任何回收手段**，老师只能清浏览器数据
         （会连其它本地缓存一起清掉）。这里把回收权交回给他：看得到占了多少、都是哪些题、
         可以逐条删或一次清空。⛔ 零自动删除 —— 只有老师点了才删。 -->
    <div class="bs-summary">
      <div class="bs-summary__line">
        本机已存 <b>{{ summary.count }}</b> 道题的板书，共 <b>{{ usedText }}</b>
        <span class="bs-summary__quota">（浏览器上限约 {{ quotaText }}）</span>
      </div>
      <div class="bs-bar" :class="{ 'bs-bar--warn': usageRatio >= 0.8 }">
        <span class="bs-bar__fill" :style="{ width: Math.min(100, usageRatio * 100).toFixed(1) + '%' }" />
      </div>
      <div v-if="summary.legacyCount" class="bs-summary__hint">
        其中 {{ summary.legacyCount }} 条是升级前的旧格式（不再写入，删掉只腾空间、不影响现在讲题）。
      </div>
    </div>

    <div v-if="!entries.length" class="bs-empty">本机还没有存过板书。</div>
    <div v-else class="bs-list">
      <div v-for="e in entries" :key="e.key" class="bs-row">
        <div class="bs-row__main">
          <div class="bs-row__label" :title="e.key">
            <span v-if="e.key === currentKey" class="bs-row__now">正在讲</span>{{ e.label }}
          </div>
          <div class="bs-row__meta">{{ formatBytes(e.bytes) }}</div>
        </div>
        <button
          type="button"
          class="bs-row__del"
          :class="{ 'bs-row__del--armed': armedKey === e.key }"
          @click="removeOne(e)"
        >
          {{ armedKey === e.key ? '再点一次确认' : '删除' }}
        </button>
      </div>
    </div>

    <!-- 页内提示条：原生全屏时 ElMessage / ElMessageBox 挂在 body 上，落在全屏元素外看不见 -->
    <div v-if="hint" class="bs-hint">{{ hint }}</div>

    <template #footer>
      <div class="bs-footer">
        <button
          type="button"
          class="bs-btn bs-btn--danger"
          :class="{ 'bs-btn--armed': armAll }"
          :disabled="!entries.length"
          @click="clearAll"
        >
          {{ armAll ? '再点一次：全部清空' : '全部清空' }}
        </button>
        <button type="button" class="bs-btn" @click="emit('update:modelValue', false)">关闭</button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 本机板书管理（2026-10-03 第 89 轮）
 *
 * 只负责「看占用 + 删」。删除是**同步 localStorage 操作**，不需要后端。
 * ⛔ 两次点击确认（按钮变红 + 页内提示），不用 ElMessageBox —— 原生全屏下它看不见。
 * ⛔ 删掉的如果是**当前正在讲的那一题**，只删存储、不动屏幕；父组件收到 deleted 事件后
 *    决定要不要连板面一起清（见 WeekendBoard 的处理与提示文案）。
 */
import { computed, ref } from 'vue'
import { listStrokeEntries, summarizeStrokeEntries, formatBytes } from '../utils/strokeStorage'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 当前题的板书键：删到它时要提示「屏幕上还留着」 */
  currentKey: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'deleted'])

/** localStorage 每源约 5MB（各浏览器略有差异，这里只用来画进度条与提示） */
const LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024

const entries = ref([])
const hint = ref('')
let hintTimer = null
const armedKey = ref('')
const armAll = ref(false)
let armTimer = null

const summary = computed(() => summarizeStrokeEntries(entries.value))
const usedText = computed(() => formatBytes(summary.value.bytes))
const quotaText = computed(() => formatBytes(LOCAL_STORAGE_QUOTA_BYTES))
const usageRatio = computed(() => summary.value.bytes / LOCAL_STORAGE_QUOTA_BYTES)

function showHint(text, ms = 5000) {
  hint.value = text
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { hint.value = '' }, ms)
}

function disarm() {
  armedKey.value = ''
  armAll.value = false
  clearTimeout(armTimer)
}

function refresh() {
  try {
    entries.value = listStrokeEntries(window.localStorage)
  } catch {
    entries.value = []
  }
  disarm()
  hint.value = ''
}

function removeOne(entry) {
  if (armedKey.value !== entry.key) {
    armAll.value = false
    armedKey.value = entry.key
    showHint(`再点一次「删除」清掉这道题的板书（${formatBytes(entry.bytes)}）`)
    clearTimeout(armTimer)
    armTimer = setTimeout(() => { armedKey.value = '' }, 4000)
    return
  }
  const freed = entry.bytes
  const wasCurrent = !!props.currentKey && entry.key === props.currentKey
  try {
    window.localStorage.removeItem(entry.key)
  } catch (e) {
    showHint('删除失败：' + (e?.message || '浏览器拒绝了本次操作'))
    disarm()
    return
  }
  disarm()
  refresh()
  emit('deleted', { keys: [entry.key], freedBytes: freed, currentRemoved: wasCurrent })
  // ⛔ 文案不能说「屏幕上还留着」—— 只删存储是假的：屏幕上那一份在内存里，
  //    离开这一题时父组件的 saveStrokes() 会把它原样写回同一个键。父组件收到
  //    currentRemoved 后连板面一起清（见 WeekendBoard#onStrokesDeleted），这里照实说。
  showHint(wasCurrent
    ? `已删除这道题的板书（腾出 ${formatBytes(freed)}）· 屏幕上这一份也一并清掉了`
    : `已删除 1 道题的板书，腾出 ${formatBytes(freed)}`)
}

function clearAll() {
  if (!entries.value.length) return
  if (!armAll.value) {
    armAll.value = true
    armedKey.value = ''
    showHint(`再点一次「全部清空」将删掉 ${summary.value.count} 道题的板书（${usedText.value}），删除后无法恢复`)
    clearTimeout(armTimer)
    armTimer = setTimeout(() => { armAll.value = false }, 5000)
    return
  }
  const keys = entries.value.map((e) => e.key)
  const freed = summary.value.bytes
  const currentRemoved = !!props.currentKey && keys.includes(props.currentKey)
  let failed = 0
  for (const k of keys) {
    try { window.localStorage.removeItem(k) } catch { failed += 1 }
  }
  disarm()
  refresh()
  emit('deleted', { keys, freedBytes: freed, currentRemoved })
  if (failed) showHint(`清空完成，但有 ${failed} 条没删掉（浏览器拒绝），可重试`)
  else if (currentRemoved) showHint(`已清空全部本机板书（腾出 ${formatBytes(freed)}）· 当前这一题的板面也一并清掉了`)
  else showHint(`已清空全部本机板书，腾出 ${formatBytes(freed)}`)
}
</script>

<style scoped>
.bs-summary { margin-bottom: 12px; }
.bs-summary__line { font-size: 13.5px; color: var(--wb-text-secondary, #475569); }
.bs-summary__line b { color: var(--wb-text, #0f172a); }
.bs-summary__quota { color: var(--wb-text-tertiary, #94a3b8); font-size: 12.5px; }
.bs-bar {
  margin-top: 8px; height: 6px; border-radius: 3px; overflow: hidden;
  background: var(--wb-bg-hover, #f1f5f9);
}
.bs-bar__fill { display: block; height: 100%; background: var(--wb-primary, #6366f1); transition: width .2s; }
.bs-bar--warn .bs-bar__fill { background: #dc2626; }
.bs-summary__hint { margin-top: 8px; font-size: 12.5px; color: var(--wb-text-tertiary, #94a3b8); }

.bs-empty { padding: 22px 0; text-align: center; font-size: 13px; color: var(--wb-text-tertiary, #94a3b8); }
.bs-list { max-height: min(46vh, 380px); overflow: auto; border: 1px solid var(--wb-border, #e2e8f0); border-radius: 10px; }
.bs-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-bottom: 1px solid var(--wb-border-light, #f1f5f9);
}
.bs-row:last-child { border-bottom: none; }
.bs-row__main { min-width: 0; flex: 1; }
.bs-row__label {
  font-size: 13px; color: var(--wb-text, #0f172a);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bs-row__meta { margin-top: 2px; font-size: 12px; color: var(--wb-text-tertiary, #94a3b8); }
.bs-row__now {
  margin-right: 6px; padding: 1px 6px; border-radius: 999px;
  background: var(--wb-primary-mist, #eef2ff); color: var(--wb-primary, #6366f1);
  font-size: 11.5px;
}
.bs-row__del {
  flex: 0 0 auto; padding: 4px 10px; border-radius: 8px; cursor: pointer;
  font-size: 12.5px; border: 1px solid var(--wb-border, #e2e8f0);
  background: #fff; color: var(--wb-text-secondary, #475569);
}
.bs-row__del:hover { background: var(--wb-bg-hover, #f1f5f9); }
.bs-row__del--armed { border-color: #dc2626; background: #fef2f2; color: #b91c1c; font-weight: 600; }

.bs-hint {
  margin-top: 10px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px;
  background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa;
}
.bs-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bs-btn {
  padding: 7px 14px; border-radius: 9px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--wb-border, #e2e8f0); background: #fff; color: var(--wb-text, #0f172a);
}
.bs-btn:hover { background: var(--wb-bg-hover, #f1f5f9); }
.bs-btn:disabled { opacity: .5; cursor: not-allowed; }
.bs-btn--danger { border-color: #fecaca; color: #b91c1c; }
.bs-btn--danger:hover { background: #fef2f2; }
.bs-btn--armed { background: #dc2626; border-color: #dc2626; color: #fff; font-weight: 600; }
.bs-btn--armed:hover { background: #b91c1c; }
</style>
