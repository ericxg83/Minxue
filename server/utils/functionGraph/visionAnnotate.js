/**
 * 函数图象视觉标注增强：让人工「看见」原图上的所有字母标注。
 *
 * 背景（2026-09-18）：函数图象确定性通道"读字不读图"——正则只认 `X(数字,数字)`，
 * 题干里没写坐标的字母（"与x轴交于A、B"的 A/B、"点D(m,n)是抛物线上一点"的 D）
 * 被静默丢弃。此前逐个打补丁（xInterceptLabels / symbolicCurveLabels）仍可能漏句式。
 *
 * 根治方案：确定性通道算骨架（抛物线/顶点/根/截距——数学精确），
 * 再用**视觉模型看原图**识别图上所有字母标注及其位置，映射回数学坐标后合并，
 * 最后把「原图 || 待入库图」并排给模型做闭环确认（字母齐全、位置对才算 OK）。
 *
 * 本模块只做三件事：
 *   1. identifyVisionLabels —— 视觉识别：图上每个字母 + 图中相对位置（0-100）
 *   2. mergeVisionLabels   —— 数学坐标映射：视觉位置 → (x,y)（已有数学精确点优先）
 *   3. composeVerification —— 拼「原图 || 重画」对照图（供闭环确认）
 */

/** 视觉识别原图全部标注点。返回 [{label, rx, ry}]，rx/ry 为 0-100 相对坐标 */
export async function identifyVisionLabels({ imageDataURL, callVision }) {
  const systemPrompt = `你是数学试卷配图标注识别器。图中可能有一条曲线（抛物线/直线等）和坐标轴，
以及若干大写字母标注（A、B、C、D、E、O、顶点名等）。请识别图上**所有**字母标注。
注意：字母可能写在点的旁边（右上/左上/正下），要把字母与它所指的点的中心位置对应起来。
忽略图中的文字题号、数值刻度等非字母标注。`

  const userText = `请输出图中每个字母标注的 JSON 数组，格式严格如下（只输出 JSON）：
[{"label":"A","rx":10,"ry":65},{"label":"B","rx":75,"ry":65}]
其中 rx 是该点在图中的水平相对位置（0=最左，100=最右），
ry 是垂直相对位置（0=最上，100=最下）。
务必包含图中出现的**每一个**字母标注，一个都不能漏。`

  const resp = await callVision({ systemPrompt, userText, imageDataURL })
  const text = String(resp?.content ?? resp ?? '')
  const arr = text.match(/\[[\s\S]*\]/)?.[0]
  if (!arr) return []
  try {
    const parsed = JSON.parse(arr)
    return (Array.isArray(parsed) ? parsed : [])
      .filter(p => p && /^[A-Z][′'’]?$/.test(String(p.label || '')))
      .map(p => ({
        label: String(p.label).replace(/[′'’]/g, '′'),
        rx: Number(p.rx),
        ry: Number(p.ry)
      }))
      .filter(p => Number.isFinite(p.rx) && Number.isFinite(p.ry))
  } catch {
    return []
  }
}

/**
 * 把视觉识别的相对位置映射到数学坐标，并与确定性骨架合并。
 *
 * 映射锚点：所有「数学坐标已知」的点——原点 O(0,0)、题干带坐标点(curvePoints)、
 * x 轴根(与 xInterceptLabels 配对)、顶点。用最小二乘拟合两个方向的线性映射：
 *   x = sx * rx + tx ， y = sy * ry + ty
 * （实际验证：锚点数不足 2 个时无法拟合，返回原结构——至少 O 恒在，配合 A/B/C
 *  通常够 2 个以上。）
 *
 * 合并规则：
 *   - 已存在（数学精确）的点保留原坐标，不做任何覆盖；
 *   - 视觉识别出的新字母：若题干文字也提到该字母（避免把插图噪声当标注），
 *     用映射坐标补进 points；y 吸附到曲线上（这些点几乎都是"曲线上一点"）。
 *
 * @param {object} structure specToGeometryStructure 的骨架
 * @param {object} vision [{label,rx,ry}]
 * @param {object} spec parseFunctionGraphSpec 的返回值
 * @param {string} contentText 题干文本（用于确认字母确实被题干提到）
 * @returns {object} 合并后的 structure
 */
export function mergeVisionLabels(structure, vision, spec, contentText) {
  if (!Array.isArray(vision) || vision.length === 0) return structure

  // ── 1. 收集数学锚点（label → {x,y}，数学坐标已知的点） ──
  const mathAnchors = []
  const pushAnchor = (label, x, y) => {
    if (!label || !Number.isFinite(x) || !Number.isFinite(y)) return
    if (Math.abs(x) < 1e9 && Math.abs(y) < 1e9) mathAnchors.push({ label, x, y })
  }
  pushAnchor('O', 0, 0)
  const h = spec?.vertex?.x, k = spec?.vertex?.y, a = spec?.a
  if (Number.isFinite(h)) pushAnchor('V', h, k) // 顶点（无字母时用 V 占位，不参与视觉匹配）

  for (const p of spec?.curvePoints || []) pushAnchor(p.label, p.x, p.y)
  const roots = Number.isFinite(a) ? xInterceptsOf(a, h, k) : []
  const il = spec?.xInterceptLabels
  if (il && il.length === roots.length && roots.length > 0) {
    const sorted = [...roots].sort((x1, x2) => x1 - x2)
    il.forEach((lab, i) => pushAnchor(lab, sorted[i], 0))
  }

  // ── 2. 视觉位置 ↔ 数学锚点 配对 ──
  const visionByLabel = new Map(vision.map(p => [p.label, p]))
  const pairs = [] // {rx, ry, x, y}
  for (const anchor of mathAnchors) {
    const v = anchor.label === 'V' ? null : visionByLabel.get(anchor.label)
    if (!v) continue
    pairs.push({ rx: v.rx, ry: v.ry, x: anchor.x, y: anchor.y })
  }
  if (pairs.length < 2) return structure // 锚点不够，无法可靠映射

  // ── 3. 最小二乘线性映射 ──
  const fit = (pts, getRx, getMc) => {
    const n = pts.length
    const xs = pts.map(p => p.rx)
    const ys = pts.map(p => getMc(p))
    const mx = xs.reduce((s, v) => s + v, 0) / n
    const my = ys.reduce((s, v) => s + v, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      den += (xs[i] - mx) * (xs[i] - mx)
    }
    if (Math.abs(den) < 1e-9) return null
    const s = num / den
    const t = my - s * mx
    return { s, t }
  }
  const fx = fit(pairs, p => p.rx, p => p.x) // x = fx.s*rx + fx.t
  const fy = fit(pairs, p => p.ry, p => p.y) // y = fy.s*ry + fy.t
  if (!fx) return structure

  // ── 4. 合并新字母 ──
  const out = { ...structure, points: [...(structure.points || [])] }
  const existing = new Set(out.points.map(p => p.label))
  const textMentions = new Set([...(String(contentText || '').matchAll(/[A-Z]/g))].map(m => m[0]))

  for (const v of vision) {
    if (existing.has(v.label)) continue
    // 只接受题干文字真正提到的字母（防插图噪声——如"图1"的 1、坐标刻度等）
    if (!textMentions.has(v.label)) continue
    const x = fx.s * v.rx + fx.t
    // y 吸附到曲线：抛物线上一点 y = a(x-h)²+k
    let y = v.ry != null && fy ? (fy.s * v.ry + fy.t) : 0
    if (Number.isFinite(a) && Number.isFinite(h) && Number.isFinite(k)) {
      const curveY = a * (x - h) * (x - h) + k
      if (Math.abs(curveY) < 1000) y = curveY // 曲线优先，视觉 y 只作参考
    }
    out.points.push({ label: v.label, x, y, type: 'vertex' })
  }
  return out
}

/** 复用根计算（避免循环依赖） */
function xInterceptsOf(a, h, k) {
  if (a === 0) return []
  const disc = -k / a
  if (disc < 0) return []
  if (disc === 0) return [h]
  const r = Math.sqrt(disc)
  return [h - r, h + r]
}

/**
 * 拼「原图 || 重画」对照图并做闭环确认。
 * 复用 reactLoop 的 composeComparison / rasterizeSvg，避免重复实现。
 */
export async function verifyFunctionGraphByVision({
  originalImageDataUrl,
  renderSvg,
  labels,
  content,
  callVision
}) {
  const { rasterizeSvg, composeComparison, toDataUrl } = await import('../geom/dsl/render.js')
  const renderPng = renderSvg ? await rasterizeSvg(renderSvg) : null
  const originalBuf = dataUrlToBuffer(originalImageDataUrl)
  const composite = await composeComparison(originalBuf, renderPng)
  if (!composite) return { ok: false, reason: 'compose_failed' }

  const systemPrompt = `你是数学试卷配图质检员。左边是学生试卷原图（真值），右边是程序重画的函数图象。
请判断右边的图是否满足：
1. 曲线/坐标轴与原图一致（抛物线开口、顶点位置、与坐标轴交点）
2. **每个字母标注都齐全**：原图上有哪些字母，右边必须全部有，位置关系大致正确（如 A 在左边、B 在右边）
3. 没有多余的线或标注
如果满足，输出 VERDICT: OK；否则输出 VERDICT: FIX。
只输出一行 VERDICT: OK 或 VERDICT: FIX。`

  const userText = `题目：${content || '(无题干)'}
图上应出现的字母标注：${labels.join(', ') || '(题干未点名)'}
请对照左右两图给出结论。`

  const resp = await callVision({ systemPrompt, userText, imageDataURL: toDataUrl(composite) })
  const text = String(resp?.content ?? resp ?? '')
  return { ok: /VERDICT\s*[:：]\s*OK/i.test(text), reason: /FIX/i.test(text) ? 'fix' : 'unknown' }
}

function dataUrlToBuffer(u) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(u || ''))
  if (!m) return null
  try { return Buffer.from(m[2], 'base64') } catch { return null }
}