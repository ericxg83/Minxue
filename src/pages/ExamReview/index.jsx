import { useState, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Save, Loader2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { useWrongQuestionStore } from '../../store'
import { useToast } from '../../components/ToastProvider'
import { updateQuestion, addWrongQuestions, deleteWrongQuestion, getQuestionsByTask } from '../../services/apiService'
import MathText from '../../components/MathText'

const COLORS = {
  primary: '#2563EB',
  success: '#16A34A',
  danger: '#EF4444',
  warning: '#F59E0B',
  background: '#F5F7FA',
  card: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  border: '#E5E7EB'
}

export default function ExamReview({ task, onClose }) {
  const { wrongQuestions } = useWrongQuestionStore()
  const Toast = useToast()

  const [questions, setQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAnswer, setShowAnswer] = useState(true)

  // Build question_id → wrongQuestion.id map for syncing wrong question book
  const wrongIdMap = useMemo(() => {
    const map = {}
    ;(Array.isArray(wrongQuestions) ? wrongQuestions : []).forEach(wq => {
      if (wq.question_id) map[wq.question_id] = wq.id
    })
    return map
  }, [wrongQuestions])

  // Fetch questions on mount
  useEffect(() => {
    if (!task?.id) return
    const fetchQuestions = async () => {
      try {
        setLoading(true)
        const qs = await getQuestionsByTask(task.id, false)
        setQuestions(qs)
      } catch (e) {
        console.error('获取题目失败:', e)
        Toast.show({ message: '获取题目失败', type: 'error' })
      } finally {
        setLoading(false)
      }
    }
    fetchQuestions()
  }, [task?.id])

  const getCorrectness = (qId) => {
    if (edits[qId] !== undefined && edits[qId].is_correct !== undefined) return edits[qId].is_correct
    const q = questions.find(x => x.id === qId)
    return q ? q.is_correct : null
  }

  const getStudentAnswer = (qId) => {
    if (edits[qId] !== undefined && edits[qId].student_answer !== undefined) return edits[qId].student_answer
    const q = questions.find(x => x.id === qId)
    return q ? (q.student_answer || '') : ''
  }

  const getAnswerStatus = (q) => {
    // Use effective correctness (edits take priority)
    const effectiveCorrectness = getCorrectness(q.id)
    const answerSource = q.answer_source || 'recognized'
    // If the teacher manually filled in an answer, treat as recognized
    const effectiveSource = answerSource
    if (effectiveSource === 'blank') return 'not_answered'
    if (effectiveCorrectness === null) return 'pending'
    return effectiveCorrectness ? 'correct' : 'wrong'
  }

  const getAiDisplayAnswer = (q) => {
    const aiAnswer = q.ai_answer || ''
    if (!aiAnswer) return null
    const currentDisplay = getStudentAnswer(q.id)
    if (aiAnswer === currentDisplay) return null
    return aiAnswer
  }

  const handleToggleCorrect = (qId, value) => {
    setEdits(prev => ({
      ...prev,
      [qId]: { ...(prev[qId] || {}), is_correct: value }
    }))
  }

  const handleAnswerChange = (qId, value) => {
    const q = questions.find(x => x.id === qId)
    const wasBlank = q && (q.answer_source === 'blank')
    setEdits(prev => ({
      ...prev,
      [qId]: {
        ...(prev[qId] || {}),
        student_answer: value,
        // When teacher fills in an answer for a blank question, mark as manual
        ...(wasBlank && value ? { answer_source: 'manual' } : {})
      }
    }))
  }

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }

  const handleNext = () => {
    if (currentIndex < questions.length - 1) setCurrentIndex(currentIndex + 1)
  }

  const handleJumpTo = (index) => {
    setCurrentIndex(index)
  }

  const handleSave = async () => {
    const dirtyIds = Object.keys(edits)
    if (dirtyIds.length === 0) {
      Toast.show({ message: '没有需要保存的修改', type: 'info' })
      return
    }
    setSaving(true)
    let successCount = 0
    for (const qId of dirtyIds) {
      try {
        await updateQuestion(qId, edits[qId])
        successCount++
        // Sync wrong question book after saving
        const edit = edits[qId]
        const wrongId = wrongIdMap[qId]
        if (edit.is_correct === false && !wrongId) {
          // Marked wrong but not in wrong question book — add it
          await addWrongQuestions(task.student_id, [qId]).catch(() => {})
        } else if (edit.is_correct === true && wrongId) {
          // Marked correct but still in wrong question book — remove it
          await deleteWrongQuestion(wrongId).catch(() => {})
        }
      } catch (e) {
        console.error('保存失败:', qId, e)
      }
    }
    setSaving(false)
    if (successCount > 0) {
      // Update local questions state to reflect saved edits
      setQuestions(prev => prev.map(q => {
        const edit = edits[q.id]
        if (!edit) return q
        return { ...q, ...edit }
      }))
      setEdits({})
      Toast.show({ message: `已保存 ${successCount} 题`, type: 'success' })
    } else {
      Toast.show({ message: '保存失败', type: 'error' })
    }
  }

  const handleSubmit = async () => {
    await handleSave()
    onClose()
  }

  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: COLORS.card,
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
      }}>
        <Loader2 size={32} style={{ color: COLORS.primary }} className="animate-spin" />
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: COLORS.card,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ fontSize: '16px', color: COLORS.textSecondary }}>暂无题目数据</div>
        <button onClick={onClose} style={{
          padding: '12px 24px', background: COLORS.primary, color: '#fff',
          borderRadius: '12px', fontSize: '15px', fontWeight: 600,
          border: 'none', cursor: 'pointer'
        }}>返回</button>
      </div>
    )
  }

  const currentQuestion = questions[currentIndex]
  const correctness = getCorrectness(currentQuestion.id)
  const currentStudentAnswer = getStudentAnswer(currentQuestion.id)
  const answerStatus = getAnswerStatus(currentQuestion)
  const aiDisplayAnswer = getAiDisplayAnswer(currentQuestion)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: COLORS.background,
      zIndex: 10000, display: 'flex', flexDirection: 'column'
    }}>
      {/* ── Header ── */}
      <div style={{
        background: COLORS.card, padding: '12px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px',
          color: COLORS.primary, fontSize: '14px', fontWeight: 500, padding: '4px 0'
        }}>
          <ArrowLeft size={18} /> 返回
        </button>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: COLORS.text }}>复审试卷</h2>
        <div style={{ fontSize: '14px', color: COLORS.textSecondary }}>
          {currentIndex + 1}/{questions.length}
        </div>
      </div>

      {/* ── Question Index Bar ── */}
      <div style={{
        background: COLORS.card, padding: '10px 16px',
        borderBottom: `1px solid ${COLORS.border}`,
        overflowX: 'auto', flexShrink: 0
      }}>
        <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
          {questions.map((q, i) => {
            const qCorrect = getCorrectness(q.id)
            let bg = COLORS.warning
            if (qCorrect === true) bg = COLORS.success
            else if (qCorrect === false) bg = COLORS.danger
            if (i === currentIndex) bg = COLORS.primary
            return (
              <button
                key={q.id}
                onClick={() => handleJumpTo(i)}
                style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: bg, color: '#fff', border: 'none',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'transform 0.15s',
                  transform: i === currentIndex ? 'scale(1.15)' : 'scale(1)'
                }}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Question Card Area ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        <motion.div
          key={currentQuestion.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.15 }}
        >
            {/* Question Card */}
            <div style={{
              background: COLORS.card, borderRadius: '12px', padding: '16px',
              marginBottom: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: '12px'
              }}>
                <div>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>
                    第 {currentIndex + 1} 题
                  </span>
                  <span style={{ fontSize: '12px', color: COLORS.textSecondary }}>
                    {currentQuestion.question_type === 'choice' ? '选择题' :
                     currentQuestion.question_type === 'fill' ? '填空题' : '解答题'}
                  </span>
                </div>
                <div style={{
                  fontSize: '12px', padding: '3px 10px', borderRadius: '10px',
                  display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                  ...(answerStatus === 'correct' ? { background: '#DCFCE7', color: COLORS.success } :
                      answerStatus === 'wrong' ? { background: '#FEE2E2', color: COLORS.danger } :
                      answerStatus === 'not_answered' ? { background: '#FEF3C7', color: COLORS.warning } :
                      { background: '#FEF3C7', color: COLORS.warning })
                }}>
                  {answerStatus === 'correct' ? <CheckCircle2 size={12} /> :
                   answerStatus === 'wrong' ? <XCircle size={12} /> :
                   <AlertTriangle size={12} />}
                  {answerStatus === 'correct' ? '回答正确' :
                   answerStatus === 'wrong' ? '回答错误' :
                   answerStatus === 'not_answered' ? '未作答' : '待批'}
                </div>
              </div>

              <div style={{
                fontSize: '15px', color: COLORS.text,
                lineHeight: '1.7', marginBottom: '16px', whiteSpace: 'pre-wrap'
              }}>
                <MathText content={currentQuestion.content} />
              </div>

              {currentQuestion.image_url && (
                <div style={{ marginBottom: '16px', textAlign: 'center' }}>
                  <img
                    src={currentQuestion.image_url}
                    alt="题目配图"
                    style={{
                      maxWidth: '100%', width: '100%',
                      maxHeight: '300px', objectFit: 'contain',
                      borderRadius: '8px', background: COLORS.background
                    }}
                  />
                </div>
              )}

              {currentQuestion.options && currentQuestion.options.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  {currentQuestion.options.map((opt, i) => (
                    <div key={i} style={{
                      fontSize: '14px', color: COLORS.text,
                      padding: '8px 12px', background: COLORS.background, borderRadius: '8px'
                    }}>
                      {String.fromCharCode(65 + i)}. <MathText content={opt} />
                    </div>
                  ))}
                </div>
              )}

              {/* AI recognition result — shown when AI saw something different from displayed student answer */}
              {aiDisplayAnswer && (
                <div style={{
                  border: '1.5px dashed #93C5FD', borderRadius: '8px', padding: '10px 12px',
                  marginBottom: '12px', background: '#EFF6FF'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#3B82F6', marginBottom: '4px' }}>
                    🤖 AI识别结果（仅供参考）
                  </div>
                  <div style={{ fontSize: '14px', color: COLORS.text, lineHeight: '1.5' }}>
                    <MathText content={aiDisplayAnswer} />
                  </div>
                  <div style={{ fontSize: '11px', color: '#93C5FD', marginTop: '6px' }}>
                    此内容为AI从试卷图片中识别到的文字，可能与实际学生答案不同
                  </div>
                </div>
              )}

              {/* Answer comparison — student answer + reference answer side by side */}
              <div style={{
                background: COLORS.background, borderRadius: '8px', padding: '12px',
                marginBottom: '12px'
              }}>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '4px' }}>学生答案</div>
                    <input
                      type="text"
                      value={currentStudentAnswer || ''}
                      onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                      placeholder={answerStatus === 'not_answered' ? '未作答 — 如需补填请在此输入' : '输入学生答案...'}
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: '6px',
                        border: `1px solid ${answerStatus === 'not_answered' ? COLORS.warning : COLORS.border}`,
                        fontSize: '14px', color: COLORS.text, outline: 'none',
                        boxSizing: 'border-box', background: COLORS.card
                      }}
                    />
                    {/* KaTeX preview banner — visible when student answer contains LaTeX */}
                    {(currentStudentAnswer || '').includes('\\') && (
                      <div style={{
                        marginTop: '6px', padding: '6px 8px', borderRadius: '6px',
                        background: '#F9FAFB', border: '1px dashed #D1D5DB',
                        fontSize: '14px', minHeight: '20px'
                      }}>
                        <MathText content={currentStudentAnswer} />
                      </div>
                    )}
                    {answerStatus === 'not_answered' && (
                      <div style={{ fontSize: '11px', color: COLORS.warning, marginTop: '4px' }}>
                        &#9888; 未识别到学生笔迹，请人工补填答案
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '4px' }}>参考答案</div>
                    <div style={{
                      padding: '8px 10px', borderRadius: '6px',
                      border: `1px solid ${COLORS.border}`,
                      fontSize: '14px', color: currentQuestion.answer ? COLORS.text : '#9CA3AF',
                      background: COLORS.card, minHeight: '36px',
                      display: 'flex', alignItems: 'center',
                      fontStyle: currentQuestion.answer ? 'normal' : 'italic',
                      wordBreak: 'break-all'
                    }}>
                      {currentQuestion.answer ? <MathText content={currentQuestion.answer} /> : '待人工补充'}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '12px', color: COLORS.textSecondary, marginBottom: '6px' }}>人工评判</div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                      onClick={() => handleToggleCorrect(currentQuestion.id, true)}
                      style={{
                        flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        background: correctness === true ? '#DCFCE7' : COLORS.card,
                        color: correctness === true ? COLORS.success : COLORS.textSecondary,
                        outline: correctness === true ? '2px solid #16A34A50' : `1px solid ${COLORS.border}`
                      }}
                    >
                      <CheckCircle2 size={16} />
                      正确
                    </button>
                    <button
                      onClick={() => handleToggleCorrect(currentQuestion.id, false)}
                      style={{
                        flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        background: correctness === false ? '#FEE2E2' : COLORS.card,
                        color: correctness === false ? COLORS.danger : COLORS.textSecondary,
                        outline: correctness === false ? '2px solid #EF444450' : `1px solid ${COLORS.border}`
                      }}
                    >
                      <XCircle size={16} />
                      错误
                    </button>
                    <button
                      onClick={() => handleToggleCorrect(currentQuestion.id, null)}
                      style={{
                        flex: '0 0 auto', padding: '10px 14px', borderRadius: '8px', border: 'none',
                        cursor: 'pointer', fontSize: '14px', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        background: correctness === null ? '#FEF3C7' : COLORS.card,
                        color: correctness === null ? COLORS.warning : COLORS.textSecondary,
                        outline: correctness === null ? '2px solid #F59E0B50' : `1px solid ${COLORS.border}`
                      }}
                    >
                      <AlertTriangle size={16} />
                      待定
                    </button>
                  </div>
                </div>
              </div>

              {/* Collapsible analysis section */}
              <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: '12px' }}>
                <button
                  onClick={() => setShowAnswer(!showAnswer)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: '13px', color: COLORS.textSecondary, padding: 0, width: '100%'
                  }}
                >
                  {showAnswer ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <span style={{ fontWeight: 500 }}>解析</span>
                </button>
                {showAnswer && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ padding: '10px 12px', background: `${COLORS.success}08`, borderRadius: '8px' }}>
                      <div style={{ fontSize: '13px', color: COLORS.text, lineHeight: '1.6' }}><MathText content={currentQuestion.analysis || '暂无解析'} /></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
      </div>

      {/* ── Bottom Action Bar ── */}
      <div style={{
        background: COLORS.card, padding: '12px 16px',
        borderTop: `1px solid ${COLORS.border}`,
        display: 'flex', gap: '10px', flexShrink: 0
      }}>
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          style={{
            flex: 1, padding: '10px', borderRadius: '8px',
            border: `1px solid ${COLORS.border}`,
            background: COLORS.card, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
            fontSize: '14px', color: currentIndex === 0 ? '#CCC' : COLORS.textSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
          }}
        >
          <ChevronLeft size={16} /> 上一题
        </button>
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(edits).length === 0}
          style={{
            padding: '10px 20px', borderRadius: '8px', border: 'none',
            background: (saving || Object.keys(edits).length === 0) ? '#93C5FD' : COLORS.primary,
            color: '#fff', cursor: (saving || Object.keys(edits).length === 0) ? 'not-allowed' : 'pointer',
            fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
            flexShrink: 0
          }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          保存
        </button>
        <button
          onClick={handleNext}
          disabled={currentIndex >= questions.length - 1}
          style={{
            flex: 1, padding: '10px', borderRadius: '8px',
            border: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            cursor: currentIndex >= questions.length - 1 ? 'not-allowed' : 'pointer',
            fontSize: '14px', color: currentIndex >= questions.length - 1 ? '#CCC' : COLORS.textSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
          }}
        >
          下一题 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
