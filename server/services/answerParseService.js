/**
 * 练习册答案文本解析服务
 * 从 worksheets.js 抽出，供路由解析与离线修复脚本共用。
 *
 * 核心能力：
 *  1. 练习单元检测（堂堂练① 19.1(1) 算术平方根 / 第X章 / 单元测试卷）
 *     —— 题号的真实作用域是「单元」，每个单元从 1 重新编号
 *  2. 行内多题拆分（OCR 常把 "13. D 14. C 15. C" 挤在一行，需按题号递增安全拆开）
 *  3. 子题拆分（"(1)7/2 (2)4/3 (3)0.9" 拆成 3 条 sub_no 记录）
 *  4. 题型识别：选择题（A-D）/ 判断题（√×）/ 一般答案
 */

// 检测章节标题行（如"第一章阶段卷Ⅰ""期中测试卷""第一单元综合练习"等）
export function isSectionHeader(line) {
  if (/^\d/.test(line)) return false // 数字开头的行是答案行
  // 第X章/节/单元/部分/篇
  //
  // ⚠️ 必须容忍「第」与数字之间、数字与「章」之间的**空白**（2026-09-16 八上上海作业事故）：
  //   答案册里「第19章测试(二)」的标题，OCR 常态输出为「第 19 章测试 (二)」。
  //   旧正则 `/^第[一二三四五六七八九十\d]+[章节单元部分篇]/` 不容忍空白 →
  //   整行认不出标题 → 该单元 1~25 题答案**继承上一个单元**（第19章测试(一)）并
  //   按题号 UPSERT 覆盖 → 老师那份「第19章测试(一)」卷子取到的全是测试(二) 的答案，
  //   全卷参考答案张冠李戴（陈昊煜/朱思诺/赵安迪三份卷实测）。
  //   归一化仍交给 normalizeSectionName（它会压掉所有空白），这里只负责"能匹配到"。
  if (/^第\s*[一二三四五六七八九十\d]+\s*[章节单元部分篇]/.test(line)) return true
  // 中文数字开头的章节/单元
  if (/^[一二三四五六七八九十]+\s*[章节单元]/.test(line)) return true
  // 节末《习题 X.Y》/ 章末《单元练习X》/ 校历《期中练习》《期末练习》
  // （2026-09-21《八上精练与拓展》44 页答案册事故）
  //
  // 该册的非课时单元共 16 处，旧关键词表一个都不认：
  //   10×《习题 19.1》…《习题 22.3》（含范围形态《习题 21.1-21.2》《习题 21.3—21.4》）
  //    4×《单元练习十九》…《单元练习二十二》
  //    2×《期中练习》《期末练习》
  //   旧表只有「单元测试/综合练习/单元卷/期中测试/期末测试」，没有「习题」「单元练习」
  //   「期中练习」——这 16 行标题被整行吞掉（还要被"续行归并"吸进上一条答案）→
  //   其下答案全部继承给上一个课时单元 → 同单元同题号 UPSERT 互相覆盖 ⇒
  //   课时单元（20.2(4)）的参考答案被后续《习题 20.2》《单元练习二十》逐题盖掉
  //   （实测第 1 题从 PDF 上的 B 变成库里《单元练习二十》的 D），
  //   老师批改时整卷参考答案张冠李戴；单元题号同时窜到 25/39/43（伪题号）。
  //
  // 锚定行首；「习题/单元练习」强制跟随编号（避免答案正文里的同名字样误触，
  // 数字开头的答案行另由本函数开头的 /^\d/ 早退挡掉）。
  if (/^(习题|单元练习|复习题)\s*[一二三四五六七八九十\d]/.test(line)) return true
  if (/^(期中练习|期末练习|总复习|单元复习|本章复习|全章复习)/.test(line)) return true
  // 常见试卷/练习关键词。
  // 之前漏掉『试卷』，导致『试卷① 19.1 平方根与立方根 基础性测试』整行被吞，
  // 下面所有答案错挂到上一个"第十九章实数"父单元，批改时『试卷① 19.1』卷完全错位。
  // 但『试卷/考卷』已由更靠前的 EXAM_HEADER_RE 单独精确处理（避免单『试卷』被误识别为
  // 孤儿单元），故这里关键词表不再列『试卷/考卷』。
  // 『期中测试|期末测试』：2026-09-15 八上上海作业实测，答案册书尾「期末测试(一)/(二)」
  // 不含"卷"字也不以"第X章"开头，被整卷漏识别 → 其答案全部错挂进前一个伪单元。
  if (/(?:阶段卷|评价测试|阶段练|综合练习|单元测试|测试卷|月考卷|期中卷|期末卷|期中测试|期末测试|模拟卷|真题卷|专题练习|专项练习|专项训练|复习卷|巩固卷|提升卷|拓展卷|检测卷|验收卷|达标卷|冲刺卷|押题卷|预测卷|闯关练习|水平测试|能力测试|单元卷|综合卷|练习卷|模拟测试|真题演练)/.test(line)) return true
  return false
}

/** 章节名归一化：去掉冒号后的说明、压掉内部空白、全角括号转半角
 *  （"第一章阶段练 3" 与 "第一章阶段练3" 统一；"第20章测试（一）" 与 "第20章测试(一)" 统一） */
export function normalizeSectionName(raw) {
  if (!raw) return null
  return String(raw)
    .replace(/[：:].*$/, '')
    .replace(/[\s　]+/g, '')
    // 全角括号 → 半角（2026-09-16 八上上海作业事故）：
    // OCR 对「第20章测试（一）」这类章级标题常输出全角括号，归一前会生成
    // 与半角形态**不同的 unit_key**，同一单元裂成两个 → 答案被劈成两半各存一部分，
    // 按题号取值时该单元一半题取不到。归一后两种写法落到同一单元。
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim() || null
}

// 圈序号 ①..㊿ → 1..50
// 范围扩到 50：本套教辅实践已遇到 36+ 的『堂堂练㊱』。
// 注释：之前的 ①..㉚(30) 在 31+ 时无法解析 ordinal，OCR 又容易把 ㊱ 错识别成『③③③』多字符，
// 导致 unit_key 错位。本扩展 + 解析时多字符归一化是修复根因。
const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿'
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

// 把 OCR 识别的『堂堂练』后圈序号串做归一化：
//   - 把连续多字符圈序号（如 ③③③）合并成单个高位圈序号（按对应 ordinal 选字符）
//   - 阿拉伯数字 (36) 透传
//   - 返回 { ordinal, circledToken } —— ordinal 1..50
// 没匹配到返回 null。
const CIRCLED_DIGITS_FOR_NORM = CIRCLED_DIGITS // 别名
function normalizeTanglianOrdinal(rawAfterLabel) {
  if (!rawAfterLabel) return null
  const s = String(rawAfterLabel).trim()
  if (!s) return null

  // 1) 纯阿拉伯数字：'36' → 36
  if (/^\d{1,3}$/.test(s)) {
    const n = parseInt(s, 10)
    if (n >= 1 && n <= 50) return { ordinal: n, circledToken: CIRCLED_DIGITS_FOR_NORM[n - 1] }
    return null
  }

  // 2) 单个有效圈序号：'㊱' → 36
  if (s.length === 1) {
    const idx = CIRCLED_DIGITS_FOR_NORM.indexOf(s)
    if (idx >= 0) return { ordinal: idx + 1, circledToken: s }
    return null
  }

  // 3) 多字符 OCR 错识别：『③③③』 / ③3 / ③③3 / 36㊱ ...
  // 拆出所有"圈序号字符"和"阿拉伯数字字符"，按出现顺序求和
  let total = 0
  for (const ch of s) {
    const idx = CIRCLED_DIGITS_FOR_NORM.indexOf(ch)
    if (idx >= 0) {
      total += idx + 1
      continue
    }
    if (/\d/.test(ch)) {
      total += parseInt(ch, 10)
      continue
    }
    return null // 含非数字字符，放弃
  }
  if (total >= 1 && total <= 50) {
    return { ordinal: total, circledToken: CIRCLED_DIGITS_FOR_NORM[total - 1] }
  }
  return null
}

function toOrdinal(token) {
  if (!token) return null
  const idx = CIRCLED_DIGITS.indexOf(token)
  if (idx >= 0) return idx + 1
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10)
  if (CN_NUM[token]) return CN_NUM[token]
  // 十一 ~ 十九 / 二十 / 二十一
  const m = token.match(/^([二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0)
  return null
}

// 单元标签：练习册里一个「重新从 1 编号」的最小单位。
// 注意：这里故意不包含『试卷/考卷』——它们由更靠前的 EXAM_HEADER_RE 单独处理，
// 否则『试卷 19.1 平方根...』会被贪婪吞掉 19 当 ordinal，导致『试卷19』错位。
const UNIT_LABEL_RE = new RegExp(
  `^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)\\s*([${CIRCLED_DIGITS}]|\\d{1,3}|[一二三四五六七八九十]{1,3})?\\s*(.*)$`
)
// 课时编号：19.1(1) / 21.2 —— 后面必须跟中文标题，否则可能是答案行
//
// ⚠️ 编号内部的空白与全角句点必须容忍（2026-09-15 事故，务必别再收紧）：
// OCR 把 "27.2(3)" 读成 "27. 2(3)" / "27 . 2(3)" / "27．2(3)" 是常态。
// 编号正则一旦要求"点后紧跟数字"，这类行就匹配不上 → 整行退化成"题号 27 的答案"，
// 于是整个 27.2(3) 单元被并进上一个单元 27.2(2)，两课时题号都从 1 开始 →
// 同号互相覆盖 → 连锚定本来正确的 27.2(2) 卷也被误判。
// 归一化交给 normLesson（它会压掉所有空白并把 ．→ .），这里只负责"能匹配到"。
const LESSON_CODE_RE = /(\d{1,2}\s*[.．]\s*\d{1,2}(?:\s*[（(]\s*\d{1,2}\s*[）)])?)/
const LESSON_LINE_RE = /^(\d{1,2}\s*[.．]\s*\d{1,2}(?:\s*[（(]\s*\d{1,2}\s*[）)])?)\s*[、.．]?\s*([一-龥][^\n]{0,40})$/

/**
 * 课时标题行的"答案尾巴"守卫（2026-09-15 八上上海作业 56 页解析实测沉淀）：
 * 「9. 2或12」「14. 0或1或√2」「6. 12厘米和4厘米」「9. 5元」这类**题号+含"或"/单位的答案行**
 * 恰好满足 LESSON_LINE_RE 的"编号 + 中文开头"形态，被误判成课时标题 → 建出 12 个伪单元
 * （unit_key 如 9.2/14.0），其后同单元的全部答案错挂进去，且顶替掉真正的单元标题。
 * 真课时标题的尾巴一定是中文章节名（≥2 连续汉字，如"算术平方根"）；
 * 答案尾巴的特征：以"或"开头（多解答案）/ 以计量单位开头 / 几乎没有汉字。
 * 命中即拒绝当标题，让该行落回普通答案行（其题号本来就该入库）。
 */
function looksLikeAnswerTail(tail) {
  const t = String(tail || '').trim()
  if (!t) return false
  if (/^或/.test(t)) return true // 「9. 2或12」「13. 4或√119/2」
  if (/^(厘米|千米|米|元|分|秒|千克|克|吨|升|毫升|°|％|%)/.test(t)) return true // 「6. 12厘米和4厘米」
  const hanzi = (t.match(/[\u4e00-\u9fa5]/g) || []).length
  if (hanzi < 2) return true // 「9. 5元」
  return false
}

/**
 * 「题号. 数字开头答案」被误读成课时编号的守卫
 * （2026-09-21《八上精练与拓展》事故，与上面 looksLikeAnswerTail 互补）。
 *
 * 实测污染行（PDF p40 / p25）：
 *   「18. 1与1（答案不唯一）」        —— 第 18 题的答案，被读成课时 `18.1`
 *   「22. 0. 提示：原方程可化为 …」   —— 第 22 题的答案，被读成课时 `22.0`
 * LESSON_CODE_RE 容忍"编号内夹空白"后把它们读成课时号；尾巴（「与1（答案不唯一）」
 * 「提示：…」）汉字都 ≥2，绕过 looksLikeAnswerTail → parseUnitHeader 造出伪单元
 * `18.1`（吞掉其后《期中练习》17~24 题与《期末练习》全卷）
 * 与 `22.0`（吞掉《单元练习二十一》第 22~25 题）。
 *
 * 判据：编号第二段**紧贴句点或并列连接词/比较运算符** ⇒ 这是"题号+答案"而非课时号
 *   （真课时号的三段形态是 `N.N(N)`，第二段后跟 `(` 或空格标题）。
 *   ✅ 挡住：「18. 1与1（答案不唯一）」「22. 0. 提示：…」「9. 2或12」「14. 0或1或√2」
 *   ✅ 不误伤：「21.1一元二次方程」（紧贴的是数词"一"）
 *               「24.2(1) 与圆有关的位置关系」（"与"在编号之后，有空格分隔）
 *               「19.1(1) 算术平方根」「27. 2(3) 形如…」「19.1 平方根与立方根」
 */
function looksLikeNumberAnswerHead(raw) {
  return /^\d{1,2}\s*[.．]\s*\d{1,2}\s*[.．与和及或、，；;+±=]/.test(String(raw || ''))
}
// 试卷标题：试卷① 19.1 平方根与立方根 基础性测试 / 试卷 19.2(1) / 试卷一 19.1 / 试卷1 / 试卷 ...
// 之前只识别『堂堂练/课课练...』，但『试卷① 19.1 平方根与立方根 基础性测试』是另一类合法单元，
// 漏识别会让本卷所有题目错挂到上一个『第十九章实数』父单元。
// 序号允许：圈数字 ①..⑳ / ASCII 数字 1..99 / 中文数字 一..十。
// 序号组用 (?:...) 非捕获 + 后面强制 \s+ 或 $ 间隔，避开『试卷 19.1』中
// lesson_code 第一段数字被误当 ordinal。
const EXAM_HEADER_RE = new RegExp(
  `^试卷\\s*(?:([${CIRCLED_DIGITS}]|\\d{1,3}|[一二三四五六七八九十]{1,3})(?:\\s+|$))?(.*)$`
)

// 课时编号归一化：压空白 + 全角括号→半角 + 全角句点→半角。导出供 route 层（预埋答案解析）复用。
export const normLesson = (raw) => (raw
  ? String(raw)
    .replace(/[\s　]+/g, '')
    .replace(/[（）]/g, c => (c === '（' ? '(' : ')'))
    .replace(/．/g, '.')
  : null)

/**
 * 识别练习单元标题行。
 * 必须在 isSectionHeader 之前调用——后者的 /^\d/ 早退会把 "19.1(1) 算术平方根" 当答案行吃掉。
 *
 * @returns {{unit_key, unit_title, lesson_code, ordinal}|null}
 */
export function parseUnitHeader(line) {
  const raw = String(line || '').trim()
  if (!raw || raw.length > 60) return null

  // ①' 试卷标题：试卷① 19.1 平方根与立方根 基础性测试 / 试卷 19.2(1) / 试卷一 19.1 ...
  //     必须在 UNIT_LABEL_RE 之前：避免『试卷 19.1』里的 19 被 \d{1,3} 贪婪吞掉当 ordinal。
  //     守卫：必须 em[1] 或 em[2] 至少有一个非空，防止『试卷』单独一行被误识别。
  const em = raw.match(EXAM_HEADER_RE)
  if (em && (em[1] || (em[2] && em[2].length >= 1))) {
    const ordinal = toOrdinal(em[1])
    const lessonMatch = (em[2] || '').match(LESSON_CODE_RE)
    const lesson = lessonMatch ? normLesson(lessonMatch[1]) : null
    const keyHead = ordinal ? `试卷${ordinal}` : '试卷'
    return {
      unit_key: lesson ? `${keyHead}|${lesson}` : keyHead,
      unit_title: normalizeSectionName(raw),
      lesson_code: lesson,
      ordinal,
    }
  }

  // ① 堂堂练① 19.1(1) 算术平方根
  const lm = raw.match(UNIT_LABEL_RE)
  if (lm) {
    const label = lm[1]
    const ordinal = toOrdinal(lm[2])
    const lesson = normLesson((lm[3] || '').match(LESSON_CODE_RE)?.[1])
    const keyHead = ordinal ? `${label}${ordinal}` : label
    return {
      unit_key: lesson ? `${keyHead}|${lesson}` : keyHead,
      unit_title: normalizeSectionName(raw),
      lesson_code: lesson,
      ordinal,
    }
  }

  // ①.b 兜底：OCR 把 ㊱ 错识别成『③③③』等多字符，UNIT_LABEL_RE 只匹配单字符会漏。
  // 用宽松 regex 抓"标签+任意非空白串"，再交给 normalizeTanglianOrdinal 求和归一化。
  const LOOSE_UNIT_LABEL_RE = /^(堂堂练|课课练|课时练|随堂练|同步练|课时作业|课后练)\s*(\S+)?\s*(.*)$/
  const llm = raw.match(LOOSE_UNIT_LABEL_RE)
  if (llm && llm[2]) {
    const norm = normalizeTanglianOrdinal(llm[2])
    if (norm) {
      const label = llm[1]
      const lesson = normLesson((llm[3] || '').match(LESSON_CODE_RE)?.[1])
      const keyHead = `${label}${norm.ordinal}`
      return {
        unit_key: lesson ? `${keyHead}|${lesson}` : keyHead,
        unit_title: normalizeSectionName(raw),
        lesson_code: lesson,
        ordinal: norm.ordinal,
      }
    }
  }

  // ② 纯课时编号行：19.1(1) 算术平方根
  const cm = raw.match(LESSON_LINE_RE)
  if (cm && !looksLikeAnswerTail(cm[2]) && !looksLikeNumberAnswerHead(raw)) {
    const lesson = normLesson(cm[1])
    return { unit_key: lesson, unit_title: normalizeSectionName(raw), lesson_code: lesson, ordinal: null }
  }

  // ③ 第N课时
  const km = raw.match(/^第\s*([一二三四五六七八九十\d]+)\s*课时/)
  if (km) {
    const ordinal = toOrdinal(km[1])
    const lesson = normLesson(raw.match(LESSON_CODE_RE)?.[1])
    const keyHead = `第${ordinal ?? km[1]}课时`
    return {
      unit_key: lesson ? `${keyHead}|${lesson}` : keyHead,
      unit_title: normalizeSectionName(raw),
      lesson_code: lesson,
      ordinal,
    }
  }

  // ④ 章级 / 试卷级标题（这类同样是独立编号域）
  if (isSectionHeader(raw)) {
    const title = normalizeSectionName(raw)
    return { unit_key: title, unit_title: title, lesson_code: null, ordinal: null }
  }

  return null
}

/**
 * 行内多题安全拆分。
 * 拆分点：分号（；;）或空白，且后面紧跟 "题号." / "题号．" / "题号、"。
 * 防误拆保护：
 *  - ASCII 点号后不能是数字，避免把小数 "3.5元"、"18.360" 拆断；答案可从
 *    任意非数字字符开始（如 "3.a>2"、"7.-1"、"10.解："），因为这类紧凑
 *    排版是本套答案 PDF 的实际格式。
 *  - 题号必须严格连续递增（no === prevNo + 1）。跳号一律视为「答案里的数字」而非题号
 *    —— 答案册题干逐题连印，同一行内不存在跳过某题的合法排版（2026-09-21 事故，见下方长注释）。
 */
export function splitInlineAnswers(line) {
  // 先找所有“分隔符 + 题号 + 标点”候选，再按题号连续性确认。
  // 本册存在“1.A 2.D 3.2 1”这种题号后紧跟数字答案的紧凑格式，
  // 因此不能简单禁止“题号.数字”；但“3.5m”这类小数又不能被拆开。
  const candidateRe = /(?:^|[；;\s])\(?([0-9]{1,3})\)?\s*(?:([．、.])|(?=[A-Da-d✓√✔✗✘×解证明计算]))/g
  const starts = []
  let prevNo = null
  let m
  while ((m = candidateRe.exec(line)) !== null) {
    const no = parseInt(m[1], 10)
    const tokenStart = m.index + m[0].lastIndexOf(m[1])
    const after = line.slice(candidateRe.lastIndex).replace(/^\s+/, '')
    // 无标点候选（靠 `(?=[A-Da-d✓√✔✗✘×解证明计算])` 前瞻命中，即「NN」后面直接跟答案）
    // 只允许出现在**行首或分号后**。原因：在空格后出现时，它必然是答案内部的数字，
    // 而前瞻字符集含 `√` 与它自己，会把系数/算式读成题号：
    //   2026-09-21《八上精练与拓展》实测（全册 55 处空格后无标点候选，逐条核对 0 处合法）：
    //     `4. 5√2/2`                     → "5" 是答案系数，拆出伪题号 5 → 真答案 "5√2/2" 丢失
    //                                       （旧规则因需要标点而漏了这条，靠续行归并掩盖）
    //     `3. B. 提示：… $\Delta = 3^2 4a+2b+c=0$ …`
    //                                    → "4" 是算式片段，拆出伪题号 4
    //     `11. (1) √49=7. (2) √(169/196)…`→ "(1)"/"(2)" 被判为候选 1/2
    //     `19. (1) 40√10`                → "(1)" 被判为候选 1
    // 行首/分号后的无标点候选是「续行子题标记」（如 `(2) 解法一: …`），保留不失真。
    const hasPunct = !!m[2]
    if (!hasPunct && !(m.index === 0 || /^[；;]/.test(m[0]))) continue
    // 答案册固定版式是「答案. 提示：解析」——「NN. 提示：…」里的 NN 是**答案**而非题号。
    // 2026-09-21《八上精练与拓展》实测（三处同形）：
    //   `13. (1) 43. 提示：$a,b$ 是方程 …` → 拆出伪题号 43，真答案 43 丢失
    //   `10. 39. 提示：连接CE，…`            → 拆出伪题号 39，题 10 答案被吞
    //   `13. (1) 42. 提示：∠ACD=…`           → 拆出伪题号 42
    //   `13. 15. 提示：$a^2+b^2+c^2-…$`      → 拆出伪题号 15（20.2(4) 第13题）
    // 题号之后永远跟答案内容，不可能直接跟解析引导词「提示」，故命中即拒。
    if (/^提示/.test(after)) continue
    // 行尾候选不是题号：题号后面必须跟答案内容，而「NN.」落在行尾说明它是**上一题的答案值**
    // （答案册版式「题号. 数字型答案」，数字可能恰为下一题号）。
    // 2026-09-21《八上精练与拓展》实测 4 处同形，每处都吞掉一整题：
    //   p25 `8. 9.`            → 真意：第 8 题答案是 9      → 旧行为拆出裸「8.」「9.」
    //   p22 `9. 10.`           → 真意：第 9 题答案是 10     → 同上
    //   p31 `… 8. 45. 9. 10.`  → 真意：第 9 题答案是 10     → 同上
    //   p3  `… 9. $\frac{1}{10}+\frac{1}{10^2}x$. 10. 11.`
    //                          → 真意：第 10 题答案是 11    → 同上
    // 拆出的裸「NN.」匹配不上题头正则，会被续行归并塞进上一题答案里，两题一起坏掉。
    if (!after) continue
    // 同一行内的题号必须**严格连续递增**（no === prevNo + 1）。
    //
    // 2026-09-21《八上精练与拓展》事故（本条是主因，破坏面最大）：旧规则只禁止
    // “`.` 后紧跟数字且跳号”，于是「题号. 数字型答案」里的答案数字被当成新题号：
    //   `5. 12 cm.`        → ["5.", "12 cm."]  → 裸「5.」匹配不上题头正则 → 按续行
    //                        归并进上一题答案（污染 q4），同时造出伪题号 12；真答案丢失
    //   `9. 30.`           → ["9.", "30."]
    //   `9. 23 或 32.`     → ["9. 23 或", "32."]
    //   `6. 13 和 15.` /
    //   `7. 25 或 36.`     → 同理拆出伪题号 15 / 36
    //   `6. 18√7.` /
    //   `8. 15√14.` /
    //   `4. 30.` /
    //   `9. 16.`           → 同理
    // 全册实测：旧规则接受的行内候选中「不连续」者共 19 处，**逐条核对全部是答案里的
    // 数字**（0 处合法），而合法紧凑格式（`1.A 2.D 3.2 1`、`13. D 14. C 15. C 16. B`、
    // `19. 2 因素；20. 1/10`）题号一律连续。
    // 故判据收敛为「必须连续」——答案册题号按书内顺序印刷，跨行才是常态，
    // 同一行内跳号只可能是把答案读成题号。
    if (prevNo !== null && no !== prevNo + 1) continue
    starts.push({ start: tokenStart, no })
    prevNo = no
  }
  if (starts.length === 0) return [String(line || '').trim()].filter(Boolean)

  const parts = []
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].start
    const end = i + 1 < starts.length ? starts[i + 1].start : line.length
    const part = line.slice(start, end).trim().replace(/[；;、,\s]+$/, '')
    if (part) parts.push(part)
  }
  return parts
}

/**
 * 子题拆分：把答案字符串拆成多空子题，支持 3 种 sub 标记格式：
 *   1) 圆括号 (1)(2)(3) / 全角括号 （1）（2）（3） —— 主流
 *   2) 圈数字 ①②③ —— 用户截图实例：答案页"21. ①√12/3 ②2√10"格式
 *   3) 阿拉伯数字 + 句号（不实现，会误伤"3.14"等小数）
 *
 * 数学答案里括号极多（"(x+1)(x-2)"），误拆代价高，故要求：
 * 必须从 (1) / ① 开始、开头位置靠前、序号严格 +1、每段非空且不超长。
 * 任一不满足则整体不拆（返回 null，由 caller 走整题合并路径）。
 *
 * 模式选择：圆括号优先，圈数字作 fallback（避免与圆括号混读出错）。
 */
export function splitSubAnswers(ans) {
  const text = String(ans || '').trim()
  if (!text) return null

  // 前缀放宽（2026-09-11 事故补丁）：印刷体答案常以「解：」「答：」「证明：」开头，
  // 此时 (1) 的 start 会 > 2，被下方 pickStrictSequence 的「首标记须在行首」
  // 限制拒绝 → 整题答案拆不出分段（实测 27.2(2) q=10 整题行因此漏拆，
  // 小题行错位防线也随之失效）。只要首标记前是 ≤6 字、不含数字与括号的短前缀，
  // 就视为合法行首（把 start 修正为 0 再校验）。buildSegments 只用 end 切文本，
  // start 修正不影响分段内容；其余严格条件（no=1、连续递增）保持不变。
  const relaxLeading = (marks) => {
    const first = marks[0]
    if (!first || first.start <= 2) return marks
    const prefix = text.slice(0, first.start)
    if (prefix.length <= 6 && !/\d/.test(prefix) && !/[（()）]/.test(prefix)) {
      return [{ ...first, start: 0 }, ...marks.slice(1)]
    }
    return marks
  }

  // 模式 1: 圆括号 / 全角括号
  const re1 = /[（(]\s*(\d{1,2})\s*[）)]/g
  const marks1 = []
  let m
  while ((m = re1.exec(text)) !== null) {
    marks1.push({ no: parseInt(m[1], 10), start: m.index, end: re1.lastIndex })
  }
  let picked = pickStrictSequence(relaxLeading(marks1))
  if (picked) return buildSegments(text, picked)

  // 模式 2: 圈数字 ①②③...⑳（fallback）
  //   用途：答案页"21. ① 过程 ② 过程"格式，AI 视觉模型常把子题号读成圈数字而非 (1)。
  //   圆括号没找到 ≥2 个 mark 时再尝试，避免与圆括号混读误拆。
  const re2 = new RegExp(`([${CIRCLED_DIGITS}])`, 'g')
  const marks2 = []
  while ((m = re2.exec(text)) !== null) {
    const ord = CIRCLED_DIGITS.indexOf(m[1]) + 1
    if (ord > 0) marks2.push({ no: ord, start: m.index, end: re2.lastIndex })
  }
  picked = pickStrictSequence(relaxLeading(marks2))
  if (picked) return buildSegments(text, picked)

  return null
}

// 子题标记提取：全角/半角圆括号 + 1-2 位数字，如 (1)、（2）
const OCR_SUB_MARKER_RE = /[（(]\s*(\d{1,2})\s*[)）]/g

/**
 * 答案库小题行一致性校验（P0.5，2026-09-11 产品评审定稿）。
 *
 * 背景（真实事故）：resource_answers 27.2(2) 单元里，q=10 sub='' 才是正确的整题
 * 答案，而 sub='1' 存的是另一道「抛物线 y=2(x-2)²」题的答案、sub='2'/'3' 存的是
 * 一道等边三角形题的答案。OCR 拆出 sub_no 后 lookupRow 优先精确命中这些小题行，
 * 反而**绕开正确的整题答案** → 参考答案张冠李戴。
 *
 * 规则：整题行答案能按 (1)(2) 拆出小问分段时，小题行答案必须与对应段一致
 * （归一化后相等或互相包含）；明显不一致返回 false（调用方应回退整题行）。
 * 无法校验的情况（整题行拆不出分段、缺对应段、缺答案文本）一律返回 true，
 * 维持现状 —— 本函数只防「已实证的错位形态」，不放大误伤面。
 */
export const isSubRowConsistentWithWhole = (subNo, subAnswer, wholeAnswer) => {
  const segs = splitSubAnswers(wholeAnswer)
  if (!segs || segs.length < 2) return true
  const seg = segs.find(s => String(s.sub_no) === String(subNo).trim())
  if (!seg) return true
  const norm = (s) => String(s || '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase()
  const na = norm(seg.answer)
  const nb = norm(subAnswer)
  if (!na || !nb) return true
  return na === nb || na.includes(nb) || nb.includes(na)
}

/**
 * 从文本中提取子题分段。
 * 只处理包含 ≥2 个连续子题标记的情况；否则返回 null。
 * 返回 [{ sub, text, stem }]：
 *   - text 已包含题干公共前缀（如“计算：”），保持历史行为不变；
 *   - stem 是第一个子题标号之前的公共题干原文（可能为空串），
 *     2026-09-11 新增，供调用方落 parent_stem 列（多小问题组共享题干）。
 */
function extractSubSegments(text) {
  if (!text) return null
  const markers = []
  let m
  while ((m = OCR_SUB_MARKER_RE.exec(text)) !== null) {
    markers.push({ sub: String(parseInt(m[1], 10)), start: m.index, end: OCR_SUB_MARKER_RE.lastIndex })
  }
  if (markers.length < 2) return null
  const stem = text.slice(0, markers[0].start).trim()
  return markers.map((mk, i) => {
    const seg = text.slice(mk.end, i + 1 < markers.length ? markers[i + 1].start : text.length).trim()
    return { sub: mk.sub, text: stem ? `${stem} ${seg}` : seg, stem }
  })
}

/**
 * 拆分 OCR 识别出的题目：把含多小问的大题拆成独立 question 对象。
 * 例如：q21 含 (1)(2) 两小问 → 两条记录，分别带 sub_no='1'、sub_no='2'。
 * 只在学生答案或题干中检测到 ≥2 个子题标记时才拆分，避免误拆普通括号。
 */
export function splitOcrQuestionsBySubNo(questions) {
  if (!Array.isArray(questions)) return questions
  const out = []
  for (const q of questions) {
    if (!q || q.question_number == null) {
      out.push(q)
      continue
    }
    // AI 已经输出 sub_no，直接保留
    if (q.sub_no != null && String(q.sub_no).trim() !== '') {
      out.push(q)
      continue
    }
    const contentSegs = extractSubSegments(String(q.content || ''))
    const answerSegs = extractSubSegments(String(q.student_answer || ''))
    // 以学生答案中的子题标记为主（能确定哪条答案对应哪小问）
    // 题干中也有标记时两边对齐；都没有则不拆
    if ((!answerSegs || answerSegs.length < 2) && (!contentSegs || contentSegs.length < 2)) {
      out.push(q)
      continue
    }
    const baseSegs = answerSegs && answerSegs.length >= 2 ? answerSegs : contentSegs
    for (const seg of baseSegs) {
      const newQ = { ...q, sub_no: seg.sub }
      const cSeg = contentSegs ? contentSegs.find(c => c.sub === seg.sub) : null
      const aSeg = answerSegs ? answerSegs.find(a => a.sub === seg.sub) : null
      if (cSeg) newQ.content = cSeg.text
      else if (contentSegs) newQ.content = `${q.content || ''} (${seg.sub})`.trim()
      if (aSeg) newQ.student_answer = aSeg.text
      // 否则保持原 student_answer（学生答案未分子问时整体保留）
      // 多小问共享题干（2026-09-11，迁移 057）：代码亲自拆题时，把「第一个子题标号
      // 之前的公共题干」落到 parent_stem，供展示层（错题本卡片 / 重练卷 PDF / 批改页）
      // 识别并归组。content 保持既有行为（cSeg.text 已含 stem），不改判题与答案引擎输入；
      // 展示层按「content 是否已包含 parent_stem」去重，不会重复渲染。
      if (cSeg && cSeg.stem && !newQ.parent_stem) newQ.parent_stem = cSeg.stem
      out.push(newQ)
    }
  }

  // 兜底：同一大题（同页同题号）的多条小问行之间互相同步 parent_stem。
  // 模型偶尔只在其中一条填了 parent_stem、其余留空；这些行本就同属一道大题，
  // 继承只是把已知的公共题干补齐，不会引入其他题的内容。
  // key 必须带页号：跨页相同题号（第1页第5题 / 第2页第5题）不是同一大题。
  // _page_number 由 worker.js 在调用本函数前写入；page_number 是 AI 直接输出的页码，
  // 两者任一存在都参与，防止上游漏写 _page_number 时跨页同号被误判成同组。
  const groupPageOf = (q) => q._page_number ?? q.page_number ?? ''
  const groupStem = new Map()
  for (const q of out) {
    if (!q || q.question_number == null) continue
    if (q.sub_no == null || String(q.sub_no).trim() === '') continue
    const stem = typeof q.parent_stem === 'string' ? q.parent_stem.trim() : ''
    const key = `${groupPageOf(q)}|${q.question_number}`
    if (stem && !groupStem.get(key)) groupStem.set(key, stem)
  }
  if (groupStem.size > 0) {
    for (const q of out) {
      if (!q || q.question_number == null) continue
      if (q.sub_no == null || String(q.sub_no).trim() === '') continue
      const cur = typeof q.parent_stem === 'string' ? q.parent_stem.trim() : ''
      if (cur) continue
      const stem = groupStem.get(`${groupPageOf(q)}|${q.question_number}`)
      if (stem) q.parent_stem = stem
    }
  }
  return out
}

/**
 * 跨页题缝合（2026-09-25）：原卷上一道题跨两页时（题干前半在上页末尾、
 * 后半在本页顶部），逐页独立 OCR 会把它切成两道独立题。本函数把模型标记为
 * continues_previous_page 的本页首题片段缝回上一页末题。
 *
 * 只信模型的显式标记（first.continues_previous_page === true），不做启发式自动合并：
 * 填空题题干合法地以横线结尾、解答题常无句号，任何"末题没句号就并"的启发式都会误合并。
 * 标记由 worker.js 在 OCR 时通过 buildCrossPageHint 注入上一页末题上下文后才可能产生，
 * 上一页 OCR 失败时提示不传、合并不执行，不会把本页新题错缝进更早的题。
 *
 * @returns {boolean} 是否发生了合并（pageQuestions[0] 已被移除并缝入 allQuestions 末题）
 */
export function mergeCrossPageContinuation(allQuestions, pageQuestions) {
  if (!Array.isArray(allQuestions) || allQuestions.length === 0) return false
  if (!Array.isArray(pageQuestions) || pageQuestions.length === 0) return false
  const first = pageQuestions[0]
  if (!first || typeof first !== 'object' || first.continues_previous_page !== true) return false
  const prev = allQuestions[allQuestions.length - 1]
  if (!prev || typeof prev !== 'object') return false

  const tail = String(first.content || '').trim()
  const prevContent = String(prev.content || '').replace(/\s+$/, '')
  prev.content = tail ? prevContent + tail : prevContent

  // 页面后半段才出现的手写答案/选项/配图回填给合并后的题（前半段页面上没有时才补）
  if (!prev.student_answer && first.student_answer) prev.student_answer = first.student_answer
  if ((!Array.isArray(prev.options) || prev.options.length === 0) && Array.isArray(first.options) && first.options.length > 0) {
    prev.options = first.options
  }
  if (!prev.answer && first.answer) prev.answer = first.answer
  if (!prev.question_type && first.question_type) prev.question_type = first.question_type
  if (!prev.parent_stem && first.parent_stem) prev.parent_stem = first.parent_stem
  if (first.has_figure && !prev.has_figure) {
    prev.has_figure = true
    prev.image_type = first.image_type
    prev.image_bbox = first.image_bbox
  }
  if (typeof prev.confidence === 'number' && typeof first.confidence === 'number') {
    prev.confidence = Math.min(prev.confidence, first.confidence)
  }
  // block_coordinates 保留上一页末题的框（题从上一页开始）；本页承接段暂时没有
  // 跨页多框的存储口径，靠日志留下线索供人工修订。
  delete prev.continues_previous_page
  prev._cross_page_merged = true
  pageQuestions.splice(0, 1)
  return true
}

/**
 * 构造逐页 OCR 的跨页衔接提示（拼进 userText，不改动静态 system prompt）。
 * 上一页末题的题号 + 题干结尾是模型判断"本页顶部是不是上一题的延续"的唯一依据。
 * @returns {string} 无上一页末题时返回空串（调用方直接用原 userText）。
 */
export function buildCrossPageHint(prevQuestion, prevPageNo) {
  if (!prevQuestion || typeof prevQuestion !== 'object') return ''
  const tail = String(prevQuestion.content || '').trim().slice(-80)
  if (!tail) return ''
  const subNo = prevQuestion.sub_no != null && String(prevQuestion.sub_no).trim() !== ''
    ? ` 小问(${prevQuestion.sub_no})` : ''
  return `\n\n【跨页衔接检查】上一页（第${prevPageNo || '?'}页）最后一题是第${prevQuestion.question_number}题${subNo}，题干结尾为："……${tail}"。` +
    `请检查本页最上方的印刷内容：若它是上述题目的直接延续（句子未完结、没有新的题号开头），` +
    `请在输出的第一个题目对象上加 "continues_previous_page": true，question_number/sub_no 沿用上一页该题的题号，` +
    `content 只写本页承接的续文（不要重复上一页已识别的文字），学生写在续文下方的手写答案照常填入 student_answer。` +
    `若本页顶部是带自己题号的独立新题，绝不要加该标记。`
}

/**
 * 严格子题序列选择：
 *   - 至少 2 个 mark
 *   - 第一个 mark 必须是 1
 *   - 第一个 mark 开头位置 ≤ 2（避免误把答案中间的数字当 sub 起点）
 *   - 后续 mark 严格 +1 递增
 * 满足则返回按顺序的 mark 数组，否则 null。
 */
function pickStrictSequence(marks) {
  if (!marks || marks.length < 2) return null
  if (marks[0].no !== 1) return null
  if (marks[0].start > 2) return null
  const picked = [marks[0]]
  for (const k of marks) {
    if (k.no === picked[picked.length - 1].no + 1) picked.push(k)
  }
  return picked.length >= 2 ? picked : null
}

function buildSegments(text, picked) {
  const segs = picked.map((k, i) => ({
    sub_no: String(k.no),
    answer: text.slice(k.end, i + 1 < picked.length ? picked[i + 1].start : text.length).trim(),
  }))
  // 2026-09-10：长解答题（如 27.1 的 q4/q9/q10）的 (1)(2)(3) 段可合法超过 80 字，
  // 该限制原本只用于防误拆。防误拆已由 pickStrictSequence 的「首标记须为 1 且位于行首」严格把关，
  // 此处把单段上限提到 2000，避免把「续行归并后」的长答案块重新判成不可拆。
  if (segs.some(s => !s.answer || s.answer.length > 2000)) return null
  return segs
}

const JUDGE_SYMBOL_RE = /^[✓√✔✗✘×]$/

// 大题组标题："一、填空题" "二、选择题（每题3分）"
// 必须识别：同一个单元内，填空题/选择题/解答题各自从 1 重新编号，
// 实测答案 PDF p2 的「1. 13」（填空）与「1. C」（选择）就是这样撞成同一个 key，
// 去重时高置信度的选择题答案覆盖了填空题答案。故大题组要作为单元下的第二级定位。
const GROUP_HEADER_RE = /^([一二三四五六七八九十]{1,3})\s*[、.．]\s*(.{0,20})$/
const GROUP_TYPE_RE = /(填空|选择|判断|解答|计算|应用|证明|作图|简答|综合|探究|阅读|操作|实验)/

/** 识别大题组标题行，返回归一化后的组名；不是则返回 null */
export function parseGroupHeader(line) {
  const raw = String(line || '').trim()
  if (!raw || raw.length > 24) return null
  const m = raw.match(GROUP_HEADER_RE)
  if (!m) return null
  // 必须含题型词，否则「一、13」这类答案行会被误当标题吃掉
  if (!GROUP_TYPE_RE.test(m[2])) return null
  return normalizeSectionName(raw)
}

/** 把 initialUnit（旧调用传字符串/单元对象）或 {unit, group} 状态统一成状态对象 */
function toState(input) {
  if (!input) return { unit: null, group: null }
  if (typeof input === 'string') {
    const title = normalizeSectionName(input)
    return { unit: title ? { unit_key: title, unit_title: title, lesson_code: null, ordinal: null } : null, group: null }
  }
  if (input.unit !== undefined || input.group !== undefined) {
    return {
      unit: input.unit || null,
      group: input.group || null,
      // 透传 pageRanges：跨批解析（doParseOcrBatched / resume-worksheet-parse）靠它
      // 跨批延续"单元→页范围"。2026-09-15 发现被这里丢弃 → 单元页范围三轮全 null。
      pageRanges: input.pageRanges,
    }
  }
  return { unit: input, group: null }
}

/**
 * 解析答案文本。
 * @param {string} text - OCR 或 PDF 提取出的答案文本
 * @param {Array} lowConfidence - 低置信度条目收集器（原地 push）
 * @param {string|object|null} initialState - 起始状态 {unit, group, pageRanges}（多页按顺序解析时接续上一页）
 *                                         pageRanges: Map<unit_key, { start, end }>，由本页号 1-based 持续更新
 * @param {number} [pageNumber] - 本页在 PDF 中的页号（1-based，可选）。提供后用于
 *                                记录每个单元的起止页范围，落库到 resource_units.answer_page_start/end。
 * @returns {{ answers: Array, lastState: object, lastUnit: object|null, lastSection: string|null }}
 */
export function parseAnswerText(text, lowConfidence = [], initialState = null, pageNumber) {
  const results = []
  const lines = String(text || '').split('\n')
  const state = toState(initialState)
  let currentUnit = state.unit
  let currentGroup = state.group
  // 单元→页范围 记录器：跨页累计，每遇到一个新单元标题，关闭上一个单元的 end 并开启新单元的 start
  // 共享 state 以便跨函数调用延续（同 processOcrBatch 的 lastState 透传模式）
  const pageRanges = state.pageRanges || new Map()
  const pageNoNum = pageNumber != null && Number.isFinite(Number(pageNumber)) ? Number(pageNumber) : null
  // 关闭"上一页遗留的未关闭单元"：该单元到本页前为止
  if (pageNoNum != null && currentUnit && currentUnit.unit_key) {
    const r = pageRanges.get(currentUnit.unit_key)
    if (r && r.end == null) r.end = pageNoNum - 1
  }

  const processedLines = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 单元标题检测（含章级标题，必须先于答案行判断）
    const unit = parseUnitHeader(trimmed)
    if (unit) {
      // 切换单元：上一个单元的 end = 本页号 - 1；若上一页就出过同一 unit_key 题目，
      // 则 pageRanges 中已有 start，本次只更新 end（不重置 start）。
      if (pageNoNum != null && unit.unit_key) {
        const r = pageRanges.get(unit.unit_key)
        if (r) {
          if (r.end == null || pageNoNum - 1 > r.end) r.end = pageNoNum - 1
        } else {
          pageRanges.set(unit.unit_key, { start: pageNoNum, end: null })
        }
      }
      currentUnit = unit
      currentGroup = null // 换单元 → 大题组重新开始
      continue // 标题行不加入答案解析
    }

    // 大题组标题检测
    const group = parseGroupHeader(trimmed)
    if (group) {
      currentGroup = group
      continue
    }

    // 行内多题拆分（如 "19. 2 因素；20. 1/10" 或 "13. D 14. C 15. C 16. B"）
    //
    // 例外：以**子题标记开头**的行（`(2) …` / `（2）…`）是上一题的子答案续行，
    // 不能在其内容里再扫题号——子答案常以数字+顿号开头，会被读成题号。
    // 2026-09-21《八上精练与拓展》实测（p41，破坏面整个单元）：
    //   第 25 题的四个小问跨行排版：`25. (1) 2 : 5` / `(2) 1、2、3` / `(3) 3` / `(4) 255 提示：…`
    //   `(2) 1、2、3` 里的 "1、" 被拆成题号 1 → 造出伪题 1（答案 "2、3"），
    //   同时把 25 题的 (3)(4) 也吞进去；更糟的是它触发「同单元题号重置到 1」告警，
    //   把整本册子的最后一次告警留了下来。
    // 这类行交回续行归并后，`splitSubAnswers`（归并后再跑）会正确拆出 (1)~(4)。
    const isSubContinuation = /^[（(]\s*\d{1,2}\s*[）)]/.test(trimmed)
    for (const part of (isSubContinuation ? [trimmed] : splitInlineAnswers(trimmed))) {
      processedLines.push({ line: part, unit: currentUnit, group: currentGroup })
    }
  }

  // 本页结束：把 currentUnit 的 end 临时记为本页（最后一页可能 end 仍为 null，
  // 由调用方在整批跑完后做一次"end = totalPages"收尾；这里只覆盖"非末页"的场景）
  if (pageNoNum != null && currentUnit && currentUnit.unit_key) {
    const r = pageRanges.get(currentUnit.unit_key)
    if (r) {
      if (r.end == null) r.end = pageNoNum
    } else {
      // 跨批/批首可能：从未识别到单元标题但 OCR 出题目了；用 pageNoNum 兜底建一个无 key 的范围
      // （不会被落库，仅日志提示）
    }
  }

  // section 存大题组名（单元名存在 resource_units 表，不再挤占 section 列）；
  // 唯一约束含 section，故填空题第1题与选择题第1题不会再互相覆盖。
  const push = (unit, group, row) => {
    results.push({
      ...row,
      sub_no: row.sub_no || '',
      section: group || null,
      unit_key: unit?.unit_key || null,
      unit_title: unit?.unit_title || null,
      lesson_code: unit?.lesson_code || null,
      ordinal: unit?.ordinal ?? null,
    })
  }

  // 续行归并锚点：记录最近一次「整题答案」行在 results 中的下标与 scope，
  // 供后续不以题号开头的续行归并到该答案（同 unit_key + 同 section 才允许）。
  let lastContinuationAnchor = null
  let lastAnchorUnitKey = null
  let lastAnchorGroup = null

  for (const { line: trimmed, unit, group } of processedLines) {
    const unitKey = unit?.unit_key ?? null

    // 选择题：单字母 A-D
    let m = trimmed.match(/^\(?(\d+)\)?(?:[．、]|\.(?=\D)|\s)\s*([A-Da-d])\s*$/)
    if (m) {
      push(unit, group, { question_no: parseInt(m[1], 10), answer: m[2].toUpperCase(), answer_type: 'choice', confidence: 0.95 })
      lastContinuationAnchor = null
      continue
    }

    // 判断题：√ / × 等符号
    m = trimmed.match(/^\(?(\d+)\)?(?:[．、]|\.(?=\D)|\s)\s*([✓√✔✗✘×])\s*$/)
    if (m) {
      push(unit, group, { question_no: parseInt(m[1], 10), answer: m[2], answer_type: 'judge', confidence: 0.95 })
      lastContinuationAnchor = null
      continue
    }

    // 连续选择题："13-17 ABCDB"
    m = trimmed.match(/^(\d+)\s*[-~]\s*(\d+)\s+([A-Da-d]+)\s*$/)
    if (m) {
      const start = parseInt(m[1], 10)
      const letters = m[3].toUpperCase().split('')
      for (let i = 0; i < letters.length; i++) {
        push(unit, group, { question_no: start + i, answer: letters[i], answer_type: 'choice', confidence: 0.9 })
      }
      lastContinuationAnchor = null
      continue
    }

    // 一般答案（新题整行起点）
    m = trimmed.match(/^(\d+)(?:[．、]|\.(?=\D)|\s)\s*(.+)$/)
    if (m) {
      const ans = m[2].trim()
      if (ans.length >= 2000) continue
      const questionNo = parseInt(m[1], 10)
      const isJudge = JUDGE_SYMBOL_RE.test(ans)
      push(unit, group, { question_no: questionNo, answer: ans, answer_type: isJudge ? 'judge' : 'answer', confidence: 0.8 })

      // 续行归并锚点：只允许归并到「整题答案」（sub_no 为空）行
      lastContinuationAnchor = results.length - 1
      lastAnchorUnitKey = unitKey
      lastAnchorGroup = group ?? null
      if (!isJudge) lowConfidence.push({ question_no: questionNo, answer: ans, section: group || null })
      continue
    }

    // ⚠️ 不要在这里"丢弃裸题号行"：曾经加过一条 `^\(?\d{1,3}\)?[．、.]?$ → continue`，
    //    理由是"行内拆分残留的裸号是纯污染"。但上游三道守卫（连续递增 / 行尾无答案 / 无标点
    //    只能在行首）已经把"误拆出裸号"这件事堵死了，实测全册 OCR 里裸题号行数为 0；
    //    而 OCR 偶尔把一条答案折成两行（「8. $-2\sqrt{2}$;」+「1.」）时，裸行正是**真答案值**，
    //    丢弃会让第 8 题少一个解（2026-09-21 实测：库内丢 "; 1"，PDF p17 印的是「8. −2√2 ; 1.」）。
    //    故沿用原行为：并入上一题答案。

    // 续行归并：不以题号开头的行是上一题的后续内容（解答题答案可以跨多行排版）。
    // 实测 27.1 的 q4/q9/q10 都是「首行 + (2)/(3) 等续行」；旧逻辑逐行解析时这些
    // 续行不匹配任何模式被直接丢弃，导致答案只留首行、sub_no 为空。
    // 归并条件严格：锚点存在、整题 answer（非 sub/非 choice/judge）、同一 unit_key、
    // 同一 section，防止把下一个单元/大题的首行续行错误追到上一题。
    const anchor = lastContinuationAnchor != null ? results[lastContinuationAnchor] : null
    if (
      anchor &&
      (anchor.unit_key ?? null) === unitKey &&
      (anchor.section ?? null) === (group ?? null) &&
      (anchor.sub_no ?? '') === '' &&
      (anchor.answer_type ?? 'answer') === 'answer'
    ) {
      anchor.answer = `${anchor.answer || ''}\n${trimmed}`.trim()
      continue
    }
    // 其余（跨单元/大题的首行续行、无锚点的噪声行）：丢弃
  }

  // 2026-09-10 续行归并后的子题拆分：
  // 多行解答题的 (1)(2)(3) 小问可能在首行与续行之间分布（q4/q9/q10 正是这种版式），
  // 必须在全部续行归并完成后再统一做一次子题拆分；否则归并后整块答案不与 sub_no 对齐。
  // 拆分门禁与旧内联拆分完全一致（splitSubAnswers → pickStrictSequence 严格递增 + 首标位置），
  // 不会把含普通括号（如 (x+1)(x-2)）的答案误拆。
  const postResults = []
  for (const a of results) {
    if (!a || String(a.sub_no || '') !== '' || (a.answer_type || 'answer') !== 'answer') {
      postResults.push(a)
      continue
    }
    const subs = splitSubAnswers(a.answer)
    if (!subs) {
      postResults.push(a)
      continue
    }
    for (const s of subs) {
      const subJudge = JUDGE_SYMBOL_RE.test(s.answer)
      postResults.push({ ...a, sub_no: s.sub_no, answer: s.answer, answer_type: subJudge ? 'judge' : 'answer' })
    }
  }
  results.length = 0
  results.push(...postResults)

  // 题号连续性校验：检测答案页 OCR 错位（如试卷类小标题漏识别导致跨单元题号错位）
  // 异常项带 kind='question_seq_anomaly' 写入 lowConfidence，调用方可按 kind 区分处理
  validateQuestionNumberSequence(results, lowConfidence)

  return {
    answers: results,
    // pageRanges 也透传：跨批 OCR 时，下一批首行的"上一页遗留单元"关闭逻辑靠它接力
    lastState: { unit: currentUnit, group: currentGroup, pageRanges },
    lastUnit: currentUnit,
    lastSection: currentUnit?.unit_title || null,
  }
}

/**
 * 校验同一 (unit, group) 内的题号连续性，检测答案页 OCR 错位。
 *
 * 根因场景：AI 漏识别"试卷① 19.1..."这种单元标题行，下面所有题号错挂到上一个父单元，
 *         或把两个单元的题号混读，导致同 (unit, group) 桶内出现反向/跳号/重置。
 *
 * 异常判定（按 (unit_key, section) 分桶，每桶按解析顺序遍历）：
 *  - reverse: cur.qn < prev.qn → 题号反向（极不可能正常出现，强烈提示跨单元错位）
 *  - gap: cur.qn - prev.qn > 5 → 跳号过大（OCR 漏读 1-5 个题号）
 *  - reset: cur.qn === 1 && prev.qn > 1 → 同 section 内题号重置到 1（可能漏识别大题组标题）
 *
 * 异常项 push 到 lowConfidence（带 kind: 'question_seq_anomaly'），调用方按 kind 区分处理：
 *   - 普通 lowConfidence（无 kind）→ 仍按 50% 阈值判断"低置信度偏多"
 *   - kind === 'question_seq_anomaly' → 单独汇总到"答案页疑似错位"warning，PC 端醒目展示
 */
function validateQuestionNumberSequence(answers, lowConfidence) {
  // 按 (unit_key, section) 分桶；桶内按解析顺序保留首次出现位置（dedupe 后顺序）
  const buckets = new Map()  // key: `${unit_key || '<null>'}||${section || '<null>'}` → Array<{qn, idx, unit, section}>
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i]
    if (a == null || a.question_no == null) continue
    const k = `${a.unit_key || '<null>'}||${a.section || '<null>'}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push({
      qn: a.question_no,
      idx: i,
      answer: a.answer,
      unit: a.unit_key || null,
      section: a.section || null,
    })
  }

  for (const list of buckets.values()) {
    if (list.length < 2) continue
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]
      const cur = list[i]
      const diff = cur.qn - prev.qn

      // 判定顺序：reset → reverse → gap
      //   - reset（cur.qn === 1 && prev.qn > 1）最常见于"漏识别大题组/单元标题"，
      //     把它放第一优先级避免被反向归类为 reverse。
      //   - reverse（cur.qn < prev.qn 且 cur.qn !== 1）才算真正的题号反向——
      //     例如 5 → 1（AI 把试卷②的题 1 错挂到试卷① 5 之后）。
      //   - gap（diff > 5）只能是"数字上行"才报。
      if (cur.qn === 1 && prev.qn > 1) {
        lowConfidence.push({
          kind: 'question_seq_anomaly',
          reason: 'reset',
          question_no: cur.qn,
          prev_question_no: prev.qn,
          unit_key: cur.unit,
          section: cur.section,
          message: `答案页OCR可能漏识别大题组/单元标题：第${cur.qn}题与第${prev.qn}题在同 section（"${cur.section || '?'}"）内题号重置到 1`,
        })
        continue
      }

      if (cur.qn < prev.qn) {
        // 真正的题号反向：cur.qn !== 1（1 已被 reset 截胡）
        lowConfidence.push({
          kind: 'question_seq_anomaly',
          reason: 'reverse',
          question_no: cur.qn,
          prev_question_no: prev.qn,
          unit_key: cur.unit,
          section: cur.section,
          message: `答案页OCR可能错位：第${cur.qn}题出现在第${prev.qn}题之后（同单元"${cur.unit || '?'}"${cur.section ? ' ' + cur.section : ''}）`,
        })
        continue
      }

      if (diff > 5) {
        // 跳号过大：可能漏读 1-5 个题号（OCR 噪声或密集排版）
        lowConfidence.push({
          kind: 'question_seq_anomaly',
          reason: 'gap',
          question_no: cur.qn,
          prev_question_no: prev.qn,
          gap: diff - 1,
          unit_key: cur.unit,
          section: cur.section,
          message: `答案页OCR可能漏读：第${prev.qn}题与第${cur.qn}题之间缺 ${diff - 1} 题（unit="${cur.unit || '?'}"）`,
        })
      }
    }
  }
}

