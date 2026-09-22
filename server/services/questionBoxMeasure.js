/**
 * 题目定位框「实测量」服务（2026-09-20）。
 *
 * ── 为什么必须有这一步 ──
 * 主 OCR（buildOCRPrompt）里的 block_coordinates / text_bbox **不是量出来的**。
 * 实测（server/_probe_bbox_prompt_ab.mjs / _probe_bbox_realprompt.mjs /
 * _probe_bbox_realprompt2.mjs，同一张第 1 页原图）：
 *   · 真实长 OCR prompt            → 8 题 y=126,276,426,…（等差恒 150，height 全 150，x 全 78）
 *   · 把「必须实际测量」提到 prompt 最前 → 仍然 8 题 y=128,246,364,…（等差恒 118，照抄 schema 示例平铺整页）
 * 也就是说：重 prompt 下模型把坐标字段当样板填，**怎么写都量不准**。
 * 只有把它拆成一次「只为量框」的短调用才准（同图实测：8 题落点与真实题界一致）。
 *
 * 因此本模块独立成一次轻量视觉调用：输入页图 + 该页题目清单，
 * 输出每题的纵向区间（题号行上沿 → 下一题题号行上沿），即把整页内容区**按题切段**。
 * 让模型给「切段边界」而不是「外接矩形」，是因为它擅长判断「下一题从哪一行开始」，
 * 而外接矩形需要它同时估左右与上下四个量，实测更容易糊。
 *
 * ── 并排题（2026-09-20 补充）──
 * 「按题切段」隐含一个前提：题目自上而下**互不重叠**。但真卷里有左右并排的题
 * （实测第 3 页：17、18 两道解答题并排在同一行，左边一题右边一题）。
 * 要求"段与段首尾相接、互不重叠"时，模型只能把其中一道挤到下一行去 ——
 * 结果那道题的框画到了【下一道题】身上（实测 q18 的框落在 q19 的正文区）。
 * 所以 prompt 里显式允许并排题共用同一纵向带（区间相等/重叠）。
 *
 * 为什么不进一步把共用的带左右切开：实测该带的纵向墨迹剖面**没有干净的空沟**
 * （左边一题的公式行几乎顶到右边一题的题号），任何自动切分都可能把一道题拦腰截断；
 * 而"框稍大、包含邻题"只是不够精确，"框把本題切掉一半/指到别的题"才是真错误。
 * 按项目既有判据「宁可不出图，也不显示邻题的图」，这里取**保守的全宽带**。
 *
 * 坐标系与全仓一致：归一化 0-1000（x 相对图宽，y 相对图高）。
 */

import sharp from 'sharp'
import { analyzePageLayout } from './pageLayout.js'

/** 送模型前降采样：量框只需要版面结构，不需要看清字，压到 1000px 省 token */
const MEASURE_WIDTH = Number(process.env.BBOX_MEASURE_WIDTH) || 1000

export const MEASURE_PROMPT = `你是版面切段器。图中是一页作业/试卷的照片（含手写笔迹、批改痕迹、装订阴影）。
页面正文被分成若干道题，题目自上而下排列。

请给出每一道题的【纵向区间】，输出 0-1000 归一化整数 y 坐标（相对整张图片高度，原点在左上角）。

规则：
- 某题的 y_top = 该题【题号所在那一行】文字的上沿；
- 某题的 y_bottom = 【下一题题号所在那一行】的上沿；最后一题的 y_bottom = 正文内容结束处（不含页码页脚）。
- 页眉标题、"一、选择题"这类栏目名、页码页脚，都不属于任何一段。

【并排题：必须共用同一纵向带】
如果两道题是【左右并排】的（题号在同一行、一左一右，各自往下展开），
那么这两题的 y_top 与 y_bottom 必须【完全相同】—— 允许不同题的纵向区间相等或重叠。
绝对不要为了"让每段互不重叠"而把其中一道并排的题挤到下一行去：
那样会让它的框画到【下一道题】身上，比"框大一点"严重得多。

【最关键的一条：边界必须落在空白带上】
你给出的每一个 y 值，都是要用来在图上画一条横向分隔线的。
把这条线画上去时，它【不允许压到任何一个字】—— 必须正好落在两行文字之间的空白缝隙里。
如果某个 y 值画出来的线从某一行文字中间穿过，那它就是错的，必须往上或往下挪到最近的空白处。
输出前请逐段自查这一条。

【硬禁止】
- 不得按题数把整页平均分配（例如 8 道题就每段 125 高、间距恒定）；
- 不得所有题共用同一个高度；
- 不得套用整页框（0~1000）。
必须是在图上逐题看出来的真实位置。

只输出 JSON，不要任何解释：
{"segments":[{"no":1,"y_top":0,"y_bottom":0}]}`

/** 纵向区间允许的逆序容差（模型给的整数会有几格抖动；同一道题的相邻小问偶发标反） */
const ORDER_TOLERANCE = 40

/**
 * 退化输出闸门（纯函数，便于回归测试）。
 *
 * 允许「并排题共用同一纵向带」（这是放宽 prompt 的目的，区间可以相等/重叠），
 * 但不允许另外四种退化：
 *   ① 段数与题目数不符（模型少给/多给）；
 *   ② 题号 no 不连续（[2026-09-20 泛化] 实测 14 题页模型返回「缺 no:2、两个 no:13」，
 *      段数恰好凑对、内容却错乱 —— 此时 sorted[i] 与题目清单无法对齐，必须整页作废）；
 *   ③ 坐标非数值 / 模型给出的区间越出页面（如 y_bottom=1420，由组装层剔除）；
 *   ④ 纵向整体乱序（第 i+1 题排到第 i 题上面去了；容差 40 放过「相邻小题互换」，
 *      拦下「模型整体错乱」—— 错乱时差值通常数百）；
 *   ⑤ 所有题共用一个带（= 整页占位框，正是主 OCR 那种失效模式）。
 *
 * @param {Array<{no:any,y_top:any}>} segs 模型返回的 segments
 * @param {number} expected 该页题目数
 * @returns {{ok:true, sorted:Array}|{ok:false, error:string}}
 */
export function validateMeasureSegments (segs, expected) {
  if (!Array.isArray(segs) || segs.length === 0) return { ok: false, error: '返回不可解析' }
  if (segs.length !== expected) {
    return { ok: false, error: `段数不符：期望 ${expected} 实得 ${segs.length}` }
  }
  // ── ② 题号必须连续（1..N 或 0..N-1，允许整体偏移）──
  // 段数与题数相等但 no 重复/缺失 → 无法把段映射回题目 → 整页作废
  const nos = segs.map(s => Number(s.no))
  if (nos.some(n => !Number.isFinite(n))) return { ok: false, error: '题号非数值' }
  const sortedNos = [...nos].sort((a, b) => a - b)
  const base = sortedNos[0]
  for (let i = 1; i < sortedNos.length; i++) {
    if (sortedNos[i] !== base + i) {
      return { ok: false, error: `题号不连续（缺/重）：期望 ${base}..${base + expected - 1}，实得含 ${sortedNos[i]}` }
    }
  }
  const sorted = [...segs].sort((a, b) => Number(a.no) - Number(b.no))
  const tops = sorted.map(s => Number(s.y_top))
  if (tops.some(t => !Number.isFinite(t))) return { ok: false, error: '坐标非数值' }
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] < tops[i - 1] - ORDER_TOLERANCE) {
      return { ok: false, error: `纵向区间乱序：第 ${i + 1} 题 y_top=${tops[i]} 高于第 ${i} 题 y_top=${tops[i - 1]}` }
    }
  }
  if (expected >= 3 && new Set(tops.map(t => Math.round(t / 8))).size === 1) {
    return { ok: false, error: '所有题共用同一纵向带（疑似整页占位）' }
  }
  return { ok: true, sorted }
}

/**
 * 调一次视觉模型，量出该页各题的纵向区段。
 * @param {Object} p
 * @param {Buffer} p.imageBuffer 页图
 * @param {Array<{id:string, question_number:number|string, sub_no?:string, content?:string}>} p.questions
 * @param {string} [p.onlyVendor] 只走指定视觉通道（失败即失败）
 * @param {boolean} [p.freeOnly] 只走免费视觉通道（写入侧补测用，不碰付费 key）—— 见
 *        config/ai.js 的 FREE_VL_CHANNELS；魔搭耗尽时最多回退到 SenseNova/ZenMux 免费档
 * @param {boolean} [p.noBackup] 禁止弱免费备份供应商（SenseNova/ZenMux 等），仅魔搭 + 强模型白名单
 * @param {boolean} [p.strongBackupOnly] 配合 noBackup：魔搭耗尽时只允许降级到 STRONG_VL_FALLBACK_VENDORS
 *        （HuihuiyunGemini 付费高质量），跳过免费弱模型。代价：免费通道失败时改走付费 gemini（按 token 计费）。
 *        用于「蓝色画框」追求定位精度、且接受失败路径付费的场景（2026-09-22）。
 * @param {Array}  [p.vendorChain] 显式供应商链（2026-09-22 魔搭失守后推荐用法，最高优先级）：
 *        形如 [{vendor:'SenseNova', model:'deepseek-flash'}, ...]，按序只试链内通道。
 *        生产调用方（index.js / worker.js 的复核页画框）已改传 WORKBOOK_OCR_VENDOR_CHAIN
 *        （deepseek-flash 主 1.7-2.1s + qwen3.8-flash 兜），替代原 noBackup+strongBackupOnly
 *        （魔搭欠费禁用后后者只会落 gemini-3.7-flash，绕开了矩阵评测的场景三赢家）。
 * @returns {Promise<{boxes: Object<string,{x,y,width,height}>, raw: Object|null, error?: string}>}
 */
export async function measurePageQuestionBoxes ({ imageBuffer, questions, onlyVendor = null, textLeft = 60, textRight = 960, freeOnly = false, noBackup = false, strongBackupOnly = false, vendorChain = null }) {
  const list = (questions || []).filter(q => q && q.id)
  if (!list.length) return { boxes: {}, raw: null, error: '无题目' }

  const jpeg = await sharp(imageBuffer).resize({ width: MEASURE_WIDTH, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
  const imageDataURL = 'data:image/jpeg;base64,' + jpeg.toString('base64')

  const hint = list.map((q, i) => `${i + 1}. 题号 ${q.question_number ?? '?'}${q.sub_no ? '(' + q.sub_no + ')' : ''}：${String(q.content || '').replace(/\s+/g, ' ').slice(0, 18)}`).join('\n')
  const userText = `本题共 ${list.length} 道题，自上而下依次是：\n${hint}\n\n请按这个顺序输出 ${list.length} 个纵向区段。`

  const callOnce = async () => {
    const { callVisionCompletion } = await import('../config/ai.js')
    let content
    try {
      const r = await callVisionCompletion({
        imageDataURL,
        systemPrompt: MEASURE_PROMPT,
        userText,
        temperature: 0.1,
        maxTokens: 2048,
        ...(onlyVendor ? { onlyVendor } : {}),
        ...(freeOnly ? { freeOnly: true } : {}),
        ...(noBackup ? { noBackup: true } : {}),
        ...(strongBackupOnly ? { strongBackupOnly: true } : {}),
        ...(vendorChain ? { vendorChain } : {}),
      })
      content = r.content
    } catch (e) {
      return { error: String(e?.message || e).slice(0, 200) }
    }
    let obj = content
    if (typeof obj === 'string') {
      const m = obj.match(/\{[\s\S]*\}/)
      try { obj = m ? JSON.parse(m[0]) : null } catch { obj = null }
    }
    return { obj, rawText: typeof content === 'string' ? content.slice(0, 400) : '' }
  }

  // [2026-09-20 泛化] 模型对 11+ 题的页面输出不稳定 —— 实测同一页两次调用，
  // 一次「返回不可解析」、一次完全正常。因此**失败重试一次**（两次封顶，防接口无限翻倍）。
  // 重试失败的原始文本保留在 rawText 里，便于线上归因。
  let lastErr = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await callOnce()
    if (r.error) { lastErr = r.error; continue }
    const { obj, rawText } = r
    const segs = obj?.segments
    if (!Array.isArray(segs) || segs.length === 0) {
      lastErr = '返回不可解析' + (rawText ? `：${rawText.replace(/\s+/g, ' ').slice(0, 120)}` : '')
      continue
    }

    // ── 退化输出闸门（纯函数，回归测试 test/questionBoxMeasure.test.mjs 锁定）──
    const gate = validateMeasureSegments(segs, list.length)
    if (!gate.ok) { lastErr = gate.error; continue }
    const sorted = gate.sorted

  // ── 吸附用的行段：必须用【未合并】的原始行段，不能用 bands ──
    // [2026-09-20 修复] analyzePageLayout 的 bands 做过「相邻行带合并」：行距紧的版面
    // 会把好几行文字粘成一条大带（实测卷1第1页 68..129 含 3 行、卷2第2页 638..750 含 7 行，
    // 因为行间距 5~6px 小于合并阈值）。拿这种大带的边缘吸附 = 把边界拽到几十个坐标之外。
    // [2026-09-20 泛化修复] rawBands 同样会混进【大块墨迹带】（图形/整段手写/整页表格线/
    // 阴影被误判成墨）：实测 aa5edadd 第1页存在覆盖 120..732、300..1000 的带，
    // 把模型给出的**正确**边界全部拽坏 —— 6 个 y_top 被吸到 120、3 个被吸到 1000，
    // 而模型原始区间（146..208..259..317..370..426..582 单调相接）本身完全合理。
    // 模型原值留着，比被拽坏强。
    // [2026-09-20 泛化-修正] 上限取 2.5×lineHeight 太紧 —— 卷2第2页行距极密
    // （lineHeight=15），一条正常的「底部三行粘连带」(657..702, 高45) 被滤掉，
    // 模型边界 685 落在带内却无带可吸 → 压字。上限放宽到 max(6×lineHeight, 120)
    // 只排除「整页级背景大带」（aa5edadd 的 120..1000 高 880 仍会被滤），
    // 中等带（≤ 6 行文字）留作吸附锚点；幅度上限 maxSnap 单独兜底。
    let bands = []
    let maxSnap = 40
    try {
      const layout = await analyzePageLayout(imageBuffer, { workWidth: 400 })
      const rawB = layout.rawBands?.length ? layout.rawBands : (layout.bands || [])
      const lineH = Math.max(8, layout.lineHeight || 12)
      const maxBandH = Math.max(Math.round(lineH * 6), 120)
      bands = rawB.filter(b => (b.bottom - b.top) <= maxBandH)
      // 兜底上限：正常一行高约 1 个 lineHeight，留 3 行余量防病态输入
      maxSnap = Math.round(lineH * 3)
    } catch { /* 版面分析失败就不吸附，不影响主流程 */ }

    const snapToGap = (y) => {
      if (!bands.length) return y
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i]
        if (y > b.top && y < b.bottom) {
          // 落在某一行文字内部 → 推到更近的那条边（空白缝）
          const cand = (y - b.top) <= (b.bottom - y) ? b.top : b.bottom
          return Math.abs(cand - y) <= maxSnap ? cand : y
        }
      }
      return y
    }

    // ── 组装 + 局部剔除 ──
    // [2026-09-20 泛化] 模型偶尔给个别题越出页面的坐标（如 y_bottom=1420，常见于
    // 页面底部的大题）或几乎零高的区间。**逐条剔除**这些段对应的题（前端对该题不画框），
    // 其余题照常出框 —— 比「整页作废、一个框都不出」强。
    // 但坏段超过半数 → 模型整体没看懂版面 → 整页作废。
    const boxes = {}
    let bad = 0
    let badDetail = []
    for (let i = 0; i < list.length; i++) {
      const seg = sorted[i]
      const rawTop = Number(seg.y_top)
      const rawBottom = Number(seg.y_bottom)
      if (!Number.isFinite(rawTop) || !Number.isFinite(rawBottom)) { bad++; badDetail.push(`${i + 1}:坐标非数值`); continue }
      // 模型编造越出页面 / 区间不足一行 → 这条不要
      if (rawTop < -10 || rawTop > 1010 || rawBottom < -10 || rawBottom > 1010 || (rawBottom - rawTop) < 12) {
        bad++; badDetail.push(`${i + 1}:[${rawTop}..${rawBottom}]`); continue
      }
      let top = clamp(snapToGap(rawTop))
      let bottom = clamp(snapToGap(rawBottom))
      // [2026-09-20 泛化-修复] 吸附把 top/bottom **独立**推格，可能各自吸到相邻两条带的
      // 边缘导致区间塌缩。实测 q21 原始 688..716（完全合理）被吸成 702..704（高 2）。
      // ⇒ 吸附不得让区间塌到 < 原高 60%；退化就用模型原值（模型原区间是本条的唯一可信输入）。
      const rawH = rawBottom - rawTop
      if (bottom - top < Math.max(12, rawH * 0.6)) {
        top = clamp(rawTop)
        bottom = clamp(rawBottom)
      }
      if (bottom - top < 12) { bad++; badDetail.push(`${i + 1}:区间退化${top}..${bottom}`); continue }
      boxes[list[i].id] = {
        x: clamp(textLeft), y: top,
        width: clamp(textRight) - clamp(textLeft), height: bottom - top,
      }
    }
    if (bad > 0) badDetail = badDetail.slice(0, 5).join(', ')
    if (bad > 0 && (list.length - bad) / list.length < 0.5) {
      lastErr = `模型有效段不足一半（${list.length - bad}/${list.length}）：${badDetail}`
      continue
    }
    if (bad > 0) console.warn(`[questionBoxMeasure] ${list.length} 题剔除 ${bad} 条退化段（${badDetail}），其余 ${list.length - bad} 条正常出框`)
    return { boxes, raw: obj }
  }

  // 两次尝试都失败
  return { boxes: {}, raw: null, rawText: lastErr, error: lastErr || '两次视觉调用均失败' }
}

const clamp = (v) => Math.max(0, Math.min(1000, Number.isFinite(v) ? v : 0))
