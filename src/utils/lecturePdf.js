/**
 * lecturePdf.js — 试卷题库「讲解版」版式（2026-11-01）
 *
 * 用途：把老师从题库勾进「试题篮」的题目排成**课堂讲解稿**——导入 iPad 笔记软件
 * （GoodNotes / Notability 类）边讲边写。负责人拍板（2026-11-01）：
 *   ① 页面横版 4:3（280×210mm）——PDF 页面尺寸 = iPad 笔记本页面尺寸，全屏书写零黑边；
 *   ② **一小问一页是唯一拆页粒度**（无切换开关）：每个篮子项（小问行）恰好一页，
 *      无小问的题自然一题一页；
 *   ③ 答案 + 解析要点印**页脚小字**——讲解时不用切出去查答案库；
 *   ④ 题面默认重排文字（大字号 KaTeX），「印原题图」开关切原题扫描图（几何含图题用）。
 *
 * ── 与另外三套版式的关系（四套方向各不相同，⛔ 不要互相套用）──
 *   ① 讲义 handoutPdf.js：A4 竖版密排版、按卷分组 —— 打印出来看的；
 *   ② 组卷 composePaperPdf.js：重新编号、按题型分大题 —— 那是一份新卷子；
 *   ③ 重练卷 pdfGenerator.js#buildPaperBody：卷面编号与判题编号逐字同构 ——
 *      题库题没有学生/作答，塞进去会把编号体系打乱；
 *   ④ 本文件（讲解版）：**保留原卷题号**（讲的是「第 19 题(2)」，同讲义口径）、
 *      每小问一页、横版 4:3、约 2/3 页高书写留白。竖版骨架排不进这个页面，自成一套。
 *
 * 复用（口径与全站一致）：renderContent（数学+表格）、renderContentInline（行内公式，
 * ⛔ 选项/答案必须行内渲染，整段公式会被 renderContent 判成独立公式散架）、
 * normalizeOptions / optionColumns（选项列数全站唯一口径）、escapeHtml 规则。
 * ⛔ 不 import buildPaperBody / buildRetryPaperOrder / RETRY_PAPER_BLOCKS。
 * ⛔ 打印版式保持纯净：灰底 / 纸张阴影 / 删除按钮一律不得出现在本文件（归预览舞台）。
 */
// 导入带 .js 扩展名（仓内先例 teacherPaperExtras.js）：本文件要保持「node --test 可直读」，
// 回归锁 paperBankLecture.test.mjs 直接 import 行为断言，无扩展名在 node ESM 下解析失败。
import { renderContent, renderContentInline } from './mathText.js'
import { normalizeOptions, optionColumns } from './optionText.js'

/**
 * 讲解版页面尺寸：横版 4:3（280mm × 210mm）。
 * mm 用于 CSS 与导出 pdfOptions；px 用于预览「适应宽度」缩放（96dpi 换算，A4=794px 同口径）。
 */
export const LECTURE_PAGE_MM = { width: '280mm', height: '210mm' }
export const LECTURE_PAGE_PX = {
  w: Math.round((280 * 96) / 25.4), // ≈ 1058
  h: Math.round((210 * 96) / 25.4), // ≈ 794
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 讲解版专属样式（叠在 buildPaperCSS 之上，由 renderCustomBodyToHTML 拼接）。 */
export function buildLectureCSS() {
  return `
body{margin:0;padding:0;background:#fff}
@page{size:280mm 210mm;margin:0}
.lec-page{width:280mm;height:210mm;box-sizing:border-box;position:relative;background:#fff;
  padding:9mm 12mm 6mm;display:flex;flex-direction:column;overflow:hidden;page-break-after:always}
.lec-page:last-child{page-break-after:auto}
.lec-head{display:flex;justify-content:space-between;align-items:center;gap:8mm;margin-bottom:4mm}
.lec-badge{font-size:14px;color:#0C447C;background:#E6F1FB;border-radius:4px;padding:3px 10px;
  max-width:72%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lec-pageno{font-size:12px;color:#999999;flex-shrink:0}
.lec-stem{background:#F1EFE8;border:0.5px solid #D3D1C7;border-radius:6px;padding:2.5mm 4mm;margin-bottom:3mm}
.lec-stem-label{font-size:11px;color:#888780;margin-bottom:1mm}
.lec-stem-text{font-size:14px;line-height:1.65;color:#444441}
.lec-q{font-size:19px;line-height:1.8;color:#1C1C1A}
.lec-q-no{font-weight:bold;margin-right:2mm}
.lec-opts{display:grid;gap:1.5mm 6mm;margin-top:3mm;font-size:16px;color:#1C1C1A}
.lec-img{margin-top:3mm}
.lec-img img{max-width:55%;max-height:58mm;display:block}
.lec-write{flex:1;min-height:20mm}
.lec-foot{border-top:1px solid #DDDACD;margin-top:3mm;padding-top:2.5mm;font-size:13px;line-height:1.7;color:#55544E}
.lec-ans{color:#2C2C2A}
.lec-ans-missing{color:#AAAAA5}
.lec-ans-note{color:#993C1D;margin-left:4px}
.lec-analysis{color:#8A887F;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lec-empty{font-size:14px;color:#888888;padding:24px 0;text-align:center}
`
}

/** 答案来源留痕（与讲义/组卷同口径：卷面印刷的不加注，其余必须说明）。 */
function answerSourceNote(source) {
  if (!source || source === 'printed') return ''
  const label = source === 'official' ? '官方答案' : source === 'manual' ? '老师手填' : source === 'ai' ? 'AI 解出' : ''
  return label ? `<span class="lec-ans-note">（${label}）</span>` : ''
}

/** 页脚：答案 + 来源留痕 + 解析要点（两行截断，讲解时扫一眼够用）。 */
function renderLectureFooter(it) {
  const parts = []
  if (it.answer) {
    parts.push(`<div class="lec-ans">答案：${renderContentInline(it.answer)}${answerSourceNote(it.answer_source)}</div>`)
  } else {
    parts.push('<div class="lec-ans lec-ans-missing">答案：未录入（去题库或答案库补）</div>')
  }
  if (it.analysis) {
    parts.push(`<div class="lec-analysis">解析：${renderContentInline(it.analysis)}</div>`)
  }
  return `<div class="lec-foot">${parts.join('')}</div>`
}

/** 单页（一个小问 / 一道无小问的题）。题号一律用**原卷题号**，绝不重编号。 */
function renderLecturePage(it, idx, total, { showImage = false } = {}) {
  const numLabel = it.question_no == null ? '' : String(it.question_no)
  const subLabel = it.sub_no ? `(${it.sub_no})` : ''
  const dotLabel = it.sub_no ? `${numLabel}${subLabel}` : (numLabel ? `${numLabel}.` : '')
  const badge = [it.resource_name || '题库题', numLabel ? `第 ${numLabel} 题${subLabel}` : '']
    .filter(Boolean).join(' · ')

  let html = `<section class="lec-page" data-qid="${escapeHtml(it.id || '')}">`
  html += `<div class="lec-head"><span class="lec-badge">${escapeHtml(badge)}</span>`
  html += `<span class="lec-pageno">${idx + 1} / ${total}</span></div>`

  if (it.parent_stem) {
    html += `<div class="lec-stem"><div class="lec-stem-label">公共题干</div>`
    html += `<div class="lec-stem-text">${renderContent(it.parent_stem)}</div></div>`
  }

  html += `<div class="lec-q">`
  html += dotLabel ? `<span class="lec-q-no">${escapeHtml(dotLabel)}</span>` : ''
  html += `<span class="lec-q-text">${renderContent(it.content || '')}</span></div>`

  if (showImage && it.image_url) {
    html += `<div class="lec-img"><img src="${escapeHtml(it.image_url)}" alt="原题图" /></div>`
  }

  const opts = normalizeOptions(it.options)
  if (opts.length) {
    const cols = optionColumns(it.options)
    html += `<div class="lec-opts" style="grid-template-columns:repeat(${cols},1fr)">`
    opts.forEach((opt, i) => {
      // ⛔ 选项必须行内渲染（renderContentInline）：整段公式用 renderContent 会
      // 变成居中独立公式块，A/B/C/D 悬空散架（组卷版式同一条教训）。
      html += `<span class="lec-opt">${String.fromCharCode(65 + i)}. ${renderContentInline(opt)}</span>`
    })
    html += '</div>'
  }

  // 书写区：撑满剩余页高（约 2/3 页），纯白无任何线条 —— 笔迹交给 iPad 笔记软件。
  html += '<div class="lec-write"></div>'
  html += renderLectureFooter(it)
  html += '</section>'
  return html
}

/**
 * 讲解版主体 HTML（body 内容，一段 .lec-page 序列）。
 * @param {object} o
 * @param {Array}  o.items      试题篮 items（createBasketItem 产物，一项 = 一页）
 * @param {boolean} [o.showImage] 是否印原题裁片图（几何含图题用）
 */
export function buildLectureBody({ items = [], showImage = false } = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) {
    return '<div class="lec-empty">试题篮是空的</div>'
  }
  const total = list.length
  return list.map((it, i) => renderLecturePage(it, i, total, { showImage })).join('')
}
