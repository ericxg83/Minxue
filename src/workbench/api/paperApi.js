import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000
})

// 获取待校对试卷列表
export const getPendingPapers = async () => {
  const response = await api.get('/papers/pending')
  return response.data
}

// 获取指定试卷的识别结果
export const getPaperResult = async (paperId) => {
  const response = await api.get(`/papers/${paperId}/result`)
  return response.data
}

// 更新题目内容
export const updateQuestion = async (paperId, questionId, data) => {
  const response = await api.put(`/papers/${paperId}/questions/${questionId}`, data)
  return response.data
}

// 确认入库
export const confirmPaper = async (paperId) => {
  const response = await api.post(`/papers/${paperId}/confirm`)
  return response.data
}

// 导出Word
export const exportPaperWord = async (paperId) => {
  const response = await api.post(`/papers/${paperId}/export`, {}, {
    responseType: 'blob'
  })
  return response.data
}
