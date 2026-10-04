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
            v-if="viewMode === 'single'"
            :disabled="!selectedStudentId"
            :loading="generating"
            @click="handleGenerateCurrent"
          >生成报告</ActionButton>
        </template>
      </PageHeader>

      <FilterBar class="diagnosis-filter">
        <template #leading><el-segmented v-model="viewMode" :options="viewModeOptions" /></template>
        <WorkbenchSelect v-if="viewMode === 'grade'" v-model="selectedGrade" :options="gradeOptions" width="140px" aria-label="按年级筛选" placeholder="选择年级" />
        <el-select v-if="viewMode === 'single'" v-model="selectedStudentId" class="student-select" placeholder="选择学生" filterable clearable @change="handleStudentChange">
          <el-option v-for="student in studentList" :key="student.id" :label="student.name" :value="student.id"><span class="student-option"><el-avatar :size="22" :src="student.avatar" />{{ student.name }}<small>{{ student.grade }}</small></span></el-option>
        </el-select>
        <WorkbenchSelect v-if="viewMode === 'grade'" v-model="diagSubject" :options="diagSubjectOptions" width="120px" aria-label="按学科筛选" />
        <el-segmented v-model="periodMode" :options="periodModeOptions" />
        <WorkbenchSelect v-if="periodMode !== 'all'" v-model="periodOffset" :options="offsetOptions" width="120px" aria-label="时间偏移" />
        <template #actions><span class="filter-note">{{ filterNoteText }}</span></template>
      </FilterBar>

      <template v-if="viewMode === 'single'">
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
              <div class="hero-kpi"><b class="good">{{ aggregateStats.securedCount }}</b><span>已掌握</span></div>
              <div class="hero-kpi"><b>{{ aggregateStats.notStartedCount }}</b><span>待复习</span></div>
            </div>
            <MasteryBar :mastered="aggregateStats.masteredCount" :basic="aggregateStats.basicMasteredCount" :todo="aggregateStats.notStartedCount" />
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
                <StatusTag :tone="studentRiskLevel(report).key === 'critical' ? 'danger' : studentRiskLevel(report).key === 'attention' ? 'warning' : 'success'">{{ studentRiskLevel(report).label }}</StatusTag>
                <div class="student-metrics"><span><b>{{ hasStats(report) ? `${report.stats.accuracy}%` : '—' }}</b>正确率</span><span><b>{{ hasStats(report) ? report.stats.newWrongCount : '—' }}</b>新增错题</span><span><b>{{ hasStats(report) ? securedOf(report.stats) : '—' }}</b>已掌握</span></div>
                <div class="student-next"><span>建议动作</span><strong>{{ !hasStats(report) ? '等待有效学习数据' : studentRiskLevel(report).key === 'critical' ? '优先查看错题并安排重练' : studentRiskLevel(report).key === 'attention' ? '检查薄弱知识点' : '保持观察' }}</strong></div>
                <el-icon class="row-arrow"><ArrowRight /></el-icon>
              </article>
            </div>
          </ContentCard>
        </section>

        <template v-else>
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
              <div class="hero-kpi"><b class="good">{{ singleHero.securedCount }}</b><span>已掌握</span></div>
              <div class="hero-kpi"><b>{{ singleHero.notStartedCount }}</b><span>待复习</span></div>
            </div>
            <MasteryBar :mastered="singleHero.masteredCount" :basic="singleHero.basicMasteredCount" :todo="singleHero.notStartedCount" />
          </div>
          </section>

          <section v-if="currentStudentDetail?.stats" class="diagnosis-layout student-detail-layout">
            <ContentCard title="发现问题" :description="`${currentStudentName} · ${periodLabel}`">
              <div class="teaching-judgement">
                <div><span>已经看到</span><strong>{{ studentProgressText }}</strong></div>
                <div class="focus"><span>优先处理</span><strong>{{ topWeakTags || '本周期暂无明确薄弱知识点，继续观察' }}</strong></div>
                <div><span>下一步验证</span><strong>{{ nextActionText }}</strong></div>
              </div>
            </ContentCard>
          </section>

          <!-- 学习趋势折线图（r130 新增）：周/月/全部三档都出图。
               它取代了旧版那张「周期内学习趋势」柱状图 —— 后者读的是 point.day /
               point.total，而后端 buildDailyTrend 返回 {date, accuracy, count}，
               字段名对不上，柱子恒为 4% 空高、标签恒为 '-'，等于一张坏掉的图；
               且整块包在 v-if="periodMode === 'week'" 里，月/全部模式根本没图。
               保留两张图只会让老师困惑，故直接删旧留新（小而美：能删就删）。 -->
          <ContentCard
            v-if="currentStudentDetail?.stats"
            class="trend-line-card"
            title="正确率走势"
            :description="`${currentStudentName} · ${trendGranularityLabel} · 只看有批改记录的时段`"
          >
            <template #actions><span :class="['trend-result', trendSummary.tone]">{{ trendSummary.label }}</span></template>
            <TrendLineChart :points="trendChartPoints" />
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

          <ContentCard v-if="currentStudentDetail?.knowledgeDiagnosis?.length" class="knowledge-diagnosis" title="知识点诊断" description="从掌握情况、错题表现到建议动作，帮助老师完成教学判断" flush>
            <DataTable :data="weakKnowledge" size="small" empty-text=" ">
              <el-table-column prop="tag" label="知识点" min-width="180"><template #default="{ row }"><div class="knowledge-name"><strong>{{ row.tag }}</strong><small>{{ row.subject || '其他' }}</small></div></template></el-table-column>
              <el-table-column label="当前掌握" width="130"><template #default="{ row }"><StatusTag :tone="knowledgeLevel(row).key === 'critical' ? 'danger' : knowledgeLevel(row).key === 'attention' ? 'warning' : 'success'">{{ knowledgeLevel(row).label }} · {{ row.accuracy }}%</StatusTag></template></el-table-column>
              <el-table-column label="错题表现" width="130"><template #default="{ row }"><strong :class="{ 'danger-text': row.wrongCount >= 3 }">最近错误 {{ row.wrongCount }} 次</strong><small class="table-sub">共 {{ row.totalCount }} 题</small></template></el-table-column>
              <el-table-column label="最近变化" width="150"><template #default="{ row }"><div v-if="knowledgeChange(row).prevWrong != null" class="recent-change"><strong :class="knowledgeChange(row).tone === 'down' ? 'change-good' : knowledgeChange(row).tone === 'up' ? 'change-bad' : ''">{{ knowledgeChange(row).deltaText }}</strong><small class="table-sub">上周 {{ knowledgeChange(row).prevWrong }} 次</small></div><div v-else class="recent-change"><strong class="change-new">本周新增</strong><small class="table-sub">上周未出现</small></div></template></el-table-column>
              <el-table-column label="建议动作" min-width="220"><template #default="{ row }"><div class="table-action"><span>{{ getDiagnosisAction(row) }}</span><el-button text type="primary" @click.stop="openWrongBook">加入重练</el-button></div></template></el-table-column>
            </DataTable>
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
        </template>
      </template>

      <section v-else class="grade-suggestions-section">
        <ContentCard
          :title="`「${selectedGrade || '年级'}」本周备课建议`"
          :description="`${periodLabel} · ${diagSubject || '数学'} · ${gradeSuggestionsMeta?.studentCount ?? '-'} 名学生`
            + (gradeSuggestionsError ? ` · 加载失败：${gradeSuggestionsError}` : '')"
          flush
        >
          <template #actions>
            <ActionButton :loading="loadingGradeSuggestions" @click="retryGradeSuggestions">刷新</ActionButton>
          </template>
          <div v-if="loadingGradeSuggestions" class="loading-stack"><el-skeleton v-for="index in 3" :key="index" :rows="3" animated /></div>
          <EmptyState
            v-else-if="!gradeSuggestions.length"
            :icon="Reading"
            title="该年级本周暂无共性薄弱知识点"
            description="切换时间范围或学科继续查看，或等待新批改数据进入。"
          />
          <div v-else class="grade-suggestion-list">
            <article v-for="(s, idx) in gradeSuggestions" :key="s.kpName" class="grade-suggestion-card">
              <header class="card-header">
                <div class="rank-pill">{{ idx + 1 }}</div>
                <div class="kp-name-block">
                  <h3>{{ s.kpName }}</h3>
                  <div class="kp-meta">
                    <StatusTag :label="s.subject || '其他'" tone="neutral" />
                    <span class="meta-item"><b>{{ s.wrongCount }}</b> 道错题</span>
                    <span class="meta-item"><b>{{ s.blankCount }}</b> 道空题</span>
                    <span class="meta-item"><b>{{ s.studentCount }}</b> 名学生</span>
                  </div>
                </div>
              </header>

              <section v-if="s.errorDistribution?.length" class="card-section error-dist">
                <label>错因分布</label>
                <div class="error-bars">
                  <div v-for="e in s.errorDistribution" :key="e.errorType" class="error-bar-row">
                    <span class="error-type" :style="{ color: errorTypeColor(e.errorType) }">{{ e.errorType }}</span>
                    <el-progress :percentage="e.ratio" :color="errorTypeColor(e.errorType)" :stroke-width="10" style="flex: 1; margin: 0 10px;" />
                    <span class="error-count">{{ e.count }}次 · {{ e.ratio }}%</span>
                  </div>
                </div>
              </section>

              <section v-if="s.sampleQuestions?.length" class="card-section sample-list">
                <label>典型错题（讲义例题）</label>
                <div v-for="(q, qi) in s.sampleQuestions" :key="q.id" class="sample-item">
                  <div class="sample-q">{{ qi + 1 }}. {{ q.content }}</div>
                  <div class="sample-meta">
                    <span class="sample-stu">{{ q.studentName }}</span>
                    <span v-if="q.isBlank" class="sample-answer sample-answer--blank">空题未作答</span>
                    <span v-else class="sample-answer">作答：{{ q.studentAnswer || '未填写' }}</span>
                    <span class="sample-answer">正确：{{ q.correctAnswer || '—' }}</span>
                  </div>
                  <div class="sample-reason">
                    <StatusTag v-if="!q.isBlank" :tone="q.errorType ? 'danger' : 'info'">
                      {{ q.errorType || '未标注' }}{{ q.errorReason ? `：${q.errorReason}` : '' }}
                    </StatusTag>
                    <StatusTag v-else tone="warning">空题（建议当堂提问）</StatusTag>
                  </div>
                </div>
              </section>

              <footer v-if="s.teachingAdvice" class="card-footer">
                <el-icon><Reading /></el-icon>
                <span>教学建议：<strong>{{ s.teachingAdvice }}</strong></span>
              </footer>
            </article>
          </div>
        </ContentCard>
      </section>

      <!-- 周末讲题错题卷：按"具体题"维度聚合，错误率排序 -->
      <section v-if="viewMode === 'grade'" class="wrong-paper-section">
        <ContentCard
          class="wrong-paper-card"
          :title="`「${selectedGrade || '年级'}」本周错题卷清单`"
          :description="wrongPaperDescription"
          flush
        >
          <template #actions>
            <ActionButton :loading="exportingWrongPaper" :disabled="wrongPaperItems.length === 0" @click="handleExportWrongPaperAll">
              <el-icon><Download /></el-icon>导出全班讲义卷
            </ActionButton>
            <ActionButton :loading="loadingWrongPaper" @click="loadWrongPaper">
              <el-icon><Refresh /></el-icon>刷新
            </ActionButton>
          </template>

          <div v-if="loadingWrongPaper" class="loading-stack">
            <el-skeleton v-for="i in 4" :key="i" :rows="2" animated />
          </div>
          <EmptyState
            v-else-if="!wrongPaperItems.length"
            :icon="Reading"
            title="该年级本周暂无错题"
            description="切换时间范围或学科继续查看，或等待新批改数据进入。"
          />
          <DataTable
            v-else
            :data="wrongPaperItems"
            row-key="identityKey"
            :expand-row-keys="Array.from(expandedWrongRows)"
            :default-expand-all="false"
            size="small"
            empty-text=" "
            class="wrong-paper-table"
          >
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="wrong-paper-expand">
                  <div class="expand-row">
                    <span class="expand-label">正确答案</span>
                    <strong>{{ row.correctAnswer || '—' }}</strong>
                  </div>
                  <div v-if="row.involvedStudents?.length" class="expand-row">
                    <span class="expand-label">错的学生（{{ row.involvedStudents.length }} 人）</span>
                    <div class="student-chips">
                      <el-tag
                        v-for="s in row.involvedStudents"
                        :key="s.id"
                        :type="s.wrongTimes > 1 ? 'danger' : 'info'"
                        effect="plain"
                        size="small"
                      >
                        {{ s.name }}{{ s.wrongTimes > 1 ? ` ×${s.wrongTimes}` : '' }}
                      </el-tag>
                    </div>
                  </div>
                  <div v-if="row.errorDistribution?.length" class="expand-row">
                    <span class="expand-label">错因分布</span>
                    <div class="error-mini">
                      <span v-for="e in row.errorDistribution" :key="e.errorType" :style="{ color: errorTypeColor(e.errorType) }">
                        {{ e.errorType }} {{ e.count }}次 · {{ e.ratio }}%
                      </span>
                    </div>
                  </div>
                  <div v-if="row.knowledgeTags?.length" class="expand-row">
                    <span class="expand-label">知识点</span>
                    <span>
                      <el-tag v-for="t in row.knowledgeTags.slice(0, 4)" :key="t" type="info" effect="plain" size="small" style="margin-right: 4px;">
                        {{ t }}
                      </el-tag>
                    </span>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="row" width="48" align="center">
              <template #default="{ row, $index }">
                <span :class="['rank-num', { 'is-top': $index < 3 }]">{{ $index + 1 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="题目" min-width="280">
              <template #default="{ row }">
                <div class="wrong-q-cell">
                  <span class="wrong-q-content">{{ row.content }}</span>
                  <span v-if="row.knowledgeTags?.length" class="wrong-q-tags">
                    <el-tag
                      v-for="t in row.knowledgeTags.slice(0, 2)"
                      :key="t"
                      type="info"
                      effect="plain"
                      size="small"
                    >{{ t }}</el-tag>
                  </span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="错误率" width="110" align="center" sortable :sort-method="(a, b) => a.errorRate - b.errorRate">
              <template #default="{ row }">
                <div :class="['error-rate', errorRateTone(row.errorRate)]">
                  <strong>{{ row.errorRate }}%</strong>
                  <small>{{ row.studentCount }}/{{ wrongPaperMeta?.totalStudentCount || '-' }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="错题次数" width="86" align="center">
              <template #default="{ row }"><span>{{ row.wrongCount }}</span></template>
            </el-table-column>
            <el-table-column label="错因" min-width="160">
              <template #default="{ row }">
                <div v-if="row.errorDistribution?.length" class="error-tags">
                  <StatusTag
                    v-for="e in row.errorDistribution.slice(0, 2)"
                    :key="e.errorType"
                    :tone="errorTypeToTone(e.errorType)"
                    size="small"
                  >{{ e.errorType }} {{ e.ratio }}%</StatusTag>
                  <span v-if="row.errorDistribution.length > 2" class="muted">+{{ row.errorDistribution.length - 2 }}</span>
                </div>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" align="center" fixed="right">
              <template #default="{ row }">
                <div class="row-actions">
                  <el-button text size="small" @click="toggleWrongRow(wrongPaperRowKey(row))">
                    {{ isWrongRowExpanded(wrongPaperRowKey(row)) ? '收起' : '详情' }}
                  </el-button>
                  <el-button
                    text
                    type="primary"
                    size="small"
                    :disabled="!row.involvedStudents?.length"
                    @click="handleExportWrongPaperStudent(row)"
                  >个人卷</el-button>
                </div>
              </template>
            </el-table-column>
          </DataTable>
        </ContentCard>
      </section>

      <!-- 底部输出条：把诊断结论直接转化为下一步教学动作（替代原 report-output 大面板） -->
      <section class="output-bar" aria-label="诊断输出">
        <span class="output-bar__label">输出</span>
        <ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('week')">生成本周报告</ActionButton>
        <ActionButton :disabled="!selectedStudentId" :loading="generating" @click="generatePeriodReport('month')">生成本月报告</ActionButton>
        <ActionButton @click="handleExportHandout">生成讲义</ActionButton>
        <ActionButton variant="primary" @click="handleDistributeExam">发重练卷</ActionButton>
        <!-- 家长成长卡（第 91 轮从「成长中心」搬来）：这是老师转发给家长的产出物，
             成长中心下线后不能跟着消失。未选学生时点它会提示「请先选择学生」。
             ⛔ 类名必须挂在外层 span 上，不能直接挂到 <GrowthCardButton>：
             该组件是「按钮 + 弹窗 + Teleport」多根节点，Vue 无法透传 class
             （运行时会告警 "Extraneous non-props attributes"），margin-left:auto 会静默失效。 -->
        <span class="output-bar__growth">
          <GrowthCardButton :student-id="selectedStudentId || ''" :student-name="currentStudentName || ''" :mode="periodMode" :offset="periodOffset" />
        </span>
      </section>
    </div>
    <!-- 知识点下钻抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      size="520px"
      destroy-on-close
      :show-close="false"
    >
      <template #header>
        <div class="drawer-header">
          <div>
            <div class="drawer-title">「{{ drawerTag }}」诊断详情</div>
            <div class="drawer-sub">{{ periodLabel }}</div>
          </div>
          <el-button text @click="drawerVisible = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
      </template>
      <div v-loading="loadingDetail" class="drawer-body">
        <template v-if="drawerDetail">
          <div class="section-title">
            <el-icon><PieChart /></el-icon>
            错因分布（做错题共 {{ drawerDetail.totalWrong }} 道）
          </div>
          <div class="error-dist">
            <div class="error-item" v-for="e in drawerDetail.errorDist" :key="e.errorType">
              <span class="error-type" :style="{ color: errorTypeColor(e.errorType) }">{{ e.errorType }}</span>
              <el-progress
                :percentage="e.ratio"
                :color="errorTypeColor(e.errorType)"
                :stroke-width="12"
                style="flex: 1; margin: 0 12px;"
              />
              <span class="error-count">{{ e.count }}次 · {{ e.ratio }}%</span>
            </div>
            <div v-if="drawerDetail.errorDist.length === 0" class="muted" style="padding: 8px 0;">
              暂无做错题（该知识点仅有空题，空题不做错因分析）
            </div>
          </div>

          <div class="section-title" style="margin-top: 20px;">
            <el-icon><User /></el-icon>
            涉及学生（{{ drawerDetail.students.length }} 人）
          </div>
          <el-table :data="drawerDetail.students" stripe size="small" style="width: 100%">
            <el-table-column prop="name" label="姓名" min-width="100" />
            <el-table-column prop="grade" label="年级" width="90" align="center" />
            <el-table-column prop="blankCount" label="空题" width="80" align="center">
              <template #default="{ row }">
                <span v-if="row.blankCount > 0" class="blank-badge">{{ row.blankCount }}</span>
                <span v-else class="muted">0</span>
              </template>
            </el-table-column>
            <el-table-column prop="wrongCount" label="做错" width="80" align="center" />
          </el-table>

          <div class="section-title" style="margin-top: 20px;">
            <el-icon><Collection /></el-icon>
            典型错题（讲义例题）
          </div>
          <div v-if="drawerDetail.sampleQuestions?.length" class="sample-list">
            <div class="sample-item" v-for="(q, qi) in drawerDetail.sampleQuestions" :key="q.id">
              <div class="sample-q">{{ qi + 1 }}. {{ q.content }}</div>
              <div class="sample-meta">
                <span class="sample-stu">{{ q.studentName }}</span>
                <span v-if="q.isBlank" class="sample-answer sample-answer--blank">空题未作答</span>
                <span v-else class="sample-answer">作答：{{ q.studentAnswer || '未填写' }}</span>
                <span class="sample-answer">正确：{{ q.correctAnswer || '—' }}</span>
              </div>
              <div class="sample-reason">
                <StatusTag v-if="!q.isBlank" :tone="q.errorType ? 'danger' : 'info'">
                  {{ q.errorType || '未标注' }}{{ q.errorReason ? `：${q.errorReason}` : '' }}
                </StatusTag>
                <StatusTag v-else tone="warning">空题（建议当堂提问）</StatusTag>
              </div>
            </div>
          </div>
          <div v-else class="muted" style="padding: 8px 0;">暂未取到该知识点的错题样本</div>
        </template>
        <el-empty v-else description="暂无详情数据" :image-size="80" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowRight, Close, PieChart, User, Collection, Reading, Download, WarningFilled } from '@element-plus/icons-vue'
import ActionButton from '../components/ui/ActionButton.vue'
import ContentCard from '../components/ui/ContentCard.vue'
import DataTable from '../components/ui/DataTable.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import GrowthCardButton from '../components/GrowthCardButton.vue'
import StatusTag from '../components/ui/StatusTag.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import MasteryBar from '../components/diagnosis/MasteryBar.vue'
import TrendLineChart from '../components/diagnosis/TrendLineChart.vue'
import { getStudents, getAllWeeklyReports, getTeachingDiagnosis, getTeachingDiagnosisDetail, getTeachingWrongPaper, exportWrongPaper } from '../../services/apiService'
import { generateWeeklyReport } from '../../utils/weeklyReportGenerator'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

const router = useRouter()

// ── State ──
const viewMode = ref('single')
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

const viewModeOptions = [
  { label: '按年级', value: 'grade' },
  { label: '单生', value: 'single' }
]

// ── 全班共性诊断 State（保留兼容，新口径按年级） ──
const classDiagnosis = ref([])
const loadingClassDiagnosis = ref(false)
const diagSubject = ref('')
const diagSubjectOptions = [
  { label: '全部学科', value: '' },
  { label: '数学', value: '数学' },
  { label: '语文', value: '语文' },
  { label: '英语', value: '英语' }
]

// ── 年级备课建议 State（新口径：晚托班按年级） ──
const grades = ref([])
const selectedGrade = ref('')
const gradeSuggestions = ref([])
const gradeSuggestionsMeta = ref(null)
const loadingGradeSuggestions = ref(false)
const gradeSuggestionsError = ref('')

// ── 单生备课建议 State ──
const studentSuggestions = ref([])
const loadingStudentSuggestions = ref(false)
const drawerVisible = ref(false)
const drawerTag = ref('')
const drawerDetail = ref(null)
const loadingDetail = ref(false)

// ── 周末讲题错题卷 State（年级视图） ──
const wrongPaperItems = ref([])
const wrongPaperMeta = ref(null) // {totalStudentCount, wrongStudentCount, period}
const loadingWrongPaper = ref(false)
const wrongPaperError = ref('')
const exportingWrongPaper = ref(false)
const expandedWrongRows = ref(new Set()) // Set<identityKey>

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

const gradeOptions = computed(() =>
  grades.value.map(g => ({ label: g, value: g }))
)

const filterNoteText = computed(() => {
  if (viewMode.value === 'grade') {
    if (!selectedGrade.value) return '请选择年级'
    return `${selectedGrade.value} · ${gradeSuggestions.value.length} 个薄弱知识点`
  }
  return selectedStudentId.value
    ? currentStudentName.value
    : `${reportsWithData.value.length} 名学生有数据`
})

// 错题卷区块描述：年级 · 时段 · 学科 · 总人数 · 本周错题学生数 · 加载失败原因
const wrongPaperDescription = computed(() => {
  if (!selectedGrade.value) return '请选择年级'
  const meta = wrongPaperMeta.value
  const total = meta?.totalStudentCount ?? '-'
  const wrongStu = meta?.wrongStudentCount ?? '-'
  return `${selectedGrade.value} · ${periodLabel.value} · ${diagSubject.value || '数学'} · 共 ${total} 名学生 · ${wrongStu} 人本周错题${wrongPaperError.value ? ` · 加载失败：${wrongPaperError.value}` : ''}`
})

// 错误率档位（视觉强化）
function errorRateTone(rate) {
  if (rate >= 40) return 'is-critical'
  if (rate >= 20) return 'is-warning'
  if (rate >= 10) return 'is-info'
  return 'is-normal'
}

// 错因 → StatusTag tone（与已有 errorTypeColor 视觉一致）
function errorTypeToTone(type) {
  if (!type || type === '未标注') return 'default'
  if (/计算|运算/.test(type)) return 'danger'
  if (/审题/.test(type)) return 'warning'
  if (/公式|概念/.test(type)) return 'primary'
  if (/步骤|单位/.test(type)) return 'info'
  if (/方法|分析/.test(type)) return 'success'
  if (/抄写|粗心/.test(type)) return 'default'
  return 'default'
}

// ── Watch period changes to refresh data ──

watch([periodMode, periodOffset], () => {
  loadSummary()
  if (viewMode.value === 'grade' && selectedGrade.value) {
    loadGradeSuggestions()
    loadWrongPaper()
  }
  if (selectedStudentId.value) handleStudentChange(selectedStudentId.value)
})

watch(viewMode, (val) => {
  if (val === 'grade' && selectedGrade.value) {
    loadGradeSuggestions()
    loadWrongPaper()
  }
  if (val === 'single' && selectedStudentId.value) loadStudentSuggestions()
})

watch(selectedGrade, () => {
  if (viewMode.value === 'grade' && selectedGrade.value) {
    loadGradeSuggestions()
    loadWrongPaper()
  }
})

watch(selectedStudentId, (id) => {
  if (viewMode.value === 'single' && id) loadStudentSuggestions()
})

// ── Lifecycle ──
onMounted(async () => {
  await loadStudents()
  await loadGrades()
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
    if (data.success) summaryData.value = data
    else summaryError.value = data.error || '加载失败'
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

async function loadClassDiagnosis() {
  loadingClassDiagnosis.value = true
  try {
    const data = await getTeachingDiagnosis({
      mode: periodMode.value,
      offset: periodOffset.value,
      subject: diagSubject.value || undefined
    })
    classDiagnosis.value = data.success ? data.diagnosis : []
  } catch (e) {
    ElMessage.error('加载全班共性诊断失败')
  } finally {
    loadingClassDiagnosis.value = false
  }
}

async function loadGrades() {
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const resp = await fetch(`${API_BASE}/teaching/grades`)
    const data = await resp.json()
    if (data.success && Array.isArray(data.grades)) {
      grades.value = data.grades
      // 默认选中第一个年级
      if (!selectedGrade.value && data.grades.length > 0) {
        selectedGrade.value = data.grades[0]
      }
    }
  } catch (e) {
    console.warn('加载年级列表失败:', e)
  }
}

async function loadGradeSuggestions() {
  if (!selectedGrade.value) return
  loadingGradeSuggestions.value = true
  gradeSuggestionsError.value = ''
  try {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    const url = new URL(`${API_BASE}/teaching/grade-suggestions`, window.location.origin)
    url.searchParams.set('grade', selectedGrade.value)
    url.searchParams.set('mode', periodMode.value)
    url.searchParams.set('offset', String(periodOffset.value))
    url.searchParams.set('subject', diagSubject.value || '数学')
    const resp = await fetch(url.toString().replace(window.location.origin, ''))
    const data = await resp.json()
    if (data.success) {
      gradeSuggestions.value = data.suggestions || []
      gradeSuggestionsMeta.value = data
    } else {
      gradeSuggestionsError.value = data.error || '获取年级备课建议失败'
    }
  } catch (e) {
    gradeSuggestionsError.value = e.message || '获取年级备课建议失败'
    console.error('loadGradeSuggestions 异常:', e)
  } finally {
    loadingGradeSuggestions.value = false
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

async function retryGradeSuggestions() {
  await loadGradeSuggestions()
}

// ── 错题卷（年级视图） ──
async function loadWrongPaper() {
  if (!selectedGrade.value) return
  loadingWrongPaper.value = true
  wrongPaperError.value = ''
  try {
    const data = await getTeachingWrongPaper({
      grade: selectedGrade.value,
      mode: periodMode.value,
      offset: periodOffset.value,
      subject: diagSubject.value || undefined,
    })
    if (data.success) {
      wrongPaperItems.value = data.items || []
      wrongPaperMeta.value = data
    } else {
      wrongPaperError.value = data.error || '获取错题卷失败'
      wrongPaperItems.value = []
      wrongPaperMeta.value = null
    }
  } catch (e) {
    wrongPaperError.value = e.message || '获取错题卷失败'
    console.error('loadWrongPaper 异常:', e)
  } finally {
    loadingWrongPaper.value = false
  }
}

function toggleWrongRow(key) {
  const set = expandedWrongRows.value
  if (set.has(key)) set.delete(key)
  else set.add(key)
}

function isWrongRowExpanded(key) {
  return expandedWrongRows.value.has(key)
}

function wrongPaperRowKey(row) {
  return row.identityKey || row.questionId || row.content
}

async function handleExportWrongPaperAll() {
  if (!selectedGrade.value || wrongPaperItems.value.length === 0) return
  exportingWrongPaper.value = true
  try {
    const blob = await exportWrongPaper({
      grade: selectedGrade.value,
      mode: 'all',
      subject: diagSubject.value || '数学',
      periodMode: periodMode.value,
      periodOffset: periodOffset.value,
    })
    const ymd = dayjs().format('YYYYMMDD')
    const safeGrade = String(selectedGrade.value).replace(/[\\/:*?"<>|\s]/g, '_')
    saveAs(blob, `${ymd}_${safeGrade}_全班错题卷.docx`)
    ElMessage.success('全班错题卷已生成')
  } catch (e) {
    ElMessage.error('导出失败：' + (e.message || '未知错误'))
  } finally {
    exportingWrongPaper.value = false
  }
}

async function handleExportWrongPaperStudent(row) {
  if (!selectedGrade.value || !row?.involvedStudents?.length) return
  exportingWrongPaper.value = true
  try {
    // 选第一个学生作为默认导出对象（个人卷：每次只生成一个学生的卷）
    // 真实场景中老师通常会逐个学生点导出，所以这里一次只导一个
    const stu = row.involvedStudents[0]
    const blob = await exportWrongPaper({
      grade: selectedGrade.value,
      mode: 'student',
      studentId: stu.id,
      studentName: stu.name,
      subject: diagSubject.value || '数学',
      periodMode: periodMode.value,
      periodOffset: periodOffset.value,
    })
    const ymd = dayjs().format('YYYYMMDD')
    const safeName = String(stu.name || '学生').replace(/[\\/:*?"<>|\s]/g, '_')
    saveAs(blob, `${ymd}_${safeName}_错题卷.docx`)
    ElMessage.success(`${stu.name}的错题卷已生成`)
  } catch (e) {
    ElMessage.error('导出失败：' + (e.message || '未知错误'))
  } finally {
    exportingWrongPaper.value = false
  }
}

async function openDrill(row) {
  if (!row) return
  drawerTag.value = row.tag
  drawerVisible.value = true
  drawerDetail.value = null
  loadingDetail.value = true
  try {
    const data = await getTeachingDiagnosisDetail(row.tag, {
      mode: periodMode.value,
      offset: periodOffset.value
    })
    drawerDetail.value = data.success ? data : null
  } catch (e) {
    ElMessage.error('加载知识点详情失败')
  } finally {
    loadingDetail.value = false
  }
}

function diagRowClass({ row }) {
  return row.blankCount > 0 ? 'diag-row--blank' : ''
}

async function handleExportHandout() {
  if (classDiagnosis.value.length === 0 && !currentStudentDetail.value?.knowledgeDiagnosis?.length) return
  // 重构：跳转到 HandoutPreview 备课工作台（不再直接下载 docx）。
  // 老师可以在工作台切换模板、查看错题、编辑笔记、导 docx。
  router.push({
    name: 'HandoutPreview',
    query: {
      subject: diagSubject.value || '',
      periodMode: periodMode.value,
      periodOffset: periodOffset.value,
    },
  })
}

async function handleDistributeExam() {
  // r110（负责人批准的对齐）：统一叫「重练卷」，指路文案更新到现状——
  // 路径 B 原来只指移动端，现在 PC 学生档案的错题清单已能直接勾选组卷出 PDF（第 102 轮）。
  try {
    const { ElMessageBox } = await import('element-plus')
    await ElMessageBox.confirm(
      '<div style="line-height: 1.7;">' +
      '<p style="font-weight: 600; margin: 4px 0;">给学生发重练卷，有三条路：</p>' +
      '<p style="margin: 6px 0;"><b style="color: #6366F1;">① 周报自动（推荐，全量）</b><br/>' +
      '周学习诊断报告已内含每位学生的错题重练卷，点「生成本周/本月报告」一键生成全部学生，下载打印即可发卷。</p>' +
      '<p style="margin: 6px 0;"><b style="color: var(--wb-success);">② 错题清单勾选（按需）</b><br/>' +
      '打开学生档案页，在下方错题清单勾选题目，点「生成重练卷」直接下载可打印 PDF（卷上带扫码答题二维码）。</p>' +
      '<p style="margin: 6px 0;"><b style="color: var(--wb-text-secondary);">③ 移动端现场</b><br/>' +
      '晚托现场用手机时，打开 App「错题本」勾选错题（最多 30 题）即可生成临时重练卷。</p>' +
      '</div>',
      '发「错题重练卷」',
      {
        confirmButtonText: '知道了',
        cancelButtonText: '关闭',
        type: 'info',
        dangerouslyUseHTMLString: true
      }
    )
  } catch (e) {
    ElMessage.warning('发卷入口已取消')
  }
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

const topWeakTags = computed(() => {
  if (!currentStudentDetail.value?.knowledgeDiagnosis?.length) return ''
  const top3 = [...currentStudentDetail.value.knowledgeDiagnosis]
    .sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy)
    .slice(0, 3)
  return top3.map(k => `「${k.tag}」${k.wrongCount}次错误，正确率${k.accuracy}%`).join('；')
})

const studentProgressText = computed(() => {
  const stats = currentStudentDetail.value?.stats
  if (!stats) return '暂无足够数据'
  if (stats.masteredCount > 0 && stats.pendingCount > 0) return `已有${stats.masteredCount}题完成掌握验证，仍有${stats.pendingCount}题需要继续跟进`
  if (stats.masteredCount > 0) return `已有${stats.masteredCount}题完成掌握验证`
  if (stats.pendingCount > 0) return `本周期记录${stats.pendingCount}题待提升错题，先处理高频问题`
  return '本周期暂未形成可验证的错题掌握记录'
})

const nextActionText = computed(() => {
  const diagnosis = currentStudentDetail.value?.knowledgeDiagnosis || []
  if (!diagnosis.length) return '保持观察，出现重复错误后再安排针对训练'
  const focus = [...diagnosis].sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy)[0]
  if (focus.accuracy < 60) return `先讲清「${focus.tag}」的解题方法，再用相近变式独立复测`
  if (focus.wrongCount >= 2) return `安排「${focus.tag}」错题重练，重点观察是否还需要提示`
  return `安排「${focus.tag}」相近题复测，确认能否迁移`
})

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
    return acc
  }, { questions: 0, correct: 0, newWrong: 0, pending: 0, mastered: 0, basic: 0, todo: 0 })
  return {
    accuracy: totals.questions ? Math.round((totals.correct / totals.questions) * 1000) / 10 : 0,
    totalQuestions: totals.questions,
    newWrongCount: totals.newWrong,
    pendingCount: totals.pending,
    masteredCount: totals.mastered,
    basicMasteredCount: totals.basic,
    notStartedCount: totals.todo,
    // 「已掌握」= 完全掌握 + 基本掌握：家长要看的信心数字，答对过就该被承认
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
    // r130：「已掌握」把基本掌握算进来（答对过 1 次就是记住了），
    // 旧版只显示完全掌握 2 道，实际 16 道 —— 数字好看但失真。
    securedCount: mastered + basic
  }
})
const overviewStats = computed(() => selectedStudentId.value && currentStudentDetail.value?.stats ? currentStudentDetail.value.stats : aggregateStats.value)
const attentionReports = computed(() => [...(summaryData.value?.reports || [])].sort((a, b) => studentRiskScore(b) - studentRiskScore(a)))
const weakKnowledge = computed(() => [...(currentStudentDetail.value?.knowledgeDiagnosis || [])].sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy))
const weakKnowledgeCount = computed(() => weakKnowledge.value.filter(row => row.accuracy < 80 || row.wrongCount >= 2).length)
// r130：折线图数据源改为后端 periodTrend（周=日桶；月/全部按实际跨度自适应分桶）。
// 旧代码读 dailyTrend 的 point.total，而后端返回的是 count —— 恒为 undefined，
// 于是 trendSummary 永远停在「数据不足」，图也永远是空的。
const dailyTrendPoints = computed(() => (currentStudentDetail.value?.periodTrend || currentStudentDetail.value?.dailyTrend || []).filter(point => point.count > 0))
// 后端分桶粒度：'YYYY-MM' 说明跨度 > 45 天按月，否则按日
const trendGranularityLabel = computed(() => {
  const first = (currentStudentDetail.value?.periodTrend || [])[0]
  return first && /^\d{4}-\d{2}$/.test(first.date) ? '按月' : '按日'
})
const trendSummary = computed(() => {
  const points = dailyTrendPoints.value
  if (points.length < 2) {
    return points.length === 1
      ? { label: '仅 1 段记录', description: '出现第二段批改数据后可看走势', tone: 'default' }
      : { label: '暂无趋势', description: '本周期没有批改记录', tone: 'default' }
  }
  const change = Math.round((points[points.length - 1].accuracy - points[0].accuracy) * 10) / 10
  if (change >= 3) return { label: `上升 ${change}%`, description: '首末有效时段对比', tone: 'success' }
  if (change <= -3) return { label: `下降 ${Math.abs(change)}%`, description: '首末有效时段对比', tone: 'danger' }
  return { label: '基本持平', description: '首末有效时段持平', tone: 'primary' }
})
// r130：单生「已掌握」= 完全掌握 + 基本掌握。答对过 1 次就是记住了，
// 不该只认 2 次答对那一档（那是「完全掌握」的定义，不是「记住了没有」）。
function securedOf(stats) {
  if (!stats) return 0
  return (stats.masteredCount || 0) + (stats.basicMasteredCount || 0)
}

// r116：与 studentRiskLevel 的「暂无数据」判定同口径 —— stats 存在但 totalQuestions=0
// （该生本周期没有任何作答）不等于正确率 0%，指标一律显示「—」，避免家长/老师误读。
function hasStats(report) {
  const stats = report?.stats
  return Boolean(stats && stats.totalQuestions)
}

function studentRiskLevel(report) {
  const stats = report?.stats
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
.diagnosis-page{color:var(--wb-text)}.diagnosis-filter{margin-bottom:16px}.student-select{width:220px}.offset-select,.subject-select{width:120px}.student-option{display:flex;align-items:center;gap:8px}.student-option small{margin-left:auto;color:var(--wb-text-tertiary)}.filter-note{color:var(--wb-text-tertiary);font-size:11px;white-space:nowrap}.diagnosis-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(320px,.75fr);align-items:start;gap:16px;margin-bottom:16px}.loading-stack{display:grid;gap:18px;padding:20px}.student-diagnosis-list{min-height:360px}.student-diagnosis-row{display:flex;align-items:center;gap:12px;min-height:82px;padding:12px 16px;box-sizing:border-box;border-bottom:1px solid var(--wb-border-light);cursor:pointer}.student-diagnosis-row:last-child{border-bottom:0}.student-diagnosis-row:hover{background:var(--wb-bg-elevated)}.student-identity{display:flex;width:110px;min-width:0;flex-direction:column;gap:3px}.student-identity strong{font-size:13px}.student-identity small{color:var(--wb-text-tertiary);font-size:10px}.student-metrics{display:grid;grid-template-columns:repeat(3,72px);gap:6px}.student-metrics span{display:flex;color:var(--wb-text-tertiary);font-size:9px;flex-direction:column;gap:3px}.student-metrics b{color:var(--wb-text);font-size:12px}.student-next{display:flex;min-width:170px;flex:1;flex-direction:column;gap:4px}.student-next span{color:var(--wb-text-tertiary);font-size:9px}.student-next strong{font-size:11px;font-weight:550}.row-arrow{color:var(--wb-text-tertiary)}.student-detail-layout{grid-template-columns:minmax(0,1.35fr) minmax(330px,.65fr)}.teaching-judgement{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--wb-border-light);border-radius:8px}.teaching-judgement>div{min-height:88px;padding:14px;border-right:1px solid var(--wb-border-light)}.teaching-judgement>div:last-child{border-right:0}.teaching-judgement .focus{background:#fffaf2}.teaching-judgement span{display:block;margin-bottom:7px;color:var(--wb-text-tertiary);font-size:10px}.teaching-judgement strong{font-size:11px;line-height:1.65}.trend-result{font-size:11px;font-weight:600}.trend-result.success{color:var(--wb-success)}.trend-result.danger{color:var(--wb-danger)}.trend-result.primary{color:var(--wb-primary)}.knowledge-diagnosis,.class-diagnosis-section{margin-bottom:16px}.knowledge-name{display:flex;flex-direction:column;gap:3px}.knowledge-name strong{font-size:12px}.knowledge-name small,.table-sub{display:block;color:var(--wb-text-tertiary);font-size:9px}.danger-text{color:var(--wb-danger)}.no-comparison{font-size:11px;color:var(--wb-text-secondary)}.table-action{display:flex;align-items:center;justify-content:space-between;gap:10px}.drawer-header{display:flex;align-items:flex-start;justify-content:space-between}.drawer-title{font-size:16px;font-weight:650}.drawer-sub{margin-top:4px;color:var(--wb-text-tertiary);font-size:11px}.drawer-body{min-height:300px}.error-dist{display:grid;gap:12px}.error-item{display:flex;align-items:center}.error-type{width:90px;font-size:11px}.error-count{color:var(--wb-text-tertiary);font-size:10px}.sample-list{display:grid;gap:10px}.sample-item{padding:12px;background:var(--wb-bg-elevated);border-radius:8px}.sample-q{font-size:12px;line-height:1.6}.sample-meta,.sample-reason{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.sample-meta{color:var(--wb-text-secondary);font-size:10px}.blank-badge{color:var(--wb-danger);font-weight:600}.muted{color:var(--wb-text-tertiary)}.diagnosis-page :deep(.el-input__wrapper),.diagnosis-page :deep(.el-select__wrapper){min-height:34px;border-radius:8px;box-shadow:0 0 0 1px var(--wb-border) inset}.diagnosis-page :deep(.el-segmented){--el-segmented-item-selected-bg-color:#fff;--el-segmented-item-selected-color:var(--wb-primary)}.diagnosis-page :deep(.diag-row--blank td){background:#fffaf2!important}.diagnosis-page :deep(button:focus-visible){outline:2px solid var(--wb-primary);outline-offset:2px}.output-bar{display:flex;align-items:center;gap:var(--wb-space-3);margin-top:var(--wb-space-4);padding:var(--wb-space-3) var(--wb-space-4);border:1px solid var(--wb-border-light);border-radius:var(--wb-radius-md);background:var(--wb-bg-card)}.output-bar__label{color:var(--wb-text-tertiary);font-size:var(--wb-fs-meta);font-weight:var(--wb-fw-semibold)}.output-bar__growth{margin-left:auto}@media(max-width:1180px){.diagnosis-layout,.student-detail-layout{grid-template-columns:1fr}.student-next{display:none}}@media(max-width:760px){.student-select,.offset-select{width:100%}.student-diagnosis-row{align-items:flex-start;flex-wrap:wrap}.student-metrics{width:100%;padding-left:58px}.teaching-judgement{grid-template-columns:1fr}.teaching-judgement>div{border-right:0;border-bottom:1px solid var(--wb-border-light)}.output-bar{flex-wrap:wrap}}

/* ── 周末讲题错题卷（grade view） ── */
.wrong-paper-section{margin-bottom:16px}
.wrong-paper-card :deep(.el-button.is-text){font-size:11px}
.wrong-paper-table{margin-top:8px}
.wrong-paper-table :deep(.cell){padding:8px 6px}
.wrong-q-cell{display:flex;flex-direction:column;gap:4px;min-width:0}
.wrong-q-content{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:1.5;word-break:break-word}
.wrong-q-tags{display:flex;flex-wrap:wrap;gap:4px}
.error-rate{display:flex;flex-direction:column;align-items:center;line-height:1.2}
.error-rate strong{font-size:14px;font-weight:700}
.error-rate small{font-size:9px;color:var(--wb-text-tertiary);margin-top:2px}
.error-rate.is-critical strong{color:var(--wb-danger)}
.error-rate.is-critical{background:#fef2f2;border-radius:6px;padding:4px 0}
.error-rate.is-warning strong{color:var(--wb-warning)}
.error-rate.is-info strong{color:var(--wb-primary)}
.error-rate.is-normal strong{color:var(--wb-text-secondary)}
.rank-num{display:inline-block;min-width:24px;padding:2px 8px;border-radius:10px;background:var(--wb-bg-elevated);color:var(--wb-text-secondary);font-size:11px;font-weight:600}
.rank-num.is-top{background:var(--wb-primary-soft);color:var(--wb-primary)}

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
.error-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.row-actions{display:flex;gap:4px;justify-content:center}
.muted{color:var(--wb-text-tertiary);font-size:11px}
.wrong-paper-expand{padding:8px 12px;background:var(--wb-bg-elevated);border-radius:8px;margin:4px 0}
.expand-row{display:flex;gap:12px;align-items:flex-start;padding:6px 0;font-size:12px;border-bottom:1px dashed var(--wb-border-light)}
.expand-row:last-child{border-bottom:0}
.expand-label{flex-shrink:0;width:96px;color:var(--wb-text-tertiary);font-size:11px}
.student-chips{display:flex;flex-wrap:wrap;gap:4px}
.error-mini{display:flex;flex-wrap:wrap;gap:8px;font-size:11px}

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
.hero-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
.hero-kpi{background:var(--wb-bg-elevated);border:1px solid var(--wb-border-light);border-radius:8px;padding:10px 8px;text-align:center}
.hero-kpi b{display:block;font-size:20px;font-weight:750;color:var(--wb-text);line-height:1.15}
.hero-kpi b small{font-size:12px;font-weight:500;color:var(--wb-text-tertiary)}
.hero-kpi b.good{color:var(--wb-success)}
.hero-kpi b.warn{color:var(--wb-warning)}
.hero-kpi span{display:block;margin-top:3px;color:var(--wb-text-tertiary);font-size:10px}
@media(max-width:900px){.hero-strip{flex-direction:column;align-items:stretch}.hero-kpis{grid-template-columns:repeat(3,1fr)}}

/* ── 年级备课建议（grade view） ── */
.grade-suggestions-section{margin-bottom:16px}
.grade-suggestion-list{display:grid;gap:14px}
.grade-suggestion-card{padding:18px 20px;border:1px solid var(--wb-border-light);border-radius:var(--wb-radius-md);background:var(--wb-bg-card)}
.card-header{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}
.rank-pill{display:grid;flex-shrink:0;width:30px;height:30px;place-items:center;color:#fff;background:var(--wb-primary);border-radius:50%;font-size:13px;font-weight:650}
.rank-pill.small{width:22px;height:22px;font-size:11px}
.kp-name-block{flex:1;min-width:0}
.kp-name-block h3{margin:0 0 6px;font-size:14px;font-weight:650}
.kp-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--wb-text-secondary);font-size:10px}
.kp-meta .meta-item b{color:var(--wb-text);font-weight:600;font-size:11px}
.card-section{padding:12px 0;border-top:1px solid var(--wb-border-light)}
.card-section:first-of-type{border-top:0;padding-top:0}
.card-section label{display:block;margin-bottom:8px;color:var(--wb-text-tertiary);font-size:10px;font-weight:600}
.error-bars{display:grid;gap:10px}
.error-bar-row{display:flex;align-items:center}
.error-bar-row .error-type{width:90px;font-size:11px}
.error-bar-row .error-count{color:var(--wb-text-tertiary);font-size:10px;min-width:74px;text-align:right}
.sample-item{padding:10px 12px;background:var(--wb-bg-elevated);border-radius:6px;margin-bottom:8px}
.sample-item:last-child{margin-bottom:0}
.sample-q{font-size:12px;line-height:1.6}
.sample-meta,.sample-reason{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;color:var(--wb-text-secondary);font-size:10px}
.card-footer{display:flex;align-items:center;gap:8px;margin-top:14px;padding:10px 14px;background:var(--wb-primary-soft);border-radius:6px;color:var(--wb-text);font-size:11px}
.card-footer strong{color:var(--wb-primary);font-weight:600}

/* ── 单生备课建议（single view 内的紧凑卡片） ── */
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
