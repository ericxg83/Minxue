/**
 * pdfWitness.js — 用 PDF 文本层给 OCR 差异当「真值证人」（2026-11-16）
 *
 * 事故（七宝文来九上检测卷，负责人报障「为什么要我核对」）：
 *   源 PDF 是电子版、带完整文本层，真值就在文件里；但解析与零错字审计全程只喂渲染图，
 *   让模型逐字猜 ⇒ ① 双模型闸把**正确**的「当-3<x<0时，y>0」报成「应为 ≤」并写进待核对
 *   建议（老师照建议改就把对的改错）；② 审计把「△AB'C」（卷面 △ABC）这种真错放过。
 *
 * 口径：**有文本层就以文本层为准**，模型只在文本层无法裁决（both / neither）时兜底。
 *   扫描件拿不到文本层 ⇒ makePdfWitness 返回 null，全流程退回纯视觉，行为不变。
 *
 * ⛔ 同一件事只准一个实现：解析闸（paperBankService）与零错字审计
 *   （zeroTypoAuditService）都必须走本模块，禁止各写一套归一化。
 */

// 归一化只抹平**排版**差异（空白 / 全半角 / 引号 / 中英标点）；
// ⛔ 绝不抹平 `<` 与 `≤`、有撇与无撇、字母顺序 —— 那正是要判的东西。
const PUNCT_MAP = {
  '，': ',', '。': '.', '：': ':', '；': ';', '（': '(', '）': ')',
  '、': ',', '？': '?', '！': '!', '【': '[', '】': ']', '～': '~',
}

// 上下标：PDF 排版常把 x² 的「²」当普通字符 2 输出（实测七宝文来卷第 5 页
// 「y=ax²+2ax+c」在文本层里就是「y=ax2+2ax+c」）⇒ 不抹平的话上下文永远对不上，
// 短串差异（ax→x）就只能退回 both，白白丢掉最强证人。
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const SUB = '₀₁₂₃₄₅₆₇₈₉'

/**
 * 卷面上的「来源标签」：`（2026·上海嘉定·一模）`。
 * 这类标签**印在卷面上**，但入库时被清洗掉了 ⇒ 逐字比对必然把它当成「差异」。
 * 2026-11-09 嘉定卷就因此被自动改坏：dbPart「在线段AB」被替换成「2026·」、
 * 「PB」被替换成「一模」，q20 题干里插进了「（2026·上海嘉定·一模）」。
 * ⛔ 两侧都必须先剔除标签，别指望模型「看不见」它。
 */
const SOURCE_LABEL_RE = /[（(]?\s*(?:19|20)\d{2}\s*[·．.\-—]\s*[\u4e00-\u9fa5]{2,10}\s*[·．.\-—]\s*[\u4e00-\u9fa5]{1,6}\s*[）)]?/g

export function stripSourceLabels(s) {
  return String(s ?? '').replace(SOURCE_LABEL_RE, '')
}

/** 候选值本身就是来源标签（含被词元切碎的片段）⇒ 不是卷面正文，不许当差异。 */
export function isSourceLabelText(s) {
  const raw = String(s ?? '').replace(/\s+/g, '')
  if (!raw) return false
  const stripped = stripSourceLabels(raw).replace(/\s+/g, '')
  if (stripped !== raw) return stripped.length === 0 || stripped.length <= 1
  // 被 diffTokens 切碎的残片：'2026·' / '一模' / '海嘉定' 这类不可能独立出现在题面里的串
  if (/^(?:19|20)\d{2}[·．.\-—]?$/.test(raw)) return true
  if (/^[·．.\-—]?(?:一模|二模|三模|中考|高考|真题|模拟)$/.test(raw)) return true
  if (/^[\u4e00-\u9fa5]{1,5}$/.test(raw) && /(一模|二模|三模)/.test(raw)) return true
  return false
}

export function normalizeForPdfMatch(s) {
  return stripSourceLabels(s)
    .replace(/[\s\u00a0\u3000]+/g, '')
    .replace(/[′’‘＇`´]/g, "'")
    .replace(/[，。：；（）｡？、！【】～]/g, ch => PUNCT_MAP[ch] || ch)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(new RegExp(`[${SUP}]`, 'g'), ch => String(SUP.indexOf(ch)))
    .replace(new RegExp(`[${SUB}]`, 'g'), ch => String(SUB.indexOf(ch)))
    .replace(/[−–—]/g, '-')
}

/** 从整段文本里取差异点前后各 12 字，作为「定位到这一处」的上下文。 */
export function pickDiffContext(text, needle) {
  const s = String(text ?? '')
  const i = s.indexOf(String(needle ?? ''))
  if (i < 0) return null
  return {
    before: s.slice(Math.max(0, i - 12), i),
    after: s.slice(i + needle.length, i + needle.length + 12),
  }
}

/**
 * 文本层覆盖面判据 —— **唯一实现**。
 * 解析闸（paperBankService）、零错字审计（zeroTypoAuditService）、存量回填脚本都走这里，
 * ⛔ 不许各写一套阈值：一处判 full、一处判 partial，界面就会自相矛盾。
 *
 * @param {{chars?:number, dbChars?:number, pageCount?:number, witnessedPages?:number}} p
 *   chars         文本层剥掉来源标签后的正文字数
 *   dbChars       库里该卷题目正文字数（分母）
 *   pageCount     文本层总页数；witnessedPages 其中真正够格作证的页数
 * @returns {{mode:'full'|'partial'|'absent', chars?:number, dbChars?:number, pages?:string, note:string}}
 *   full    ⇒ 差异以文件里的字为准
 *   partial ⇒ 文本层只覆盖题号/标签、正文是图片（松江/嘉定一模）⇒ 仍是视觉 OCR 结果
 *   absent  ⇒ 扫描件
 */
export function describePdfTextLayer({ chars = 0, dbChars = 0, pageCount = 0, witnessedPages = 0 } = {}) {
  const c = Number(chars) || 0
  if (!c) return { mode: 'absent', note: '无文本层（扫描件），全程视觉 OCR' }
  const db = Number(dbChars) || 0
  const pagesTotal = Number(pageCount) || 0
  const pageOk = !pagesTotal || Number(witnessedPages) >= Math.max(1, pagesTotal - 1)
  const enough = (db > 0 ? c >= db * 0.6 : c >= 200) && pageOk
  const pages = pagesTotal ? { pages: `${witnessedPages}/${pagesTotal}` } : {}
  return enough
    ? { mode: 'full', chars: c, ...pages, note: '文本层覆盖题面，差异以文本层为准' }
    : {
      mode: 'partial', chars: c, ...(db ? { dbChars: db } : {}), ...pages,
      note: '文本层只覆盖少量标签（正文是图片），仍以视觉 OCR 为准',
    }
}

/**
 * 用一页 PDF 文本层造一个证人函数。
 * @param {string} pageText   该页文本层
 * @param {number} expectedChars 该页库内题目正文总字数（用于判断文本层是否只覆盖了标签）
 *   ⛔ 混合件（松江/嘉定一模：文本层只有题号与来源标签，正文是图片）必须返回 null。
 *      否则证人会拿标签去「证明」正文，把好文本改坏 —— 2026-11-09 嘉定卷事故。
 * @returns {null | (dbText:string, sugText:string, ctx?:{before:string,after:string}) => 'db'|'suggest'|'both'|'neither'}
 *   'db'      ⇒ 文本层只支持库里现值 ⇒ 差异是误报，应丢弃
 *   'suggest' ⇒ 文本层只支持候选值   ⇒ 可直接改字，不必再问模型
 *   'both'    ⇒ 两种写法卷面上都有 ⇒ 裁决不了（典型：ax vs x 这种子串差异），交模型
 *   'neither' ⇒ 都对不上（多为裁片跨行/公式被拆碎）⇒ 交模型或人工
 */
export function makePdfWitness(pageText, expectedChars = 0) {
  const flat = normalizeForPdfMatch(pageText)
  if (!flat) return null
  // 剥掉标签后只剩「一、选择题1.2.3.」这种页眉 ⇒ 不是正文页，不许作证。
  if (flat.length < 20) return null
  if (expectedChars > 0 && flat.length < expectedChars * 0.5) return null
  return function witness(dbText, sugText, ctx) {
    const db = normalizeForPdfMatch(dbText)
    const sug = normalizeForPdfMatch(sugText)
    if (!db || !sug) return 'neither'
    // 带上下文时优先做「定位到这一处」判断：短串差异（ax→x）全靠它区分。
    // 例：cur=「在抛物线 y=ax²+2ax+c」，before=「在抛物线 y=」after=「²+2ax+c」
    //     ⇒ flat 含「在抛物线y=ax²+2ax+c」而不含「在抛物线y=x²+2ax+c」⇒ 'db'
    if (ctx && (ctx.before != null || ctx.after != null)) {
      const b = normalizeForPdfMatch(ctx.before)
      const a = normalizeForPdfMatch(ctx.after)
      const dbCtx = flat.includes(b + db + a)
      const sugCtx = flat.includes(b + sug + a)
      if (dbCtx && !sugCtx) return 'db'
      if (!dbCtx && sugCtx) return 'suggest'
      // 上下文也对不上（被换行/公式切碎）⇒ 退回整串判断
    }
    const dbHit = flat.includes(db)
    const sugHit = flat.includes(sug)
    if (dbHit && !sugHit) return 'db'
    if (!dbHit && sugHit) return 'suggest'
    return dbHit ? 'both' : 'neither'
  }
}
