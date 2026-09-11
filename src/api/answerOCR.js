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

// 上传一张「单题区域裁剪图」→ 后端视觉模型重识别 → 返回 {content, options, answer, analysis, question_type}，不写库。
// 用于 PC 批改工作台「重新识别本题」：整页 OCR 漏识别选择题选项（options 为空）时，
// 框选该题区域重新识别补全。与 recognizeAnswer 一致，只返回结果，由前端预览确认后再保存。
export const recognizeQuestion = async (questionId, file) => {
  const fd = new FormData()
  fd.append('image', file)
  const data = await apiRequest(`/questions/${questionId}/recognize-question`, {
    method: 'POST',
    body: fd,
    timeout: 180 * 1000
  }, 1)
  if (!data || data.ok === false) {
    throw new Error(data?.error || '识别失败')
  }
  return {
    content: data.content || '',
    options: Array.isArray(data.options) ? data.options : [],
    answer: data.answer || '',
    analysis: data.analysis || '',
    question_type: data.question_type || ''
  }
}