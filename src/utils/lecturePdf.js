/**
 * lecturePdf.js — 试卷题库「讲解版」版式（2026-11-01）
 *
 * 用途：把老师从题库勾进「试题篮」的题目排成**课堂讲解稿**——导入 iPad 笔记软件
 * （GoodNotes / Notability 类）边讲边写。负责人拍板（2026-11-01）：
 *   ① 页面横版 4:3（280×210mm）——PDF 页面尺寸 = iPad 笔记本页面尺寸，全屏书写零黑边；
 *   ② **一小问一页是唯一拆页粒度**（无切换开关）：每个篮子项（小问行）恰好一页，
 *      无小问的题自然一题一页；
 *   ③ 答案 + 解析要点印**页脚小字**——讲解时不用切出去查答案库；
 *   ④ 题面默认重排文字（大字号 KaTeX），「印原题图」开关切原题扫描图（几何含图题用）；
 *   ⑤ 题组内**每页都印公共题干**（2026-11-07 负责人定稿）——一小问一页，续页若只印
 *      「（2）」老师得翻回第一页才看得到已知条件。这与讲义 A4 密排「组头印一次」
 *      是有意不同，⛔ 别把讲义口径套回来。
 *
 * 版式参照（2026-11-02 负责人给的中西书局讲解稿样张）：无任何底纹底色（角标素字、
 * 题干素排无灰盒）、配图放题干下方靠左、一小题一页照旧。
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

/** 讲解版专属样式（叠在 buildPaperCSS 之上，由 renderCustomBodyToHTML 拼接）。
 *  版式参照（2026-11-02 负责人给的中西书局讲解稿样张）：无任何底纹底色、
 *  角标素字、题干素排、配图在题干下方靠左、其余留白。 */
export function buildLectureCSS() {
  return `
body{margin:0;padding:0;background:#fff}
@page{size:280mm 210mm;margin:0}
.lec-page{width:280mm;height:210mm;box-sizing:border-box;position:relative;background:#fff;
  padding:9mm 12mm 6mm;display:flex;flex-direction:column;overflow:hidden;page-break-after:always}
.lec-page:last-child{page-break-after:auto}
.lec-head{display:flex;justify-content:space-between;align-items:center;gap:8mm;margin-bottom:4mm}
.lec-badge{font-size:15px;font-weight:bold;color:#1C1C1A;
  max-width:72%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lec-pageno{font-size:12px;color:#999999;flex-shrink:0}
.lec-stem{margin-bottom:2mm}
.lec-stem-text{font-size:16px;line-height:1.85;color:#1C1C1A}
.lec-stem-no{font-weight:bold;margin-right:1mm}
.lec-q{font-size:19px;line-height:1.8;color:#1C1C1A;margin-bottom:1mm}
.lec-q-no{font-weight:bold;margin-right:2mm}
.lec-opts{display:grid;gap:1.5mm 6mm;margin-top:3mm;font-size:16px;color:#1C1C1A}
.lec-img{margin-top:2mm;margin-bottom:1mm;display:flex;justify-content:flex-start}
.lec-img img{display:block;max-width:50%;max-height:64mm;margin:0;align-self:flex-start}
.lec-write{flex:1;min-height:20mm}
.lec-foot{border-top:1px solid #E4E2DA;margin-top:3mm;padding-top:2.5mm;font-size:13px;line-height:1.7;color:#55544E}
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

/**
 * 单页（一个小问 / 一道无小问的题）。题号一律用**原卷题号**，绝不重编号。
 * @param {object} o
 *   - showImage {boolean} 是否印原题裁片图（几何含图题用）
 *   - groupCtx  {object|null} 题组上下文 { bigNum, stem, subSeq }；null = 独立页。
 *     题组每小问页都印「19. 公共题干」（题号写在题干前面），行内小问写「（1）」「（2）」。
 *     ⚠ 讲解版一页一小题 ⇒ 公共题干必须逐页重复，否则续页没有已知条件
 *     （2026-11-07 负责人定稿，推翻 11-04「只印一次」的口径）。
 *     ⛔ 拆页粒度不变：题组内每个小问仍各占一页（一小问一页是唯一模式）。
 *     角标是**原卷定位器**，恒用原卷小问号（「第 25 题(2-1)」），不随组内序号变。
 */
function renderLecturePage(it, idx, total, { showImage = false, groupCtx = null } = {}) {
  // 角标（原卷定位器）：原卷题号 + 原卷小问号，题组/独立页同一口径
  const numLabel = it.question_no == null ? '' : String(it.question_no)
  const subLabel = it.sub_no ? `(${it.sub_no})` : ''
  const badge = [it.resource_name || '题库题', numLabel ? `第 ${numLabel} 题${subLabel}` : '']
    .filter(Boolean).join(' · ')

  let html = `<section class="lec-page" data-qid="${escapeHtml(it.id || '')}">`
  html += `<div class="lec-head"><span class="lec-badge">${escapeHtml(badge)}</span>`
  html += `<span class="lec-pageno">${idx + 1} / ${total}</span></div>`

  if (groupCtx) {
    // 题组：一页一小题 ⇒ 每页自带公共题干（含题号），续页也不用翻回第一页看已知条件。
    // stem 取题组起点行的 parent_stem：续页行即使没存 parent_stem 也能带上公共条件。
    if (groupCtx.stem) {
      html += `<div class="lec-stem"><div class="lec-stem-text">`
      html += `<span class="lec-stem-no">${escapeHtml(groupCtx.bigNum)}.</span>${renderContent(groupCtx.stem)}</div></div>`
    }
    html += `<div class="lec-q">`
    html += `<span class="lec-q-no">（${groupCtx.subSeq}）</span>`
    html += `<span class="lec-q-text">${renderContent(it.content || '')}</span></div>`
  } else {
    if (it.parent_stem) {
      // 素排题干（2026-11-02 参照版式：去掉灰底盒与「公共题干」标签，题干就是正文）
      html += `<div class="lec-stem"><div class="lec-stem-text">${renderContent(it.parent_stem)}</div></div>`
    }
    const dotLabel = it.sub_no ? `${numLabel}${subLabel}` : (numLabel ? `${numLabel}.` : '')
    html += `<div class="lec-q">`
    html += dotLabel ? `<span class="lec-q-no">${escapeHtml(dotLabel)}</span>` : ''
    html += `<span class="lec-q-text">${renderContent(it.content || '')}</span></div>`
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

  // 配图放【题目内容之下】靠左（2026-11-02 负责人定稿：图在题目下）。
  // 矢量优先：vec_url 是几何重绘 SVG（paperFigureVector 产物），缺了回退原题裁片。
  if (showImage && (it.vec_url || it.image_url)) {
    const figSrc = escapeHtml(it.vec_url || it.image_url)
    html += `<div class="lec-img"><img src="${figSrc}" alt="原题图" data-fig-fallback="${escapeHtml(it.image_url || '')}" /></div>`
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
 *
 * ⚠️ 讲解版是「一小问一页」，顺序必须 = 原卷题号自然序，不能依赖篮子勾选顺序
 * （用户按任意顺序勾题、或搜索返回顺序变化，都会导致页面倒序/乱序，见 2026-11-03 事故：
 * 嘉定一模 25 题导出成 (2-2)→(2-1)→(1)）。这里强制按 (question_no, sub_no) 稳定排序。
 */
export function buildLectureBody({ items = [], showImage = false } = {}) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) {
    return '<div class="lec-empty">试题篮是空的</div>'
  }
  const sorted = [...list].sort(compareLectureItem)
  const grouped = groupLectureItems(sorted)
  const total = grouped.length
  return grouped.map((g, i) => renderLecturePage(g.it, i, total, { showImage, groupCtx: g.groupCtx })).join('')
}

/**
 * 把「同卷同题号、带公共题干」的连续行收成题组（2026-11-04 定稿，11-07 改题干口径）：
 *   每小问页都印「19. 公共题干」（题号写在题干前面），行内小问只写「（1）」「（2）」。
 *   ⛔ 讲解版一页一小题，公共题干逐页重复（2026-11-07 定稿），与讲义 A4 密排
 *   「组头只印一次」有意不同。独立行（无同号兄弟行，含英语语篇单勾一问）原样返回。
 * 收组判据与讲义 consolidateHandoutRows 同口径：**连续** + 同 (resource_id, question_no)
 * + 起点带 parent_stem —— 必须带 resource_id：讲解版排序不比卷，跨卷同号题会相邻，
 * 不比卷就会把两份卷的第 25 题错并成一个题组。
 * ⛔ 拆页粒度不变：题组内每个小问仍各占一页（一小问一页是唯一模式）。
 */
function groupLectureItems(list) {
  const out = []
  const n = list.length
  let i = 0
  while (i < n) {
    const it = list[i]
    const no = it?.question_no
    const rid = it?.resource_id
    // 题组起点：本题带 parent_stem，且下一行是同卷同题号（必然是同大题的小问）
    if (it?.parent_stem && no != null && rid != null) {
      let j = i + 1
      while (j < n && list[j]?.resource_id === rid && list[j]?.question_no === no) j++
      const size = j - i
      if (size > 1) {
        const stem = it.parent_stem
        for (let k = 0; k < size; k++) {
          out.push({
            it: list[i + k],
            groupCtx: { bigNum: String(no), stem, subSeq: k + 1 },
          })
        }
        i = j
        continue
      }
    }
    out.push({ it, groupCtx: null })
    i++
  }
  return out
}

/**
 * 讲解版排序比较器：先按题号升序，再按小问自然序（'1' < '2-1' < '2-2' < '10'）。
 * 空 sub_no（无小问的独立题）排在同题号小问之前。数值段按整数比，非数值段字典序，
 * 避免字符串排序把 '10' 排到 '2' 前面。
 */
function compareLectureItem(a, b) {
  const na = Number(a?.question_no ?? 0) || 0
  const nb = Number(b?.question_no ?? 0) || 0
  if (na !== nb) return na - nb
  return naturalSubCompare(a?.sub_no || '', b?.sub_no || '')
}

function naturalSubCompare(x, y) {
  if (x === y) return 0
  if (!x) return -1 // 空 sub_no 在前
  if (!y) return 1
  const ax = splitNumeric(x)
  const ay = splitNumeric(y)
  const len = Math.min(ax.length, ay.length)
  for (let i = 0; i < len; i++) {
    const dx = ax[i]
    const dy = ay[i]
    const nx = Number.isFinite(dx)
    const ny = Number.isFinite(dy)
    if (nx && ny) {
      if (dx !== dy) return dx - dy
    } else if (nx !== ny) {
      // 一段是数字、一段是文本：数字优先
      return nx ? -1 : 1
    } else {
      if (dx < dy) return -1
      if (dx > dy) return 1
    }
  }
  return ax.length - ay.length
}

/** 把 '2-1' 拆成 [2, '-', 1]：数字段为 Number，连接符/文本段为原串。 */
function splitNumeric(s) {
  const parts = String(s).split(/(\d+)/)
  return parts.filter(p => p !== '').map(p => (/^\d+$/.test(p) ? Number(p) : p))
}
