<template>
  <div class="handout-preview wb-page wb-page--bleed">
    <!-- 顶部工具栏 -->
    <div class="handout-toolbar">
      <div class="toolbar-left">
        <el-button @click="goBack" :icon="ArrowLeft" text>返回</el-button>
        <span class="toolbar-title">{{ handout?.title || '备课讲义' }}</span>
        <el-tag v-if="handout?.templateLabel" size="small" type="info" effect="plain" class="template-tag">
          {{ handout.templateLabel }}
        </el-tag>
        <el-tag v-if="lectureId" size="small" type="success" effect="plain" class="template-tag">
          已保存
        </el-tag>
        <el-tag v-else-if="handout && dirty" size="small" type="warning" effect="plain" class="template-tag">
          未保存
        </el-tag>
        <el-tag v-if="sourceSummary.subject" size="small" type="info" effect="plain" class="template-tag">
          来源：{{ sourceSummary.subject }}{{ sourceSummary.period ? ' · ' + sourceSummary.period : '' }}{{ sourceSummary.total ? ' · ' + sourceSummary.total + ' 道错题' : '' }}
        </el-tag>
      </div>
      <div class="toolbar-right">
        <!-- 目录跳转 -->
        <WorkbenchSelect
          v-model="pageJumpIndex"
          :options="pageJumpOptions"
          size="small"
          clearable
          placeholder="📑 跳转目录"
          width="170px"
          aria-label="跳转到指定页"
          @change="gotoPage"
        />
        <!-- 模板下拉 -->
        <WorkbenchSelect
          v-model="selectedTemplate"
          :options="availableTemplates"
          :loading="templatesLoading"
          size="small"
          placeholder="选择模板"
          width="180px"
          aria-label="选择讲义模板"
          @change="handleTemplateChange"
        >
          <template #option="{ opt }">
            <div class="template-option">
              <span class="template-option-label">{{ opt.label }}</span>
              <span class="template-option-desc">{{ opt.description }}</span>
            </div>
          </template>
        </WorkbenchSelect>
        <el-button @click="openKnowledgeDialog" type="primary" plain :icon="Collection" :loading="knowledgeGenerating">
          按知识点
        </el-button>
        <el-button @click="openTypeLibrary" plain :icon="Collection" :loading="typeLibraryLoading">
          插入题型
        </el-button>
        <el-button @click="generateScriptForAll" type="warning" plain :loading="scriptLoading" :icon="MagicStick">
          生成讲课提词器
        </el-button>
        <el-button v-if="!lectureId" @click="handleSaveLecture" type="primary" plain :loading="saving" :icon="Document">保存讲义</el-button>
        <el-button v-else @click="handleDuplicate" plain :icon="CopyDocument" :loading="duplicating">复制</el-button>
        <el-button @click="handleExportWord" type="primary" :loading="exporting">
          <el-icon><Download /></el-icon> 导出 Word
        </el-button>
        <el-button @click="handlePrint"><el-icon><Printer /></el-icon> 打印</el-button>
        <el-button type="primary" plain :disabled="!handout" @click="enterPresentMode">课堂展示</el-button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="handout-loading">
      <el-skeleton :rows="20" animated />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!handout" class="handout-empty">
      <el-empty description="暂无讲义数据" />
    </div>

    <!-- 讲义内容 -->
    <div v-else class="handout-content" ref="handoutContentRef">
      <div v-for="(page, pIdx) in handout.pages" :key="pIdx" :ref="el => setPageRef(pIdx, el)" class="handout-page">
        <!-- 封面 -->
        <template v-if="page.name === 'cover'">
          <div class="handout-cover">
            <div class="cover-content">
              <div class="cover-label">敏学 · 备课讲义</div>
              <h1 class="cover-title">{{ getBlockContent(page.blocks, 'cover-title') }}</h1>
              <div class="cover-divider"></div>
              <div class="cover-info">{{ getBlockContent(page.blocks, 'cover-subtitle') }}</div>
              <div v-for="(b, i) in page.blocks.filter(x => x.type === 'cover-info')" :key="'ci'+i" class="cover-info">{{ b.content }}</div>
              <div class="cover-date">{{ getBlockContent(page.blocks, 'cover-date') }}</div>
            </div>
          </div>
        </template>

        <!-- 目录 -->
        <template v-else-if="page.name === 'toc'">
          <div class="handout-toc">
            <h2 class="page-title">目录</h2>
            <div class="toc-list">
              <div
                v-for="(block, bIdx) in page.blocks.filter(b => b.type === 'toc-item')"
                :key="bIdx"
                class="toc-item"
                :class="{ 'toc-item-sub': block.sub }"
              >
                <span class="toc-dot"></span>
                {{ block.content }}
              </div>
            </div>
          </div>
        </template>

        <!-- 知识点页面 -->
        <template v-else>
          <div class="handout-section">
            <!-- 页眉：学科/知识点 -->
            <div class="page-header">
              <span class="page-header-subject">{{ handout?.subject || '数学' }}</span>
              <span class="page-header-sep">|</span>
              <span class="page-header-kp">{{ page.name }}</span>
            </div>
            <h2 class="page-title">{{ page.name }}</h2>

            <div v-for="(block, bIdx) in page.blocks" :key="bIdx" class="handout-block">
              <!-- 知识点速览（AI 科普讲解） -->
              <div v-if="block.type === 'kp-overview'" class="block-kp-overview" :class="{ 'block-kp-overview-en': block.lang === 'en' }" v-html="renderMarkdown(block.content)"></div>

              <!-- 错题概况统计 -->
              <div v-else-if="block.type === 'kp-stats'" class="block-kp-stats">
                <el-row :gutter="12">
                  <el-col :span="6">
                    <div class="stat-card stat-total">
                      <div class="stat-value">{{ block.content.total }}</div>
                      <div class="stat-label">错题总数</div>
                    </div>
                  </el-col>
                  <el-col :span="6">
                    <div class="stat-card stat-blank">
                      <div class="stat-value">{{ block.content.blankCount }}</div>
                      <div class="stat-label">空题</div>
                    </div>
                  </el-col>
                  <el-col :span="6">
                    <div class="stat-card stat-wrong">
                      <div class="stat-value">{{ block.content.wrongCount }}</div>
                      <div class="stat-label">做错</div>
                    </div>
                  </el-col>
                  <el-col :span="6">
                    <div class="stat-card stat-type">
                      <div class="stat-value">{{ block.content.typeCount }}</div>
                      <div class="stat-label">涉及题型</div>
                    </div>
                  </el-col>
                </el-row>
                <div v-if="block.content.types?.length" class="type-chips">
                  <span
                    v-for="(t, i) in block.content.types"
                    :key="i"
                    class="type-chip"
                  >
                    {{ typeof t === 'string' ? t : t.type }} <span class="type-chip-count">{{ typeof t === 'string' ? '' : `×${t.count}` }}</span>
                  </span>
                </div>
              </div>

              <!-- 小标题（本周典型错题等） -->
              <h3 v-else-if="block.type === 'section'" class="block-section">{{ block.content }}</h3>

              <!-- 题型小标题（页内分组） -->
              <h4 v-else-if="block.type === 'type-section'" class="block-type-section">
                <span class="type-icon">📂</span>
                {{ block.content }}
              </h4>

              <!-- 错题 -->
              <div v-else-if="block.type === 'question'" class="block-question">
                <div class="question-header">
                  <span v-if="block.questionType" class="question-qtype">{{ block.questionType }}</span>
                </div>
                <div class="question-content" v-html="renderMath(block.content)"></div>
                <!-- 错题图（P1） -->
                <div v-if="block.imageUrls?.length" class="question-images">
                  <el-image
                    v-for="(img, iIdx) in block.imageUrls"
                    :key="iIdx"
                    :src="img"
                    :zoom-rate="1.2"
                    :max-scale="7"
                    :min-scale="0.5"
                    :preview-src-list="block.imageUrls"
                    :initial-index="iIdx"
                    fit="contain"
                    class="question-image"
                    loading="lazy"
                  >
                    <template #error>
                      <div class="image-error">📷 加载失败</div>
                    </template>
                  </el-image>
                </div>
                <div v-if="block.options?.length" class="question-options">
                  <div v-for="(opt, oIdx) in normalizeOptions(block.options)" :key="oIdx" class="option-item">
                    {{ String.fromCharCode(65 + oIdx) }}. {{ opt }}
                  </div>
                </div>
              </div>

              <!-- 答案 -->
              <div v-else-if="block.type === 'answer'" class="block-answer">
                <span class="answer-label">学生作答：</span>
                <span class="answer-value">{{ block.content }}</span>
                <span class="answer-correct">正确答案：{{ block.correctAnswer }}</span>
              </div>

              <!-- 错因分析 -->
              <div v-else-if="block.type === 'analysis'" class="block-analysis">
                <span class="analysis-label">错因分析：</span>
                {{ block.content }}
              </div>

              <!-- 讲解引导 -->
              <div v-else-if="block.type === 'lecture-guidance'" class="block-guidance" v-html="renderMarkdown(block.content)"></div>

              <!-- 相关知识点 -->
              <div v-else-if="block.type === 'related-kp'" class="block-related-kp">
                <span class="related-kp-label">🔗 相关知识点：</span>
                <span v-if="!block.content?.length" class="related-kp-empty">暂无</span>
                <el-tag
                  v-for="(rk, rkIdx) in block.content"
                  :key="rkIdx"
                  size="small"
                  type="info"
                  effect="plain"
                  class="related-kp-tag"
                >{{ rk }}</el-tag>
              </div>

              <!-- 老师笔记（可编辑） -->
              <div v-else-if="block.type === 'note'" class="block-note">
                <div class="note-header">
                  <span class="note-icon">📝</span>
                  <span class="note-title">我的笔记</span>
                  <span v-if="noteSaving" class="note-saving">保存中...</span>
                  <span v-else-if="lastSavedAt" class="note-saved">✓ 已保存 {{ lastSavedAt }}</span>
                </div>
                <textarea
                  v-model="noteText"
                  @input="onNoteInput"
                  class="note-textarea"
                  placeholder="在这里记下自己的经验、补充讲解、特殊学生备注... 自动保存到数据库"
                  rows="4"
                ></textarea>
              </div>

              <!-- 题型归纳（AI 归纳"换着样考的题型"） -->
              <div v-else-if="block.type === 'type-summary'" class="block-type-summary">
                <div v-if="!block.content || block.content.length === 0" class="type-summary-empty">
                  *（题型归纳暂不可用）*
                </div>
                <div v-else class="type-summary-list">
                  <div
                    v-for="(t, tIdx) in block.content"
                    :key="tIdx"
                    class="type-summary-item"
                  >
                    <div class="type-summary-header">
                      <span class="type-summary-num">{{ tIdx + 1 }}</span>
                      <span class="type-summary-type">{{ t.type }}</span>
                    </div>
                    <div v-if="t.description" class="type-summary-desc">
                      <span class="type-summary-label">怎么考：</span>{{ t.description }}
                    </div>
                    <div v-if="t.example" class="type-summary-example">
                      <span class="type-summary-label">典型例：</span>{{ t.example }}
                    </div>
                    <div v-if="t.tip" class="type-summary-tip">
                      <span class="type-summary-label">应对：</span>{{ t.tip }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- 知识点标题 -->
              <div v-else-if="block.type === 'kp-section'" class="block-kp-section">
                {{ block.content }}
              </div>

              <!-- 核心定义 -->
              <div v-else-if="block.type === 'kp-definition'" class="block-kp-definition">
                <div class="kp-label">核心定义</div>
                <div class="kp-text" v-html="renderMarkdown(block.content)"></div>
              </div>

              <!-- 重点内容 -->
              <div v-else-if="block.type === 'kp-key-points'" class="block-kp-key-points">
                <div class="kp-label kp-label-key">重点</div>
                <ul class="kp-list">
                  <li v-for="(p, pi) in (Array.isArray(block.content) ? block.content : [block.content])" :key="pi" v-html="renderMarkdown(p)"></li>
                </ul>
              </div>

              <!-- 难点内容 -->
              <div v-else-if="block.type === 'kp-difficult-points'" class="block-kp-difficult-points">
                <div class="kp-label kp-label-difficult">难点</div>
                <ul class="kp-list">
                  <li v-for="(p, pi) in (Array.isArray(block.content) ? block.content : [block.content])" :key="pi" v-html="renderMarkdown(p)"></li>
                </ul>
              </div>

              <!-- 易错点 -->
              <div v-else-if="block.type === 'kp-mistakes'" class="block-kp-mistakes">
                <div class="kp-label kp-label-mistake">易错警示</div>
                <ul class="kp-list">
                  <li v-for="(m, mi) in (Array.isArray(block.content) ? block.content : [block.content])" :key="mi" v-html="renderMarkdown(m)"></li>
                </ul>
              </div>

              <!-- 记忆口诀 -->
              <div v-else-if="block.type === 'kp-mnemonic'" class="block-kp-mnemonic">
                <div class="kp-label">记忆口诀</div>
                <div class="kp-mnemonic-text" v-html="renderMarkdown(block.content)"></div>
              </div>

              <!-- 🆕 对比卡片（投屏版：学生作答 vs 正确答案） -->
              <div v-else-if="block.type === 'compare-card'" class="block-compare-card">
                <div class="compare-grid">
                  <div class="compare-side compare-student">
                    <div class="compare-header">✍️ {{ block.content.studentName || '学生' }}作答</div>
                    <div class="compare-body">{{ block.content.studentAnswer }}</div>
                  </div>
                  <div class="compare-vs">VS</div>
                  <div class="compare-side compare-correct">
                    <div class="compare-header">✅ 正确答案</div>
                    <div class="compare-body">{{ block.content.correctAnswer }}</div>
                  </div>
                </div>
              </div>

              <!-- 分步作答过程 -->
              <div v-else-if="block.type === 'solution-steps'" class="block-solution-steps">
                <div class="solution-title">📝 完整作答过程</div>
                <div v-for="(step, si) in block.content" :key="si" class="solution-step">
                  <div class="solution-step-num">{{ step.step }}</div>
                  <div class="solution-step-body">
                    <div class="solution-step-text">{{ step.text }}</div>
                    <div v-if="step.formula" class="solution-step-formula" v-html="renderMath(step.formula)"></div>
                  </div>
                </div>
              </div>

              <!-- 🆕 时间建议（投屏版） -->
              <div v-else-if="block.type === 'time-hint'" class="block-time-hint">
                <span class="time-hint-icon">⏱️</span>
                <span class="time-hint-text">{{ block.content }}</span>
              </div>

              <!-- 错因简析 -->
              <div v-else-if="block.type === 'error-cause'" class="block-error-cause">
                <span class="error-cause-tag">错因</span>
                <span>{{ block.content }}</span>
              </div>

              <!-- 典型例题 -->
              <div v-else-if="block.type === 'type-example'" class="block-type-example">
                <span class="type-example-label">例题</span>
                <span v-html="renderMarkdown(block.content)"></span>
              </div>

              <!-- 关键技巧 -->
              <div v-else-if="block.type === 'type-tip'" class="block-type-tip">
                <span class="type-tip-label">技巧</span>
                <span v-html="renderMarkdown(block.content)"></span>
              </div>

              <!-- 讲课提词器（按时间分块） -->
              <div v-else-if="block.type === 'lecture-script'" class="block-lecture-script">
                <div v-for="(step, sIdx) in block.content" :key="sIdx" class="script-step">
                  <div class="script-step-header">
                    <span class="script-step-time">{{ step.time }}</span>
                    <span class="script-step-title">{{ step.title }}</span>
                  </div>
                  <div v-if="step.detail" class="script-step-detail">{{ step.detail }}</div>
                  <ul v-if="step.points?.length" class="script-step-points">
                    <li v-for="(p, pIdx) in step.points" :key="pIdx">{{ p }}</li>
                  </ul>
                  <div v-if="step.board" class="script-step-row">
                    <span class="script-step-label script-step-label-board">板书</span>
                    <span class="script-step-value">{{ step.board }}</span>
                  </div>
                  <div v-if="step.interaction" class="script-step-row">
                    <span class="script-step-label script-step-label-interaction">互动</span>
                    <span class="script-step-value">{{ step.interaction }}</span>
                  </div>
                </div>
              </div>

              <!-- 教育分隔线 -->
              <div v-else-if="block.type === 'edu-divider'" class="block-edu-divider"></div>

              <!-- 教育提示卡片 -->
              <div v-else-if="block.type === 'edu-note'" class="block-edu-note">
                <span class="edu-note-icon">💡</span>
                <span class="edu-note-text">{{ block.content }}</span>
              </div>

              <!-- 普通文本（写作范文 / 学生原文 / 复习建议等） -->
              <div v-else-if="block.type === 'text'" class="block-text" v-html="renderMarkdown(block.content)"></div>
            </div>

            <!-- 页脚：页码 -->
            <div class="page-footer">
              <span class="page-footer-text">敏学 · 备课讲义 | 第 {{ pIdx + 1 }} 页</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 按知识点生成对话框 -->
    <el-dialog
      v-model="knowledgeDialogVisible"
      title="选择知识点生成讲义"
      width="520px"
      :close-on-click-modal="false"
    >
      <div class="knowledge-dialog-hint">
        从知识树勾选要讲的知识点（如「一元一次方程」），系统会取该知识点下的错题作为例题，
        生成「知识点 → 例题 → 考试题型」讲义。
      </div>
      <div v-loading="knowledgeLoading" class="knowledge-tree-wrap">
        <el-tree
          ref="knowledgeTreeRef"
          :data="knowledgeTree"
          show-checkbox
          node-key="id"
          default-expand-all
          :props="{ label: 'name', children: 'children' }"
          empty-text="暂无知识点"
        />
      </div>
      <template #footer>
        <el-button @click="knowledgeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="knowledgeGenerating" @click="confirmKnowledgeGenerate">
          生成讲义
        </el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="typeLibraryVisible" title="从我的题型库插入" size="min(520px, 100%)">
      <div class="type-library-drawer">
        <p>选择一个知识点下已确认的题型。插入后会保存代表题与讲法快照，不会修改原题。</p>
        <WorkbenchInput v-model="typeLibraryKeyword" clearable placeholder="搜索题型" width="220px" aria-label="搜索题型">
          <template #prefix><el-icon><Collection /></el-icon></template>
        </WorkbenchInput>
        <div v-if="typeLibraryLoading" class="type-library-loading"><el-skeleton animated :rows="8" /></div>
        <el-empty v-else-if="!filteredLibraryTypes.length" description="没有可插入的题型" />
        <button v-for="item in filteredLibraryTypes" :key="item.id" type="button" class="type-library-item" @click="insertTeachingType(item)">
          <span><strong>{{ item.name }}</strong><small>{{ item.knowledge_name }} · {{ item.example_count }} 道代表题</small></span><el-icon><ArrowRight /></el-icon>
        </button>
      </div>
    </el-drawer>
    <!-- 课堂展示模式（只读全屏） -->
    <transition name="present-fade">
      <div v-if="presentMode" class="present-overlay">
        <!-- 顶栏 -->
        <div class="present-topbar">
          <div class="present-brand">敏学 · 课堂展示</div>
          <div class="present-kp">{{ presentTitle }}</div>
          <div class="present-counter">第 {{ presentIndex + 1 }} / {{ pagesCount }} 页</div>
          <div class="present-toolbar">
            <el-button size="small" @click="togglePresentAnswers">{{ showAnswers ? '\u9690\u85cf\u7b54\u6848' : '\u663e\u793a\u7b54\u6848' }}</el-button>
            <el-button size="small" @click="togglePresentScript">{{ showPresentScript ? '\u9690\u85cf\u63d0\u8bcd\u5668' : '\u663e\u793a\u63d0\u8bcd\u5668' }}</el-button>
            <el-button size="small" @click="handlePrint">
              <el-icon><Printer /></el-icon> 打印
            </el-button>
            <el-button size="small" type="danger" plain @click="exitPresentMode">退出展示</el-button>
          </div>
        </div>

        <!-- 舞台：一次只展示一页 -->
        <div class="present-stage">
          <div class="present-page" v-if="presentPage">
            <template v-if="presentPage.name === 'cover'">
              <div class="present-cover">
                <div class="present-cover-label">敏学 · 课堂展示</div>
                <h1 class="present-cover-title">{{ getBlockContent(presentPage.blocks, 'cover-title') }}</h1>
                <div class="present-cover-divider"></div>
                <div class="present-cover-info">{{ getBlockContent(presentPage.blocks, 'cover-subtitle') }}</div>
                <div v-for="(b, i) in presentPage.blocks.filter(x => x.type === 'cover-info')" :key="'ci' + i" class="present-cover-info">{{ b.content }}</div>
                <div class="present-cover-date">{{ getBlockContent(presentPage.blocks, 'cover-date') }}</div>
              </div>
            </template>

            <template v-else-if="presentPage.name === 'toc'">
              <div class="present-toc">
                <div class="present-page-header">
                  <span>{{ handout?.subject || '教学讲义' }}</span>
                  <span class="present-page-header-sep">·</span>
                  <span>目录</span>
                </div>
                <h1 class="present-page-title">📖 目录</h1>
                <div class="present-toc-list">
                  <div v-for="(b, i) in presentPage.blocks.filter(x => x.type === 'toc-item')" :key="i" class="present-toc-item">
                    <span class="present-toc-num">{{ i + 1 }}</span>
                    <span>{{ b.content }}</span>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="present-page-header">
                <span>{{ handout?.subject || '' }}</span>
                <span class="present-page-header-sep">·</span>
                <span>{{ presentSectionName }}</span>
              </div>
              <h1 class="present-page-title">{{ presentPage.name }}</h1>
              <div v-for="(block, bi) in presentBlocks" :key="bi" class="handout-block">
    <!-- 知识点速览 -->
                <div v-if="block.type === 'kp-overview'" class="block-kp-overview" v-html="renderMarkdown(block.content)"></div>
                <div v-else-if="block.type === 'kp-overview-en'" class="block-kp-overview-en" v-html="renderMarkdown(block.content)"></div>

                <!-- 小标题 -->
                <div v-else-if="block.type === 'section'" class="block-section">{{ block.content }}</div>

                <!-- 题型小标题 -->
                <div v-else-if="block.type === 'type-section'" class="block-type-section">
                  <span class="type-section-num">{{ presentBlockIndex(bi) }}</span>
                  <span>{{ block.content }}</span>
                </div>

                <!-- 错题 -->
                <div v-else-if="block.type === 'question'" class="block-question">
                  <div class="question-header">
                    <span v-if="block.questionType" class="question-qtype">{{ block.questionType }}</span>
                  </div>
                  <div class="question-content" v-html="renderMath(block.content)"></div>
                  <div v-if="block.imageUrls?.length" class="question-images">
                    <el-image
                      v-for="(img, iIdx) in block.imageUrls"
                      :key="iIdx"
                      :src="img"
                      :zoom-rate="1.2"
                      :max-scale="7"
                      :min-scale="0.5"
                      :preview-src-list="block.imageUrls"
                      :initial-index="iIdx"
                      fit="contain"
                      class="question-image"
                      loading="lazy"
                    >
                      <template #error>
                        <div class="image-error">📷 加载失败</div>
                      </template>
                    </el-image>
                  </div>
                  <div v-if="block.options?.length" class="question-options">
                    <div v-for="(opt, oIdx) in normalizeOptions(block.options)" :key="oIdx" class="option-item">
                      {{ String.fromCharCode(65 + oIdx) }}. {{ opt }}
                    </div>
                  </div>
                </div>

                <!-- 答案 -->
                <div v-else-if="block.type === 'answer'" class="block-answer">
                  <span class="answer-label">学生作答：</span>
                  <span class="answer-value">{{ block.content }}</span>
                  <span class="answer-correct">正确答案：{{ block.correctAnswer }}</span>
                </div>

                <!-- 错因分析 -->
                <div v-else-if="block.type === 'analysis'" class="block-analysis">
                  <span class="analysis-label">错因分析：</span>
                  {{ block.content }}
                </div>

                <!-- 讲解引导 -->
                <div v-else-if="block.type === 'lecture-guidance'" class="block-guidance" v-html="renderMarkdown(block.content)"></div>

                <!-- 相关知识点 -->
                <div v-else-if="block.type === 'related-kp'" class="block-related-kp">
                  <span class="related-kp-label">🔗 相关知识点：</span>
                  <span v-if="!block.content?.length" class="related-kp-empty">暂无</span>
                  <el-tag v-for="(rk, rkIdx) in block.content" :key="rkIdx" size="small" type="info" effect="plain" class="related-kp-tag">{{ rk }}</el-tag>
                </div>

                <!-- 题型归纳 -->
                <div v-else-if="block.type === 'type-summary'" class="block-type-summary">
                  <div v-if="!block.content || block.content.length === 0" class="type-summary-empty">*（题型归纳暂不可用）*</div>
                  <div v-else class="type-summary-list">
                    <div v-for="(t, tIdx) in block.content" :key="tIdx" class="type-summary-item">
                      <div class="type-summary-header">
                        <span class="type-summary-num">{{ tIdx + 1 }}</span>
                        <span class="type-summary-type">{{ t.type }}</span>
                      </div>
                      <div v-if="t.description" class="type-summary-desc">
                        <span class="type-summary-label">怎么考：</span>{{ t.description }}
                      </div>
                      <div v-if="t.example" class="type-summary-example">
                        <span class="type-summary-label">典型例：</span>{{ t.example }}
                      </div>
                      <div v-if="t.tip" class="type-summary-tip">
                        <span class="type-summary-label">应对：</span>{{ t.tip }}
                      </div>
                    </div>
                  </div>
                </div>
              <!-- 知识点标题 -->
                <div v-else-if="block.type === 'kp-section'" class="block-kp-section">{{ block.content }}</div>

                <!-- 核心定义 -->
                <div v-else-if="block.type === 'kp-definition'" class="block-kp-definition">
                  <div class="kp-label">核心定义</div>
                  <div class="kp-text" v-html="renderMarkdown(block.content)"></div>
                </div>

                <!-- 重点内容 -->
                <div v-else-if="block.type === 'kp-key-points'" class="block-kp-key-points">
                  <div class="kp-label kp-label-key">重点</div>
                  <ul class="kp-list">
                    <li v-for="(p, pi) in (Array.isArray(block.content) ? block.content : [block.content])" :key="pi" v-html="renderMarkdown(p)"></li>
                  </ul>
                </div>

                <!-- 难点内容 -->
                <div v-else-if="block.type === 'kp-difficult-points'" class="block-kp-difficult-points">
                  <div class="kp-label kp-label-difficult">难点</div>
                  <ul class="kp-list">
                    <li v-for="(p, pi) in (Array.isArray(block.content) ? block.content : [block.content])" :key="pi" v-html="renderMarkdown(p)"></li>
                  </ul>
                </div>

                <!-- 易错点 -->
                <div v-else-if="block.type === 'kp-mistakes'" class="block-kp-mistakes">
                  <div class="kp-label kp-label-mistake">易错警示</div>
                  <ul class="kp-list">
                    <li v-for="(m, mi) in (Array.isArray(block.content) ? block.content : [block.content])" :key="mi" v-html="renderMarkdown(m)"></li>
                  </ul>
                </div>

                <!-- 记忆口诀 -->
                <div v-else-if="block.type === 'kp-mnemonic'" class="block-kp-mnemonic">
                  <div class="kp-label">记忆口诀</div>
                  <div class="kp-mnemonic-text" v-html="renderMarkdown(block.content)"></div>
                </div>

                <!-- 对比卡片（学生作答 vs 正确答案） -->
                <div v-else-if="block.type === 'compare-card'" class="block-compare-card">
                  <div class="compare-grid">
                    <div class="compare-side compare-student">
                      <div class="compare-header">✍️ {{ block.content.studentName || '学生' }}作答</div>
                      <div class="compare-body">{{ block.content.studentAnswer }}</div>
                    </div>
                    <div class="compare-vs">VS</div>
                    <div class="compare-side compare-correct">
                      <div class="compare-header">✅ 正确答案</div>
                      <div class="compare-body">{{ block.content.correctAnswer }}</div>
                    </div>
                  </div>
                </div>

                <!-- 分步作答过程 -->
                <div v-else-if="block.type === 'solution-steps'" class="block-solution-steps">
                  <div class="solution-title">📝 完整作答过程</div>
                  <div v-for="(step, si) in block.content" :key="si" class="solution-step">
                    <div class="solution-step-num">{{ step.step }}</div>
                    <div class="solution-step-body">
                      <div class="solution-step-text">{{ step.text }}</div>
                      <div v-if="step.formula" class="solution-step-formula" v-html="renderMath(step.formula)"></div>
                    </div>
                  </div>
                </div>
              <!-- 时间建议 -->
                <div v-else-if="block.type === 'time-hint'" class="block-time-hint">
                  <span class="time-hint-icon">⏱️</span>
                  <span class="time-hint-text">{{ block.content }}</span>
                </div>

                <!-- 错因简析 -->
                <div v-else-if="block.type === 'error-cause'" class="block-error-cause">
                  <span class="error-cause-tag">错因</span>
                  <span>{{ block.content }}</span>
                </div>

                <!-- 典型例题 -->
                <div v-else-if="block.type === 'type-example'" class="block-type-example">
                  <span class="type-example-label">例题</span>
                  <span v-html="renderMarkdown(block.content)"></span>
                </div>

                <!-- 关键技巧 -->
                <div v-else-if="block.type === 'type-tip'" class="block-type-tip">
                  <span class="type-tip-label">技巧</span>
                  <span v-html="renderMarkdown(block.content)"></span>
                </div>

                <!-- 教育分隔线 -->
                <div v-else-if="block.type === 'edu-divider'" class="block-edu-divider"></div>

                <!-- 教育提示卡片 -->
                <div v-else-if="block.type === 'edu-note'" class="block-edu-note">
                  <span class="edu-note-icon">💡</span>
                  <span class="edu-note-text">{{ block.content }}</span>
                </div>

                <!-- 讲解（旧结构兼容） -->
                <div v-else-if="block.type === 'explanation'" class="block-explanation" v-html="renderMarkdown(block.content)"></div>

                <!-- 普通文本 -->
                <div v-else-if="block.type === 'text'" class="block-text" v-html="renderMarkdown(block.content)"></div>
              </div>

              <div class="present-page-footer">敏学 · 课堂展示 | 第 {{ presentIndex + 1 }} 页</div>
            </template>
          </div>
        </div>

        <!-- 底栏：翻页 / 跳转目录 -->
        <aside v-if="showPresentScript && presentScript.length" class="present-script-panel">
          <div class="present-script-title">&#25945;&#24072;&#25552;&#35789;&#22120;</div>
          <div v-for="(step, i) in presentScript" :key="i" class="present-script-step">
            <div class="present-script-step-head"><span>{{ step.time }}</span><strong>{{ step.title }}</strong></div>
            <div v-if="step.detail" class="present-script-detail">{{ step.detail }}</div>
            <ul v-if="step.points?.length"><li v-for="(point, pi) in step.points" :key="pi">{{ point }}</li></ul>
            <div v-if="step.interaction" class="present-script-interaction">&#20114;&#21160;&#65306;{{ step.interaction }}</div>
          </div>
        </aside>

        <div class="present-bottombar">
          <el-button size="large" :disabled="presentIndex === 0" @click="prevPresentPage">← 上一页</el-button>
          <WorkbenchSelect v-model="presentIndex" :options="presentOptions" size="large" placeholder="跳转目录" width="220px" aria-label="跳转目录" />
          <el-button size="large" type="primary" :disabled="presentIndex >= pagesCount - 1" @click="nextPresentPage">下一页 →</el-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, Download, Printer, Document, CopyDocument, MagicStick, Collection } from '@element-plus/icons-vue'
import { apiRequest, getKnowledgeTree } from '../../services/apiService'
import { normalizeOptions } from '../../utils/optionText'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import WorkbenchInput from '../components/ui/WorkbenchInput.vue'
import WorkbenchSelect from '../components/ui/WorkbenchSelect.vue'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const exporting = ref(false)
const saving = ref(false)
const duplicating = ref(false)
const scriptLoading = ref(false)
const handout = ref(null)
const handoutContentRef = ref(null)

// 模板相关
const availableTemplates = ref([])
const templatesLoading = ref(false)
const selectedTemplate = ref(null)
const currentSubject = ref('')

// 持久化相关（P2）
const lectureId = ref(null)        // 已保存的讲义 ID（DB 主键）
const dirty = ref(false)           // 是否有未保存的修改
const noteText = ref('')           // 当前页笔记（一个知识点页对应一份笔记）
const noteSaving = ref(false)
const lastSavedAt = ref('')
let noteSaveTimer = null

// 按知识点生成（P9：老师手动选规范知识点，如"一元一次方程"）
const knowledgeDialogVisible = ref(false)
const knowledgeTree = ref([])
const knowledgeLoading = ref(false)
const knowledgeGenerating = ref(false)
const knowledgeTreeRef = ref(null)
const typeLibraryVisible = ref(false)
const typeLibraryLoading = ref(false)
const typeLibraryKeyword = ref('')
const teachingTypes = ref([])
const filteredLibraryTypes = computed(() => {
  const keyword = typeLibraryKeyword.value.trim().toLowerCase()
  if (!keyword) return teachingTypes.value
  return teachingTypes.value.filter(item => `${item.name} ${item.knowledge_name} ${item.teaching_notes || ''}`.toLowerCase().includes(keyword))
})

// ── 课堂展示模式（P0：只读全屏，不修改讲义数据）──
const presentMode = ref(false)   // 默认备课模式；切换展示时置 true
const presentIndex = ref(0)
const showAnswers = ref(false)
const showPresentScript = ref(false)
// 展示模式下隐藏"备课/诊断"私有块（统计、笔记、提词器）
const PRESENT_HIDE_TYPES = ['kp-stats', 'note', 'lecture-script']
const PRESENT_ANSWER_TYPES = ['answer', 'analysis', 'solution-steps', 'error-cause']
const pagesCount = computed(() => handout.value?.pages?.length || 0)
const presentPage = computed(() => handout.value?.pages?.[presentIndex.value] ?? null)
const presentBlocks = computed(() => {
  const page = presentPage.value
  if (!page || !Array.isArray(page.blocks)) return []
  return page.blocks.filter(b => !PRESENT_HIDE_TYPES.includes(b.type) && (showAnswers.value || !PRESENT_ANSWER_TYPES.includes(b.type)))
})
const presentScript = computed(() => {
  const script = (presentPage.value?.blocks || []).find(block => block.type === 'lecture-script')?.content
  return Array.isArray(script) ? script : []
})
const presentTitle = computed(() => {
  const p = presentPage.value
  if (!p) return ''
  if (p.name === 'cover') return handout.value?.title || '封面'
  return p.name
})
// 知识点页名：去掉"· 知识点精讲"等后缀，保留短标题用于页眉
const presentSectionName = computed(() => {
  const p = presentPage.value
  if (!p || p.name === 'cover' || p.name === 'toc') return ''
  const seg = String(p.name).split('·')[0]?.trim()
  return seg || p.name
})
function presentBlockIndex(bi) {
  // 用于题型小节编号（展示顺序）
  return bi + 1
}
function pageLabel(p, i) {
  const name = p?.name || ''
  if (name === 'cover') return '封面'
  if (name === 'toc') return '目录'
  return name
}
const pageJumpOptions = computed(() => (handout.value?.pages || []).map((p, i) => ({ label: pageLabel(p, i), value: i })))
const presentOptions = computed(() => (handout.value?.pages || []).map((p, i) => ({ label: `${i + 1}. ${pageLabel(p, i)}`, value: i })))
function togglePresentAnswers() {
  showAnswers.value = !showAnswers.value
}
function togglePresentScript() {
  showPresentScript.value = !showPresentScript.value
}
async function enterPresentMode() {
  if (!handout.value?.pages?.length) {
    ElMessage.warning('暂无讲义数据')
    return
  }
  presentIndex.value = 0
  showAnswers.value = false
  showPresentScript.value = false
  presentMode.value = true
  try { await document.documentElement.requestFullscreen?.() } catch (e) { console.warn('????????:', e) }
  if (typeof window !== 'undefined') window.addEventListener('keydown', onPresentKeydown)
}
async function exitPresentMode() {
  presentMode.value = false
  if (document.fullscreenElement) { try { await document.exitFullscreen() } catch (e) { console.warn('??????:', e) } }
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onPresentKeydown)
}
function nextPresentPage() {
  if (presentIndex.value < pagesCount.value - 1) presentIndex.value += 1
}
function prevPresentPage() {
  if (presentIndex.value > 0) presentIndex.value -= 1
}
function onPresentKeydown(e) {
  if (!presentMode.value) return
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
  if (e.key === 'Escape') { e.preventDefault(); exitPresentMode(); return }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextPresentPage(); return }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPresentPage(); return }
}

// ── 备课模式：目录跳转 + 生成来源摘要（P1）──
const pageJumpIndex = ref(null)
const pageRefs = []
function setPageRef(idx, el) { pageRefs[idx] = el }
function gotoPage(idx) {
  if (idx == null) return
  const el = pageRefs[idx]
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  pageJumpIndex.value = null
}
const sourceSummary = computed(() => {
  const h = handout.value
  const subject = h?.subject || currentSubject.value || ''
  const period = h?.periodText || ''
  const diag = Array.isArray(h?.baseDiagnosis) ? h.baseDiagnosis : []
  const total = diag.reduce((acc, d) => acc + (Number(d.total) || 0), 0)
  return { subject, period, total }
})


// 英语题型标签映射
const ENGLISH_TYPE_LABELS = {
  cloze: '完形填空',
  grammar_blank: '语法填空',
  error_correction: '短文改错',
  translation: '翻译',
  writing: '书面表达',
  reading: '阅读理解',
  choice: '选择题',
  fill_blank: '填空',
  sentence_pattern: '句型转换',
  other: '其他',
}
function englishTypeLabel(t) { return ENGLISH_TYPE_LABELS[t] || t || '' }

function getBlockContent(blocks, type) {
  const block = blocks.find(b => b.type === type)
  return block?.content || ''
}

function renderMarkdown(text) {
  if (!text) return ''
  let result = text
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n/g, '<br>')
  // 最后渲染数学公式，确保 $...$ 和 $$...$$ 被 KaTeX 处理
  return renderMath(result)
}

function katexHtml(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore' })
  } catch (e) {
    return `<code>${String(tex).replace(/</g, '&lt;')}</code>`
  }
}

function renderMath(text) {
  if (!text) return ''
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => katexHtml(tex, true))
  result = result.replace(/(^|[^$])\$([^$\n]+?)\$(?!\$)/g, (m, prefix, tex) => prefix + katexHtml(tex, false))
  return result
}

function goBack() {
  if (dirty.value) {
    ElMessageBox.confirm('讲义有未保存的修改，是否保存？', '提示', { type: 'warning' })
      .then(() => { handleSaveLecture().finally(() => router.back()) })
      .catch(() => router.back())
  } else {
    router.back()
  }
}

async function handleExportWord() {
  if (!handout.value) return
  exporting.value = true
  try {
    const res = await fetch('/api/handout/export-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handout: handout.value,
        filename: (handout.value.title || '备课讲义') + '.docx',
      }),
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const j = await res.json()
        if (j && j.error) msg = j.error
      } catch {}
      throw new Error(msg)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (handout.value.title || '备课讲义') + '.docx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success('Word 导出成功')
  } catch (e) {
    ElMessage.error('导出失败: ' + e.message)
  } finally {
    exporting.value = false
  }
}

function handlePrint() {
  window.print()
}

/**
 * P4：为讲义中每个知识点页生成"讲课提词器"（按时间分块的讲课脚本）。
 * 用法：用户点"生成讲课提词器" → 遍历所有非封面/目录页 → 调后端 AI 生成脚本 → 注入到 pages 末尾。
 */
async function generateScriptForAll() {
  if (!handout.value?.pages?.length) {
    ElMessage.warning('暂无讲义数据')
    return
  }
  scriptLoading.value = true
  try {
    const kpPages = handout.value.pages.filter(p => p.name !== 'cover' && p.name !== 'toc')
    if (kpPages.length === 0) {
      ElMessage.warning('没有可生成的知识点页')
      return
    }
    let ok = 0
    for (const page of kpPages) {
      // 收集该页所有错题
      const questions = []
      let i = 0
      while (i < page.blocks.length) {
        const b = page.blocks[i]
        if (b.type === 'question') {
          const next = page.blocks[i + 1]
          const ans = next?.type === 'answer' ? next : null
          const ana = page.blocks[i + 2]?.type === 'analysis' ? page.blocks[i + 2] : null
          questions.push({
            questionId: b.questionId,
            content: b.content,
            studentAnswer: ans?.content?.replace(/^.*?：/, '').trim(),
            isBlank: ans?.content?.includes('空题'),
            errorType: ana?.content?.replace(/^错因[：:]/, '').split(/[（(]/)[0]?.trim(),
            questionType: b.questionType,
          })
          i += ans && ana ? 3 : (ans ? 2 : 1)
        } else { i++ }
      }
      try {
        const resp = await apiRequest('/handout/lecture-script', {
          method: 'POST',
          body: JSON.stringify({
            kpName: page.name,
            subject: handout.value.subject || '数学',
            sampleQuestions: questions.slice(0, 5),
            minutes: 15,
          }),
        })
        if (resp.success && Array.isArray(resp.script) && resp.script.length > 0) {
          // 移除旧 lecture-script block，再 push 新的
          page.blocks = page.blocks.filter(b => b.type !== 'lecture-script')
          page.blocks.push({ type: 'section', content: '🎯 讲课提词器' })
          page.blocks.push({ type: 'lecture-script', content: resp.script })
          ok += 1
        }
      } catch (e) {
        console.warn(`[script] ${page.name} 生成失败:`, e.message)
      }
    }
    if (ok > 0) {
      dirty.value = true
      ElMessage.success(`已为 ${ok}/${kpPages.length} 个知识点生成讲课提词器（点击"保存讲义"持久化）`)
    } else {
      ElMessage.error('提词器生成失败，请稍后重试')
    }
  } finally {
    scriptLoading.value = false
  }
}

// ── 模板加载/切换 ──
async function loadTemplates(subject) {
  templatesLoading.value = true
  try {
    const q = subject ? `?subject=${encodeURIComponent(subject)}` : ''
    const resp = await apiRequest(`/handout/templates${q}`, { method: 'GET' })
    if (resp && resp.success) {
      availableTemplates.value = resp.templates || []
    }
  } catch (e) {
    console.warn('加载讲义模板失败:', e)
    availableTemplates.value = []
  } finally {
    templatesLoading.value = false
  }
}

// ── 按知识点生成（P9） ──
async function openTypeLibrary() {
  typeLibraryVisible.value = true
  if (teachingTypes.value.length > 0) return
  typeLibraryLoading.value = true
  try {
    const response = await apiRequest('/teaching-question-types')
    teachingTypes.value = response.types || []
  } catch (error) {
    ElMessage.error('加载题型库失败: ' + error.message)
  } finally {
    typeLibraryLoading.value = false
  }
}

async function insertTeachingType(item) {
  try {
    const response = await apiRequest(`/teaching-question-types/${item.id}`)
    const type = response.type
    if (!type || !handout.value) return ElMessage.warning('题型或讲义不可用')
    const blocks = [
      { type: 'section', content: `题型 · ${type.name}`, sourceTypeId: type.id, knowledgePointId: type.kp_id },
      { type: 'related-kp', content: [type.knowledge_name] },
      ...(type.teaching_notes ? [{ type: 'lecture-guidance', content: type.teaching_notes }] : []),
      ...(type.common_mistakes ? [{ type: 'error-cause', content: type.common_mistakes }] : []),
    ]
    for (const example of type.examples || []) {
      const snapshot = example.snapshot || {}
      blocks.push({ type: 'question', content: snapshot.content || '题目内容不可用', options: snapshot.options || [], questionType: snapshot.questionType || '代表题', imageUrls: [snapshot.imageUrl].filter(Boolean), sourceTypeId: type.id, sourceExampleId: example.id })
      if (snapshot.answer) blocks.push({ type: 'answer', content: '课堂作答后揭晓', correctAnswer: snapshot.answer })
      if (snapshot.analysis) blocks.push({ type: 'analysis', content: snapshot.analysis })
    }
    const page = { name: `${type.knowledge_name} · ${type.name}`, blocks }
    const tocIndex = handout.value.pages.findIndex(pageItem => pageItem.name === 'toc')
    handout.value.pages.push(page)
    if (tocIndex >= 0) handout.value.pages[tocIndex].blocks.push({ type: 'toc-item', content: `题型：${type.knowledge_name} · ${type.name}`, sub: true })
    dirty.value = true
    typeLibraryVisible.value = false
    ElMessage.success('已插入题型讲解与代表题')
  } catch (error) {
    ElMessage.error('插入题型失败: ' + error.message)
  }
}
async function openKnowledgeDialog() {
  knowledgeDialogVisible.value = true
  if (knowledgeTree.value.length > 0) return
  knowledgeLoading.value = true
  try {
    const subject = currentSubject.value || '数学'
    knowledgeTree.value = await getKnowledgeTree(subject)
  } catch (e) {
    console.warn('加载知识树失败:', e)
    ElMessage.warning('加载知识点失败，请重试')
  } finally {
    knowledgeLoading.value = false
  }
}

// 收集勾选的具体知识点（仅叶子节点，父级板块/章节不作为讲义主题）
function collectCheckedKnowledge() {
  const nodes = knowledgeTreeRef.value ? knowledgeTreeRef.value.getCheckedNodes(true) : []
  const leaves = nodes.filter(n => !n.children || n.children.length === 0)
  return leaves.map(n => ({ name: n.name, subject: n.subject || currentSubject.value || '数学' }))
}

async function confirmKnowledgeGenerate() {
  const kps = collectCheckedKnowledge()
  if (kps.length === 0) {
    ElMessage.warning('请至少勾选一个具体知识点')
    return
  }
  knowledgeGenerating.value = true
  try {
    const resp = await apiRequest('/handout/by-knowledge', {
      method: 'POST',
      timeout: 180000,
      body: JSON.stringify({
        knowledge: kps,
        subject: currentSubject.value || '数学',
        template: selectedTemplate.value || null,
      }),
    })
    if (resp.success && resp.handout) {
      handout.value = resp.handout
      selectedTemplate.value = resp.handout.template || selectedTemplate.value
      currentSubject.value = resp.handout.subject || currentSubject.value
      lectureId.value = null
      dirty.value = true
      noteText.value = ''
      knowledgeDialogVisible.value = false
      ElMessage.success(`已生成《${kps.slice(0, 3).map(k => k.name).join('、')}》讲义`)
    } else {
      ElMessage.warning(resp.message || '未能生成讲义')
    }
  } catch (e) {
    console.error('按知识点生成失败:', e)
    ElMessage.error('生成失败: ' + e.message)
  } finally {
    knowledgeGenerating.value = false
  }
}


async function handleTemplateChange(newId) {
  if (!newId) return
  if (newId === handout.value?.template) return
  loading.value = true
  try {
    const subj = currentSubject.value || (route.query.subject || '')
    const response = await apiRequest('/handout/from-diagnosis', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'week',
        offset: 0,
        maxItems: 12,
        subject: subj,
        template: newId,
      }),
    })
    if (response.success && response.handout) {
      handout.value = response.handout
      dirty.value = true
      lectureId.value = null
      ElMessage.success('已切换模板（注意：当前讲义未保存到我的讲义库）')
    } else if (response.success) {
      ElMessage.info('该时段暂无共性错题数据')
    }
  } catch (e) {
    console.error('切换模板失败:', e)
    ElMessage.error('切换模板失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

// ── 持久化（P2） ──
async function handleSaveLecture() {
  if (!handout.value) return
  saving.value = true
  try {
    const payload = {
      title: handout.value.title,
      subject: handout.value.subject,
      periodText: handout.value.periodText,
      template: handout.value.template,
      baseQuery: { mode: 'week', offset: 0, subject: currentSubject.value || '', maxItems: 12 },
      baseDiagnosis: extractBaseDiagnosis(),
      blocks: handout.value.pages,
      notes: { _default: noteText.value }, // 简版：全讲义一份笔记
    }
    if (lectureId.value) {
      // 更新
      const resp = await apiRequest(`/handout/lectures/${lectureId.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      if (resp.success) {
        dirty.value = false
        lastSavedAt.value = new Date().toLocaleTimeString('zh-CN')
        ElMessage.success('已更新')
      }
    } else {
      // 新建
      const resp = await apiRequest('/handout/lectures', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (resp.success) {
        lectureId.value = resp.lecture.id
        dirty.value = false
        lastSavedAt.value = new Date().toLocaleTimeString('zh-CN')
        ElMessage.success('已保存到我的讲义库')
        // 更新 URL，刷新可恢复
        router.replace({ query: { ...route.query, lectureId: resp.lecture.id } })
      }
    }
  } catch (e) {
    console.error('保存讲义失败:', e)
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

async function handleDuplicate() {
  if (!lectureId.value) return
  duplicating.value = true
  try {
    const resp = await apiRequest(`/handout/lectures/${lectureId.value}/duplicate`, {
      method: 'POST',
    })
    if (resp.success) {
      ElMessage.success('已复制讲义')
      router.replace({ name: 'HandoutPreview', query: { lectureId: resp.lecture.id } })
    }
  } catch (e) {
    ElMessage.error('复制失败: ' + e.message)
  } finally {
    duplicating.value = false
  }
}

function onNoteInput() {
  dirty.value = true
  // 1.5s 节流自动保存（仅在已有 lectureId 时）
  if (noteSaveTimer) clearTimeout(noteSaveTimer)
  if (!lectureId.value) return
  noteSaveTimer = setTimeout(() => {
    saveNoteToDb()
  }, 1500)
}

async function saveNoteToDb() {
  if (!lectureId.value) return
  noteSaving.value = true
  try {
    await apiRequest(`/handout/lectures/${lectureId.value}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ pageName: '_default', content: noteText.value }),
    })
    dirty.value = false
    lastSavedAt.value = new Date().toLocaleTimeString('zh-CN')
  } catch (e) {
    console.warn('笔记保存失败:', e)
  } finally {
    noteSaving.value = false
  }
}

function extractBaseDiagnosis() {
  // 从 handout.pages 提取每个知识点的 sampleQuestions 简版快照
  return (handout.value?.pages || [])
    .filter(p => p.name !== 'cover' && p.name !== 'toc')
    .map(p => {
      const stats = p.blocks.find(b => b.type === 'kp-stats')
      return {
        kpName: p.name,
        total: stats?.content?.total || 0,
        blankCount: stats?.content?.blankCount || 0,
        wrongCount: stats?.content?.wrongCount || 0,
      }
    })
}

async function loadLectureFromDb(id) {
  const resp = await apiRequest(`/handout/lectures/${id}`)
  if (resp.success && resp.lecture) {
    const lec = resp.lecture
    handout.value = {
      title: lec.title,
      subject: lec.subject,
      periodText: lec.period_text ?? lec.periodText ?? '',
      template: lec.template,
      pages: Array.isArray(lec.blocks) ? lec.blocks : [],
      generatedAt: lec.created_at ?? lec.createdAt,
      baseQuery: lec.base_query ?? lec.baseQuery ?? {},
      baseDiagnosis: lec.base_diagnosis ?? lec.baseDiagnosis ?? [],
    }
    lectureId.value = lec.id
    noteText.value = lec.notes?._default || ''
    selectedTemplate.value = lec.template
    currentSubject.value = lec.subject || ''
    lastSavedAt.value = (lec.updated_at ?? lec.updatedAt) ? new Date(lec.updated_at ?? lec.updatedAt).toLocaleTimeString('zh-CN') : ''
    dirty.value = false
    return true
  }
  return false
}

onMounted(async () => {
  try {
    currentSubject.value = String(route.query.subject || '')
    await loadTemplates(currentSubject.value)

    // 优先从 lectureId 加载已保存的讲义
    const lid = route.query.lectureId
    if (lid) {
      const ok = await loadLectureFromDb(lid)
      if (ok) return
    }

    // 否则从路由参数拿 data，或从诊断生成
    const handoutData = route.query.data
    if (handoutData) {
      try {
        const parsed = JSON.parse(decodeURIComponent(handoutData))
        handout.value = parsed
        if (parsed?.template) selectedTemplate.value = parsed.template
        dirty.value = true
      } catch {
        await loadFromDiagnosis()
      }
    } else {
      await loadFromDiagnosis()
    }
    if (handout.value?.template) selectedTemplate.value = handout.value.template
  } catch (e) {
    console.error('加载讲义失败:', e)
    ElMessage.error('加载讲义失败')
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  if (noteSaveTimer) clearTimeout(noteSaveTimer)
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onPresentKeydown)
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
})

async function loadFromDiagnosis() {
  try {
    const subj = currentSubject.value
    const response = await apiRequest('/handout/from-diagnosis', {
      method: 'POST',
      timeout: 180000,
      body: JSON.stringify({
        mode: 'week',
        offset: 0,
        maxItems: 12,
        subject: subj,
        template: selectedTemplate.value || null,
      }),
    })
    if (response.success && response.handout) {
      handout.value = response.handout
      dirty.value = true
    }
  } catch (e) {
    console.error('从诊断生成讲义失败:', e)
  }
}
</script>

<style scoped>
.handout-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #F5F6FA;
}

/* 工具栏 */
.handout-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #E5E6EB;
  position: sticky;
  top: 0;
  z-index: 10;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar-title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}

/* 按知识点生成 */
.knowledge-dialog-hint {
  font-size: 13px;
  color: #86909C;
  background: #F7F8FA;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  line-height: 1.6;
}
.knowledge-tree-wrap {
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  padding: 8px;
}

/* 模板下拉 */
.template-tag {
  margin-left: 4px;
}
.template-option {
  display: flex;
  flex-direction: column;
  padding: 2px 0;
}
.template-option-label {
  font-size: 13px;
  color: #1D2129;
  font-weight: 500;
}
.template-option-desc {
  font-size: 11px;
  color: #86909C;
  margin-top: 2px;
}

/* 加载 & 空态 */
.handout-loading,
.handout-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
}

/* 讲义内容容器 */
.handout-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

/* 单页 */
.handout-page {
  width: 210mm;
  min-height: 297mm;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  padding: 48px 56px;
  border-radius: 4px;
  page-break-after: always;
}

/* 封面 */
.handout-cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 500px;
  text-align: center;
  background: #fff;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  padding: 60px 48px;
  position: relative;
  overflow: hidden;
}
/* 移除装饰伪元素 */
.handout-cover::before,
.handout-cover::after { display: none; }
.cover-label {
  font-size: 14px;
  color: #86909C;
  letter-spacing: 4px;
  margin-bottom: 32px;
}
.cover-title {
  font-size: 32px;
  font-weight: 700;
  color: #1D2129;
  margin: 0 0 24px;
  line-height: 1.4;
}
.cover-divider {
  width: 60px;
  height: 3px;
  background: #6366F1;
  border-radius: 2px;
  margin: 0 auto 32px;
}
.cover-info {
  font-size: 16px;
  color: #4E5969;
  margin-bottom: 8px;
}
.cover-date {
  font-size: 14px;
  color: #86909C;
  margin-top: 16px;
}

/* 目录 */
.handout-toc {
  padding: 24px 0;
}
.toc-list {
  margin-top: 24px;
}
.toc-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  font-size: 15px;
  color: #1D2129;
  border-bottom: 1px dashed #E5E6EB;
}
.toc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6366F1;
  flex-shrink: 0;
}
.toc-item-sub {
  padding: 6px 0 6px 24px;
  font-size: 13px;
  color: #4B5563;
  border-bottom: none;
  font-weight: 400;
}
.toc-item-sub .toc-dot {
  width: 4px;
  height: 4px;
  background: #D1D5DB;
}

/* 页面标题 */
.page-title {
  font-size: 24px;
  font-weight: 800;
  color: #1E1B4B;
  margin: 0 0 24px;
  padding-bottom: 14px;
  border-bottom: 3px solid #6366F1;
}

/* 区块 */
.handout-block {
  margin-bottom: 16px;
}

/* 知识点速览 */
.block-kp-overview {
  font-size: 14px;
  line-height: 1.8;
  color: #333;
  padding: 16px;
  background: #F7F8FA;
  border-radius: 8px;
  border-left: 3px solid #6366F1;
}
.block-kp-overview-en {
  font-family: 'Georgia', 'Times New Roman', serif;
  background: #EEF2FF;
  border-left: 3px solid #4F46E5;
  line-height: 1.9;
}

/* 错题概况 */
.block-kp-stats {
  margin: 16px 0 24px;
}
.stat-card {
  text-align: center;
  padding: 18px 8px;
  background: #FFFFFF;
  border-radius: 10px;
  border: 1px solid #E5E7EB;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: transform 0.15s ease;
}
.stat-card:hover { transform: translateY(-2px); }
.stat-value {
  font-size: 30px;
  font-weight: 800;
  color: #1F2937;
  line-height: 1.2;
}
.stat-label {
  font-size: 13px;
  color: #6B7280;
  margin-top: 6px;
  font-weight: 500;
}
.stat-blank .stat-value { color: #DC2626; }
.stat-wrong .stat-value { color: #F59E0B; }
.stat-type .stat-value { color: #6366F1; }
.type-chips {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.type-chip {
  display: inline-block;
  padding: 4px 12px;
  background: #EEF2FF;
  color: #4F46E5;
  border: 1px solid #C7D2FE;
  border-radius: 14px;
  font-size: 12px;
}
.type-chip-count {
  margin-left: 4px;
  color: #6366F1;
  font-weight: 600;
}

/* 小标题 */
.block-section {
  font-size: 20px;
  font-weight: 700;
  color: #1E1B4B;
  margin: 28px 0 16px;
  padding-left: 16px;
  border-left: 4px solid #6366F1;
  letter-spacing: 0.5px;
}

/* 题型小标题 */
.block-type-section {
  font-size: 20px;
  font-weight: 700;
  color: #4F46E5;
  margin: 20px 0 12px;
  padding: 10px 16px;
  background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%);
  border-radius: 8px;
  border: 1px solid #C7D2FE;
  display: flex;
  align-items: center;
  gap: 8px;
}
.type-icon { font-size: 18px; }

/* 题型归纳 */
.block-type-summary {
  margin: 12px 0 20px;
}
.type-summary-empty {
  padding: 16px;
  background: #F9FAFB;
  border: 1px dashed #E5E7EB;
  border-radius: 6px;
  color: #9CA3AF;
  font-size: 13px;
  text-align: center;
}
.type-summary-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.type-summary-item {
  padding: 12px 16px;
  background: #FFFBEB;
  border-left: 4px solid #F59E0B;
  border-radius: 6px;
  transition: transform 0.15s ease;
}
.type-summary-item:hover { transform: translateX(2px); }
.type-summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.type-summary-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: #F59E0B;
  color: white;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
}
.type-summary-type {
  font-size: 14px;
  font-weight: 600;
  color: #92400E;
}
.type-summary-desc,
.type-summary-example,
.type-summary-tip {
  font-size: 13px;
  line-height: 1.6;
  color: #4B5563;
  margin-top: 4px;
}
.type-summary-label {
  font-weight: 600;
  color: #B45309;
  margin-right: 4px;
}

/* 错题 */
.block-question {
  padding: 16px 20px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.question-header {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.question-qtype {
  display: inline-block;
  padding: 2px 8px;
  background: #ECFDF5;
  color: #047857;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid #A7F3D0;
}
.question-content {
  font-size: 18px;
  color: #1D2129;
  line-height: 1.8;
  margin-bottom: 8px;
}
.question-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0;
}
.question-image {
  max-width: 200px;
  max-height: 200px;
  border-radius: 4px;
  border: 1px solid #E5E6EB;
}
.image-error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 100px;
  background: #F7F8FA;
  color: #86909C;
  font-size: 12px;
  border-radius: 4px;
}
.question-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 24px;
  margin-top: 8px;
}
.option-item {
  font-size: 14px;
  color: #4E5969;
}

/* 答案 */
.block-answer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: #FFF7E6;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 6px;
}
.answer-label { color: #FA8C16; }
.answer-value { color: #1D2129; }
.answer-correct {
  color: #52C41A;
  margin-left: auto;
}

/* 错因分析 */
.block-analysis {
  padding: 8px 12px;
  background: #FFF1F0;
  border-radius: 6px;
  font-size: 13px;
  color: #F5222D;
  margin-bottom: 6px;
}
.analysis-label { font-weight: 600; }

/* 讲解引导 */
.block-guidance {
  padding: 10px 14px;
  background: #FEF3C7;
  border-left: 3px solid #F59E0B;
  border-radius: 6px;
  font-size: 13px;
  color: #78350F;
  line-height: 1.7;
  margin-bottom: 8px;
}

/* 相关知识点 */
.block-related-kp {
  padding: 10px 14px;
  background: #F0F9FF;
  border-radius: 6px;
  font-size: 13px;
  color: #1D2129;
  margin: 8px 0;
}
.related-kp-label {
  font-weight: 600;
  color: #0EA5E9;
  margin-right: 8px;
}
.related-kp-empty {
  color: #86909C;
  font-style: italic;
}
.related-kp-tag {
  margin-right: 6px;
}

/* 老师笔记 */
.block-note {
  margin-top: 16px;
  padding: 12px 16px;
  background: #FFFBEB;
  border: 1px dashed #F59E0B;
  border-radius: 8px;
}
.note-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.note-icon { font-size: 16px; }
.note-title {
  font-size: 13px;
  font-weight: 600;
  color: #78350F;
  flex: 1;
}
.note-saving {
  font-size: 11px;
  color: #FA8C16;
}
.note-saved {
  font-size: 11px;
  color: #52C41A;
}
.note-textarea {
  width: 100%;
  border: 1px solid #FDE68A;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  background: #FFFBEB;
  color: #1D2129;
}
.note-textarea:focus {
  outline: none;
  border-color: #F59E0B;
  background: #fff;
}

/* 普通文本 */
.block-text {
  font-size: 14px;
  line-height: 1.6;
  color: #4E5969;
}

/* 讲课提词器（P4） */
.block-lecture-script {
  margin: 16px 0;
  background: #FAF5FF;
  border: 1px solid #DDD6FE;
  border-radius: 8px;
  padding: 16px 20px;
}
.script-step {
  margin-bottom: 14px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  border-left: 3px solid #8B5CF6;
}
.script-step:last-child { margin-bottom: 0; }
.script-step-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.script-step-time {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  font-weight: 700;
  color: #8B5CF6;
  background: #FFFFFF;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #DDD6FE;
}
.script-step-title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
}
.script-step-detail {
  font-size: 13px;
  color: #4E5969;
  margin-bottom: 8px;
  line-height: 1.6;
}
.script-step-points {
  margin: 6px 0 8px 0;
  padding-left: 20px;
  list-style: disc;
}
.script-step-points li {
  font-size: 13px;
  color: #1D2129;
  line-height: 1.7;
  margin-bottom: 2px;
}
.script-step-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.6;
}
.script-step-label {
  flex-shrink: 0;
  font-weight: 600;
  padding: 0 6px;
  border-radius: 3px;
  height: 18px;
  line-height: 18px;
  margin-top: 1px;
}
.script-step-label-board {
  background: #FFF7E6;
  color: #FA8C16;
}
.script-step-label-interaction {
  background: #E6F7FF;
  color: #0EA5E9;
}
.script-step-value {
  color: #4E5969;
  flex: 1;
}

/* ========== 极简投屏样式 ========== */

/* 页眉 */
.page-header {
  padding: 10px 0;
  margin-bottom: 20px;
  border-bottom: 1px solid #E5E7EB;
  font-size: 13px;
  color: #9CA3AF;
  display: flex;
  gap: 8px;
}
.page-header-subject { font-weight: 600; color: #6366F1; }
.page-header-sep { color: #D1D5DB; }
.page-header-kp { color: #6B7280; }

/* 页脚 */
.page-footer {
  padding: 12px 0;
  margin-top: 24px;
  border-top: 1px solid #E5E7EB;
  font-size: 12px;
  color: #9CA3AF;
  text-align: center;
}

/* 对比卡片（学生作答 vs 正确答案） */
.block-compare-card {
  margin: 12px 0;
}
.compare-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #E5E7EB;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.compare-side {
  padding: 16px 20px;
}
.compare-student {
  background: linear-gradient(135deg, #FEF2F2 0%, #FFF5F5 100%);
}
.compare-correct {
  background: linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%);
}
.compare-header {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 8px;
}
.compare-student .compare-header { color: #DC2626; }
.compare-correct .compare-header { color: #16A34A; }
.compare-body {
  font-size: 18px;
  line-height: 1.7;
  color: #1F2937;
  word-break: break-word;
}
.compare-vs {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  font-size: 14px;
  font-weight: 800;
  color: #9CA3AF;
  background: #F9FAFB;
  writing-mode: vertical-lr;
  letter-spacing: 2px;
}

/* 时间建议 */
.block-time-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%);
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #6B7280;
}
.time-hint-icon {
  font-size: 24px;
}
.time-hint-text {
  flex: 1;
}

/* 保持投屏可读性 */
.handout-page {
  font-size: 16px;
}
.handout-page .page-title {
  font-size: 26px;
}
.handout-page .block-section {
  font-size: 20px;
}
.handout-page .question-content {
  font-size: 18px;
  line-height: 1.8;
}

/* 打印样式 */
@media print {
  .handout-toolbar { display: none; }
  .handout-preview { background: #fff; }
  .handout-page {
    box-shadow: none;
    padding: 32px 40px;
    page-break-after: always;
  }
  .block-note { display: none; } /* 打印时隐藏笔记 */
}

/* === 教育分隔线 === */
.block-edu-divider {
  height: 2px;
  background: linear-gradient(90deg, #6366F1 0%, #A5B4FC 50%, transparent 100%);
  margin: 20px 0 24px;
  border-radius: 1px;
}

/* === 教育提示卡片 === */
.block-edu-note {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  margin: 16px 0;
  background: linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%);
  border: 1px solid #C7D2FE;
  border-radius: 8px;
  font-size: 16px;
  color: #4338CA;
  line-height: 1.7;
}
.edu-note-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}
.edu-note-text {
  flex: 1;
}

/* === 知识点纵向结构（教育专业版） === */
.block-kp-section {
  font-size: 28px;
  font-weight: 800;
  color: #1E1B4B;
  padding: 0 0 20px;
  margin-bottom: 24px;
  border-bottom: 3px solid #6366F1;
  letter-spacing: 1px;
}
.kp-label {
  font-size: 18px;
  font-weight: 700;
  color: #6B7280;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.kp-label::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 18px;
  background: #6366F1;
  border-radius: 2px;
}
.kp-label-key { color: #4F46E5; }
.kp-label-key::before { background: #4F46E5; }
.kp-label-difficult { color: #D97706; }
.kp-label-difficult::before { background: #F59E0B; }
.kp-label-mistake { color: #DC2626; }
.kp-label-mistake::before { background: #EF4444; }
.kp-text {
  font-size: 18px;
  line-height: 1.9;
  color: #1F2937;
}
.kp-list {
  margin: 0;
  padding-left: 24px;
  font-size: 18px;
  line-height: 2.0;
  color: #374151;
}
.kp-list li { margin-bottom: 8px; }

.block-kp-definition {
  margin-bottom: 28px;
  padding: 20px 24px;
  background: linear-gradient(135deg, #F5F7FF 0%, #EEF2FF 100%);
  border-radius: 10px;
  border-left: 4px solid #6366F1;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.08);
}
.block-kp-key-points {
  margin-bottom: 24px;
  padding: 20px 24px;
  background: #FFFFFF;
  border-radius: 10px;
  border: 1px solid #E0E7FF;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.block-kp-key-points .kp-list li {
  font-size: 20px;
  font-weight: 700;
  color: #1E1B4B;
}
.block-kp-difficult-points {
  margin-bottom: 24px;
  padding: 20px 24px;
  background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%);
  border-radius: 10px;
  border-left: 4px solid #F59E0B;
  box-shadow: 0 1px 3px rgba(245, 158, 11, 0.08);
}
.block-kp-difficult-points .kp-list li {
  font-size: 20px;
  font-weight: 600;
  color: #92400E;
}
.block-kp-mistakes {
  margin-bottom: 24px;
  padding: 20px 24px;
  background: linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%);
  border-radius: 10px;
  border-left: 4px solid #EF4444;
  box-shadow: 0 1px 3px rgba(239, 68, 68, 0.08);
}
.block-kp-mistakes .kp-list li {
  font-size: 18px;
  color: #991B1B;
}
.block-kp-mnemonic {
  padding: 20px 24px;
  background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%);
  border-radius: 10px;
  border: 2px solid #6EE7B7;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(16, 185, 129, 0.08);
}
.kp-mnemonic-text {
  font-size: 20px;
  color: #047857;
  font-style: italic;
  line-height: 1.8;
  font-weight: 500;
}

/* === 分步作答过程 === */
.block-solution-steps {
  margin: 20px 0;
  padding: 24px 28px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.solution-title {
  font-size: 16px;
  font-weight: 700;
  color: #4F46E5;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid #EEF2FF;
  display: flex;
  align-items: center;
  gap: 8px;
}
.solution-step {
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
  align-items: flex-start;
}
.solution-step:last-child { margin-bottom: 0; }
.solution-step-num {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  box-shadow: 0 2px 4px rgba(99, 102, 241, 0.2);
}
.solution-step-body {
  flex: 1;
}
.solution-step-text {
  font-size: 18px;
  line-height: 1.7;
  color: #1F2937;
}
.solution-step-formula {
  margin-top: 8px;
  padding: 10px 16px;
  background: #F9FAFB;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  font-size: 16px;
  overflow-x: auto;
}

/* === 错因简析 === */
.block-error-cause {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  margin: 10px 0;
  background: #FEF2F2;
  border-radius: 6px;
  border: 1px solid #FECACA;
  font-size: 16px;
  color: #DC2626;
}
.error-cause-tag {
  font-weight: 700;
  flex-shrink: 0;
  background: #DC2626;
  color: #fff;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 13px;
}

/* === 题型相关 === */
.block-type-example {
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  margin: 10px 0;
  background: #F9FAFB;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  font-size: 18px;
  line-height: 1.8;
  color: #1F2937;
}
.type-example-label {
  font-weight: 700;
  color: #4F46E5;
  flex-shrink: 0;
  background: #EEF2FF;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 14px;
}
.block-type-tip {
  display: flex;
  gap: 12px;
  padding: 12px 18px;
  margin: 10px 0;
  background: linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%);
  border-radius: 8px;
  border: 1px solid #A7F3D0;
  font-size: 16px;
  color: #047857;
  line-height: 1.7;
}
.type-tip-label {
  font-weight: 700;
  flex-shrink: 0;
  background: #D1FAE5;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 14px;
  color: #047857;
}
/* ── 课堂展示模式（只读全屏）── */
.present-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9997;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 50% 0%, #101828 0%, #0a101d 70%);
  overflow: hidden;
}
.present-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  background: rgba(15, 23, 42, 0.94);
  border-bottom: 1px solid #1E293B;
  flex-shrink: 0;
}
.present-brand {
  font-size: 15px;
  font-weight: 700;
  color: #A5B4FC;
  letter-spacing: 1px;
  flex-shrink: 0;
}
.present-kp {
  font-size: 15px;
  color: #E5E7EB;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.present-counter {
  font-size: 14px;
  color: #94A3B8;
  white-space: nowrap;
}
.present-toolbar {
  display: flex;
  gap: 8px;
}
.present-stage {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 20px 24px;
}
.present-page {
  width: 100%;
  max-width: 1280px;
  min-height: calc(100vh - 170px);
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.55);
  padding: 56px 68px;
  color: #1F2937;
}
.present-page-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0 10px 16px;
  border-left: 14px solid #6366F1;
  border-bottom: 1px solid #EEF2FF;
  font-size: 14px;
  color: #6B7280;
}
.present-page-header-sep { color: #94A3B8; }
.present-page-title {
  font-size: 38px;
  font-weight: 800;
  color: #1E1B4B;
  margin: 20px 0 26px;
  border-bottom: 3px solid #6366F1;
  padding-bottom: 10px;
  line-height: 1.3;
}
.present-page-footer {
  margin-top: 28px;
  text-align: right;
  font-size: 13px;
  color: #94A3B8;
  border-top: 1px solid #F1F5F9;
  padding-top: 12px;
}
.present-cover {
  min-height: calc(100vh - 320px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  text-align: center;
}
.present-cover-label {
  font-size: 20px;
  letter-spacing: 6px;
  color: #6366F1;
  font-weight: 600;
  border: 1px solid #C7D2FE;
  background: #EEF2FF;
  padding: 6px 22px;
  border-radius: 999px;
}
.present-cover-title {
  font-size: 52px;
  font-weight: 800;
  color: #1E1B4B;
  line-height: 1.3;
}
.present-cover-divider {
  width: 80px;
  height: 4px;
  background: #6366F1;
  border-radius: 2px;
}
.present-cover-info {
  font-size: 22px;
  color: #4E5969;
  line-height: 1.8;
}
.present-cover-date {
  font-size: 18px;
  color: #86909C;
}
.present-toc { padding: 40px 20px; }
.present-toc-list { margin-top: 26px; }
.present-toc-item {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 16px;
  margin-bottom: 8px;
  font-size: 24px;
  color: #1F2937;
  border-bottom: 1px dashed #E2E8F0;
}
.present-toc-num {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  background: #EEF2FF;
  color: #4F46E5;
  border-radius: 50%;
  font-weight: 700;
  flex-shrink: 0;
}
.present-script-panel {
  position: absolute; right: 24px; top: 70px; bottom: 78px; width: 320px; overflow: auto;
  padding: 16px; background: rgba(15, 23, 42, 0.96); color: #E5E7EB;
  border: 1px solid #334155; border-radius: 10px; z-index: 2;
}
.present-script-title { font-size: 16px; font-weight: 700; color: #A5B4FC; margin-bottom: 14px; }
.present-script-step { padding: 10px 0; border-bottom: 1px solid #334155; line-height: 1.6; }
.present-script-step-head { display: flex; gap: 8px; align-items: baseline; }
.present-script-step-head span { color: #93C5FD; font-size: 12px; }
.present-script-detail, .present-script-step li, .present-script-interaction { margin-top: 6px; font-size: 13px; color: #CBD5E1; }
.present-script-step ul { margin: 6px 0 0; padding-left: 18px; }
.present-script-interaction { color: #86EFAC; }

.present-bottombar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 12px 16px;
  flex-shrink: 0;
  background: rgba(15, 23, 42, 0.96);
  border-top: 1px solid #1E293B;
}

/* 展示模式内正文放大字号 */
.present-page .block-section { font-size: 30px; }
.present-page .block-type-section { font-size: 30px; }
.present-page .block-kp-section { font-size: 34px; }
.present-page .block-kp-overview,
.present-page .block-kp-overview-en { font-size: 22px; line-height: 1.8; }
.present-page .block-kp-definition,
.present-page .block-kp-key-points,
.present-page .block-kp-difficult-points,
.present-page .block-kp-mistakes { font-size: 22px; }
.present-page .block-kp-mnemonic { font-size: 22px; }
.present-page .kp-label { font-size: 22px; }
.present-page .kp-text,
.present-page .kp-mnemonic-text { font-size: 22px; line-height: 1.8; }
.present-page .kp-list { font-size: 22px; line-height: 1.7; }
.present-page .question-content { font-size: 24px; line-height: 1.7; }
.present-page .option-item { font-size: 20px; }
.present-page .question-qtype { font-size: 16px; }
.present-page .block-answer,
.present-page .answer-value,
.present-page .answer-correct { font-size: 22px; }
.present-page .analysis-label,
.present-page .block-analysis { font-size: 22px; }
.present-page .block-guidance { font-size: 22px; line-height: 1.8; }
.present-page .block-related-kp { font-size: 22px; }
.present-page .type-summary-item { font-size: 20px; }
.present-page .type-summary-desc,
.present-page .type-summary-example,
.present-page .type-summary-tip,
.present-page .type-summary-label { font-size: 20px; }
.present-page .compare-header { font-size: 20px; }
.present-page .compare-side,
.present-page .compare-body { font-size: 22px; line-height: 1.7; }
.present-page .solution-step-text,
.present-page .solution-step-formula { font-size: 22px; }
.present-page .solution-title { font-size: 24px; }
.present-page .time-hint-icon,
.present-page .time-hint-text { font-size: 20px; }
.present-page .error-cause-tag,
.present-page .block-error-cause { font-size: 20px; }
.present-page .type-example-label,
.present-page .block-type-example,
.present-page .type-tip-label,
.present-page .block-type-tip { font-size: 20px; }
.present-page .block-edu-note,
.present-page .edu-note-icon,
.present-page .edu-note-text { font-size: 20px; }
.present-page .block-text,
.present-page .block-explanation { font-size: 22px; line-height: 1.8; }
.present-page .question-image { max-height: 420px; }

/* 淡入淡出 */
.present-fade-enter-active,
.present-fade-leave-active { transition: opacity 0.25s ease; }
.present-fade-enter-from,
.present-fade-leave-to { opacity: 0; }
.type-library-drawer{display:grid;gap:12px}.type-library-drawer>p{margin:0;color:var(--wb-text-secondary);font-size:13px;line-height:1.65}.type-library-loading{padding:12px 0}.type-library-item{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:13px;border:1px solid var(--wb-border-light);border-radius:8px;background:var(--wb-bg-card);color:inherit;text-align:left;cursor:pointer}.type-library-item:hover{border-color:var(--wb-primary);background:var(--wb-primary-soft)}.type-library-item span{display:grid;gap:4px;min-width:0}.type-library-item strong{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.type-library-item small{color:var(--wb-text-tertiary);font-size:11px}</style>
