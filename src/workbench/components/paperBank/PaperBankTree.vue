<template>
  <!-- 试卷题库 · 文件夹树（2026-11-07）
       文件夹可无限嵌套，题集是叶子；拖拽移动，右键或「…」出菜单，危险操作默认不显现。
       2026-11-08：除了拖文件夹/题集，还接收**题目行**拖进来的「改归属」——
       老师的心智就是「把这张纸放进那个文件夹」，拖比开菜单选两次更直接。 -->
  <div class="pbt">
    <div class="pbt__head">
      <div class="pbt__head-title">
        <span>题库</span>
        <small>{{ papers.length }} 个题集 · {{ totalQuestionCount }} 题</small>
      </div>
      <div class="pbt__head-ops">
        <button type="button" class="pbt__icon-btn" title="新建文件夹" aria-label="新建文件夹" @click="startDraft({ mode: 'create', kind: 'folder', parentId: null })">
          <el-icon><FolderAdd /></el-icon>
        </button>
        <button type="button" class="pbt__icon-btn" title="新建题集" aria-label="新建题集" @click="emit('create-paper')">
          <el-icon><Plus /></el-icon>
        </button>
      </div>
    </div>

    <button
      type="button"
      class="pbt__row pbt__row--all"
      :class="{ 'is-active': activePaperId === 'all' }"
      @click="emit('select', 'all')"
    >
      <span class="pbt__twisty"></span>
      <el-icon class="pbt__icon"><Files /></el-icon>
      <span class="pbt__name">全部题集</span>
      <span class="pbt__count">{{ totalQuestionCount }}</span>
    </button>

    <div class="pbt__scroll" @dragover.prevent @drop.prevent="dropToRoot">
      <template v-for="row in rows" :key="row.key">
        <div v-if="row.type === 'sep'" class="pbt__sep"><span>{{ row.label }}</span></div>

        <div v-else-if="row.type === 'draft'" class="pbt__row pbt__row--draft" :style="indentStyle(row.depth)">
          <span class="pbt__twisty"></span>
          <el-icon class="pbt__icon"><Folder v-if="row.kind === 'folder'" /><Document v-else /></el-icon>
          <input
            ref="draftInput"
            v-model="draft.name"
            class="pbt__input"
            :placeholder="row.kind === 'folder' ? '文件夹名称' : '题集名称'"
            maxlength="80"
            @keydown.enter.prevent="commitDraft"
            @keydown.esc.prevent="cancelDraft"
            @blur="onDraftBlur"
          />
          <span class="pbt__draft-hint">Enter 保存</span>
        </div>

        <div
          v-else
          class="pbt__row"
          :class="{
            'is-active': row.type === 'paper' && activePaperId === row.id,
            'is-drop': dropKey === row.key,
            'is-dragging': dragKey === row.key,
            'is-folder': row.type === 'folder',
          }"
          :style="indentStyle(row.depth)"
          draggable="true"
          @click="onRowClick(row)"
          @contextmenu.prevent="openMenu($event, row)"
          @dragstart="onDragStart($event, row)"
          @dragend="onDragEnd"
          @dragover.prevent="onDragOver($event, row)"
          @dragleave="onDragLeave($event, row)"
          @drop.prevent.stop="onDrop($event, row)"
        >
          <button
            v-if="row.type === 'folder'"
            type="button"
            class="pbt__twisty pbt__twisty--btn"
            :class="{ 'is-open': expanded.has(row.id) }"
            :aria-label="expanded.has(row.id) ? '收起' : '展开'"
            @click.stop="toggleFolder(row.id)"
          >
            <el-icon><ArrowRight /></el-icon>
          </button>
          <span v-else class="pbt__twisty"></span>

          <el-icon class="pbt__icon" :class="{ 'pbt__icon--folder': row.type === 'folder' }">
            <FolderOpened v-if="row.type === 'folder' && expanded.has(row.id)" />
            <Folder v-else-if="row.type === 'folder'" />
            <Document v-else />
          </el-icon>
          <span class="pbt__name" :title="row.name">{{ row.name }}</span>
          <span v-if="row.pending" class="pbt__pending" title="正在解析">···</span>
          <span class="pbt__count">{{ row.count }}</span>
          <button type="button" class="pbt__more" title="更多操作" aria-label="更多操作" @click.stop="openMenu($event, row)">
            <el-icon><MoreFilled /></el-icon>
          </button>
        </div>
      </template>

      <div v-if="!rows.length" class="pbt__empty">
        还没有题集。点右上角的「+」建一个，或用文件夹图标先建好分类。
      </div>
    </div>

    <div v-if="menu" class="pbt__menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <button
        v-for="item in menu.items"
        :key="item.cmd"
        type="button"
        :class="{ 'is-danger': item.danger }"
        @click="runMenu(item)"
      >{{ item.label }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import {
  Folder, FolderOpened, FolderAdd, Document, Files, ArrowRight, MoreFilled, Plus,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getPaperBankFolders,
  createPaperBankFolder,
  updatePaperBankFolder,
  deletePaperBankFolder,
  movePaperBankPaper,
  updatePaperBankPaper,
  deletePaperBankPaper,
} from '../../../services/apiService.js'

const props = defineProps({
  papers: { type: Array, default: () => [] },
  totalQuestionCount: { type: Number, default: 0 },
  activePaperId: { type: String, default: 'all' },
})
const emit = defineEmits(['select', 'changed', 'create-paper', 'drop-question'])

// 题目行拖拽的类型标签（与 PaperBankWorkbench 的 onQuestionDragStart 逐字一致）
const Q_DRAG_TYPE = 'application/x-mnx-question'

const EXPANDED_KEY = 'paperBankTreeExpanded'
const folders = ref([])
const expanded = ref(new Set())
const draft = ref(null)
const draftInput = ref(null)
const dragKey = ref('')
const dropKey = ref('')
const dragging = ref(null)
const menu = ref(null)
let committing = false

const indentStyle = (depth) => ({ paddingLeft: `${8 + depth * 16}px` })
const isParsing = (p) => p.question_parse_status === 'parsing' || p.parse_status === 'parsing'

const persistExpanded = () => {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded.value])) } catch { /* 隐私模式下忽略 */ }
}

const toggleFolder = (id) => {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
  persistExpanded()
}

const expandFolder = (id) => {
  if (!id || expanded.value.has(id)) return
  expanded.value = new Set([...expanded.value, id])
  persistExpanded()
}

const childFolders = (parentId) => folders.value
  .filter(f => (f.parent_id || null) === (parentId || null))
  .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')))

const papersIn = (folderId) => props.papers
  .filter(p => (p.folder_id || null) === (folderId || null))
  .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

/** 文件夹上显示的题数 = 本层题集 + 所有子文件夹递归，和笔记 App 的计数口径一致。 */
const countIn = (folderId) => {
  let n = papersIn(folderId).reduce((sum, p) => sum + (p.question_count || 0), 0)
  for (const f of childFolders(folderId)) n += countIn(f.id)
  return n
}

/** 把树展平成行数组：一个 v-for 渲染完，拖拽/缩进/展开状态都好控。 */
const rows = computed(() => {
  const out = []
  const d = draft.value

  const walk = (parentId, depth, isRoot) => {
    if (d?.kind === 'folder' && (d.parentId || null) === (parentId || null)) {
      out.push({ key: 'draft', type: 'draft', kind: 'folder', depth })
    }
    for (const f of childFolders(parentId)) {
      if (d?.mode === 'rename' && d.kind === 'folder' && d.targetId === f.id) {
        out.push({ key: 'draft', type: 'draft', kind: 'folder', depth })
      } else {
        out.push({ key: `f:${f.id}`, type: 'folder', id: f.id, name: f.name, depth, count: countIn(f.id) })
      }
      if (expanded.value.has(f.id)) walk(f.id, depth + 1, false)
    }
    const ps = papersIn(parentId)
    if (isRoot && ps.length && folders.value.length) {
      out.push({ key: 'sep:loose', type: 'sep', label: '未归类' })
    }
    for (const p of ps) {
      if (d?.mode === 'rename' && d.kind === 'paper' && d.targetId === p.id) {
        out.push({ key: 'draft', type: 'draft', kind: 'paper', depth })
        continue
      }
      out.push({
        key: `p:${p.id}`, type: 'paper', id: p.id, name: p.name, depth,
        count: p.question_count || 0, pending: isParsing(p),
      })
    }
  }
  walk(null, 0, true)
  return out
})

const reload = async () => {
  try { folders.value = await getPaperBankFolders() } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '文件夹加载失败')
  }
}

const focusDraft = () => nextTick(() => {
  const el = Array.isArray(draftInput.value) ? draftInput.value[0] : draftInput.value
  el?.focus?.()
  el?.select?.()
})

const startDraft = (opt) => {
  menu.value = null
  draft.value = { ...opt, name: opt.name || '' }
  if (opt.parentId) expandFolder(opt.parentId)
  focusDraft()
}

const cancelDraft = () => { draft.value = null; focusDraft() }

const commitDraft = async () => {
  const d = draft.value
  if (!d || committing) return
  const name = String(d.name || '').trim().slice(0, 80)
  if (!name) { draft.value = null; return }
  committing = true
  try {
    if (d.kind === 'folder') {
      if (d.mode === 'create') await createPaperBankFolder({ name, parentId: d.parentId || null })
      else await updatePaperBankFolder(d.targetId, { name })
    } else {
      await updatePaperBankPaper(d.targetId, { name })
    }
    draft.value = null
    await reload()
    emit('changed')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '保存失败')
  } finally {
    committing = false
  }
}

const onDraftBlur = () => { if (draft.value) commitDraft() }

const onRowClick = (row) => {
  menu.value = null
  if (row.type === 'folder') toggleFolder(row.id)
  else emit('select', row.id)
}

// ── 拖拽移动 ──
const onDragStart = (e, row) => {
  dragging.value = row
  dragKey.value = row.key
  menu.value = null
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', row.key)
}
const onDragEnd = () => { dragging.value = null; dragKey.value = ''; dropKey.value = '' }

const canDrop = (row) => {
  const d = dragging.value
  return !!d && row.type === 'folder' && !(d.type === 'folder' && d.id === row.id)
}

/** 外面拖进来的是「一道题」：只有题集（叶子）能接，拖到文件夹上不算数。 */
const isQuestionDrag = (e) => {
  const types = e.dataTransfer?.types
  return !!types && typeof types.includes === 'function' && types.includes(Q_DRAG_TYPE)
}

const onDragOver = (e, row) => {
  if (isQuestionDrag(e)) {
    if (row.type !== 'paper') return
    e.dataTransfer.dropEffect = 'move'
    dropKey.value = row.key
    return
  }
  if (!canDrop(row)) return
  e.dataTransfer.dropEffect = 'move'
  dropKey.value = row.key
}
const onDragLeave = (e, row) => { if (dropKey.value === row.key) dropKey.value = '' }

/** id 是否落在 ancestorId 的子树里 —— 前端先挡一道，后端 assertNoCycle 再兜底。 */
const isDescendant = (id, ancestorId) => {
  let cur = folders.value.find(f => f.id === id)?.parent_id || null
  const seen = new Set()
  while (cur) {
    if (cur === ancestorId) return true
    if (seen.has(cur)) break
    seen.add(cur)
    cur = folders.value.find(f => f.id === cur)?.parent_id || null
  }
  return false
}

const moveRow = async (row, folderId) => {
  if (!row) return
  try {
    if (row.type === 'folder') await updatePaperBankFolder(row.id, { parentId: folderId })
    else await movePaperBankPaper(row.id, folderId)
    if (folderId) expandFolder(folderId)
    await reload()
    emit('changed')
    ElMessage.success(folderId ? '已移动' : '已移到最外层')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '移动失败')
  }
}

const onDrop = async (e, row) => {
  // 题目行拖过来：直接交给页面去调改归属接口（树不管数据，只管「落点是谁」）
  if (isQuestionDrag(e)) {
    dropKey.value = ''
    const qid = e.dataTransfer.getData(Q_DRAG_TYPE) || ''
    if (row.type === 'paper' && qid) emit('drop-question', { questionId: qid, paperId: row.id })
    return
  }
  const d = dragging.value
  onDragEnd()
  if (!d || row.type !== 'folder') return
  if (d.type === 'folder' && (d.id === row.id || isDescendant(row.id, d.id))) {
    ElMessage.warning('不能把文件夹放进它自己或它的子文件夹里')
    return
  }
  await moveRow(d, row.id)
}

const dropToRoot = async () => {
  const d = dragging.value
  onDragEnd()
  if (d) await moveRow(d, null)
}

// ── 更多菜单：默认完全不显现，删除也只放在这里且带二次确认 ──
const openMenu = (e, row) => {
  const items = [{ cmd: 'rename', label: '重命名' }]
  if (row.type === 'folder') items.push({ cmd: 'subfolder', label: '新建子文件夹' })
  items.push({ cmd: 'root', label: '移到最外层' })
  items.push({
    cmd: 'delete',
    label: row.type === 'folder' ? '删除文件夹' : '删除题集',
    danger: true,
  })
  menu.value = {
    x: Math.min(e.clientX, window.innerWidth - 184),
    y: Math.min(e.clientY, window.innerHeight - 176),
    row, items,
  }
}

const askDelete = async (row) => {
  const isFolder = row.type === 'folder'
  const text = isFolder
    ? `删除文件夹「${row.name}」？里面的题集会移到「未归类」，题目一道都不会删。`
    : `删除题集「${row.name}」及它的 ${row.count || 0} 道题？此操作不可恢复。`
  try {
    await ElMessageBox.confirm(text, isFolder ? '删除文件夹' : '删除题集', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }
  try {
    if (isFolder) await deletePaperBankFolder(row.id)
    else await deletePaperBankPaper(row.id)
    if (!isFolder && props.activePaperId === row.id) emit('select', 'all')
    await reload()
    emit('changed')
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '删除失败')
  }
}

const runMenu = async (item) => {
  const row = menu.value?.row
  menu.value = null
  if (!row) return
  if (item.cmd === 'rename') {
    const parentId = row.type === 'folder'
      ? (folders.value.find(f => f.id === row.id)?.parent_id || null)
      : (props.papers.find(p => p.id === row.id)?.folder_id || null)
    startDraft({ mode: 'rename', kind: row.type === 'folder' ? 'folder' : 'paper', parentId, targetId: row.id, name: row.name })
  } else if (item.cmd === 'subfolder') {
    expandFolder(row.id)
    startDraft({ mode: 'create', kind: 'folder', parentId: row.id })
  } else if (item.cmd === 'root') {
    await moveRow(row, null)
  } else if (item.cmd === 'delete') {
    await askDelete(row)
  }
}

const closeMenu = () => { menu.value = null }

onMounted(async () => {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) || 'null') } catch { /* 忽略坏掉的本地缓存 */ }
  await reload()
  // ⛔ 首次进入必须全部展开：否则老师只看到几个空文件夹，会以为辛苦收的题集不见了。
  //    之后尊重老师手动收起的状态。
  expanded.value = Array.isArray(saved)
    ? new Set(saved)
    : new Set(folders.value.map(f => f.id))
  document.addEventListener('click', closeMenu)
})

onUnmounted(() => document.removeEventListener('click', closeMenu))
</script>

<style scoped>
.pbt {
  background: var(--wb-bg-card, #fff);
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: var(--wb-radius-md, 10px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: min(40vh, 300px);
  overflow: hidden;
  position: relative;
}

.pbt__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wb-space-2, 8px);
  padding: var(--wb-space-3, 12px) var(--wb-space-3, 12px) var(--wb-space-2, 8px);
}
.pbt__head-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pbt__head-title > span {
  font-size: var(--wb-fs-body, 13px);
  font-weight: var(--wb-fw-semibold, 600);
  color: var(--wb-text, #1e293b);
  line-height: var(--wb-lh-tight, 1.25);
}
.pbt__head-title small {
  font-size: var(--wb-fs-caption, 11px);
  color: var(--wb-text-tertiary, #94a3b8);
  white-space: nowrap;
}
.pbt__head-ops { display: flex; align-items: center; gap: var(--wb-space-1, 4px); flex: none; }
.pbt__icon-btn {
  width: 26px; height: 26px; display: grid; place-items: center;
  border: 0; border-radius: var(--wb-radius-xs, 6px);
  background: transparent; color: var(--wb-text-secondary, #64748b);
  cursor: pointer; font-size: 14px;
  transition: background var(--wb-motion-fast, 120ms) var(--wb-motion-ease, ease),
              color var(--wb-motion-fast, 120ms) var(--wb-motion-ease, ease);
}
.pbt__icon-btn:hover { background: var(--wb-primary-mist, #eef2ff); color: var(--wb-primary, #6366f1); }

.pbt__row {
  position: relative;
  width: 100%; min-height: 32px;
  display: flex; align-items: center; gap: var(--wb-space-1, 4px);
  padding: 0 var(--wb-space-2, 8px) 0 var(--wb-space-2, 8px);
  border: 0; border-radius: var(--wb-radius-xs, 6px);
  background: transparent; text-align: left; cursor: pointer;
  color: var(--wb-text, #1e293b);
  font-size: var(--wb-fs-body, 13px);
  transition: background var(--wb-motion-fast, 120ms) var(--wb-motion-ease, ease);
}
.pbt__row:hover { background: var(--wb-border-subtle, #f8fafc); }
.pbt__row.is-active { background: var(--wb-primary-mist, #eef2ff); }
.pbt__row.is-active::before {
  content: ''; position: absolute; left: 0; top: 6px; bottom: 6px;
  width: 2px; border-radius: 2px; background: var(--wb-primary, #6366f1);
}
.pbt__row.is-active .pbt__name { color: var(--wb-primary, #6366f1); font-weight: var(--wb-fw-medium, 500); }
.pbt__row.is-drop { background: var(--wb-primary-soft, #e0e7ff); outline: 1px dashed var(--wb-primary, #6366f1); outline-offset: -2px; }
.pbt__row.is-dragging { opacity: .45; }
.pbt__row--all { margin-bottom: var(--wb-space-1, 4px); }
.pbt__row--draft { cursor: default; }

.pbt__twisty {
  width: 16px; height: 16px; flex: none;
  display: grid; place-items: center;
  color: var(--wb-text-tertiary, #94a3b8); font-size: 11px;
}
.pbt__twisty--btn {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  transition: transform var(--wb-motion-base, 180ms) var(--wb-motion-ease, ease);
}
.pbt__twisty--btn.is-open { transform: rotate(90deg); }
.pbt__twisty--btn:hover { color: var(--wb-primary, #6366f1); }

.pbt__icon { flex: none; font-size: 14px; color: var(--wb-text-tertiary, #94a3b8); }
.pbt__icon--folder { color: var(--wb-text-secondary, #64748b); }
.pbt__row.is-active .pbt__icon { color: var(--wb-primary, #6366f1); }
.pbt__name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  line-height: var(--wb-lh-normal, 1.5);
}
.pbt__count {
  flex: none; font-size: var(--wb-fs-caption, 11px);
  color: var(--wb-text-tertiary, #94a3b8); font-variant-numeric: tabular-nums;
}
.pbt__pending { flex: none; font-size: var(--wb-fs-caption, 11px); color: var(--wb-status-processing, #7c3aed); }
.pbt__more {
  flex: none; width: 20px; height: 20px; display: grid; place-items: center;
  border: 0; border-radius: var(--wb-radius-xs, 6px);
  background: transparent; color: var(--wb-text-secondary, #64748b);
  cursor: pointer; opacity: 0; font-size: 13px;
  transition: opacity var(--wb-motion-fast, 120ms) var(--wb-motion-ease, ease);
}
.pbt__row:hover .pbt__more, .pbt__row:focus-within .pbt__more { opacity: 1; }
.pbt__more:hover { background: var(--wb-primary-mist, #eef2ff); color: var(--wb-primary, #6366f1); }

.pbt__input {
  flex: 1; min-width: 0; height: 24px;
  border: 1px solid var(--wb-primary, #6366f1);
  border-radius: var(--wb-radius-xs, 6px);
  padding: 0 var(--wb-space-2, 8px);
  font-size: var(--wb-fs-body, 13px); color: var(--wb-text, #1e293b);
  background: var(--wb-bg-card, #fff); outline: none;
}
.pbt__draft-hint { flex: none; font-size: var(--wb-fs-caption, 11px); color: var(--wb-text-tertiary, #94a3b8); }

.pbt__sep {
  display: flex; align-items: center; gap: var(--wb-space-2, 8px);
  margin: var(--wb-space-2, 8px) var(--wb-space-2, 8px) var(--wb-space-1, 4px);
  font-size: var(--wb-fs-caption, 11px); color: var(--wb-text-tertiary, #94a3b8);
}
.pbt__sep::after { content: ''; flex: 1; height: 1px; background: var(--wb-border-light, #f1f5f9); }

.pbt__scroll {
  flex: 1; min-height: 72px; max-height: calc(min(40vh, 300px) - 84px);
  overflow-y: auto; padding: 0 var(--wb-space-2, 8px) var(--wb-space-2, 8px);
}
.pbt__empty {
  padding: var(--wb-space-4, 16px) var(--wb-space-2, 8px);
  font-size: var(--wb-fs-meta, 12px); line-height: var(--wb-lh-relaxed, 1.65);
  color: var(--wb-text-tertiary, #94a3b8);
}

.pbt__menu {
  position: fixed; z-index: 3000; width: 168px;
  padding: var(--wb-space-1, 4px);
  background: var(--wb-bg-card, #fff);
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: var(--wb-radius-sm, 8px);
  box-shadow: var(--wb-elev-overlay, 0 8px 24px rgba(15,23,42,.10));
}
.pbt__menu button {
  display: block; width: 100%; text-align: left;
  padding: var(--wb-space-2, 8px);
  border: 0; border-radius: var(--wb-radius-xs, 6px);
  background: transparent; color: var(--wb-text, #1e293b);
  font-size: var(--wb-fs-body, 13px); cursor: pointer;
}
.pbt__menu button:hover { background: var(--wb-border-subtle, #f8fafc); }
.pbt__menu button.is-danger { color: var(--wb-status-danger, #dc2626); }
.pbt__menu button.is-danger:hover { background: var(--wb-status-danger-soft, #fee2e2); }
</style>
