import { callVisionCompletion } from '../config/ai.js'

const buildAnswerOnlyPrompt = () => `你是一位数学老师。看到一张「标准答案」的图片（可能是教材、教辅、试卷上的印刷答案，也可能是手写答案）。

请独立解出这道题，并把答案和解析写下来。

严格返回合法 JSON（不要任何额外说明、不要 markdown 代码块、不要换行注释）：
{
  "answer": "最终答案，简洁，优先用 LaTeX/KaTeX 格式表达公式：\\frac{a}{b}、\\sqrt{x}、\\pm、\\cdot、x^2、x_1",
  "analysis": "解题过程（可选；图里没写解析可留空字符串）"
}

要求：
1. answer 是最终结果，不是方程也不是问句。
2. 分数/含根号的答案必须化到最简（如 \\frac{\\sqrt{2}}{2} 而非 \\frac{1}{\\sqrt{2}}）。
3. 区间/集合/单位写清楚（如 [0, +∞)、cm、m/s）。
4. 仅识别图里的题目+答案；不要添加图里没有的额外条件。
5. 如果图里只是答案不完整（比如只写了一个根号），按数学常识补全，但不要编造题目里没有的数值。`

const bufferToDataURL = (buffer, mimeType) => {
  const m = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg'
  return `data:${m};base64,${buffer.toString('base64')}`
}

const safeParseAnswer = (rawText) => {
  if (!rawText) throw new Error('模型返回为空')
  let text = rawText.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  try {
    const obj = JSON.parse(text)
    return {
      answer: typeof obj.answer === 'string' ? obj.answer.trim() : '',
      analysis: typeof obj.analysis === 'string' ? obj.analysis.trim() : '',
    }
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        const obj = JSON.parse(m[0])
        return {
          answer: typeof obj.answer === 'string' ? obj.answer.trim() : '',
          analysis: typeof obj.analysis === 'string' ? obj.analysis.trim() : '',
        }
      } catch { /* fall through */ }
    }
    return { answer: text, analysis: '' }
  }
}

export async function recognizeAnswerImage(imageBuffer, mimeType) {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error('图片为空')
  }
  const imageDataURL = bufferToDataURL(imageBuffer, mimeType)

  const { content } = await callVisionCompletion({
    imageDataURL,
    systemPrompt: buildAnswerOnlyPrompt(),
    userText: '请识别这张图片里的题目与参考答案，按 JSON 格式返回。',
    temperature: 0.2,
    maxTokens: 2048,
  })

  return safeParseAnswer(content)
}