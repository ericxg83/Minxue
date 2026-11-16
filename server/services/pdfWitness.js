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

export function normalizeForPdfMatch(s) {
  return String(s ?? '')
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
 * 用一页 PDF 文本层造一个证人函数。
 * @returns {null | (dbText:string, sugText:string, ctx?:{before:string,after:string}) => 'db'|'suggest'|'both'|'neither'}
 *   'db'      ⇒ 文本层只支持库里现值 ⇒ 差异是误报，应丢弃
 *   'suggest' ⇒ 文本层只支持候选值   ⇒ 可直接改字，不必再问模型
 *   'both'    ⇒ 两种写法卷面上都有 ⇒ 裁决不了（典型：ax vs x 这种子串差异），交模型
 *   'neither' ⇒ 都对不上（多为裁片跨行/公式被拆碎）⇒ 交模型或人工
 */
export function makePdfWitness(pageText) {
  const flat = normalizeForPdfMatch(pageText)
  if (!flat) return null
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
