/**
 * pageRulingClean.js — 页面印刷装订竖线清除（2026-11-03 嘉定一模「多了一条线」）
 *
 * 现象：真卷 PDF 版面常带一条贯穿大半页的细装订竖线（嘉定一模 6 页全部实测
 * x≈0.758、纵跨 85%~96% 页高、实心无文字横穿；2026-11-02 徐汇一模 24 题同源，
 * 当时人工按题修过一次）。试卷题库的题目 bbox 横向覆盖全幅（x=60,width=900），
 * ⇒ 每一张题目裁片都把这条线带进去，老师看到「图形旁边多了一条线」。
 *
 * 收口位置：唯一实现挂在这里，由 paperBankService#cropQuestionImage（唯一裁剪出口）
 * 在裁剪前调用 stripPageRulingLines。所有下游（列表裁片、图形带抠取、讲解版、
 * 矢量重绘输入）自动继承干净图，无需各改一处。
 *
 * 判据（只认「印刷长规线」，宁放过不误伤）：
 *   连续列组：组内每列墨迹（灰度 < RULING_INK_MAX）行数 ≥ 页高 × 40%
 *   且 组宽 ≤ 页宽 × 0.6%（≈2px@1191，豁免最小 2px）
 *   且 组的行跨度内实心率 ≥ 60%（排掉散布文字列）
 *   且 全页命中组数 ≤ 6（正常版面只会有个位数规线；整页发黑的照片判据会炸 ⇒ 放弃清除）
 * 几何图形笔画纵跨远小于页高；表格竖线、坐标轴纵跨一般 <15% 页高，均不会命中。
 */
import sharp from 'sharp'

export const RULING_INK_MAX = 220        // 灰度低于此值算墨迹。嘉定一模实测双装订线：
                                         // 深线 x≈902 灰度<160、浅灰副线 x≈897 灰度 203-214
                                         // ——160 会漏掉副线（2026-11-03 二轮目验抓到）。
                                         // 误伤风险由「组宽 ≤0.6%W + 实心率 ≥60%」兜底，
                                         // 文字/图形列靠这两个条件进不来。
export const RULING_MIN_INK_FRAC = 0.4   // 列墨迹行数下限（占页高）
export const RULING_MAX_WIDTH_FRAC = 0.006 // 连续列组宽度上限（占页宽）
export const RULING_MIN_SOLID_FRAC = 0.6 // 行跨度内实心率下限
export const RULING_MAX_RANGES = 6       // 全页命中组数上限，超过视为异常页放弃清除

/**
 * 纯函数：在整页灰度像素里找「装订规线」列组。
 * @param {Uint8Array|Buffer} gray  宽×高 的灰度像素（行优先）
 * @param {number} width
 * @param {number} height
 * @returns {Array<{x0:number,x1:number,y0:number,y1:number}>} 擦除区间（x=列组本身，y=线的行跨度）
 */
export function findRulingLineRanges(gray, width, height) {
  if (!width || !height || gray.length < width * height) return []
  const minInk = height * RULING_MIN_INK_FRAC
  const maxGroupW = Math.max(2, Math.round(width * RULING_MAX_WIDTH_FRAC))

  const colInk = new Int32Array(width)
  for (let y = 0; y < height; y++) {
    const off = y * width
    for (let x = 0; x < width; x++) {
      if (gray[off + x] < RULING_INK_MAX) colInk[x]++
    }
  }

  const ranges = []
  let x = 0
  while (x < width) {
    if (colInk[x] < minInk) { x++; continue }
    let e = x
    while (e + 1 < width && colInk[e + 1] >= minInk) e++
    const gw = e - x + 1
    if (gw <= maxGroupW) {
      let y0 = -1, y1 = -1, solid = 0
      for (let y = 0; y < height; y++) {
        const off = y * width
        let any = false, all = true
        for (let cx = x; cx <= e; cx++) {
          const dark = gray[off + cx] < RULING_INK_MAX
          any = any || dark
          all = all && dark
        }
        if (any) {
          if (y0 < 0) y0 = y
          y1 = y
          if (all) solid++
        }
      }
      const span = y1 - y0 + 1
      if (span >= minInk && solid >= span * RULING_MIN_SOLID_FRAC) {
        ranges.push({ x0: x, x1: e, y0, y1 })
      }
    }
    x = e + 1
  }
  if (ranges.length > RULING_MAX_RANGES) return []
  return ranges
}

/**
 * 便捷封装：整页 Buffer → { ranges, width, height }。
 * 为什么要在这里做解码：本仓根目录与 server/ 各装了一份 sharp（两份 libvips），
 * 同一进程混用会炸（GLib criticals / colourspace: parameter space not set，
 * 2026-11-03 实测）。消费方一律经由本函数（server 侧副本），**不要自己 import
 * 根目录 sharp 来解页图**。
 */
export async function detectRulingLineRangesFromBuffer(pageBuffer) {
  const { data, info } = await sharp(pageBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    ranges: findRulingLineRanges(data, info.width, info.height),
    width: info.width,
    height: info.height,
  }
}

// 按整页 Buffer 缓存清除结果：parsePageToQuestions 对同一页的每行都调 cropQuestionImage，
// 检测+重编码只做一次。WeakMap 跟随 pageBuffer 生命周期，不造成常驻泄漏。
const strippedCache = new WeakMap()

/**
 * 返回去掉印刷装订线的整页图（无线/出错时原样返回入参 Buffer）。
 * 擦除 = 对每条规线的列组 ±2px、行跨度 ±2px 贴白块（只动线自己占的区域，
 * 不碰线上方/下方/左右的内容）。
 */
export async function stripPageRulingLines(pageBuffer) {
  if (!Buffer.isBuffer(pageBuffer)) return pageBuffer
  const cached = strippedCache.get(pageBuffer)
  if (cached) return cached
  let out = pageBuffer
  try {
    const { data, info } = await sharp(pageBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const ranges = findRulingLineRanges(data, info.width, info.height)
    if (ranges.length) {
      const overlays = ranges.map((r) => {
        const left = Math.max(0, r.x0 - 2)
        const top = Math.max(0, r.y0 - 2)
        const width = Math.min(info.width - left, r.x1 - r.x0 + 1 + 4)
        const height = Math.min(info.height - top, r.y1 - r.y0 + 1 + 4)
        return {
          input: {
            create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
          },
          left,
          top,
        }
      })
      out = await sharp(pageBuffer).composite(overlays).jpeg({ quality: 92 }).toBuffer()
    }
  } catch {
    out = pageBuffer
  }
  strippedCache.set(pageBuffer, out)
  return out
}
