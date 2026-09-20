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

/**
 * 调一次视觉模型，量出该页各题的纵向区段。
 * @param {Object} p
 * @param {Buffer} p.imageBuffer 页图
 * @param {Array<{id:string, question_number:number|string, sub_no?:string, content?:string}>} p.questions
 * @param {string} [p.onlyVendor] 只走指定视觉通道（失败即失败）
 * @returns {Promise<{boxes: Object<string,{x,y,width,height}>, raw: Object|null, error?: string}>}
 */
export async function measurePageQuestionBoxes ({ imageBuffer, questions, onlyVendor = null, textLeft = 60, textRight = 960 }) {
  const list = (questions || []).filter(q => q && q.id)
  if (!list.length) return { boxes: {}, raw: null, error: '无题目' }

  const jpeg = await sharp(imageBuffer).resize({ width: MEASURE_WIDTH, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
  const imageDataURL = 'data:image/jpeg;base64,' + jpeg.toString('base64')

  const hint = list.map((q, i) => `${i + 1}. 题号 ${q.question_number ?? '?'}${q.sub_no ? '(' + q.sub_no + ')' : ''}：${String(q.content || '').replace(/\s+/g, ' ').slice(0, 18)}`).join('\n')
  const userText = `本题共 ${list.length} 道题，自上而下依次是：\n${hint}\n\n请按这个顺序输出 ${list.length} 个纵向区段。`

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
    })
    content = r.content
  } catch (e) {
    return { boxes: {}, raw: null, error: String(e?.message || e).slice(0, 200) }
  }

  let obj = content
  if (typeof obj === 'string') {
    const m = obj.match(/\{[\s\S]*\}/)
    try { obj = m ? JSON.parse(m[0]) : null } catch { obj = null }
  }
  const segs = obj?.segments
  if (!Array.isArray(segs) || segs.length === 0) {
    return { boxes: {}, raw: obj, error: '返回不可解析' }
  }

  // ── 按顺序把 segments 贴到题目上（模型可能少给/多给，用序号对齐，长度不符即判不可信） ──
  if (segs.length !== list.length) {
    return { boxes: {}, raw: obj, error: `段数不符：期望 ${list.length} 实得 ${segs.length}` }
  }
  const sorted = [...segs].sort((a, b) => Number(a.no) - Number(b.no))

  // ── 退化输出闸门 ──
  // 允许并排题共用同一带（这是本次放宽的目的），但不允许另外两种退化：
  //   ① 整体乱序（第 i+1 题排到第 i 题上面去了）；
  //   ② 所有题共用一个带（= 整页占位框，就是主 OCR 那种失效模式）。
  const tops = sorted.map(s => Number(s.y_top))
  if (tops.some(t => !Number.isFinite(t))) return { boxes: {}, raw: obj, error: '坐标非数值' }
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] < tops[i - 1] - 8) {
      return { boxes: {}, raw: obj, error: `纵向区间乱序：第 ${i + 1} 题 y_top=${tops[i]} 高于第 ${i} 题 y_top=${tops[i - 1]}` }
    }
  }
  if (list.length >= 3 && new Set(tops.map(t => Math.round(t / 8))).size === 1) {
    return { boxes: {}, raw: obj, error: '所有题共用同一纵向带（疑似整页占位）' }
  }

  // ── 边界加固：把每条边界吸附到「行间空白」 ──
  // 模型给的边界会有半行~一行的抖动，直接画会出现"边框从某行文字中间穿过"的观感。
  // 用页图量出的文本行带，把边界推到最近的空白带内（位移 ≤ 半行），
  // 这样框的上/下边永远落在字与字之间的空白处。
  let bands = []
  try {
    const layout = await analyzePageLayout(imageBuffer, { workWidth: 400 })
    bands = layout.bands || []
  } catch { /* 版面分析失败就不吸附，不影响主流程 */ }

  const snapToGap = (y) => {
    if (!bands.length) return y
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i]
      if (y > b.top && y < b.bottom) {
        // 落在某一行内部 → 推到更近的那条边
        return (y - b.top) <= (b.bottom - y) ? b.top : b.bottom
      }
    }
    return y
  }

  const boxes = {}
  for (let i = 0; i < list.length; i++) {
    const rawTop = Math.round(Number(sorted[i].y_top))
    let bottom = clamp(Math.round(Number(sorted[i].y_bottom)))
    if (!Number.isFinite(rawTop) || !Number.isFinite(bottom)) return { boxes: {}, raw: obj, error: '坐标非数值' }
    const top = clamp(snapToGap(rawTop))
    bottom = clamp(snapToGap(bottom))
    if (bottom <= top) bottom = Math.min(1000, top + 20)
    boxes[list[i].id] = {
      x: clamp(textLeft), y: top,
      width: clamp(textRight) - clamp(textLeft), height: bottom - top,
    }
  }
  return { boxes, raw: obj }
}

const clamp = (v) => Math.max(0, Math.min(1000, Number.isFinite(v) ? v : 0))
