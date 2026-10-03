/**
 * 分数面积模型确定性通道（2026-10-03 第 76 轮，负责人裁决「既然画清楚了，把分数标注上去就完美了」）。
 *
 * 覆盖的版式：人教版/沪教版「找规律」题——
 *   「如图①，把正方形看作1，1/2 + 1/4 = 1 - 1/4 = ___」
 *   「如图③，把正方形看作1，1/2 + 1/4 + 1/8 + 1/16 = ___」
 * 图就是一张被**依次二分**的正方形：左半 1/2、右上 1/4、右下再竖切 1/8、剩下的横切 1/16…
 * 每格里印着对应的分数。这些分数是**题设本身**，不是学生手写。
 *
 * 为什么要单独开这条通道：视觉重绘走不通。渲染器对文字标注有一道信任边界
 * （`structure.js` 的 `isSymbolLabel`：含数字的标注一律丢弃，防止学生手写答案被
 * 重绘成整齐字体后伪装成题设），于是 1/2、1/4 这类**印刷分数**被一并丢掉，
 * 产出"框线正确但一格数字都没有"的空图（实测 19a2b355 / 21784525 / 073f6f6d 三张）。
 * 本通道不放宽那道过滤：分数序列是从**题干文本**解析出来的，按既有约定用
 * `verified: true` 声明信任级别（数轴/函数图象确定性通道同一机制），
 * 几何由服务端精确布局，**零视觉调用、零目测**。
 *
 * 纪律：不猜。题干不是这个版式、加法序列不是 1/2 起每次分母翻倍、
 * 或题干里还有别的几何构造 → 一律返回 null，交回原卷裁片/视觉通道。
 *
 * @module utils/areaModel
 */

/** 等比切分的外框边长（数学坐标，y 向上；渲染器自己归一化到画布） */
const SIDE = 100

/**
 * 题干 → 面积模型规格。解析不出返回 null。
 *
 * @param {string} text 题干全文（parent_stem + content 拼接）
 * @returns {{terms:string[], n:number}|null}
 */
export function parseAreaModelSpec(text) {
  const t = String(text ?? '').replace(/＝/g, '=')
  const stem = t.match(/把\s*正方形\s*看[作做成]\s*1/)
  if (!stem) return null
  // 同一小题里还出现别的几何构造时，本通道画不全（残缺的图不如原卷裁片）→ 放弃
  if (/三角形|圆|数轴|坐标|平行四边形|梯形|菱形|连接|作图|折叠/.test(t)) return null

  // 只取「把正方形看作1」之后、第一个等号之前的加法序列（等号右侧是答案式，不是图）
  const body = t.slice(stem.index + stem[0].length).split('=')[0]
  const terms = [...body.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})/g)].map(m => `${m[1]}/${m[2]}`)
  if (terms.length < 2 || terms.length > 5) return null

  let den = 1
  for (const term of terms) {
    const [num, d] = term.split('/').map(Number)
    if (num !== 1) return null
    den *= 2
    if (d !== den) return null
  }
  return { terms, n: terms.length }
}

/**
 * 规格 → 几何结构：正方形被依次二分，每格中心放该格的分数标注。
 *
 * 切法与原卷一致：竖切取左、横切取上，交替进行（1/2 左半 → 1/4 右上 → 1/8 下右之左 → 1/16 其上）。
 * 顶点全部用 `_` 前缀的内部辅助点：它们只参与几何，不画圆点也不写字母
 * （原图本来就没有 A/B/C/D，凭空加字母才是错图）。
 *
 * @param {{terms:string[]}} spec
 * @returns {object|null}
 */
export function specToAreaModelStructure(spec) {
  const terms = spec && Array.isArray(spec.terms) ? spec.terms : null
  if (!terms || terms.length < 2) return null

  const points = []
  const segments = []
  const labels = []
  let seq = 0
  const addPoint = (x, y) => {
    const label = `_a${seq++}`
    points.push({ label, x, y, type: 'vertex' })
    return label
  }
  /** 画一个矩形（四条边），返回中心点，供放分数标注 */
  const addRect = (x, y, w, h) => {
    if (!(w > 0) || !(h > 0)) return null
    const tl = addPoint(x, y + h)
    const tr = addPoint(x + w, y + h)
    const br = addPoint(x + w, y)
    const bl = addPoint(x, y)
    for (const [from, to] of [[tl, tr], [tr, br], [br, bl], [bl, tl]]) {
      segments.push({ from, to, style: 'solid', relation: 'normal', extend: false })
    }
    return { cx: x + w / 2, cy: y + h / 2 }
  }

  let r = { x: 0, y: 0, w: SIDE, h: SIDE }
  terms.forEach((term, i) => {
    const vertical = i % 2 === 0
    const piece = vertical
      ? { x: r.x, y: r.y, w: r.w / 2, h: r.h }
      : { x: r.x, y: r.y + r.h / 2, w: r.w, h: r.h / 2 }
    const rest = vertical
      ? { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h }
      : { x: r.x, y: r.y, w: r.w, h: r.h / 2 }
    const c = addRect(piece.x, piece.y, piece.w, piece.h)
    if (!c) return
    // verified:true = 人工/题干可核的确定性标注，走 structure.js 既有的信任通道，
    // 不是放宽 isSymbolLabel（那道过滤对视觉通道照旧全量生效）。
    labels.push({ x: c.cx, y: c.cy, text: term, verified: true })
    r = rest
  })
  // 最后剩下的那一格只画框不标注（原卷里它是留白/学生手写区）
  addRect(r.x, r.y, r.w, r.h)

  return { points, segments, labels, figure_type: 'geometry' }
}

/**
 * 一步到位：题干 → 面积模型 SVG。
 *
 * @param {string} parentStem 多小问大题公共题干
 * @param {string} content 子题正文
 * @param {Function} render renderGeometrySvg（注入，避免循环依赖，同 numberAxis 通道）
 * @returns {{svg:string, structure:object, spec:object}|null}
 */
export function buildAreaModelSvg(parentStem, content, render) {
  const text = [String(parentStem ?? ''), String(content ?? '')].join('\n')
  const spec = parseAreaModelSpec(text)
  if (!spec) return null
  const raw = specToAreaModelStructure(spec)
  if (!raw) return null
  const svg = typeof render === 'function' ? render(raw) : null
  if (!svg) return null
  return { svg, structure: raw, spec }
}

export default buildAreaModelSvg
