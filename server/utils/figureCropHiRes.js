/**
 * 配图高清重裁（2026-09-26）
 *
 * ── 要解决的问题 ──
 * 现用裁片是从 **1800px 压缩页图** 裁出来的（`worker.js` 的 pageBuffers：
 * `rotate().resize(1800,1800,inside).jpeg(85)`），而原始上传图往往是 1650×2200
 * 甚至 3072×4096。压缩这一刀对短边是 −18%，对大图是 **−56%**；裁完还要把短边
 * 插值放大到 800（上限 2400）—— 尺寸够、实际是模糊的插值像素。
 * 实测（2026-09-26，34 条缺图错题）：裁片短边中位 800，但源像素只有 1350×1800。
 *
 * ── 做法 ──
 * **框仍在压缩页上算**（保持 `refineFigureBoxOnPage` 的墨迹掩码/分带口径完全不变，
 * 否则裁出来的区域会和线上不一致 —— 2026-09-21 第5题 078d57ac 踩过这个坑），
 * 算完再按已知缩放比把框**映射回原始上传图坐标**去裁。
 * 结果：**同一个区域，更多真实像素**，画面内容一字不改 ⇒ 零正确性风险。
 *
 * ── 纪律 ──
 * · 本模块**纯图像处理**：不连库、不上传、不读环境变量（`estimateBackground` 与
 *   `cleanCrop` 由调用方注入），避免 `utils/` 反向依赖 `worker.js` 形成环。
 * · 缩放比不一致（两图长宽比不同）时**拒绝**，宁可回退原裁片。
 * · 收紧判不出图形（`refineFigureBoxOnPage` 返回 null）时返回 `null`，
 *   与生产同语义 —— 不给配图，而不是给一张错图。
 *
 * @module figureCropHiRes
 */

/**
 * @typedef {Object} HiResCropResult
 * @property {Buffer} buffer - 净化后的裁片 PNG
 * @property {{x:number,y:number,width:number,height:number}} boxOnOriginal - 映射到原图的像素框
 * @property {{width:number,height:number}} boxOnPage - 压缩页上的收紧框
 * @property {{width:number,height:number}} srcSize - 原图尺寸（裁剪来源）
 * @property {number} scale - 原图/压缩页 缩放比
 * @property {boolean} upscaled - 是否走了短边放大兜底
 */

/**
 * 把「压缩页上算出的框」映射回原图坐标并裁剪。
 *
 * @param {Object} p
 * @param {Buffer} p.pageBuffer - 与生产同口径的压缩页图（1800px）
 * @param {Buffer} p.originalBuffer - 原始上传页图
 * @param {{x:number,y:number,width:number,height:number}} p.bboxPx - 模型框（压缩页像素坐标）
 * @param {(grayRaw:any,w:number,h:number)=>any} p.estimateBackground - 注入 `worker.js#estimatePaperBackground`
 * @param {(buf:Buffer)=>Promise<Buffer>} p.cleanCrop - 注入 `worker.js#cleanGeometryCrop`
 * @param {number} [p.minSize=800] - 短边下限（与生产一致）
 * @param {number} [p.maxSize=2400] - 放大上限（与生产一致）
 * @returns {Promise<HiResCropResult|null>}
 */
export async function cropFigureHiRes({
  pageBuffer,
  originalBuffer,
  bboxPx,
  estimateBackground,
  cleanCrop,
  minSize = 800,
  maxSize = 2400,
}) {
  if (!pageBuffer || !originalBuffer || !bboxPx) return null
  if (!(bboxPx.width > 0) || !(bboxPx.height > 0)) return null

  const sharp = (await import('sharp')).default

  const pageMeta = await sharp(pageBuffer).metadata()
  const origMeta = await sharp(originalBuffer).metadata()
  const pw = pageMeta.width || 0, ph = pageMeta.height || 0
  const ow = origMeta.width || 0, oh = origMeta.height || 0
  if (!pw || !ph || !ow || !oh) return null

  // ① 框在压缩页上算 —— 与生产完全同口径
  const { refineFigureBoxOnPage } = await import('./figureRegionRefiner.js')
  let refined = null
  try {
    refined = await refineFigureBoxOnPage(pageBuffer, bboxPx, estimateBackground)
  } catch {
    refined = null
  }
  if (!refined || !(refined.width > 0) || !(refined.height > 0)) return null

  // ② 缩放比一致性闸：两图长宽比必须一致（同一张照片的不同分辨率）
  const sx = ow / pw
  const sy = oh / ph
  if (Math.abs(sx - sy) / Math.max(sx, sy) > 0.02) return null
  // 原图比压缩页还小 ⇒ 没有收益，交给调用方走原路径
  if (sx < 1.02) return null
  const scale = (sx + sy) / 2

  // ③ 映射回原图坐标并夹紧
  let left = Math.round(refined.x * scale)
  let top = Math.round(refined.y * scale)
  let width = Math.round(refined.width * scale)
  let height = Math.round(refined.height * scale)
  left = Math.max(0, Math.min(left, ow - 1))
  top = Math.max(0, Math.min(top, oh - 1))
  width = Math.max(1, Math.min(width, ow - left))
  height = Math.max(1, Math.min(height, oh - top))

  // ③.5 映射算术不变式（fail-closed）：夹紧若改变了框（框贴到原图边缘），
  //     说明压缩页与原图的边界处理不一致，宁可不出图也不出一块错区域。
  const rt = assertBoxRoundTrip(refined, scale, ow, oh)
  if (!rt.ok) return null

  // ④ 裁剪 + 与生产同规则的短边放大（高清源通常已够，只在极小图上触发）
  let pipeline = sharp(originalBuffer).extract({ left, top, width, height })
  let upscaled = false
  if (width < minSize || height < minSize) {
    const s = Math.max(minSize / width, minSize / height)
    const nw = Math.round(width * s)
    const nh = Math.round(height * s)
    if (nw <= maxSize && nh <= maxSize) {
      pipeline = pipeline.resize(nw, nh, { fit: 'fill' })
      upscaled = true
    }
  }
  let cropped = await pipeline.png().toBuffer()

  // ⑤ 净化：与生产同一个函数（去灰底/浅笔迹/白背景/轻度纠偏）
  if (cleanCrop) {
    try {
      cropped = await cleanCrop(cropped)
    } catch {
      /* 净化失败沿用未净化版本，与生产兜底一致 */
    }
  }

  return {
    buffer: cropped,
    boxOnOriginal: { x: left, y: top, width, height },
    boxOnPage: { width: refined.width, height: refined.height },
    srcSize: { width: ow, height: oh },
    scale,
    upscaled,
  }
}

/**
 * 供报告使用的「源像素增益」估算：高清重裁 vs 现用裁片。
 * 现用裁片的源像素 ≈ 压缩页上的框尺寸（未被放大前）。
 */
export function resolutionGain(boxOnPage, scale) {
  if (!boxOnPage || !(scale > 0)) return null
  return {
    beforeShort: Math.min(boxOnPage.width, boxOnPage.height),
    afterShort: Math.round(Math.min(boxOnPage.width, boxOnPage.height) * scale),
    ratio: Number(scale.toFixed(3)),
  }
}

/**
 * 「同一区域」像素比对 —— **辅助提示，不作硬闸**（2026-09-26 实测标定）。
 *
 * 设计初衷是给高清重裁加一道防错闸。实测标定（`_diag_hires_ab.mjs`，
 * 同代码 A/B：分别从压缩页与原始图裁同一题）结论：
 *
 * | 组 | mae 范围 | bigRatio 范围 |
 * |---|---|---|
 * | 正样本（同题、同代码、仅源分辨率不同） | 2.4 ~ **24.6** | 0.001 ~ **0.113** |
 * | 负样本（不同题互比） | **25.3** ~ 51.7 | **0.107** ~ 0.209 |
 *
 * 两组**边界重叠**（正样本最大 24.6 vs 负样本最小 25.3），无法用单一阈值可靠切分。
 * 原因是配图本身是**稀疏线稿**（大片白底 + 少量线条），任意两张图的灰度统计都很接近；
 * 再叠加 `cleanGeometryCrop` 的 trim/纠偏与分辨率相关，会额外引入几 px 的构图差异。
 *
 * ⇒ **不要**把本函数当作放行闸（会误杀）。高清重裁的正确性由另外两条保证：
 *   ① 收紧框在**与生产同一张压缩页**上计算（refiner 输出逐字节相同）；
 *   ② `assertBoxRoundTrip()` 锁定「映射回原图再映射回来必须等于原框」的算术不变式。
 * 本函数只用于**报告与人工抽检**：mae 明显高于 25 的样本值得看一眼。
 *
 * @param {Buffer} oldBuf - 现用裁片
 * @param {Buffer} newBuf - 新裁片
 * @param {{maeMax?:number, bigRatioMax?:number, bigDiff?:number}} [opts]
 * @returns {Promise<{ok:boolean, mae:number, bigRatio:number, reason?:string}>}
 */
export async function compareCropRegions(oldBuf, newBuf, opts = {}) {
  const { maeMax = 34, bigRatioMax = 0.10, bigDiff = 72 } = opts
  const sharp = (await import('sharp')).default
  const om = await sharp(oldBuf).metadata()
  const ow = om.width || 0, oh = om.height || 0
  if (!ow || !oh) return { ok: false, mae: 255, bigRatio: 1, reason: 'old-meta-empty' }

  const toGray = (buf) => sharp(buf)
    .resize(ow, oh, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .normalize()
    .raw()
    .toBuffer()

  let a, b
  try {
    a = await toGray(oldBuf)
    b = await toGray(newBuf)
  } catch (e) {
    return { ok: false, mae: 255, bigRatio: 1, reason: 'decode-fail:' + e.message }
  }
  if (a.length !== b.length || !a.length) {
    return { ok: false, mae: 255, bigRatio: 1, reason: 'length-mismatch' }
  }

  let sum = 0, big = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    sum += d
    if (d > bigDiff) big++
  }
  const mae = sum / a.length
  const bigRatio = big / a.length
  const ok = mae <= maeMax && bigRatio <= bigRatioMax
  return { ok, mae: Number(mae.toFixed(2)), bigRatio: Number(bigRatio.toFixed(4)) }
}

/**
 * 映射算术不变式：`压缩页框 →(×scale)→ 原图框 →(÷scale)→ 压缩页框` 必须回到原值。
 *
 * 这是高清重裁**唯一真正需要证明**的东西 —— 只要映射是恒等的，且 refiner 在
 * 同一张压缩页上跑，那么「新裁片 = 同一区域的更高分辨率版本」就是构造性成立的，
 * 不需要靠像素比对去猜。
 *
 * 容差 1px（`Math.round` 的必然误差）。
 *
 * @param {{x:number,y:number,width:number,height:number}} boxOnPage
 * @param {number} scale
 * @param {number} origW
 * @param {number} origH
 * @returns {{ok:boolean, back:Object, maxDelta:number}}
 */
export function assertBoxRoundTrip(boxOnPage, scale, origW, origH) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))
  let left = Math.round(boxOnPage.x * scale)
  let top = Math.round(boxOnPage.y * scale)
  let width = Math.round(boxOnPage.width * scale)
  let height = Math.round(boxOnPage.height * scale)
  left = clamp(left, 0, Math.max(0, origW - 1))
  top = clamp(top, 0, Math.max(0, origH - 1))
  width = Math.max(1, Math.min(width, origW - left))
  height = Math.max(1, Math.min(height, origH - top))

  const back = {
    x: left / scale, y: top / scale,
    width: width / scale, height: height / scale,
  }
  const deltas = [
    Math.abs(back.x - boxOnPage.x),
    Math.abs(back.y - boxOnPage.y),
    Math.abs(back.width - boxOnPage.width),
    Math.abs(back.height - boxOnPage.height),
  ]
  const maxDelta = Math.max(...deltas)
  return { ok: maxDelta <= 1.0, back, maxDelta: Number(maxDelta.toFixed(3)) }
}

