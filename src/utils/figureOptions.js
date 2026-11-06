/**
 * 「A/B/C/D 四个选项本身是图形」的题目口径 —— 唯一真值源。
 *
 * ── 事故背景（2026-11-05 负责人截图）──────────────────────────────
 * 卷面第 2 题「一次函数 y=ax+b 与二次函数 y=ax²+bx 在同一平面直角坐标系中的
 * 大致图象可能是（ ）」，A/B/C/D 四格各印一幅坐标系小图。整页 OCR 把它当成
 * 普通文字选择题：options 输出四个空串、配图只抠到其中一格，复核页呈现为
 * 「题干 + 一张图 + A. B. C. D. 四个空选项」——老师看不到另外三幅图，
 * 答案引擎也看不到任何一个选项，无法判定批改。
 *
 * 根因不是模型识别失败，而是**数据契约里从来没有「选项可以是图」这件事**：
 * 所有 OCR prompt 只把 options 定义成「印刷体选项正文 string[]」，
 * 配图（image_bbox）规则还明确要求「不要把选项文字框进去」。
 *
 * ── 修复口径（不改 DB schema、不动判题逻辑）──────────────────────
 * 命中图形选项题时：
 *  ① options 输出与每幅图一一对应的**可区分文字描述**（不是空串、不是占位符）；
 *  ② image_type = 'option_figures'（复用既有 VARCHAR(20) 列，不新增字段）；
 *  ③ image_bbox 框住**整条选项图**（四幅小图 + A/B/C/D 标号），
 *     使 geometry_image_url 成为一张含四个选项的图；
 * 下游因此自然闭环：options 非空 ⇒ 完整性闸不拦、题型不纠偏；
 * geometry_image_url 有图 ⇒ 答案引擎走既有「带配图视觉求解」链路看图给字母；
 * 复核页配图区能看到四幅图 ⇒ 老师能人工核对。
 *
 * 本模块放 `src/utils/`（不是 `server/utils/`）：服务端与 PC 工作台都要读同一份判据，
 * 与 questionBbox / mathText / geometryDisplay 的跨端复用惯例一致，
 * 避免前端完整性镜像与服务端各写一份而漂移。
 * 本模块同时导出四段 prompt 规则文本，供主 OCR / 练习册 OCR / 单题重识别 /
 * 跨页补选项 / 答案引擎共用，避免同一口径抄五份后漂移。
 *
 * @module src/utils/figureOptions
 */

/** image_type 的新枚举值（列已存在 VARCHAR(20)，无需迁移） */
export const FIGURE_OPTION_IMAGE_TYPE = 'option_figures'

/**
 * 单个选项文字是否像「图形选项描述」。
 * 兼容三种历史写法："选项A图" / "图A：…" / "[图形选项]…"。
 * 刻意不认 "图中…" 这类正常文字选项，避免误伤。
 */
const FIGURE_OPTION_TEXT_RE = /^(?:选项\s*[A-Ha-h]\s*图|图\s*[A-Ha-h]\s*[：:]|\[图形选项?\])/

export const isFigureOptionText = (value) =>
  FIGURE_OPTION_TEXT_RE.test(String(value == null ? '' : value).trim())

/** options 整组都是图形描述（≥2 项） */
export const hasFigureOptionDescriptions = (options) => {
  const list = Array.isArray(options) ? options : []
  return list.length >= 2 && list.every(isFigureOptionText)
}

/**
 * 这道题是不是「选项为图形」的题。
 * 主判据是落库的 image_type；文字描述兜底用于存量数据与其它链路
 * （例如老师手动补过「图A：…」但没带 image_type 标记）。
 */
export const isFigureOptionQuestion = (question) => {
  if (!question || typeof question !== 'object') return false
  if (String(question.image_type || '').trim().toLowerCase() === FIGURE_OPTION_IMAGE_TYPE) return true
  return hasFigureOptionDescriptions(question.options)
}

/**
 * 逐幅选项图（questions.option_images）的唯一形状守卫，前后端共用。
 *
 * 该列是 jsonb，但存量行可能是 NULL、默认 '[]'、被外部脚本写成 JSON 字符串、
 * 或混入空串/非 URL 的脏值。任何一处直接 `q.option_images.map(...)` 都会让
 * 整个复核页面板白屏，所以统一在这里收成「干净的字符串数组」。
 *
 * 只保留 http(s) URL（OSS 裁片），最多 8 幅（防止异常数据把版面撑爆），
 * 空结果 = 没有逐幅图，调用方退回整条横带 geometry_image_url，行为不变。
 */
export const normalizeOptionImages = (raw) => {
  let list = raw
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .map(u => (typeof u === 'string' ? u.trim() : ''))
    .filter(u => /^https?:\/\//i.test(u))
    .slice(0, 8)
}

/**
 * 「看似有选项、其实是占位」的退化图形选项。
 * 事故记录（server/scripts/backfill-choice-options.mjs:481）：模型面对四张作图选项
 * 会直接回 ["A","B","C","D"] 或 ["选项A图","选项B图",…]，前端渲染成
 * 「A. 选项A图…」像是有选项，实际四个图一个都没描述，比空数组更难发现。
 * 带区分特征的描述（「图A：开口向下」）不算占位。
 */
const PURE_PLACEHOLDER_RE = /^(?:选项\s*[A-Ha-h]\s*图|图\s*[A-Ha-h]\s*[：:]\s*|\[图形选项?\])\s*$/

export const isUndifferentiatedFigureOptions = (options) => {
  const list = Array.isArray(options) ? options : []
  return list.length >= 2 && list.every((o) => PURE_PLACEHOLDER_RE.test(String(o ?? '').trim()))
}

/** ① 整页 / 练习册 OCR：图形选项的完整采集规则 */
export const FIGURE_OPTION_OCR_RULES = `【图形选项专章：A/B/C/D 四个选项本身就是图】
识别形态：题干下面并排（或分两行）印着 4 幅小图（坐标系 / 函数图象 / 几何作图 / 统计图），
每幅图旁标着 A、B、C、D；题干常写「…大致图象可能是（ ）」「下列作图中正确的是（ ）」。
这类题的【选项就是图】，按普通文字选项处理会让四个选项全部丢失。命中本形态时：
1. options 必须按 A→B→C→D 顺序输出与每幅图一一对应的可区分文字描述，
   形如「图A：抛物线开口向下、直线斜率为正且过原点」；卷面有几个选项就输出几项。
   至少要点明开口方向 / 斜率正负 / 交点位置 / 相对位置这类能区分四幅图的特征。
   ⛔ 绝不允许：options 留空、只回抄 ["A","B","C","D"]、四项全是
   「选项A图 / 选项B图 / …」这种无区分度的占位（宁可写「图A：开口向下」也不要写「选项A图」）。
2. image_type 必须填 "option_figures"（不是 "geometry" / "chart" / "none"）。
3. image_bbox 必须框住【整条选项图】：四幅小图连同各自的 A/B/C/D 标号一起框进去，
   上沿到最上排图的顶端、下沿到最下排图或标号的底端、左右到最外侧两幅图的外缘；
   四幅图分两行排布时也要一次框住两行，绝不能只框其中一格。
   ⚠️ 这是「image_bbox 只框图形本身、不要把选项文字框进去」这条通用规则的唯一例外——
   本题的选项本身就是图，只框一格会让另外三个选项彻底消失，导致无法批改。
4. 其余字段按通用规则照填；content 仍然不得把选项文字 / 图形描述抄进题干。`

/** ② 单题重识别 / 跨页补选项：只有文字输出，没有配图字段 */
export const FIGURE_OPTION_TEXT_RULES = `【图形选项：A/B/C/D 四个选项本身就是图】
若图片里选项位置印的是 4 幅小图（坐标系 / 函数图象 / 几何作图）而不是文字，
options 必须按 A→B→C→D 顺序输出与每幅图一一对应的可区分文字描述，
形如「图A：抛物线开口向下、直线斜率为正」；至少要点明开口方向 / 斜率正负 / 交点位置。
⛔ 绝不允许：留空数组、只回抄 ["A","B","C","D"]、四项全是「选项A图」这类无区分度占位。
⚠️ 纯文字重识别补不出选项图本身：四幅选项图仍需老师在编辑页用「原卷裁剪」整条框成配图。`

/** ③ 答案引擎：没有选项图时不许猜字母 */
export const FIGURE_OPTION_ANSWER_RULE = `8. 【选项为图形的题】若「选项：」里出现「图A：」「图B：」这类描述，说明 A/B/C/D 四个选项本身是图。
   - 本轮若同时给了题目配图（四幅选项图），必须逐幅对照图形判定，answer 只返回正确图的字母。
   - 本轮【没有】配图可读时，answer 一律填 "待人工补充"，analysis 写明「选项为图形，需对照原卷选项图人工判定」；
     ⛔ 严禁凭题干文字猜一个字母 —— 猜出来的参考答案会把学生选对的题判成错。`
