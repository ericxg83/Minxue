<template>
  <div class="handout-list-page">
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">📚 我的讲义库</h2>
        <span class="page-subtitle">保存的备课讲义、笔记、可继续编辑</span>
      </div>
      <div class="header-right">
        <el-button @click="cleanupOldBlocks" plain :loading="cleaning">
          <el-icon><Brush /></el-icon>
          清理旧数据
        </el-button>
        <el-button type="primary" @click="goNewHandout">
          <el-icon><EditPen /></el-icon>
          新建讲义
        </el-button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input
        v-model="search"
        @input="onSearch"
        placeholder="搜索标题/时段"
        clearable
        size="small"
        style="width: 240px;"
        :prefix-icon="Search"
      />
      <el-select
        v-model="subjectFilter"
        @change="loadList"
        placeholder="全部学科"
        size="small"
        clearable
        style="width: 140px;"
      >
        <el-option label="全部" :value="null" />
        <el-option label="数学" value="数学" />
        <el-option label="语文" value="语文" />
        <el-option label="英语" value="英语" />
        <el-option label="物理" value="物理" />
        <el-option label="化学" value="化学" />
        <el-option label="生物" value="生物" />
      </el-select>
      <span class="filter-count">共 {{ total }} 份讲义</span>
    </div>

    <!-- 加载/空态 -->
    <div v-if="loading" class="loading-area">
      <el-skeleton :rows="6" animated />
    </div>
    <div v-else-if="lectures.length === 0" class="empty-area">
      <el-empty description="还没有保存的讲义">
        <el-button type="primary" @click="goNewHandout">去生成第一份讲义</el-button>
      </el-empty>
    </div>

    <!-- 列表 -->
    <div v-else class="lecture-grid">
      <div
        v-for="lec in lectures"
        :key="lec.id"
        class="lecture-card"
        @click="openLecture(lec)"
      >
        <div class="card-header">
          <span class="card-title">{{ lec.title }}</span>
          <el-tag v-if="lec.subject" size="small" :type="subjectTagType(lec.subject)" effect="plain">{{ lec.subject }}</el-tag>
        </div>
        <div class="card-period" v-if="lec.period_text">
          <el-icon><Clock /></el-icon> {{ lec.period_text }}
        </div>
        <div class="card-meta">
          <span class="meta-item">
            <el-icon><Document /></el-icon> {{ lec.kp_count || 0 }} 知识点
          </span>
          <span class="meta-item">
            <el-icon><Files /></el-icon> {{ lec.page_count || 0 }} 页
          </span>
          <el-tag v-if="templateLabel(lec.template)" size="small" type="info" effect="plain" class="template-tag">{{ templateLabel(lec.template) }}</el-tag>
          <el-tag v-if="lec.has_notes" size="small" type="success" effect="plain">📝 有笔记</el-tag>
          <el-tag v-if="lec.has_script" size="small" type="warning" effect="plain">🎙️ 有提词器</el-tag>
        </div>
        <div class="card-time">上次维护 {{ formatTime(lec.updated_at || lec.created_at) }}</div>
        <div class="card-actions" @click.stop>
          <el-button size="small" text type="primary" :icon="Edit" @click="openLecture(lec)">打开</el-button>
          <el-button size="small" text :icon="CopyDocument" @click="duplicate(lec)">复制</el-button>
          <el-button size="small" text type="danger" :icon="Delete" @click="confirmDelete(lec)">删除</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EditPen, Search, Document, Files, Edit, CopyDocument, Delete, Brush, Clock } from '@element-plus/icons-vue'
import { apiRequest } from '../../services/apiService'

const router = useRouter()
const loading = ref(false)
const lectures = ref([])
const total = ref(0)
const search = ref('')
const subjectFilter = ref(null)
const cleaning = ref(false)
let searchTimer = null

function formatTime(t) {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

function subjectTagType(s) {
  const map = { 数学: 'primary', 英语: 'success', 语文: 'warning', 物理: 'info', 化学: 'danger', 生物: '' }
  return map[s] || 'info'
}

function templateLabel(t) {
  const map = {
    lecture_prep: '备课讲义',
    classroom_projection: '投屏备课讲义',
    english_lecture_prep: '英语备课讲义',
  }
  return map[t] || ''
}

async function loadList() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (subjectFilter.value) params.set('subject', subjectFilter.value)
    if (search.value) params.set('search', search.value)
    const resp = await apiRequest(`/handout/lectures?${params.toString()}`)
    if (resp.success) {
      lectures.value = resp.lectures || []
      total.value = lectures.value.length
    }
  } catch (e) {
    console.error('加载讲义列表失败:', e)
    ElMessage.error('加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadList, 400)
}

function goNewHandout() {
  router.push({ name: 'HandoutPreview', query: { mode: 'week' } })
}

function openLecture(lec) {
  router.push({ name: 'HandoutPreview', query: { lectureId: lec.id } })
}

async function duplicate(lec) {
  try {
    const resp = await apiRequest(`/handout/lectures/${lec.id}/duplicate`, { method: 'POST' })
    if (resp.success) {
      ElMessage.success('已复制')
      loadList()
    }
  } catch (e) {
    ElMessage.error('复制失败: ' + e.message)
  }
}

async function confirmDelete(lec) {
  try {
    await ElMessageBox.confirm(
      `确认删除「${lec.title}」？此操作不可恢复。`,
      '删除讲义',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    const resp = await apiRequest(`/handout/lectures/${lec.id}`, { method: 'DELETE' })
    if (resp.success) {
      ElMessage.success('已删除')
      loadList()
    }
  } catch (e) {
    if (e === 'cancel' || e?.message?.includes('cancel')) return
    ElMessage.error('删除失败: ' + e.message)
  }
}

async function cleanupOldBlocks() {
  try {
    await ElMessageBox.confirm(
      '将扫描所有讲义，删除含"变式改写 / 强化训练 / 变式练习 / 错题重练"等老版关键词的 block。\n\n清空整页的讲义会被整份删除。此操作不可恢复，是否继续？',
      '清理旧数据',
      { type: 'warning', confirmButtonText: '开始清理', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  cleaning.value = true
  try {
    const resp = await apiRequest('/handout/lectures/cleanup-old-blocks', { method: 'POST' })
    if (resp.success) {
      const { removedLectures, sanitizedLectures, removedBlocks } = resp
      ElMessage.success(
        `清理完成：删除 ${removedLectures} 份、清理 ${sanitizedLectures} 份、共 ${removedBlocks} 个 block`
      )
      loadList()
    }
  } catch (e) {
    ElMessage.error('清理失败: ' + e.message)
  } finally {
    cleaning.value = false
  }
}

onMounted(loadList)
</script>

<style scoped>
.handout-list-page {
  padding: 24px 32px;
  background: #F5F6FA;
  min-height: 100%;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #E5E6EB;
}
.header-left { display: flex; flex-direction: column; gap: 4px; }
.page-title { font-size: 22px; font-weight: 700; color: #1D2129; margin: 0; }
.page-subtitle { font-size: 13px; color: #86909C; }
.header-right { display: flex; gap: 8px; }

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.filter-count {
  margin-left: auto;
  font-size: 13px;
  color: #86909C;
}

.loading-area,
.empty-area {
  padding: 48px 0;
  display: flex;
  justify-content: center;
}

.lecture-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.lecture-card {
  background: #fff;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.lecture-card:hover {
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.12);
  transform: translateY(-2px);
  border-color: #6366F1;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
}
.card-period {
  font-size: 12px;
  color: #86909C;
  margin-bottom: 10px;
}
.card-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #4E5969;
  margin-bottom: 8px;
}
.meta-item { display: flex; align-items: center; gap: 4px; }
.template-tag { margin-left: 4px; }
.card-time {
  font-size: 11px;
  color: #C9CDD4;
  margin-bottom: 12px;
}
.card-actions {
  display: flex;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px dashed #E5E6EB;
}
</style>
