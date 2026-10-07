<template>
  <div class="type-library wb-page"><div class="wb-page__inner">
    <PageHeader eyebrow="教学资源 / 数学周末课" title="我的考法库" description="找题讲课去「考点工作台」；系统归纳的讲法建议在「考法库」，确认后才收录。"><template #actions><ActionButton v-if="activeLine==='kaofa'" :loading="organizing" @click="runOrganize"><el-icon><Refresh /></el-icon>整理本周考法</ActionButton></template></PageHeader>

    <!-- 两条业务线，不是四个平级视图（r218）：
         ① 考点工作台 = 选题线（选考点 → 看共现 → 拉题 → 进课件）
         ② 考法库     = 沉淀线（待确认 / 已确认），是上一条线的「结果」不是并列入口 -->
    <nav class="line-switch" aria-label="业务线切换">
      <button type="button" title="备课找题、拉题、送进周末班课件（日常走这条线）" :class="['line-tab',{active:activeLine==='kp'}]" @click="setLine('kp')"><el-icon><Share /></el-icon>考点工作台</button>
      <button type="button" title="系统从错题归纳的讲法建议，确认后长期复用（不着急，有空再挑）" :class="['line-tab',{active:activeLine==='kaofa'}]" @click="setLine('kaofa')"><el-icon><Collection /></el-icon>考法库<template v-if="summary.recommendation_count"> · {{ summary.recommendation_count }} 待确认</template></button>
    </nav>
    <!-- r222 体验优化：两条线各配一句人话说明 —— 老师不需要记「考点 vs 考法」的概念，只要知道自己要干什么 → 走哪条线 -->
    <p class="line-hint"><template v-if="activeLine==='kp'">备课找题就走这条线：选一个考点 → 看它和谁常一起考 → 把题送进周末班课件。</template><template v-else>系统从错题里归纳的「讲法」——一批题都在考同一个动作。认可就点「确认收录」，不急，有空再挑。</template></p>

    <!-- 统计条：只在真有数据时给数字，0 写「暂无」，不摆三个孤零零的 0（r218） -->
    <section v-if="activeLine==='kaofa'" class="library-stats">
      <button type="button" class="library-stat" :class="{primary:subMode==='recommended'}" @click="setSubMode('recommended')"><span>待你确认</span><strong>{{ summary.recommendation_count || '暂无' }}</strong><small>系统按近期错题整理 · 点此查看</small></button>
      <button type="button" class="library-stat" :class="{primary:subMode==='library'}" @click="setSubMode('library')"><span>已沉淀考法</span><strong>{{ summary.type_count || '暂无' }}</strong><small>覆盖 {{ summary.knowledge_count || 0 }} 个知识点</small></button>
      <div class="library-stat"><span>本周维护</span><strong>{{ summary.updated_this_week || '暂无' }}</strong><small>本周确认或更新的考法</small></div>
    </section>

    <!-- ═══ 业务线① 考点工作台 ═══ -->
    <template v-if="activeLine==='kp'">
      <FilterBar class="type-filter" v-if="selectedKpId">
        <template #leading><div class="result-context"><strong>{{ activeKpName }} 的题目</strong><span>{{ kpResultText }}</span></div></template>
        <WorkbenchInput v-model="kpKeyword" clearable placeholder="搜考点，如「相似」" width="220px" aria-label="搜索考点" />
        <el-checkbox v-model="onlyWrong" @change="loadKpQuestions">只看有人错过的题</el-checkbox>
        <template #actions><el-button text @click="clearKp">换个考点</el-button></template>
      </FilterBar>

      <!-- 考点选择器：按近 14 天错题量排序（r218 替代 521 项平铺下拉）。
           实测 521 个节点里只有 151 个（29%）近期有错题，其余 370 个是死选项。 -->
      <div v-if="!selectedKpId" class="kp-picker">
        <div class="picker-head">
          <strong>从哪儿开始讲？</strong>
          <span>按近 {{ kpDays }} 天错题量排序，最该讲的排在最前。{{ kpStats.withWrong || 0 }} 个考点近期有错题<template v-if="kpStats.deadOptions">，其余 {{ kpStats.deadOptions }} 个暂未涉及（搜名字可查到）。</template></span>
        </div>
        <el-input v-model="kpSearch" clearable placeholder="搜考点名称" class="picker-search" aria-label="搜索考点">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <div class="picker-list" v-loading="kpRankLoading">
          <EmptyState v-if="!kpPickerNodes.length&&!kpRankLoading" :icon="Collection" title="没有匹配的考点" description="换个关键词试试，或等本周错题关联完成后再来。" compact />
          <button v-for="kp in kpPickerNodes" :key="kp.id" type="button" class="picker-row" @click="pickKp(kp.id)">
            <span class="picker-name"><span class="picker-level">{{ kp.level === 0 ? '板块' : '考点' }}</span>{{ kp.name }}</span>
            <span class="picker-metric"><strong>{{ kp.wrongCount }}</strong><small>近 {{ kpDays }} 天错题</small></span>
          </button>
        </div>
      </div>

      <main v-else class="kp-workspace">
        <ContentCard class="cooccur-card" :title="`${activeKpName} · 常一起错的考点`" :description="cooccurSummaryText" flush>
          <div v-if="cooccurLoading" class="list-loading"><el-skeleton animated :rows="3" /></div>
          <EmptyState v-else-if="!cooccurNodes.length" :icon="Share" title="这个考点还很独立" description="没有别的考点跟它在同一批题里出现过。直接用下面的题目清单也行。" compact />
          <div v-else class="cooccur-body">
            <VChart class="cooccur-chart" :option="cooccurOption" autoresize @click="onCooccurClick" />
            <div class="cooccur-peers"><p class="peers-hint">点一下切过去，这两个考点可以一起讲</p><button v-for="n in cooccurPeers" :key="n.id" type="button" :class="['cooccur-peer',{inScope:n.in_scope}]" @click="jumpToKp(n.id)"><strong>{{ n.name }}</strong><small>共现 {{ n.cooccur }} 道题<template v-if="n.own_count"> · 自身 {{ n.own_count }}</template></small></button></div>
          </div>
        </ContentCard>

        <ContentCard class="question-card" :title="`${activeKpName} · 题目清单`" :description="kpSummaryText" flush>
          <div v-if="kpLoading" class="list-loading"><el-skeleton v-for="index in 5" :key="index" animated :rows="2" /></div>
          <EmptyState v-else-if="!kpQuestions.length" :icon="Collection" title="这个考点还没有关联题目" :description="onlyWrong ? '取消「只看有人错过的题」可以看到全部关联题目。' : '题目还没关联到这个考点。'" compact />
          <div v-else class="type-list">
            <button v-for="q in kpQuestions" :key="q.questionId" type="button" :class="['type-row',{active:kpActiveId===q.questionId}]" @click="kpActiveId=q.questionId">
              <span class="row-main"><strong>{{ q.wrongCount ? `${q.wrongCount} 次错 · ${q.studentCount} 人` : '暂无错次' }}</strong><small>{{ (q.content||'(无题干)').replace(/\s+/g,' ').slice(0,80) }}</small></span>
              <span class="row-evidence" v-if="q.students?.length">{{ q.students.slice(0,3).join('、') }}{{ q.students.length>3?` 等${q.students.length}人`:`` }}</span>
              <el-icon><ArrowRight /></el-icon>
            </button>
            <!-- ⛔ r218 铁律 12：截断必须显式说，不能静默丢（实测「实数」435 道只返回 120） -->
            <div v-if="kpScope?.truncated" class="truncation-note"><el-icon><Warning /></el-icon><span>共 {{ kpScope.totalMatched }} 道题，已按错次排序显示前 {{ kpScope.limit }} 道，还有 <strong>{{ kpScope.totalMatched - kpQuestions.length }}</strong> 道未显示。</span><el-button text size="small" @click="expandLimit">显示更多</el-button></div>
          </div>
        </ContentCard>

        <ContentCard class="type-inspector" title="题目详情" :description="activeKpQuestion ? (activeKpQuestion.kps||[]).map(k=>k.name).join(' · ') || '关联考点' : '选一道题看完整题干、答案和谁错过'" flush>
          <EmptyState v-if="!activeKpQuestion" :icon="Reading" title="选一道题" description="左边点任意题目，这里显示完整题干、答案与错过的学生。" compact />
          <article v-else class="type-detail">
            <div class="detail-heading"><div><div class="knowledge-label">{{ activeKpQuestion.subject || '数学' }} · {{ activeKpQuestion.difficulty ? `难度 ${activeKpQuestion.difficulty}` : '难度未判定' }}</div><h2>{{ activeKpQuestion.wrongCount ? `${activeKpQuestion.wrongCount} 次错 · ${activeKpQuestion.studentCount} 人` : '暂无错次' }}</h2></div></div>
            <section class="detail-section"><h3>题干</h3><p class="kp-content">{{ activeKpQuestion.content || '题目内容不可用' }}</p></section>
            <section class="detail-section" v-if="activeKpQuestion.options"><h3>选项</h3><p class="kp-content">{{ formatOptions(activeKpQuestion.options) }}</p></section>
            <section class="detail-section" v-if="activeKpQuestion.answer"><h3>参考答案</h3><p class="kp-content">{{ activeKpQuestion.answer }}</p></section>
            <section class="detail-section" v-if="activeKpQuestion.students?.length"><h3>错过的学生</h3><p>{{ activeKpQuestion.students.join('、') }}</p></section>
          </article>
        </ContentCard>

        <!-- 出口常驻主区底部（r218）：原来藏在详情面板里，要点两层才找到 -->
        <div class="kp-actions-bar"><ActionButton variant="primary" @click="sendKpToWeekend"><el-icon><Promotion /></el-icon>把「{{ activeKpName }}」的题送进周末班课件</ActionButton><span class="exit-hint">共 {{ kpScope?.totalMatched ?? 0 }} 道，按错次排序</span></div>
      </main>
    </template>

    <!-- ═══ 业务线② 考法库（待确认 / 已确认） ═══ -->
    <template v-else>
      <FilterBar class="type-filter">
        <template #leading><div class="result-context"><strong>{{ subMode === 'recommended' ? '待你确认' : '已沉淀考法' }}</strong><span>{{ types.length }} 个</span></div></template>
        <WorkbenchInput v-model="keyword" clearable placeholder="搜索考法或讲法" width="240px" aria-label="搜索考法或讲法" @input="debouncedLoad"><template #prefix><el-icon><Search /></el-icon></template></WorkbenchInput>
        <template #actions><el-button text @click="startCreate"><el-icon><Plus /></el-icon>手动补充</el-button></template>
      </FilterBar>

      <main class="library-workspace">
        <ContentCard class="type-list-card" :title="subMode === 'recommended' ? '系统整理的考法建议' : '已沉淀的考法'" :description="subMode === 'recommended' ? '按近期多人出错程度排序，认可就确认收录' : '长期可复用的教学考法'" flush>
          <div v-if="loading" class="list-loading"><el-skeleton v-for="index in 5" :key="index" animated :rows="2" /></div>
          <EmptyState v-else-if="!types.length" :icon="subMode === 'recommended' ? CircleCheck : Collection" :title="subMode === 'recommended' ? '本周没有待确认考法' : '还没有已确认考法'" :description="subMode === 'recommended' ? '点右上角「整理本周考法」，系统会先预演给你看，满意再写入。' : '先确认系统整理的考法，或手动补充一个。'">
            <template #actions><ActionButton v-if="subMode === 'recommended'" @click="runOrganize">整理本周考法</ActionButton><ActionButton v-else variant="primary" @click="startCreate">手动补充考法</ActionButton></template>
          </EmptyState>
          <div v-else class="type-list"><button v-for="item in types" :key="item.id" type="button" :class="['type-row',{active:selectedId===item.id}]" @click="selectType(item.id)"><span class="row-main"><strong>{{ item.name }}</strong><small>{{ item.knowledge_name }} · {{ item.action ? item.action : '' }}</small></span><span class="row-evidence">{{ item.example_count }} 道题<template v-if="item.wrong_students"> · {{ item.wrong_students }} 人错过</template></span><el-icon><ArrowRight /></el-icon></button></div>
        </ContentCard>
        <ContentCard class="type-inspector" title="考法详情" :description="selectedType ? `${selectedType.knowledge_name} · ${selectedType.status === 'draft' ? '系统建议，等待确认' : '已确认教学资产'}` : '选一个考法，看它归纳了哪些题'" flush>
          <div v-if="detailLoading" class="detail-loading"><el-skeleton animated :rows="10" /></div>
          <EmptyState v-else-if="!selectedType" :icon="Reading" title="选一个考法" description="左边选一个考法，这里显示它的动作、步骤和归纳出的整组题。" compact />
          <article v-else class="type-detail">
            <div class="detail-heading"><div><div class="knowledge-label">{{ selectedType.knowledge_name }}</div><h2>{{ selectedType.name }}</h2></div><el-dropdown @command="handleDetailAction"><el-button text aria-label="考法操作"><el-icon><MoreFilled /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">编辑考法</el-dropdown-item><el-dropdown-item command="ignore" v-if="selectedType.status==='draft'" divided>忽略本次建议</el-dropdown-item><el-dropdown-item command="archive" v-else divided>归档考法</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
            <!-- 一句话说清「这是哪一类题」：这是「让学生看出都是考一个东西」的关键 -->
            <div v-if="selectedType.action" class="method-pitch"><strong>这类题</strong><span>都在考同一个动作：{{ selectedType.action }}</span></div>
            <div v-if="selectedType.kps?.length" class="detail-tags"><span class="tag-label">关联考点</span><el-tag v-for="k in selectedType.kps" :key="k.id" size="small" :type="k.role==='primary'?'primary':'info'">{{ k.name }}</el-tag></div>
            <section class="detail-section" v-if="selectedType.teaching_notes"><h3>怎么讲</h3><p>{{selectedType.teaching_notes}}</p></section>
            <section class="detail-section" v-if="selectedType.common_mistakes"><h3>易错提醒</h3><p>{{selectedType.common_mistakes}}</p></section>
            <!-- 整组题：这就是「把很多题目放在一个知识点下」的核心交付 -->
            <section class="detail-section examples">
              <div class="section-heading"><h3>这类题 · {{ selectedType.examples?.length || 0 }} 道</h3><span v-if="selectedType.examples?.length">同一套动作，不同数字</span></div>
              <EmptyState v-if="!selectedType.examples?.length" :icon="Collection" title="这个考法还没关联题目" description="重新整理一次，或手动编辑考法挂上题目。" compact />
              <article v-for="(example,i) in selectedType.examples" :key="example.id" class="example-card">
                <div class="example-idx">{{ i + 1 }}</div>
                <div class="example-body">
                  <div class="example-content">{{example.snapshot?.content || '题目内容快照不可用'}}</div>
                  <div class="example-meta"><span v-if="example.snapshot?.questionType">{{typeLabel(example.snapshot.questionType)}}</span><span v-if="example.snapshot?.wrongCount">{{example.snapshot.wrongCount}} 人错过</span><el-button v-if="example.sourceQuestionId" text size="small" :loading="variantLoadingId===example.id" @click="generateVariants(example)">生成变式</el-button></div>
                </div>
              </article>
            </section>
            <div class="detail-actions" v-if="selectedType.status==='draft'"><el-button @click="editSelected">先改名字</el-button><el-button type="primary" :loading="confirming" @click="confirmType">确认收录</el-button></div>
          </article>
        </ContentCard>
      </main>
    </template>

    <!-- 整理考法的**预演结果**抽屉（r218 铁律 9）：
         旧实现把 results/rejected/errors 全丢掉、只弹一句「已更新」，老师既不知道整理出了什么，
         也不知道「写库」这一步要不要点。改成先看预演、再决定写不写。 -->
    <el-drawer v-model="organizeVisible" title="整理本周考法" size="min(620px,100%)" destroy-on-close>
      <div v-if="organizeReport" class="organize-report">
        <div class="organize-status">
          <strong>{{ organizeReport.applied ? '已写入草稿' : '这是预演结果，还没写入' }}</strong>
          <span>{{ organizeReport.applied ? `整理了 ${organizeReport.targets} 个考点，新增 ${organizeReport.created} 条待确认考法。` : `整理了 ${organizeReport.targets} 个考点，可新增 ${organizeReport.created} 条考法。看完满意再点「确认写入」。` }}</span>
        </div>
        <EmptyState v-if="!organizeReport.results?.length" :icon="Collection" title="没有可整理的考点" :description="`近 ${organizeReport.days || 14} 天没有错题量达到门槛的考点。`" compact />
        <section v-for="r in organizeReport.results" :key="r.kpId" class="organize-kp">
          <div class="organize-kp-head"><strong>{{ r.kpName }}</strong><small>{{ r.questionCount }} 道错题素材 · {{ r.elapsedMs }}ms<template v-if="r.vendor"> · {{ r.vendor }}</template></small></div>
          <!-- ⭐ r221 进度：跑批要好几分钟，老师必须看得见「跑到第几批/ 还剩多少」 -->
          <div v-if="r.progress" class="organize-progress">
            <div class="progress-line"><span>已跑 {{ r.progress.batchesRun }} 批 · 本次处理 {{ r.progress.processedThisRun }} 道</span><strong>{{ r.progress.remainingAfter === 0 ? '这个考点已全部分类完毕' : `还剩 ${r.progress.remainingAfter} 道未归类` }}</strong></div>
            <div class="progress-track"><div class="progress-fill" :style="{width: progressPercent(r.progress)}"></div></div>
            <ul v-if="r.progress.detail?.length" class="batch-list"><li v-for="b in r.progress.detail" :key="b.batch"><span>第 {{ b.batch }} 批</span><span>{{ b.questionCount }} 题 → {{ b.methods }} 个考法<template v-if="b.reusedExisting">（复用已有 {{ b.reusedExisting }} 个）</template></span><span v-if="b.error" class="batch-err">失败：{{ b.error }}</span><span v-else>{{ (b.elapsedMs/1000).toFixed(1) }}s</span></li></ul>
          </div>
          <div v-if="r.reason" class="organize-note">{{ r.reason }}</div>
          <ul v-if="r.methods?.length" class="organize-methods"><li v-for="m in r.methods" :key="m.name"><strong>{{ m.name }}</strong><small>{{ m.items }} 道题<template v-if="m.kps?.length"> · 挂 {{ m.kps.join('、') }}</template><template v-if="m.saved"> · 已入库</template></small></li></ul>
          <div v-if="r.rejected?.length" class="organize-rejected"><small>被质量闸拒掉 {{ r.rejected.length }} 条：</small><span v-for="(x,i) in r.rejected" :key="i">{{ x.name }} —— {{ x.reason }}</span></div>
          <div v-if="r.unmatchedKpNames?.length" class="organize-rejected"><small>有 {{ r.unmatchedKpNames.length }} 个关联考点没能挂进知识树（题库里没有同名考点）：</small><span>{{ r.unmatchedKpNames.join('、') }}</span></div>
        </section>
        <section v-if="organizeReport.errors?.length" class="organize-errors"><strong>失败 {{ organizeReport.errors.length }} 个</strong><span v-for="(e,i) in organizeReport.errors" :key="i">{{ e.kpName }}：{{ e.error }}</span></section>
      </div>
      <template #footer><div class="drawer-actions"><el-button @click="organizeVisible=false">关闭</el-button><el-button v-if="organizeReport&&!organizeReport.applied&&organizeReport.created>0" type="primary" :loading="applying" @click="applyOrganize">确认写入 {{ organizeReport.created }} 条</el-button></div></template>
    </el-drawer>

    <el-drawer v-model="editorVisible" :title="editingId ? '编辑考法' : '手动补充考法'" size="min(520px,100%)" destroy-on-close>
      <el-form label-position="top" :model="editor"><el-form-item label="主知识点" required><WorkbenchSelect v-model="editor.kpId" :options="editorKpOptions" :filterable="true" placeholder="选择主知识点" aria-label="选择主知识点" /></el-form-item><el-form-item label="考法名称" required><WorkbenchInput v-model="editor.name" :maxlength="60" show-word-limit placeholder="如：先证直角再求边" aria-label="考法名称" /></el-form-item><el-form-item label="课堂讲法"><WorkbenchInput v-model="editor.teachingNotes" type="textarea" :rows="5" placeholder="记录课堂讲法，便于复用" aria-label="课堂讲法" /></el-form-item><el-form-item label="易错提醒"><WorkbenchInput v-model="editor.commonMistakes" type="textarea" :rows="3" placeholder="学生常见错误与应对" aria-label="易错提醒" /></el-form-item><el-form-item label="教学标签"><el-select v-model="editor.tags" multiple filterable allow-create class="wb-select" style="width:100%" placeholder="输入后回车添加" aria-label="教学标签" /></el-form-item></el-form>
      <template #footer><div class="drawer-actions"><el-button @click="editorVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveType">保存</el-button></div></template>
    </el-drawer>
  </div></div>
</template>

<script setup>
import {computed,onMounted,ref,watch} from 'vue'
import {useRoute,useRouter} from 'vue-router'
import {ElMessage,ElMessageBox} from 'element-plus'
import {ArrowRight,CircleCheck,Collection,MoreFilled,Plus,Promotion,Reading,Refresh,Search,Share,Warning} from '@element-plus/icons-vue'
// 聚焦网状图用 echarts graph 力导向布局 —— echarts 6.1.0 + vue-echarts 8.0.1 已在依赖里
// （工作台 DashboardWorkbench / TrendLineChart 已在用），不需要新装包。
import {use} from 'echarts/core'
import {GraphChart} from 'echarts/charts'
import {TooltipComponent} from 'echarts/components'
import {CanvasRenderer} from 'echarts/renderers'
import VChart from 'vue-echarts'
import {apiRequest,getKnowledgeTree} from '../../services/apiService'
use([GraphChart,TooltipComponent,CanvasRenderer])
import ActionButton from '../components/ui/ActionButton.vue'; import ContentCard from '../components/ui/ContentCard.vue'; import EmptyState from '../components/ui/EmptyState.vue'; import FilterBar from '../components/ui/FilterBar.vue'; import PageHeader from '../components/ui/PageHeader.vue'; import WorkbenchInput from '../components/ui/WorkbenchInput.vue'; import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'

const route=useRoute(), router=useRouter()
// r218：activeMode 四值（graph/recommended/library/knowledge）→ activeLine 两值 + subMode 两值。
// 旧结构里「关系图」与「按考点选题」共用同一份 cooccurOption + kpQuestions，只是布局不同，
// 是纯重复代码，也是「布局很奇怪」的直接来源。现在合成一条「考点工作台」线。
const activeLine=ref('kp'), subMode=ref('recommended')
const types=ref([]),summary=ref({}),tree=ref([])
const selectedKpId=ref(''), kpSearch=ref(''), kpDays=ref(14), kpLimit=ref(120)
const kpRank=ref([]), kpRankLoading=ref(false), kpStats=ref({})
const selectedId=ref(null), selectedType=ref(null), keyword=ref('')
const onlyWrong=ref(false), loading=ref(false), detailLoading=ref(false), organizing=ref(false), applying=ref(false)
const confirming=ref(false), saving=ref(false), variantLoadingId=ref(null)
const editorVisible=ref(false), editingId=ref(null), organizeVisible=ref(false), organizeReport=ref(null)
const kpQuestions=ref([]), kpLoading=ref(false), kpActiveId=ref(null), kpScope=ref(null)
const cooccurNodes=ref([]), cooccurLinks=ref([]), cooccurLoading=ref(false)

const flatten=(nodes,out=[])=>{for(const node of nodes||[]){out.push(node);flatten(node.children,out)}return out}
const flatKnowledge=computed(()=>flatten(tree.value))
const editorKpOptions=computed(()=>flatKnowledge.value.map(kp=>({label:'　'.repeat(kp.level||0)+kp.name,value:kp.id})))
const activeKpName=computed(()=>{const hit=flatKnowledge.value.find(k=>k.id===selectedKpId.value);return hit?hit.name:''})
const activeKpQuestion=computed(()=>kpQuestions.value.find(q=>q.questionId===kpActiveId.value)||null)

// ── 考点选择器：按近 N 天错题量排序（r218）
// 旧实现把 521 个节点平铺进 el-select、用全角空格表示层级。实测只有 151 个（29%）在近 14 天有错题，
// 其余 370 个是死选项 —— 老师要翻两屏才找到自己真错过的地方，"没考过的考点"对他毫无意义。
// 现在默认只列有错题的（按错题量 DESC），搜名字仍能查到全部 521 个。
const kpPickerNodes=computed(()=>{
  const kw=(kpSearch.value||'').trim().toLowerCase()
  const hit=kw?kpRank.value.filter(k=>k.name.toLowerCase().includes(kw)):kpRank.value.filter(k=>k.wrong_count>0)
  return hit.map(k=>({id:k.id,name:k.name,level:k.level,wrongCount:k.wrong_count}))
})
const kpSummaryText=computed(()=>{if(!selectedKpId.value)return'先选一个考点';const s=kpScope.value;return `${s?.expandedNodes||1} 个节点 · ${kpQuestions.value.length} 道题`})
const kpResultText=computed(()=>{if(!selectedKpId.value)return `${kpStats.withWrong||0} 个考点近期有错题`;const s=kpScope.value;if(!s)return'加载中…';return s.truncated?`共 ${s.totalMatched} 道，已显示前 ${kpQuestions.length} 道`:`${s.totalMatched} 道题`})

// ── 整理考法（r218 铁律 9：显式传 apply，默认预演且如实展示）
// ⛔ r218 修掉的真事故：旧 autoOrganize() 只传 {days:14}，**不传 apply**。后端 apply 默认 false
//   ⇒ dryRun=true ⇒ AI 跑完 27-48s 结果直接丢弃、created=0，但前端无条件 activeMode='recommended'
//   + 弹「已更新」⇒ 老师点了只会更确信这功能没用（实测 teaching_question_types至今 0 条）。
//   现在：apply=false 走预演并把 results/rejected/errors 全部摊开；写入必须再点一次确认。
async function runOrganize(){organizing.value=true;try{
  const data=await apiRequest('/teaching-question-types/auto-organize',{method:'POST',body:JSON.stringify({days:14,apply:false})})
  organizeReport.value={...data,days:14};organizeVisible.value=true
  await loadSummary()
}catch(error){ElMessage.error(/404/.test(String(error.message))?'考法库后端尚未更新，请在 Render 重新部署最新 main 后重试':(error.message||'整理失败'))}finally{organizing.value=false}}
async function applyOrganize(){applying.value=true;try{
  const data=await apiRequest('/teaching-question-types/auto-organize',{method:'POST',body:JSON.stringify({days:14,apply:true})})
  organizeReport.value={...data,applied:true,days:14}
  ElMessage.success(`已写入 ${data.created} 条待确认考法`)
  activeLine.value='kaofa';subMode.value='recommended';selectedId.value=null;selectedType.value=null
  await Promise.all([loadSummary(),loadTypes()]);syncUrl()
}catch(error){ElMessage.error(error.message||'写入失败')}finally{applying.value=false}}

function setLine(line){activeLine.value=line;syncUrl();if(line==='kaofa'&&!types.value.length)loadTypes()}
function setSubMode(mode){activeLine.value='kaofa';subMode.value=mode;selectedId.value=null;selectedType.value=null;loadTypes();syncUrl()}
function pickKp(id){selectedKpId.value=id;loadKpWorkbench();syncUrl()}
function jumpToKp(id){if(!id)return;selectedKpId.value=id;loadKpQuestions();syncUrl()}
function clearKp(){selectedKpId.value='';kpQuestions.value=[];kpScope.value=null;cooccurNodes.value=[];cooccurLinks.value=[];kpActiveId.value=null;syncUrl()}

let timer;const debouncedLoad=()=>{clearTimeout(timer);timer=setTimeout(loadTypes,250)}
async function loadTypes(){loading.value=true;try{const params=new URLSearchParams({mode:subMode.value});if(selectedKpId.value)params.set('kpId',selectedKpId.value);if(keyword.value)params.set('keyword',keyword.value);const data=await apiRequest(`/teaching-question-types?${params}`);types.value=data.types||[];if(selectedId.value&&!types.value.some(item=>item.id===selectedId.value)){selectedId.value=null;selectedType.value=null}}catch(error){ElMessage.error(error.message||'加载考法失败')}finally{loading.value=false}}
async function loadSummary(){const data=await apiRequest('/teaching-question-types/summary');summary.value=data.summary||{}}
async function loadKpRank(){kpRankLoading.value=true;try{const data=await apiRequest(`/teaching-question-types/kp-ranking?days=${kpDays.value}`);kpRank.value=data.nodes||[];kpStats.value=data.stats||{}}catch(error){console.warn('考点排序加载失败',error.message||error)}finally{kpRankLoading.value=false}}
async function loadKpWorkbench(){await Promise.all([loadKpQuestions(),loadKpTypes()])}
async function loadKpTypes(){if(!selectedKpId.value){types.value=[];return}try{const p=new URLSearchParams();p.set('kpId',selectedKpId.value);const data=await apiRequest(`/teaching-question-types?${p}`);types.value=data.types||[]}catch(error){console.warn('考点考法加载失败',error.message||error)}}
async function loadKpQuestions(){if(!selectedKpId.value){kpQuestions.value=[];kpScope.value=null;return}kpLoading.value=true;kpActiveId.value=null;try{const p=new URLSearchParams({kpId:selectedKpId.value,includeChildren:'1',onlyWrong:onlyWrong.value?'1':'0',limit:String(kpLimit.value)});const data=await apiRequest(`/teaching-question-types/kp-questions?${p}`);kpQuestions.value=data.questions||[];kpScope.value=data.scope||null;if(kpQuestions.value.length)kpActiveId.value=kpQuestions.value[0].questionId}catch(error){ElMessage.error(error.message||'加载考点题目失败')}finally{kpLoading.value=false;loadCooccur()}}
// 后端 limit 上限 300（kp-questions: Math.min(..., 300)），到顶就别再假装能加载更多
function expandLimit(){if(kpLimit.value>=300){ElMessage.info('单次最多显示 300 道。可以缩小考点范围，或勾「只看有人错过的题」');return}kpLimit.value=Math.min(kpLimit.value*2,300);loadKpQuestions()}
function sendKpToWeekend(){if(!selectedKpId.value)return ElMessage.warning('先选一个考点');router.push({path:'/weekend-ppt',query:{kpIds:selectedKpId.value}})}

// ── 共现聚焦图 ──
// 为什么是「聚焦 9 个点」而不是整张网：实测全量共现 3091 边 / 521 节点，摊开是毛线球。
// 每个邻居都从当前考点连出来、且带真实共现题数 ⇒ 每条边都回答得了「为什么该连它」。
const COOCUR_LIMIT=8
const cooccurPeers=computed(()=>cooccurNodes.value.filter(n=>!n.is_center))
const cooccurSummaryText=computed(()=>{if(!selectedKpId.value)return'选一个考点展开它的共现邻居';const peers=cooccurPeers.value;if(!peers.length)return'暂无可展开的邻居';return `${activeKpName.value} 自身 ${cooccurNodes.value.find(n=>n.is_center)?.own_count||0} 题 · 与 ${peers.length} 个考点同题共现`})
// 节点大小按共现强度开方缩放（线性会让 332 的一根柱子把其余全压成看不见）
// ⛔ r145 实测修：中心原本**硬编码 34**，邻居走 `12+26*√(w/maxW)`，上限 38。
//   平方根自身 353 题、邻居「平方」共现也是 353 ⇒ 邻居半径 38.0 > 中心 34，主次颠倒。
//   修法：中心也走同一套公式（own_count 参与 maxW），再乘 1.2 系数 + 半径下限 30。
const cooccurOption=computed(()=>{const nodes=cooccurNodes.value;if(!nodes.length)return{};const weightOf=n=>Math.max(Number(n.is_center?n.own_count:n.cooccur)||0,0);const maxW=Math.max(...nodes.map(weightOf),1);const radius=n=>{const base=12+26*Math.sqrt(weightOf(n)/maxW);return n.is_center?Math.max(Math.round(base*1.2),30):base};return{animationDuration:420,tooltip:{trigger:'item',formatter:p=>p.data?.raw||p.name},series:[{type:'graph',layout:'force',roam:false,draggable:true,force:{repulsion:340,edgeLength:[70,150],gravity:0.12},label:{show:true,position:'bottom',fontSize:11,color:'var(--wb-text-secondary)',formatter:p=>p.name},labelLayout:{hideOverlap:true},lineStyle:{color:'#b4b2a9',width:1,curveness:0.12,opacity:0.7},emphasis:{focus:'adjacency',lineStyle:{width:2.5}},data:nodes.map(n=>({id:n.id,name:n.name,raw:`${n.name}｜共现 ${n.cooccur} 道题｜自身 ${n.own_count} 题`,symbolSize:radius(n),itemStyle:n.is_center?{color:'#7f77dd',borderColor:'#3c3489',borderWidth:1}:{color:n.in_scope?'#afa9ec':'#d3d1c7',borderColor:'#888780',borderWidth:0.5},label:{color:n.is_center?'#3c3489':'var(--wb-text-secondary)',fontWeight:n.is_center?600:400}})),links:cooccurLinks.value.map(l=>({...l,lineStyle:{width:1+2*Math.sqrt(l.value/Math.max(...cooccurLinks.value.map(x=>x.value),1))}}))}]}})
function onCooccurClick(params){const hit=cooccurNodes.value.find(n=>n.id===params?.data?.id||n.name===params?.name);if(hit&&!hit.is_center)jumpToKp(hit.id)}
async function loadCooccur(){if(!selectedKpId.value){cooccurNodes.value=[];cooccurLinks.value=[];return}cooccurLoading.value=true;try{const p=new URLSearchParams({kpId:selectedKpId.value,limit:String(COOCUR_LIMIT)});const data=await apiRequest(`/teaching-question-types/kp-cooccur?${p}`);cooccurNodes.value=data.graph?.nodes||[];cooccurLinks.value=data.graph?.links||[]}catch(error){cooccurNodes.value=[];cooccurLinks.value=[];console.warn('共现图加载失败',error.message||error)}finally{cooccurLoading.value=false}}
function formatOptions(raw){if(!raw)return '';if(typeof raw==='string')return raw;try{const arr=Array.isArray(raw)?raw:JSON.parse(raw);return (arr||[]).map(o=>typeof o==='string'?o:(o.label||o.text||o.value||'')).filter(Boolean).join('  ')}catch(e){return String(raw)}}
// ⛔ 别把 questions.question_type 的枚举值直接甩给老师看（记忆铁律：技术状态要翻译）。
//   它是「题目形式」，不是考法 —— 显示成「综合题/answer」只会让人困惑。
const TYPE_LABEL={answer:'解答题',fill:'填空题',choice:'选择题',judge:'判断题',proof:'证明题',calc:'计算题',comprehensive:'综合题'}
const typeLabel=(t)=>TYPE_LABEL[t]||'题目'
// r221 进度条百分比：已归类 /（跑前待归类）。分母为 0 时按 0 起算，别出NaN。
function progressPercent(p){
  const total=Number(p?.remainingBefore)||0
  if(!total) return '100%'
  const done=Math.min(Number(p?.coveredTotal)||0,total)
  return Math.round(done/total*100)+'%'
}
async function selectType(id){selectedId.value=id;detailLoading.value=true;try{const data=await apiRequest(`/teaching-question-types/${id}`);selectedType.value=data.type}catch(error){ElMessage.error(error.message||'加载详情失败')}finally{detailLoading.value=false}}
async function confirmType(){confirming.value=true;try{await apiRequest(`/teaching-question-types/${selectedType.value.id}/confirm`,{method:'POST'});ElMessage.success('已收录到考法库');selectedType.value.status='active';await Promise.all([loadTypes(),loadSummary()])}catch(error){ElMessage.error(error.message||'确认失败')}finally{confirming.value=false}}
const blankEditor=()=>({kpId:selectedKpId.value||'',name:'',teachingNotes:'',commonMistakes:'',tags:[]})
const editor=ref(blankEditor())
function startCreate(){editingId.value=null;editor.value=blankEditor();editorVisible.value=true}
function editSelected(){editingId.value=selectedType.value.id;editor.value={kpId:selectedType.value.kp_id,name:selectedType.value.name,teachingNotes:selectedType.value.teaching_notes,commonMistakes:selectedType.value.common_mistakes,tags:selectedType.value.tags||[]};editorVisible.value=true}
async function saveType(){if(!editor.value.kpId||!editor.value.name.trim())return ElMessage.warning('请填写主知识点和考法名称');saving.value=true;try{const payload={kpId:editor.value.kpId,name:editor.value.name,teachingNotes:editor.value.teachingNotes,commonMistakes:editor.value.commonMistakes,tags:editor.value.tags};const data=editingId.value?await apiRequest(`/teaching-question-types/${editingId.value}`,{method:'PUT',body:JSON.stringify(payload)}):await apiRequest('/teaching-question-types',{method:'POST',body:JSON.stringify(payload)});editorVisible.value=false;await Promise.all([loadTypes(),loadSummary()]);await selectType(data.type.id);ElMessage.success('考法已保存')}catch(error){ElMessage.error(error.message||'保存失败')}finally{saving.value=false}}
async function generateVariants(example){variantLoadingId.value=example.id;try{const response=await apiRequest(`/variants/${example.sourceQuestionId}/generate-all`,{method:'POST',body:JSON.stringify({})});ElMessage.success(response.generated?`已生成 ${response.generated} 道变式题`:'变式题已就绪')}catch(error){ElMessage.error(error.message||'生成变式题失败')}finally{variantLoadingId.value=null}}
function handleDetailAction(command){if(command==='edit')return editSelected();const isIgnore=command==='ignore';ElMessageBox.confirm(isIgnore?'忽略后本次自动建议将不再展示。':'归档后考法不再参与自动整理与推荐。',isIgnore?'忽略建议':'归档考法',{type:'warning'}).then(async()=>{await apiRequest(`/teaching-question-types/${selectedType.value.id}${isIgnore?'/ignore':''}`,{method:isIgnore?'POST':'DELETE'});selectedId.value=null;selectedType.value=null;await Promise.all([loadTypes(),loadSummary()]);ElMessage.success(isIgnore?'已忽略本次建议':'考法已归档')}).catch(()=>{})}

// ── URL 同步（r218 补铁律 13：入口参数必须双路生效，mount + watch 都得有）
function syncUrl(){const q={};if(selectedKpId.value)q.kpId=selectedKpId.value;if(activeLine.value==='kaofa'){q.line='kaofa';q.sub=subMode.value}router.replace({path:'/question-bank',query:q})}
function applyRouteQuery(){
  const line=route.query.line==='kaofa'?'kaofa':'kp'
  const sub=route.query.sub==='library'?'library':'recommended'
  const kp=route.query.kpId?String(route.query.kpId):''
  if(line!==activeLine.value)activeLine.value=line
  if(line==='kaofa'&&sub!==subMode.value){subMode.value=sub;loadTypes()}
  if(kp&&kp!==selectedKpId.value){selectedKpId.value=kp;if(activeLine.value==='kp')loadKpWorkbench()}
}
// ⛔ 铁律 13：hash 路由同页改 query 时 onMounted 不再跑 ⇒ 必须 watch，
//   否则从 Dashboard 连点第二个薄弱知识点进同一页时，参数静默失效。
watch(()=>[route.query.kpId,route.query.line,route.query.sub],applyRouteQuery)

onMounted(async()=>{
  applyRouteQuery()
  try{tree.value=await getKnowledgeTree('数学')}catch{ElMessage.warning('知识点目录加载失败')}
  await loadKpRank()
  // ⛔ r218：**移除**了 r145 加的 `autoOrganize(true)` 静默预演。它每次开页面都白跑一次
  //   AI 归纳（5 考点 × 27-48s、还要花钱），却因为不传 apply 而永远写不了库。
  //   整理改为右上角显式点击：先看预演，再决定写不写。
  if(activeLine.value==='kaofa'){await loadTypes();await loadSummary()}
  else if(selectedKpId.value)await loadKpWorkbench()
  else await loadSummary()   // 默认停在考点选择器：让老师先选「从哪儿开始讲」，不自动替他选
})
</script>

<style scoped>
.type-library{min-height:100%;background:var(--wb-bg)}
/* 两条业务线切换（r218：4 个平级模式 → 2 条线；r222 每条线配一句人话说明） */
.line-switch{display:flex;gap:8px;margin-bottom:8px}
.line-hint{margin:0 0 16px;color:var(--wb-text-tertiary);font-size:12px;line-height:1.6}
.line-tab{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--wb-border);border-radius:8px;background:var(--wb-bg-card);color:var(--wb-text-secondary);font-size:13px;cursor:pointer}
.line-tab:hover{border-color:var(--wb-primary);color:var(--wb-primary)}
.line-tab.active{border-color:var(--wb-primary);background:var(--wb-primary-soft);color:var(--wb-primary);font-weight:600}
/* 统计条 */
.library-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px;border:1px solid var(--wb-border);border-radius:10px;background:var(--wb-bg-card);overflow:hidden}
.library-stat{display:grid;gap:4px;padding:16px 20px;border:0;border-right:1px solid var(--wb-border-light);background:transparent;color:inherit;text-align:left;cursor:pointer}
.library-stat:last-child{border-right:0;cursor:default}
.library-stat:hover:not(:last-child){background:var(--wb-bg-subtle)}
.library-stat.primary{background:var(--wb-primary-soft)}
.library-stat span,.library-stat small{color:var(--wb-text-tertiary);font-size:11px}
.library-stat strong{color:var(--wb-text);font-size:21px}
.library-stat.primary strong{color:var(--wb-primary)}
.result-context{display:grid;gap:2px}
.result-context span{color:var(--wb-text-tertiary);font-size:11px}
/* 考点选择器（r218 替代 521 项平铺下拉） */
.kp-picker{display:grid;gap:14px;padding:20px;border:1px solid var(--wb-border);border-radius:10px;background:var(--wb-bg-card)}
.picker-head{display:grid;gap:4px}
.picker-head strong{font-size:15px;color:var(--wb-text)}
.picker-head span{color:var(--wb-text-tertiary);font-size:12px;line-height:1.6}
.picker-search{max-width:320px}
.picker-list{display:grid;gap:6px;max-height:420px;overflow-y:auto;padding-right:4px}
.picker-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-subtle);color:inherit;text-align:left;cursor:pointer}
.picker-row:hover{border-color:var(--wb-primary);background:var(--wb-primary-soft)}
.picker-name{display:flex;align-items:center;gap:8px;font-size:13px}
.picker-level{padding:2px 6px;border:1px solid var(--wb-border-light);border-radius:4px;background:var(--wb-bg-card);color:var(--wb-text-tertiary);font-size:11px}
.picker-metric{display:flex;align-items:baseline;gap:6px;flex:0 0 auto}
.picker-metric strong{color:var(--wb-primary);font-size:15px}
.picker-metric small{color:var(--wb-text-tertiary);font-size:11px}
/* 考点工作台：图横跨整行，下面左题单右详情（宽屏主区随窗口变宽） */
.kp-workspace{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(360px,.9fr);gap:16px;align-items:start}
.cooccur-card{grid-column:1/-1;min-height:0}
.cooccur-body{display:grid;grid-template-columns:minmax(300px,1.1fr) minmax(220px,.9fr);gap:16px;padding:8px 16px 16px}
.cooccur-chart{width:100%;height:280px}
.cooccur-peers{display:grid;align-content:start;gap:8px;max-height:280px;overflow-y:auto}
.peers-hint{margin:0;color:var(--wb-text-tertiary);font-size:11px;line-height:1.5}
.cooccur-peer{display:grid;gap:2px;padding:9px 12px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-subtle);color:inherit;text-align:left;cursor:pointer}
.cooccur-peer:hover{border-color:var(--wb-primary);background:var(--wb-primary-soft)}
.cooccur-peer.inScope{border-left:3px solid var(--wb-primary)}
.cooccur-peer strong{font-size:13px}
.cooccur-peer small{color:var(--wb-text-tertiary);font-size:11px}
@media (max-width:980px){.kp-workspace{grid-template-columns:1fr}}
@media (max-width:1100px){.cooccur-body{grid-template-columns:1fr}.cooccur-peers{max-height:none}}
/* 截断提示（铁律 12：筛后/截断必须给可行动诊断） */
.truncation-note{display:flex;align-items:center;gap:8px;margin:12px 16px;padding:10px 12px;border:1px solid #f3e2b8;border-radius:8px;background:#fdf8ec;color:#6b5320;font-size:12px;line-height:1.6}
.truncation-note strong{font-weight:600}
.kp-actions-bar{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid var(--wb-border);border-radius:10px;background:var(--wb-bg-card)}
.exit-hint{color:var(--wb-text-tertiary);font-size:12px}
/* 考法库两栏 */
.library-workspace{display:grid;grid-template-columns:minmax(330px,.78fr) minmax(440px,1.22fr);gap:16px}
.type-list-card,.type-inspector{min-height:520px}
.type-list{padding-bottom:8px}
.type-row{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:0;border-bottom:1px solid var(--wb-border-light);background:transparent;color:inherit;text-align:left;cursor:pointer}
.type-row:hover{background:var(--wb-bg-subtle)}
.type-row.active{background:var(--wb-primary-soft);box-shadow:inset 3px 0 var(--wb-primary)}
.row-main{display:grid;min-width:0;flex:1;gap:4px}
.row-main strong{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}
.row-main small,.row-evidence{color:var(--wb-text-tertiary);font-size:11px}
.row-evidence{text-align:right;line-height:1.5;white-space:nowrap}
.list-loading,.detail-loading{display:grid;gap:16px;padding:16px}
.type-detail{padding:18px 20px}
.detail-heading,.section-heading,.detail-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.knowledge-label{margin-bottom:5px;color:var(--wb-primary);font-size:11px;font-weight:650}
.detail-heading h2{margin:0;font-size:21px}
.recommendation{display:grid;gap:4px;margin:16px 0;padding:11px 12px;border:1px solid #dbe4ff;border-radius:8px;color:#42526e;font-size:12px;background:#f7f9ff}
.recommendation strong{color:var(--wb-primary)}
/* ⭐ r220「这类题」一句话 —— 让老师/学生一眼看出「这批题是考一个东西」 */
.method-pitch{display:flex;align-items:baseline;gap:8px;margin:14px 0 4px;padding:12px 14px;border:1px solid var(--wb-border);border-left:3px solid var(--wb-primary);border-radius:8px;background:var(--wb-bg-subtle)}
.method-pitch strong{flex:0 0 auto;color:var(--wb-primary);font-size:12px}
.method-pitch span{color:var(--wb-text);font-size:14px;line-height:1.6}
.tag-label{margin-right:2px;color:var(--wb-text-tertiary);font-size:11px}
.detail-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:14px 0}
/* 整组题：编号 + 题干 + 错次，一眼看清「这一组」 */
.example-card{display:flex;gap:10px;padding:12px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-subtle)}
.example-idx{flex:0 0 auto;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:var(--wb-primary-soft);color:var(--wb-primary);font-size:11px;font-weight:600}
.example-body{min-width:0;flex:1}
.example-body .example-meta{display:flex;align-items:center;gap:12px;margin:8px 0 0;color:var(--wb-text-tertiary);font-size:11px}
.detail-section{padding:17px 0;border-top:1px solid var(--wb-border-light)}
.detail-section h3{margin:0 0 8px;font-size:12px}
.detail-section p{margin:0;color:var(--wb-text-secondary);font-size:13px;line-height:1.75}
.kp-content{white-space:pre-wrap}
.examples{display:grid;gap:10px}
.example-content{display:-webkit-box;overflow:hidden;font-size:13px;line-height:1.6;-webkit-box-orient:vertical;-webkit-line-clamp:3}
.detail-actions{padding-top:18px;border-top:1px solid var(--wb-border-light);align-items:center;justify-content:flex-end}
.drawer-actions{display:flex;justify-content:flex-end;gap:8px}
/* 整理预演结果（r218：results/rejected/errors 不再丢掉） */
.organize-report{display:grid;gap:14px}
.organize-status{display:grid;gap:4px;padding:12px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-subtle)}
.organize-status strong{color:var(--wb-text);font-size:14px}
.organize-status span{color:var(--wb-text-secondary);font-size:12px;line-height:1.6}
.organize-kp{display:grid;gap:8px;padding:12px;border:1px solid var(--wb-border-light);border-radius:8px}
.organize-kp-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.organize-kp-head strong{color:var(--wb-text);font-size:13px}
.organize-kp-head small{color:var(--wb-text-tertiary);font-size:11px}
.organize-note{color:var(--wb-text-secondary);font-size:12px}
/* ⭐ r221 跑批进度：15 分钟的等待必须有进度条，否则老师只能干等 */
.organize-progress{display:grid;gap:8px;padding:10px;border-radius:8px;background:var(--wb-bg-subtle)}
.progress-line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;color:var(--wb-text-secondary)}
.progress-line strong{color:var(--wb-primary);font-weight:500}
.progress-track{height:6px;border-radius:3px;background:var(--wb-bg-card);overflow:hidden;border:0.5px solid var(--wb-border-light)}
.progress-fill{height:100%;border-radius:3px;background:var(--wb-primary);transition:width .3s ease}
.batch-list{display:grid;gap:4px;margin:0;padding:0;list-style:none}
.batch-list li{display:flex;align-items:baseline;gap:10px;font-size:11px;color:var(--wb-text-tertiary)}
.batch-list li span:first-child{flex:0 0 52px;color:var(--wb-text-secondary)}
.batch-list li span:last-child{flex:0 0 auto;margin-left:auto}
.batch-err{color:var(--wb-danger)}
.organize-methods{display:grid;gap:6px;margin:0;padding-left:18px}
.organize-methods li{display:grid;gap:2px}
.organize-methods strong{font-size:13px}
.organize-methods small{color:var(--wb-text-tertiary);font-size:11px}
.organize-rejected,.organize-errors{display:grid;gap:4px;padding:10px;border-radius:8px;font-size:12px;line-height:1.6}
.organize-rejected{background:#fdf8ec;color:#6b5320}
.organize-errors{background:var(--wb-danger-soft);color:var(--wb-danger)}
.organize-errors strong{font-weight:600}
</style>