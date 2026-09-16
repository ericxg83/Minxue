// 卷面印刷标题 → 任务名：剥掉校名页眉，只留能标识这份作业的部分。
//
// 事故背景（2026-09-17）：worker 会用 OCR 读到的 page_title 给任务改名，
// 而本校卷子顶部印的是校徽文字「新闵学校“成长·桥”练习」。它是页眉跑马灯，
// 不是作业身份 —— 改名后列表里 13 条任务全叫同一个名字，老师/学生分不清哪份是哪份。
//
// 口径（通用管线与 workbook 管线共用，禁止各自实现）：
//   1. 校名类机构词（学校/中学/小学/…）出现在标题开头时，连它带前面的校名一起切掉；
//   2. 紧跟其后的品牌短句（“成长·桥”）与通名（练习/作业/试卷/…）一并剥掉；
//   3. 剩下的还要够格：不含校名/品牌残留、不是纯通名、长度 ≥3。
//   4. 不够格 → 返回 null，调用方【不要改名】（保留客户端给的"科目作业 时间"）。

// 校名类机构词。命中即视为页眉开头，把它和前面的校名一起切掉。
const SCHOOL_TOKENS = ['学校', '中学', '小学', '书院', '教育集团', '学院']

// 品牌短句（校训/校本课程名）。OCR 会把 '·' 读成 '・' '.' 或漏掉。
const BRAND_RE = /成长\s*[·・.．]\s*桥|成长桥/

// 带引号的品牌短句："“成长·桥”" / "\"成长·桥\""，限 12 字内避免吃掉正文。
const QUOTED_BRAND_RE = /^[“"'"]([^”"']{0,12})[”"'][ \t]*/

// 卷种通名。只在【切过校名之后】才剥，避免把"课后练习 27.2(5)"这类正文标题削秃。
const GENRE_RE = /^(?:练习|作业|试卷|测试卷|学案|讲义|周末卷|堂堂清|习题|复习题|周练)[ \t]*/

// 剥完只剩这些，说明这条标题本身没有信息量
const GENERIC_ONLY_RE = /^\s*(?:练习|作业|试卷|测试卷|学案|讲义|周末卷|堂堂清|习题|复习题|周练)\s*$/

const MAX_LEN = 100
const MIN_LEN = 3
// 校名只可能在标题最前面；超过这个位置就当它是正文里的普通词，不动
const SCHOOL_TOKEN_MAX_POS = 10

/** 归一化：压缩空白（含全角空格）、去首尾空白 */
export function normalizeTitle(raw) {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * 清洗卷面标题，得到可用于任务命名的一部分。
 * @param {string} raw OCR 读到的 page_title
 * @returns {string|null} 可用标题；null = 这条是页眉/无信息量，调用方不应改名
 */
export function deriveTaskTitle(raw) {
  let rest = normalizeTitle(raw)
  if (!rest) return null

  // 1) 切掉开头的"校名"
  let cut = -1
  for (const token of SCHOOL_TOKENS) {
    const i = rest.indexOf(token)
    if (i >= 0 && i <= SCHOOL_TOKEN_MAX_POS) {
      const end = i + token.length
      if (cut < 0 || end < cut) cut = end
    }
  }

  if (cut >= 0) {
    rest = rest.slice(cut)
    // 2) 剥掉紧跟的品牌短句（“成长·桥”）与卷种通名（练习/作业/…）
    rest = rest.replace(QUOTED_BRAND_RE, '')
    rest = rest.replace(GENRE_RE, '')
  }

  // 3) 品牌短句兜底：没有校名但印着品牌（OCR 漏读校名时也走得到）
  rest = rest.replace(/[“"'"][ \t]*成长\s*[·・.．]\s*桥[ \t]*[”"'][ \t]*(?:练习|作业|试卷|学案|讲义)?/g, '')
  rest = normalizeTitle(rest)

  // 4) 成色检查
  if (!rest) return null
  if (BRAND_RE.test(rest)) return null
  if (SCHOOL_TOKENS.some((t) => rest.includes(t))) return null
  if (GENERIC_ONLY_RE.test(rest)) return null
  if (rest.length < MIN_LEN) return null

  return rest.slice(0, MAX_LEN)
}

/**
 * 这条标题是不是校名页眉（校徽文字 / 品牌短句）？
 * 用于存量清理：页眉且清洗后没内容时，需要回退成"科目作业 时间"而不是原样留着。
 */
export function looksLikeSchoolMasthead(raw) {
  const t = normalizeTitle(raw)
  if (!t) return false
  if (BRAND_RE.test(t)) return true
  return SCHOOL_TOKENS.some((token) => {
    const i = t.indexOf(token)
    return i >= 0 && i <= SCHOOL_TOKEN_MAX_POS
  })
}

/**
 * 是否"自动名"——只有这类名字才允许被卷面标题覆盖，
 * 用户在内页选过的练习册/答案库名必须原样保留。
 */
export function isAutoTaskName(name, { treatClientPaperNameAsAuto = false } = {}) {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) return true
  if (/作业\s+\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(n)) return true // 客户端拼的"数学作业 08/27 21:58"
  if (/\.(jpe?g|png|heic|heif|webp|bmp)(\s|$)/i.test(n)) return true // 相机文件名
  // 客户端拼的"科目 · 练习册名"：只有 workbook 管线把它当自动名
  // （选练习册是选批改模式，不代表作业身份）。通用管线历史上不认这条，保持原样。
  if (treatClientPaperNameAsAuto && /^.{1,20} · /.test(n)) return true
  return false
}
