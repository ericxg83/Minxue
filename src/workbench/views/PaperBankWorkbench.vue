<template>
  <div class="paper-bank wb-page">
    <div class="wb-page__inner">
      <PageHeader
        eyebrow="教学资源 / 题库"
        title="试卷题库"
        description="先建好题集，再用 PDF 或截图往里加题；拖动题集归类，右边卷面实时长出来"
      >
        <template #actions>
          <!-- 2026-11-07：题集是唯一归属，PDF 与截图只是两种「加题」动作，不再各自成一类题库。 -->
          <ActionButton variant="secondary" @click="openCreateDialog">
            <el-icon><Plus /></el-icon>新建题集
          </ActionButton>
          <ActionButton variant="secondary" :disabled="!papers.length" @click="openClipDialog">
            <el-icon><Camera /></el-icon>截图加题
          </ActionButton>
          <ActionButton variant="primary" :disabled="!papers.length" @click="openUploadDialog(null, 'questions')">
            <el-icon><UploadFilled /></el-icon>PDF 加题
          </ActionButton>
        </template>
      </PageHeader>

      <div
        class="pb-layout"
        :style="{
          '--pw': previewWidth + 'px',
          ...(narrow ? { paddingBottom: paperCollapsed ? '62px' : 'calc(46vh + 18px)' } : {}),
        }"
      >
        <!-- 左：树形文件夹 + 当前题集详情（2026-11-07） -->
        <aside class="pb-col pb-col--papers">
          <PaperBankTree
            :papers="papers"
            :total-question-count="totalQuestionCount"
            :active-paper-id="filterPaper"
            @select="pickPaper"
            @changed="loadPapers"
            @create-paper="openCreateDialog"
            @drop-question="onQuestionDropped"
          />

          <!-- 原卷 / 答案 / 复核状态跟着「当前选中」走，树本身保持笔记式的干净 -->
          <div v-if="activePaper" class="pb-panel pb-panel--detail">
            <div class="pb-detail__head">
              <span class="pb-detail__label">当前题集</span>
              <strong :title="activePaper.name">{{ activePaper.name }}</strong>
            </div>
            <div class="pb-detail__links">
              <a
                v-if="(activePaper.question_files || []).length === 1"
                class="pb-file-link"
                :href="activePaper.question_files[0].url"
                target="_blank"
                rel="noopener"
                title="打开上传的原卷文件"
              >原卷 ↗</a>
              <button
                v-else-if="(activePaper.question_files || []).length > 1"
                type="button"
                class="pb-file-link"
                title="选择要打开的原卷文件"
                @click="openSourceFiles(activePaper, 'questions')"
              >原卷 {{ activePaper.question_files.length }} 份 ↗</button>
              <a
                v-if="(activePaper.answer_files || []).length === 1"
                class="pb-file-link"
                :href="activePaper.answer_files[0].url"
                target="_blank"
                rel="noopener"
                title="打开上传的官方答案原件"
              >答案册 ↗</a>
              <button
                v-else-if="(activePaper.answer_files || []).length > 1"
                type="button"
                class="pb-file-link"
                title="选择要打开的答案原件"
                @click="openSourceFiles(activePaper, 'answers')"
              >答案册 {{ activePaper.answer_files.length }} 份 ↗</button>
              <button
                v-if="(activePaper.ocr_review || []).length"
                type="button"
                class="pb-review-badge"
                :title="`双模型复核：${activePaper.ocr_review.length} 处读法不一致，待对照原卷核对`"
                @click="openOcrReview(activePaper)"
              >⚠ {{ activePaper.ocr_review.length }} 处待核对</button>
              <span
                v-else-if="activePaper.ocr_review_summary?.skippedPages"
                class="pb-review-warn"
                :title="`有 ${activePaper.ocr_review_summary.skippedPages} 页双模型复核没跑成`"
              >⚠ {{ activePaper.ocr_review_summary.skippedPages }} 页未复核</span>
              <button
                v-if="coverageIssueCount(activePaper) > 0"
                type="button"
                class="pb-review-badge is-danger"
                :title="coverageTitle(activePaper)"
                @click="openCoverage(activePaper)"
              >⛔ {{ coverageIssueCount(activePaper) }} 个题号不符</button>
              <span
                v-else-if="activePaper.coverage_summary?.pagesUnverified"
                class="pb-review-warn"
                :title="`有 ${activePaper.coverage_summary.pagesUnverified} 页题号清点没跑成`"
              >⚠ {{ activePaper.coverage_summary.pagesUnverified }} 页未清点</span>
              <button
                v-else-if="activePaper.coverage_summary"
                type="button"
                class="pb-checked"
                :title="coverageOkTitle(activePaper)"
                @click="openCoverage(activePaper)"
              >✓ 题号已核</button>
              <button type="button" class="pb-file-link" @click="openUploadDialog(activePaper.id, 'answers')">上传答案 ↗</button>
            </div>
          </div>
        </aside>

        <!-- 中：题目区 -->
        <main class="pb-col pb-col--questions">
          <!-- 批量操作工具栏（2026-11-08 P0）：选中 ≥1 题时显示在筛选条上方 -->
          <Transition name="pb-bulk-fade">
            <div v-if="selectionCount > 0" class="pb-bulk">
              <div class="pb-bulk__info">
                <el-checkbox
                  :model-value="selectionCount === questions.length && questions.length > 0"
                  :indeterminate="selectionCount > 0 && selectionCount < questions.length"
                  @change="(v) => v ? selectAll() : clearSelection()"
                />
                <strong>已选 {{ selectionCount }} 题</strong>
                <button type="button" class="pb-link" @click="clearSelection">取消选择</button>
              </div>
              <div class="pb-bulk__ops">
                <!-- 改难度 -->
                <div class="pb-bulk__dropdown">
                  <button
                    type="button" class="pb-bulk__btn"
                    :disabled="bulkBusy"
                    @click="showBulkDifficulty = !showBulkDifficulty; showBulkTags = false"
                  >改难度</button>
                  <div v-if="showBulkDifficulty" class="pb-bulk__popover">
                    <button type="button" @click="bulkSetDifficulty('')">未判定</button>
                    <button type="button" @click="bulkSetDifficulty(1)">★ 基础</button>
                    <button type="button" @click="bulkSetDifficulty(3)">★★ 中等</button>
                    <button type="button" @click="bulkSetDifficulty(5)">★★★ 较难</button>
                  </div>
                </div>
                <!-- 改标签 -->
                <div class="pb-bulk__dropdown">
                  <button
                    type="button" class="pb-bulk__btn"
                    :disabled="bulkBusy"
                    @click="showBulkTags = !showBulkTags; showBulkDifficulty = false"
                  >改标签</button>
                  <div v-if="showBulkTags" class="pb-bulk__popover pb-bulk__popover--tags">
                    <input
                      v-model="bulkTagsDraft"
                      class="pb-bulk__input"
                      placeholder="逗号分隔，如 压轴题,易错"
                      @keydown.enter.prevent="bulkSetTags"
                      @keydown.esc.prevent="showBulkTags = false"
                    />
                    <button type="button" class="pb-bulk__apply" :disabled="bulkBusy" @click="bulkSetTags">确定</button>
                  </div>
                </div>
                <!-- 移到题集 -->
                <button
                  type="button" class="pb-bulk__btn"
                  :disabled="bulkBusy || !papers.length"
                  @click="openBulkMovePicker($event)"
                >移到题集…</button>
                <!-- 删除 -->
                <button
                  type="button" class="pb-bulk__btn is-danger"
                  :disabled="bulkBusy"
                  @click="bulkDelete"
                >删除</button>
              </div>
            </div>
          </Transition>

          <FilterBar class="pb-filter">
            <template #leading>
              <div class="pb-summary">
                <el-checkbox
                  class="pb-summary__sel"
                  :model-value="selectionCount === questions.length && questions.length > 0"
                  :indeterminate="selectionCount > 0 && selectionCount < questions.length"
                  @change="(v) => v ? selectAll() : clearSelection()"
                  title="全选 / 取消全选（Ctrl+A）"
                />
                <strong>{{ questions.length }}{{ truncated ? '+' : '' }} 道题</strong>
                <span>已勾 {{ summary.count }} 题</span>
              </div>
            </template>
            <WorkbenchSelect v-model="filterType" :options="typeFilterOptions" width="100px" aria-label="按题型筛选" />
            <WorkbenchSelect v-model="filterDifficulty" :options="difficultyFilterOptions" width="100px" aria-label="按难度筛选" />
            <WorkbenchSelect v-model="filterTag" :options="tagFilterOptions" width="96px" aria-label="按标签筛选" />
            <WorkbenchInput v-model="filterQuestionNos" clearable placeholder="题号 19,24" width="112px" aria-label="按题号筛选" />
            <WorkbenchInput v-model="filterKeyword" clearable placeholder="搜索题干" width="124px" aria-label="搜索题干" />
            <template #actions><el-button text @click="resetFilters">重置</el-button></template>
          </FilterBar>

          <div v-if="loading" class="pb-loading"><el-skeleton v-for="i in 5" :key="i" :rows="2" animated /></div>

          <EmptyState
            v-else-if="!papers.length"
            :icon="Tickets"
            title="还没有题集"
            description="先建一个题集（一套卷或一个合集），再用 PDF 整份解析、或用截图逐道收题，都进同一个题集。"
          >
            <template #actions>
              <ActionButton variant="primary" @click="openCreateDialog"><el-icon><Plus /></el-icon>新建题集</ActionButton>
            </template>
          </EmptyState>

          <EmptyState
            v-else-if="!questions.length"
            :icon="Search"
            title="没有符合筛选条件的题目"
            :description="emptyHint"
          >
            <template #actions>
              <ActionButton @click="resetFilters">重置筛选</ActionButton>
              <ActionButton v-if="filterPaper !== 'all'" @click="pickPaper('all')">看全部题集</ActionButton>
            </template>
          </EmptyState>

          <div v-else class="pb-rows">
            <article v-for="(q, qi) in questions" :key="q.id" class="pb-row" :class="{ 'is-selected': isInBasket(basket, q.id), 'is-checked': selection.has(q.id), 'is-dragging-q': draggingQuestionId === q.id }">
              <div class="pb-row__checks">
                <!-- 多选复选框（2026-11-08 P0）：Ctrl+Click 逐个选、Shift+Click 范围选 -->
                <el-checkbox
                  class="pb-row__sel"
                  :model-value="selection.has(q.id)"
                  @click.stop="toggleSelection(q, qi, $event)"
                />
                <!-- 勾题进卷面（原有） -->
                <el-checkbox class="pb-row__check" :model-value="isInBasket(basket, q.id)" @change="toggle(q)" title="勾进卷面" />
              </div>

              <div class="pb-row__body">
                <div class="pb-row__head">
                  <span
                    class="pb-row__num pb-row__num--grip"
                    draggable="true"
                    title="按住拖到左边的题集上，就能改这道题的归属"
                    @dragstart="onQuestionDragStart($event, q)"
                    @dragend="onQuestionDragEnd"
                  >{{ questionLabel(q) }}</span>
                  <span class="pb-row__type">{{ typeLabel(q.question_type) }}</span>
                  <span v-if="q.difficulty" class="pb-row__diff">{{ stars(q.difficulty) }}</span>
                  <span v-for="t in (q.tags || [])" :key="t" class="pb-tag">{{ t }}</span>
                  <!-- 归属（2026-11-08）：题集名就是这道题的「文件夹」，点它就能换 ——
                       收题点错题集时不用删了重收（重收要再识别一次，白丢已校对的题干）。 -->
                  <button
                    type="button"
                    class="pb-row__paper pb-row__paper--btn"
                    title="点这里换题集（这道题现在在哪个文件夹）"
                    @click="openMovePicker(q, $event)"
                  >{{ q.resource_name }}<span class="pb-row__paper-swap" aria-hidden="true">⇄</span></button>
                </div>

                <!-- 题干在**同一道题的小问之间只显示一次**（2026-11-06）。
                     数据里 parent_stem 逐行冗余存储（每行都要能单独组卷），逐行渲染会让
                     「20(1) 表格 / 20(2) 同一张表格 / 20(3) 同一张表格」——负责人报障的
                     「三张表格」就是这个形态（当时是 recrop 的图片，图片撤掉后文字表格照样重复）。
                     判据只比「紧邻的上一行」：题号相同且题干逐字相同才隐藏，
                     所以筛选/搜索把同组打散时，每组第一条仍会正常显示题干。 -->
                <div v-if="rowShowStem(qi)" class="pb-row__stem">
                  <MathRender :content="q.parent_stem" auto-detect />
                </div>
                <div v-if="bodyText(q)" class="pb-row__text"><MathRender :content="bodyText(q)" auto-detect /></div>

                <!-- 原题裁片图行内展示（2026-11-01 负责人反馈：小拇指缩略图看不清几何图形，等于没图）。
                     数据里 64/64 题都有裁片图，此前只是展示位置太隐蔽。
                     同一道题的多个小问常常共用**同一张**图（字节相同、URL 相同）⇒ 只显示一次（rowShowFigure）。 -->
                <img v-if="rowShowFigure(qi)" class="pb-row__figure" :src="q.vec_url || thumbUrl(q.image_url)" alt="原题图" loading="lazy" />

                <div v-if="(q.options || []).length" class="pb-row__opts">
                  <span v-for="(o, i) in q.options" :key="i" class="pb-opt">
                    {{ String.fromCharCode(65 + i) }}.<MathRender :content="String(o)" auto-detect tag="span" force-inline />
                  </span>
                </div>

                <div v-if="q.answer" class="pb-row__answer">
                  <span class="pb-row__answer-label">参考答案</span>
                  <MathRender :content="q.answer" auto-detect tag="span" force-inline />
                  <em v-if="q.answer_source">{{ answerSourceLabel(q.answer_source) }}</em>
                  <em v-if="q.answer_conflict_count > 1" class="is-warn">
                    答案册里有 {{ q.answer_conflict_count }} 条同题号答案，需人工确认
                  </em>
                </div>
                <div v-else class="pb-row__answer is-empty">未录入参考答案</div>

                <!-- 来源（2026-11-07）：链接 + 时间点/说明两项。
                     B站/YouTube 链接带时间点会自动跳到那一秒；严格只认 http(s) 才渲染成链接。
                     任何题集的题都能补来源；没填的不占版面，用下方 foot 的「补来源」按钮唤起。 -->
                <div v-if="q.clip_source || q.clip_source_note || sourceEditingId === q.id" class="pb-row__source">
                  <span class="pb-row__source-label">来源</span>
                  <template v-if="sourceEditingId !== q.id">
                    <a
                      v-if="isSourceUrl(q.clip_source)"
                      :href="sourceHref(q.clip_source, q.clip_source_note)"
                      :title="q.clip_source"
                      target="_blank"
                      rel="noopener"
                      class="pb-link pb-row__source-link"
                    >打开链接 ↗</a>
                    <span v-else-if="q.clip_source" class="pb-row__source-text">{{ q.clip_source }}</span>
                    <span v-if="q.clip_source_note" class="pb-row__source-note">{{ q.clip_source_note }}</span>
                    <span v-if="!q.clip_source && !q.clip_source_note" class="pb-row__source-empty">未填</span>
                    <button type="button" class="pb-link" @click="startEditSource(q)">改来源</button>
                  </template>
                  <template v-else>
                    <div class="pb-row__source-edit">
                      <input
                        v-model="sourceDraftUrl"
                        class="pb-row__source-input"
                        type="text"
                        maxlength="500"
                        placeholder="来源链接 https://… 或一句话"
                        @keydown.enter.prevent="saveSource(q)"
                        @keydown.esc.prevent="sourceEditingId = ''"
                      />
                      <input
                        v-model="sourceDraftNote"
                        class="pb-row__source-input"
                        type="text"
                        maxlength="500"
                        placeholder="时间点 / 说明，如 12:35 讲到辅助线"
                        @keydown.enter.prevent="saveSource(q)"
                        @keydown.esc.prevent="sourceEditingId = ''"
                      />
                    </div>
                    <button type="button" class="pb-link" @click="saveSource(q)">保存</button>
                    <button type="button" class="pb-link" @click="sourceEditingId = ''">取消</button>
                  </template>
                </div>

                <div class="pb-row__foot">
                  <button type="button" class="pb-link" @click="toggleEditor(q.id)">
                    {{ editingId === q.id ? '收起编辑' : '改难度 / 标签' }}
                  </button>
                  <!-- 归属修正入口（2026-11-08）：常显不隐藏 —— 这是老师「收错了要返工」的唯一出路，
                       藏进 hover 只会让人继续删了重收。 -->
                  <button
                    type="button"
                    class="pb-link"
                    title="把这道题移到另一个题集"
                    @click="openMovePicker(q, $event)"
                  >移到题集…</button>
                  <!-- 2026-11-07：配图提不出干净几何图时 image_url 为空，原截图仍必须能点开回看 -->
                  <a v-if="q.image_url || q.page_image_url" class="pb-link" :href="q.image_url || q.page_image_url" target="_blank" rel="noopener">{{ q.image_url ? '看原题图' : '看原截图' }}</a>
                  <!-- 原卷是整份上传文件；PDF 直接跳到本题所在页，多张照片按页码选对应那张 -->
                  <a
                    v-if="questionSourceUrl(q)"
                    class="pb-link"
                    :href="questionSourceUrl(q)"
                    target="_blank"
                    rel="noopener"
                  >看原卷{{ q.page_no ? `（第 ${q.page_no} 页）` : '' }} ↗</a>
                  <button
                    v-if="!q.clip_source && !q.clip_source_note && sourceEditingId !== q.id"
                    type="button"
                    class="pb-link"
                    @click="startEditSource(q)"
                  >补来源</button>
                  <!-- 2026-11-07：题集是持续累积的（PDF 与截图都追加），所有题都允许单条删除，
                       带二次确认。默认不显现，鼠标移到题目行才出现。 -->
                  <button
                    type="button"
                    class="pb-link is-danger pb-link--quiet"
                    @click="askDeleteQuestion(q)"
                  >删除本题</button>
                </div>

                <div v-if="editingId === q.id" class="pb-editor">
                  <label>难度
                    <select :value="q.difficulty == null ? '' : String(q.difficulty)" @change="saveDifficulty(q, $event)">
                      <option value="">未判定</option>
                      <option value="1">★ 基础</option>
                      <option value="3">★★ 中等</option>
                      <option value="5">★★★ 较难</option>
                    </select>
                  </label>
                  <label class="pb-editor__tags">标签
                    <input :value="(q.tags || []).join(',')" placeholder="逗号分隔，如 压轴题,易错" @change="saveTags(q, $event)" />
                  </label>
                  <!-- OCR 会认错字（嘉定一模 23(2) 曾把 AC·DF 认成 AC²-DE²），老师要能就地改文字 -->
                  <label v-if="q.parent_stem != null" class="pb-editor__text">公共题干
                    <textarea v-model="textDraft.parent_stem" rows="3" />
                  </label>
                  <label class="pb-editor__text">题目文字
                    <textarea v-model="textDraft.content" rows="3" />
                  </label>
                  <button type="button" class="pb-link pb-editor__save" @click="saveText(q)">保存文字</button>
                  <span class="pb-editor__hint">改完立刻保存，全库筛选项跟着变</span>
                </div>
              </div>
            </article>

            <button v-if="truncated" type="button" class="pb-more" @click="loadMore">
              还有更多题，点这里再多加载 200 道
            </button>
          </div>
        </main>

        <!-- 右：试卷（常驻，勾题即长出来；每题可删、分值可点改） -->
        <aside
          class="pb-col pb-col--paper"
          :class="{
            'is-full': paperFull,
            'is-fixed': narrow && !paperFull,
            'is-collapsed': paperCollapsed && !paperFull,
          }"
          :style="narrow && !paperFull ? fixedStyle : null"
        >
          <div class="pb-drag" title="拖动调整卷面宽度" @mousedown="startDrag" />

          <div class="pb-paper-panel">
            <div class="pb-paper-panel__head">
              <button
                v-if="narrow"
                type="button"
                class="pb-icon-btn"
                :title="paperCollapsed ? '展开卷面' : '收起卷面'"
                @click="paperCollapsed = !paperCollapsed"
              >{{ paperCollapsed ? '▴' : '▾' }}</button>
              <div class="pb-tabs">
                <button
                  v-for="t in PREVIEW_TABS"
                  :key="t.key"
                  type="button"
                  class="pb-tab"
                  :class="{ 'is-active': previewKind === t.key }"
                  @click="switchPreviewKind(t.key)"
                >{{ t.label }}</button>
              </div>
              <div class="pb-paper-panel__ops">
                <span class="pb-paper-panel__meta">{{ paperMeta }}</span>
                <button type="button" class="pb-icon-btn" title="缩小" @click="setZoom(-0.1)">−</button>
                <button type="button" class="pb-icon-btn pb-icon-btn--pct" title="恢复「适应宽度」" @click="fitZoom(true)">
                  {{ Math.round(zoom * 100) }}%
                </button>
                <button type="button" class="pb-icon-btn" title="放大" @click="setZoom(0.1)">＋</button>
                <button type="button" class="pb-icon-btn" :title="paperFull ? '还原' : '全屏看卷子'" @click="paperFull = !paperFull">
                  {{ paperFull ? '⤡' : '⤢' }}
                </button>
              </div>
            </div>

            <div class="pb-paper-panel__form">
              <label class="pb-field">
                <span>卷名</span>
                <input v-model="composeTitle" placeholder="如：周末练习（三）" />
              </label>
              <label class="pb-check"><input v-model="composeWithImage" type="checkbox" />印原题图</label>
              <button type="button" class="pb-link" :disabled="!summary.count" @click="clearBasket">清空</button>
              <el-button type="primary" size="small" :loading="downloading" :disabled="!summary.count" @click="downloadPdf">
                下载 PDF
              </el-button>
            </div>

            <div ref="stageRef" class="pb-paper-panel__stage">
              <iframe
                v-show="summary.count"
                ref="previewFrame"
                class="pb-paper-panel__frame"
                title="卷面预览"
                sandbox="allow-same-origin allow-scripts"
              />
              <div v-if="!summary.count" class="pb-paper-panel__blank">
                <p>勾选的题会实时出现在这里</p>
                <span>卷面可滚动；题目上悬停出现 × 可以删掉</span>
              </div>
              <div v-if="repainting && summary.count" class="pb-paper-panel__mask">
                <span class="pb-spinner" aria-hidden="true"></span>
                <span>重排中…</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <!-- 新建题集：一套卷或一个预设合集，PDF 与截图都往它里面加题 -->
    <el-dialog v-model="showCreateDialog" title="新建题集" width="440px">
      <el-form :model="createForm" label-width="72px">
        <el-form-item label="名称">
          <WorkbenchInput v-model="createForm.name" placeholder="如：2026 黄浦一模·数学 / 马哥相似三角形" aria-label="题集名称" />
        </el-form-item>
        <el-form-item label="年级">
          <WorkbenchInput v-model="createForm.grade" placeholder="如：初三" aria-label="年级" />
        </el-form-item>
        <el-form-item label="科目">
          <WorkbenchInput v-model="createForm.subject" placeholder="如：数学" aria-label="科目" />
        </el-form-item>
        <el-form-item label="考试日期">
          <el-date-picker v-model="createForm.examDate" type="date" value-format="YYYY-MM-DD" placeholder="选填" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreatePaper">创建并加题</el-button>
      </template>
    </el-dialog>

    <!-- PDF 加题：默认追加到所选题集，绝不覆盖已收的题 -->
    <el-dialog v-model="showUploadDialog" :title="uploadMode === 'answers' ? '上传官方答案' : 'PDF 加题'" width="520px">
      <p v-if="uploadMode === 'answers'" class="pb-hint">
        上传这份卷子的<strong>官方答案</strong>（PDF 或答案页照片）。答案会存进答案库并标为「官方」，
        出教师卷时优先用它，<strong>不会用 AI 猜</strong>。答案按<strong>题号</strong>与题目自动对上。
      </p>
      <p v-else class="pb-hint">
        支持 <strong>PDF</strong>（推荐，无拍照变形）或 <strong>多张照片</strong>（JPEG / PNG / WebP）。
        题目会<strong>追加到所选的题集</strong>，题号自动往后接，不会覆盖之前用 PDF 或截图收的题。
        你上传的文件会<strong>原样留档</strong>，之后在题集名下方点「原卷」就能打开。
      </p>
      <WorkbenchSelect v-model="uploadPaperId" :options="uploadPaperOptions" width="100%" aria-label="选择要加进的题集" />
      <label v-if="uploadMode === 'questions'" class="pb-replace-opt">
        <input v-model="replaceExisting" type="checkbox" />
        <span>重新解析：先清空这个题集的全部题目再导入（默认不勾＝追加）</span>
      </label>
      <input ref="fileInput" type="file" multiple accept=".pdf,image/jpeg,image/png,image/webp" style="display:none" @change="onFilesPicked" />
      <div class="pb-upload-actions">
        <el-button :disabled="!uploadPaperId" @click="fileInput?.click()">选择文件</el-button>
        <span v-if="pickedFiles.length" class="pb-picked">已选 {{ pickedFiles.length }} 个文件</span>
      </div>
      <template #footer>
        <el-button @click="showUploadDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!uploadPaperId || !pickedFiles.length" :loading="uploading" @click="handleUpload">开始解析</el-button>
      </template>
    </el-dialog>

    <!-- 截图加题：与 PDF 加题并列，都写进老师选中的题集 -->
    <WorkbenchDialog
      v-model="showClipDialog"
      title="截图加题"
      width="560px"
      :loading="clipUploading"
      @closed="resetClipDialog"
    >
      <p class="pb-hint">
        看到好题直接截图，回到这里按 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘进来（也可以拖图、或点下面选文件）。
        识别后<strong>追加到下面选中的题集</strong>，题号自动往后接，不会覆盖之前收的题。
        认不出文字的截图也会按图存下来，之后在题目里补字就行。
        每张图下面可以填<strong>来源链接</strong>和<strong>时间点 / 说明</strong>（如「12:35 讲到辅助线」）；
        B站、YouTube 的链接填了时间点，点开会直接跳到那一秒。
        <strong>不想填也行</strong>：截图时把浏览器地址栏和播放器进度条一起截进来，
        系统会自动读出网址和时间卡点填好；手填的不会被覆盖。入库后在题目行也能补改。
      </p>
      <WorkbenchSelect v-model="clipTargetPaperId" :options="uploadPaperOptions" width="100%" aria-label="选择要加进的题集" style="margin-bottom:12px" />
      <div
        class="pb-clip-drop"
        :class="{ 'is-over': clipDragOver }"
        role="button"
        tabindex="0"
        @click="clipInput?.click()"
        @keydown.enter.prevent="clipInput?.click()"
        @dragover.prevent="clipDragOver = true"
        @dragleave.prevent="clipDragOver = false"
        @drop.prevent="onClipDrop"
      >
        <strong>粘贴 / 拖图 / 点这里选图</strong>
        <span>PNG · JPEG · WebP，一次最多 12 张</span>
      </div>
      <input ref="clipInput" type="file" multiple accept="image/png,image/jpeg,image/webp" style="display:none" @change="onClipPicked" />
      <div v-if="clipFiles.length" class="pb-clip-grid">
        <figure v-for="(f, i) in clipFiles" :key="f.key" class="pb-clip-item">
          <div class="pb-clip-item__img">
            <img :src="f.preview" :alt="`待识别截图 ${i + 1}`" />
            <button type="button" class="pb-clip-item__del" title="移除这张" @click.stop="removeClipFile(i)">×</button>
          </div>
          <input
            v-model="f.source"
            class="pb-clip-item__src"
            type="text"
            maxlength="500"
            :placeholder="`第 ${i + 1} 张来源：URL 或文字（可不填）`"
          />
          <input
            v-model="f.note"
            class="pb-clip-item__src pb-clip-item__src--note"
            type="text"
            maxlength="500"
            placeholder="时间点 / 说明，如 12:35 讲到辅助线"
          />
        </figure>
      </div>
      <p v-if="clipFiles.length" class="pb-clip-count">已选 {{ clipFiles.length }} 张，识别完会自动切到刚加题的题集</p>
      <template #footer>
        <ActionButton variant="ghost" :disabled="clipUploading" @click="showClipDialog = false">取消</ActionButton>
        <ActionButton variant="primary" :disabled="!clipFiles.length || !clipTargetPaperId" :loading="clipUploading" @click="handleClipUpload">
          开始识别
        </ActionButton>
      </template>
    </WorkbenchDialog>

    <!-- 多份原件（一次上传多张照片/多个 PDF 时）逐份列出，点文件名直接打开 -->
    <el-dialog v-model="showFilesDialog" :title="filesDialog.title" width="440px">
      <p class="pb-hint">这些都是你上传的原件，点文件名在新标签页打开。</p>
      <div class="pb-file-list">
        <a
          v-for="(f, i) in filesDialog.files"
          :key="f.url"
          class="pb-file-item"
          :href="f.url"
          target="_blank"
          rel="noopener"
        >
          <span :title="f.name">{{ f.name || `第 ${i + 1} 份` }}</span>
          <span>{{ f.kind === 'pdf' ? 'PDF' : '图片' }} ↗</span>
        </a>
      </div>
    </el-dialog>

    <!-- 双模型读法不一致：不自动改，列出来让老师点原卷核对后就地修正 -->
    <el-dialog v-model="showReviewDialog" :title="reviewDialog.title" width="640px">
      <p class="pb-hint">
        两个模型对同一处卷面字符抄得不一样，系统没有替你猜。请点「打开原卷」对照卷面，
        再在该题「改难度 / 标签」里用文本框就地改正。
      </p>
      <div class="pb-review-list">
        <div v-for="(it, i) in reviewDialog.items" :key="i" class="pb-review-item">
          <div class="pb-review-item__head">
            <strong>第 {{ it.page_no }} 页 · 第 {{ it.question_no }} 题{{ it.sub_no ? '(' + it.sub_no + ')' : '' }} · {{ it.field }}</strong>
            <a
              v-if="questionSourceUrl({ resource_id: reviewDialog.paper?.id, page_no: it.page_no })"
              :href="questionSourceUrl({ resource_id: reviewDialog.paper?.id, page_no: it.page_no })"
              target="_blank"
              rel="noopener"
            >打开原卷 ↗</a>
          </div>
          <div>库里：<code>{{ it.ocr_text }}</code></div>
          <div>候选：<code>{{ it.suggested_text }}</code><span v-if="it.arbiter_text"> ｜ 最强模型抄作 <code>{{ it.arbiter_text }}</code></span></div>
          <div v-if="it.reason" class="pb-review-item__reason">{{ it.reason }}</div>
        </div>
      </div>
    </el-dialog>

    <!-- 题号清点：卷面有 / 库里没有 = 漏题；库里多出 = 串号。明细按页列，可直达原卷 -->
    <el-dialog v-model="showCoverageDialog" :title="coverageDialog.title" width="680px">
      <p class="pb-hint">
        「漏题」= 卷面印了这个题号、库里没有对应题目（出卷时会整题缺失）；
        「多出」= 库里该页有这个题号、卷面这页找不到（通常是题号串位）。
        系统只报告差异、不自动补录——补录需要重新识别该页。
      </p>
      <p v-if="(coverageDialog.shifted || []).length" class="pb-hint">
        <strong>题干跨页（不算漏题）</strong>：这几个题号印刷在上一页、正文承接到下一页，
        库里按正文所在页记录，所以上一页看起来「少一个」。
        {{ coverageDialog.shifted.map(s => `题${s.no} 印刷第${s.printedPage}页 / 正文第${s.dbPage}页`).join('；') }}
      </p>
      <div class="pb-review-list">
        <div v-for="(row, i) in coverageDialog.rows" :key="i" class="pb-review-item">
          <div class="pb-review-item__head">
            <strong>第 {{ row.page }} 页</strong>
            <span v-if="row.unverified" class="pb-review-item__reason">这一页清点没跑成，未核对</span>
            <span v-else-if="row.continuation" class="pb-review-item__reason">续页（本页无大题号），跳过</span>
            <a
              v-else-if="questionSourceUrl({ resource_id: coverageDialog.paper?.id, page_no: row.page })"
              :href="questionSourceUrl({ resource_id: coverageDialog.paper?.id, page_no: row.page })"
              target="_blank"
              rel="noopener"
            >打开原卷 ↗</a>
          </div>
          <div v-if="!row.unverified && !row.continuation">
            卷面：<code>{{ (row.printed || []).join('、') || '（无）' }}</code>
            ｜ 库里：<code>{{ (row.db || []).join('、') || '（无）' }}</code>
            <div v-if="(row.missing || []).length" class="pb-review-item__reason">
              ⛔ 漏题：{{ row.missing.join('、') }}（卷面有、库里没有）
            </div>
            <div v-if="(row.extra || []).length" class="pb-review-item__reason">
              ⚠ 多出：{{ row.extra.join('、') }}（库里这页有、卷面没有）
            </div>
            <div v-if="shiftedForPage(row.page).length" class="pb-review-item__reason">
              {{ shiftedForPage(row.page).map(s => `题${s.no} 的正文承接到第${s.dbPage}页`).join('；') }}（不算漏题）
            </div>
            <div v-if="incomingForPage(row.page).length" class="pb-review-item__reason">
              {{ incomingForPage(row.page).map(s => `题${s.no} 的题号印在第${s.printedPage}页`).join('；') }}（正文在本页，不算多出）
            </div>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 单题改归属（2026-11-08）：选择器只负责「选哪个题集」，写库在 doMoveQuestion -->
    <MoveQuestionPicker
      :open="movePicker.open"
      :papers="papers"
      :current-paper-id="movePicker.q ? movePicker.q.resource_id : ''"
      :anchor="movePicker.anchor"
      @pick="doMoveQuestion"
      @close="closeMovePicker"
    />

    <!-- 批量移到题集（2026-11-08 P0）-->
    <MoveQuestionPicker
      :open="bulkMovePicker.open"
      :papers="papers"
      current-paper-id=""
      :anchor="bulkMovePicker.anchor"
      @pick="bulkMoveToTarget"
      @close="closeBulkMovePicker"
    />

    <!-- 移动后可撤销：比弹二次确认更不打断，且真点错了能一步退回 -->
    <div v-if="undoMove" class="pb-undo" role="status">
      <span class="pb-undo__text">
        已移到「{{ undoMove.paperName }}」<em v-if="undoMove.hidden">，本页不再显示</em>
        <em v-if="undoMove.count > 1">（整题 {{ undoMove.count }} 个小问一起搬）</em>
      </span>
      <button type="button" class="pb-undo__btn" @click="undoLastMove">撤销</button>
      <button type="button" class="pb-undo__close" title="关闭" aria-label="关闭" @click="undoMove = null">×</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Plus, UploadFilled, Search, Tickets, Camera } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '../components/ui/PageHeader.vue'
import FilterBar from '../components/ui/FilterBar.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ActionButton from '../components/ui/ActionButton.vue'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'
import WorkbenchDialog from '../components/ui/WorkbenchDialog.vue'
import MathRender from '../components/MathRender.vue'
import PaperBankTree from '../components/paperBank/PaperBankTree.vue'
import MoveQuestionPicker from '../components/paperBank/MoveQuestionPicker.vue'
import {
  getPaperBankPapers,
  createPaperBankPaper,
  deletePaperBankPaper,
  deletePaperBankPapers,
  parsePaperBankPaper,
  parsePaperBankAnswers,
  uploadPaperClips,
  deletePaperBankQuestion,
  movePaperBankQuestions,
  restorePaperBankQuestions,
  searchPaperBankQuestions,
  updatePaperBankQuestion,
  updatePaperClipSource,
  bulkUpdatePaperBankQuestions,
  bulkDeletePaperBankQuestions,
} from '../../services/apiService.js'
import { buildHandoutBody, buildHandoutCSS, groupHandoutQuestions } from '../../utils/handoutPdf'
import { buildComposePaperBody, buildComposePaperCSS } from '../../utils/composePaperPdf'
import { buildLectureBody, buildLectureCSS, LECTURE_PAGE_MM, LECTURE_PAGE_PX } from '../../utils/lecturePdf'
import {
  addBasketItem,
  removeBasketItem,
  setBasketItemScore,
  isInBasket,
  groupBasket,
  basketSummary,
  composePaperTotals,
  composePaperFilename,
} from '../../utils/paperBasket'
import { renderCustomBodyToHTML, exportServerPDF, paintPreviewIntoIframe } from '../../utils/serverPdfExporter'
import { ossThumbUrl } from '../../utils/ossThumb'
import { showStem, bodyText, showFigure } from '../utils/paperRowDisplay.js'
import { isSourceUrl, sourceHref } from '../utils/clipSource.js'

const PAGE_SIZE = 200

const papers = ref([])
const questions = ref([])
const loading = ref(false)
const creating = ref(false)
const uploading = ref(false)
const truncated = ref(false)
const limit = ref(PAGE_SIZE)

const filterPaper = ref('all')
const filterQuestionNos = ref('')
const filterType = ref('all')
const filterDifficulty = ref('all')
const filterTag = ref('all')
const filterKeyword = ref('')
const tagOptions = ref([])

// 试题篮（前端状态，不落库）。卷面就是篮子 —— 不再有单独的篮子面板。
const basket = ref([])
const composeTitle = ref('')
// 印原题图默认开启（2026-11-01 负责人反馈：四个版式预览/下载都没配图）。
// 几何/图表题没有图根本没法讲；文字已完整的题多印一张小裁片也无碍。想不印手动取消勾选。
const composeWithImage = ref(true)
const editingId = ref('')
const textDraft = ref({ parent_stem: '', content: '' })

// ── 批量操作（2026-11-08 P0）──
// 多选模式：Ctrl+Click 逐个、Shift+Click 范围选、Ctrl+A 全选。
// 选中 ≥1 题时顶部出现批量操作工具栏，遮住筛选条。
const selection = ref(new Set())
const lastClickedIndex = ref(-1)
const bulkBusy = ref(false)
const showBulkDifficulty = ref(false)
const showBulkTags = ref(false)
const showBulkMove = ref(false)
const bulkTagsDraft = ref('')
const showFilesDialog = ref(false)
const filesDialog = ref({ title: '', files: [] })
const showReviewDialog = ref(false)
const reviewDialog = ref({ title: '', paper: null, items: [] })
const showCoverageDialog = ref(false)
const coverageDialog = ref({ title: '', paper: null, rows: [], shifted: [] })

// 右侧卷面（常驻，和题目列表同一页）
const previewKind = ref('student')
const previewFrame = ref(null)
const stageRef = ref(null)
const zoom = ref(1)
const userZoomed = ref(false)
const previewPages = ref(0)
const repainting = ref(false)
const downloading = ref(false)
const paperFull = ref(false)
// 窄屏（≤1239px）放不下「列表 + 可读的卷面」并排 ⇒ 卷面改成整宽的底部常驻面板，可收起。
const narrow = ref(false)
const paperCollapsed = ref(false)
// 卷面栏初始宽度：按窗口宽度取，窄屏别把题目列表挤死（老师随时可拖宽）
const previewWidth = ref(Math.round(Math.min(620, Math.max(560, (window.innerWidth || 1440) * 0.30))))
const PREVIEW_TABS = [
  { key: 'student', label: '练习卷' },
  { key: 'teacher', label: '教师卷' },
  { key: 'handout', label: '讲义' },
  // 讲解版（2026-11-01 负责人拍板）：一小问一页、横版 4:3，给 iPad 笔记软件手写板书用
  { key: 'lecture', label: '讲解版' },
]

// 预览舞台样式（注入 iframe 文档）：灰底 + 居中白纸 + 每题悬停出现「×」、分值可点改。
// ⛔ 灰底/阴影/删除按钮绝不能写进 buildPaperCSS —— 那是打印样式，纸上不该有这些。
const PREVIEW_STAGE_CSS = `
html,body{background:#e6e4de}
body{padding:14px 0 28px}
.page{background:#fff;margin:0 auto;box-shadow:0 1px 10px rgba(0,0,0,.14)}
/* 讲解版页面（横版 4:3）：白纸观感与删除按钮，只在预览舞台生效，不进打印版式 */
.lec-page{margin:0 auto 14px;box-shadow:0 1px 10px rgba(0,0,0,.14)}
.lec-page > .pb-del{position:absolute;right:8px;top:8px;width:22px;height:22px;line-height:20px;
  padding:0;border:1px solid #E6C9C9;background:#fff;color:#B4436C;border-radius:50%;font-size:13px;
  cursor:pointer;opacity:0;transition:opacity .12s}
.lec-page:hover > .pb-del{opacity:1}
.lec-page > .pb-del:hover{background:#FDECEF;border-color:#D4537E}
.question{position:relative}
.question > .pb-del{
  position:absolute;right:0;top:0;width:18px;height:18px;line-height:16px;padding:0;
  border:1px solid #E6C9C9;background:#fff;color:#B4436C;border-radius:50%;
  font-size:12px;cursor:pointer;opacity:0;transition:opacity .12s;
}
.question:hover > .pb-del{opacity:1}
.question > .pb-del:hover{background:#FDECEF;border-color:#D4537E}
.q-score{cursor:pointer;border-bottom:1px dashed #C9C6BE}
.q-score:hover{color:#185FA5;border-bottom-color:#185FA5}
.pb-score-input{width:46px;font-size:11px;padding:0 3px;border:1px solid #185FA5;border-radius:3px;text-align:right}
.question-group:has(> .question:hover) .q-stem{background:#fbfbfd}
`

const showCreateDialog = ref(false)
const showUploadDialog = ref(false)
const createForm = ref({ name: '', grade: '', subject: '数学', examDate: null })
const uploadPaperId = ref('')
// 'questions' = 题目 PDF/照片（进 resource_questions）；'answers' = 官方答案（进答案库）
const uploadMode = ref('questions')
// 2026-11-07：默认追加；只有老师显式勾「重新解析」才整卷重建（后端据此选 append / replace）
const replaceExisting = ref(false)
const pickedFiles = ref([])
const fileInput = ref(null)

// ── 截图加题（2026-11-06 加，11-07 改模型）──
// 题集是唯一归属：截图和 PDF 一样写进老师选中的那个题集，不再有固定「截图题库」卷。
const clipTargetPaperId = ref('')
const showClipDialog = ref(false)
const clipFiles = ref([]) // { key, file, preview, source }（2026-11-07 每张截图可填来源）
const clipInput = ref(null)
const clipDragOver = ref(false)
const clipUploading = ref(false)
const CLIP_MAX_FILES = 12 // 与服务端 CLIP_MAX_IMAGES 对齐，前端先挡一层

// 来源行内编辑：链接 + 时间点/备注两项，按 page_no 共享；任何题集的题都能补/改。
// URL 安全判据与跳转链接生成统一在 workbench/utils/clipSource.js，页面不另写一套。
const sourceEditingId = ref('')
const sourceDraftUrl = ref('')
const sourceDraftNote = ref('')
let clipSeq = 0
let clipPollTimer = null

let pollTimer = null
let repaintTimer = null
let repaintToken = 0

const totalQuestionCount = computed(() => papers.value.reduce((n, p) => n + (p.question_count || 0), 0))
// 题目行要按所属题集找「原卷」入口；字段名与后端 /api/paper-bank/papers 逐字一致
const papersById = computed(() => new Map(papers.value.map(p => [p.id, p])))
// 选中某个题集时，左侧底部展示它的原卷 / 答案 / 复核状态；树本身只负责导航。
const activePaper = computed(() => (
  filterPaper.value === 'all' ? null : (papersById.value.get(filterPaper.value) || null)
))
// 2026-11-07：题集一律按后端 created_at DESC 展示，不再有「截图题库」置顶这一特殊分类。
// 加题入口的默认目标：当前左侧选中的题集，没选就取最近建的那个。
const defaultPaperId = () => (filterPaper.value !== 'all' ? filterPaper.value : (papers.value[0]?.id || ''))
const blocks = computed(() => groupBasket(basket.value))
const summary = computed(() => basketSummary(basket.value))
const totals = computed(() => composePaperTotals(blocks.value))

const uploadPaperOptions = computed(() => papers.value.map(p => ({ label: p.name, value: p.id })))
const typeFilterOptions = [
  { label: '全部题型', value: 'all' },
  { label: '选择题', value: 'choice' },
  { label: '填空题', value: 'fill' },
  { label: '判断题', value: 'judge' },
  { label: '解答题', value: 'answer' },
]
const difficultyFilterOptions = [
  { label: '全部难度', value: 'all' },
  { label: '★ 基础', value: '1' },
  { label: '★★ 中等', value: '3' },
  { label: '★★★ 较难', value: '5' },
]
const tagFilterOptions = computed(() => ([
  { label: '全部标签', value: 'all' },
  ...tagOptions.value.map(t => ({ label: t, value: t })),
]))

// 筛选后为空时给可行动提示（⛔ 不能只写「没有题目」）
const emptyHint = computed(() => {
  const bits = []
  if (filterPaper.value !== 'all') bits.push('只看当前这个题集')
  if (filterType.value !== 'all') bits.push('指定了题型')
  if (filterDifficulty.value !== 'all') bits.push('指定了难度')
  if (filterTag.value !== 'all') bits.push('指定了标签')
  if (filterQuestionNos.value) bits.push('填了题号')
  if (filterKeyword.value) bits.push('搜了题干关键字')
  if (!bits.length) return '这个题集还没有题目，用「PDF 加题」或「截图加题」往里收题。'
  return `当前条件（${bits.join('、')}）下没有题。题库里难度标签大多还没补，先把难度改成「全部难度」再看。`
})

const isParsing = (p) => p.question_parse_status === 'parsing' || p.parse_status === 'parsing'

const questionLabel = (q) => (q.question_no == null ? '?' : `${q.question_no}${q.sub_no ? `(${q.sub_no})` : ''}.`)
// 题干/正文/配图在同组小问之间的去重判据（2026-11-06）：
// parent_stem 与配图都是逐行冗余存储，逐行渲染会把同一段材料、同一幅图印 N 遍。
// ⛔ 判据只在 utils/paperRowDisplay.js 里有一份，这里只做「绑定当前列表」的薄封装。
const rowShowStem = (i) => showStem(questions.value, i)
const rowShowFigure = (i) => showFigure(questions.value, i)
const typeLabel = (t) => ({ choice: '选择题', fill: '填空题', judge: '判断题', answer: '解答题' }[t] || '解答题')
const stars = (d) => '★'.repeat(Math.max(1, Math.min(3, d <= 2 ? 1 : d === 3 ? 2 : 3)))
// 列表缩略图走统一入口（OSS 追加 resize 参数），⛔ 不直接引原图
const thumbUrl = (url) => ossThumbUrl(url, 480) || url

// 答案来源四态：官方答案库 / 卷面印刷 / 老师手填 / AI 解出。
// ⛔ 必须在界面上区分 —— 「答案一定要对，不要去猜」，老师要能一眼看出这条答案是谁给的。
const ANSWER_SOURCE_LABELS = { official: '官方答案', printed: '卷面印刷', manual: '老师手填', ai: 'AI 解出' }
const answerSourceLabel = (s) => (ANSWER_SOURCE_LABELS[s] ? `（${ANSWER_SOURCE_LABELS[s]}）` : '')

// ── 上传原件（2026-11-06）：题目原件与答案原件分开放，卷级可点，题级直达本题页 ──
const openSourceFiles = (p, kind) => {
  const files = kind === 'questions' ? (p.question_files || []) : (p.answer_files || [])
  if (!files.length) return
  if (files.length === 1) {
    window.open(files[0].url, '_blank', 'noopener')
    return
  }
  filesDialog.value = {
    title: `${p.name} · ${kind === 'questions' ? '原卷文件' : '答案原件'}（${files.length} 份）`,
    files,
  }
  showFilesDialog.value = true
}

const openOcrReview = (p) => {
  reviewDialog.value = {
    title: `${p.name} · OCR 待核对（${p.ocr_review.length} 处）`,
    paper: p,
    items: p.ocr_review || [],
  }
  showReviewDialog.value = true
}

/** 题目行「看原卷」：单份 PDF 加 #page= 跳到本题所在页；多张照片按页码取对应那张。 */
const questionSourceUrl = (q) => {
  // 从别的题集搬过来的题（2026-11-08）：page_no 已清空、原卷文件挂在**原题集**上，
  // 跟着新 resource_id 去找只会指向目标题集的原卷 —— 宁可不出这个入口，也不给错页。
  if (q.moved_in) return ''
  const files = papersById.value.get(q.resource_id)?.question_files || []
  if (!files.length) return ''
  if (files.length === 1) {
    const f = files[0]
    return f.kind === 'pdf' && q.page_no ? `${f.url}#page=${q.page_no}` : f.url
  }
  const idx = Math.min(Math.max((Number(q.page_no) || 1) - 1, 0), files.length - 1)
  return files[idx]?.url || files[0].url
}

const loadPapers = async () => {
  papers.value = await getPaperBankPapers()
}

// ── 逐页题号清点（2026-11-06）：漏题/串号必须在卷列表上一眼可见 ──
// ⛔ 徽标只读 coverage_summary（后端算好的计数），明细走 coverage_audit.pages；
//    字段名与 routes/paperBank.js 的 withSourceFiles 逐字对齐。
const coverageIssueCount = (p) => (p.coverage_summary?.missingCount || 0) + (p.coverage_summary?.extraCount || 0)
const coverageTitle = (p) => {
  const s = p.coverage_summary || {}
  const bug = []
  if (s.missingCount) bug.push(`卷面印了 ${s.missingCount} 个题号但库里没有（漏题）`)
  if (s.extraCount) bug.push(`库里多出 ${s.extraCount} 个卷面找不到的题号（串号）`)
  return `逐页题号清点：${bug.join('；')}。点开看明细`
}
// 干净卷的正向说明：说清「核了几页」，并解释跨页承接不算问题
const coverageOkTitle = (p) => {
  const s = p.coverage_summary || {}
  const bits = [`已逐页清点 ${s.pagesChecked || 0} 页卷面题号，与库里全部对得上`]
  if (s.pagesContinuation) bits.push(`${s.pagesContinuation} 页是续页（本页无题号）`)
  if (s.shiftedCount) bits.push(`${s.shiftedCount} 题题干跨到下一页承接，不算漏题`)
  if (s.at || p.coverage_audit?.at) bits.push('点开看明细')
  return bits.join('；')
}
// 某页上「卷面印了题号、正文承接到下一页」的题（不算漏题）
const shiftedForPage = (page) => (coverageDialog.value.shifted || []).filter(s => Number(s.printedPage) === Number(page))
// 反向：题号印在上一页、正文在本页的题（所以本页「库里多一个」也不算出错）
const incomingForPage = (page) => (coverageDialog.value.shifted || []).filter(s => Number(s.dbPage) === Number(page))

const openCoverage = (p) => {
  coverageDialog.value = {
    paper: p,
    title: `${p.name} · 题号清点`,
    rows: p.coverage_audit?.pages || [],
    shifted: p.coverage_summary?.shifted || [],
  }
  showCoverageDialog.value = true
}

const buildQuery = () => ({
  resourceIds: filterPaper.value === 'all' ? undefined : [filterPaper.value],
  questionNos: filterQuestionNos.value
    ? String(filterQuestionNos.value).split(/[,，\s]+/).map(Number).filter(Number.isFinite)
    : undefined,
  questionTypes: filterType.value === 'all' ? undefined : [filterType.value],
  difficulties: filterDifficulty.value === 'all' ? undefined : [Number(filterDifficulty.value)],
  tags: filterTag.value === 'all' ? undefined : [filterTag.value],
  keyword: filterKeyword.value || undefined,
  // 多取一条用来判断「还有更多」
  limit: limit.value + 1,
})

const loadQuestions = async () => {
  loading.value = true
  try {
    const rows = await searchPaperBankQuestions(buildQuery())
    truncated.value = rows.length > limit.value
    const list = truncated.value ? rows.slice(0, limit.value) : rows
    questions.value = list
    // 标签候选从当前结果里收（题库的标签是自由文本，没有字典表）
    const set = new Set(tagOptions.value)
    for (const q of list) for (const t of (q.tags || [])) set.add(t)
    tagOptions.value = Array.from(set).filter(Boolean).sort()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '题目加载失败')
    questions.value = []
    truncated.value = false
  } finally {
    loading.value = false
  }
}

const loadMore = () => {
  limit.value += PAGE_SIZE
  loadQuestions()
}

const pickPaper = (id) => {
  filterPaper.value = id
  limit.value = PAGE_SIZE
  loadQuestions()
}

const resetFilters = () => {
  filterType.value = 'all'
  filterDifficulty.value = 'all'
  filterTag.value = 'all'
  filterQuestionNos.value = ''
  filterKeyword.value = ''
  limit.value = PAGE_SIZE
  loadQuestions()
}

// ── 试题篮 ──

const toggle = (q) => {
  basket.value = isInBasket(basket.value, q.id)
    ? removeBasketItem(basket.value, q.id)
    : addBasketItem(basket.value, q)
  if (!composeTitle.value.trim()) composeTitle.value = defaultTitle()
}

const onRemove = (id) => { basket.value = removeBasketItem(basket.value, id) }
// 组卷不提供手动排序：卷面按题型分大题，同题型内保持勾选顺序。
// moveBasketItem 仍留在 paperBasket.js（有回归锁），需要时再接 UI。
// 改分统一走卷面上点「4 分」→ beginScoreEdit → setBasketItemScore。
const clearBasket = () => { basket.value = [] }

const defaultTitle = () => {
  const ids = new Set(basket.value.map(it => it.resource_id))
  if (ids.size === 1) {
    const p = papers.value.find(x => x.id === basket.value[0].resource_id)
    if (p) return `${p.name} 选题练习`
  }
  return '组卷练习'
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const composeSubtitle = () => {
  const ids = new Set(basket.value.map(it => it.resource_id))
  if (ids.size !== 1) return `${ids.size} 套卷 · ${todayStr()}`
  const p = papers.value.find(x => x.id === basket.value[0].resource_id)
  if (!p) return todayStr()
  return [p.subject, p.grade, todayStr()].filter(Boolean).join(' · ')
}

// ── 难度 / 标签行内编辑 ──
// updatePaperBankQuestion 早就存在但此前全仓无人调用 ⇒ 难度筛选恒空（改不了就没有数据）。
const toggleEditor = (id) => {
  if (editingId.value === id) { editingId.value = ''; return }
  const q = questions.value.find(x => x.id === id)
  editingId.value = id
  textDraft.value = { parent_stem: q?.parent_stem || '', content: q?.content || '' }
}

const applyQuestionPatch = async (q, patch, okMsg) => {
  try {
    const updated = await updatePaperBankQuestion(q.id, patch)
    Object.assign(q, patch)
    // ⛔ 不能整体 Object.assign(q, updated)：PUT 返回的 answer 是「题目自带答案」，
    //    列表行的 answer 是 attachEffectiveAnswer 算出的「有效答案」（可能来自官方答案册），
    //    整体覆盖会把参考答案显示清空。只同步本次真正改过的字段。
    if (updated) {
      for (const k of ['difficulty', 'tags', 'content', 'parent_stem', 'question_type']) {
        if (k in patch && k in updated) q[k] = updated[k]
      }
    }
    // 篮子里的同一题要同步，否则出卷还是旧难度/标签/题干
    basket.value = basket.value.map(it => (it.id === q.id ? { ...it, ...patch } : it))
    ElMessage.success(okMsg)
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '保存失败')
  }
}

// ── 截图来源（2026-11-07 负责人需求；二轮拆成「链接 + 时间点/备注」）──
// 存卷的 metadata.clipSources[page_no] / clipNotes[page_no]，同页拆出的多题共享。
const startEditSource = (q) => {
  sourceEditingId.value = q.id
  sourceDraftUrl.value = q.clip_source || ''
  sourceDraftNote.value = q.clip_source_note || ''
}

const saveSource = async (q) => {
  const val = sourceDraftUrl.value.trim().slice(0, 500)
  const note = sourceDraftNote.value.trim().slice(0, 500)
  try {
    const r = await updatePaperClipSource(q.id, val, note)
    const source = r?.source ?? val
    const savedNote = r?.note ?? note
    // ⚠️ 后端按页码写，页面也要按页码同步全部行，否则同页的兄弟题还显示旧来源
    for (const x of questions.value) {
      if (x.resource_id === q.resource_id && q.page_no != null && x.page_no === q.page_no) {
        x.clip_source = source
        x.clip_source_note = savedNote
      }
    }
    basket.value = basket.value.map(it => (
      it.resource_id === q.resource_id && q.page_no != null && it.page_no === q.page_no
        ? { ...it, clip_source: source, clip_source_note: savedNote } : it
    ))
    sourceEditingId.value = ''
    ElMessage.success(source || savedNote ? '来源已保存' : '来源已清空')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '来源保存失败')
  }
}

const saveText = (q) => {
  const patch = { content: textDraft.value.content }
  if (q.parent_stem != null) patch.parent_stem = textDraft.value.parent_stem
  applyQuestionPatch(q, patch, '题干已保存')
}

const saveDifficulty = (q, ev) => {
  const raw = ev?.target?.value
  const val = raw === '' ? null : Number(raw)
  applyQuestionPatch(q, { difficulty: val }, val == null ? '难度已清空' : '难度已保存')
}

const saveTags = (q, ev) => {
  const list = String(ev?.target?.value || '')
    .split(/[,，\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
  applyQuestionPatch(q, { tags: list }, '标签已保存')
}

// ── 批量操作（2026-11-08 P0）──────────────────────────────────────────────
//
// 设计原则：
// ① Ctrl+Click 逐个选 / Shift+Click 范围选 / Ctrl+A 全选 —— 对标笔记 App 标准操作
// ② 选中 ≥1 题时筛选条上方出现批量操作工具栏（不遮住题目列表）
// ③ 操作完成后自动清除选中状态并刷新列表
// ④ Escape 清除选中

const selectionCount = computed(() => selection.value.size)

const toggleSelection = (q, index, ev) => {
  const next = new Set(selection.value)
  if (ev?.shiftKey && lastClickedIndex.value >= 0) {
    // Shift+Click：范围选
    const from = Math.min(lastClickedIndex.value, index)
    const to = Math.max(lastClickedIndex.value, index)
    for (let i = from; i <= to; i++) {
      if (questions.value[i]) next.add(questions.value[i].id)
    }
  } else if (ev?.ctrlKey || ev?.metaKey) {
    // Ctrl+Click：逐个切换
    if (next.has(q.id)) next.delete(q.id)
    else next.add(q.id)
  } else {
    // 普通点击：单选（清除其它 → 只选这一个）
    next.clear()
    next.add(q.id)
  }
  selection.value = next
  lastClickedIndex.value = index
}

const selectAll = () => {
  selection.value = new Set(questions.value.map(q => q.id))
}

const clearSelection = () => {
  selection.value = new Set()
  lastClickedIndex.value = -1
}

// 批量改难度
const bulkSetDifficulty = async (val) => {
  const ids = Array.from(selection.value)
  if (!ids.length) return
  bulkBusy.value = true
  try {
    const difficulty = val === '' ? null : Number(val)
    await bulkUpdatePaperBankQuestions(ids, { difficulty })
    // 本地同步：避免刷新闪烁
    for (const q of questions.value) {
      if (selection.value.has(q.id)) q.difficulty = difficulty
    }
    basket.value = basket.value.map(it => selection.value.has(it.id) ? { ...it, difficulty } : it)
    showBulkDifficulty.value = false
    ElMessage.success(`已修改 ${ids.length} 道题的难度`)
    clearSelection()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '批量修改失败')
  } finally {
    bulkBusy.value = false
  }
}

// 批量改标签
const bulkSetTags = async () => {
  const ids = Array.from(selection.value)
  if (!ids.length) return
  const tags = String(bulkTagsDraft.value || '')
    .split(/[,，\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
  bulkBusy.value = true
  try {
    await bulkUpdatePaperBankQuestions(ids, { tags })
    for (const q of questions.value) {
      if (selection.value.has(q.id)) q.tags = tags
    }
    basket.value = basket.value.map(it => selection.value.has(it.id) ? { ...it, tags } : it)
    // 刷新标签候选
    const set = new Set(tagOptions.value)
    for (const t of tags) set.add(t)
    tagOptions.value = Array.from(set).filter(Boolean).sort()
    showBulkTags.value = false
    bulkTagsDraft.value = ''
    ElMessage.success(`已修改 ${ids.length} 道题的标签`)
    clearSelection()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '批量修改失败')
  } finally {
    bulkBusy.value = false
  }
}

// 批量移到题集
const bulkMovePicker = ref({ open: false, anchor: null })
const openBulkMovePicker = (ev) => {
  const rect = ev?.currentTarget?.getBoundingClientRect?.()
  bulkMovePicker.value = {
    open: true,
    anchor: rect
      ? { x: rect.left, y: rect.bottom }
      : { x: Math.max(8, window.innerWidth / 2 - 150), y: 120 },
  }
}
const closeBulkMovePicker = () => { bulkMovePicker.value = { ...bulkMovePicker.value, open: false } }

const bulkMoveToTarget = async (paper) => {
  closeBulkMovePicker()
  const ids = Array.from(selection.value)
  if (!ids.length || !paper) return
  bulkBusy.value = true
  try {
    const r = await movePaperBankQuestions(ids, paper.id)
    if (r?.alreadyInTarget) { ElMessage.info('这些题已经在这个题集里了'); return }
    basket.value = basket.value.map(it => (
      selection.value.has(it.id) ? { ...it, resource_id: paper.id, resource_name: paper.name } : it
    ))
    ElMessage.success(`已将 ${r?.movedQuestions || ids.length} 道题移到「${paper.name}」`)
    clearSelection()
    await loadPapers()
    await loadQuestions()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '批量移动失败')
  } finally {
    bulkBusy.value = false
  }
}

// 批量删除
const bulkDelete = async () => {
  const ids = Array.from(selection.value)
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${ids.length} 道题？此操作不可恢复。`,
      '批量删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  bulkBusy.value = true
  try {
    const r = await bulkDeletePaperBankQuestions(ids)
    basket.value = basket.value.filter(it => !selection.value.has(it.id))
    ElMessage.success(`已删除 ${r?.deleted || ids.length} 道题`)
    clearSelection()
    await loadPapers()
    await loadQuestions()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '批量删除失败')
  } finally {
    bulkBusy.value = false
  }
}

// ── 新建 / 上传 / 删除 ──

const openCreateDialog = () => {
  createForm.value = { name: '', grade: '', subject: '数学', examDate: null }
  showCreateDialog.value = true
}

const handleCreatePaper = async () => {
  if (!createForm.value.name.trim()) return ElMessage.warning('请填写题集名称')
  creating.value = true
  try {
    const paper = await createPaperBankPaper({ ...createForm.value })
    ElMessage.success('题集已建好，接着加题')
    showCreateDialog.value = false
    await loadPapers()
    // 建完直接进「PDF 加题」：老师的下一个动作一定是收题，不要让他再点一次
    if (paper?.id) openUploadDialog(paper.id, 'questions')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

const openUploadDialog = (paperId, mode = 'questions') => {
  uploadPaperId.value = paperId || defaultPaperId()
  uploadMode.value = mode
  // ⛔ 每次打开都重置：上一次勾过「重新解析」不能悄悄带到下一次上传，那会误删整集题目
  replaceExisting.value = false
  pickedFiles.value = []
  showUploadDialog.value = true
}

const onFilesPicked = (ev) => {
  pickedFiles.value = Array.from(ev.target?.files || [])
  if (ev.target) ev.target.value = ''
}

const handleUpload = async () => {
  uploading.value = true
  try {
    if (uploadMode.value === 'answers') {
      await parsePaperBankAnswers(uploadPaperId.value, pickedFiles.value)
      ElMessage.success('答案已上传，正在后台解析')
    } else {
      // 「重新解析」会先清空该集全部题目 ⇒ 必须二次确认，并把要删的题数说清楚
      if (replaceExisting.value) {
        const p = papersById.value.get(uploadPaperId.value)
        try {
          await ElMessageBox.confirm(
            `将先删除「${p?.name || '这个题集'}」里已有的 ${p?.question_count || 0} 道题，再用本次文件重建。此操作不可恢复。`,
            '重新解析会清空题集',
            { confirmButtonText: '清空并重新解析', cancelButtonText: '取消', type: 'warning' }
          )
        } catch { return }
      }
      await parsePaperBankPaper(uploadPaperId.value, pickedFiles.value, { replace: replaceExisting.value })
      ElMessage.success(replaceExisting.value ? '已开始重新解析' : '题目已上传，正在后台追加到题集')
    }
    showUploadDialog.value = false
    pickedFiles.value = []
    await loadPapers()
    startPolling()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

// ── 截图加题（2026-11-06 加，11-07 改模型）──
//
// 三条入口收在同一处：Ctrl+V 粘贴、拖图、点选文件。
// ⛔ 粘贴监听必须挂 window：老师按 Ctrl+V 时焦点通常在 body 或某个按钮上，挂在弹窗元素上会漏。
//    只在弹窗打开时消费，其余时候一律放行，不影响页面上其它粘贴行为。
// ⛔ 截图必须带目标题集：没有题集时先让老师建一个，绝不自动建「截图题库」卷。

const openClipDialog = () => {
  if (!papers.value.length) {
    ElMessage.warning('先建一个题集，再把截图加进去')
    openCreateDialog()
    return
  }
  clipTargetPaperId.value = defaultPaperId()
  showClipDialog.value = true
}

/** 弹窗关闭后统一回收 objectURL（不回收会把整批截图钉在内存里） */
const resetClipDialog = () => {
  for (const f of clipFiles.value) {
    if (f.preview) URL.revokeObjectURL(f.preview)
  }
  clipFiles.value = []
  clipDragOver.value = false
}

const addClipFiles = (rawFiles) => {
  const imgs = Array.from(rawFiles || []).filter(f => /^image\//.test(f?.type || ''))
  if (!imgs.length) {
    ElMessage.warning('只收图片：截图后按 Ctrl+V，或拖一张 PNG/JPEG 进来')
    return
  }
  const room = CLIP_MAX_FILES - clipFiles.value.length
  if (room <= 0) {
    ElMessage.warning(`一次最多 ${CLIP_MAX_FILES} 张，先传这一批，剩下的下一批再贴`)
    return
  }
  const take = imgs.slice(0, room)
  clipFiles.value = clipFiles.value.concat(take.map(f => ({
    key: `clip-${++clipSeq}`,
    file: f,
    preview: URL.createObjectURL(f),
    source: '',
    note: '',
  })))
  if (imgs.length > room) {
    ElMessage.warning(`只收下前 ${room} 张，剩下的下一批再贴`)
  }
}

const removeClipFile = (i) => {
  const [gone] = clipFiles.value.splice(i, 1)
  if (gone?.preview) URL.revokeObjectURL(gone.preview)
}

const onClipPicked = (ev) => {
  addClipFiles(ev.target?.files)
  if (ev.target) ev.target.value = '' // 允许再次选同一张
}

const onClipDrop = (ev) => {
  clipDragOver.value = false
  addClipFiles(ev.dataTransfer?.files)
}

const onGlobalPaste = (ev) => {
  if (!showClipDialog.value) return
  const items = Array.from(ev.clipboardData?.items || [])
  const files = items
    .filter(it => it.kind === 'file' && /^image\//.test(it.type || ''))
    .map(it => it.getAsFile())
    .filter(Boolean)
  if (!files.length) return // 粘的是文字就正常走浏览器默认行为
  ev.preventDefault()
  addClipFiles(files)
}

const handleClipUpload = async () => {
  if (!clipFiles.value.length || clipUploading.value) return
  // ⛔ 目标题集是写库前提：缺了就不能发请求，更不能让后端自动建一个「截图题库」卷
  if (!clipTargetPaperId.value) return ElMessage.warning('请先选择要加进的题集')
  clipUploading.value = true
  try {
    const r = await uploadPaperClips(
      clipFiles.value.map(f => f.file),
      clipFiles.value.map(f => f.source || ''),
      clipTargetPaperId.value,
      clipFiles.value.map(f => f.note || ''),
    )
    showClipDialog.value = false
    ElMessage.success(r?.message || '截图已收下，正在识别')
    await loadPapers()
    // 后台识别，轮询到结束再报「入了多少题」—— 不能先报成功（2026-11-01 的教训）
    startClipPolling(r?.paperId, r?.beforeCount || 0)
  } catch (e) {
    // 409：上一批还在识别。文案已在后端写成人话，直接透出
    ElMessage.error(e?.payload?.message || e.message || '上传失败')
  } finally {
    clipUploading.value = false
  }
}

const stopClipPolling = () => {
  if (clipPollTimer) { clearInterval(clipPollTimer); clipPollTimer = null }
}

/** 截图识别是后台跑的：轮询目标题集状态，结束后按「题数差」报实际入库了多少道。 */
const startClipPolling = (paperId, beforeCount) => {
  stopClipPolling()
  if (!paperId) return
  clipPollTimer = setInterval(async () => {
    try {
      await loadPapers()
      const p = papers.value.find(x => x.id === paperId)
      if (!p || p.question_parse_status === 'parsing') return
      stopClipPolling()
      if (p.question_parse_status === 'failed') {
        ElMessage.error('这批截图没识别成功，换更清晰的图再试一次')
      } else {
        const added = Math.max(0, (p.question_count || 0) - beforeCount)
        ElMessage.success(added ? `已入库 ${added} 道题` : '没识别出文字，已按图片存进题集')
      }
      // 自动切到刚加题的题集：老师刚收的题要立刻看见，不要让他再去左侧找
      filterPaper.value = paperId
      limit.value = PAGE_SIZE
      await loadQuestions()
    } catch { /* 轮询失败不打扰老师，下个 tick 再试 */ }
  }, 3000)
}

// ── 单题改归属（2026-11-08 负责人需求）──
// 截图收题点错题集后，此前只能删了重收；现在点题集名（或行内「移到题集…」）选一个新题集即可。
// ⛔ 移动/撤销都以服务端返回的 undo 快照为准，前端不自己拼「原题号」——
//    题号是唯一键的一部分，猜错一次就会把两道题挤在一起。
const movePicker = ref({ open: false, q: null, anchor: null })
const undoMove = ref(null)
let undoTimer = null

const openMovePicker = (q, ev) => {
  if (!papers.value.length) return
  const rect = ev?.currentTarget?.getBoundingClientRect?.()
  movePicker.value = {
    open: true,
    q,
    anchor: rect
      ? { x: rect.left, y: rect.bottom }
      : { x: Math.max(8, window.innerWidth / 2 - 150), y: 120 },
  }
}

const closeMovePicker = () => { movePicker.value = { ...movePicker.value, open: false } }

// 拖拽改归属（2026-11-08 第二条路径）：题号当抓手，拖到左栏题集上即移动。
// 与「移到题集…」走同一个 doMoveQuestion，两条入口不会长出两套口径。
const Q_DRAG_TYPE = 'application/x-mnx-question'
const draggingQuestionId = ref('')
const onQuestionDragStart = (e, q) => {
  draggingQuestionId.value = q.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(Q_DRAG_TYPE, q.id)
  e.dataTransfer.setData('text/plain', questionLabel(q))
}
const onQuestionDragEnd = () => { draggingQuestionId.value = '' }

const onQuestionDropped = async ({ questionId, paperId }) => {
  const q = questions.value.find(x => x.id === questionId)
  const paper = papers.value.find(p => p.id === paperId)
  if (!q || !paper) return
  if (q.resource_id === paperId) { ElMessage.info(`这道题已经在「${paper.name}」里了`); return }
  await doMoveQuestion(paper, q)
}

const doMoveQuestion = async (paper, targetQ) => {
  const q = targetQ || movePicker.value.q
  if (!q || !paper) return
  closeMovePicker()
  try {
    const r = await movePaperBankQuestions([q.id], paper.id)
    if (r?.alreadyInTarget) { ElMessage.info('这道题已经在这个题集里了') ; return }
    // 卷面（试题篮）里的同一题跟着换归属，否则出卷还按旧题集分大题
    basket.value = basket.value.map(it => (
      it.id === q.id ? { ...it, resource_id: paper.id, resource_name: paper.name } : it
    ))
    const staysVisible = filterPaper.value === 'all' || filterPaper.value === paper.id
    undoMove.value = {
      paperName: paper.name,
      // 正看着原题集时，这一条会从列表里消失 —— 必须在提示里说清「消失≠被删」
      hidden: !staysVisible,
      count: r?.movedQuestions || 1,
      items: r?.undo || [],
      fromPaperId: q.resource_id,
    }
    if (undoTimer) clearTimeout(undoTimer)
    undoTimer = setTimeout(() => { undoMove.value = null }, 8000)
    await loadPapers()
    await loadQuestions()
    // ⛔ 不再另弹 ElMessage：成功提示与撤销条说的是同一件事，两条并列只会互相抢注意力。
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '移动失败')
  }
}

const undoLastMove = async () => {
  const u = undoMove.value
  if (!u?.items?.length) { undoMove.value = null; return }
  undoMove.value = null
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = null }
  try {
    const r = await restorePaperBankQuestions(u.items)
    const back = new Map(u.items.map(it => [it.id, it]))
    basket.value = basket.value.map(it => (back.has(it.id) ? { ...it, resource_id: back.get(it.id).resourceId } : it))
    await loadPapers()
    await loadQuestions()
    if (r?.skipped) ElMessage.warning(`已还原 ${r.restored} 道；${r.skipped} 道原位置已被占用，没动它`)
    else ElMessage.success('已撤销，题回到原来的题集')
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '撤销失败')
  }
}

const askDeleteQuestion = async (q) => {
  try {
    await ElMessageBox.confirm(
      `从「${papersById.value.get(q.resource_id)?.name || '题集'}」里删除这道题（${questionLabel(q)}）？只删这一道，不影响题集里其它题。`,
      '删除题目',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 取消
  }
  try {
    await deletePaperBankQuestion(q.id)
    ElMessage.success('已删除')
    basket.value = basket.value.filter(it => it.id !== q.id)
    await loadPapers()
    await loadQuestions()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '删除失败')
  }
}

const askDeletePaper = async (p) => {
  try {
    await ElMessageBox.confirm(
      `确定删除题集「${p.name}」及它的 ${p.question_count || 0} 道题？已勾选到卷面上的题也会一起消失。`,
      '删除题集',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 取消
  }
  try {
    await deletePaperBankPaper(p.id)
    ElMessage.success('已删除')
    if (filterPaper.value === p.id) filterPaper.value = 'all'
    basket.value = basket.value.filter(it => it.resource_id !== p.id)
    await loadPapers()
    await loadQuestions()
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '删除失败')
  }
}

// 清空全部（2026-11-01 负责人需求）：重新上传解析前一键清空题库，不用一套套删。
// 级联范围与单卷删除相同（questions/answers/units 全 CASCADE），后端只删 exam、不碰练习册。
const clearing = ref(false)
const askClearPapers = async () => {
  if (!papers.value.length || clearing.value) return
  try {
    await ElMessageBox.confirm(
      `将删除题库里全部 ${papers.value.length} 个题集和 ${totalQuestionCount.value} 道题（含答案），不可恢复。清空后新建题集即可重新收题。`,
      '清空题库',
      { confirmButtonText: '全部删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 取消
  }
  clearing.value = true
  try {
    const r = await deletePaperBankPapers()
    ElMessage.success(`已清空 ${r?.deleted ?? papers.value.length} 个题集`)
    filterPaper.value = 'all'
    basket.value = [] // 卷没了，篮子里的题全部失效，直接清空
    await loadPapers()
    await loadQuestions()
  } catch (e) {
    // 后端 409：有卷子还在解析中（解析任务还在写库，此时清空会出现写一半的数据）
    ElMessage.error(e?.payload?.message || e.message || '清空失败')
  } finally {
    clearing.value = false
  }
}

// 解析在服务端后台跑：轮询卷状态，解析完成就刷新题目列表。
// 老师可以离开本页 —— 重新进来时 onMounted 会重新拉一次，状态不会丢。
// 题目解析与答案解析是两条独立的链，任一条在跑都要继续轮询。
const anyParsing = () => papers.value.some(isParsing)
const startPolling = () => {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      await loadPapers()
      if (!anyParsing()) {
        stopPolling()
        await loadQuestions()
        // ⚠️ 解析失败的卷也会让 anyParsing 变 false —— 不能无脑弹「解析完成」
        //（2026-11-01 老师困惑「说成功却一道题都没有」的直接来源：failed 被报成成功）。
        const failedNames = papers.value
          .filter(p => p.question_parse_status === 'failed')
          .map(p => p.name)
        if (failedNames.length) {
          ElMessage.warning(`解析失败：${failedNames.join('、')} —— 点该卷下的「题目」按钮重新上传解析`)
        } else {
          ElMessage.success('解析完成')
        }
      }
    } catch { /* 轮询失败不打扰老师，下个 tick 再试 */ }
  }, 4000)
}
const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }

// ── 卷面（常驻，basket 一变就重排）──
//
// 排版动作复用 paintPreviewIntoIframe —— 与「导出 PDF」共用同一个 paintDocument，
// 同一份 bodyHtml + 同一个 buildPaperCSS，所以预览和下载不会各排一套。
// 下载仍走服务端 Chromium（矢量、字体、分页都对），点下载才生成。

/** 按版本产出 bodyHtml + 专属样式 + 文件名（预览与下载共用）。 */
const buildPaperHtml = (kind) => {
  if (kind === 'lecture') {
    // 讲解版：一小问一页、横版 4:3（280×210mm），iPad 笔记软件手写板书用。
    // ⛔ 不复用组卷/讲义版式 —— 页面骨架（横版、书写留白、页脚答案）完全不同。
    // 篮子一项（小问行）= 一页，页数精确等于篮子长度。
    const title = composeTitle.value || '讲解'
    return {
      bodyHtml: buildLectureBody({ items: basket.value, showImage: composeWithImage.value }),
      extraCss: buildLectureCSS(),
      filename: `${composePaperFilename(title, basket.value.length, todayStr())}_讲解版`,
    }
  }
  if (kind === 'handout') {
    const groups = groupHandoutQuestions(basket.value.slice())
    // 讲义版式：保留原卷题号、按卷分组（⛔ 不复用组卷版式，那套会重排重编号）
    const title = groups.length === 1 ? `${groups[0].paperName} 讲题讲义` : `${groups.length} 套卷 讲题讲义`
    return {
      bodyHtml: buildHandoutBody({ title, groups, showAnswers: true, showImage: composeWithImage.value }),
      extraCss: buildHandoutCSS(),
      filename: title,
    }
  }
  const withAnswers = kind === 'teacher'
  return {
    bodyHtml: buildComposePaperBody({
      title: composeTitle.value,
      subtitle: composeSubtitle(),
      blocks: blocks.value,
      showAnswers: withAnswers,
      showImage: composeWithImage.value,
    }),
    extraCss: buildComposePaperCSS(),
    filename: composePaperFilename(composeTitle.value, totals.value.questionCount, todayStr())
      + (withAnswers ? '_教师卷' : ''),
  }
}

const applyZoom = () => {
  const doc = previewFrame.value?.contentDocument
  if (doc?.body) doc.body.style.zoom = String(zoom.value)
}

/**
 * 适应宽度：A4 卷面固定 794px，右栏一窄就被横向裁掉右半边（分值、选项全看不见）。
 * 所以默认按容器宽度算比例；老师手动缩放过就不再自动覆盖。
 * @param {boolean} [force] 点百分比数字时强制回到适应宽度
 */
const fitZoom = (force = false) => {
  if (userZoomed.value && !force) return
  if (force) userZoomed.value = false
  const box = stageRef.value?.clientWidth || 0
  if (!box) return
  // 页宽随版式：A4 竖版 = 794px；讲解版是横版 4:3（≈1058px），按各自页宽算适应比例
  const pageW = previewKind.value === 'lecture' ? LECTURE_PAGE_PX.w : 794
  const z = Math.min(1, Math.max(0.35, Math.round(((box - 22) / pageW) * 100) / 100))
  zoom.value = z
  applyZoom()
}

const setZoom = (delta) => {
  userZoomed.value = true
  zoom.value = Math.min(1.6, Math.max(0.3, Math.round((zoom.value + delta) * 10) / 10))
  applyZoom()
}

/**
 * 给卷面注入「就地编辑」能力：
 *   · 每题右上角一个 ×（悬停出现）→ 移出卷子；
 *   · 「4 分」点一下变输入框 → 改分值。
 * 为什么注入而不是把按钮做进 composePaperPdf：那份 HTML 同时用于**打印**，
 * 打印件上不能出现删除按钮和输入框。交互只属于预览这一侧。
 */
const decoratePaper = (doc) => {
  if (!doc) return
  // 组卷/练习卷的题是 .question[data-qid]；讲解版每页是 .lec-page[data-qid]（也带删除按钮，
  // 讲解版没有 .q-score，改分逻辑自然跳过）
  doc.querySelectorAll('.question[data-qid], .lec-page[data-qid]').forEach((el) => {
    const id = el.getAttribute('data-qid')
    if (!id) return

    if (!el.querySelector(':scope > .pb-del')) {
      const btn = doc.createElement('button')
      btn.type = 'button'
      btn.className = 'pb-del'
      btn.textContent = '×'
      btn.title = '从卷子移出这道题'
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onRemove(id) })
      el.appendChild(btn)
    }

    const score = el.querySelector('.q-score')
    if (score && !score.dataset.bound) {
      score.dataset.bound = '1'
      score.title = '点一下改分值'
      score.addEventListener('click', () => beginScoreEdit(doc, id, score))
    }
  })
}

const beginScoreEdit = (doc, id, span) => {
  if (span.querySelector('input')) return
  const cur = String(parseFloat(String(span.textContent || '').replace(/[^\d.]/g, '')) || 0)
  const input = doc.createElement('input')
  input.type = 'number'
  input.min = '0'
  input.step = '0.5'
  input.value = cur
  input.className = 'pb-score-input'
  const text = span.textContent
  span.textContent = ''
  span.appendChild(input)
  input.focus()
  input.select()

  let done = false
  const restore = () => {
    // 提交后卷面会整体重排，这里的 DOM 会被替换；只有取消时才需要还原
    if (done) return
    done = true
    span.textContent = text
  }
  const commit = () => {
    if (done) return
    done = true
    basket.value = setBasketItemScore(basket.value, id, input.value)
  }
  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    if (e.key === 'Escape') { e.preventDefault(); done = true; restore() }
  })
}

/** 真正重排一次。用 token 丢弃过期结果（连续删题时只认最后一次）。 */
const repaintPreview = async () => {
  if (!basket.value.length) {
    // 删空要立刻把「约 N 页」清掉，否则会残留上一次的页数
    repaintToken++
    repainting.value = false
    previewPages.value = 0
    return
  }
  const token = ++repaintToken
  repainting.value = true
  const keepScroll = previewFrame.value?.contentDocument?.documentElement?.scrollTop || 0
  try {
    const { bodyHtml, extraCss } = buildPaperHtml(previewKind.value)
    await nextTick()
    const doc = await paintPreviewIntoIframe(previewFrame.value, {
      bodyHtml,
      extraCss: `${extraCss}\n${PREVIEW_STAGE_CSS}`,
    })
    if (token !== repaintToken) return // 已经有更新的一次重排在跑，这次结果作废
    decoratePaper(doc)
    fitZoom() // 先按容器算比例（用户手动缩放过则跳过）
    // 改一题就把卷面滚回顶部很难用：保持原来的阅读位置
    if (keepScroll) doc.documentElement.scrollTop = keepScroll
    // scrollHeight 是**布局像素**，不受 zoom 影响。页数算法随版式：
    // A4 竖版按页高 1123px 估；讲解版每个小问固定一页，页数精确等于篮子长度。
    const h = doc?.body?.scrollHeight || 0
    previewPages.value = previewKind.value === 'lecture'
      ? basket.value.length
      : (h ? Math.max(1, Math.ceil(h / 1123)) : 0)
  } catch (e) {
    if (token === repaintToken) ElMessage.error(e?.payload?.message || e.message || '卷面渲染失败')
  } finally {
    if (token === repaintToken) repainting.value = false
  }
}

/** 防抖：连续勾/删几题只重排一次。 */
const scheduleRepaint = (delay = 200) => {
  clearTimeout(repaintTimer)
  repaintTimer = setTimeout(() => { repaintPreview() }, delay)
}

const switchPreviewKind = (kind) => {
  if (previewKind.value === kind) return
  previewKind.value = kind
  repaintToken++ // 让在跑的那次作废（版式都换了）
  repaintPreview()
}

// ── 拖拽调宽（卷面太窄看不清时自己拉）──
const startDrag = (ev) => {
  ev.preventDefault()
  const startX = ev.clientX
  const startW = previewWidth.value
  const onMove = (e) => {
    const next = Math.min(Math.max(startW + (startX - e.clientX), 320), 920)
    previewWidth.value = next
    fitZoom(true)
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    fitZoom(true)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// 窄屏：卷面改成整宽底部常驻面板。left 要避开左侧导航，所以实测容器左边界。
const paperLeft = ref(0)
const measureLeft = () => {
  const el = document.querySelector('.paper-bank .wb-page__inner') || document.querySelector('.paper-bank')
  if (el) paperLeft.value = Math.max(0, Math.round(el.getBoundingClientRect().left))
}
const fixedStyle = computed(() => ({ left: `${paperLeft.value}px`, right: '12px' }))

const onWindowResize = () => {
  narrow.value = window.innerWidth <= 1499
  measureLeft()
  fitZoom()
}

const downloadPdf = async () => {
  if (!basket.value.length) return
  downloading.value = true
  try {
    const { bodyHtml, extraCss, filename } = buildPaperHtml(previewKind.value)
    const html = await renderCustomBodyToHTML({ bodyHtml, extraCss })
    const isLecture = previewKind.value === 'lecture'
    await exportServerPDF({
      html,
      filename,
      // 讲义/讲解版不印页码：讲义按卷分组页码没意义；讲解版页脚已印答案、零页边距也没页码位置
      pageNumbers: !isLecture && previewKind.value !== 'handout',
      // 页面尺寸随版式：讲解版是横版 4:3（280×210mm），不再是 A4 —— 必须显式传给后端
      pdfOptions: isLecture
        ? {
            width: LECTURE_PAGE_MM.width,
            height: LECTURE_PAGE_MM.height,
            printBackground: true,
            margin: { top: '0', bottom: '0', left: '0', right: '0' },
          }
        : null,
    })
    ElMessage.success(`已生成：${filename}.pdf`)
  } catch (e) {
    ElMessage.error(e?.payload?.message || e.message || '生成 PDF 失败')
  } finally {
    downloading.value = false
  }
}

const paperMeta = computed(() => {
  if (repainting.value) return '重排中…'
  if (!summary.value.count) return '还没有题'
  // 讲解版页数精确（每小问一页），其余版式按页高估算只给「约 N 页」
  const pages = previewPages.value
    ? (previewKind.value === 'lecture' ? `共 ${previewPages.value} 页` : `约 ${previewPages.value} 页`)
    : ''
  if (previewKind.value === 'lecture') {
    return [`${summary.value.count} 页`, '每小问一页', pages].filter(Boolean).join(' · ')
  }
  if (previewKind.value === 'handout') {
    return [`${summary.value.count} 题`, '原卷题号', pages].filter(Boolean).join(' · ')
  }
  return [`${summary.value.count} 题`, `${summary.value.totalScore} 分`, pages].filter(Boolean).join(' · ')
})

// basket 任何变化（勾/删/改分）都自动重排 —— 这就是「同一页面里实时预览」
watch(basket, () => { scheduleRepaint() }, { deep: true })
watch([composeTitle, composeWithImage], () => { scheduleRepaint(300) })
watch(paperFull, async () => { await nextTick(); fitZoom(true) })

watch([filterType, filterDifficulty, filterTag], () => { limit.value = PAGE_SIZE; clearSelection(); loadQuestions() })
watch([filterQuestionNos, filterKeyword], () => { limit.value = PAGE_SIZE; clearSelection(); loadQuestions() })

const onKeydown = (e) => {
  if (e.key === 'Escape' && paperFull.value) paperFull.value = false
  // Escape 清除多选（卷面不在全屏时）
  if (e.key === 'Escape' && !paperFull.value && selectionCount.value > 0) {
    clearSelection()
    e.preventDefault()
    return
  }
  // Ctrl+A 全选题目（仅在不聚焦输入框时）
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    const tag = (e.target?.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return
    if (questions.value.length) {
      e.preventDefault()
      selectAll()
    }
  }
}

onMounted(async () => {
  narrow.value = window.innerWidth <= 1499
  loading.value = true
  try {
    await loadPapers()
    await loadQuestions()
    if (!composeTitle.value.trim()) composeTitle.value = '组卷练习'
    if (anyParsing()) startPolling()
  } finally {
    loading.value = false
  }
  await nextTick()
  measureLeft()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('keydown', onKeydown)
  // 截图粘贴：只在「截图入题库」弹窗打开时消费，见 onGlobalPaste
  window.addEventListener('paste', onGlobalPaste)
})
onUnmounted(() => {
  stopPolling()
  stopClipPolling()
  resetClipDialog()
  clearTimeout(repaintTimer)
  if (undoTimer) clearTimeout(undoTimer)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('paste', onGlobalPaste)
})
</script>

<style scoped>
/* ── 三栏：卷列表 | 题目 | 卷面（常驻） ── */
.pb-layout {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr) var(--pw, 560px);
  gap: 12px;
  align-items: start;
}
@media (max-width: 1500px) {
  .pb-layout { grid-template-columns: 176px minmax(0, 1fr) min(var(--pw, 560px), 34vw); gap: 10px; }
}
/* 窄屏放不下「题目列表 + 能看清的卷面」并排：卷面改成整宽的底部常驻面板（同一页，可收起） */
@media (max-width: 1499px) {
  .pb-layout {
    grid-template-columns: 150px minmax(0, 1fr);
    grid-template-areas: 'papers questions' 'paper paper';
    row-gap: 10px;
    padding-bottom: 8px;
  }
  /* 底部常驻卷面（is-fixed, z-index 1200）会压住左栏下半部 ⇒ 当前题集详情看不见。
     左栏只有 150px 宽，提到 1300 只盖住卷面最左一条，不影响卷面阅读。 */
  .pb-col--papers { grid-area: papers; z-index: 1300; }
  .pb-col--questions { grid-area: questions; }
  .pb-col--paper {
    grid-area: paper;
    position: relative;
    z-index: 6;
    height: clamp(260px, 46vh, 620px);
  }
  .pb-col--paper.is-fixed {
    position: fixed;
    /* ⛔ 必须显式 top:auto：基础规则里 .pb-col--paper 有 top:12px，
       fixed 下同时给 top 和 bottom 会变成「贴顶」，底部常驻就跑到页面上去了 */
    top: auto;
    bottom: 8px;
    z-index: 1200;
    height: clamp(260px, 46vh, 620px);
  }
  .pb-col--paper.is-collapsed { height: 42px; min-height: 0; }
  .pb-col--paper.is-collapsed .pb-paper-panel__form,
  .pb-col--paper.is-collapsed .pb-paper-panel__stage { display: none; }
  .pb-col--paper .pb-paper-panel {
    height: 100%;
    min-height: 0;
    box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.10);
  }
  .pb-drag { display: none; }
  .pb-panel--tip { display: none; }
}

/* 左：卷列表 */
.pb-col--papers { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 12px; }
.pb-panel { background: #fff; border: 1px solid #ebe9e4; border-radius: 10px; padding: 10px; }
.pb-panel__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.pb-panel__head strong { font-size: 13px; }
.pb-panel__head span { font-size: 11px; color: #999; }
.pb-panel__head-right { display: flex; align-items: center; gap: 8px; }
.pb-clear { border: none; background: none; padding: 0; font-size: 11px; color: #a32d2d; cursor: pointer; }
.pb-clear:hover { text-decoration: underline; }
.pb-clear:disabled { color: #bbb; cursor: default; text-decoration: none; }
.pb-panel__empty { font-size: 12px; color: #999; line-height: 1.7; padding: 6px 2px; }
/* 当前题集详情：状态跟着选中项走，树本身保持干净（2026-11-07） */
.pb-panel--detail { display: flex; flex-direction: column; gap: var(--wb-space-2, 8px); }
.pb-detail__head {
  display: flex; flex-direction: column; gap: 2px;
  padding-bottom: var(--wb-space-2, 8px);
  border-bottom: 1px solid var(--wb-border-light, #f1f5f9);
}
.pb-detail__label { font-size: var(--wb-fs-caption, 11px); color: var(--wb-text-tertiary, #94a3b8); }
.pb-detail__head strong {
  font-size: var(--wb-fs-body, 13px); font-weight: var(--wb-fw-semibold, 600);
  color: var(--wb-text, #1e293b);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pb-detail__links { display: flex; flex-wrap: wrap; gap: var(--wb-space-1, 4px) var(--wb-space-2, 8px); }
.pb-panel--tip { background: #faf9f6; }
.pb-panel--tip strong { font-size: 12px; }
.pb-panel--tip p { font-size: 11px; color: #777; line-height: 1.7; margin: 4px 0 0; }

.pb-paper-wrap { border-radius: 8px; }
.pb-paper-wrap .pb-paper__ops { display: none; }
.pb-paper-wrap:hover .pb-paper__ops { display: flex; }
.pb-paper-wrap.is-active .pb-paper,
.pb-paper.is-active { background: #eef2ff; }
.pb-paper {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 7px 8px; border: 0; background: transparent; border-radius: 8px;
  font-size: 12px; color: #333; text-align: left; cursor: pointer;
}
.pb-paper:hover { background: #f5f4f0; }
.pb-paper__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-paper__meta { font-size: 11px; color: #999; flex-shrink: 0; }
.pb-paper__parsing { font-size: 10px; color: #185fa5; flex-shrink: 0; }
/* 上传原件常驻入口：不 hover 也能看见，点开就是老师自己传的那份文件 */
.pb-paper__files { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 8px 6px 8px; }
.pb-file-link {
  border: 0; background: transparent; padding: 0; font-size: 11px;
  color: #185fa5; cursor: pointer; text-decoration: none;
}
.pb-file-link:hover { text-decoration: underline; }
.pb-review-badge {
  border: 1px solid #e6c07b; background: #fff8e8; color: #8a5a12;
  border-radius: 4px; padding: 1px 5px; font-size: 10px; cursor: pointer;
}
.pb-review-badge:hover { background: #ffefcc; }
/* 漏题/串号比「读法不一致」严重：误读是错一个字符，漏题是整道题消失，必须用代价色 */
.pb-review-badge.is-danger {
  border-color: #e0a9a9; background: #fdeeee; color: #a32d2d;
}
.pb-review-badge.is-danger:hover { background: #f9dcdc; }
.pb-review-warn { font-size: 10px; color: #a3731a; }
/* 「✓ 题号已核」：正向确认，必须很轻，不能跟复核徽标抢注意力 */
.pb-checked {
  border: 0; background: transparent; padding: 0; font-size: 10px;
  color: #8a9a86; cursor: pointer;
}
.pb-checked:hover { color: #557052; text-decoration: underline; }
.pb-review-list { display: flex; flex-direction: column; gap: 8px; max-height: 52vh; overflow: auto; }
.pb-review-item { border: 1px solid #eee9df; border-radius: 6px; padding: 8px 10px; font-size: 12px; line-height: 1.7; }
.pb-review-item__head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 3px; }
.pb-review-item__head a { color: #185fa5; text-decoration: none; flex-shrink: 0; }
.pb-review-item code { background: #f6f5f1; border-radius: 3px; padding: 0 4px; }
.pb-review-item__reason { color: #999; font-size: 11px; }
.pb-file-list { display: flex; flex-direction: column; gap: 2px; max-height: 46vh; overflow: auto; }
.pb-file-item {
  display: flex; justify-content: space-between; gap: 10px; align-items: center;
  padding: 8px 6px; border-bottom: 1px solid #f0ede6; font-size: 12px;
  color: #185fa5; text-decoration: none;
}
.pb-file-item:hover { background: #f7f9ff; }
.pb-file-item span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-file-item span:last-child { flex-shrink: 0; font-size: 11px; color: #999; }
.pb-paper__ops { display: flex; gap: 6px; padding: 0 8px 6px 8px; }
.pb-paper__ops button {
  border: 0; background: transparent; padding: 0; font-size: 11px; color: #666; cursor: pointer;
}
.pb-paper__ops button:hover { color: #185fa5; text-decoration: underline; }
.pb-paper__ops button.is-danger:hover { color: #a32d2d; }

/* 中：题目区 */
.pb-col--questions { min-width: 0; }
.pb-summary { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.pb-summary__sel { flex: none; }
.pb-summary strong { font-size: 13px; }
.pb-summary span { font-size: 11px; color: #888; }

/* ── 批量操作工具栏（2026-11-08 P0）── */
.pb-bulk {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
  gap: 8px; padding: 8px 12px; margin-bottom: 8px;
  background: var(--wb-primary-mist, #eef2ff);
  border: 1px solid var(--wb-primary-soft, #c7d2fe);
  border-radius: var(--wb-radius-sm, 8px);
}
.pb-bulk__info { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.pb-bulk__info strong { color: var(--wb-primary, #6366f1); }
.pb-bulk__ops { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pb-bulk__btn {
  border: 1px solid var(--wb-border, #e2e8f0); background: var(--wb-bg-card, #fff);
  color: var(--wb-text, #1e293b); font-size: 12px; padding: 4px 10px;
  border-radius: var(--wb-radius-xs, 6px); cursor: pointer;
  transition: border-color var(--wb-motion-fast, 120ms) ease,
              background var(--wb-motion-fast, 120ms) ease;
}
.pb-bulk__btn:hover { border-color: var(--wb-primary, #6366f1); background: #fff; }
.pb-bulk__btn:disabled { opacity: .5; cursor: default; }
.pb-bulk__btn.is-danger { color: var(--wb-status-danger, #dc2626); border-color: #fca5a5; }
.pb-bulk__btn.is-danger:hover { background: #fee2e2; border-color: #dc2626; }
.pb-bulk__dropdown { position: relative; }
.pb-bulk__popover {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 2000;
  min-width: 120px; padding: 4px;
  background: var(--wb-bg-card, #fff);
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: var(--wb-radius-sm, 8px);
  box-shadow: var(--wb-elev-overlay, 0 8px 24px rgba(15,23,42,.10));
}
.pb-bulk__popover button {
  display: block; width: 100%; text-align: left;
  padding: 6px 10px; border: 0; border-radius: var(--wb-radius-xs, 6px);
  background: transparent; color: var(--wb-text, #1e293b);
  font-size: 12px; cursor: pointer;
}
.pb-bulk__popover button:hover { background: var(--wb-border-subtle, #f8fafc); }
.pb-bulk__popover--tags { min-width: 240px; display: flex; gap: 6px; padding: 8px; align-items: center; }
.pb-bulk__input {
  flex: 1; min-width: 0; height: 28px;
  border: 1px solid var(--wb-border, #e2e8f0); border-radius: var(--wb-radius-xs, 6px);
  padding: 0 8px; font-size: 12px; color: var(--wb-text, #1e293b);
  background: var(--wb-bg-card, #fff); outline: none;
}
.pb-bulk__input:focus { border-color: var(--wb-primary, #6366f1); }
.pb-bulk__apply {
  flex: none; height: 28px; padding: 0 12px;
  border: 0; border-radius: var(--wb-radius-xs, 6px);
  background: var(--wb-primary, #6366f1); color: #fff;
  font-size: 12px; cursor: pointer;
}
.pb-bulk__apply:hover { opacity: .9; }
.pb-bulk__apply:disabled { opacity: .5; cursor: default; }
.pb-bulk-fade-enter-active, .pb-bulk-fade-leave-active { transition: all .2s ease; }
.pb-bulk-fade-enter-from, .pb-bulk-fade-leave-to { opacity: 0; transform: translateY(-6px); }
.pb-loading { padding: 12px 0; display: grid; gap: 12px; }
.pb-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.pb-row {
  display: flex; gap: 10px; align-items: flex-start;
  background: #fff; border: 1px solid #ebe9e4; border-radius: 10px;
  padding: 12px 14px;
}
.pb-row:hover { border-color: #d9d5cc; }
.pb-row.is-selected { border-color: #a9b4f0; background: #fbfbff; }
.pb-row.is-checked { border-color: var(--wb-primary, #6366f1); background: var(--wb-primary-mist, #eef2ff); }
.pb-row__checks { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; margin-top: 2px; }
.pb-row__sel { flex: none; }
.pb-row__check { flex: none; }
.pb-row__body { flex: 1; min-width: 0; }
.pb-row__head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 5px; }
.pb-row__num { font-weight: 500; font-size: 13px; white-space: nowrap; }
/* 题号＝拖拽抓手：光标要能提示「这东西能拖」，但平时仍是安静的题号 */
.pb-row__num--grip { cursor: grab; user-select: none; border-radius: 4px; padding: 0 3px; margin-left: -3px; }
.pb-row__num--grip:hover { background: #f2f1ec; }
.pb-row__num--grip:active { cursor: grabbing; }
.pb-row.is-dragging-q { opacity: .45; }
.pb-row__paper { font-size: 11px; color: #999; margin-left: auto; }
/* 题集名＝这道题的归属，做成可点：hover 才亮出「⇄」，平时仍是安静的一行出处 */
.pb-row__paper--btn {
  border: 0; background: transparent; padding: 1px 4px; border-radius: 4px;
  font-size: 11px; color: #999; cursor: pointer; max-width: 46%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 3px;
}
.pb-row__paper--btn:hover { background: #f2f1ec; color: #185fa5; }
.pb-row__paper-swap { font-size: 10px; opacity: 0; transition: opacity var(--wb-motion-fast, 120ms) ease; }
.pb-row__paper--btn:hover .pb-row__paper-swap { opacity: 1; }
/* 移动后的撤销条：贴着视口底部，8 秒后自动消失 */
.pb-undo {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 3000; display: flex; align-items: center; gap: 10px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 9px 12px; border-radius: 999px;
  background: rgba(30, 41, 59, .94); color: #fff;
  font-size: 12px; line-height: 1.4;
  box-shadow: 0 10px 28px rgba(15, 23, 42, .28);
}
.pb-undo__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-undo__text em { font-style: normal; opacity: .8; font-size: 11px; }
.pb-undo__btn {
  flex: none; border: 1px solid rgba(255, 255, 255, .5); background: transparent;
  color: #fff; font-size: 12px; padding: 3px 10px; border-radius: 999px; cursor: pointer;
}
.pb-undo__btn:hover { background: rgba(255, 255, 255, .16); }
.pb-undo__close {
  flex: none; border: 0; background: transparent; color: rgba(255, 255, 255, .7);
  font-size: 15px; line-height: 1; cursor: pointer; padding: 0 2px;
}
.pb-undo__close:hover { color: #fff; }
.pb-row__type { font-size: 11px; color: #555; background: #f1efe8; border-radius: 4px; padding: 0 5px; }
.pb-tag { font-size: 11px; color: #993c1d; background: #faece7; border: 1px solid #f0997b; border-radius: 4px; padding: 0 5px; }
.pb-row__diff { color: #f59e0b; font-size: 11px; letter-spacing: 1px; }
.pb-row__stem {
  font-size: 13px; line-height: 1.75; color: #444;
  padding: 6px 8px; background: #faf9f6; border-left: 2px solid #ddd9d0; border-radius: 4px;
  margin-bottom: 4px;
}
.pb-row__text { font-size: 13px; line-height: 1.75; word-break: break-word; }
.pb-row__opts { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 12.5px; color: #444; margin-top: 5px; }
.pb-opt { display: inline-flex; align-items: baseline; gap: 2px; }
.pb-row__answer { display: flex; align-items: baseline; gap: 4px; font-size: 12px; color: #4f46e5; margin-top: 5px; }
.pb-row__answer-label { color: #888; }
.pb-row__answer em { color: #993c1d; font-style: normal; }
.pb-row__answer em.is-warn { color: #a32d2d; font-weight: 500; }
.pb-row__answer.is-empty { color: #bbb; }
/* 截图来源（2026-11-07） */
.pb-row__source { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 11px; margin-top: 5px; color: #6b7280; }
.pb-row__source-label { color: #999; }
.pb-row__source-text { color: #555; word-break: break-all; }
.pb-row__source-empty { color: #bbb; }
.pb-row__source-link { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-row__source-input {
  flex: 1 1 260px; min-width: 160px; font-size: 11px; padding: 3px 6px;
  border: 1px solid #ddd; border-radius: 4px; background: #fff; font-family: inherit;
}
.pb-row__source-edit { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 5px; min-width: 240px; }
.pb-row__source-edit .pb-row__source-input { flex: 1 1 220px; }
.pb-row__source-note {
  color: #6b5b3e; background: #faf5e9; border: 1px solid #ece0c4;
  border-radius: 4px; padding: 1px 6px; word-break: break-all;
}
.pb-row__foot { display: flex; gap: 12px; margin-top: 6px; }
.pb-link { border: 0; background: transparent; padding: 0; font-size: 11px; color: #8a8a8a; cursor: pointer; text-decoration: none; }
.pb-link:hover { color: #185fa5; text-decoration: underline; }
.pb-link:disabled { color: #ccc; cursor: default; text-decoration: none; }
.pb-editor { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ececec; }
.pb-editor label { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #777; }
.pb-editor select, .pb-editor input {
  font-size: 12px; padding: 3px 6px; border: 1px solid #ddd; border-radius: 5px; background: #fff;
}
.pb-editor__tags input { width: 190px; }
.pb-editor__text { flex: 1 1 100%; align-items: flex-start; }
.pb-editor textarea {
  flex: 1; min-width: 0; font-size: 12px; line-height: 1.6; padding: 5px 7px;
  border: 1px solid #ddd; border-radius: 5px; background: #fff; resize: vertical;
  font-family: inherit;
}
.pb-editor__save { font-size: 11px; color: #185fa5; }
.pb-editor__hint { font-size: 10px; color: #aaa; }
.pb-row__figure { display: block; max-width: 340px; max-height: 240px; object-fit: contain; border: 1px solid #e5e3dc; border-radius: 6px; margin: 8px 0 2px; background: #fff; }
.pb-more {
  width: 100%; padding: 10px; border: 1px dashed #ddd; border-radius: 8px;
  background: #fff; color: #666; font-size: 12px; cursor: pointer;
}
.pb-more:hover { border-color: #a9b4f0; color: #185fa5; }

/* 右：卷面面板 */
.pb-col--paper { position: sticky; top: 12px; min-width: 0; }
.pb-col--paper.is-full {
  position: fixed; inset: 12px; z-index: 2100;
  background: #fff; border-radius: 12px; border: 1px solid #e4e1d8;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
  padding: 10px; display: flex;
}
.pb-drag {
  position: absolute; left: -7px; top: 0; bottom: 0; width: 12px;
  cursor: col-resize; z-index: 3;
}
.pb-drag::after {
  content: ''; position: absolute; left: 5px; top: 50%; width: 2px; height: 42px;
  margin-top: -21px; border-radius: 2px; background: #dcd9d0;
}
.pb-drag:hover::after { background: #185fa5; }
.pb-col--paper.is-full .pb-drag { display: none; }

.pb-paper-panel {
  background: #fff; border: 1px solid #e4e1d8; border-radius: 10px;
  display: flex; flex-direction: column; overflow: hidden;
  height: calc(100vh - 190px); min-height: 420px;
}
.pb-col--paper.is-full .pb-paper-panel { flex: 1; height: auto; border: 0; border-radius: 0; }

.pb-paper-panel__head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px; border-bottom: 1px solid #f0ede6;
}
.pb-tabs { display: flex; gap: 2px; }
.pb-tab {
  border: 0; background: transparent; padding: 4px 8px; border-radius: 6px;
  font-size: 12px; color: #666; cursor: pointer;
}
.pb-tab:hover { background: #f5f4f0; }
.pb-tab.is-active { background: #eef2ff; color: #185fa5; font-weight: 500; }
.pb-paper-panel__ops { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.pb-paper-panel__meta { font-size: 11px; color: #888; margin-right: 4px; white-space: nowrap; }
.pb-icon-btn {
  width: 22px; height: 22px; border: 1px solid #e2e0da; background: #fff;
  border-radius: 5px; cursor: pointer; line-height: 1; color: #555; font-size: 12px;
}
.pb-icon-btn:hover { border-color: #185fa5; color: #185fa5; }
.pb-icon-btn--pct { width: 44px; border-color: transparent; background: transparent; }
.pb-icon-btn--pct:hover { border-color: #e2e0da; }

.pb-paper-panel__form {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-bottom: 1px solid #f0ede6; background: #fbfaf7;
}
.pb-field { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #777; flex: 1; min-width: 0; }
.pb-field input { flex: 1; min-width: 0; font-size: 12px; padding: 3px 7px; border: 1px solid #ddd; border-radius: 5px; }
.pb-check { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #777; white-space: nowrap; }

.pb-paper-panel__stage { position: relative; flex: 1; min-height: 0; background: #e6e4de; }
.pb-paper-panel__frame { width: 100%; height: 100%; border: 0; background: transparent; display: block; }
.pb-paper-panel__blank {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; color: #999; font-size: 13px;
}
.pb-paper-panel__blank span { font-size: 11.5px; color: #aaa; }
.pb-paper-panel__mask {
  position: absolute; top: 8px; right: 8px;
  display: flex; align-items: center; gap: 6px;
  background: rgba(255, 255, 255, 0.92); border: 1px solid #e2e0da; border-radius: 14px;
  padding: 3px 10px 3px 6px; font-size: 11px; color: #666; pointer-events: none;
}
.pb-spinner {
  width: 12px; height: 12px; border: 2px solid #ddd; border-top-color: #185fa5;
  border-radius: 50%; animation: pb-spin 0.8s linear infinite;
}
@keyframes pb-spin { to { transform: rotate(360deg); } }

.pb-hint { font-size: 13px; color: #666; line-height: 1.7; margin-bottom: 12px; }
.pb-upload-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.pb-picked { font-size: 12px; color: #666; }

/* ── 截图加题 / PDF 加题（2026-11-07 统一为「往题集里加题」）── */
/* 「重新解析」会清空题集，用警示色提示；默认不勾就是追加 */
.pb-replace-opt {
  display: flex; align-items: flex-start; gap: 6px; margin-top: 10px;
  font-size: 12px; line-height: 1.5; color: #8a5a20; cursor: pointer;
}
.pb-replace-opt input { margin: 2px 0 0; cursor: pointer; }
.pb-link.is-danger { color: #a32d2d; }
.pb-link.is-danger:hover { color: #7d2020; }
/* 删除类操作默认不显现，hover 到题目行才出现（2026-11-07 负责人要求） */
.pb-row__foot .pb-link--quiet { opacity: 0; transition: opacity var(--wb-motion-fast, 120ms) ease; }
.pb-row:hover .pb-link--quiet, .pb-row:focus-within .pb-link--quiet { opacity: 1; }
.pb-hint kbd {
  display: inline-block; padding: 0 4px; border: 1px solid #d9d5cc;
  border-bottom-width: 2px; border-radius: 3px; background: #faf9f6;
  font-family: inherit; font-size: 11px; line-height: 16px; color: #555;
}
/* 粘贴/拖拽区：整块可点，虚线框表示「可以往里丢东西」 */
.pb-clip-drop {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; padding: 26px 16px; cursor: pointer;
  border: 1.5px dashed #d6d2c8; border-radius: 10px; background: #fbfaf7;
  text-align: center; transition: border-color .14s, background .14s;
}
.pb-clip-drop:hover { border-color: #b9b3a5; background: #f7f6f1; }
.pb-clip-drop.is-over { border-color: #8b5cf6; background: #f5f1ff; }
.pb-clip-drop strong { font-size: 13px; color: #444; }
.pb-clip-drop span { font-size: 11px; color: #999; }
.pb-clip-drop:focus-visible { outline: 2px solid #8b5cf6; outline-offset: 2px; }
.pb-clip-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px;
  max-height: 380px; overflow: auto; /* 每张图两个输入框（链接 + 时间点） */
}
.pb-clip-item {
  margin: 0; border: 1px solid #e6e2d9; border-radius: 8px;
  overflow: hidden; background: #fff; display: flex; flex-direction: column;
}
.pb-clip-item__img { position: relative; aspect-ratio: 4 / 3; background: #f6f5f1; }
.pb-clip-item img { width: 100%; height: 100%; object-fit: contain; background: #f6f5f1; }
.pb-clip-item__del {
  position: absolute; right: 3px; top: 3px; width: 18px; height: 18px;
  line-height: 16px; padding: 0; border: 1px solid #e6c9c9; border-radius: 50%;
  background: rgba(255, 255, 255, .94); color: #b4436c; font-size: 12px; cursor: pointer;
}
.pb-clip-item__del:hover { background: #fdecef; border-color: #d4537e; }
/* 每张截图的来源输入框（2026-11-07） */
.pb-clip-item__src {
  width: 100%; box-sizing: border-box; border: 0; border-top: 1px solid #eee9df;
  padding: 5px 6px; font-size: 10px; color: #444; background: #fcfbf8; font-family: inherit;
}
.pb-clip-item__src:focus { outline: none; background: #fff; }
.pb-clip-item__src::placeholder { color: #b3ada2; }
/* 第二个输入框：时间点 / 说明 */
.pb-clip-item__src--note { border-top: 1px dashed #eee9df; color: #6b5b3e; }
.pb-clip-count { margin: 8px 0 0; font-size: 11px; color: #8a8a8a; }
</style>
