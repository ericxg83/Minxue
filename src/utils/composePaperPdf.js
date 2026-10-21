/**
 * composePaperPdf.js — 试卷题库「组卷」版式（2026-10-21）
 *
 * 用途：把老师从题库勾进「试题篮」的题目排成**一份新卷子**（可打印发下去）。
 *
 * ── 与另外两套版式的关系（三套方向各不相同，⛔ 不要互相套用）──
 *   ① 讲义 handoutPdf.js：保留**原卷题号**、按卷分组 —— 老师讲的是「第 19 题」，
 *      题号一改就对不上原卷。
 *   ② 重练卷 pdfGenerator.js#buildPaperBody：按题型分块重编号，但要求
 *      task_id/page_number/question_number/sub_no 齐全，且卷面编号与**判题编号逐字同构**
 *      （worker 靠它把学生作答映射回题目）。题库题没有学生/作答，塞进去会把编号体系打乱。
 *   ③ 本文件（组卷）：**重新编号** 1..N、按题型分大题、每题标分值、卷头写姓名班级得分，
 *      卷末可选印参考答案。组出来的卷没有任何判题编号语义，所以必须自成一套。
 *
 * 复用（口径与全站一致）：buildPaperCSS 由 renderCustomBodyToHTML 注入、
 * renderContent（数学+表格）、normalizeOptions、escapeHtml 规则。
 * ⛔ 不 import buildPaperBody / buildRetryPaperOrder / RETRY_PAPER_BLOCKS。
 */
import { renderContent, renderContentInline } from './mathText'
import { normalizeOptions, optionColumns } from './optionText'
import { composePaperTotals } from './paperBasket'

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 组卷专属样式（叠在 buildPaperCSS 之上，由 renderCustomBodyToHTML 拼接）。 */
export function buildComposePaperCSS() {
  return `
.cz-sub{font-size:12px;color:#555;margin-bottom:2px}
.cz-total{font-size:12px;color:#333;margin-bottom:6px}
.cz-block-meta{font-size:12px;color:#444;font-weight:normal;margin-left:6px}
.q-score{font-size:11px;color:#8A8A8A;white-space:nowrap;flex-shrink:0}
.cz-answer-section{margin-top:18px;page-break-before:always}
/* 屏幕预览里没有「分页」这回事，答案区会紧贴最后一道题，加一条虚线分隔；
   ⛔ 只在 screen 生效 —— 打印时答案区本来就另起一页，顶上不该出现一条虚线。 */
@media screen{.cz-answer-section{margin-top:26px;padding-top:14px;border-top:1px dashed #cfcfcf}}
.cz-answer-head{font-size:16px;font-weight:bold;text-align:center;margin:6px 0 10px;letter-spacing:2px}
.cz-answer-block{font-size:12px;font-weight:bold;margin:8px 0 4px;color:#333}
.cz-answer-item{font-size:12px;line-height:1.8;margin-bottom:3px;padding-left:4px}
.cz-answer-item .no{font-weight:bold;margin-right:4px}
.cz-answer-item.is-missing{color:#999}
.cz-answer-note{font-size:11px;color:#993C1D;margin-left:4px}
.cz-empty{font-size:13px;color:#888;padding:24px 0;text-align:center}
`
}

/** 答案来源留痕（与讲义/重练卷同口径：卷面印刷的不加注，其余必须说明）。 */
function answerSourceNote(source) {
  if (!source || source === 'printed') return ''
  const label = source === 'official' ? '官方答案' : source === 'manual' ? '老师手填' : source === 'ai' ? 'AI 解出' : ''
  return label ? `<span class="cz-answer-note">（${label}）</span>` : ''
}

/** 单题（小问）HTML。题号用组卷后的新编号 sub_label。 */
function renderComposeQuestion(item, { showImage = false, answerLines = 3 } = {}) {
  const typeClass = item.question_type === 'choice' ? 'q-choice'
    : item.question_type === 'fill' ? 'q-fill' : 'q-answer'
  let html = `<div class="question ${typeClass}">`
  html += `<div class="q-head"><span class="q-num">${escapeHtml(item.sub_label)}.</span>`
  html += `<span class="q-text">${renderContent(item.content || '')}</span>`
  html += `<span class="q-score">${item.score} 分</span></div>`

  if (showImage && item.image_url) {
    html += `<div class="q-image"><img src="${escapeHtml(item.image_url)}" alt="原题" /></div>`
  }

  const opts = normalizeOptions(item.options)
  if (opts.length) {
    const cols = optionColumns(item.options)
    html += `<div class="opts opts-${cols}">`
    opts.forEach((opt, i) => {
      // ⛔ 选项必须行内渲染：整段都是公式时（`\frac{1}{3}\vec{a}`）renderContent 会把
      // 它判成独立公式，A/B/C/D 各自悬在一个居中大公式上方，卷面直接散架。
      html += `<span class="opt">${String.fromCharCode(65 + i)}. ${renderContentInline(opt)}</span>`
    })
    html += '</div>'
  }

  // 填空题：卷面原文里通常已经带了空线（`\underline{\quad}` / 连续下划线），
  // 再补一条 200px 横线会变成「上下两道空」，学生不知道写哪一行。
  // 只有原文里**没有任何空线标记**时才补，保证不会出现「无处可写」的填空题。
  const hasBlankMark = /_{2,}|\\underline|＿/.test(String(item.content || ''))
  if (item.question_type === 'fill' && !hasBlankMark) html += '<div class="fill-line"></div>'
  if (item.question_type === 'answer') {
    html += '<div class="ans-area">'
    for (let r = 0; r < answerLines; r++) html += '<div class="ans-line"></div>'
    html += '</div>'
  }
  html += '</div>'
  return html
}

/** 题组：公共题干只印一次，小问跟在下面。 */
function renderComposeGroup(group, opt) {
  if (group.items.length === 1 && !group.parent_stem) {
    return renderComposeQuestion(group.items[0], opt)
  }
  const stem = group.parent_stem
    ? `<div class="q-stem">${renderContent(group.parent_stem)}</div>`
    : ''
  return `<div class="question-group">${stem}${group.items.map(it => renderComposeQuestion(it, opt)).join('')}</div>`
}

/** 参考答案区（教师卷）。卷末单独起一页，打印时学生版不出现。 */
function renderAnswerSection(blocks) {
  const body = (blocks || []).map(b => {
    const items = []
    for (const g of b.groups) {
      for (const it of g.items) {
        const ans = it.answer
          ? `${renderContentInline(it.answer)}${answerSourceNote(it.answer_source)}`
          : '（本卷未录入）'
        items.push(
          `<div class="cz-answer-item${it.answer ? '' : ' is-missing'}">`
          + `<span class="no">${escapeHtml(it.sub_label)}.</span>${ans}</div>`
        )
      }
    }
    if (!items.length) return ''
    return `<div class="cz-answer-block">${escapeHtml(b.label)}</div>${items.join('')}`
  }).join('')
  return `<div class="cz-answer-section">
    <div class="cz-answer-head">参考答案</div>
    ${body || '<div class="cz-empty">没有题目</div>'}
  </div>`
}

/**
 * 组卷主体 HTML（.page 内容）。
 * @param {object} o
 * @param {string} o.title          卷名（如「周末练习（三）」）
 * @param {string} [o.subtitle]     副标题（科目·年级·日期）
 * @param {Array}  o.blocks         groupBasket 的产物
 * @param {boolean} [o.showAnswers] 是否印参考答案（教师卷）
 * @param {boolean} [o.showImage]   是否印原题裁片图（几何题用）
 * @param {number} [o.answerLines]  解答题答题行数
 */
export function buildComposePaperBody({
  title, subtitle = '', blocks = [], showAnswers = false, showImage = false, answerLines = 3,
} = {}) {
  const totals = composePaperTotals(blocks)
  const blockHtml = (blocks || []).map((b, i) => {
    const cn = ['一', '二', '三', '四', '五', '六'][i] || String(i + 1)
    return `<div class="section-header">${cn}、${escapeHtml(b.label)}`
      + `<span class="cz-block-meta">${b.count} 题 · ${b.score} 分</span></div>`
      + b.groups.map(g => renderComposeGroup(g, { showImage, answerLines })).join('')
  }).join('')

  return `<div class="page">
    <div class="head-area" style="padding-right:0">
      <div class="title">${escapeHtml(title || '组卷练习')}</div>
      ${subtitle ? `<div class="cz-sub">${escapeHtml(subtitle)}</div>` : ''}
      <div class="info">
        <span>姓名：<span class="blank"></span></span>
        <span>班级：<span class="blank"></span></span>
        <span>得分：<span class="blank"></span></span>
      </div>
      <div class="divider"></div>
      <div class="cz-total">共 ${totals.questionCount} 题 · 满分 ${totals.totalScore} 分</div>
    </div>
    ${totals.questionCount ? blockHtml : '<div class="cz-empty">试题篮是空的</div>'}
    ${showAnswers ? renderAnswerSection(blocks) : ''}
  </div>
  <div class="footer">敏学试卷题库 · 组卷</div>`
}
