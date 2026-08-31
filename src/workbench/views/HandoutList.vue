<template>
  <div class="handout-list-page wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学资源 / 内容管理"
        title="我的讲义"
        description="管理已保存的备课讲义，快速继续编辑、补充笔记或进入课堂展示。"
      >
        <template #actions>
          <ActionButton variant="primary" @click="goNewHandout"><el-icon><EditPen /></el-icon>新建讲义</ActionButton>
        </template>
      </PageHeader>

      <FilterBar class="handout-filter">
        <template #leading>
          <div class="resource-summary"><strong>{{ total }} 份讲义</strong><span>已保存的备课内容</span></div>
        </template>
        <WorkbenchInput v-model="search" clearable placeholder="搜索讲义标题或课时" width="240px" aria-label="搜索讲义" @input="onSearch">
          <template #prefix><el-icon><Search /></el-icon></template>
        </WorkbenchInput>
        <WorkbenchSelect
          v-model="subjectFilter"
          :options="subjectOptions"
          clearable
          placeholder="全部学科"
          width="140px"
          aria-label="按学科筛选"
          @change="loadList"
        />
        <template v-if="hasActiveFilters" #actions><el-button text @click="resetFilters">重置</el-button></template>
      </FilterBar>

      <ContentCard class="handout-library" title="讲义列表" description="按最近维护时间查看并继续完善备课内容" flush>
        <div v-if="loading" class="handout-loading" aria-label="正在加载讲义">
          <div v-for="index in 5" :key="index" class="skeleton-row">
            <el-skeleton animated>
              <template #template>
                <div class="skeleton-content">
                  <el-skeleton-item variant="rect" class="skeleton-cover" />
                  <div class="skeleton-primary"><el-skeleton-item variant="text" class="skeleton-title" /><el-skeleton-item variant="text" class="skeleton-meta" /></div>
                  <el-skeleton-item variant="text" class="skeleton-size" />
                  <el-skeleton-item variant="button" class="skeleton-action" />
                </div>
              </template>
            </el-skeleton>
          </div>
        </div>

        <EmptyState v-else-if="!lectures.length" :icon="Reading" :title="hasActiveFilters ? '没有找到匹配的讲义' : '还没有讲义'" :description="hasActiveFilters ? '可以调整搜索词或学科筛选。' : '创建第一份讲义，开始整理备课内容和课堂讲解材料。'">
          <template #actions>
            <ActionButton v-if="hasActiveFilters" @click="resetFilters">重置筛选</ActionButton>
            <ActionButton v-else variant="primary" @click="goNewHandout"><el-icon><EditPen /></el-icon>新建讲义</ActionButton>
          </template>
        </EmptyState>

        <div v-else class="lecture-records">
          <article v-for="lecture in lectures" :key="lecture.id" class="lecture-record" tabindex="0" @click="openLecture(lecture)" @keydown.enter="openLecture(lecture)">
            <div class="lecture-cover" aria-hidden="true"><el-icon><Reading /></el-icon><span>{{ lecture.subject || '讲义' }}</span></div>
            <div class="lecture-primary">
              <div class="lecture-title-row">
                <h3>{{ lecture.title || '未命名讲义' }}</h3>
                <StatusTag v-if="templateLabel(lecture.template)" :label="templateLabel(lecture.template)" tone="primary" />
              </div>
              <div class="lecture-context">
                <span class="subject-chip">{{ lecture.subject || '未设置学科' }}</span>
                <span v-if="lecture.period_text"><el-icon><Clock /></el-icon>{{ lecture.period_text }}</span>
              </div>
              <div class="lecture-updated">最近维护 {{ formatTime(lecture.updated_at || lecture.created_at) || '-' }}</div>
            </div>
            <div class="lecture-content-summary">
              <span>内容规模</span>
              <strong>{{ lecture.kp_count || 0 }} 个知识点 · {{ lecture.page_count || 0 }} 页</strong>
              <div class="content-tags">
                <StatusTag v-if="lecture.has_notes" label="有笔记" tone="success" />
                <StatusTag v-if="lecture.has_script" label="有提词器" tone="warning" />
                <span v-if="!lecture.has_notes && !lecture.has_script">可继续补充笔记与讲课脚本</span>
              </div>
            </div>
            <div class="lecture-actions" @click.stop>
              <el-button text type="primary" :icon="Edit" @click="openLecture(lecture)">继续编辑</el-button>
              <el-button text :icon="CopyDocument" @click="duplicate(lecture)">复制</el-button>
              <el-button text type="danger" :icon="Delete" @click="confirmDelete(lecture)">删除</el-button>
            </div>
            <el-icon class="record-arrow"><ArrowRight /></el-icon>
          </article>
        </div>
      </ContentCard>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight, Clock, CopyDocument, Delete, Edit, EditPen, Reading, Search } from '@element-plus/icons-vue'
import { apiRequest } from '../../services/apiService'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'

const router = useRouter()
const loading = ref(false)
const lectures = ref([])
const total = ref(0)
const search = ref('')
const subjectFilter = ref(null)
const subjects = ['数学', '语文', '英语', '物理', '化学', '生物']
const subjectOptions = computed(() => subjects.map(s => ({ label: s, value: s })))
const hasActiveFilters = computed(() => Boolean(search.value || subjectFilter.value))
let searchTimer = null

function formatTime(time) {
  if (!time) return ''
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

function templateLabel(template) {
  const labels = {
    lecture_prep: '备课讲义',
    classroom_projection: '投屏讲义',
    english_lecture_prep: '英语备课讲义'
  }
  return labels[template] || ''
}

async function loadList() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (subjectFilter.value) params.set('subject', subjectFilter.value)
    if (search.value) params.set('search', search.value)
    const response = await apiRequest(`/handout/lectures?${params.toString()}`)
    if (response.success) {
      lectures.value = response.lectures || []
      total.value = lectures.value.length
    }
  } catch (error) {
    console.error('加载讲义列表失败:', error)
    ElMessage.error('加载失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadList, 400)
}

function resetFilters() {
  search.value = ''
  subjectFilter.value = null
  if (searchTimer) clearTimeout(searchTimer)
  loadList()
}

function goNewHandout() {
  router.push({ name: 'HandoutPreview', query: { mode: 'week' } })
}

function openLecture(lecture) {
  router.push({ name: 'HandoutPreview', query: { lectureId: lecture.id } })
}

async function duplicate(lecture) {
  try {
    const response = await apiRequest(`/handout/lectures/${lecture.id}/duplicate`, { method: 'POST' })
    if (response.success) {
      ElMessage.success('已复制')
      loadList()
    }
  } catch (error) {
    ElMessage.error('复制失败: ' + error.message)
  }
}

async function confirmDelete(lecture) {
  try {
    await ElMessageBox.confirm(
      `确认删除「${lecture.title}」？此操作不可恢复。`,
      '删除讲义',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    const response = await apiRequest(`/handout/lectures/${lecture.id}`, { method: 'DELETE' })
    if (response.success) {
      ElMessage.success('已删除')
      loadList()
    }
  } catch (error) {
    if (error === 'cancel' || error?.message?.includes('cancel')) return
    ElMessage.error('删除失败: ' + error.message)
  }
}

onMounted(loadList)
</script>

<style scoped>
.handout-list-page { overflow-y: auto; color: var(--wb-text); }
.handout-filter { margin-bottom: 16px; }
.resource-summary { display: flex; flex-direction: column; gap: 4px; white-space: nowrap; }
.resource-summary strong { font-size: 12px; }
.resource-summary span { color: var(--wb-text-tertiary); font-size: 10px; }
.handout-search { width: 280px; }
.subject-select { width: 132px; }
.handout-library { min-height: 430px; overflow: hidden; }
.lecture-record { display: grid; grid-template-columns: 58px minmax(280px, 1.2fr) minmax(220px, .75fr) auto 16px; align-items: center; gap: 18px; min-height: 108px; padding: 15px 18px; box-sizing: border-box; border-bottom: 1px solid var(--wb-border-light); cursor: pointer; transition: background-color .16s ease; }
.lecture-record:last-child { border-bottom: 0; }
.lecture-record:hover { background: var(--wb-bg-elevated); }
.lecture-record:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--wb-primary); outline-offset: -2px; }
.lecture-cover { display: flex; align-items: center; justify-content: center; width: 52px; height: 70px; flex-direction: column; gap: 8px; color: var(--wb-primary); background: linear-gradient(145deg, #f8f9ff, #eef0ff); border: 1px solid #dfe3ff; border-radius: 8px; }
.lecture-cover .el-icon { font-size: 23px; }
.lecture-cover span { max-width: 44px; overflow: hidden; font-size: 9px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.lecture-primary { min-width: 0; }
.lecture-title-row { display: flex; align-items: center; min-width: 0; gap: 9px; }
.lecture-title-row h3 { overflow: hidden; margin: 0; color: var(--wb-text); font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.lecture-context { display: flex; align-items: center; gap: 10px; margin-top: 10px; color: var(--wb-text-secondary); font-size: 10px; }
.lecture-context > span { display: inline-flex; align-items: center; gap: 4px; }
.subject-chip { height: 22px; padding: 0 7px; box-sizing: border-box; color: var(--wb-text-secondary); background: var(--wb-bg-elevated); border-radius: 5px; }
.lecture-updated { margin-top: 9px; color: var(--wb-text-tertiary); font-size: 10px; }
.lecture-content-summary { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
.lecture-content-summary > span { color: var(--wb-text-tertiary); font-size: 9px; }
.lecture-content-summary > strong { color: var(--wb-text); font-size: 11px; font-weight: 600; }
.content-tags { display: flex; align-items: center; min-height: 24px; gap: 6px; }
.content-tags > span:not(.ds-status-tag) { color: var(--wb-text-tertiary); font-size: 9px; }
.lecture-actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; white-space: nowrap; }
.lecture-actions :deep(.el-button + .el-button) { margin-left: 0; }
.record-arrow { display: none; color: var(--wb-text-tertiary); }
.handout-loading { display: grid; }
.skeleton-row { padding: 18px; border-bottom: 1px solid var(--wb-border-light); }
.skeleton-row:last-child { border-bottom: 0; }
.skeleton-content { display: grid; grid-template-columns: 52px minmax(220px, 1fr) minmax(150px, .6fr) 180px; align-items: center; gap: 18px; }
.skeleton-cover { width: 52px; height: 70px; border-radius: 8px; }
.skeleton-primary { display: flex; flex-direction: column; gap: 12px; }
.skeleton-title { width: 46%; }
.skeleton-meta { width: 65%; }
.skeleton-size { width: 120px; }
.skeleton-action { width: 150px; height: 30px; }
.handout-list-page :deep(.el-input__wrapper), .handout-list-page :deep(.el-select__wrapper) { min-height: 34px; border-radius: 8px; box-shadow: 0 0 0 1px var(--wb-border) inset; }
@media (max-width: 1080px) { .lecture-record { grid-template-columns: 54px minmax(240px, 1fr) minmax(180px, .65fr) 16px; } .lecture-actions { display: none; } .record-arrow { display: block; } }
@media (max-width: 760px) { .handout-search, .subject-select { width: 100%; } .lecture-record { grid-template-columns: 48px minmax(0, 1fr) 16px; gap: 12px; padding: 14px; } .lecture-cover { width: 44px; height: 60px; } .lecture-content-summary { grid-column: 2 / -1; } .record-arrow { grid-column: 3; grid-row: 1; } }
</style>