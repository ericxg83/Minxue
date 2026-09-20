/**
 * 配图引用闸门：题干里根本没提到图，就不该重绘出一张图。
 *
 * 实测有一条已完成的重绘（题干「在△ABC和△DEF中，如果∠A=45°…」）全文没有「如图」，
 * 却画出了 6 点 6 段的图——视觉模型把题干文字当成了配图。这类幻觉图比画错更糟：
 * 学生会把凭空生成的形状当作题设条件。
 *
 * 数轴题单独拦：数轴不是几何示意图，用点线渲染器画出来是一条无意义的线段
 * （实测有一条数轴题被画成 2 点 1 线）。
 *
 * 函数图象题同样拦：渲染器没有曲线能力，抛物线/双曲线/一次函数这类图必然画错，
 * 应走独立的函数图象渲染通道。实测 74 张待重画资产里 62 张是函数图象或数轴题，
 * 全部产出 0 成功——不拦就是持续制造假失败。
 */

/** 明确的配图指代 */
const FIGURE_REF_RE = /如图|如下图|见图|图中|图\s*[0-9０-９]|图\s*[①-⑳]|示意图|图案|下图/

/**
 * 强几何情境词：这类题几乎必然带配图，但题干常不写「如图」
 * （或「如图」被 OCR 吞掉）。放宽到这些词是为了压低误杀。
 *
 * 注意：`抛物线|函数图象|函数图像` 已从这里移出，改由 FUNCTION_GRAPH_RE 排除。
 * 原因是渲染器 renderGeometrySvg() 只能输出线段/圆/直角标记，没有曲线能力，
 * 放进来只会产出必然失败的假重绘（实测 74 张待重画资产里 44 张是函数图象题）。
 * 坐标系本身保留放行：画在坐标轴上的多边形是渲染器支持的能力。
 */
const FIGURE_CONTEXT_RE = /折叠|翻折|对折|旋转|作图|网格|方格|小正方形|坐标系|展开图|三视图|扇形|圆锥|正方体|长方体|俯视图|主视图|左视图/

const NUMBER_LINE_RE = /数轴/

/**
 * 函数图象 / 曲线：图形主体是一条曲线（抛物线、双曲线、一次函数…）。
 * 几何重画管线的点线渲染器画不出曲线，这类题不进几何重画队列。
 *
 * 2026-09-18 起它们改由 **函数图象独立渲染通道**处理
 * （`server/utils/functionGraph/`，纯文本解析 + 确定性采样，零视觉调用）。
 * 本闸门只负责把它们从几何队列里挑出来，具体能不能出图由那条通道自己判断。
 * 判据只看图形是不是曲线，与「坐标系里的多边形」区分开（后者仍然放行）。
 */
const FUNCTION_GRAPH_RE = /抛物线|双曲线|反比例函数|一次函数|二次函数|正比例函数|正弦|余弦|函数图象|函数图像|函数的图象|函数的图像/

/**
 * 闸门 reason → 落库 last_error 的可读文案。
 * worker.js 与 geometryWorker.js 共用同一份，避免两处文案漂移。
 */
export const FIGURE_GATE_MESSAGE = {
  number_line: '数轴题，点的位置关系只存在于图中，不适合程序化重绘，回退裁剪原图',
  function_graph: '函数图象题，无法从题干确定图形（开口方向或顶点位置不明，或题干另有三角形/辅助线），回退裁剪原图',
  no_figure_reference: '题干未引用配图，禁止重绘以免生成幻觉图'
}

/**
 * 判断该题干是否支持重绘配图。
 *
 * 多小问大题拆行落库后，「如图」只留在 parent_stem、子题 content 只有「(1)…」，
 * 所以判定文本必须是 parent_stem + content，不能只看 content（漏判会把该重画的题
 * 标成 none）。与 checkQuestionCompleteness() 规则1 同一口径。
 *
 * @param {string} content - 子题正文
 * @param {string} [parentStem] - 多小问大题的公共题干
 * @returns {{ok: true} | {ok: false, reason: 'number_line'|'function_graph'|'no_figure_reference'}}
 */
export function checkFigureReference(content, parentStem = '') {
  const text = [String(parentStem || ''), String(content || '')].join('\n')
  if (!text.trim()) return { ok: false, reason: 'no_figure_reference' }
  // 排除项先于放行项：这两类图渲染器画不出来，题干写没写「如图」都不该进重画。
  if (NUMBER_LINE_RE.test(text)) return { ok: false, reason: 'number_line' }
  if (FUNCTION_GRAPH_RE.test(text)) return { ok: false, reason: 'function_graph' }
  if (FIGURE_REF_RE.test(text) || FIGURE_CONTEXT_RE.test(text)) return { ok: true }
  return { ok: false, reason: 'no_figure_reference' }
}

/** 便捷布尔形式（同样支持 parent_stem 一起判定） */
export const hasFigureReference = (content, parentStem = '') => checkFigureReference(content, parentStem).ok
