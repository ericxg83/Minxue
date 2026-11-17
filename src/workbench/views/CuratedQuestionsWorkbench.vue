<template>
  <div class="curated wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学资源 / 好题甄选"
        title="好题甄选"
        description="错题和试卷题里的好题都收在这里，按标签筛选、勾选后导出 PDF 讲义"
      >
        <template #actions>
          <ActionButton variant="secondary" :loading="tagging" @click="runAutoTagging" title="用 AI 按教材目录给还没章节的题自动挂章节">
            <el-icon><MagicStick /></el-icon>AI 挂章节
          </ActionButton>
          <ActionButton variant="primary" :disabled="!selectedIds.length || exporting" @click="exportPdf">
            <el-icon><Download /></el-icon>导出 PDF{{ selectedIds.length ? `（${selectedIds.length}）` : '' }}
          </ActionButton>
        </template>
      </PageHeader>

      <!-- 章节筛选（静态教材目录树，命中任一即显示；一道综合题可挂多章） -->
      <div class="curated-chapter-bar">
        <span class="chapter-label">教材章节</span>
        <el-tree-select
          v-model="activeChapters" :data="chapterTree" multiple check-strictly
          :props="{ label: 'label', children: 'children', value: 'value' }"
          node-key="value" placeholder="按章节筛选（可多选，命中任一）" clearable
          style="width: 420px" :max-tag-count="2"
        />
        <span v-if="activeChapters.length" class="chapter-hint">已选 {{ activeChapters.length }} 章</span>
        <span class="chapter-hint">综合题可挂多章，讲哪章都能捞到</span>
      </div>

      <!-- 标签筛选条 -->
      <div class="curated-toolbar">
        <div class="tag-filter">
          <span class="tag-filter__label">标签</span>
          <button
            type="button" class="tag-chip" :class="{ active: !activeTags.length }"
            @click="activeTags = []"
          >全部 {{ list.length }}</button>
          <button
            v-for="s in tagStats" :key="s.tag" type="button"
            class="tag-chip" :class="{ active: activeTags.includes(s.tag) }"
            @click="toggleTag(s.tag)"
          >{{ s.tag }} {{ s.count }}</button>
        </div>
        <div class="toolbar-right">
          <el-select v-model="sourceType" placeholder="全部来源" clearable style="width: 140px">
            <el-option label="每日错题" value="question" />
            <el-option label="试卷题" value="resource_question" />
          </el-select>
          <WorkbenchInput v-model="keyword" placeholder="搜题干" clearable width="180px" />
          <el-select v-model="sort" style="width: 150px">
            <el-option label="最新收藏" value="newest" />
            <el-option label="最早收藏" value="oldest" />
            <el-option label="难度从高到低" value="difficulty_desc" />
          </el-select>
        </div>
      </div>

      <ContentCard :description="summaryText" flush>
        <div v-loading="loading" class="curated-body">
          <EmptyState
            v-if="!loading && !filteredList.length"
            icon="Star"
            :title="list.length ? '没有符合筛选的题' : '还没有甄选的好题'"
            :description="list.length ? '换个标签或来源试试。' : '在批改复核、学生详情、考法库、试卷题库或周末课件里，点题目上的星标即可收藏。'"
            compact
          />
          <div v-else class="curated-list">
            <article
              v-for="item in filteredList" :key="item.id"
              class="curated-item" :class="{ 'is-picked': selectedIds.includes(item.id) }"
            >
              <el-checkbox
                class="curated-item__check" :model-value="selectedIds.includes(item.id)"
                @change="v => togglePick(item.id, v)"
              />
              <div class="curated-item__main">
                <div class="curated-item__meta">
                  <span class="src-badge" :class="item.sourceType">
                    {{ item.sourceType === 'question' ? '错题' : '试卷题' }}
                  </span>
                  <span v-if="item.resourceName" class="res-name">{{ item.resourceName }}</span>
                  <span v-if="item.difficulty" class="diff">难度 {{ item.difficulty }}</span>
                  <span class="date">{{ formatDate(item.createdAt) }}</span>
                </div>
                <!-- 章节标签（一题可多章）：点章签的 × 移除；+ 章节从教材树里选 -->
                <div class="curated-item__chapters">
                  <button
                    v-for="cid in (item.chapterIds || [])" :key="cid" type="button"
                    class="chapter-chip" :title="`移除章节：${chapterNameOf(cid)}`"
                    @click="removeChapter(item, cid)"
                  >{{ chapterNameOf(cid) }} ×</button>
                  <el-dropdown trigger="click" @command="c => addChapter(item, c)">
                    <button type="button" class="chapter-chip is-add">+ 章节</button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-for="n in chapterFlat" :key="n.value" :command="n.value">{{ n.label }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                  <span v-if="!(item.chapterIds || []).length" class="chapter-empty">未挂章节</span>
                </div>
                <!-- 题干/选项/答案一律走 MathRender（与试卷题库同口径）：
                     ⛔ 裸 {{ content }} 会把 \frac、上下标、∠ 显示成 LaTeX 源码 —— 老师看到的就是「未处理状态」。
                     MathRender auto-detect 自动识别行内/块级公式，与试卷题库 pb-row__stem 完全同款。 -->
                <div v-if="item.parentStem" class="curated-item__stem">
                  <MathRender :content="item.parentStem" auto-detect />
                </div>
                <div v-if="curatedBodyText(item)" class="curated-item__stem">
                  <MathRender :content="curatedBodyText(item)" auto-detect />
                </div>
                <!-- 配图用裁片（后端已改为 image_url 优先），白底大图，不用小缩略图 -->
                <img
                  v-if="item.imageUrl" class="curated-item__figure"
                  :src="item.imageUrl" alt="原题图" loading="lazy"
                />
                <div v-if="item.options && item.options.length" class="curated-item__options">
                  <span v-for="(o, i) in item.options" :key="i">
                    {{ 'ABCD'[i] }}.<MathRender :content="String(o)" auto-detect tag="span" force-inline />
                  </span>
                </div>
                <div v-if="item.answer" class="curated-item__answer">
                  <span class="answer-label">参考答案</span>
                  <MathRender :content="item.answer" auto-detect tag="span" force-inline />
                </div>
                <div class="curated-item__tags">
                  <button
                    v-for="t in item.tags" :key="t" type="button"
                    class="tag-chip is-small active" @click="removeTag(item, t)"
                    title="点此移除标签"
                  >{{ t }} ×</button>
                  <el-dropdown trigger="click" @command="cmd => addTag(item, cmd)">
                    <button type="button" class="tag-chip is-small is-add">+ 标签</button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-for="t in allTags" :key="t" :command="t">{{ t }}</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
              <button type="button" class="curated-item__del" title="取消甄选" @click="unstar(item)">✕</button>
            </article>
          </div>
        </div>
      </ContentCard>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, MagicStick } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import PageHeader from '../components/ui/PageHeader.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import ActionButton from '../components/ui/ActionButton.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import MathRender from '../components/MathRender.vue'
import { bodyText } from '../utils/paperRowDisplay.js'
import { listCuratedQuestions, removeCuratedQuestion, updateCuratedQuestion, autoTagCuratedChapters } from '../../services/apiService'
import { apiRequest } from '../../services/apiService'

const router = useRouter()
const RECOMMENDED_TAGS = ['易错', '高难', '典型', '好素材']

const list = ref([])
const tagStats = ref([])
const loading = ref(false)
const exporting = ref(false)
const activeTags = ref([])
const sourceType = ref('')
const keyword = ref('')
const sort = ref('newest')
const selectedIds = ref([])
const tagging = ref(false)
// 教材章节（复用周末课件的静态目录树，命中任一筛选）
const chapterTree = ref([])
const chapterFlat = ref([])
const chapterNameMap = ref({})
const activeChapters = ref([])
const CHAPTER_GRADE = '初三'

async function loadChapterTree() {
  try {
    const res = await apiRequest(`/weekend-ppt/chapters?grade=${encodeURIComponent(CHAPTER_GRADE)}`)
    chapterTree.value = Array.isArray(res?.tree) ? res.tree : []
    const flat = []
    const map = {}
    const walk = (nodes) => (nodes || []).forEach(n => {
      flat.push({ value: n.value, label: n.label })
      map[n.value] = n.label
      if (n.children?.length) walk(n.children)
    })
    walk(chapterTree.value)
    chapterFlat.value = flat
    chapterNameMap.value = map
  } catch (e) {
    console.error('[好题甄选] 章节树加载失败:', e?.message || e)
  }
}
const chapterNameOf = cid => chapterNameMap.value[cid] || cid

const allTags = computed(() => {
  const set = new Set([...RECOMMENDED_TAGS, ...tagStats.value.map(s => s.tag)])
  return [...set]
})
// 复用试卷题库 bodyText 判据（content 与 parent_stem 逐字相同时不重复显示题干）；
// 甄选题是驼峰字段，这里做一次形状映射，不复制判据本身。
const curatedBodyText = item => bodyText({ content: item?.content, parent_stem: item?.parentStem })
const summaryText = computed(() => `共 ${list.value.length} 道甄选题${selectedIds.value.length ? ` · 已勾选 ${selectedIds.value.length} 道` : ''}`)

// 客户端再筛一层关键词/来源，标签与排序走后端（后端也支持，双保险且即时）
const filteredList = computed(() => {
  let out = list.value
  if (sourceType.value) out = out.filter(i => i.sourceType === sourceType.value)
  if (keyword.value?.trim()) {
    const kw = keyword.value.trim().toLowerCase()
    out = out.filter(i => (i.content || '').toLowerCase().includes(kw) || (i.parentStem || '').toLowerCase().includes(kw))
  }
  return out
})

async function load() {
  loading.value = true
  try {
    const data = await listCuratedQuestions({ tags: activeTags.value, chapterIds: activeChapters.value, sort: sort.value })
    list.value = Array.isArray(data?.items) ? data.items : []
    tagStats.value = Array.isArray(data?.tagStats) ? data.tagStats : []
    // 清掉已不存在的勾选
    const valid = new Set(list.value.map(i => i.id))
    selectedIds.value = selectedIds.value.filter(id => valid.has(id))
  } catch (e) {
    console.error('[好题甄选] 加载失败:', e?.message || e)
    ElMessage.error('加载失败：' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

function toggleTag(t) {
  activeTags.value = activeTags.value.includes(t)
    ? activeTags.value.filter(x => x !== t)
    : [...activeTags.value, t]
  load()
}

function togglePick(id, checked) {
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(x => x !== id)
}

async function addTag(item, tag) {
  if (item.tags.includes(tag)) return
  const tags = [...item.tags, tag]
  try {
    await updateCuratedQuestion(item.id, { tags })
    item.tags = tags
    load() // 刷新标签统计
  } catch (e) { ElMessage.error('打标失败：' + (e?.message || e)) }
}

async function removeTag(item, tag) {
  const tags = item.tags.filter(t => t !== tag)
  try {
    await updateCuratedQuestion(item.id, { tags })
    item.tags = tags
    load()
  } catch (e) { ElMessage.error('移除标签失败：' + (e?.message || e)) }
}

async function addChapter(item, cid) {
  if ((item.chapterIds || []).includes(cid)) return
  const chapterIds = [...(item.chapterIds || []), cid]
  try {
    await updateCuratedQuestion(item.id, { chapterIds })
    item.chapterIds = chapterIds
    ElMessage.success('已加章节：' + chapterNameOf(cid))
  } catch (e) { ElMessage.error('加章节失败：' + (e?.message || e)) }
}

async function removeChapter(item, cid) {
  const chapterIds = (item.chapterIds || []).filter(c => c !== cid)
  try {
    await updateCuratedQuestion(item.id, { chapterIds })
    item.chapterIds = chapterIds
  } catch (e) { ElMessage.error('移除章节失败：' + (e?.message || e)) }
}

async function runAutoTagging() {
  tagging.value = true
  try {
    const res = await autoTagCuratedChapters(CHAPTER_GRADE, false)
    const n = res?.applied || 0
    ElMessage.success(n ? `AI 已给 ${n} 道题挂上章节` : '没有需要挂章节的题（都已有章节）')
    await load()
  } catch (e) {
    ElMessage.error('AI 挂章节失败：' + (e?.message || e))
  } finally {
    tagging.value = false
  }
}

async function unstar(item) {
  try {
    await ElMessageBox.confirm('从好题甄选移除这道题？原题不受影响。', '取消甄选', { type: 'warning' })
    await removeCuratedQuestion(item.sourceType, item.sourceId)
    ElMessage.success('已取消甄选')
    load()
  } catch (e) {
    if (e !== 'cancel' && e?.message !== 'cancel') ElMessage.error('取消失败：' + (e?.message || e))
  }
}

function exportPdf() {
  // P1：把勾选的甄选题带进试卷题库卷面，复用现有三种版式导出
  const picked = list.value.filter(i => selectedIds.value.includes(i.id))
  sessionStorage.setItem('curated_export_items', JSON.stringify(picked))
  router.push('/paper-bank?from=curated')
}

function formatDate(v) {
  if (!v) return ''
  const d = new Date(v)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

watch(activeChapters, () => load(), { deep: true })

onMounted(async () => {
  await loadChapterTree()
  await load()
})
</script>

<style scoped>
.curated-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 14px; padding: 12px 14px;
  background: var(--wb-bg-card, #fff); border: 1px solid var(--wb-border, #ebeef5);
  border-radius: var(--wb-radius-panel, 10px);
}
.curated-chapter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; padding: 10px 14px; background: var(--wb-bg-card, #fff); border: 1px solid var(--wb-border, #ebeef5); border-radius: var(--wb-radius-panel, 10px); }
.chapter-label { font-size: 12px; color: var(--wb-text-secondary, #606266); font-weight: 500; }
.chapter-hint { font-size: 11px; color: var(--wb-text-muted, #909399); }
.tag-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.tag-filter__label { font-size: 12px; color: var(--wb-text-muted, #909399); margin-right: 2px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.tag-chip {
  padding: 3px 10px; font-size: 12px; color: var(--wb-text-secondary, #606266);
  background: var(--wb-bg-page, #f5f7fa); border: 1px solid transparent; border-radius: 999px; cursor: pointer;
}
.tag-chip:hover { border-color: var(--wb-primary, #409eff); }
.tag-chip.active { color: #fff; background: var(--wb-primary, #409eff); }
.tag-chip.is-small { padding: 2px 8px; font-size: 11px; }
.tag-chip.is-add { color: var(--wb-primary, #409eff); background: transparent; border: 1px dashed var(--wb-primary, #409eff); }
.curated-body { padding: 4px 14px 14px; }
.curated-list { display: flex; flex-direction: column; gap: 10px; }
.curated-item {
  display: flex; align-items: flex-start; gap: 10px; padding: 12px;
  border: 1px solid var(--wb-border, #ebeef5); border-radius: 8px; transition: 0.15s;
}
.curated-item:hover { border-color: var(--wb-primary-light, #c0c4cc); }
.curated-item.is-picked { border-color: var(--wb-primary, #409eff); background: rgba(64, 158, 255, 0.04); }
.curated-item__check { margin-top: 2px; }
.curated-item__main { flex: 1; min-width: 0; }
.curated-item__meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 11px; color: var(--wb-text-muted, #909399); }
.src-badge { padding: 1px 7px; border-radius: 4px; font-size: 11px; }
.src-badge.question { color: #e6a23c; background: rgba(230,162,60,.12); }
.src-badge.resource_question { color: #409eff; background: rgba(64,158,255,.12); }
.res-name, .diff { color: var(--wb-text-secondary, #606266); }
.date { margin-left: auto; }
.curated-item__stem { font-size: 13px; line-height: 1.6; color: var(--wb-text-primary, #303133); }
.curated-item__figure { display: block; max-width: 340px; max-height: 240px; object-fit: contain; border: 1px solid #e5e3dc; border-radius: 6px; margin: 8px 0 2px; background: #fff; }
.curated-item__options { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 12px; color: var(--wb-text-secondary, #606266); }
.curated-item__answer { margin-top: 6px; font-size: 12px; color: var(--wb-text-secondary, #606266); }
.curated-item__answer .answer-label { margin-right: 6px; color: var(--wb-text-tertiary, #909399); }
.curated-item__tags { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 8px; }
.curated-item__chapters { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 6px; }
.chapter-chip { padding: 2px 8px; font-size: 11px; color: #534AB7; background: #EEEDFE; border: 1px solid transparent; border-radius: 999px; cursor: pointer; }
.chapter-chip:hover { border-color: #534AB7; }
.chapter-chip.is-add { color: #534AB7; background: transparent; border: 1px dashed #534AB7; }
.chapter-empty { font-size: 11px; color: var(--wb-text-muted, #909399); }
.curated-item__del { padding: 2px 6px; color: #c0c4cc; background: transparent; border: 0; cursor: pointer; }
.curated-item__del:hover { color: #f56c6c; }
</style>
