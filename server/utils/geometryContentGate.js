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

const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω'

// 点 = 大写字母或大写字母+撇（C′/A'）。前后都不能紧跟小写字母，
// 以排除 tan/sin/cos 等缩写与英文单词；允许紧跟 △ ∠ ( 、 等几何符号或标点。
const PT = /[A-Z][′'’]?(?![a-z])/g

/**
 * 提取题干中被引用的"点"（大写字母，含带撇派生点 C′/A'）。
 */
export function extractReferencedPoints(content) {
  const s = String(content || '').replace(/\\frac\{[^{}]*\}\{[^{}]*\}/g, ' ')
  const pts = new Set()
  for (const m of s.matchAll(PT)) {
    pts.add(m[0].replace(/[′'’]/g, '′'))
  }
  return pts
}

/**
 * 提取题干中被引用的线段/直线：题干里相邻出现的两个点字母（AB、BC′）。
 * 线段在题干中几乎总是连写，单字母上下文不足为凭，这里只取连写对。
 */
export function extractReferencedSegments(content) {
  const s = String(content || '').replace(/\\frac\{[^{}]*\}\{[^{}]*\}/g, ' ')
  const segs = new Set()
  for (const m of s.matchAll(/([A-Z][′'’]?)([A-Z][′'’]?)(?![a-z])/g)) {
    const a = m[1].replace(/[′'’]/g, '′')
    const b = m[2].replace(/[′'’]/g, '′')
    if (a === b) continue
    segs.add([a, b].sort().join('|'))
  }
  return segs
}

/**
 * 提取题干中的"连写串"：△BCE、四边形ABCD、∠BAC 里连续出现的大写字母（含带撇 C′）。
 * 只有串内**相邻**（以及首尾闭合）的字母对算作边——"四边形ABCD"给出 AB/BC/CD/DA，
 * 不含对角线 AC/BD。对角线要么题干显式连写（"连接AC"），要么就是模型凭空加的。
 */
export function extractLetterRuns(content) {
  const s = String(content || '').replace(/\\frac\{[^{}]*\}\{[^{}]*\}/g, ' ')
  const runs = []
  for (const m of s.matchAll(/[A-Z][′'’]?(?:[A-Z][′'’]?)+/g)) {
    const letters = [...m[0].matchAll(/[A-Z][′'’]?/g)].map(x => x[0].replace(/[′'’]/g, '′'))
    if (letters.length >= 2) runs.push(letters)
  }
  return runs
}

const segKey = (a, b) => [a, b].sort().join('|')

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
 * @returns {{ ok: boolean, reasons: string[] }} ok=false 时 reasons 给出可读原因
 */
export function validateStructureAgainstContent(structure, content) {
  const reasons = []
  const pts = (structure?.points || []).map(p => p.label).filter(Boolean)
  const segs = (structure?.segments || []).map(g => segKey(g.from, g.to))
  const drawnPts = new Set(pts)
  const drawnSegs = new Set(segs)

  // 空题干 = 无证据，不拦（避免把无题干的记录全部误杀）
  if (!String(content || '').trim()) return { ok: true, reasons }

  const refPts = extractReferencedPoints(content)
  const refSegs = extractReferencedSegments(content)

  // ── 硬规则 1：题干提到带撇的派生点（折叠/对称产物），图上必须有 ──
  // 折叠、轴对称题的 C′/A′ 是结构主体，画不出它整张图就是错的。
  for (const p of refPts) {
    if (p.includes('′') && ![...drawnPts].some(q => q.includes('′'))) {
      reasons.push(`题干引用派生点 ${p}，重绘图上没有带撇的点`)
      break
    }
  }

  // ── 硬规则 2：画出的线段在题干里找不到出处 → 凭空造边 ──
  // 出处的认定（从严到宽）：
  //   a. 这条边曾在题干里连写过（AB、BA）
  //   b. 两端字母在题干某个连写串里相邻，或是该串的首尾（△BCE 给出 BC/CE/EB）
  // 不含对角线：四边形ABCD 不隐含 AC/BD。折叠题里被凭空画出的两条对角线正是这么被抓到的。
  const runPairs = new Set()
  for (const letters of extractLetterRuns(content)) {
    for (let i = 0; i + 1 < letters.length; i++) {
      runPairs.add(segKey(letters[i], letters[i + 1]))
    }
    if (letters.length >= 3) {
      runPairs.add(segKey(letters[letters.length - 1], letters[0]))
    }
  }
  for (const seg of drawnSegs) {
    if (refSegs.has(seg) || runPairs.has(seg)) continue
    const [a, b] = seg.split('|')
    reasons.push(`重绘图上的线段 ${a}${b} 在题干中无引用`)
  }

  // ── 硬规则 3：点字母凭空出现（题干完全没提的点） ──
  const refLetters = new Set(refPts)
  for (const letters of extractLetterRuns(content)) {
    letters.forEach(l => refLetters.add(l))
  }
  for (const p of pts) {
    const bare = p.replace(/′/g, '')
    if (!refLetters.has(bare)) {
      reasons.push(`重绘图上的点 ${p} 在题干中未出现`)
    }
  }

  // ── 硬规则 4：题干给出的形状约束（正方形/菱形/等边）与坐标比例不符 ──
  checkShapeConstraints(structure, content, reasons)

  return { ok: reasons.length === 0, reasons }
}
