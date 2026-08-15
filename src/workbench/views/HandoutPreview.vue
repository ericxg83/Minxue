<template>
  <div class="handout-preview">
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
      </div>
      <div class="toolbar-right">
        <!-- 模板下拉 -->
        <el-select
          v-model="selectedTemplate"
          @change="handleTemplateChange"
          placeholder="选择模板"
          size="small"
          style="width: 180px;"
          :loading="templatesLoading"
        >
          <el-option
            v-for="t in availableTemplates"
            :key="t.id"
            :label="t.label"
            :value="t.id"
          >
            <div class="template-option">
              <span class="template-option-label">{{ t.label }}</span>
              <span class="template-option-desc">{{ t.description }}</span>
            </div>
          </el-option>
        </el-select>
        <el-button @click="openKnowledgeDialog" type="primary" plain :icon="Collection" :loading="knowledgeGenerating">
          按知识点
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
      <div v-for="(page, pIdx) in handout.pages" :key="pIdx" class="handout-page">
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
                  <div v-for="(opt, oIdx) in block.options" :key="oIdx" class="option-item">
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Download, Printer, Document, CopyDocument, MagicStick, Collection } from '@element-plus/icons-vue'
import { apiRequest, getKnowledgeTree } from '../../services/apiService'
import katex from 'katex'
import 'katex/dist/katex.min.css'

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
      periodText: lec.periodText,
      template: lec.template,
      pages: lec.blocks,
      generatedAt: lec.createdAt,
    }
    lectureId.value = lec.id
    noteText.value = lec.notes?._default || ''
    selectedTemplate.value = lec.template
    currentSubject.value = lec.subject || ''
    lastSavedAt.value = lec.updatedAt ? new Date(lec.updatedAt).toLocaleTimeString('zh-CN') : ''
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
  background: linear-gradient(90deg, #6366F1, #4F46E5);
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
  font-size: 22px;
  font-weight: 700;
  color: #1D2129;
  margin: 0 0 24px;
  padding-bottom: 12px;
  border-bottom: 2px solid #6366F1;
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
  margin: 16px 0;
}
.stat-card {
  text-align: center;
  padding: 16px 8px;
  background: #F7F8FA;
  border-radius: 8px;
  border: 1px solid #E5E6EB;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #1D2129;
  line-height: 1.2;
}
.stat-label {
  font-size: 12px;
  color: #86909C;
  margin-top: 4px;
}
.stat-blank .stat-value { color: #F5222D; }
.stat-wrong .stat-value { color: #FA8C16; }
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
  font-size: 17px;
  font-weight: 600;
  color: #1D2129;
  margin: 24px 0 12px;
  padding-left: 12px;
  border-left: 3px solid #6366F1;
}

/* 题型小标题 */
.block-type-section {
  font-size: 15px;
  font-weight: 600;
  color: #4F46E5;
  margin: 20px 0 12px;
  padding: 8px 12px;
  background: #EEF2FF;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.type-icon { font-size: 16px; }

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
  background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%);
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
  padding: 12px 16px;
  background: #FAFBFC;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  margin-bottom: 8px;
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
  font-size: 14px;
  color: #1D2129;
  line-height: 1.6;
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
  background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%);
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
  background: linear-gradient(180deg, #FAF5FF 0%, #F5F3FF 100%);
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
  padding: 8px 0;
  margin-bottom: 16px;
  border-bottom: 1px solid #E5E6EB;
  font-size: 12px;
  color: #86909C;
}

/* 页脚 */
.page-footer {
  padding: 8px 0;
  margin-top: 16px;
  border-top: 1px solid #E5E6EB;
  font-size: 12px;
  color: #86909C;
  text-align: center;
}

/* 对比卡片（学生作答 vs 正确答案） */
.block-compare-card {
  margin: 10px 0;
}
.compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #E5E6EB;
}
.compare-side {
  padding: 14px 18px;
}
.compare-student {
  background: #FFF5F5;
  border-right: 1px solid #FECACA;
}
.compare-correct {
  background: #F0FFF4;
}
.compare-header {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
}
.compare-student .compare-header { color: #DC2626; }
.compare-correct .compare-header { color: #16A34A; }
.compare-body {
  font-size: 16px;
  line-height: 1.6;
  color: #1D2129;
  word-break: break-word;
}
/* 移除 VS 竖条 */
.compare-vs { display: none; }

/* 时间建议 */
.block-time-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  margin-bottom: 16px;
  background: #F9FAFB;
  border: 1px solid #E5E6EB;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #6B7280;
}
.time-hint-icon {
  font-size: 22px;
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
  font-size: 16px;
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

/* === 知识点纵向结构 === */
.block-kp-section {
  font-size: 26px;
  font-weight: 700;
  color: #1D2129;
  padding: 0 0 16px;
  margin-bottom: 20px;
  border-bottom: 2px solid #E5E6EB;
}
.kp-label {
  font-size: 14px;
  font-weight: 700;
  color: #86909C;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.kp-label-key { color: #6366F1; }
.kp-label-difficult { color: #F59E0B; }
.kp-label-mistake { color: #DC2626; }
.kp-text {
  font-size: 16px;
  line-height: 1.8;
  color: #1D2129;
}
.kp-list {
  margin: 0;
  padding-left: 20px;
  font-size: 16px;
  line-height: 1.9;
  color: #4E5969;
}
.kp-list li { margin-bottom: 6px; }

.block-kp-definition {
  margin-bottom: 24px;
  padding: 16px 20px;
  background: #F9FAFB;
  border-radius: 6px;
  border-left: 3px solid #6366F1;
}
.block-kp-key-points {
  margin-bottom: 20px;
}
.block-kp-key-points .kp-list li {
  font-size: 18px;
  font-weight: 600;
  color: #1D2129;
}
.block-kp-difficult-points {
  margin-bottom: 20px;
  padding: 14px 18px;
  background: #FFFBEB;
  border-radius: 6px;
  border-left: 3px solid #F59E0B;
}
.block-kp-mistakes {
  margin-bottom: 20px;
}
.block-kp-mnemonic {
  padding: 14px 18px;
  background: #F0FFF4;
  border-radius: 6px;
  border: 1px solid #BBF7D0;
  margin-bottom: 20px;
}
.kp-mnemonic-text {
  font-size: 17px;
  color: #047857;
  font-style: italic;
  line-height: 1.7;
}

/* === 分步作答过程 === */
.block-solution-steps {
  margin: 16px 0;
  padding: 20px 24px;
  background: #fff;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
}
.solution-title {
  font-size: 15px;
  font-weight: 700;
  color: #6366F1;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #E5E6EB;
}
.solution-step {
  display: flex;
  gap: 14px;
  margin-bottom: 12px;
  align-items: flex-start;
}
.solution-step:last-child { margin-bottom: 0; }
.solution-step-num {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #6366F1;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}
.solution-step-body {
  flex: 1;
}
.solution-step-text {
  font-size: 15px;
  line-height: 1.7;
  color: #1D2129;
}
.solution-step-formula {
  margin-top: 6px;
  padding: 8px 14px;
  background: #F9FAFB;
  border-radius: 4px;
  font-size: 16px;
  overflow-x: auto;
}

/* === 错因简析 === */
.block-error-cause {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  margin: 8px 0;
  background: #FFF5F5;
  border-radius: 4px;
  font-size: 14px;
  color: #DC2626;
}
.error-cause-tag {
  font-weight: 700;
  flex-shrink: 0;
}

/* === 题型相关 === */
.block-type-example {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  margin: 8px 0;
  background: #F9FAFB;
  border-radius: 6px;
  font-size: 15px;
  line-height: 1.7;
}
.type-example-label {
  font-weight: 700;
  color: #6366F1;
  flex-shrink: 0;
}
.block-type-tip {
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  margin: 8px 0;
  background: #F0FFF4;
  border-radius: 6px;
  font-size: 14px;
  color: #047857;
}
.type-tip-label {
  font-weight: 700;
  flex-shrink: 0;
}
</style>
