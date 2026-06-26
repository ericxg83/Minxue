import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000
})

// 添加请求重试拦截器（Workbench 优化）
api.interceptors.response.use(
  response => response,
  async error => {
    const config = error.config

    // 如果没有重试配置，初始化
    if (!config.__retryCount) {
      config.__retryCount = 0
    }

    // 最多重试 3 次
    if (config.__retryCount >= 3) {
      return Promise.reject(error)
    }

    // 只对网络错误或 5xx 服务器错误重试
    const shouldRetry =
      !error.response ||
      (error.response.status >= 500 && error.response.status < 600)

    if (!shouldRetry) {
      return Promise.reject(error)
    }

    config.__retryCount++

    // 指数退避：1s, 2s, 4s
    const delay = Math.pow(2, config.__retryCount - 1) * 1000
    await new Promise(resolve => setTimeout(resolve, delay))

    console.warn(`请求重试 ${config.__retryCount}/3: ${config.url}`)

    return api(config)
  }
)

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
