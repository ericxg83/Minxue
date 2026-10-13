/**
 * handoutPdf.js — 试卷题库「讲义」版式（2026-10-10）
 *
 * 用途：把老师从试卷题库里勾选的题目（可跨多套卷）排成一份 A4 讲义 PDF，拿去讲题。
 *
 * ── 为什么必须另写一套版式，不能复用重练卷的 ──
 * pdfGenerator.js#buildPaperBody 走的是「错题重练卷」口径：它调用
 * buildRetryPaperOrder + RETRY_PAPER_BLOCKS（src/utils/retryPaperOrder.js:17-21）
 * 把题目**按选择题/填空题/解答题重新分块并重新编号**（卷面第 N 题 = 重排后的第 N 题）。
 * 这对重练卷是对的（卷子是新排的），但对讲义是错的 —— 老师讲的正是
 * 「第 19 题」「第 24 题」，题号一旦被重排，老师对着讲义找不到原卷那道题。
 * ⇒ 本模块**只按原卷题号渲染，绝不做任何分块/重编号**。
 *
 * 复用的部分（口径与全站一致，不另起一套）：
 *   · 数学式渲染 renderContent（mathText）
 *   · 选项标号归一化 normalizeOptions（optionText）
 *   · A4 版式基底 buildPaperCSS（pdfGenerator）
 *   · 难度星级 difficultyStars（retryPaperOrder，与错题卷/周末班讲义同口径）
 *   · KaTeX 内联字体 katexCss（否则 html2canvas / 服务端 Chromium 渲染根号会散架）
 */
import { renderContent } from './mathText'
import { normalizeOptions } from './optionText'
import { buildPaperCSS } from './pdfGenerator'
import { difficultyStars } from './retryPaperOrder'
import { KATEX_CSS_WITH_FONTS as katexCss } from './katexCssWithFonts'
// 按卷分组的口径单独成文件（纯函数、无浏览器依赖），便于回归锁直接跑。
// 此处 re-export，调用方（PaperBankWorkbench.vue）仍只认 handoutPdf。
export { groupHandoutQuestions } from './handoutGrouping'

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 讲义专属样式（叠在 buildPaperCSS 之上）。 */
export function buildHandoutCSS() {
  return `
.handout-group{margin-bottom:10px}
.group-head{font-size:14px;font-weight:bold;margin:10px 0 6px;padding:5px 0 5px 10px;
  border-left:4px solid #0F6E56;background:#E1F5EE;color:#085041}
.group-meta{font-size:11px;color:#666;font-weight:normal;margin-left:8px}
.q-tags{display:inline-flex;gap:4px;flex-shrink:0}
.q-tag{font-size:11px;color:#993C1D;background:#FAECE7;border:0.5px solid #F0997B;
  border-radius:4px;padding:0 4px;white-space:nowrap;line-height:16px}
.q-src{font-size:11px;color:#888;white-space:nowrap;flex-shrink:0}
.handout-empty{font-size:13px;color:#888;padding:20px 0;text-align:center}
.answer-note{font-size:11px;color:#993C1D;margin-top:2px;padding-left:32px}
`
}

/** 把扁平的题目行按卷分组（保持传入顺序；同卷的行会聚在一起）。 */

/** 单题 HTML。题号一律用**原卷题号**（question_no），绝不重编号。 */
function renderHandoutQuestion(q, showAnswers) {
  const typeClass = q.question_type === 'choice' ? 'q-choice'
    : q.question_type === 'fill' ? 'q-fill' : 'q-answer'
  // 原卷题号：question_no 是卷面印刷题号；有 sub_no 时写成「19(1)」
  const numLabel = q.question_no == null ? '?' : String(q.question_no)
  const dotLabel = q.sub_no ? `${numLabel}(${q.sub_no})` : `${numLabel}.`

  const stars = difficultyStars(q.difficulty)
  const tags = Array.isArray(q.tags) ? q.tags.filter(Boolean) : []
  const tagHtml = tags.length
    ? `<span class="q-tags">${tags.map(t => `<span class="q-tag">${escapeHtml(t)}</span>`).join('')}</span>`
    : ''

  let html = `<div class="question ${typeClass}">`
  if (q.parent_stem) {
    html += `<div class="q-stem">${renderContent(q.parent_stem)}</div>`
  }
  html += `<div class="q-head"><span class="q-num">${escapeHtml(dotLabel)}</span>`
  html += stars ? `<span class="q-diff">${stars}</span>` : ''
  html += tagHtml
  html += `<span class="q-text">${renderContent(q.content || '')}</span></div>`

  // 原题裁片（切段图）：默认不印在讲义上（题干文字已完整），
  // 但几何题的图必须能看见 —— 由调用方按需把 image_url 打开。
  if (q._showImage && q.image_url) {
    html += `<div class="q-image"><img src="${escapeHtml(q.image_url)}" alt="原题" /></div>`
  }

  const opts = normalizeOptions(q.options)
  if (opts.length) {
    const maxLen = Math.max(...opts.map(o => String(o || '').length))
    const cols = maxLen <= 8 ? 4 : maxLen <= 20 ? 2 : 1
    html += `<div class="opts opts-${cols}">`
    opts.forEach((opt, i) => {
      html += `<span class="opt">${String.fromCharCode(65 + i)}. ${renderContent(opt)}</span>`
    })
    html += `</div>`
  }
  if (q.question_type === 'fill') html += `<div class="fill-line"></div>`
  if (q.question_type === 'answer') {
    const lineCount = q._answerLines || 3
    html += `<div class="ans-area">`
    for (let r = 0; r < lineCount; r++) html += `<div class="ans-line"></div>`
    html += `</div>`
  }

  if (showAnswers) {
    if (q.answer) {
      html += `<div class="answer-key">参考答案：${renderContent(q.answer)}</div>`
      // 答案来源留痕：卷面印刷 vs 老师手填 vs 模型解出，必须让老师看得见
      if (q.answer_source && q.answer_source !== 'printed') {
        const label = q.answer_source === 'manual' ? '老师手填' : 'AI 解出'
        html += `<div class="answer-note">（此答案来源：${label}）</div>`
      }
    } else {
      html += `<div class="answer-key" style="color:#999">参考答案：本卷未录入</div>`
    }
  }

  html += `</div>`
  return html
}

/**
 * 讲义主体 HTML（.page 内容）。
 * @param {object} o
 * @param {string} o.title        讲义标题
 * @param {Array}  o.groups       groupHandoutQuestions 的产物
 * @param {boolean} o.showAnswers 是否带参考答案
 * @param {boolean} [o.showImage] 是否显示原题裁片图（几何题用）
 */
export function buildHandoutBody({ title, groups = [], showAnswers = false, showImage = false }) {
  const total = groups.reduce((n, g) => n + (g.questions?.length || 0), 0)
  const groupHtml = groups.map(g => {
    const meta = [g.grade, g.examDate ? String(g.examDate).slice(0, 10) : ''].filter(Boolean).join(' · ')
    const body = (g.questions || [])
      .map(q => renderHandoutQuestion(showImage ? { ...q, _showImage: true } : q, showAnswers))
      .join('')
    return `<div class="handout-group">
      <div class="group-head">${escapeHtml(g.paperName)}${meta ? `<span class="group-meta">${escapeHtml(meta)}</span>` : ''}</div>
      ${body}
    </div>`
  }).join('')

  return `<div class="page">
    <div class="head-area" style="min-height:auto;padding-right:0">
      <div class="title">${escapeHtml(title || '讲题讲义')}</div>
      <div class="sub-title">共 ${groups.length} 套卷 · ${total} 题${showAnswers ? ' · 含参考答案' : ''}</div>
      <div class="divider"></div>
    </div>
    ${total ? groupHtml : '<div class="handout-empty">没有勾选任何题目</div>'}
  </div>
  <div class="footer">敏学试卷题库 · 讲题讲义</div>`
}

/** 完整 HTML 文档（交给 /api/exam-pdf 渲染成 A4 PDF）。 */
export function buildHandoutHTML(opts) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${katexCss}\n${buildPaperCSS()}\n${buildHandoutCSS()}</style></head><body>${buildHandoutBody(opts)}</body></html>`
}
