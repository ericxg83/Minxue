/**
 * paperFigureAssign.js — 小问组配图共享（2026-11-02 建，2026-11-06 重写判据）
 *
 * ── 为什么必须有这一步 ──
 * 切段器（questionBoxMeasure）的切段规则是「某行 y_top = 该行题号行上沿、
 * y_bottom = 下一行题号行上沿」。真卷常见版式「题干 → (1)(2)(3) 小问 → 图块放最后」
 * （2026 上海徐汇一模第 25 题实测，杨浦 19/23、徐汇 21/22/23/24 同模式）：
 * 图块整段落进【最后一个下问】的切段，前面的小问只切到【自己那一行文字条】
 * （归一化高 20 ≈ 一行字，行内展示出来只有几像素高 = 等于没图）。
 *
 * ── 2026-11-06 事故：共享把「别人的正文」当配图 ──
 * 旧判据用 bbox 高度猜「谁是带图行」，抠不出干净图形带时**整张源裁片兜底**。
 * 嘉定一模 22 实测：(2) 的切段高 200（三行正文 + 一条 EF 线段），被猜成带图行；
 * 抠图失败 ⇒ 兜底成 (2) 的整段正文 ⇒ 补给 (1)。结果 (1)(2) 都拿着 (2) 的正文，
 * 而 (1) 真正需要的图（题干材料框里的作图）彻底消失。
 *
 * 现在的判据是**正证据**（宁可不出图，也绝不给错图）：
 *   ① 「图源」必须真的能抠出图形带（extractFigureBandFromCrop 非 null）；
 *      抠不出来的行只能是 target，永不当源，也永不整张兜底。
 *   ② target 只收「自己无图 + 高度是一行文字条」的行；高裁片自成一题，
 *      覆盖它等于毁掉它自己的内容（嘉定 22 的 (2) 就在此列）。
 *      唯一例外：该行**自己的正文**写着「如图 / 图中 / 图N」——它离了图没法做，
 *      必须补（杨浦 24(1) 实测：高 74、两行字，第一个字就是「如图 1」）。
 *      例外只认 content，⛔ 不认 parent_stem（题干里的「如图」是全小题共用的）。
 *   ③ 图源优先整题行（题干图是全小题共用的「如图」），其次组内最高的小问。
 *   ④ 题干行永不被小问的图覆盖。
 *   ⑤ 整行裁片里没有任何图形（纯正文/选项/空白）⇒ 调用方**不挂配图**，
 *      由 analyzeCropFigure 的 hasFigure 判定；配图只承载图形，不承载正文重影。
 *
 * 两个消费方（同一实现，禁止各写一套）：
 *   ① paperBankService.parsePageToQuestions —— 新卷解析的裁片后置步；
 *   ② 存量修复脚本 —— 对已入册的卷子补图（按同一判据重跑即可）。
 */

import sharp from 'sharp'

/** 「带图行」的最小归一化高度（0-1000 页高）。一行文字 ≈ 15-30；图形块实测 106-356。 */
export const FIG_MIN_NORM_H = 60

/**
 * 「这块非文字带算不算一幅图」的最小像素高度（4x 裁片）。
 * 一行正文的墨迹带 20~37px；作图题里当已知条件的那条线段只有 3px（嘉定 22(2) 实测）。
 */
export const FIG_MIN_BAND_H = 50

/** 墨迹阈值：灰度 < 200 记为墨点。与裁片/图形带全链路同口径。 */
const INK = 200

const isInk = (v) => v < INK

/**
 * 找「内容框」：试卷里的阅读材料常套一个矩形边框（嘉定一模 22 题）。
 * 边框会把框内文字与图形连成一条大带 ⇒ 抠图只能整框返回（含材料文字）。
 * @returns {{rows:number[], cols:number[]}|null} 需要抹白的行/列下标；非内容框返回 null
 *
 * 判据（两道闸，缺一不可，见下「为什么必须区分框线/图形边」）：
 * - 直线候选：该行（列）**最长连续墨点** ≥ max(240px, 45% 幅宽) 且 墨点总数 ≥ 0.9×该长度。
 *   文字行最长连续墨点只有 100~150px（笔画间有间隙），永远到不了这个量级。
 * - 框内必须有「整行文字」：框内至少 6 行的最长连续墨点 ≥ 40% 框宽。
 *   ⚠️ 这道闸不可省：矩形 ABCD 这类**图形本身就是矩形**，四条边同样满足直线候选；
 *   只有「框内确实有正文」才能证明这是材料框而不是图形，否则一抹白整幅图就没了。
 */
function detectContentFrame(data, width, height) {
  const minRunX = Math.max(240, width * 0.45)
  const minRunY = Math.max(240, height * 0.45)
  const rowLines = []
  for (let y = 0; y < height; y++) {
    const off = y * width
    let run = 0
    let best = 0
    let cnt = 0
    let lo = -1
    let hi = -1
    for (let x = 0; x < width; x++) {
      if (isInk(data[off + x])) {
        cnt++
        run++
        if (run > best) best = run
        if (lo < 0) lo = x
        hi = x
      } else run = 0
    }
    if (best >= minRunX && cnt >= best * 0.9) rowLines.push({ y, lo, hi })
  }
  const colLines = []
  for (let x = 0; x < width; x++) {
    let run = 0
    let best = 0
    let cnt = 0
    let lo = -1
    let hi = -1
    for (let y = 0; y < height; y++) {
      if (isInk(data[y * width + x])) {
        cnt++
        run++
        if (run > best) best = run
        if (lo < 0) lo = y
        hi = y
      } else run = 0
    }
    if (best >= minRunY && cnt >= best * 0.9) colLines.push({ x, lo, hi })
  }
  if (rowLines.length < 2 || colLines.length < 2) return null

  const r0 = rowLines[0].y
  const r1 = rowLines[rowLines.length - 1].y
  const c0 = Math.min(...colLines.map(l => l.x))
  const c1 = Math.max(...colLines.map(l => l.x))
  const boxW = c1 - c0 + 1
  const boxH = r1 - r0 + 1
  if (boxW < width * 0.3 || boxH < height * 0.25) return null

  // 框内「文字行」清点（跳过边框附近的 4px，避开边框反锯齿残留）。
  // ⚠️ 判据是「很多段短墨迹」而不是「一段长墨迹」：中文正文逐字断开，
  //    一行实测 24~63 段、最长段只有 14~30px；图形描边每行只有 2~4 段。
  let textRows = 0
  for (let y = r0 + 4; y <= r1 - 4; y++) {
    const off = y * width
    let runs = 0
    let ink = 0
    let on = false
    for (let x = c0 + 4; x <= c1 - 4; x++) {
      if (isInk(data[off + x])) {
        ink++
        if (!on) runs++
        on = true
      } else on = false
    }
    if (runs >= 12 && ink >= boxW * 0.03) textRows++
  }
  if (textRows < 6) return null

  return {
    rows: rowLines.map(l => l.y),
    cols: colLines.map(l => l.x),
  }
}

/** 抹白指定行/列（返回新缓冲，不改入参）。 */
function blankFrameLines(data, width, height, frame) {
  const out = Buffer.from(data)
  for (const y of frame.rows) out.fill(255, y * width, y * width + width)
  for (const x of frame.cols) for (let y = 0; y < height; y++) out[y * width + x] = 255
  return out
}

/**
 * 规划小问组的配图共享。
 * @param {Array<{id?:string, page_no?:number, question_no:any, sub_no?:string,
 *                 bbox:{y:number,height:number}|null}>} rows 单页（或整卷）的题目行
 * @param {Set<number>|Map<number,any>|boolean[]|null} figureIdx 索引集合/`下标→图形带`映射/布尔数组，
 *        标记**实测能抠出图形带**的行
 * @returns {Array<{targetIdx:number, sourceIdx:number}>} 需要把 source 的图补给 target 的计划；
 *          按 rows 下标引用，调用方据此取行。无计划返回 []。
 *
 * ⛔ 没传 figureIdx = 没有任何「谁带图」的证据 ⇒ 返回 []（fail closed）。
 *    历史上的高度启发式就是 2026-11-06 事故的根因，不允许再作为默认行为。
 */
export function planSubrowFigureAssignments(rows, figureIdx, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  let fig
  if (figureIdx instanceof Set) fig = figureIdx
  else if (figureIdx instanceof Map) fig = new Set(figureIdx.keys())
  else if (Array.isArray(figureIdx)) fig = new Set(figureIdx.map((v, i) => (v ? i : -1)).filter(i => i >= 0))
  else fig = new Set()
  if (!fig.size) return []
  // 「自己已经有图的行」——含**有图但抠不干净**的行（它们挂整张裁片兜底）。
  // ⛔ 这两类必须分开：fig 只决定「谁能当图源」，withFig 决定「谁不许被覆盖」。
  //   混成一个就会出事（2026-11-06 实测）：杨浦 25(2) 自己有图 6~图 10，只是抠不干净，
  //   正文又写着「如图 6」，如果只按 fig 判，它会被当成无图行，拿 (1) 的图覆盖掉自己的五幅图。
  const withFig = opts.withFigure instanceof Set ? opts.withFigure : fig

  const groups = new Map()
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r) continue
    // 整题行（sub_no 为空）也进组：它是「如图」那张图的第一顺位来源
    const key = `${r.page_no ?? ''}|${String(r.question_no ?? '')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(i)
  }

  const hOf = (i) => {
    const b = list[i] && list[i].bbox
    const h = b ? Number(b.height) : 0
    return Number.isFinite(h) ? h : 0
  }

  // 「这一行自己说了要图」——只认**小问自己的 content**，⛔ 不看 parent_stem：
  // 题干里写「如图」是全小题共用的，用 parent_stem 判会把每个小问都判成需要图。
  // 实测两例（杨浦一模 24）：(1) 高 74（两行字，含①②），按高度闸会被挡在图外，
  // 但它的正文第一句就是「如图1，建立平面直角坐标系」——(1) 离了图没法做；
  // 而嘉定一模 22(2)（「作出以线段 EF 为底边的黄金三角形」，高 200）正文不提图，
  // 高度闸必须继续挡住它 —— 给它补题干那张图就是 11-06 事故本身。
  const asksForFigure = (i) => {
    const c = String((list[i] && list[i].content) || '')
    return /如图|图中|图\s*\d/.test(c)
  }

  const plans = []
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue

    // 图源：整题行（有图）> 组内最高的小问（有图）
    let srcIdx = idxs.find(i => !list[i].sub_no && fig.has(i))
    if (srcIdx === undefined) {
      for (const i of idxs) {
        if (!fig.has(i)) continue
        if (srcIdx === undefined || hOf(i) > hOf(srcIdx)) srcIdx = i
      }
    }
    if (srcIdx === undefined) continue

    for (const i of idxs) {
      if (i === srcIdx) continue
      if (!list[i].sub_no) continue        // 题干行永不被小问的图覆盖
      if (withFig.has(i)) continue         // 自己已经有图（干净图带或整张兜底），不覆盖
      // 高裁片自成一题，覆盖会毁掉它自己的内容；唯一例外是它正文自己写着「如图」
      // （杨浦 24(1) 实测：两行字但第一个字就是「如图1」）。
      if (hOf(i) >= FIG_MIN_NORM_H && !asksForFigure(i)) continue
      plans.push({ targetIdx: i, sourceIdx: srcIdx })
    }
  }
  return plans
}

/**
 * 从源行裁片里抠「图形带」：去掉顶部/零散的小问文字行，只留下方的大块图形。
 * @param {Buffer} cropBuffer 源行裁片（页面坐标按行 bbox 裁出的 JPEG）
 * @returns {Promise<Buffer|null>} 图形带裁片；找不到干净的图形带返回 null
 *          （⛔ 调用方**不得**再整张兜底去共享，见文件头 2026-11-06 事故）
 *
 * 判据（2026-11-03 按 13 张真实裁片重写；2026-11-06 补框线与顶点字母两条）：
 * - 灰度 < 200 记为墨点；逐行统计墨点数与横向跨度（像素）。
 * - 按行 ink 剖面分段：空白 ≥ 8px 断开（真卷行距实测 10~32px，足以逐行切开文字）。
 * - 「文字带」= 高度 < 120px 且 横向跨度 ≥ 本裁片最宽带的 50%。
 *   ⚠️ 不能用「≥75% 整幅」作绝对阈值：真卷页面有留白，文字行只占 38%~70% 宽，
 *   图形占 12%~45%，绝对阈值会把文字误判成图形（嘉定 24 实测裹进两行小问文字）。
 * - 「图形带」= 最高的非文字带（整片图形远高于单行文字），再向下合并被内部间隙
 *   切碎的图块（间隙 ≤ 40px 且非文字带）；向上合并「顶点字母 / 坐标轴箭头」等标注
 *   （间隙 ≤ max(12px, 0.6×文字行高)、非文字带、且与图形横向范围重叠 ≥ 50%）。
 *   ⚠️ 向上的横向重叠闸不可省：页面左缘的短文字行（「坐标；」「坐标.」）也是窄带，
 *   但它们在图幅之外，并入就会把文字裹进配图（嘉定 24 实测）。
 *   ⚠️ 间隙上限不能钉死 12px：4x 裁片里顶点字母离图 15~20px 很常见
 *   （杨浦一模 19 的 C 就是这么被切掉的）。改成跟文字行高挂钩，并保留 isTextBand 闸挡正文。
 * - 带宽高须 ≥ 50px 且 ≥ 裁片高 25%，否则视为纯文字 / 无图 → 返回 null。
 * - 纯文字裁片：所有带都是文字带 ⇒ 无图形带 ⇒ null（绝不裹文字进图）。
 * - 带边框的阅读材料框：先抹白框线再分段（嘉定一模 22 实测，见 detectContentFrame）。
 */
export async function extractFigureBandFromCrop(cropBuffer) {
  const r = await analyzeCropFigure(cropBuffer)
  return r.band
}

/**
 * 「这一行裁片里到底有没有图形」的完整判定（extractFigureBandFromCrop 的带诊断版本）。
 *
 * @returns {Promise<{band:Buffer|null, hasFigure:boolean, reason:string}>}
 *   - `band`：抠出来的干净图形带（能去掉正文时）；抠不干净时为 null；
 *   - `hasFigure`：**裁片里存在成块的图形**。为 false 表示这片区域只有正文/选项/空白，
 *     此时调用方**不得**把整张裁片当配图 —— 那等于把题干文字再贴一遍，
 *     负责人 2026-11-06 报障的徐汇 20（三个小问各贴同一张表格）、嘉定 22(2)（贴自己的正文）
 *     就是这个形态。
 *   - `reason`：`ok` / `no-figure-band`（纯文字）/ `no-ink` / `too-small` /
 *     `band-not-clean`（有图但抠不干净）/ `error`。
 *
 * ⚠️ hasFigure 与 band 是两个独立结论，别合并：
 *   杨浦一模 25(2) 是「两段正文 + 图 6~图 10 排成两行 + 图注」的多图版式，
 *   最高那块图只有 155px、合并后 figH 196 < 裁片高 25% ⇒ 抠不干净（band=null），
 *   但那里确实有五幅图：整张裁片兜底是**对**的，绝不能因为 band=null 就当纯文字删掉。
 */
export async function analyzeCropFigure(cropBuffer) {
  let sawFigure = false
  try {
    const { data, info } = await sharp(cropBuffer).greyscale().raw().toBuffer({ resolveWithObject: true })
    const width = Number(info.width) || 0
    const height = Number(info.height) || 0
    if (width < 40 || height < 60) return { band: null, hasFigure: false, reason: 'too-small' }

    // 抹白内容框的框线后再做剖面；⚠️ 只从**派生副本**抹白，最终仍从原图裁（不重编码、不掉色）
    let prof = data
    const frame = detectContentFrame(data, width, height)
    if (frame) prof = blankFrameLines(data, width, height, frame)

    // 逐行墨迹数 + 横向跨度/左右边界（像素）+ 最长连续墨迹
    const inkPerRow = new Array(height).fill(0)
    const spanPerRow = new Array(height).fill(0)
    const loPerRow = new Array(height).fill(-1)
    const hiPerRow = new Array(height).fill(-1)
    const runPerRow = new Array(height).fill(0)
    for (let y = 0; y < height; y++) {
      const off = y * width
      let c = 0, lo = -1, hi = -1, run = 0, best = 0
      for (let x = 0; x < width; x++) {
        if (isInk(prof[off + x])) {
          c++
          run++
          if (run > best) best = run
          if (lo < 0) lo = x
          hi = x
        } else run = 0
      }
      inkPerRow[y] = c
      spanPerRow[y] = lo < 0 ? 0 : (hi - lo + 1)
      loPerRow[y] = lo
      hiPerRow[y] = hi
      runPerRow[y] = best
    }

    // 「这一行有墨」判据（2026-11-06 第三次校准）：
    // ⚠️ 不能只看墨点数 ≥3：真卷的细坐标轴/细边线只有 **2px 宽**（徐汇一模 24 实测
    //    y 轴 1357/1358 两列），墨点数恰好 2 ⇒ 被当空白 ⇒ 分段在 y 轴处断开，
    //    y 轴箭头与字母 y 被切掉（负责人报障「图形被切」的一类）。
    // ⚠️ 也不能退回 ≥1：JPEG 噪点会在空白行残留 1~2 个散点，把文字与图之间填住切不开。
    // 现判据：墨点 ≥3，**或**存在 ≥2px 的连续墨迹（噪点几乎不连续，细线一定连续）。
    const hasInk = (y) => inkPerRow[y] >= 3 || runPerRow[y] >= 2

    // 分段：墨迹簇（空白 >=8px 断开；真卷行距实测 10~32px，8px 足以逐行切开）。
    // 「有墨」用 hasInk（见上，含 2px 细线放行）。
    const bands = []
    {
      let y = 0
      while (y < height) {
        while (y < height && !hasInk(y)) y++
        if (y >= height) break
        const top = y
        let bottom = y, gap = 0
        y++
        while (y < height) {
          if (hasInk(y)) { bottom = y; gap = 0 }
          else { gap++; if (gap >= 8) break }
          y++
        }
        bands.push({ top, bottom })
      }
    }
    if (!bands.length) return { band: null, hasFigure: false, reason: 'no-ink' }

    const bandMaxSpan = (b) => {
      let m = 0
      for (let y = b.top; y <= b.bottom; y++) if (spanPerRow[y] > m) m = spanPerRow[y]
      return m
    }
    const maxSpan = Math.max(1, ...bands.map(b => bandMaxSpan(b)))

    // 文字带判据（2026-11-03 按 13 张真实裁片校准）：**相对宽度**，不是绝对整幅比。
    // 真卷整页宽 2144px 时文字行只占 38%~70% 宽（页面左右有留白），图形占 12%~45%；
    // 旧判据「>=75% 整幅才算文字」会把文字全判成图形（嘉定 24 实测裹进两行小问文字）。
    // 现判据：高度 < 120px（单行文字/两三行合并）且 横向跨度 >= 本裁片最宽带的 50%。
    const isTextBand = (b) => {
      if ((b.bottom - b.top + 1) >= 120) return false
      return bandMaxSpan(b) >= maxSpan * 0.5
    }

    // 文字行高（向上合并时按它放宽间隙；单字母标注离图比这个近）
    const textHeights = bands.filter(isTextBand).map(b => b.bottom - b.top + 1).sort((a, b) => a - b)
    const textH = textHeights.length ? textHeights[Math.floor(textHeights.length / 2)] : 0
    const mergeGapUp = Math.max(12, Math.round(textH * 0.6))

    // 图形带 = 最高的「非文字带」（整片图形的高度远大于单行文字）
    let fig = null
    let figBandH = 0
    for (const b of bands) {
      if (isTextBand(b)) continue
      const h = b.bottom - b.top + 1
      if (h > figBandH) { fig = b; figBandH = h }
    }
    // 「有没有图」的最后一道闸：最高的一块非文字带至少 50px 高才算图形。
    // 低于这个量级只可能是短文字行、下划线、页码、或作图题里那条作为已知条件的线段
    // （嘉定一模 22(2) 的 EF 只有 3px 高 + 两个字母）。这类裁片一律判「无图」。
    if (!fig || figBandH < FIG_MIN_BAND_H) return { band: null, hasFigure: false, reason: 'no-figure-band' }
    // ↓ 到这里已确认裁片里有图：下面只决定「能不能把正文裁干净」，裁不干净不等于没图。
    sawFigure = true

    const bandRange = (b) => {
      let lo = width, hi = -1
      for (let y = b.top; y <= b.bottom; y++) {
        if (loPerRow[y] >= 0 && loPerRow[y] < lo) lo = loPerRow[y]
        if (hiPerRow[y] > hi) hi = hiPerRow[y]
      }
      return hi >= lo ? { lo, hi } : null
    }

    const figRange = bandRange(fig)
    // 「属于图」的横向判据：该带墨迹范围必须被图形范围包含（允许 1.5% 余量）。
    // 顶点字母 / 坐标轴箭头 / 图注都落在图幅正上方或正下方、横向不越界；
    // 而选项行（A. 甲和乙…）与章节标题（三、解答题）左缘起于页面文字栏，
    // 远在图幅左侧 ⇒ 判 false（徐汇 q1/q6、嘉定 q18 实测）。
    const padX = Math.max(8, Math.round(width * 0.015))
    const withinFigure = (br) => !!br && !!figRange &&
      br.lo >= figRange.lo - padX && br.hi <= figRange.hi + padX

    // 向下合并：被内部间隙切碎的图形子块 + 图形下方的顶点字母 / 图注。
    // ⚠️ 不能「遇到文字带就 break」：顶点字母（C/B/F）与「图1」「图2」图注的横向
    //    跨度常达到本裁片最宽带的 50%+，会被判成文字带 —— 一律 break 会把底部标注整条切掉。
    //    改用「横向包含」闸：图注一定在图幅正下方，而选项/正文行会明显超出图幅。
    let figBottomInk = fig.bottom
    for (const b of bands) {
      if (b.top <= fig.bottom) continue
      if (b.top - figBottomInk - 1 > 40) break
      if ((b.bottom - b.top + 1) >= 120) break
      if (!withinFigure(bandRange(b))) break
      figBottomInk = b.bottom
    }

    // 向上合并：图正上方的顶点字母 / 坐标轴箭头。
    // 必须在图上「紧贴」（间隙 ≤ mergeGapUp）：真卷顶点字母离图 8~20px，
    // 而正文行离图 25px 以上（嘉定 24「坐标.」、q4「可能是（ ）.」实测）。
    let figTopInk = fig.top
    const above = bands.filter(b => b.bottom < fig.top).sort((a, b) => b.bottom - a.bottom)
    for (const b of above) {
      if (figTopInk - b.bottom - 1 > mergeGapUp) break
      if ((b.bottom - b.top + 1) >= 120) break
      if (isTextBand(b)) break
      if (!withinFigure(bandRange(b))) break
      figTopInk = b.top
    }

    // 顶部留白：不得与上一带（文字）重叠
    let prevBottom = -1
    for (const b of bands) if (b.bottom < figTopInk) prevBottom = Math.max(prevBottom, b.bottom)
    const gapAbove = prevBottom >= 0 ? figTopInk - prevBottom - 1 : 8
    const topMargin = Math.min(4, Math.max(0, Math.floor(gapAbove / 2)))
    const figTop = Math.max(0, figTopInk - topMargin)
    const figBottom = Math.min(height, figBottomInk + 6)
    const figH = figBottom - figTop
    if (figH < FIG_MIN_BAND_H) return { band: null, hasFigure: true, reason: 'band-not-clean' }
    // 合并后仍不足裁片高的 25%：多图版式（杨浦 25(2) 的图 6~图 10 排成两行）会把
    // 上下段正文一起带进来 —— 裁不干净就不裁，交给调用方用整张裁片兜底。
    if (figH < height * 0.25) return { band: null, hasFigure: true, reason: 'band-not-clean' }

    // ── 横向裁紧（2026-11-03）──
    // 源裁片是「整页宽」的横条（实测 2144px 宽），而图形常常只占其中一小块，
    // 左右大片空白会同时造成两个观感问题（嘉定一模 23 题实测：图形仅占宽 12%）：
    //   ① 配图缩到 55% 页宽后，图形本身只剩约 15mm —— 显得「尺寸太小」；
    //   ② 图形被左侧空白推到横条中部 —— 看起来像「居中」，而不是靠左。
    // 这里按图形墨迹的水平范围裁到图形本身（两侧各留 1% 余量），
    // 使配图「图形占满图幅」：既靠左、又足够大。
    let inkLeft = width
    let inkRight = -1
    for (let y = figTop; y < figBottom; y++) {
      const off = y * width
      for (let x = 0; x < width; x++) {
        if (isInk(prof[off + x])) {
          if (x < inkLeft) inkLeft = x
          if (x > inkRight) inkRight = x
        }
      }
    }
    let cropLeft = 0
    let cropWidth = width
    if (inkRight >= inkLeft) {
      const padXCrop = Math.max(8, Math.round(width * 0.01))
      cropLeft = Math.max(0, inkLeft - padXCrop)
      cropWidth = Math.min(width, inkRight + padXCrop + 1) - cropLeft
    }
    // 极端情况（横向墨迹范围过小）退化为整幅宽，避免裁出细条
    if (cropWidth < 40) { cropLeft = 0; cropWidth = width }

    const band = await sharp(cropBuffer)
      .extract({ left: cropLeft, top: figTop, width: cropWidth, height: figBottom - figTop })
      .withMetadata({ icc: 'srgb' }) // 与裁片同源：输出不留无头 JPEG（下游 raw() 会报色彩空间未设）
      .jpeg({ quality: 92 }) // 与 cropQuestionImage 同口径；82 在 4x 细节上有可见块状伪影
      .toBuffer()
    return { band, hasFigure: true, reason: 'ok' }
  } catch (e) {
    console.warn('[paperFigureAssign] 图形带提取失败:', e.message)
    // 抛错前已经确认过有图 → 让调用方走整张兜底，而不是把整行的图丢掉
    return { band: null, hasFigure: sawFigure, reason: 'error' }
  }
}
