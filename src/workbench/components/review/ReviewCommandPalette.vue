<template>
  <Teleport to="body">
    <div
      v-if="store.commandPaletteVisible"
      class="cmdk-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      @mousedown.self="close"
    >
      <div class="cmdk-panel">
        <div class="cmdk-inputrow">
          <span class="cmdk-icon">⌘</span>
          <input
            ref="inputRef"
            v-model="query"
            class="cmdk-input"
            type="text"
            placeholder="跳到第 N 题、或输入命令（下一份 / 完成复核 / 快捷键）…"
            aria-label="命令搜索"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="runActive()"
            @keydown.esc.prevent="close"
          />
          <kbd class="cmdk-esc">Esc</kbd>
        </div>

        <div class="cmdk-list" ref="listRef">
          <template v-if="filtered.length">
            <div
              v-for="(item, i) in filtered"
              :key="item.id"
              :class="['cmdk-item', { active: i === activeIndex }]"
              role="option"
              :aria-selected="i === activeIndex"
              @mouseenter="activeIndex = i"
              @click="run(item)"
            >
              <span class="cmdk-group">{{ item.group }}</span>
              <span class="cmdk-label">{{ item.label }}</span>
              <span v-if="item.hint" class="cmdk-hint">{{ item.hint }}</span>
            </div>
          </template>
          <div v-else class="cmdk-empty">没有匹配的命令或题目</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * [⑤ ⌘K 命令面板] Raycast 式统一键盘入口：跳题 / 上下份 / 完成复核 / 快捷键速查。
 * 只做「把已有动作收到一个搜索入口」——不新写业务、不改任何视觉 token，
 * 全部复用 reviewStore 现成方法（jumpToQuestion / nextTask / prevTask / shortcutsVisible）。
 * 「完成复核」带错题门禁，逻辑在 ReviewTopBar，这里 emit 出去由 ReviewWorkspace 转发。
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'

const store = useReviewStore()
const emit = defineEmits(['run-complete'])

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref(null)
const listRef = ref(null)

const close = () => { store.commandPaletteVisible = false }

// 命令表：动作命令（固定）+ 跳题命令（按当前卷题目动态生成）
const commands = computed(() => {
  const list = [
    { id: 'act-next', group: '导航', label: '下一份待复核', hint: 'T', run: () => store.nextTask() },
    { id: 'act-prev', group: '导航', label: '上一份待复核', hint: '⇧T', run: () => store.prevTask() },
    { id: 'act-complete', group: '操作', label: '完成复核', hint: '⏎', run: () => emit('run-complete') },
    { id: 'act-shortcut', group: '操作', label: '快捷键速查', hint: '?', run: () => { store.shortcutsVisible = true } },
  ]
  store.allQuestions.forEach((q, idx) => {
    const label = `跳到第 ${idx + 1} 题`
    const hint = (q.content || q.parent_stem || '').replace(/\s+/g, '').slice(0, 24)
    list.push({ id: `q-${q.id}`, group: '题目', label, hint, run: () => store.jumpToQuestion(idx) })
  })
  return list
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return commands.value
  // 纯数字：优先把「第 N 题」精确命中排前面
  if (/^\d+$/.test(q)) {
    return commands.value.filter(c =>
      c.group === '题目' ? c.label.includes(q) : (c.label + c.hint).toLowerCase().includes(q)
    )
  }
  return commands.value.filter(c => (c.label + ' ' + c.hint + ' ' + c.group).toLowerCase().includes(q))
})

// 结果变化时把高亮夹回合法范围
watch(filtered, () => { activeIndex.value = 0 })

const move = (delta) => {
  const n = filtered.value.length
  if (!n) return
  activeIndex.value = (activeIndex.value + delta + n) % n
  nextTick(() => {
    listRef.value?.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' })
  })
}

const run = (item) => {
  if (!item) return
  item.run()
  close()
}
const runActive = () => run(filtered.value[activeIndex.value])

// 打开时清空并聚焦
watch(() => store.commandPaletteVisible, (v) => {
  if (v) {
    query.value = ''
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  }
})
</script>

<style scoped>
/* 复用现有 --wb-* token，不新增视觉变量 */
.cmdk-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: rgba(15, 23, 42, 0.35);
}
.cmdk-panel {
  width: min(560px, 92vw);
  max-height: 62vh;
  display: flex;
  flex-direction: column;
  background: var(--wb-bg-card);
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-lg);
  box-shadow: var(--wb-elev-modal);
  overflow: hidden;
}
.cmdk-inputrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wb-border-light);
}
.cmdk-icon { color: var(--wb-text-tertiary); font-size: 14px; }
.cmdk-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--wb-text);
  font-size: 15px;
  font-family: inherit;
}
.cmdk-input::placeholder { color: var(--wb-text-tertiary); }
.cmdk-esc, .cmdk-hint {
  color: var(--wb-text-tertiary);
  font-size: 11px;
}
.cmdk-esc {
  padding: 1px 6px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  background: var(--wb-bg-elevated);
}
.cmdk-list { flex: 1; overflow-y: auto; padding: 6px; }
.cmdk-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
  font-size: 14px;
}
.cmdk-item.active { background: var(--wb-primary-mist); }
.cmdk-group {
  flex-shrink: 0;
  width: 40px;
  color: var(--wb-text-tertiary);
  font-size: 11px;
}
.cmdk-label { flex: 1; min-width: 0; color: var(--wb-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmdk-item.active .cmdk-label { color: var(--wb-primary); font-weight: 600; }
.cmdk-hint { flex-shrink: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmdk-empty { padding: 28px; text-align: center; color: var(--wb-text-tertiary); font-size: 13px; }
</style>
