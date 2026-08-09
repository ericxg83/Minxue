import { useState, useEffect, useMemo, useCallback } from 'react'
import { useWrongQuestionStore } from '../store'
import { useToast } from '../components/ToastProvider'
import {
  updateQuestion, addWrongQuestions, deleteWrongQuestion,
  getQuestionsByTask, invalidateCache, recalculateTaskStats,
  updateTaskStatus
} from '../services/apiService'
import { getStatusInfo } from '../pages/ExamReview/status.jsx'

// 复审核心逻辑：题目数据加载、人工评判 edits 管理、保存
export function useExamReview({ task, onSave, currentIndexRef }) {
  const { wrongQuestions } = useWrongQuestionStore()
  const Toast = useToast()

  const [questions, setQuestions] = useState([])
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reviewAction, setReviewAction] = useState(null)

  // ── 派生数据 ──
  const validQuestions = useMemo(() => questions.filter(Boolean), [questions])

  const wrongIdMap = useMemo(() => {
    const map = {}
    ;(Array.isArray(wrongQuestions) ? wrongQuestions : []).forEach(wq => {
      if (wq.question_id) map[wq.question_id] = wq.id
    })
    return map
  }, [wrongQuestions])

  // ── 数据获取 ──
  useEffect(() => {
    if (!task?.id) return
    let cancelled = false
    const fetchQuestions = async () => {
      try {
        setLoading(true)
        const qs = await getQuestionsByTask(task.id, false)
        if (!cancelled) {
          setQuestions(qs.map(q => ({
            ...q,
            _ai_graded: q.status !== 'correct' || q._ai_graded === true,
            excluded: q.excluded || false
          })))
        }
      } catch (e) {
        console.error('获取题目失败:', e)
        if (!cancelled) {
          Toast.show({ message: '获取题目失败', type: 'error' })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchQuestions()
    return () => { cancelled = true }
  }, [task?.id])

  // ── 设置复审操作 ──
  const handleSetReviewAction = useCallback((action) => {
    const idx = currentIndexRef.current
    if (!validQuestions[idx]?.id) return
    const qId = validQuestions[idx].id

    setReviewAction(prev => prev === action ? null : action)

    setEdits(prev => {
      const existing = prev[qId] || {}
      let newEdit

      if (action === 'correct') {
        newEdit = { ...existing, is_correct: true, excluded: false }
      } else if (action === 'wrong') {
        newEdit = { ...existing, is_correct: false, excluded: false }
      } else if (action === 'excluded') {
        newEdit = { ...existing, excluded: true }
      }

      if (!newEdit) {
        const { is_correct, excluded, ...rest } = existing
        return { ...prev, [qId]: rest }
      }

      return { ...prev, [qId]: newEdit }
    })
  }, [validQuestions, currentIndexRef])

  // ── 答案变更 ──
  const handleAnswerChange = useCallback((qId, value) => {
    const q = questions.find(x => x.id === qId)
    const wasBlank = q && (q.answer_source === 'blank')
    setEdits(prev => ({
      ...prev,
      [qId]: {
        ...(prev[qId] || {}),
        student_answer: value,
        ...(wasBlank && value ? { answer_source: 'manual' } : {})
      }
    }))
  }, [questions])

  // ── 参考答案变更 ──
  const handleAnswerEdit = useCallback((qId, value) => {
    setEdits(prev => ({
      ...prev,
      [qId]: { ...(prev[qId] || {}), answer: value }
    }))
  }, [])

  // ── 保存 ──
  const handleSaveClick = useCallback(async () => {
    const dirtyIds = Object.keys(edits)
    if (dirtyIds.length === 0) {
      Toast.show({ message: '没有需要保存的修改', type: 'info' })
      return
    }
    setSaving(true)
    let successCount = 0
    for (const qId of dirtyIds) {
      try {
        const edit = edits[qId]
        const q = questions.find(x => x.id === qId)
        const wrongId = wrongIdMap[qId]

        // 构建更新数据
        const updateData = {
          student_answer: edit.student_answer,
          answer: edit.answer
        }
        if (edit.is_correct !== undefined) updateData.is_correct = edit.is_correct
        if (edit.excluded !== undefined) updateData.excluded = edit.excluded
        if (edit.status) updateData.status = edit.status

        await updateQuestion(qId, updateData)
        successCount++

        // 错题本操作
        if (edit.excluded && wrongId) {
          await deleteWrongQuestion(wrongId).catch(e => console.warn(`[ExamReview] 删除错题失败 q=${qId.substring(0,8)}:`, e.message))
        } else if (edit.is_correct === true && wrongId) {
          await deleteWrongQuestion(wrongId).catch(e => console.warn(`[ExamReview] 删除错题失败 q=${qId.substring(0,8)}:`, e.message))
        } else if (edit.is_correct === false && !wrongId && !edit.excluded) {
          await addWrongQuestions(task.student_id, [qId]).catch(e => console.warn(`[ExamReview] 添加错题失败 q=${qId.substring(0,8)}:`, e.message))
        }
      } catch (e) {
        console.error('保存失败:', qId, e)
      }
    }
    setSaving(false)
    if (successCount > 0) {
      setQuestions(prev => prev.map(q => {
        const edit = edits[q.id]
        if (!edit) return q
        return { ...q, ...edit, _ai_graded: true }
      }))
      setEdits({})
      setReviewAction(null)
      if (task?.student_id) {
        invalidateCache('generated', task.student_id)
        invalidateCache('questions', task.student_id)
        invalidateCache('tasks', task.student_id)
      }
      if (task?.id) {
        await recalculateTaskStats(task.id).catch(e => console.error('刷新统计数据失败:', e))
        // 复核完成后标记任务为已复核
        await updateTaskStatus(task.id, 'reviewed').catch(e => console.error('更新任务复核状态失败:', e))
      }
      Toast.show({ message: `已保存 ${successCount} 题`, type: 'success' })
      if (onSave) onSave()
    } else {
      Toast.show({ message: '保存失败', type: 'error' })
    }
  }, [edits, wrongIdMap, questions, task, Toast, onSave])

  // ── 各状态数量统计 ──
  const stats = useMemo(() => {
    const counts = { uncertain: 0, error: 0, ai_correct: 0, ai_wrong: 0, processing: 0, excluded: 0 }
    validQuestions.forEach(q => {
      const info = getStatusInfo(q)
      if (counts[info.source] !== undefined) counts[info.source]++
    })
    return counts
  }, [validQuestions])

  return {
    questions, setQuestions,
    validQuestions,
    wrongIdMap,
    loading,
    edits, setEdits,
    saving,
    reviewAction, setReviewAction,
    stats,
    handleSetReviewAction,
    handleAnswerChange,
    handleAnswerEdit,
    handleSaveClick
  }
}
