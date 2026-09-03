import { useState, useEffect, useMemo, useCallback } from 'react'
import { useToast } from '../components/ToastProvider'
import {
  updateQuestion, addWrongQuestions, deleteWrongQuestion, updateWrongQuestionStatus,
  getQuestionsByTask, getWrongQuestionsByStudent, invalidateCache, recalculateTaskStats,
  updateTaskStatus, getResource
} from '../services/apiService'
import { getStatusInfo } from '../pages/ExamReview/status.jsx'
import { REVIEW_STATUS, getReviewState, WRONG_BOOK_LIFECYCLE } from '../utils/reviewDecision'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'

// 复审核心逻辑：题目数据加载、人工评判 edits 管理、保存
export function useExamReview({ task, onSave }) {
  const Toast = useToast()

  const [questions, setQuestions] = useState([])
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  // 错题记录要自己拉：全局 store 只在错题本页填充，从作业页直接进复核时它是空的，
  // 会让「改判后同步错题本」整段静默不执行（与 PC 端复核台同一做法）
  const [bankRecords, setBankRecords] = useState([])

  // ── 派生数据 ──
  const validQuestions = useMemo(() => questions.filter(Boolean), [questions])

  const wrongIdMap = useMemo(() => {
    const map = {}
    bankRecords.forEach(wq => {
      if (wq.question_id) map[wq.question_id] = wq.id
    })
    return map
  }, [bankRecords])

  // ── 错题本记录：复核页自己拉，不依赖错题本页的懒加载 ──
  useEffect(() => {
    if (!task?.student_id) return
    let cancelled = false
    getWrongQuestionsByStudent(task.student_id)
      .then(list => { if (!cancelled) setBankRecords(Array.isArray(list) ? list : []) })
      .catch(e => console.warn('[ExamReview] 错题本记录加载失败，改判后错题本同步将跳过:', e.message))
    return () => { cancelled = true }
  }, [task?.student_id])

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
            _ai_graded: q.status !== 'correct' || q._ai_graded === true
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
  // 判定结论写入 edits（review_status = 人工复核审计事实，两端同一字段）。
  // 再次点击同一判定 = 撤回本次结论，答案文本修改保留。
  const handleSetReviewAction = useCallback((action, qId) => {
    if (!qId) return
    const target = action === 'correct' ? REVIEW_STATUS.CORRECT
      : action === 'wrong' ? REVIEW_STATUS.WRONG
      : REVIEW_STATUS.EXCLUDE

    setEdits(prev => {
      const existing = prev[qId] || {}

      if (existing.review_status === target) {
        const { is_correct, review_status, ...rest } = existing
        return { ...prev, [qId]: rest }
      }

      // 排除：只落 review_status，不改 is_correct（与 PC 端一致）
      if (target === REVIEW_STATUS.EXCLUDE) {
        const { is_correct, ...rest } = existing
        return { ...prev, [qId]: { ...rest, review_status: target } }
      }

      return {
        ...prev,
        [qId]: {
          ...existing,
          is_correct: target === REVIEW_STATUS.CORRECT,
          review_status: target
        }
      }
    })
  }, [])

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
      return false
    }
    setSaving(true)
    let successCount = 0
    const skippedWrongBook = []
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
        if (edit.review_status !== undefined) updateData.review_status = edit.review_status
        if (edit.status) updateData.status = edit.status

        await updateQuestion(qId, updateData)
        successCount++

        // 错题本同步已统一移到后端 PUT /api/questions/:id 的 settle 流程（2026-09-01 修复）：
        // 改判时后端调 finalizeRejudgeResult，自动把 wrong_questions.status=mastered /
        // questions.status 翻对 / judgement 审计一次写齐。移动端原本在 line 161-173
        // 手写的 updateWrongQuestionStatus / addWrongQuestions 已删，避免双写不一致。
        // 唯一保留的是 exclude 路径的"删错题记录"——settle 流程不删 wrong_questions 行。
        const isExcludedEdit = edit.review_status === REVIEW_STATUS.EXCLUDE
        if (isExcludedEdit && wrongId) {
          await deleteWrongQuestion(wrongId).catch(e => console.warn(`[ExamReview] 移除错题失败 q=${qId.substring(0,8)}:`, e.message))
        } else if (edit.is_correct === false && !wrongId && !isExcludedEdit) {
          // 不完整的题不入错题本，否则会成为 PC 端按 is_complete 过滤后看不见的隐形错题。
          // 手机上无法补全题目元素，因此不阻断判定，只跳过入册并在保存后汇总告知。
          const { isComplete } = checkQuestionCompleteness({ ...(q || {}), ...edit })
          if (isComplete) {
            await addWrongQuestions(task.student_id, [qId]).catch(e => console.warn(`[ExamReview] 添加错题失败 q=${qId.substring(0,8)}:`, e.message))
          } else {
            skippedWrongBook.push(qId)
          }
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
      if (task?.student_id) {
        invalidateCache('generated', task.student_id)
        invalidateCache('questions', task.student_id)
        invalidateCache('tasks', task.student_id)
      }
      if (task?.id) {
        await recalculateTaskStats(task.id).catch(e => console.error('刷新统计数据失败:', e))
      }
      Toast.show({ message: `已保存 ${successCount} 题`, type: 'success' })
      if (skippedWrongBook.length > 0) {
        Toast.show({
          message: `${skippedWrongBook.length} 题因缺少参考答案等信息未加入错题本，请在电脑端补全`,
          duration: 4000
        })
      }
      if (onSave) onSave()
      return true
    } else {
      Toast.show({ message: '保存失败', type: 'error' })
      return false
    }
  }, [edits, wrongIdMap, questions, task, Toast, onSave])

  // ── 需老师处理的题数（与 PC 端 needsAttentionCount 同定义；本次已判的不计入） ──
  const needsAttentionCount = useMemo(() => {
    return validQuestions.filter(q => {
      const edit = edits[q.id]
      if (edit?.review_status) return false
      const state = getReviewState({ ...q, ...(edit || {}) })
      return state === 'pending' || state === 'exception' || state === 'processing'
    }).length
  }, [validQuestions, edits])

  // ── 完成复核：先落盘未保存修改，再把任务标记为已复核 ──
  // 与"保存"分开：保存过一题不等于整份作业复核完毕，否则这份作业会从 PC 端待复核列表消失
  const handleCompleteReview = useCallback(async () => {
    if (Object.keys(edits).length > 0) {
      const saved = await handleSaveClick()
      if (!saved) return false
    }
    if (!task?.id) return false
    // 首次复核（exam 任务 + resource 还是 draft）→ 弹"留底"确认，与 PC 端 ReviewTopBar 对齐。
    // 拿不到 resource 状态不阻断流程；非 exam 任务或 resource 已 published 直接走。
    if (task.task_type === 'exam' && task.resource_id) {
      try {
        const r = await getResource(task.resource_id)
        if (r?.status === 'draft' && !window.confirm('📌 这份试卷将作为答案库留底保存。\n\n完成后将自动发布到答案库，所有后续学生可复用此份答案。\n\n确认留底？')) {
          return false
        }
      } catch (e) {
        console.warn('[mobile-archive-confirm] 加载 resource 状态失败:', e?.message)
      }
    }
    setSaving(true)
    try {
      await updateTaskStatus(task.id, 'reviewed')
      Toast.show({ message: '已标记复核完成', type: 'success' })
      if (onSave) onSave()
      return true
    } catch (e) {
      console.error('更新任务复核状态失败:', e)
      Toast.show({ message: '标记复核完成失败', type: 'error' })
      return false
    } finally {
      setSaving(false)
    }
  }, [edits, handleSaveClick, task, Toast, onSave])

  // ── 各状态数量统计（含本次未保存的判定） ──
  const stats = useMemo(() => {
    const counts = { uncertain: 0, error: 0, ai_correct: 0, ai_wrong: 0, processing: 0, excluded: 0 }
    validQuestions.forEach(q => {
      const info = getStatusInfo({ ...q, ...(edits[q.id] || {}) })
      if (counts[info.source] !== undefined) counts[info.source]++
    })
    return counts
  }, [validQuestions, edits])

  return {
    questions, setQuestions,
    validQuestions,
    wrongIdMap,
    loading,
    edits, setEdits,
    saving,
    stats,
    needsAttentionCount,
    handleSetReviewAction,
    handleAnswerChange,
    handleAnswerEdit,
    handleSaveClick,
    handleCompleteReview
  }
}
