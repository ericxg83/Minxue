<template>
  <div class="diagnosis-page wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学工作 / 学习诊断"
        title="学习诊断"
        description="发现学生学习问题，判断优先级，并直接安排下一步教学。"
      >
        <template #actions>
          <ActionButton
            :disabled="!selectedStudentId"
            :loading="generating"
            @click="handleGenerateCurrent"
          >导出家长报告</ActionButton>
          <!-- 家长成长卡：第 91 轮从「成长中心」搬来，成长中心下线后它是老师转发给家长的
               唯一图片产出物，r139 再从底部输出条提到页头（与「导出家长报告」并列）。
               ⛔ class 必须挂外层 span：GrowthCardButton 是「按钮 + 弹窗 + Teleport」
                 多根节点组件，Vue 无法透传 class（只在控制台留一条
                 Extraneous non-props attributes 告警），定位样式会静默失效。
                 dataPageMerge.test.mjs 对这两点都有回归锁。 -->
          <span class="header-share-card">
            <GrowthCardButton :student-id="selectedStudentId || ''" :student-name="currentStudentName || ''" :mode="periodMode" :offset="periodOffset" />
          </span>
        </template>
      </PageHeader>

      <FilterBar class="diagnosis-filter">
        <WorkbenchSelect v-model="selectedStudentId" :options="studentOptions" width="180px" aria-label="选择学生" placeholder="选择学生" />
        <el-segmented v-model="periodMode" :options="periodModeOptions" />
        <WorkbenchSelect v-if="periodMode !== 'all'" v-model="periodOffset" :options="offsetOptions" width="120px" aria-label="时间偏移" />
        <template #actions><span class="filter-note">{{ filterNoteText }}</span></template>
      </FilterBar>

      <!-- r135：删除 r133 的学生横排选择器（StudentPicker）。负责人验收反馈「姓名框好多余又丑」，
           核实确实三重冗余：顶栏「选择学生」下拉 + 下方「发现问题」列表（行内含头像/姓名/年级/
           正确率/错题数且可点击进诊断）已完整覆盖选人与横向对比两个诉求，卡片排信息量反而最低。
           选人入口保留：下拉（快）+ 列表行点击（带上下文）。 -->

      <!-- 学习概览 hero（2026-10-04 补回：数据页合并时旧概览面板删除后，数字一览一直缺席；
           与家长分享卡同构，正确率圆环 + 关键 KPI 一眼读数） -->
      <section v-if="!selectedStudentId && reportsWithData.length" class="hero-strip" aria-label="全班学习概览">
        <div class="hero-ring-wrap">
          <div class="hero-ring" :style="heroRingStyle(aggregateStats.accuracy)"><b :class="accuracyTone(aggregateStats.accuracy)">{{ aggregateStats.accuracy }}%</b></div>
          <span class="hero-ring-label">全班整体正确率</span>
        </div>
        <div class="hero-main">
          <div class="hero-caption"><strong>全班概览</strong><span>{{ periodLabel }} · 共 {{ summaryData?.reports?.length || 0 }} 名学生</span></div>
          <div class="hero-kpis">
            <div class="hero-kpi"><b>{{ aggregateStats.studentCount }}</b><span>有数据学生</span></div>
            <div class="hero-kpi"><b>{{ aggregateStats.totalQuestions }}</b><span>批改题量</span></div>
            <div class="hero-kpi"><b class="warn">{{ aggregateStats.newWrongCount }}</b><span>新增错题</span></div>
            <div class="hero-kpi"><b class="good">{{ aggregateStats.securedCount }}</b><span>已记住</span></div>
            <div class="hero-kpi"><b>{{ aggregateStats.notStartedCount }}</b><span>还在攻克</span></div>
          </div>
          <TrophyBar
            :mastered="aggregateStats.masteredCount"
            :basic="aggregateStats.basicMasteredCount"
            :todo="aggregateStats.notStartedCount"
            :practiced="aggregateStats.practicedCount"
          />
        </div>
      </section>

      <section v-if="!selectedStudentId" class="diagnosis-layout">
        <ContentCard class="student-attention" title="发现问题" description="按真实正确率、错题与待重练数量排列需要关注的学生" flush>
          <template #actions><el-checkbox :model-value="allChecked" :indeterminate="isIndeterminate" @change="toggleCheckAll">全选</el-checkbox></template>
          <div v-if="loadingSummary" class="loading-stack"><el-skeleton v-for="index in 5" :key="index" :rows="2" animated /></div>
          <EmptyState
            v-else-if="summaryError"
            :icon="WarningFilled"
            title="学习诊断数据加载失败"
            :description="`${summaryError}。请检查网络后重试 —— 这不代表本周期没有批改数据。`"
          >
            <template #actions>
              <el-button size="small" type="primary" @click="loadSummary">重试</el-button>
            </template>
          </EmptyState>
          <EmptyState v-else-if="!attentionReports.length" title="暂无可诊断的学生数据" description="当前周期还没有已完成的批改数据，可以切换时间范围后重试。" />
          <div v-else class="student-diagnosis-list">
            <article v-for="report in attentionReports" :key="report.student.id" class="student-diagnosis-row" tabindex="0" role="button" :aria-label="`查看${report.student.name}的学习诊断，正确率${hasStats(report) ? `${report.stats.accuracy}%` : '暂无数据'}，${hasStats(report) ? report.stats.newWrongCount : '—'} 道新增错题`" @click="focusStudent(report)" @keydown.enter.prevent="focusStudent(report)" @keydown.space.prevent="focusStudent(report)">
              <el-checkbox :model-value="checkedIds.includes(report.student.id)" @click.stop @change="value => toggleCheck(report.student.id, value)" />
              <el-avatar :size="34">{{ report.student.name?.slice(0, 1) }}</el-avatar>
              <div class="student-identity"><strong>{{ report.student.name }}</strong><small>{{ report.student.grade || '暂无年级' }}</small></div>
              <StatusTag :tone="studentRiskLevel(report).key === 'critical' ? 'danger' : studentRiskLevel(report).key === 'attention' ? 'warning' : studentRiskLevel(report).key === 'error' ? 'danger' : 'success'">{{ studentRiskLevel(report).label }}</StatusTag>
              <div class="student-metrics"><span><b>{{ hasStats(report) ? `${report.stats.accuracy}%` : '—' }}</b>正确率</span><span><b>{{ hasStats(report) ? report.stats.newWrongCount : '—' }}</b>新增错题</span><span><b>{{ hasStats(report) ? securedOf(report.stats) : '—' }}</b>已掌握</span></div>
              <div class="student-next"><span>建议动作</span><strong>{{ studentRiskLevel(report).key === 'error' ? '取数失败，请稍后重试' : !hasStats(report) ? '等待有效学习数据' : studentRiskLevel(report).key === 'critical' ? '优先查看错题并安排重练' : studentRiskLevel(report).key === 'attention' ? '检查薄弱知识点' : '保持观察' }}</strong></div>
              <el-icon class="row-arrow"><ArrowRight /></el-icon>
            </article>
          </div>
        </ContentCard>
      </section>

      <template v-else>
        <!-- r134 布局骨架（按 03-mockup-v2 重做）：左主栏 + 右侧操作栏。
             r133 我把内容全铺成了通栏长条 —— 视觉上像一张Excel 表，
             信息密度上去了但**没有视线的落点**。mockup 的核心是那条竖直分界：
             左边是「诊断」（是什么情况），右边是「行动」（接下来做什么），
             视线自然从左扫到右，形成「看问题 → 找动作」的动线。
             右侧栏固定 372px：动作卡都是短条目，窄栏反而更易扫读。 -->
        <div class="dx">
          <div class="dx__main">

        <!-- 单生学习概览 hero：选中学生后的第一眼数字（与分享卡 hero 同构） -->
        <section v-if="singleHero" class="hero-strip" aria-label="学生学习概览">
          <div class="hero-ring-wrap">
            <div class="hero-ring" :style="heroRingStyle(singleHero.acc)"><b :class="accuracyTone(singleHero.acc)">{{ singleHero.accText }}</b></div>
            <span class="hero-ring-label">整体正确率</span>
          </div>
          <div class="hero-main">
            <div class="hero-caption"><strong>{{ currentStudentName }}</strong><span>{{ periodLabel }} · {{ singleHero.correctLine }}</span></div>
            <div class="hero-kpis">
              <div class="hero-kpi"><b>{{ singleHero.completedTasks }}<small v-if="singleHero.totalTasks">/{{ singleHero.totalTasks }}</small></b><span>完成作业</span></div>
              <div class="hero-kpi"><b>{{ singleHero.totalQuestions }}</b><span>批改题量</span></div>
              <div class="hero-kpi"><b class="warn">{{ singleHero.newWrongCount }}</b><span>新增错题</span></div>
              <div class="hero-kpi"><b class="good">{{ singleHero.securedCount }}</b><span>已记住</span></div>
              <div class="hero-kpi"><b>{{ singleHero.notStartedCount }}</b><span>还在攻克</span></div>
            </div>
            <TrophyBar
              :mastered="singleHero.masteredCount"
              :basic="singleHero.basicMasteredCount"
              :todo="singleHero.notStartedCount"
              :practiced="singleHero.practicedCount"
            />
          </div>
        </section>

        <!-- r133 重构新增：错因分布（横条）+ 下一步动作（可点）。
             放在 hero 正下方（第一屏）而不是趋势图之后 —— 实测两列卡片原本落在
             1281px，第一屏完全看不到，等于白做。叙事顺序也更像诊断：
             先「已拿下多少」→ 再「为什么错」→ 再「接下来做什么」→ 最后才是趋势与明细。 -->
        <ContentCard
          class="dx__errcause"
          title="错因分布：为什么错"
          :description="currentStudentDetail?.errorDistribution?.length
            ? `${currentStudentDetail.errorDistribution.reduce((s, e) => s + e.count, 0)} 道错题已归因 · 占前三类的比例最高，优先处理`
            : '错因会在每周一凌晨自动回填，或随批改逐步补齐'"
        >
          <ErrorCauseBars
            :items="currentStudentDetail?.errorDistribution || []"
            @select="onErrorCauseClick"
          />
        </ContentCard>
        <!-- 学习趋势折线图（r130 新增，r132 加粒度切换）：周/月/全部三档都出图。
             它取代了旧版那张「周期内学习趋势」柱状图 —— 后者读的是 point.day /
             point.total，而后端 buildDailyTrend 返回 {date, accuracy, count}，
             字段名对不上，柱子恒为 4% 空高、标签恒为 '-'，等于一张坏掉的图；
             且整块包在 v-if="periodMode === 'week'" 里，月/全部模式根本没图。
             保留两张图只会让老师困惑，故直接删旧留新（小而美：能删就删）。

             r132：默认「按天」。按周会把剧烈波动抹平 —— 实测陆晨曦 09-10
             只有 2/12 题（16.7%），按周看完全被平均掉。老师要看的正是
             「哪天崩了」，所以按天是默认，周是备选。 -->
        <ContentCard
          v-if="currentStudentDetail?.stats"
          class="trend-line-card"
          title="正确率走势"
          :description="`${currentStudentName} · 只看有批改记录的时段 · 没批改的日子不计入`"
        >
          <template #actions>
            <div class="trend-switch">
              <button
                v-for="opt in trendGranularityOptions"
                :key="opt.key"
                type="button"
                class="trend-switch__btn"
                :class="{ 'is-on': trendGranularity === opt.key }"
                :aria-pressed="trendGranularity === opt.key"
                @click="trendGranularity = opt.key"
              >{{ opt.label }}</button>
            </div>
          </template>
          <TrendLineChart :points="trendChartPoints" />
          <p v-if="trendChartPoints.length" class="trend-note">
            {{ trendSummary.description }}
          </p>
        </ContentCard>


        <!-- 成长对比：本周 vs 上周 / 本月 vs 上月（all 模式无对比对象，不展示） -->
        <ContentCard
          v-if="periodMode !== 'all' && currentStudentDetail?.prev"
          class="growth-compare"
          title="成长对比"
          :description="`${currentStudentName} · 本${periodMode === 'week' ? '周' : '月'} vs ${lastPeriodLabel}`"
        >
          <div v-if="prevHasData" class="compare-grid">
            <div v-for="item in growthCompareItems" :key="item.key" class="compare-item">
              <div class="compare-item__label">{{ item.label }}</div>
              <div class="compare-item__value">{{ item.currentText }}</div>
              <div :class="['compare-item__delta', item.tone]">
                <span v-if="item.prevText">{{ item.deltaText }}</span>
                <span v-else>上周无数据</span>
              </div>
              <div class="compare-item__prev">上周 {{ item.prevText }}</div>
            </div>
          </div>
          <EmptyState
            v-else
            title="上一周期暂无学习数据"
            description="本周期有学习记录，但上一周期没有进入批改的数据，暂无法对比。"
          />
        </ContentCard>

        <!-- 重练进步：本周期重练卷判题结果 + 错题生命周期推进 -->
        <ContentCard
          v-if="retryProgressVisible"
          class="retry-progress"
          title="重练进步"
          :description="`重练卷批改完成后推进错题掌握状态 · ${currentStudentName}`"
        >
          <div class="retry-grid">
            <div class="retry-item">
              <div class="retry-item__value">{{ retryProgress.examCount }}</div>
              <div class="retry-item__label">完成重练卷</div>
            </div>
            <div class="retry-item">
              <div class="retry-item__value">{{ retryProgress.retriedCount }}</div>
              <div class="retry-item__label">重练题目</div>
            </div>
            <div class="retry-item">
              <div class="retry-item__value" :class="{ 'is-good': (retryProgress.retryAccuracy || 0) >= 80 }">{{ retryProgress.retryAccuracy }}<small>%</small></div>
              <div class="retry-item__label">重练正确率</div>
            </div>
            <div class="retry-item">
              <div class="retry-item__value" :class="{ 'is-good': retryProgress.pushedToBasic > 0 }">{{ retryProgress.pushedToBasic }}</div>
              <div class="retry-item__label">推进到基本掌握</div>
            </div>
          </div>
          <div class="retry-note">
            <span>重练答对 {{ retryProgress.correctCount }} 题 · 未通过回到待练 {{ retryProgress.stillNew }} 题</span>
          </div>
        </ContentCard>

        <!-- ⛔ 知识点表从「全量 133 行」改为「默认 5 行 + 可展开」（r134）。
             实测全量渲染高度 **7622px** —— 一张卡把整个主栏拉成一条看不到头的长带，
             这正是负责人说的「长条通栏显得太丑」的元凶：
             ① 视觉上，主栏被一张无限长的表占满，右栏的 sticky 完全失去意义；
             ② 133 行里绝大多数是「错 1 次、正确率 90%+」的知识点，
                排在后面根本不会被看到，等于占位。
             mockup 的做法是只列最该练的 5 行 + 一个「全部」入口 —— 保留信息可达性，
             但把首屏还给真正要处理的问题。 -->
        <ContentCard
          v-if="currentStudentDetail?.knowledgeDiagnosis?.length"
          class="knowledge-diagnosis"
          title="最该练的知识点"
          :description="`按错误次数排序 · 共 ${weakKnowledge.length} 个知识点出过错 · ${
            weakKnowledgeCount > TOP_KNOWLEDGE_ROWS
              ? `先看最严重的 ${TOP_KNOWLEDGE_ROWS} 个`
              : '已全部列出'}`"
          flush
        >
          <template #actions>
            <button v-if="weakKnowledge.length > TOP_KNOWLEDGE_ROWS" type="button" class="kp-toggle" @click="knowledgeExpanded = !knowledgeExpanded">
              {{ knowledgeExpanded ? '只看最严重的' : `展开全部 ${weakKnowledge.length} 个` }}
            </button>
          </template>
          <DataTable :data="knowledgeRows" size="small" empty-text=" ">
            <el-table-column prop="tag" label="知识点" min-width="180"><template #default="{ row }"><div class="knowledge-name"><strong>{{ row.tag }}</strong><small>{{ row.subject || '其他' }}</small></div></template></el-table-column>
            <el-table-column label="当前掌握" width="130"><template #default="{ row }"><StatusTag :tone="knowledgeLevel(row).key === 'critical' ? 'danger' : knowledgeLevel(row).key === 'attention' ? 'warning' : 'success'">{{ knowledgeLevel(row).label }} · {{ row.accuracy }}%</StatusTag></template></el-table-column>
            <el-table-column label="错题表现" width="130"><template #default="{ row }"><strong :class="{ 'danger-text': row.wrongCount >= 3 }">最近错误 {{ row.wrongCount }} 次</strong><small class="table-sub">共 {{ row.totalCount }} 题</small></template></el-table-column>
            <el-table-column label="最近变化" width="150"><template #default="{ row }"><div v-if="knowledgeChange(row).prevWrong != null" class="recent-change"><strong :class="knowledgeChange(row).tone === 'down' ? 'change-good' : knowledgeChange(row).tone === 'up' ? 'change-bad' : ''">{{ knowledgeChange(row).deltaText }}</strong><small class="table-sub">上周 {{ knowledgeChange(row).prevWrong }} 次</small></div><div v-else class="recent-change"><strong class="change-new">本周新增</strong><small class="table-sub">上周未出现</small></div></template></el-table-column>
            <el-table-column label="建议动作" min-width="220"><template #default="{ row }"><div class="table-action"><span>{{ getDiagnosisAction(row) }}</span><el-button text type="primary" @click.stop="openWrongBook">加入重练</el-button></div></template></el-table-column>
          </DataTable>
          <p v-if="!knowledgeExpanded && weakKnowledge.length > TOP_KNOWLEDGE_ROWS" class="kp-note">
            其余 {{ weakKnowledge.length - TOP_KNOWLEDGE_ROWS }} 个知识点多为「错 1 次、正确率 90% 以上」，
            不占首屏；点右上角可展开查看。
          </p>
        </ContentCard>

        <ContentCard v-if="studentSuggestions.length" class="student-suggestions" title="本周备课建议（按 KP）" :description="`${currentStudentName} · ${periodLabel}`" flush>
          <div class="student-suggestion-list">
            <article v-for="(s, idx) in studentSuggestions" :key="s.kpName" class="student-suggestion-card">
              <header>
                <div class="rank-pill small">{{ idx + 1 }}</div>
                <strong>{{ s.kpName }}</strong>
                <span class="meta-inline">错题 {{ s.wrongCount }} · 空题 {{ s.blankCount }}</span>
              </header>
              <div v-if="s.errorDistribution?.length" class="mini-error-dist">
                <div v-for="e in s.errorDistribution.slice(0, 3)" :key="e.errorType" class="mini-error-row">
                  <span :style="{ color: errorTypeColor(e.errorType) }">{{ e.errorType }}</span>
                  <span class="mini-error-count">{{ e.count }}次 · {{ e.ratio }}%</span>
                </div>
              </div>
              <footer v-if="s.teachingAdvice">
                <span class="advice-label">辅导建议：</span>
                <strong>{{ s.teachingAdvice }}</strong>
              </footer>
            </article>
          </div>
        </ContentCard>
        <EmptyState v-else-if="!generating && currentStudentDetail" title="该学生当前周期暂无知识点诊断" description="可以切换周期，或等待新的批改数据进入诊断。" />
          </div>

          <!-- ── 右侧操作栏：行动 + 战绩 + 产出 ── -->
          <aside class="dx__rail">
            <ContentCard title="下一步做什么" description="按见效快慢排序 · 点开就能干" flush>
              <div class="dx__rail-body">
                <NextActions
                  :error-causes="currentStudentDetail?.errorDistribution || []"
                  :repeat-wrong-count="singleHero?.repeatWrongCount || 0"
                  :basic-count="singleHero?.basicMasteredCount || 0"
                  :todo-count="singleHero?.notStartedCount || 0"
                  :zero-accuracy-tags="zeroAccuracyTags"
                  :student-id="selectedStudentId"
                  :student-name="currentStudentName || ''"
                  @exam-created="onRetryExamCreated"
                />
              </div>
            </ContentCard>

            <ContentCard v-if="retryProgressVisible" title="重练战绩" :description="`${retryProgress.examCount} 份卷 · ${retryProgress.retriedCount} 题`" flush>
              <div class="dx__rail-body">
                <div class="rail-stats">
                  <div class="rail-stat">
                    <b :class="{ 'is-good': (retryProgress.retryAccuracy || 0) >= 60 }">{{ retryProgress.retryAccuracy }}<small>%</small></b>
                    <span>重练正确率</span>
                  </div>
                  <div class="rail-stat">
                    <b class="is-good">{{ retryProgress.pushedToBasic }}</b>
                    <span>推进到已记住</span>
                  </div>
                </div>
                <p class="rail-note">
                  答对 {{ retryProgress.correctCount }} 题 · 未通过回到待练 {{ retryProgress.stillNew }} 题
                </p>
              </div>
            </ContentCard>

            <ContentCard title="发给家长" description="老师转发用，家长只看产出物" flush>
              <div class="dx__rail-body">
                <ParentOutputCard
                  :student-name="currentStudentName"
                  :total-questions="singleHero?.totalQuestions || 0"
                  :correct-count="currentStudentDetail?.stats?.correctCount || 0"
                  :accuracy="singleHero?.acc"
                  :secured="singleHero?.securedCount || 0"
                  :mastered="singleHero?.masteredCount || 0"
                  :new-wrong="singleHero?.newWrongCount || 0"
                />
              </div>
            </ContentCard>
          </aside>
        </div>
      </template>

      <!-- 底部输出条：只保留家长侧报告（成长卡已搬到页头，见 PageHeader actions）。
           ⛔ r137 裁决：讲义 / 错题卷 / 发重练卷属被下线的功能，已移除
             （后端 /teaching/wrong-paper 等路由同批删除，调用代码曾残留导致
              Vite import 解析失败、整页打不开，r139 已一并清除）。 -->
      <section class="output-bar" aria-label="诊断输出">
        <span class="output-bar__label">输出</span>
        <ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('week')">生成本周报告</ActionButton>
        <ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('month')">生成本月报告</ActionButton>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
// r141：图标随「按年级」视图与知识点下钻抽屉一并精简。
// 只留模板里真正还在用的两个：ArrowRight（学生行右箭头）、WarningFilled（加载失败空态）。
import { ArrowRight, WarningFilled } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import GrowthCardButton from '../components/GrowthCardButton.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import TrophyBar from '../components/diagnosis/TrophyBar.vue'
import TrendLineChart from '../components/diagnosis/TrendLineChart.vue'
import ErrorCauseBars from '../components/diagnosis/ErrorCauseBars.vue'
import NextActions from '../components/diagnosis/NextActions.vue'
import ParentOutputCard from '../components/diagnosis/ParentOutputCard.vue'
import { getStudents, getAllWeeklyReports, getWeeklyReport } from '../../services/apiService'

/**
 * ⛔ r137 已下线、r138 收尾清理、r141 彻底清除：以下 4 个 API 在「班级备课」下线时
 *    连同后端 /teaching/diagnosis、/diagnosis/:tag、/wrong-paper 路由一起删掉了，
 *    但本页面的调用代码与 UI 按钮一直留着 —— Vite 对「import 不存在的导出」只在
 *    transform 阶段报Failed to resolve import，页面能加载，点到按钮才炸。
 *    这段残留在 HEAD 里已存在（不是最近某轮改出来的），r139 页面彻底打不开时暴露。
 *
 * 负责人裁决（2026-10-04）：**删前端残留，不补后端**。
 *    r141（2026-10-05）补完最后一刀：既然后端路由已不存在、UI 入口也全部摘掉，
 *    这4 个 no-op 占位只剩「将来恢复时能看出该接哪个接口」这一点价值 —— 而那份信息
 *    已完整写在上面这段注释里。继续留着反而是死代码（lint 也会一直报未使用）。
 *    故本轮一并删除，并把接口名记在注释中。
 *已删除的下线接口：/teaching/diagnosis（getTeachingDiagnosis）、
 *    /teaching/diagnosis/:tag（getTeachingDiagnosisDetail）、
 *    /teaching/wrong-paper（getTeachingWrongPaper / exportWrongPaper）。
 */
import { generateWeeklyReport } from '../../utils/weeklyReportGenerator'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

const router = useRouter()

// ── State ──
const selectedStudentId = ref('')
const studentList = ref([])
const summaryData = ref(null)
const loadingSummary = ref(false)
// 加载失败必须与「本周期真的没有批改数据」区分（第 129 轮）：此前失败后 summaryData
// 保持 null，页面渲染「暂无可诊断的学生数据」，老师会误以为这周白干了
const summaryError = ref('')
const generating = ref(false)
const currentStudentDetail = ref(null)
const checkedIds = ref([])

// ── 单生备课建议 State ──
const studentSuggestions = ref([])
const loadingStudentSuggestions = ref(false)

const allChecked = computed(() =>
  summaryData.value?.reports?.length > 0 &&
  checkedIds.value.length === summaryData.value.reports.length
)
const isIndeterminate = computed(() =>
  checkedIds.value.length > 0 &&
  checkedIds.value.length < (summaryData.value?.reports?.length || 0)
)

function toggleCheck(id, checked) {
  if (checked) {
    if (!checkedIds.value.includes(id)) checkedIds.value.push(id)
  } else {
    checkedIds.value = checkedIds.value.filter(x => x !== id)
  }
}

function toggleCheckAll(checked) {
  checkedIds.value = checked
    ? (summaryData.value?.reports || []).map(r => r.student.id)
    : []
}

// ── Period State ──
const periodMode = ref('week')
const periodOffset = ref(0)

const periodModeOptions = [
  { label: '周', value: 'week' },
  { label: '月', value: 'month' },
  { label: '全部', value: 'all' }
]

const offsetOptions = computed(() => {
  if (periodMode.value === 'week') {
    return [
      { label: '本周', value: 0 },
      { label: '上周', value: 1 },
      { label: '前2周', value: 2 },
      { label: '前3周', value: 3 },
      { label: '前4周', value: 4 },
      { label: '前5周', value: 5 },
      { label: '前6周', value: 6 },
      { label: '前7周', value: 7 },
      { label: '前8周', value: 8 },
      { label: '前9周', value: 9 },
      { label: '前10周', value: 10 }
    ]
  }
  if (periodMode.value === 'month') {
    return [
      { label: '本月', value: 0 },
      { label: '上月', value: 1 },
      { label: '前2月', value: 2 },
      { label: '前3月', value: 3 }
    ]
  }
  return []
})

const weekNum = computed(() => {
  if (periodMode.value !== 'week') return ''
  return dayjs().subtract(periodOffset.value, 'week').isoWeek()
})

const periodLabel = computed(() => {
  if (periodMode.value === 'all') return '全部时间'
  if (periodMode.value === 'week') {
    const start = dayjs().subtract(periodOffset.value, 'week').startOf('isoWeek')
    const end = dayjs().subtract(periodOffset.value, 'week').endOf('isoWeek')
    return `第${dayjs().subtract(periodOffset.value, 'week').isoWeek()}周 ${start.format('MM/DD')} ~ ${end.format('MM/DD')}`
  }
  if (periodMode.value === 'month') {
    const m = dayjs().subtract(periodOffset.value, 'month')
    return `${m.format('YYYY年M月')}`
  }
  return ''
})

const currentStudentName = computed(() => {
  const s = studentList.value.find(s => s.id === selectedStudentId.value)
  return s?.name || ''
})

const filterNoteText = computed(() =>
  selectedStudentId.value
    ? currentStudentName.value
    : `${reportsWithData.value.length} 名学生有数据`
)

// ── Watch period changes to refresh data ──

watch([periodMode, periodOffset], () => {
  loadSummary()
  if (selectedStudentId.value) handleStudentChange(selectedStudentId.value)
})

watch(selectedStudentId, (id) => {
  if (id) loadStudentSuggestions()
})

// ── Lifecycle ──
onMounted(async () => {
  await loadStudents()
  await loadSummary()
})

// ── Methods ──
async function loadStudents() {
  try {
    const result = await getStudents(true)
    studentList.value = result.data || []
  } catch (e) {
    console.warn('加载学生列表失败:', e)
  }
}

async function loadSummary() {
  loadingSummary.value = true
  summaryError.value = ''
  try {
    const data = await getAllWeeklyReports({ mode: periodMode.value, offset: periodOffset.value })
    if (data.success) {
      summaryData.value = data
      // 后端 partialFailure：某些学生取数失败（stats===null）。不提示的话，
      // 这些学生会被渲染成「暂无数据」，老师误以为本周没作业。
      const pf = data.partialFailure
      if (pf?.count > 0) {
        ElMessage.warning({
          message: `${pf.total} 名学生中有 ${pf.count} 名取数失败：${(pf.students || []).map(s => s.name).join('、')}——已在卡片上标为「数据异常」，可切换周期或稍后重试`,
          duration: 6000
        })
      }
    } else summaryError.value = data.error || '加载失败'
  } catch (e) {
    console.warn('加载周统计失败:', e)
    summaryError.value = e?.message || '加载失败'
  } finally {
    loadingSummary.value = false
  }
}

async function handleStudentChange(id) {
  currentStudentDetail.value = null
  if (!id) return
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const resp = await fetch(`${API_BASE}/weekly-report/${id}?mode=${periodMode.value}&offset=${periodOffset.value}`)
    const data = await resp.json()
    if (data.success) currentStudentDetail.value = data
  } catch (e) {
    ElMessage.error('获取学生周统计失败')
  }
}

async function loadStudentSuggestions() {
  if (!selectedStudentId.value) return
  loadingStudentSuggestions.value = true
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const url = new URL(`${API_BASE}/teaching/student-suggestions`, window.location.origin)
    url.searchParams.set('studentId', selectedStudentId.value)
    url.searchParams.set('mode', periodMode.value)
    url.searchParams.set('offset', String(periodOffset.value))
    const resp = await fetch(url.toString().replace(window.location.origin, ''))
    const data = await resp.json()
    if (data.success) {
      studentSuggestions.value = data.suggestions || []
    }
  } catch (e) {
    console.warn('加载单生备课建议失败:', e)
  } finally {
    loadingStudentSuggestions.value = false
  }
}

function diagRowClass({ row }) {
  return row.blankCount > 0 ? 'diag-row--blank' : ''
}



function generatePeriodReport(mode) {
  if (!selectedStudentId.value) return ElMessage.info('请先选择学生')
  periodMode.value = mode
  periodOffset.value = 0
  nextTick(() => handleGenerateCurrent())
}

function subjectTagType(subject) {
  if (subject === '数学') return 'danger'
  if (subject === '语文') return 'primary'
  if (subject === '英语') return 'warning'
  return 'info'
}

function errorTypeColor(type) {
  if (type === '未标注') return 'var(--wb-text-tertiary)'
  // 运算类 → 红；审题类 → 橙；知识类 → 蓝；过程类 → 紫；方法类 → 绿；习惯类 → 灰
  if (/计算|运算/.test(type)) return 'var(--wb-danger)'
  if (/审题/.test(type)) return 'var(--wb-warning)'
  if (/公式|概念/.test(type)) return 'var(--wb-primary)'
  if (/步骤|单位/.test(type)) return '#8B5CF6'
  if (/方法|分析/.test(type)) return 'var(--wb-success)'
  if (/抄写|粗心/.test(type)) return 'var(--wb-text-secondary)'
  return 'var(--wb-text-secondary)'
}

async function handleGenerateCurrent() {
  if (!selectedStudentId.value) {
    ElMessage.warning('请先选择学生')
    return
  }
  generating.value = true
  try {
    // 返回值：{ mode: 'print' | 'download', pdfBlob?, message? }
    // - 生产环境：mode='print'（弹打印框另存为 PDF）
    // - 开发环境：mode='download'，含 pdfBlob（直接 saveAs）
    const result = await generateWeeklyReport(selectedStudentId.value, { mode: periodMode.value, offset: periodOffset.value })
    if (!result) {
      ElMessage.warning('该时段暂无学习数据')
      return
    }
    if (result.mode === 'print') {
      ElMessage.success(result.message || '请在打印对话框另存为 PDF')
    } else if (result.mode === 'download' && result.pdfBlob) {
      const name = currentStudentName.value
      const suffix = periodMode.value === 'all' ? '全部时间' : (periodMode.value === 'month' ? dayjs().subtract(periodOffset.value, 'month').format('M月') : `第${weekNum.value}周`)
      const filename = `${name}_周学习诊断报告_${suffix}_${dayjs().format('YYYYMMDD')}.pdf`
      saveAs(result.pdfBlob, filename)
      ElMessage.success('报告已生成')
    } else {
      ElMessage.error('生成失败：未拿到 PDF')
    }
  } catch (e) {
    ElMessage.error('生成失败: ' + (e.message || '未知错误'))
  } finally {
    generating.value = false
  }
}

// ═══ 成长对比（prev）与重练进步（2026-09-20 P0） ═══
const lastPeriodLabel = computed(() => {
  if (periodMode.value === 'week') {
    const start = dayjs().subtract(periodOffset.value + 1, 'week').startOf('isoWeek')
    const end = dayjs().subtract(periodOffset.value + 1, 'week').endOf('isoWeek')
    return `${start.format('MM/DD')} ~ ${end.format('MM/DD')}`
  }
  if (periodMode.value === 'month') {
    return dayjs().subtract(periodOffset.value + 1, 'month').format('YYYY年M月')
  }
  return ''
})

const prevStats = computed(() => currentStudentDetail.value?.prev?.stats || null)
const prevHasData = computed(() => !!prevStats.value && (prevStats.value.totalQuestions > 0 || prevStats.value.newWrongCount > 0))

// 四项对比：正确率/完成题量 升=好；新增错题/待重练 升=坏
const growthCompareItems = computed(() => {
  const cur = currentStudentDetail.value?.stats || {}
  const prev = prevStats.value || {}
  const items = [
    { key: 'accuracy', label: '正确率', cur: cur.accuracy ?? 0, prev: prev.totalQuestions ? (prev.accuracy ?? null) : null, format: v => `${v}%`, betterWhen: 'up' },
    { key: 'newWrong', label: '新增错题', cur: cur.newWrongCount ?? 0, prev: prev.totalQuestions ? (prev.newWrongCount ?? null) : null, format: v => `${v} 题`, betterWhen: 'down' },
    { key: 'pending', label: '待重练', cur: cur.pendingCount ?? 0, prev: prev.totalQuestions ? (prev.pendingCount ?? null) : null, format: v => `${v} 题`, betterWhen: 'down' },
    { key: 'questions', label: '完成题量', cur: cur.totalQuestions ?? 0, prev: prev.totalQuestions ?? null, format: v => `${v} 题`, betterWhen: 'up' }
  ]
  return items.map(it => {
    const delta = it.prev != null ? it.cur - it.prev : null
    let tone = 'is-neutral'
    let deltaText = '与上周持平'
    if (delta != null && delta !== 0) {
      const good = (delta > 0 && it.betterWhen === 'up') || (delta < 0 && it.betterWhen === 'down')
      tone = good ? 'is-good' : 'is-bad'
      deltaText = `${delta > 0 ? '较上周 +' : '较上周 -'}${Math.abs(delta)}`
    }
    return {
      key: it.key,
      label: it.label,
      currentText: it.format(it.cur),
      prevText: it.prev != null ? it.format(it.prev) : '',
      deltaText,
      tone
    }
  })
})

// 知识点「最近变化」：上周同名知识点错误次数对比
const prevTagWrongMap = computed(() => {
  const map = new Map()
  for (const k of currentStudentDetail.value?.prev?.knowledgeDiagnosis || []) {
    const subj = k.subject || '其他'
    if (!map.has(subj)) map.set(subj, new Map())
    map.get(subj).set(k.tag, k.wrongCount)
  }
  return map
})

function knowledgeChange(row) {
  const subjMap = prevTagWrongMap.value.get(row.subject || '其他')
  const prevWrong = subjMap?.get(row.tag)
  if (prevWrong == null) return { prevWrong: null }
  const cur = row.wrongCount
  if (cur > prevWrong) return { prevWrong, deltaText: `较上周 +${cur - prevWrong} 次`, tone: 'up' }
  if (cur < prevWrong) return { prevWrong, deltaText: `较上周 -${prevWrong - cur} 次`, tone: 'down' }
  return { prevWrong, deltaText: '与上周持平', tone: 'flat' }
}

const retryProgress = computed(() => currentStudentDetail.value?.retryProgress || null)
const retryProgressVisible = computed(() => !!retryProgress.value && retryProgress.value.examCount > 0)

// r133：原「发现问题」三栏文字卡（studentProgressText / topWeakTags / nextActionText）
// 已删除 —— 它把「已看到什么」用三段长句复述一遍，而这三个问题现在分别由
// 战果条（已拿下多少）、错因横条（为什么错）、NextActions（接下来做什么）更直接地回答。
// 三段文案在页面上是全大段文字，实测占了 240px 高度却没给任何可操作项。
// 「优先处理哪三��知识点」的信息也没丢：错因条下方与知识点表仍在，
// 且 NextActions 会把全错知识点合并成一条「合并讲一节」。

function getDiagnosisAction(row) {
  if (row.accuracy < 60 || row.wrongCount >= 3) return '优先讲解，次日重练'
  if (row.accuracy < 80 || row.wrongCount >= 2) return '安排变式，观察独立完成'
  return '暂不加题，后续复测巩固'
}

const reportsWithData = computed(() => (summaryData.value?.reports || []).filter(r => r.stats?.totalQuestions > 0))
// r130：三态（mastered / basicMastered / notStarted）从后端新字段取；
// 老字段 pendingCount 语义未变（= basic + todo），保留给排序与风险分级用。
const aggregateStats = computed(() => {
  const reports = reportsWithData.value
  const totals = reports.reduce((acc, report) => {
    const stats = report.stats || {}
    acc.questions += stats.totalQuestions || 0
    acc.correct += stats.correctCount || 0
    acc.newWrong += stats.newWrongCount || 0
    acc.pending += stats.pendingCount || 0
    acc.mastered += stats.masteredCount || 0
    acc.basic += stats.basicMasteredCount || 0
    acc.todo += stats.notStartedCount || 0
    acc.practiced += stats.practicedCount || 0
    return acc
  }, { questions: 0, correct: 0, newWrong: 0, pending: 0, mastered: 0, basic: 0, todo: 0, practiced: 0 })
  return {
    accuracy: totals.questions ? Math.round((totals.correct / totals.questions) * 1000) / 10 : 0,
    totalQuestions: totals.questions,
    newWrongCount: totals.newWrong,
    pendingCount: totals.pending,
    masteredCount: totals.mastered,
    basicMasteredCount: totals.basic,
    notStartedCount: totals.todo,
    practicedCount: totals.practiced,
    // 「已记住」= 完全掌握 + 基本掌握：家长要看的信心数字，答对过就该被承认
    securedCount: totals.mastered + totals.basic,
    studentCount: reports.length
  }
})

// ── 学习概览 hero（2026-10-04）：正确率圆环 + KPI 一排，与家长分享卡同构。
//    色板只用工作台既有 token（success/warning/danger/border-light），不引入新色值。 ──
function accuracyTone(acc) {
  if (acc == null) return ''
  return acc >= 80 ? 'good' : acc >= 60 ? 'warn' : 'bad'
}
function heroRingStyle(acc) {
  const v = Math.max(0, Math.min(100, Number(acc) || 0))
  const color = acc == null
    ? 'var(--wb-text-tertiary)'
    : acc >= 80 ? 'var(--wb-success)' : acc >= 60 ? 'var(--wb-warning)' : 'var(--wb-danger)'
  return { background: `conic-gradient(${color} ${v * 3.6}deg, var(--wb-border-light) 0)` }
}
// 单生 hero 数据视图：批改题量为 0 时正确率无意义，显示 — 并用中性灰圆环
const singleHero = computed(() => {
  const s = currentStudentDetail.value?.stats
  if (!s) return null
  const hasQuestions = (s.totalQuestions || 0) > 0
  const mastered = s.masteredCount || 0
  const basic = s.basicMasteredCount || 0
  return {
    acc: hasQuestions ? s.accuracy : null,
    accText: hasQuestions ? `${s.accuracy}%` : '—',
    correctLine: `答对 ${s.correctCount || 0}/${s.totalQuestions || 0} 题`,
    completedTasks: s.completedTasks || 0,
    totalTasks: s.totalTasks || 0,
    totalQuestions: s.totalQuestions || 0,
    newWrongCount: s.newWrongCount || 0,
    masteredCount: mastered,
    basicMasteredCount: basic,
    notStartedCount: s.notStartedCount || 0,
    practicedCount: s.practicedCount || 0,
    repeatWrongCount: s.repeatWrongCount || 0,
    // r130：「已掌握」把基本掌握算进来（答对过 1 次就是记住了），
    // 旧版只显示完全掌握 2 道，实际 16 道 —— 数字好看但失真。
    securedCount: mastered + basic
  }
})
const overviewStats = computed(() => selectedStudentId.value && currentStudentDetail.value?.stats ? currentStudentDetail.value.stats : aggregateStats.value)
const attentionReports = computed(() => [...(summaryData.value?.reports || [])].sort((a, b) => studentRiskScore(b) - studentRiskScore(a)))
const weakKnowledge = computed(() => [...(currentStudentDetail.value?.knowledgeDiagnosis || [])].sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy))
const weakKnowledgeCount = computed(() => weakKnowledge.value.filter(row => row.accuracy < 80 || row.wrongCount >= 2).length)
// r134：知识点表默认只出最严重的 5 行（见模板注释里的 7622px 教训）
const TOP_KNOWLEDGE_ROWS = 5
const knowledgeExpanded = ref(false)
const knowledgeRows = computed(() =>
  knowledgeExpanded.value ? weakKnowledge.value : weakKnowledge.value.slice(0, TOP_KNOWLEDGE_ROWS)
)
// ── 正确率走势图（r132：按天 / 按周 粒度切换）──
// 数据源优先用后端 r132 的 dailyAccuracy / weeklyAccuracy（口径同源、含 correct）。
// 旧字段 periodTrend / dailyTrend 保留兜底 —— r130 修的字段名错配不能回退。
// ⛔ 两种粒度都不补空日：当天没批改不是「全错」，空点一律过滤（折线自然断开）。
const trendGranularity = ref('day')
const trendGranularityOptions = [
  { key: 'day', label: '按天' },
  { key: 'week', label: '按周' }
]
const trendSource = computed(() => {
  const detail = currentStudentDetail.value || {}
  return trendGranularity.value === 'day'
    ? (detail.dailyAccuracy || [])
    : (detail.weeklyAccuracy || detail.periodTrend || detail.dailyTrend || [])
})
const trendChartPoints = computed(() => trendSource.value.filter(point => point && point.count > 0 && point.accuracy != null))
const trendSummary = computed(() => {
  const points = trendChartPoints.value
  const isDay = trendGranularity.value === 'day'
  if (points.length < 2) {
    return points.length === 1
      ? { label: '仅 1 段记录', description: '出现第二段批改数据后可看走势', tone: 'default' }
      : { label: '暂无趋势', description: '本周期没有批改记录', tone: 'default' }
  }
  // 按天的首末对比会被单日噪声主导（如某天只做 2 题），故按天只报「区间」不报涨跌，
  // 按周（样本量足够大）才给涨跌 —— 避免拿一个 16.7% 的单日去讲「下降 15%」。
  // ⛔ 极值只在「样本量够」的天里取：实测蔡怡希 09-24 只批改 2 题且全错，
  //   若把它算成「最低 0%」，会与 200 道题的 56% 同等呈现，明显误导。
  //   低样本天（题量 <10）只作为图上的空心点存在，不参与极值与文案。
  const first = points[0]
  const last = points[points.length - 1]
  if (isDay) {
    const solid = points.filter(p => p.count >= 10)
    const lowCount = points.length - solid.length
    if (solid.length >= 2) {
      const lowest = solid.reduce((a, b) => (b.accuracy < a.accuracy ? b : a))
      const highest = solid.reduce((a, b) => (b.accuracy > a.accuracy ? b : a))
      return {
        label: `${points.length} 天有批改`,
        description: `最高 ${highest.accuracy}%（${highest.date.slice(5)}）· 最低 ${lowest.accuracy}%（${lowest.date.slice(5)}）`
          + (lowCount > 0 ? ` · 另有 ${lowCount} 天题量不足 10 道，图上用空心点表示，波动大仅供参考` : '')
          + ' · 当天没批改的日子不计入',
        tone: 'default'
      }
    }
    return {
      label: `${points.length} 天有批改`,
      description: '每天批改的题量都不足 10 道，正确率波动大，先看整体题量再判断',
      tone: 'default'
    }
  }
  const change = Math.round((last.accuracy - first.accuracy) * 10) / 10
  if (change >= 3) return { label: `上升 ${change}%`, description: `${first.date.slice(5)} ${first.accuracy}% → ${last.date.slice(5)} ${last.accuracy}%`, tone: 'success' }
  if (change <= -3) return { label: `下降 ${Math.abs(change)}%`, description: `${first.date.slice(5)} ${first.accuracy}% → ${last.date.slice(5)} ${last.accuracy}%`, tone: 'danger' }
  return { label: '基本持平', description: `${first.date.slice(5)} ${first.accuracy}% → ${last.date.slice(5)} ${last.accuracy}%`, tone: 'primary' }
})
// r130：单生「已掌握」= 完全掌握 + 基本掌握。答对过 1 次就是记住了，
// 不该只认 2 次答对那一档（那是「完全掌握」的定义，不是「记住了没有」）。
function securedOf(stats) {
  if (!stats) return 0
  return (stats.masteredCount || 0) + (stats.basicMasteredCount || 0)
}

// ── r133 重构新增 ──
// （r135：原 1) pickerStudents / 4) focusStudentById 随学生横排选择器一并删除，见模板注释）
// 顶栏下拉的选项
const studentOptions = computed(() =>
  studentList.value.map(s => ({ value: s.id, label: s.name }))
)
// 2) 全错知识点：出题 >= 2 且正确率 0 —— 建议合并讲一节而不是逐个重练
const zeroAccuracyTags = computed(() => {
  const list = currentStudentDetail.value?.knowledgeDiagnosis || []
  return list
    .filter(k => (k.totalCount || 0) >= 2 && (k.wrongCount || 0) >= (k.totalCount || 0))
    .slice(0, 3)
    .map(k => k.tag)
})
// 3) 点错因条 → 跳这名学生的错题清单（r141）
//⛔ r133 起这里 push('/students')（学生**列表**页），提示语还说「到错题中心」——
//    错题中心 r91 已并入学生档案页，那句指引指向一个不存在的页面，且跳过去也定位不到人。
//    真正能筛出这一类的是档案页里的错题清单（每行带错因标签）。
function onErrorCauseClick(row) {
  if (!selectedStudentId.value) return ElMessage.info('请先选择学生')
  ElMessage.info(`「${row.errorType}」${row.count} 道都在错题清单里，可按标签逐题核对后勾选发卷`)
  router.push({ path: `/students/${selectedStudentId.value}` })
}

// 3b) r142：动作清单里就地组卷成功后 —— 重拉一次本页诊断数据。
//     （新卷要等学生作答并批改后才进统计，所以这里只是刷新，不假装战绩已更新。）
function onRetryExamCreated() {
  handleStudentChange(selectedStudentId.value)
}

// r116：与 studentRiskLevel 的「暂无数据」判定同口径 —— stats 存在但 totalQuestions=0
// （该生本周期没有任何作答）不等于正确率 0%，指标一律显示「—」，避免家长/老师误读。
function hasStats(report) {
  const stats = report?.stats
  return Boolean(stats && stats.totalQuestions)
}

function studentRiskLevel(report) {
  const stats = report?.stats
  // stats===null 且带 error = 后端取数失败，不能与「本周期无作答」混为一谈
  if (stats === null && report?.error) return { key: 'error', label: '数据异常' }
  if (!stats || !stats.totalQuestions) return { key: 'normal', label: '暂无数据' }
  if (stats.accuracy < 60 || stats.pendingCount >= 5 || stats.newWrongCount >= 5) return { key: 'critical', label: '重点关注' }
  if (stats.accuracy < 80 || stats.pendingCount > 0 || stats.newWrongCount > 0) return { key: 'attention', label: '需要关注' }
  return { key: 'normal', label: '正常' }
}
function studentRiskScore(report) {
  const level = studentRiskLevel(report).key
  const stats = report?.stats || {}
  return (level === 'critical' ? 200 : level === 'attention' ? 100 : 0) + (stats.pendingCount || 0) * 3 + (stats.newWrongCount || 0) + (100 - (stats.accuracy || 0))
}
function focusStudent(report) {
  if (!report?.student?.id) return
  selectedStudentId.value = report.student.id
  handleStudentChange(report.student.id)
}
// 第 91 轮：错题中心页面已下线，错题清单并入学生档案页 ⇒ 这里改指学生档案。
function openWrongBook() {
  if (!selectedStudentId.value) return ElMessage.info('请先选择学生')
  router.push({ path: `/students/${selectedStudentId.value}` })
}
function knowledgeLevel(row) {
  if (row.accuracy < 60 || row.wrongCount >= 3) return { key: 'critical', label: '较弱' }
  if (row.accuracy < 80 || row.wrongCount >= 2) return { key: 'attention', label: '待巩固' }
  return { key: 'normal', label: '稳定' }
}
</script>

<style scoped>
.diagnosis-page{color:var(--wb-text)}.diagnosis-filter{margin-bottom:16px}.filter-note{color:var(--wb-text-tertiary);font-size:11px;white-space:nowrap}.diagnosis-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(320px,.75fr);align-items:start;gap:16px;margin-bottom:16px}.loading-stack{display:grid;gap:18px;padding:20px}.student-diagnosis-list{min-height:360px}.student-diagnosis-row{display:flex;align-items:center;gap:12px;min-height:82px;padding:12px 16px;box-sizing:border-box;border-bottom:1px solid var(--wb-border-light);cursor:pointer}.student-diagnosis-row:last-child{border-bottom:0}.student-diagnosis-row:hover{background:var(--wb-bg-elevated)}.student-identity{display:flex;width:110px;min-width:0;flex-direction:column;gap:3px}.student-identity strong{font-size:13px}.student-identity small{color:var(--wb-text-tertiary);font-size:10px}.student-metrics{display:grid;grid-template-columns:repeat(3,84px);gap:6px}.student-metrics span{display:flex;color:var(--wb-text-tertiary);font-size:10px;flex-direction:column;gap:3px}.student-metrics b{color:var(--wb-text);font-size:17px;font-weight:750;line-height:1.2;font-variant-numeric:tabular-nums}.student-next{display:flex;min-width:170px;flex:1;flex-direction:column;gap:4px}.student-next span{color:var(--wb-text-tertiary);font-size:9px}.student-next strong{font-size:11px;font-weight:550}.row-arrow{color:var(--wb-text-tertiary)}.student-detail-layout{grid-template-columns:minmax(0,1.35fr) minmax(330px,.65fr)}.knowledge-diagnosis{margin-bottom:16px}.knowledge-name{display:flex;flex-direction:column;gap:3px}.knowledge-name strong{font-size:12px}.knowledge-name small,.table-sub{display:block;color:var(--wb-text-tertiary);font-size:9px}.danger-text{color:var(--wb-danger)}.no-comparison{font-size:11px;color:var(--wb-text-secondary)}.table-action{display:flex;align-items:center;justify-content:space-between;gap:10px}.diagnosis-page :deep(.el-input__wrapper),.diagnosis-page :deep(.el-select__wrapper){min-height:34px;border-radius:8px;box-shadow:0 0 0 1px var(--wb-border) inset}.diagnosis-page :deep(.el-segmented){--el-segmented-item-selected-bg-color:#fff;--el-segmented-item-selected-color:var(--wb-primary)}.diagnosis-page :deep(.diag-row--blank td){background:#fffaf2!important}.diagnosis-page :deep(button:focus-visible){outline:2px solid var(--wb-primary);outline-offset:2px}.output-bar{display:flex;align-items:center;gap:var(--wb-space-3);margin-top:var(--wb-space-4);padding:var(--wb-space-3) var(--wb-space-4);border:1px solid var(--wb-border-light);border-radius:var(--wb-radius-md);background:var(--wb-bg-card)}.output-bar__label{color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-semibold)}.header-share-card{display:inline-flex;align-items:center}@media(max-width:1180px){.diagnosis-layout,.student-detail-layout{grid-template-columns:1fr}.student-next{display:none}}@media(max-width:760px){.student-select,.offset-select{width:100%}.student-diagnosis-row{align-items:flex-start;flex-wrap:wrap}.student-metrics{width:100%;padding-left:58px}.output-bar{flex-wrap:wrap}}

/* ── r135：.picker-row 样式随学生横排选择器删除 ── */
/* ── r134 诊断页两列骨架（按 03-mockup-v2）──
   mockup 的核心是那条竖直分界：左「诊断」右「行动」。r133 全部通栏 ⇒ 视觉退化成
   一张长表，没有视线落点。右栏 372px：动作条目都短，窄栏更易扫读。
   1360px 容器 - 372px 右栏 - 20px 间距 ≈ 主栏 968px，够放 5 个 KPI + 三态条。 */
.dx{display:grid;grid-template-columns:minmax(0,1fr) 356px;gap:var(--wb-space-5);align-items:start}
.dx__main{display:flex;min-width:0;flex-direction:column;gap:var(--wb-space-4)}
.dx__rail{position:sticky;top:calc(var(--wb-header-height) + var(--wb-space-4));display:flex;min-width:0;flex-direction:column;gap:var(--wb-space-4)}
/* 右栏卡内的内容统一内缩（ContentCard 用 flush 时 body 无 padding） */
.dx__rail-body{padding:var(--wb-space-4)}
.kp-toggle{padding:5px 12px;border:1px solid var(--wb-border);border-radius:var(--wb-radius-sm);background:var(--wb-bg-card);color:var(--wb-status-info-fg);font-size:var(--wb-fs-caption);font-weight:var(--wb-fw-semibold);cursor:pointer;white-space:nowrap}
.kp-toggle:hover{background:var(--wb-bg-hover);border-color:var(--wb-border-strong)}
.kp-note{margin:0;padding:var(--wb-space-3) var(--wb-space-5);border-top:1px solid var(--wb-border-light);color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);line-height:var(--wb-lh-relaxed)}
.rail-stats{display:grid;grid-template-columns:1fr 1fr;gap:var(--wb-space-3)}
.rail-stat b{display:block;color:var(--wb-text);font-size:var(--wb-fs-stat);font-weight:var(--wb-fw-bold);line-height:var(--wb-lh-tight);font-variant-numeric:tabular-nums}
.rail-stat b.is-good{color:var(--wb-status-success-fg)}
.rail-stat b small{font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-semibold)}
.rail-stat span{display:block;margin-top:3px;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption)}
.rail-note{margin:var(--wb-space-3) 0 0;color:var(--wb-text-tertiary);font-size:var(--wb-fs-caption);line-height:var(--wb-lh-relaxed)}
/* 窄屏：右栏落到主栏下方，不做挤压 */
@media(max-width:1280px){.dx{grid-template-columns:1fr}.dx__rail{position:static}}

.trend-line-card{margin-bottom:16px}
.trend-switch{display:flex;gap:2px;padding:2px;background:var(--wb-bg-elevated);border-radius:8px}
.trend-switch__btn{padding:5px 13px;border:0;border-radius:6px;background:transparent;color:var(--wb-text-tertiary);font-size:12px;font-weight:600;cursor:pointer;transition:.12s}
.trend-switch__btn:hover{color:var(--wb-text)}
.trend-switch__btn.is-on{background:#fff;color:var(--wb-primary);box-shadow:0 1px 2px rgba(16,24,40,.08)}
.trend-note{margin:10px 0 0;color:var(--wb-text-tertiary);font-size:11.5px;line-height:1.6}

/* ── 成长对比 / 重练进步（2026-09-20 P0） ── */
.growth-compare,.retry-progress{margin-bottom:16px}
.compare-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.compare-item{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-card)}
.compare-item__label{color:var(--wb-text-tertiary);font-size:10px;font-weight:600}
.compare-item__value{font-size:22px;font-weight:750;color:var(--wb-text);line-height:1.1}
.compare-item__delta{font-size:11px;font-weight:650}
.compare-item__delta.is-good{color:var(--wb-success)}
.compare-item__delta.is-bad{color:var(--wb-danger)}
.compare-item__delta.is-neutral{color:var(--wb-text-tertiary)}
.compare-item__prev{color:var(--wb-text-tertiary);font-size:10px}
.retry-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.retry-item{display:flex;flex-direction:column;gap:4px;padding:14px 16px;background:var(--wb-bg-elevated);border-radius:8px}
.retry-item__value{font-size:22px;font-weight:750;color:var(--wb-text);line-height:1.1}
.retry-item__value small{font-size:12px;color:var(--wb-text-tertiary);margin-left:2px}
.retry-item__value.is-good{color:var(--wb-success)}
.retry-item__label{color:var(--wb-text-tertiary);font-size:10px}
.retry-note{margin-top:12px;padding:10px 14px;border-radius:6px;background:var(--wb-primary-soft);color:var(--wb-text-secondary);font-size:11px}
.recent-change{display:flex;flex-direction:column;gap:3px}
.recent-change strong{font-size:12px;font-weight:650}
.recent-change .change-good{color:var(--wb-success)}
.recent-change .change-bad{color:var(--wb-danger)}
.recent-change .change-new{color:var(--wb-warning)}
.table-sub{display:block;color:var(--wb-text-tertiary);font-size:9px;margin-top:2px}
.row-actions{display:flex;gap:4px;justify-content:center}
.muted{color:var(--wb-text-tertiary);font-size:11px}
.expand-row:last-child{border-bottom:0}

/* ── 学习概览 hero（2026-10-04）：数字一览，色板全取工作台既有 token ── */
.hero-strip{display:flex;align-items:center;gap:22px;margin-bottom:16px;padding:16px 22px;border:1px solid var(--wb-border-light);border-radius:var(--wb-radius-md);background:var(--wb-bg-card)}
.hero-ring-wrap{display:flex;flex-direction:column;align-items:center;gap:7px;flex-shrink:0}
.hero-ring{width:100px;height:100px;border-radius:50%;display:flex;align-items:center;justify-content:center;position:relative}
.hero-ring::before{content:'';position:absolute;width:72px;height:72px;border-radius:50%;background:var(--wb-bg-card)}
.hero-ring b{position:relative;z-index:1;font-size:20px;font-weight:750;color:var(--wb-text)}
.hero-ring b.good{color:var(--wb-success)}
.hero-ring b.warn{color:var(--wb-warning)}
.hero-ring b.bad{color:var(--wb-danger)}
.hero-ring-label{color:var(--wb-text-tertiary);font-size:10px}
.hero-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px}
.hero-caption{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.hero-caption strong{font-size:14px;color:var(--wb-text)}
.hero-caption span{color:var(--wb-text-tertiary);font-size:11px}
/* r135①：去方格 —— 5 个带框小格子像作业本，改为无框竖线分隔排式，只靠数字大小建立层级 */
.hero-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0}
.hero-kpi{padding:2px 8px 2px 18px;border-left:1px solid var(--wb-border-light);text-align:left}
.hero-kpi:first-child{border-left:0;padding-left:0}
.hero-kpi b{display:block;font-size:22px;font-weight:750;color:var(--wb-text);line-height:1.15;font-variant-numeric:tabular-nums}
.hero-kpi b small{font-size:12px;font-weight:500;color:var(--wb-text-tertiary)}
.hero-kpi b.good{color:var(--wb-success)}
.hero-kpi b.warn{color:var(--wb-warning)}
.hero-kpi span{display:block;margin-top:3px;color:var(--wb-text-tertiary);font-size:10px}
@media(max-width:900px){.hero-strip{flex-direction:column;align-items:stretch}.hero-kpis{grid-template-columns:repeat(3,1fr)}.hero-kpi:nth-child(3n+1){border-left:0;padding-left:0}}

/* ── 单生备课建议（紧凑卡片） ──
   r141：原上方「年级备课建议（grade view）」样式块整段删除 —— 视图与后端接口均已下线。
   .rank-pill 仍被下面这张单生卡使用，故保留。 */
.rank-pill{display:grid;flex-shrink:0;width:30px;height:30px;place-items:center;color:#fff;background:var(--wb-primary);border-radius:50%;font-size:13px;font-weight:650}
.rank-pill.small{width:22px;height:22px;font-size:11px}
.student-suggestions{margin-bottom:16px}
.student-suggestion-list{display:grid;gap:12px}
.student-suggestion-card{padding:14px 16px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-card)}
.student-suggestion-card header{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.student-suggestion-card header strong{font-size:13px}
.meta-inline{color:var(--wb-text-tertiary);font-size:10px;margin-left:auto}
.mini-error-dist{display:grid;gap:4px;margin:8px 0}
.mini-error-row{display:flex;align-items:center;justify-content:space-between;font-size:11px}
.mini-error-count{color:var(--wb-text-tertiary);font-size:10px}
.student-suggestion-card footer{margin-top:10px;padding-top:10px;border-top:1px dashed var(--wb-border-light);font-size:11px;color:var(--wb-text-secondary)}
.advice-label{color:var(--wb-text-tertiary);margin-right:4px}
.student-suggestion-card footer strong{color:var(--wb-primary);font-weight:600}
</style>
