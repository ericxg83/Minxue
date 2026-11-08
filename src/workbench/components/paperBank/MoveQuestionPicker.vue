<!--
  MoveQuestionPicker.vue — 「把这道题移到另一个题集」浮层（2026-11-08）

  负责人场景：截图收题时点错了题集，一道题本该在「平行+角平分线」，却在「做平行造相似」。
  此前只能删了重收（重收要再识别一次，等于拿已校对好的题干/难度换一次 OCR 风险）。

  ⛔ 三条设计约束：
   ① 只做「选择目标」，真正的写库在页面里调 movePaperBankQuestions —— 组件不碰 API，
      便于同一份选择器被「行内按钮」和「拖拽落点」复用。
   ② 当前题集必须显示出来并禁用：老师要能确认「我确实点错了地方」，而不是猜。
   ③ 文件夹路径要显示：同名/近名题集（「反A模型」「平行+角平分线」这种）光看名字分不清
      «这是哪个文件夹里的»，落错一次就又是一次返工。
-->
<template>
  <Teleport to="body">
    <div v-if="open" class="mvp__mask" @click="emit('close')" />
    <div v-if="open" ref="rootRef" class="mvp" :style="panelStyle" role="dialog" aria-label="移到题集">
      <div class="mvp__head">
        <span>移到哪个题集？</span>
        <button type="button" class="mvp__close" title="关闭" aria-label="关闭" @click="emit('close')">×</button>
      </div>

      <div v-if="currentName" class="mvp__current">
        现在在 <strong>{{ currentName }}</strong>
      </div>

      <input
        v-if="papers.length > 5"
        ref="inputRef"
        v-model="keyword"
        class="mvp__search"
        type="text"
        placeholder="搜题集名，如 角平分线"
        @keydown.down.prevent="moveIndex(1)"
        @keydown.up.prevent="moveIndex(-1)"
        @keydown.enter.prevent="pickActive"
        @keydown.esc.prevent="emit('close')"
      />

      <div class="mvp__list">
        <button
          v-for="(p, i) in filtered"
          :key="p.id"
          type="button"
          class="mvp__item"
          :class="{ 'is-active': i === activeIndex, 'is-current': p.id === currentPaperId }"
          :disabled="p.id === currentPaperId"
          @click="pick(p)"
          @mouseenter="activeIndex = i"
        >
          <span class="mvp__label">
            <span v-if="p.__path" class="mvp__path">{{ p.__path }} /</span>
            <span class="mvp__name">{{ p.name }}</span>
          </span>
          <span v-if="p.id === currentPaperId" class="mvp__badge">当前</span>
          <span v-else class="mvp__count">{{ p.question_count || 0 }} 题</span>
        </button>
        <div v-if="!filtered.length" class="mvp__empty">
          没有匹配的题集。{{ keyword ? '换个关键词，' : '' }}也可以先建一个题集再移。
        </div>
      </div>

      <div class="mvp__foot">↑↓ 选 · Enter 确认 · Esc 关闭</div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { getPaperBankFolders } from '../../../services/apiService.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  papers: { type: Array, default: () => [] },
  currentPaperId: { type: String, default: '' },
  /** 触发按钮的位置（viewport 坐标），浮层贴着它出现 */
  anchor: { type: Object, default: null },
})
const emit = defineEmits(['pick', 'close'])

const rootRef = ref(null)
const inputRef = ref(null)
const keyword = ref('')
const activeIndex = ref(0)
const folders = ref([])
const panelPos = ref({ left: 0, top: 0 })

const currentName = computed(() => props.papers.find(p => p.id === props.currentPaperId)?.name || '')

// 文件夹路径（「未归类」不显示）—— 同名题集靠它区分
const folderPathMap = computed(() => {
  const byId = new Map(folders.value.map(f => [f.id, f]))
  const walk = (id, depth = 0) => {
    const parts = []
    let cur = byId.get(id)
    let guard = 0
    while (cur && guard < 20) {
      parts.unshift(cur.name)
      cur = byId.get(cur.parent_id)
      guard += 1
    }
    return parts.join(' / ')
  }
  const out = new Map()
  for (const p of props.papers) {
    const fid = p.folder_id
      || (p.metadata && typeof p.metadata === 'object' ? p.metadata.folderId : '')
      || ''
    out.set(p.id, fid ? walk(fid) : '')
  }
  return out
})

const withPath = computed(() => props.papers.map(p => ({ ...p, __path: folderPathMap.value.get(p.id) || '' })))

const filtered = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return withPath.value
  // 题集名或文件夹名命中都算 —— 老师常按「文件夹」找（先想到分类，再想到题集名）
  return withPath.value.filter(p => p.name.includes(kw) || (p.__path || '').includes(kw))
})

const panelStyle = computed(() => ({
  left: `${panelPos.value.left}px`,
  top: `${panelPos.value.top}px`,
}))

const place = () => {
  const a = props.anchor
  if (!a) return
  const width = 300
  const margin = 8
  const left = Math.min(Math.max(margin, a.x || 0), window.innerWidth - width - margin)
  // 估算高度上限 320：下方放不下就翻到上方，避免浮层被视口裁掉
  const below = (a.y || 0) + 8
  const top = below + 320 > window.innerHeight ? Math.max(margin, (a.y || 0) - 328) : below
  panelPos.value = { left, top }
}

watch(() => props.open, async (v) => {
  if (!v) return
  keyword.value = ''
  activeIndex.value = 0
  place()
  await nextTick()
  inputRef.value?.focus?.()
})

watch(filtered, () => { activeIndex.value = 0 })

const moveIndex = (step) => {
  if (!filtered.value.length) return
  const n = filtered.value.length
  activeIndex.value = Math.min(n - 1, Math.max(0, activeIndex.value + step))
}

const pick = (p) => {
  if (!p || p.id === props.currentPaperId) return
  emit('pick', p)
}

const pickActive = () => {
  const list = filtered.value
  if (!list.length) return
  const p = list[activeIndex.value] || list[0]
  pick(p)
}

const onWindowChange = () => { if (props.open) place() }

onMounted(async () => {
  try { folders.value = await getPaperBankFolders() } catch { /* 路径只是锦上添花，取不到也能选 */ }
  window.addEventListener('resize', onWindowChange)
  window.addEventListener('scroll', onWindowChange, true)
})
onUnmounted(() => {
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
})
</script>

<style scoped>
.mvp__mask {
  position: fixed; inset: 0; z-index: 2990;
}
.mvp {
  position: fixed; z-index: 3000; width: 300px;
  display: flex; flex-direction: column; max-height: 320px;
  background: var(--wb-bg-card, #fff);
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: var(--wb-radius-md, 10px);
  box-shadow: var(--wb-elev-overlay, 0 12px 32px rgba(15, 23, 42, .16));
  overflow: hidden;
}
.mvp__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 6px;
  font-size: var(--wb-fs-body, 13px); font-weight: var(--wb-fw-semibold, 600);
  color: var(--wb-text, #1e293b);
}
.mvp__close {
  border: 0; background: transparent; cursor: pointer; font-size: 16px; line-height: 1;
  color: var(--wb-text-tertiary, #94a3b8); padding: 2px 4px; border-radius: 4px;
}
.mvp__close:hover { background: var(--wb-border-subtle, #f8fafc); color: var(--wb-text, #1e293b); }
.mvp__current {
  padding: 0 12px 8px;
  font-size: var(--wb-fs-caption, 11px); color: var(--wb-text-tertiary, #94a3b8);
}
.mvp__current strong { color: var(--wb-text-secondary, #64748b); font-weight: 500; }
.mvp__search {
  margin: 0 12px 8px; height: 28px; flex: none;
  border: 1px solid var(--wb-border, #e2e8f0); border-radius: var(--wb-radius-xs, 6px);
  padding: 0 8px; font-size: var(--wb-fs-meta, 12px); color: var(--wb-text, #1e293b);
  background: var(--wb-bg-card, #fff); outline: none;
}
.mvp__search:focus { border-color: var(--wb-primary, #6366f1); }
.mvp__list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 6px; }
.mvp__item {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 6px 8px; border: 0; border-radius: var(--wb-radius-xs, 6px);
  background: transparent; text-align: left; cursor: pointer;
  font-size: var(--wb-fs-body, 13px); color: var(--wb-text, #1e293b);
}
.mvp__item.is-active:not(:disabled) { background: var(--wb-primary-mist, #eef2ff); }
.mvp__item:disabled { cursor: default; opacity: .6; }
.mvp__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mvp__path { color: var(--wb-text-tertiary, #94a3b8); font-size: var(--wb-fs-caption, 11px); }
.mvp__name { color: inherit; }
.mvp__item.is-current .mvp__name { color: var(--wb-primary, #6366f1); font-weight: 500; }
.mvp__count, .mvp__badge {
  flex: none; font-size: var(--wb-fs-caption, 11px);
  color: var(--wb-text-tertiary, #94a3b8); font-variant-numeric: tabular-nums;
}
.mvp__badge { color: var(--wb-primary, #6366f1); }
.mvp__empty {
  padding: 14px 10px; font-size: var(--wb-fs-meta, 12px); line-height: 1.6;
  color: var(--wb-text-tertiary, #94a3b8);
}
.mvp__foot {
  flex: none; padding: 6px 12px 8px;
  font-size: var(--wb-fs-caption, 11px); color: var(--wb-text-tertiary, #94a3b8);
  border-top: 1px solid var(--wb-border-light, #f1f5f9);
}
</style>
