import { apiRequest } from '../services/apiService.js'

// 上传一张「参考答案图」→ 后端视觉模型识别 → 返回 {answer, analysis}，不写库。
// 用于 PC 批改工作台「编辑参考答案」时一键 OCR，避免手敲 KaTeX 命令。
export const recognizeAnswer = async (questionId, file) => {
  const fd = new FormData()
  fd.append('image', file)
  const data = await apiRequest(`/questions/${questionId}/recognize-answer`, {
    method: 'POST',
    body: fd,
    timeout: 180 * 1000
  }, 1)
  if (!data || data.ok === false) {
    throw new Error(data?.error || '识别失败')
  }
  return { answer: data.answer || '', analysis: data.analysis || '' }
}