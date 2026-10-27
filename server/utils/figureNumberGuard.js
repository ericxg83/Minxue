/**
 * 图表数据引用核对（figureNumberGuard，2026-10-27 血压题 −20 误读成 −25 事故沉淀）
 *
 * 解决的问题：答案引擎看图解题时，会把图中数据抄错（−20 → −25），而解析里的算式
 * `+20-30-25+15+30=+10` **内部自洽**（验算闸拦不住），且图表数值只存在于图片里、
 * 题干文本没有任何数字可对照 ⇒ 参考答案带着误读数据落库，学生答对的被冤判错。
 *
 * 前置条件：chart_image 资产已完成逐字转录（utils/chartOcr.js → chart_ocr_text），
 * 本核对器拿「题干文本 + 图表转录文本」当**已知数据白名单**，去核对解析里
 * 「算式链左端」引用的数据项。
 *
 * ── 为什么只核对「算式链左端」────────────────────────────────────────────
 * 解析文本里的数字分三类：
 *   ① 数据引用：来自题干/图表的已知数（BP 例：+20、-30、-25…）→ 必须在白名单里；
 *   ② 计算结果：算出来的值（=右边的 +10、120+10=130 的 130、"答案为 130"）→ 白名单必然没有；
 *   ③ 公式常数：×2（周长）、÷100（换算）、3.14 等 → 白名单天然没有。
 * 只核对 ①，②③ 豁免，才不会把正确解析淹成一片假警报（软门禁，挂了也只标风险不拦批改）。
 *
 *   · ① 的识别：`数据 op 数据 op 数据 = 结果` 的算式链，等号**左侧**的每个数字都是数据引用；
 *   · ② 的豁免：等号右侧的数字、以及「是/为/等于/得/即」后面的结论数字，进入 resultsSoFar，
 *     在它们**之后**出现的算式链可以把这些结果当数据引用（两步应用题：3×20=60 → 60×3=180）；
 *   · ③ 的豁免：常见公式常数白名单（只对"不在已知数据里"的数字生效，不掩盖真实数据）。
 *
 * 已知取舍（宁可漏报不可误报，软门禁）：
 *   · 符号不敏感：|−20| 与 20 视为同一数据 —— 数字抄错能抓（BP 族），漏个负号抓不了；
 *   · 无算式链的叙述型引用（"表中第三周为 −25"）不核对 —— 结论数字可能是计算值，无法区分；
 *   · 白名单常数若同时也是真实数据，早就在白名单之外被 A0 覆盖，不受影响。
 */

/** 归一化：全角→半角、Unicode 减号→'-'、全角等号→'=' */
function normalizeText(s) {
  return String(s ?? '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[−–—―‐‑]/g, '-')
    .replace(/＝/g, '=')
}

/** 数值键：符号不敏感、尾零归一（15 与 15.0 同键） */
function numberKey(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return String(Math.round(Math.abs(n) * 1e6) / 1e6)
}

// 常见公式/换算常数（周长 ×2、百分数 ×100、π≈3.14、分钟换算 ×60、×24、年 ×12、周 ×7 等）。
// 只对"不在题干/图表数据里"的数字生效——真实数据走 A0，不受白名单影响。
const FORMULA_CONSTANT_KEYS = new Set(
  ['0', '1', '2', '3', '7', '10', '12', '24', '60', '100', '180', '360', '1000', '3600', '10000', '0.5', '3.14']
)

/** 从文本提取数据键集合 */
function collectAllowedNumbers(text, into) {
  const s = normalizeText(text)
  if (!s) return
  const re = /-?\d+(?:\.\d+)?/g
  let m
  while ((m = re.exec(s)) !== null) {
    const k = numberKey(m[0])
    if (k !== null && k !== '') into.add(k)
  }
}

/** 算式链：数字 (op 数字)+ 后跟等号与结果。捕获组 1 = 左端引用的数据项序列，组 2 = 等号右侧结果（可缺省）。 */
const CHAIN_RE = /(?:^|[^\d.\-])(-?\d+(?:\.\d+)?(?:\s*[()]*\s*[+\-×÷*/]\s*[()]*\s*-?\d+(?:\.\d+)?\s*[()]*)+)\s*[=＝≈]\s*\(?\s*[+\-]?\s*(\d+(?:\.\d+)?)?/g
/** 结论数字：是/为/等于/得/即 后面的数（视为计算结果，进入 resultsSoFar） */
const CONCLUSION_RE = /(?:是|为|等于|得|即)\s*\(?\s*[+\-]?\s*(\d+(?:\.\d+)?)/g
/** 变量赋值：x=5 / n=12 这类"解得"形态（结果进入 resultsSoFar；带下标 x₁= 不在此射程，fail-open） */
const ASSIGN_RE = /([A-Za-z][A-Za-z0-9_]*)\s*=\s*\(?\s*[+\-]?\s*(\d+(?:\.\d+)?)/g

/**
 * 核对解析中算式链引用的数据是否都存在于 题干/图表转录 里。
 *
 * @param {Object} p
 * @param {string} p.analysis 答案引擎产出的解析（含算式）
 * @param {string} [p.content] 题干文本
 * @param {string} [p.parentStem] 公共题干（多小问共享条件）
 * @param {string[]} [p.figureTexts] 图表资产的逐字转录文本（chart_ocr_text，可多条）
 * @returns {{ok: boolean, checked: number, missing: string[]}}
 *          ok=true 表示无需标注（含 fail-open：没有图表转录/没有可核对算式时一律 true）
 */
export function checkFigureNumberConsistency({ analysis, content, parentStem, figureTexts } = {}) {
  const figs = (Array.isArray(figureTexts) ? figureTexts : []).map((t) => String(t ?? '')).filter(Boolean)
  const analysisText = normalizeText(analysis)
  // fail-open：没有图表转录文本（护栏未就绪/转录失败）或解析为空 → 不核对
  if (figs.length === 0 || !analysisText.trim()) {
    return { ok: true, checked: 0, missing: [] }
  }

  const allowed = new Set()
  collectAllowedNumbers(content, allowed)
  collectAllowedNumbers(parentStem, allowed)
  for (const t of figs) collectAllowedNumbers(t, allowed)
  // 图表转录为纯叙述/没有可读数字时同样不核对（转录质量未知，宁可放行）
  if (allowed.size === 0) return { ok: true, checked: 0, missing: [] }

  // 合并三类事件并按出现位置排序，保证 resultsSoFar 的时序语义（左到右）
  const events = []
  for (const m of analysisText.matchAll(CHAIN_RE)) {
    events.push({ at: m.index + m[0].indexOf(m[1]), type: 'chain', lhs: m[1], rhsResult: m[2] || null })
  }
  for (const m of analysisText.matchAll(CONCLUSION_RE)) {
    events.push({ at: m.index, type: 'conclusion', value: m[1] })
  }
  for (const m of analysisText.matchAll(ASSIGN_RE)) {
    events.push({ at: m.index, type: 'conclusion', value: m[2] })
  }
  if (events.length === 0) return { ok: true, checked: 0, missing: [] }
  events.sort((a, b) => a.at - b.at)

  const resultsSoFar = new Set()
  const missing = new Set()
  let checked = 0
  for (const ev of events) {
    if (ev.type === 'conclusion') {
      const k = numberKey(ev.value)
      if (k) resultsSoFar.add(k)
      continue
    }
    // chain：抽出左端全部数字逐个核对。
    // ⚠️ 不能按"非数字字符"切分（'-' 是负号也是减号，"20-30-25" 会被粘成一个 token
    //    导致 Number() 得 NaN、整段漏检）——直接提取全部数字，符号交给 numberKey 取 abs。
    const tokens = ev.lhs.match(/-?\d+(?:\.\d+)?/g) || []
    for (const tok of tokens) {
      const k = numberKey(tok)
      if (k === null) continue
      checked++
      if (!allowed.has(k) && !resultsSoFar.has(k) && !FORMULA_CONSTANT_KEYS.has(k)) {
        missing.add(String(Math.abs(Number(tok))))
      }
    }
    if (ev.rhsResult) {
      const k = numberKey(ev.rhsResult)
      if (k) resultsSoFar.add(k)
    }
  }

  return { ok: missing.size === 0, checked, missing: [...missing].slice(0, 5) }
}
