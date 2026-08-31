/**
 * 配图引用闸门：题干里根本没提到图，就不该重绘出一张图。
 *
 * 实测有一条已完成的重绘（题干「在△ABC和△DEF中，如果∠A=45°…」）全文没有「如图」，
 * 却画出了 6 点 6 段的图——视觉模型把题干文字当成了配图。这类幻觉图比画错更糟：
 * 学生会把凭空生成的形状当作题设条件。
 *
 * 数轴题单独拦：数轴不是几何示意图，用点线渲染器画出来是一条无意义的线段
 * （实测有一条数轴题被画成 2 点 1 线）。
 */

/** 明确的配图指代 */
const FIGURE_REF_RE = /如图|如下图|见图|图中|图\s*[0-9０-９]|图\s*[①-⑳]|示意图|图案|下图/

/**
 * 强几何情境词：这类题几乎必然带配图，但题干常不写「如图」
 * （或「如图」被 OCR 吞掉）。放宽到这些词是为了压低误杀。
 */
const FIGURE_CONTEXT_RE = /折叠|翻折|对折|旋转|作图|网格|方格|小正方形|坐标系|抛物线|函数图象|函数图像|展开图|三视图|扇形|圆锥|正方体|长方体|俯视图|主视图|左视图/

const NUMBER_LINE_RE = /数轴/

/**
 * 判断该题干是否支持重绘配图。
 * @returns {{ok: true} | {ok: false, reason: 'number_line'|'no_figure_reference'}}
 */
export function checkFigureReference(content) {
  const text = String(content || '')
  if (!text.trim()) return { ok: false, reason: 'no_figure_reference' }
  if (NUMBER_LINE_RE.test(text)) return { ok: false, reason: 'number_line' }
  if (FIGURE_REF_RE.test(text) || FIGURE_CONTEXT_RE.test(text)) return { ok: true }
  return { ok: false, reason: 'no_figure_reference' }
}

/** 便捷布尔形式 */
export const hasFigureReference = (content) => checkFigureReference(content).ok
