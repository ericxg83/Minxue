<template>
  <div class="handout-preview">
    <!-- 顶部工具栏 -->
    <div class="handout-toolbar">
      <div class="toolbar-left">
        <el-button @click="goBack" :icon="ArrowLeft" text>返回</el-button>
        <span class="toolbar-title">{{ handout?.title || '讲义预览' }}</span>
        <el-tag v-if="handout?.templateLabel" size="small" type="info" effect="plain" class="template-tag">
          {{ handout.templateLabel }}
        </el-tag>
      </div>
      <div class="toolbar-right">
        <!-- 模板下拉（P3/P8） -->
        <el-select
          v-model="selectedTemplate"
          @change="handleTemplateChange"
          placeholder="选择模板"
          size="small"
          style="width: 160px;"
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
              <div class="cover-label">明学 · 教学讲义</div>
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
            <h2 class="page-title">{{ page.name }}</h2>

            <div v-for="(block, bIdx) in page.blocks" :key="bIdx" class="handout-block">
              <!-- 知识讲解 -->
              <div v-if="block.type === 'explanation'" class="block-explanation" :class="{ 'block-explanation-en': block.lang === 'en' }" v-html="renderMarkdown(block.content)"></div>

              <!-- 小标题（典型例题、变式练习等） -->
              <h3 v-else-if="block.type === 'section'" class="block-section">{{ block.content }}</h3>

              <!-- 题目 -->
              <div v-else-if="block.type === 'question'" class="block-question">
                <div class="question-content" v-html="renderMath(block.content)"></div>
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

              <!-- 变式题（含题型标签） -->
              <div v-else-if="block.type === 'variant'" class="block-variant">
                <div class="variant-badges">
                  <span class="variant-badge">变式</span>
                  <span v-if="block.questionType" class="variant-qtype">{{ englishTypeLabel(block.questionType) }}</span>
                </div>
                <div class="variant-content" v-html="renderMath(block.content)"></div>
                <div v-if="block.options?.length" class="question-options">
                  <div v-for="(opt, oIdx) in block.options" :key="oIdx" class="option-item">
                    {{ String.fromCharCode(65 + oIdx) }}. {{ opt }}
                  </div>
                </div>
                <div v-if="block.answer" class="variant-answer">
                  答案：{{ block.answer }}
                </div>
                <div v-if="block.analysis" class="variant-analysis">
                  解析：{{ block.analysis }}
                </div>
              </div>

              <!-- 普通文本（写作范文 / 学生原文 / 复习建议等） -->
              <div v-else-if="block.type === 'text'" class="block-text" v-html="renderMarkdown(block.content)"></div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Download, Printer } from '@element-plus/icons-vue'
import { apiRequest } from '../../services/apiService'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const exporting = ref(false)
const handout = ref(null)
const handoutContentRef = ref(null)

// 模板相关（P3/P8）
const availableTemplates = ref([])
const templatesLoading = ref(false)
const selectedTemplate = ref(null)
const currentSubject = ref('')

// 英语题型标签映射（与后端 englishAnalyzer.ENGLISH_QUESTION_TYPE_LABELS 保持一致）
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
  // 简单 Markdown 渲染：处理标题、粗体、列表、换行
  return text
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n/g, '<br>')
}

// 安全渲染 KaTeX（用 throwOnError:false，公式错误时回退到原文，避免一页报错全空白）
function katexHtml(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore' })
  } catch (e) {
    return `<code>${String(tex).replace(/</g, '&lt;')}</code>`
  }
}

function renderMath(text) {
  if (!text) return ''
  // 优先处理块级公式 $$...$$，再处理行内 $...$
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => katexHtml(tex, true))
  result = result.replace(/(^|[^$])\$([^$\n]+?)\$(?!\$)/g, (m, prefix, tex) => prefix + katexHtml(tex, false))
  return result
}

function goBack() {
  router.back()
}

async function handleExportWord() {
  if (!handout.value) return
  exporting.value = true
  try {
    // /handout/export-word 直接返回 docx 二进制流（Content-Disposition: attachment），
    // 这里用 fetch 拉原始 blob 再触发本地下载，避免 apiRequest 把二进制当 JSON 解析报错。
    const res = await fetch('/api/handout/export-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handout: handout.value,
        filename: (handout.value.title || '教学讲义') + '.docx',
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
    a.download = (handout.value.title || '教学讲义') + '.docx'
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

async function handleTemplateChange(newId) {
  // 切换模板时重新请求讲义数据
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
      ElMessage.success('已切换模板')
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

onMounted(async () => {
  try {
    currentSubject.value = String(route.query.subject || '')
    // 先按学科加载模板列表
    await loadTemplates(currentSubject.value)
    // 从路由参数获取讲义数据，或从诊断生成
    const handoutData = route.query.data
    if (handoutData) {
      try {
        const parsed = JSON.parse(decodeURIComponent(handoutData))
        handout.value = parsed
        // 已直接传 data 时，把 selectedTemplate 同步到讲义的 template
        if (parsed?.template) selectedTemplate.value = parsed.template
      } catch {
        // 解析失败，尝试从诊断生成
        await loadFromDiagnosis()
      }
    } else {
      await loadFromDiagnosis()
    }
    // 兜底：把 selectedTemplate 与讲义实际 template 对齐
    if (handout.value?.template) selectedTemplate.value = handout.value.template
  } catch (e) {
    console.error('加载讲义失败:', e)
    ElMessage.error('加载讲义失败')
  } finally {
    loading.value = false
  }
})

async function loadFromDiagnosis() {
  try {
    const subj = currentSubject.value
    const response = await apiRequest('/handout/from-diagnosis', {
      method: 'POST',
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

/* 模板下拉 */
.template-tag {
  margin-left: 8px;
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
}
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
.block-section {
  font-size: 17px;
  font-weight: 600;
  color: #1D2129;
  margin: 24px 0 12px;
  padding-left: 12px;
  border-left: 3px solid #6366F1;
}
.block-explanation {
  font-size: 14px;
  line-height: 1.8;
  color: #333;
  padding: 16px;
  background: #F7F8FA;
  border-radius: 8px;
}
/* 英语讲解：英文为主、稍宽留白 */
.block-explanation-en {
  font-family: 'Georgia', 'Times New Roman', serif;
  background: #F0F7FF;
  border-left: 3px solid #4F46E5;
  line-height: 1.9;
}
.block-question {
  padding: 12px 16px;
  background: #FAFBFC;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
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
.block-answer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: #FFF7E6;
  border-radius: 6px;
  font-size: 13px;
}
.answer-label { color: #FA8C16; }
.answer-value { color: #1D2129; }
.answer-correct {
  color: #52C41A;
  margin-left: auto;
}
.block-analysis {
  padding: 8px 12px;
  background: #FFF1F0;
  border-radius: 6px;
  font-size: 13px;
  color: #F5222D;
}
.analysis-label { font-weight: 600; }

/* 变式题 */
.block-variant {
  padding: 12px 16px;
  background: #EEF2FF;
  border: 1px solid #C7D2FE;
  border-radius: 8px;
  position: relative;
}
.variant-badges {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.variant-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #6366F1;
  color: #fff;
  font-size: 12px;
  border-radius: 4px;
}
/* 英语题型标签（完形/语法填空/翻译 等） */
.variant-qtype {
  display: inline-block;
  padding: 2px 8px;
  background: #ECFDF5;
  color: #047857;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid #A7F3D0;
}
.variant-answer {
  margin-top: 8px;
  font-size: 13px;
  color: #52C41A;
}
.variant-analysis {
  margin-top: 4px;
  font-size: 13px;
  color: #86909C;
}
.block-text {
  font-size: 14px;
  line-height: 1.6;
  color: #4E5969;
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
}
</style>