import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 120000
})

export const getExamResources = () =>
  api.get('/resources', { params: { type: 'exam' } }).then(r => r.data.resources || [])

export const createExamResource = (data) =>
  api.post('/resources', { ...data, type: 'exam' }).then(r => r.data.resource)

export const deleteExamResource = (id) =>
  api.delete(`/resources/${id}`).then(r => r.data)

export const getExamAnswers = (id) =>
  api.get(`/resources/${id}/answers`).then(r => r.data.answers || [])

export const updateExamAnswerStatus = (id, answerStatus) =>
  api.patch(`/resources/${id}/answers/status`, { answerStatus }).then(r => r.data)

export const updateExamResource = (id, data) =>
  api.put(`/resources/${id}`, data).then(r => r.data.resource)

export const saveTaskAsAnswerKey = (taskId, data) =>
  api.post(`/tasks/${taskId}/save-as-answer-key`, data).then(r => r.data.resource)