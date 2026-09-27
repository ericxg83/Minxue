/**
 * 数轴目测出口安全闸（2026-09-27）：防"清晰但缺标注"的半张数轴入库。
 *
 * 背景：数轴确定性通道（numberAxis/index.js）只认「题干写明数值」的数轴；
 * 而「字母点位置只在图里」的数轴（如实数 a、b 在数轴上对应的点）会落到
 * Vision DSL 目测通道。DSL 目测对数轴**没有字母/刻度齐全校验**，实测 fe7f2bc4
 * 把原图上的 a 和 √3 都丢了、只剩 0 和 b，仍照样入库 → 学生拿到一张无法解题的
 * 半张数轴（清晰但画错）。
 *
 * 本闸复用函数图象通道 visionAnnotate.verifyFunctionGraphByVision 的同一套范式：
 * 把「原图 ‖ 重画」并排给视觉模型做闭环确认，缺关键字母点或刻度数值即判 FIX。
 *
 * 纪律（只收紧不放宽 + 宁可少拦不误伤）：
 *   - 只有模型明确输出 VERDICT: FIX 才回退；
 *   - 判读不出结论 / 拼图失败 / 调用异常 → fail-open（放行，绝不因基础设施抖动误伤好图）。
 */

/** 纯判读：从模型返回文本解析结论。无法判读时放行（不误伤）。 */
export function parseAxisVerdict(text) {
  const t = String(text ?? '')
  if (/VERDICT\s*[:：]\s*FIX/i.test(t)) return { ok: false, reason: 'fix' }
  if (/VERDICT\s*[:：]\s*OK/i.test(t)) return { ok: true }
  return { ok: true, reason: 'unparsed' }
}

/** data URL → Buffer（与原图拼图用） */
function dataUrlToBuffer(u) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(u || ''))
  if (!m) return null
  try { return Buffer.from(m[2], 'base64') } catch { return null }
}

/** 默认拼图：光栅化重绘 SVG → 与原始裁片并排 → data URL（复用 DSL 渲染层，避免重复实现） */
async function defaultCompose({ originalImageDataUrl, renderSvg }) {
  const { rasterizeSvg, composeComparison, toDataUrl } = await import('../geom/dsl/render.js')
  const renderPng = renderSvg ? await rasterizeSvg(renderSvg) : null
  const originalBuf = dataUrlToBuffer(originalImageDataUrl)
  if (!originalBuf || !renderPng) return null
  const composite = await composeComparison(originalBuf, renderPng)
  return composite ? toDataUrl(composite) : null
}

const SYSTEM_PROMPT = `你是数学试卷数轴配图质检员。左边是学生试卷原图（真值），右边是程序重画的数轴。
请判断右边的数轴是否满足以下全部条件：
1. 数轴本身（一条直线 + 正方向箭头）与原图一致；
2. **原图上标注的每一个字母点**（如 a、b、A、B、C、D 等表示数的点），右边都必须有，且左右相对位置关系正确；
3. **原图上用于解题的刻度数值**（如 0、1、-2、√3、π 等），右边都要保留，不能整批丢失；
4. 没有凭空多出的字母或刻度。
只要右边**漏掉了原图上的任一关键字母点或刻度数值**，就输出 VERDICT: FIX；
全部齐全则输出 VERDICT: OK。只输出一行 VERDICT: OK 或 VERDICT: FIX，不要任何解释。`

/**
 * 数轴重绘闭环确认。
 * @param {string} originalImageDataUrl 原始裁片 data URL（真值）
 * @param {string} renderSvg 待入库的重绘 SVG
 * @param {string} content 题干（供模型参考应出现哪些字母）
 * @param {(a:{systemPrompt:string,userText:string,imageDataURL:string})=>Promise<string>} callVision 注入的视觉调用
 * @param {(a:{originalImageDataUrl:string,renderSvg:string})=>Promise<string|null>} [compose] 注入的拼图（测试用）
 * @returns {Promise<{ok:boolean,reason?:string}>}
 */
export async function verifyNumberAxisByVision({ originalImageDataUrl, renderSvg, content, callVision, compose }) {
  try {
    const compositeDataUrl = await (compose || defaultCompose)({ originalImageDataUrl, renderSvg })
    if (!compositeDataUrl) return { ok: true, reason: 'compose_failed' } // 基础设施失败不误伤
    const resp = await callVision({
      systemPrompt: SYSTEM_PROMPT,
      userText: `题目：${content || '(无题干)'}\n请对照左右两图给出结论。`,
      imageDataURL: compositeDataUrl,
    })
    return parseAxisVerdict(resp?.content ?? resp)
  } catch (e) {
    return { ok: true, reason: `error:${e?.message || e}` } // 调用异常不误伤
  }
}
