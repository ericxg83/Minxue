<template>
  <div class="type-library wb-page">
    <div class="wb-page__inner">
      <PageHeader eyebrow="教学资源 / 数学备课" title="我的题型库" description="按知识点沉淀典型题型、讲解策略和代表题，用于周末课讲义。">
        <template #actions>
          <ActionButton @click="showCandidates = true"><el-icon><Collection /></el-icon>从错题收录</ActionButton>
          <ActionButton variant="primary" @click="startCreate"><el-icon><Plus /></el-icon>新建题型</ActionButton>
        </template>
      </PageHeader>

      <section class="library-stats" aria-label="题型库摘要">
        <div class="library-stat"><span>已收录题型</span><strong>{{ summary.type_count || 0 }}</strong><small>覆盖 {{ summary.knowledge_count || 0 }} 个知识点</small></div>
        <div class="library-stat"><span>本周维护</span><strong>{{ summary.updated_this_week || 0 }}</strong><small>持续完善讲解策略</small></div>
        <div class="library-stat emphasis"><span>备课路径</span><strong>知识点 → 题型 → 代表题</strong><small>插入讲义后会保存独立快照</small></div>
      </section>

      <FilterBar class="type-filter">
        <template #leading><div class="result-context"><strong>{{ selectedKnowledge?.name || '全部知识点' }}</strong><span>{{ types.length }} 个题型</span></div></template>
        <el-input v-model="keyword" clearable placeholder="搜索题型名称或讲解策略" :prefix-icon="Search" @input="debouncedLoad" />
        <el-select v-model="selectedKpId" clearable filterable placeholder="选择知识点" @change="loadTypes">
          <el-option label="全部知识点" :value="null" />
          <el-option v-for="kp in flatKnowledge" :key="kp.id" :value="kp.id" :label="`${'　'.repeat(kp.level || 0)}${kp.name}`" />
        </el-select>
      </FilterBar>

      <main class="library-workspace">
        <ContentCard class="type-list-card" title="题型列表" description="选择一个题型查看讲解与代表题" flush>
          <div v-if="loading" class="list-loading"><el-skeleton v-for="index in 6" :key="index" animated :rows="2" /></div>
          <EmptyState v-else-if="!types.length" :icon="Collection" :title="keyword || selectedKpId ? '没有匹配的题型' : '从第一个题型开始'" :description="keyword || selectedKpId ? '调整筛选条件，或直接创建新的题型。' : '先选择一个知识点，再从真实错题中收录代表题。'">
            <template #actions><ActionButton variant="primary" @click="startCreate">新建题型</ActionButton></template>
          </EmptyState>
          <div v-else class="type-list" role="listbox" aria-label="题型列表">
            <button v-for="item in types" :key="item.id" type="button" :class="['type-row', { active: selectedId === item.id }]" @click="selectType(item.id)">
              <span class="row-main"><strong>{{ item.name }}</strong><small>{{ item.knowledge_name }} · {{ item.example_count }} 道代表题</small></span>
              <span class="row-tags"><el-tag v-for="tag in (item.tags || []).slice(0, 2)" :key="tag" size="small" effect="plain">{{ tag }}</el-tag></span>
              <el-icon><ArrowRight /></el-icon>
            </button>
          </div>
        </ContentCard>

        <ContentCard class="type-inspector" title="题型详情" :description="selectedType ? `${selectedType.knowledge_name} · 教师私有教学资产` : '从左侧选择一个题型'" flush>
          <div v-if="detailLoading" class="detail-loading"><el-skeleton animated :rows="10" /></div>
          <EmptyState v-else-if="!selectedType" :icon="Reading" title="选择题型查看详情" description="在知识点下整理代表题与课堂讲法。" compact />
          <article v-else class="type-detail">
            <div class="detail-heading"><div><div class="knowledge-label">{{ selectedType.knowledge_name }}</div><h2>{{ selectedType.name }}</h2></div><el-dropdown @command="handleDetailAction"><el-button text aria-label="题型操作"><el-icon><MoreFilled /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">编辑题型</el-dropdown-item><el-dropdown-item command="archive" divided>归档题型</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
            <div v-if="selectedType.tags?.length" class="detail-tags"><el-tag v-for="tag in selectedType.tags" :key="tag" size="small">{{ tag }}</el-tag></div>
            <section class="detail-section"><h3>课堂讲法</h3><p>{{ selectedType.teaching_notes || '还没有记录讲解策略。建议补充“先讲什么、怎么引导、板书关键步骤”。' }}</p></section>
            <section class="detail-section"><h3>易错提醒</h3><p>{{ selectedType.common_mistakes || '暂未记录。可从近期学生错因中补充。' }}</p></section>
            <section class="detail-section examples"><div class="section-heading"><h3>代表题</h3><span>{{ selectedType.examples?.length || 0 }} 道</span></div><div v-if="!selectedType.examples?.length" class="empty-copy">还没有代表题。可从错题候选中收录一题。</div><article v-for="example in selectedType.examples" :key="example.id" class="example-card"><div class="example-content">{{ example.snapshot?.content || '题目内容快照不可用' }}</div><div class="example-meta"><span>{{ example.snapshot?.questionType || '综合题' }}</span><span v-if="example.snapshot?.answer">答案：{{ example.snapshot.answer }}</span></div><p v-if="example.note">{{ example.note }}</p><div class="example-actions"><el-button v-if="example.sourceQuestionId" text size="small" :loading="variantLoadingId === example.id" @click="generateVariants(example)">生成变式练习</el-button><span v-else>自包含错题暂不支持自动变式</span></div></article></section>
          </article>
        </ContentCard>
      </main>
    </div>

    <el-drawer v-model="editorVisible" :title="editingId ? '编辑题型' : '新建题型'" size="min(520px, 100%)" destroy-on-close>
      <el-form label-position="top" :model="editor"><el-form-item label="主知识点" required><el-select v-model="editor.kpId" filterable placeholder="选择知识点" style="width:100%"><el-option v-for="kp in flatKnowledge" :key="kp.id" :value="kp.id" :label="`${'　'.repeat(kp.level || 0)}${kp.name}`" /></el-select></el-form-item><el-form-item label="题型名称" required><el-input v-model="editor.name" maxlength="60" show-word-limit placeholder="例如：行程问题的方程建模" /></el-form-item><el-form-item label="课堂讲法"><el-input v-model="editor.teachingNotes" type="textarea" :rows="5" placeholder="讲解顺序、板书步骤、提问引导…" /></el-form-item><el-form-item label="易错提醒"><el-input v-model="editor.commonMistakes" type="textarea" :rows="3" placeholder="学生容易在哪一步出错？" /></el-form-item><el-form-item label="教学标签"><el-select v-model="editor.tags" multiple filterable allow-create default-first-option placeholder="如：高频、建模、周末课" style="width:100%" /></el-form-item></el-form>
      <template #footer><div class="drawer-actions"><el-button @click="editorVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveType">保存题型</el-button></div></template>
    </el-drawer>

    <el-dialog v-model="showCandidates" title="从近期错题收录" width="min(760px, 94vw)">
      <p class="candidate-intro">系统只根据近期真实错题提供候选。确认收录后，才会成为你的教学题型。</p>
      <div v-if="candidatesLoading" class="list-loading"><el-skeleton v-for="index in 4" :key="index" animated :rows="2" /></div>
      <EmptyState v-else-if="!candidates.length" :icon="CircleCheck" title="暂无待收录候选" description="已有题型已覆盖近期主要错题，或先完成题目知识点关联。" compact />
      <div v-else class="candidate-list"><button v-for="candidate in candidates" :key="`${candidate.kp_id}-${candidate.source_type}`" type="button" class="candidate-row" @click="collectCandidate(candidate)"><span><strong>{{ candidate.knowledge_name }} · {{ candidate.source_type }}</strong><small>{{ candidate.wrong_count }} 次错误 · {{ candidate.student_count }} 名学生</small></span><el-icon><Plus /></el-icon></button></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight, CircleCheck, Collection, MoreFilled, Plus, Reading, Search } from '@element-plus/icons-vue'
import { apiRequest, getKnowledgeTree } from '../../services/apiService'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'

const types = ref([]); const summary = ref({}); const tree = ref([]); const selectedKpId = ref(null); const keyword = ref(''); const selectedId = ref(null); const selectedType = ref(null)
const loading = ref(false); const detailLoading = ref(false); const saving = ref(false); const variantLoadingId = ref(null); const editorVisible = ref(false); const editingId = ref(null); const showCandidates = ref(false); const candidates = ref([]); const candidatesLoading = ref(false)
const blankEditor = () => ({ kpId: selectedKpId.value || '', name: '', teachingNotes: '', commonMistakes: '', tags: [] }); const editor = ref(blankEditor())
const flatten = (nodes, output = []) => { for (const node of nodes || []) { output.push(node); flatten(node.children, output) } return output }; const flatKnowledge = computed(() => flatten(tree.value)); const selectedKnowledge = computed(() => flatKnowledge.value.find(kp => kp.id === selectedKpId.value))
let timer; const debouncedLoad = () => { clearTimeout(timer); timer = setTimeout(loadTypes, 250) }
async function loadTypes() { loading.value = true; try { const params = new URLSearchParams(); if (selectedKpId.value) params.set('kpId', selectedKpId.value); if (keyword.value) params.set('keyword', keyword.value); const data = await apiRequest(`/teaching-question-types?${params}`); types.value = data.types || []; if (selectedId.value && !types.value.some(item => item.id === selectedId.value)) { selectedId.value = null; selectedType.value = null } } catch (error) { ElMessage.error(error.message || '加载题型库失败') } finally { loading.value = false } }
async function selectType(id) { selectedId.value = id; detailLoading.value = true; try { const data = await apiRequest(`/teaching-question-types/${id}`); selectedType.value = data.type } catch (error) { ElMessage.error(error.message || '加载题型失败') } finally { detailLoading.value = false } }
async function loadSummary() { const data = await apiRequest('/teaching-question-types/summary'); summary.value = data.summary || {} }
function startCreate() { editingId.value = null; editor.value = blankEditor(); editorVisible.value = true }
function collectCandidate(candidate) { editingId.value = null; editor.value = { kpId: candidate.kp_id, name: `${candidate.knowledge_name} · ${candidate.source_type}`, teachingNotes: '', commonMistakes: '', tags: ['近期高频'] }; editor.value.candidate = candidate; showCandidates.value = false; editorVisible.value = true }
async function saveType() { if (!editor.value.kpId || !editor.value.name.trim()) return ElMessage.warning('请填写主知识点和题型名称'); saving.value = true; try { const payload = { kpId: editor.value.kpId, name: editor.value.name, teachingNotes: editor.value.teachingNotes, commonMistakes: editor.value.commonMistakes, tags: editor.value.tags }; const data = editingId.value ? await apiRequest(`/teaching-question-types/${editingId.value}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) : await apiRequest('/teaching-question-types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const type = data.type; if (editor.value.candidate) { const candidate = editor.value.candidate; await apiRequest(`/teaching-question-types/${type.id}/examples`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceQuestionId: candidate.question_id, sourceWrongQuestionId: candidate.wrong_question_id, snapshot: candidate.snapshot, note: '从近期错题收录' }) }) } editorVisible.value = false; await Promise.all([loadTypes(), loadSummary()]); await selectType(type.id); ElMessage.success(editor.value.candidate ? '已收录题型与代表题' : '题型已保存') } catch (error) { ElMessage.error(error.message || '保存失败') } finally { saving.value = false } }
async function generateVariants(example) {
  variantLoadingId.value = example.id
  try {
    const response = await apiRequest(`/variants/${example.sourceQuestionId}/generate-all`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    ElMessage.success(response.generated ? `已生成 ${response.generated} 道变式题，可在后续组卷中使用` : '该代表题的变式题已就绪')
  } catch (error) {
    ElMessage.error(error.message || '生成变式题失败')
  } finally {
    variantLoadingId.value = null
  }
}
function handleDetailAction(command) { if (command === 'edit') { editingId.value = selectedType.value.id; editor.value = { kpId: selectedType.value.kp_id, name: selectedType.value.name, teachingNotes: selectedType.value.teaching_notes, commonMistakes: selectedType.value.common_mistakes, tags: selectedType.value.tags || [] }; editorVisible.value = true; return } ElMessageBox.confirm(`归档“${selectedType.value.name}”后将不再显示在讲义插入列表中。`, '归档题型', { type: 'warning' }).then(async () => { await apiRequest(`/teaching-question-types/${selectedType.value.id}`, { method: 'DELETE' }); selectedId.value = null; selectedType.value = null; await Promise.all([loadTypes(), loadSummary()]); ElMessage.success('题型已归档') }).catch(() => {}) }
async function loadCandidates() { candidatesLoading.value = true; try { const data = await apiRequest('/teaching-question-types/candidates'); candidates.value = data.candidates || [] } catch (error) { ElMessage.error(error.message || '加载候选失败') } finally { candidatesLoading.value = false } }
watch(showCandidates, visible => { if (visible) loadCandidates() }); onMounted(async () => { try { tree.value = await getKnowledgeTree('数学') } catch { ElMessage.warning('知识点目录加载失败') } await Promise.all([loadTypes(), loadSummary()]) })
</script>

<style scoped>
.type-library{min-height:100%;background:var(--wb-bg)}.library-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px;border:1px solid var(--wb-border);border-radius:10px;background:var(--wb-bg-card);overflow:hidden}.library-stat{display:grid;gap:4px;padding:16px 20px;border-right:1px solid var(--wb-border-light)}.library-stat:last-child{border-right:0}.library-stat span,.library-stat small{color:var(--wb-text-tertiary);font-size:11px}.library-stat strong{color:var(--wb-text);font-size:21px;line-height:1.25}.library-stat.emphasis strong{font-size:14px;color:var(--wb-primary)}.result-context{display:flex;flex-direction:column;gap:2px}.result-context span{color:var(--wb-text-tertiary);font-size:11px}.library-workspace{display:grid;grid-template-columns:minmax(330px,.78fr) minmax(440px,1.22fr);gap:16px}.type-list-card,.type-inspector{min-height:580px}.type-list{display:grid}.type-row,.candidate-row{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:0;border-bottom:1px solid var(--wb-border-light);background:transparent;color:inherit;text-align:left;cursor:pointer}.type-row:hover,.candidate-row:hover{background:var(--wb-bg-subtle)}.type-row.active{background:var(--wb-primary-soft);box-shadow:inset 3px 0 var(--wb-primary)}.row-main{display:grid;min-width:0;flex:1;gap:4px}.row-main strong{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.row-main small,.candidate-row small{color:var(--wb-text-tertiary);font-size:11px}.row-tags{display:flex;max-width:140px;gap:4px;overflow:hidden}.list-loading{display:grid;gap:16px;padding:16px}.type-detail{padding:18px 20px}.detail-heading,.section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.knowledge-label{margin-bottom:5px;color:var(--wb-primary);font-size:11px;font-weight:650}.detail-heading h2{margin:0;font-size:21px;letter-spacing:-.02em}.detail-tags{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.detail-section{padding:17px 0;border-top:1px solid var(--wb-border-light)}.detail-section h3{margin:0 0 8px;font-size:12px}.detail-section p,.empty-copy{margin:0;color:var(--wb-text-secondary);font-size:13px;line-height:1.75;white-space:pre-wrap}.section-heading span{color:var(--wb-text-tertiary);font-size:11px}.examples{display:grid;gap:10px}.example-card{padding:12px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-subtle)}.example-content{display:-webkit-box;overflow:hidden;font-size:13px;line-height:1.6;-webkit-box-orient:vertical;-webkit-line-clamp:3}.example-meta{display:flex;gap:10px;margin-top:9px;color:var(--wb-text-tertiary);font-size:11px}.example-actions{display:flex;justify-content:flex-end;margin-top:7px;color:var(--wb-text-tertiary);font-size:11px}.candidate-intro{margin:0 0 12px;color:var(--wb-text-secondary);font-size:13px}.candidate-list{border-top:1px solid var(--wb-border-light)}.candidate-row span{display:grid;gap:4px;flex:1}.candidate-row strong{font-size:13px}.drawer-actions{display:flex;justify-content:flex-end;gap:8px}@media(max-width:900px){.library-workspace{grid-template-columns:1fr}.type-list-card,.type-inspector{min-height:auto}.type-inspector{min-height:440px}}@media(max-width:720px){.library-stats{grid-template-columns:1fr}.library-stat{border-right:0;border-bottom:1px solid var(--wb-border-light)}.library-stat:last-child{border-bottom:0}.type-filter :deep(.filter-bar__body){align-items:stretch;flex-direction:column}.row-tags{display:none}}
</style>
