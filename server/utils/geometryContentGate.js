/**
 * 重绘结构 vs 题干文本 交叉核对闸门。
 *
 * 背景：视觉模型识别几何结构时会画错——把题目没有的边画出来（多画），
 * 或漏掉折叠派生点 C′ / 轴对称点（漏画）。渲染器只负责把结构排得整齐，
 * 结构错了它排得越规范越误导。实测抽样 10 条 completed 里 2 条结构错。
 *
 * 独立证据来源是题干文字，不是另一次模型调用——同一模型自我验证抓不到
 * 自身的系统性偏差。本模块纯文本比对，零视觉调用。
 *
 * 原则沿用 geometryLabelValidator："宁愿少显示，也不显示错误信息"。
 */

import { isAuxPointLabel, isTickNumberLabel, detectNumberAxis, detectCoordAxes } from './geom/structure.js'

const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω'

// （点名正则 PT / PT_LOWER 见下方 normalizeLabel 旁——两者共用同一套下标/撇归一约定）

/**
 * 把题干里的 \frac{...}{...} 还原成"分子 / 分母"的可读形态，便于后续提取
 * 字母引用。原来直接整段替换成空格，会把 \frac{AB}{BC} 这种比例里的 AB/BC
 * 引用一起擦掉——切线、相似、平行截比题几乎都用比例写法，于是闸门误报
 * "重绘线段 AB 在题干中无引用"。
 *
 * 处理：保留分子分母内部字母，仅把 LaTeX 包裹层替换为"分子/分母"中间夹 /
 * （带前后空格，避免拼到相邻字母上）。不能匹配（嵌套 / 非法 LaTeX）的
 * 片段退化为空字符串。
 */
function unfoldFractions(content) {
  const s = String(content || '')
  // 单层 \frac{...}{...}，允许内部含空格、字母、数字、撇。
  // 嵌套的（如 \frac{\frac{a}{b}}{c}）先由外到里逐层替换；本正则只匹配当前层。
  return s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, num, den) => {
    const n = String(num).trim()
    const d = String(den).trim()
    if (!n && !d) return ' '
    return ` ${n} / ${d} `
  })
}

/**
 * 提取题干中被引用的"点"：大写字母（含带撇 C′/A' 与下标 A₁）＋**独立成词的小写字母**
 * （数轴上表示数的 a、b、c 就是小写）。
 */
export function extractReferencedPoints(content) {
  const s = unfoldFractions(content)
  const pts = new Set()
  for (const m of s.matchAll(PT)) pts.add(normalizeLabel(m[0]))
  for (const m of s.matchAll(PT_LOWER)) pts.add(normalizeLabel(m[0]))
  return pts
}

/**
 * 提取题干中被引用的线段/直线：题干里相邻出现的两个点字母（AB、BC′、C₁D）。
 * 线段在题干中几乎总是连写，单字母上下文不足为凭，这里只取连写对。
 */
export function extractReferencedSegments(content) {
  const s = unfoldFractions(content)
  const segs = new Set()
  const one = `[A-Z][′'’]?(?:[₀-₉0-9]+)?`
  for (const m of s.matchAll(new RegExp(`(${one})(${one})(?![a-z])`, 'g'))) {
    const a = normalizeLabel(m[1])
    const b = normalizeLabel(m[2])
    if (a === b) continue
    segs.add([a, b].sort().join('|'))
  }
  return segs
}

/**
 * 提取题干中的"连写串"：△BCE、四边形ABCD、∠BAC 里连续出现的大写字母（含 C′、C₁）。
 * 只有串内**相邻**（以及首尾闭合）的字母对算作边——"四边形ABCD"给出 AB/BC/CD/DA，
 * 不含对角线 AC/BD。对角线要么题干显式连写（"连接AC"），要么就是模型凭空加的。
 */
export function extractLetterRuns(content) {
  const s = unfoldFractions(content)
  const one = `[A-Z][′'’]?(?:[₀-₉0-9]+)?`
  const runs = []
  for (const m of s.matchAll(new RegExp(`${one}(?:${one})+`, 'g'))) {
    const letters = [...m[0].matchAll(new RegExp(one, 'g'))].map(x => normalizeLabel(x[0]))
    if (letters.length >= 2) runs.push(letters)
  }
  return runs
}

const segKey = (a, b) => [a, b].sort().join('|')

/**
 * 提取「点X在(边/线段/斜边…)YZ上」句式给出的**位置约束**：重绘图必须满足
 * X 落在 YZ 上（共线，段类还要求在段内）。
 *
 * 为什么需要（2026-09-21 第04周第7题 beda2c3d）：题干「点D在边AB上」，重绘模型把
 * D 画进三角形内部——线段 AB/DC 都画了、字母也都引用了，此前所有规则查的都是
 * 「线段有没有出处、点有没有被引用」，从不查**位置关系**，这种"线段齐全、位置全错"
 * 的图一路绿灯发布，老师看到的就是一张和原图完全不同的图。
 *
 * 刻意不匹配的形态（防误伤）：
 *   · 「YZ**的**垂直平分线/中点/上方/延长线上」——「的」字隔断，本提取的 YZ 后只允许
 *     紧跟段类限定词或「上」，带「的」的句式一概不收（那些约束不是"共线"）；
 *   · 小写字母（数轴表示数的 a/b、直线 l₁）不在提取范围；
 *   · 「点D、E分别在边AB、AC上」的**分别**句式暂不提取（多点多线配对易错，
 *     收益/风险比不划算，先留空——漏提取只是少了这道防线，不会误杀）。
 *
 * @returns {Array<{point:string, on:[string,string], between:boolean}>} between=true 还要求 X 在段内
 */
export function extractPointOnSegmentConstraints(text) {
  const s = unfoldFractions(text)
  const one = `[A-Z][′'’]?(?:[₀-₉0-9]+)?`
  const QUAL = '(?:边|线段|斜边|直角边|底边|对角线|射线|直线)'
  const out = []
  const push = (p, a, b, between) => {
    const P = normalizeLabel(p)
    const A = normalizeLabel(a)
    const B = normalizeLabel(b)
    if (P && A && B && P !== A && P !== B && A !== B) {
      out.push({ point: P, on: [A, B].sort(), between })
    }
  }
  // ① 点X在[边/线段/斜边/…/射线/直线]YZ上
  for (const m of s.matchAll(new RegExp(`点\\s*(${one})\\s*在\\s*${QUAL}?\\s*(${one})\\s*(${one})\\s*上`, 'g'))) {
    push(m[1], m[2], m[3], !/射线|直线/.test(m[0]))
  }
  // ② X为/是YZ上一点
  for (const m of s.matchAll(new RegExp(`(${one})\\s*(?:为|是)\\s*(${one})(${one})\\s*上\\s*一?点`, 'g'))) {
    push(m[1], m[2], m[3], true)
  }
  // ③ YZ上有/取/任取一点X
  for (const m of s.matchAll(new RegExp(`(${one})(${one})\\s*上\\s*(?:有|任取|取)\\s*一?点\\s*(${one})`, 'g'))) {
    push(m[3], m[1], m[2], true)
  }
  return out
}

/**
 * 题干是否声明了「平行线组」（**3 条及以上**直线互相平行，如 l₁//l₂//l₃、AB∥CD∥EF、
 * 直线l1∥l2∥l3）。
 *
 * 为什么需要：平行线分线段成比例题的图上，三条平行线本身（如 AD/BE/CF）是图形主体，
 * 但题干文本只写截线上的线段长度（AB=3, AC=9, DE=2），从不写平行线的两端字母。
 * 模型把平行线画出来（完全正确），核对闸门却因「AD 在题干中无引用」拒稿
 * （2026-09-18 批量实测：20 条 pending 只成功 1 条，其余几乎全是这个原因）。
 *
 * 为什么必须是 3 条：单对平行（CD//AB、DE//BC）不是"平行线组"——那种图（三角形内
 * 平行辅助线、梯形两条底边）的线段几乎总是被题干显式连写（AB、CD 都出现过），
 * 不需要端点豁免。放开它会误放过模型把垂足/辅助线画错位的错图（实测作图题
 * 「作CD//AB，作点B到直线CD的垂线垂足为点E」：模型画 CE/EB 被误豁免，已作为回归测试拦下）。
 *
 * 触发时启用「端点字母豁免」：线段两端字母都在题干出现过即视为合法图示元素。
 * 这只放开「线」，点凭空出现（硬规则 3）仍然拦截，幻觉点不会被放行。
 * 四边形对角线（AC 在「四边形ABCD」串内非相邻）不受影响：该题干没有平行线组声明。
 */
export function hasParallelLineGroup(text) {
  const s = String(text || '')
  // 1) 带下标的平行线：l₁//l₂//l₃ / l1//l2//l3 / 直线l1∥l2∥l3 —— {2,} 表示至少 3 条
  const sub = /(?:直线)?\s*l\s*[₁₂₃４５６７８９０1234567890１２３４５６７８９０](?:\s*(?:∥|\/\/)\s*l\s*[₁₂₃４５６７８９０1234567890１２３４５６７８９０]){2,}/
  // 2) 字母平行线组：AB∥CD∥EF / AB//CD//EF —— {2,} 表示至少 3 条
  const letters = /[A-Z][′'’]?[A-Z][′'’]?(?:\s*(?:∥|\/\/)\s*[A-Z][′'’]?[A-Z][′'’]?){2,}/
  return sub.test(s) || letters.test(s)
}

/**
 * 题干是否是「尺规/直尺作图题」（要求画图并保留作图痕迹）。
 *
 * 为什么需要（2026-09-20 C 类坏批次重跑实测 06bd5ccb）：作图题（"仅用无刻度的
 * 直尺作线段 BC 的三等分点 E、F（保留作图痕迹）"）的图上必然有**辅助痕迹线**
 * ——利用格点/已有图形作的辅助连线（如 AB、AC），这些线是作法的一部分，
 * 题干文本从不连写。模型把它们画出来（完全正确），闸门却因「AB 在题干中
 * 无引用」拒稿。
 *
 * 触发时启用「端点字母豁免」：线段两端字母都在题干出现过即视为合法作图痕迹。
 * 这只放开「线」，点凭空出现（硬规则 3）仍然拦截。
 */
export function isConstructionTask(text) {
  return /作图|直尺|圆规|保留.*痕迹|刻度尺/.test(String(text || ''))
}

/**
 * 从作图题题干提取「被点名的线段」（必须画在图上的主体/参照线）。
 *
 * 匹配「线段XY / 直线XY / 射线XY」字样（「作CD//AB」「到直线CD的垂线」「作线段BC
 * 的三等分点」都命中）。不含「四边形/梯形/△ABC」等背景词，不受「沿直线l折叠」
 * 单字母影响 —— 规则窄而准：只有被点名的线段漏画才算错图。
 */
export function extractConstructionRequiredSegs(text) {
  const s = String(text || '')
  const out = new Set()
  for (const m of s.matchAll(/(?:线段|直线|射线)\s*([A-Z]['′’]?[₀-₉0-9]{0,2})\s*([A-Z]['′’]?[₀-₉0-9]{0,2})/g)) {
    const a = normalizeLabel(m[1])
    const b = normalizeLabel(m[2])
    if (a && b && a !== b) out.add(segKey(a, b))
  }
  return out
}

/** 题干里出现过的所有大写字母（含带撇点与下标点，去重；与结构侧同一套归一） */
function allReferencedLetters(text) {
  const s = String(text || '')
  const set = new Set()
  for (const m of s.matchAll(/[A-Z][′'’]?(?:[₀-₉0-9]+)?/g)) {
    set.add(normalizeLabel(m[0]))
  }
  return set
}

/** 撇号归一：把各种撇（' ’ ′）统一成 U+2032，便于跨来源比较字母 */
const normalizePrime = (s) => String(s ?? '').replace(/[′'’]/g, '′')

/**
 * 点名的**唯一归一函数**：撇号统一 + 下标统一（₀-₉ → 0-9）。
 *
 * 为什么需要下标归一（2026-09-19 三修）：同一道题里，"C₁"常常被写成
 * "C1"（模型写 ASCII 数字，题干排版用下标字符），两边字面不同却被当成两个点，
 * 于是线段 `C1D` 被判"题干中无引用"（生产库 last_error 实测：
 * `重绘图上的线段 BC1 在题干中无引用；…线段 C1D 在题干中无引用`）。
 * 归一后 `C₁` ≡ `C1`、`A′` ≡ `A'`，跨来源比较才成立。
 */
const SUB_TO_DIGIT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' }
const normalizeLabel = (s) => String(s ?? '')
  .replace(/[′'’]/g, '′')
  .replace(/[₀-₉]/g, (c) => SUB_TO_DIGIT[c])

// 点名（含下标与撇）：`A`、`A′`、`A₁`、`C1`
const PT = /[A-Z][′'’]?(?:[₀-₉0-9]+)?(?![a-z])/g
// 数轴上"表示数的字母"是小写（a、b、c）：只认**独立成词的单字母**，
// 避免把 tan/sin/cos 这类缩写里的字母当成点名（(?<![A-Za-z])…(?![A-Za-z])）。
const PT_LOWER = /(?<![A-Za-z])[a-z](?![A-Za-z])/g

// 题干里的形状词 → 该形状要求"所有边等长"。模型给的坐标只需相对准确，
// 故容差放到 1.35（正方形画成 2:1 矩形是 2.0，能抓住；轻微手抖不误杀）。
const EQUILATERAL_SHAPES = [
  { re: /正方形\s*([A-Z][′'’]?(?:[A-Z][′'’]?){3})/g, sides: 4, name: '正方形' },
  { re: /菱形\s*([A-Z][′'’]?(?:[A-Z][′'’]?){3})/g, sides: 4, name: '菱形' },
  { re: /等边三角形\s*([A-Z][′'’]?(?:[A-Z][′'’]?){2})/g, sides: 3, name: '等边三角形' },
  { re: /正三角形\s*([A-Z][′'’]?(?:[A-Z][′'’]?){2})/g, sides: 3, name: '正三角形' }
]
const EQUILATERAL_TOLERANCE = 1.35

/**
 * 题干说了形状，就按形状校验重绘坐标的比例。
 * "边长为5的正方形ABCD" 被画成 2:1 矩形是纯结构错误，而题干已给出判据。
 */
function checkShapeConstraints(structure, content, reasons) {
  const pmap = {}
  for (const p of structure?.points || []) {
    if (p?.label && Number.isFinite(p.x) && Number.isFinite(p.y)) pmap[p.label] = p
  }
  const dist = (a, b) => Math.hypot(pmap[a].x - pmap[b].x, pmap[a].y - pmap[b].y)

  for (const { re, sides, name } of EQUILATERAL_SHAPES) {
    for (const m of String(content).matchAll(re)) {
      const letters = [...m[1].matchAll(/[A-Z][′'’]?/g)].map(x => x[0].replace(/[′'’]/g, '′'))
      if (letters.length !== sides) continue
      if (!letters.every(l => pmap[l])) continue
      const lens = letters.map((l, i) => dist(l, letters[(i + 1) % sides]))
      if (lens.some(v => v < 1e-6)) continue
      const ratio = Math.max(...lens) / Math.min(...lens)
      if (ratio > EQUILATERAL_TOLERANCE) {
        reasons.push(
          `题干说 ${name}${letters.join('')}，重绘图各边长比达 ${ratio.toFixed(2)}:1`
        )
      }
    }
  }
}

/**
 * 核对重绘结构与题干引用。
 *
 * @param {object} structure - normalize 后的几何结构（points/segments）
 * @param {string} content - 题干文本
 * @param {string[]} [options] - 选项文本数组（每项一条）。选择题最常见：
 *   题干只列已知条件（"如图2，DF//AC，DE//BC"），所有字母引用都藏在选项里
 *   （"BD/CE = AB/AC"）。把 options 也作为合法引用来源，避免把"标准 ABC 三角
 *   形图"误判为多画 AB 边。
 * @returns {{ ok: boolean, reasons: string[] }} ok=false 时 reasons 给出可读原因
 *
 * 坐标系豁免：structure.coordinate_system.exists 为真时，原点 O 与轴标 X/Y
 * （以及任何以它们为端点的线段）不参与硬规则 2/3。这类字母是插图标配，
 * 题干不写它们不是"凭空多画"。
 */
export function validateStructureAgainstContent(structure, content, options) {
  const reasons = []
  // ── 渲染家具豁免（2026-09-19 三修）──
  //
  // 这三类东西**不是"题面要标注的点"，而是插图家具**，题干里本来就不会写它们：
  //   ① `_` 前缀辅助点/辅助线段（规则 11/13 要求模型这么命名：曲线采样、刻度小竖线、阴影顶点）；
  //   ② 刻度数字（0、1、-2…规则 13 明确要求用 `point` 承载，渲染器吸附到轴上）；
  //   ③ 轴上字母 O / X / Y（原点与轴名，插图标配）。
  //
  // 旧口径把这三类全当"模型幻觉"，于是**每一张按规则画出来的图都会被 content_mismatch 拒稿**。
  // 生产库实测：`tikz_status='none'` 里约 40 张的 last_error 就是本闸门，其中
  // 「重绘图上的点 O 在题干中未出现」9 张、刻度数字若干；`geometry_structure_json` 至今 0 条，
  // 说明 DSL 重绘这条路**从未成功发布过任何一张**（46 条 completed 走的是不走闸门的
  // 确定性函数图象通道）。属于"闸门判据 ↔ 提示词契约"三处脱节的老坑。
  //
  // 判据一律**复用渲染器那一份**（structure.js），保证"上屏的东西"与"闸门核对的东西"
  // 是同一套定义；真实字母（A、B、C′、P…）的核对口径一字未改。
  const hasAxis = !!(
    structure?.coordinate_system?.exists ||
    detectCoordAxes(structure?.points, structure?.segments, structure?.labels) ||
    detectNumberAxis(structure?.points, structure?.segments)
  )
  const axisLabels = new Set()
  if (hasAxis) {
    if (structure?.coordinate_system?.origin) axisLabels.add(normalizeLabel(structure.coordinate_system.origin))
    for (const l of ['O', 'X', 'Y', 'x', 'y']) axisLabels.add(l) // 原点惯例 O，轴名 X/x、Y/y
  }
  const isAxisLabel = (label) => axisLabels.size > 0 && axisLabels.has(normalizeLabel(label))
  const isFurniture = (label) =>
    isAuxPointLabel(label) ||
    isTickNumberLabel(label) ||
    isAxisLabel(label)

  const pts = (structure?.points || [])
    .filter(p => p?.label && !isFurniture(p.label))
    .map(p => p.label)
  const segs = (structure?.segments || [])
    .filter(g => !isFurniture(g?.from) && !isFurniture(g?.to))
    .map(g => segKey(normalizeLabel(g.from), normalizeLabel(g.to)))
  const drawnPts = new Set(pts.map(normalizeLabel))
  const drawnSegs = new Set(segs)
  const isAxisSegment = (seg) => {
    if (axisLabels.size === 0) return false
    const [a, b] = seg.split('|')
    return isAxisLabel(a) || isAxisLabel(b)
  }

  const optionsArr = Array.isArray(options) ? options.filter(Boolean) : []
  const hasOptions = optionsArr.length > 0

  // 题干 + 选项拼成单一文本用于提取引用。
  // 选择题（题干"如图X，[已知1]，[已知2]"）的字母引用全在选项里；只看题干
  // 会把标准几何图（必然带 AB/BC 等基础边）误判为"凭空多画"。
  const allText = hasOptions
    ? [content || '', ...optionsArr].join('\n')
    : content

  // 空题干 + 无选项 = 无证据，不拦（避免把无题干的记录全部误杀）
  if (!String(allText || '').trim()) return { ok: true, reasons }

  const refPts = extractReferencedPoints(allText)
  const refSegs = extractReferencedSegments(allText)

  // 「点X在YZ上」位置约束 + 画出的点坐标表（硬规则 2.7 用；无坐标的点自动跳过）
  const pointOnSegConstraints = extractPointOnSegmentConstraints(allText)
  const coordOf = new Map()
  for (const p of structure?.points || []) {
    if (p?.label && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      coordOf.set(normalizeLabel(p.label), p)
    }
  }
  const xs = [...coordOf.values()].map(p => p.x)
  const ys = [...coordOf.values()].map(p => p.y)
  const diag = coordOf.size >= 2
    ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    : 0

  // ── 硬规则 1：题干提到带撇的派生点（折叠/对称产物），图上必须有 ──
  // 折叠、轴对称题的 C′/A′ 是结构主体，画不出它整张图就是错的。
  for (const p of refPts) {
    if (p.includes('′') && ![...drawnPts].some(q => q.includes('′'))) {
      reasons.push(`题干引用派生点 ${p}，重绘图上没有带撇的点`)
      break
    }
  }

  // ── 硬规则 2：画出的线段在题干/选项里找不到出处 → 凭空造边 ──
  // 出处的认定（从严到宽）：
  //   a. 这条边曾在题干或选项里连写过（AB、BA）
  //   b. 两端字母在题干/选项某个连写串里相邻，或是该串的首尾（△BCE 给出 BC/CE/EB）
  // 不含对角线：四边形ABCD 不隐含 AC/BD。折叠题里被凭空画出的两条对角线正是这么被抓到的。
  //
  // 2026-09-18 新增豁免「平行线组」：题干声明了多条直线平行（l₁//l₂//l₃、
  // AB∥CD∥EF）时，图上必然要把这些平行线画出来，而它们的端点字母（如平行线
  // 被两条截线穿过产生的 AD/BE/CF）题干文本从不连写。若这些线段的两个端点字母
  // 都曾在题干出现过，视为合法图示元素放行。实测不豁免时，平行线分线段成比例
  // 这类最标准的几何题几乎全被误杀（20 条 pending 仅 1 条成功）。
  const runPairs = new Set()
  for (const letters of extractLetterRuns(allText)) {
    for (let i = 0; i + 1 < letters.length; i++) {
      runPairs.add(segKey(letters[i], letters[i + 1]))
    }
    if (letters.length >= 3) {
      runPairs.add(segKey(letters[letters.length - 1], letters[0]))
    }
  }
  const parallelGroup = hasParallelLineGroup(allText)
  // 作图痕迹豁免与平行线组豁免共用「两端字母已知」判定
  const construction = isConstructionTask(allText)
  const knownLetters = (parallelGroup || construction) ? allReferencedLetters(allText) : new Set()
  for (const seg of drawnSegs) {
    if (refSegs.has(seg) || runPairs.has(seg) || isAxisSegment(seg)) continue
    if (parallelGroup || construction) {
      // 平行线组/作图痕迹的「端点字母豁免」：两端字母都出现在题干即可。
      // 只比字母不比撇号：l₁//l₂//l₃ 的截线交点 C 与 C′ 都算已知。
      const [a, b] = seg.split('|')
      if (knownLetters.has(a.replace(/′/g, '')) && knownLetters.has(b.replace(/′/g, ''))) continue
    }
    const [a, b] = seg.split('|')
    reasons.push(`重绘图上的线段 ${a}${b} 在题干中无引用`)
  }

  // ── 硬规则 2.5：作图题要求画的线段漏画（2026-09-20）──
  // 与作图痕迹豁免配套的防守：豁免放行了痕迹线，但「作线段XY / 作直线XY /
  // 到直线XY的垂线」句式点名的线段是作图主体/参照，图上必须有（或有其子段）。
  // 实测案例（回归测试锁定）：「作CD//AB，作点B到直线CD的垂线垂足为E」——模型
  // 漏画 CD 还把垂足画错位，此前靠「CE 无引用」歪打正着被拦；豁免上线后必须
  // 由本规则接住，否则错图放行。
  if (construction) {
    const requiredSegs = extractConstructionRequiredSegs(allText)
    for (const seg of requiredSegs) {
      if (drawnSegs.has(seg)) continue
      // 允许子段覆盖：模型把 XY 拆成 X-M、M-Y 两段画（含三等分/中点作图），不算漏画
      const [x, y] = seg.split('|')
      const covered = [...drawnSegs].some(g => {
        const [a, b] = g.split('|')
        return (a === x && drawnPts.has(y)) || (b === y && drawnPts.has(x)) ||
               (a === y && drawnPts.has(x)) || (b === x && drawnPts.has(y))
      })
      if (!covered) {
        reasons.push(`作图要求画 ${x}${y}，重绘图上没有`)
      }
    }
  }

  // ── 硬规则 2.7：题干声明「点X在YZ上」→ 图上 X 必须真的落在 YZ 上（2026-09-21）──
  // 实测案例（回归测试锁定）：第04周第7题 beda2c3d，题干「点D在边AB上」，重绘模型把
  // D 画进三角形内部（到 AB 直线的距离 ≈ 图高 8%），△ACD 与 △ABC 的相似关系从图上
  // 完全看不出来，但线段 AB/DC 齐全、字母也都被引用，此前规则全部放行 ⇒ 错图发布。
  // 这是本闸门第一条**位置关系**规则：共线距离用全图包围盒对角线的 3% 作容差，
  // 段类（边/线段/斜边…）还要求参数 t ∈ [-3%, 103%]（射线/直线句式不要求段内）。
  // 点不全（漏画/幻觉点）时不在本规则管——分别由硬规则 1/3 兜底。
  if (diag > 0) {
    for (const c of pointOnSegConstraints) {
      const P = coordOf.get(c.point)
      const A = coordOf.get(c.on[0])
      const B = coordOf.get(c.on[1])
      if (!P || !A || !B) continue
      const abx = B.x - A.x
      const aby = B.y - A.y
      const len2 = abx * abx + aby * aby
      if (len2 === 0) continue
      const t = ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2
      const dist = Math.abs((P.x - A.x) * aby - (P.y - A.y) * abx) / Math.sqrt(len2)
      const offLine = dist > diag * 0.03
      const offSegment = c.between && (t < -0.03 || t > 1.03)
      if (offLine || offSegment) {
        reasons.push(
          `题干说点${c.point}在${c.on[0]}${c.on[1]}上，重绘图上它${offLine ? '偏离该线段所在直线' : '跑到线段延长线上'}`
        )
      }
    }
  }

  // ── 硬规则 3：点字母凭空出现（题干/选项完全没提的点） ──
  // 端点对端豁免：模型画了某个字母 P，且 P 在某条 segment 的某一端，
  // 该 segment 的另一端是题干/选项已引用的字母 → P 作为"必然端点对端"豁免。
  //   例：「传送带 + A + B」+ 图上 A-B-C，segment B-C 中 B 已引用 → C 豁免。
  //   例：「线段 AB 上取点 C」+ 图上 A-B-C，A/B 已引用 → C 豁免。
  // 不豁免：
  //   - 孤立字母点（不在任何 segment 上）— 模型幻觉字母
  //   - 对角线 AC 两端都在题干/选项里的 case — 硬规则 3 本就放过，硬规则 2 拦
  //   - 模型标了 ∠1 → A1 这类伪字母 — 既不在 refLetters 也不在任何 segment 邻接 refLetter
  // refLetters 在 C 方案下空集（题干/选项完全没字母）时本规则按旧逻辑全拒；
  // 这种纯图题罕见，且原代码也是同样处理，行为不变。
  const refLetters = new Set(refPts)
  for (const letters of extractLetterRuns(allText)) {
    letters.forEach(l => refLetters.add(l))
  }
  // 去撇形式：题干写 A′、结构写 A（或反之）算同一个点。
  // 旧口径只给结构侧去撇、题干侧不去，于是「题干有 A′、图上标 A」会被误判为幻觉点。
  const refLettersBare = new Set([...refLetters].map(l => l.replace(/′/g, '')))
  const exemptByAdjacency = new Set()
  for (const seg of drawnSegs) {
    const [a, b] = seg.split('|')
    const aBare = a.replace(/′/g, '')
    const bBare = b.replace(/′/g, '')
    if (refLettersBare.has(aBare) && !refLettersBare.has(bBare)) exemptByAdjacency.add(bBare)
    if (refLettersBare.has(bBare) && !refLettersBare.has(aBare)) exemptByAdjacency.add(aBare)
  }
  for (const p of pts) {
    const full = normalizeLabel(p)
    const bare = full.replace(/′/g, '')
    if (!refLetters.has(full) && !refLettersBare.has(bare) && !exemptByAdjacency.has(bare)) {
      reasons.push(`重绘图上的点 ${p} 在题干中未出现`)
    }
  }

  // ── 硬规则 4：题干给出的形状约束（正方形/菱形/等边）与坐标比例不符 ──
  // 形状约束只看 content（"题干说正方形..."），不混入选项。
  checkShapeConstraints(structure, content, reasons)

  return { ok: reasons.length === 0, reasons }
}

/**
 * 「流程图 / 数值转换器 / 输入→输出表格」类配图的**内容闸门**（2026-09-19 新增）。
 *
 * 为什么需要：这类题的配图里有**中文说明文字**（"输入""求算术平方根""是否为无理数""输出"）
 * 或**分数数值表格**，而 DSL 的 `label` 通道被 `isSymbolLabel` 有意锁死——只放行数学符号，
 * 以免学生手写答案被当成题设文字画进图里。放行中文会破坏这道防伪闸门，代价远大于收益。
 * 几何 DSL 也本就不是画流程图的工具。
 *
 * 处置：识别出来后**不进入重绘**，直接保留原图裁片（与「数轴/实物/统计图」同类，返回
 * `non_geometry_figure`）。全库规模极小（2026-09-19 实测：含"转换器/流程图"6 题、
 * 输入+输出表格 5 题），不值得为它做通用多面板/文字渲染改造。
 *
 * @param {string} content 题干文本
 * @returns {{skip:boolean, kind?:string, reason?:string}}
 */
const FLOWCHART_RE = /(数值|数据)?转换器|流程(图|式)|程序框图|运算程序|计算程序|操作程序|按键程序|算法程序/
const IO_TABLE_RE = /输入\s*[:：][\s\S]{0,150}?输出\s*[:：]/

// ── 多子图/多面板判据（2026-09-21 新增）──
//
// 为什么需要：题干形如「小明把…的两个长方形沿对角线剪开，围成**如图2**所示的一个大正方形」
// 时，原图里是**并排的两个子图**（图1 + 箭头 + 图2）。几何 DSL 的坐标空间是**单一画布**，
// 没有「多面板/子图」概念 —— 模型只能挑一个画。实测 `845802c9`：只画出了图1 的两个长方形，
// 图2（拼成的大正方形）、中间的箭头、尺寸标注全部丢失，而闸门（题干引用核对）因为没有
// 字母引用可核而放行，最终把"画了一半"的图发到生产。
//
// 判据刻意**要求出现"图"字前缀**（图1/图2/图甲/图乙）或带括号的甲乙：
// 裸的 ①②③ 在题干里绝大多数是**条件编号**（"下列说法正确的是①…②…"），
// 拿它当子图编号会大面积误伤。宁可漏判，不可误判。
const SUBFIG_CN_RE = /图\s*([1-9１２３４５６７８９①②③④⑤⑥⑦⑧⑨⑩一二三四五六七八九十])/g
const SUBFIG_AB_RE = /图\s*([甲乙丙丁])/g
const SUBFIG_PAREN_AB_RE = /[（(]\s*([甲乙丙丁])\s*[）)]/g
const TWO_FIGURE_RE = /两幅图|两个图|两张图|左右两图|两侧的图|甲乙两图|甲、乙两图/
// 「四个选项图」：同一坐标系里放 4 个函数图象当选项。DSL 也没有多坐标系概念，
// 模型只能在一个坐标系里硬塞 4 张图 ⇒ 必然 5 轮不收敛（实测 56966fa2）。
// 不重绘对它是 strictly better：回退原卷裁片，还省下 5 轮模型额度。
const FOUR_OPTION_GRAPH_RE = /同一(个)?(平面直角)?坐标系[^。；;]{0,16}(大致)?(图像|图象)/

/**
 * 判定题干是否引用了**两个及以上子图**（多面板）。
 * @param {string} content 题干文本
 * @returns {{skip:boolean, kind?:string, reason?:string}}
 */
export function detectMultiPanelFigure(content) {
  const t = String(content || '')
  const collect = (re) => {
    const s = new Set()
    for (const m of t.matchAll(re)) s.add(m[1])
    return s
  }
  const cn = collect(SUBFIG_CN_RE)
  if (cn.size >= 2) {
    return {
      skip: true,
      kind: 'multi_panel',
      reason: `题干引用了 ${cn.size} 个子图（${[...cn].map((n) => `图${n}`).join('、')}）：几何 DSL 只有一个画布、没有多面板概念，重绘必然只画其中一个`
    }
  }
  const ab = new Set([...collect(SUBFIG_AB_RE), ...collect(SUBFIG_PAREN_AB_RE)])
  if (ab.size >= 2) {
    return {
      skip: true,
      kind: 'multi_panel',
      reason: `题干引用了 ${ab.size} 个子图（${[...ab].map((n) => `图${n}`).join('、')}）：几何 DSL 没有多面板概念，重绘必然只画其中一个`
    }
  }
  if (TWO_FIGURE_RE.test(t)) {
    return {
      skip: true,
      kind: 'multi_panel',
      reason: '题干明说有两幅图：几何 DSL 没有多面板概念，重绘必然只画其中一个'
    }
  }
  if (FOUR_OPTION_GRAPH_RE.test(t)) {
    return {
      skip: true,
      kind: 'multi_panel_option_graph',
      reason: '四选项函数图象题：需要同一画布并排 4 个坐标系，几何 DSL 不支持多坐标系，重绘必然不收敛'
    }
  }
  return { skip: false }
}

/**
 * 这类配图**根本不该走几何重绘**（走了只会输出一张更差或残缺的图）：
 *   ① 流程图/数值转换器/程序框图 —— 框内是中文说明文字；
 *   ② 输入→运算→输出表格 —— 图内是数值表格；
 *   ③ 多子图/多面板（图1+图2、图甲+图乙）、四选项函数图象 —— DSL 没有多面板/多坐标系概念。
 *
 * ⚠️ 这条判据有**两个必须同时生效的调用点**，缺一个就会漏（2026-09-21 事故教训）：
 *   - 生成侧：`server/geometryWorker.js`（拦住新题，省额度）
 *   - 发布侧：`server/scripts/publish-nonc3-dsl-redraws.mjs`（拦住**判据上线前就已生成**的旧产物）
 * 2026-09-20 事故：判据只加在生成侧，发布脚本没有 → 一张判据上线前跑出来的
 * 「空框流程图」照样被批量发布上线，老师看到的是框里一个字都没有的流程图。
 *
 * @param {string} content 题干文本
 * @returns {{skip:boolean, kind?:string, reason?:string}}
 */
export function detectNonGeometryFigure(content) {
  const t = String(content || '')
  if (FLOWCHART_RE.test(t)) {
    return {
      skip: true,
      kind: 'flowchart',
      reason: '流程图/数值转换器：框内是中文说明文字，几何 DSL 只画数学符号（放行中文会破坏防手写答案闸门）'
    }
  }
  if (IO_TABLE_RE.test(t)) {
    return {
      skip: true,
      kind: 'io_table',
      reason: '输入→运算→输出表格题：图内是数值表格与文字，不是几何图形'
    }
  }
  return detectMultiPanelFigure(t)
}
