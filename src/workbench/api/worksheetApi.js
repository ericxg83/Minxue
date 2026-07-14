import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 120000
})

export const getWorkbooks = () =>
  api.get('/worksheets').then(r => r.data.worksheets || [])

export const createWorkbook = (data) =>
  api.post('/worksheets', data).then(r => r.data.worksheet)

export const deleteWorkbook = (id) =>
  api.delete(`/worksheets/${id}`).then(r => r.data)

export const updateWorkbookStatus = (id, status) =>
  api.put(`/worksheets/${id}/status`, { status }).then(r => r.data.worksheet)

export const uploadPdf = (id, file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/worksheets/${id}/parse-pdf`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress
  }).then(r => r.data)
}

export const getWorkbookAnswers = (id) =>
  api.get(`/worksheets/${id}/answers`).then(r => r.data.answers || [])

export const updateWorkbookAnswer = (id, answerId, data) =>
  api.put(`/worksheets/${id}/answers/${answerId}`, data).then(r => r.data.answer)