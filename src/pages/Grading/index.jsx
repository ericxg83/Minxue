import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, Loader2, QrCode, Eye, EyeOff, CircleCheckBig } from 'lucide-react'
import { getQuestionsByIds, gradeGeneratedExam, batchUpsertWrongQuestionStatus, markGeneratedExamGraded } from '../../services/apiService'
import { useStudentStore } from '../../store'
import dayjs from 'dayjs'

const isOptionWithLetterPrefix = (opt) => {
  if (!opt) return false
  const trimmed = String(opt).trim()
  return /^[A-Da-d][.、)\)]\s/.test(trimmed)
}

const formatOption = (opt, index) => {
  if (isOptionWithLetterPrefix(opt)) return opt
  return `${String.fromCharCode(65 + index)}. ${opt}`
}

// 掌握度生命周期映射
const LIFECYCLE_LABELS = {
  new: '不懂',
  review_1: '略懂',
  review_2: '完全懂',
  mastered: '已掌握'
}

const LIFECYCLE_ORDER = ['new', 'review_1', 'review_2', 'mastered']

const getNextLifecycle = (current) => {
  switch (current) {
    case 'new': return 'review_1'
    case 'review_1': return 'review_2'
    case 'review_2': return 'mastered'
    default: return 'review_1'
  }
}

const COLORS = {
  primary: '#3B82F6',
  success: '#2D9D6E',
  danger: '#E55353',
  warning: '#E8A838',
  background: '#F5F4F1',
  card: '#FFFFFF',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  border: '#E8E5E0'
}

export default function Grading({ paperId, studentId, questionIds, onClose, onComplete, generatedExamId }) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questions, setQuestions] = useState([])
  const [gradingResults, setGradingResults] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)

  const { students } = useStudentStore()

  const loadQuestions = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const targetStudentId = studentId || (students[0]?.id)
      const student = students.find(s => s.id === targetStudentId) || students[0]

      if (!questionIds || questionIds.length === 0) {
        setError('二维码中未包含题目信息')
        setIsLoading(false)
        return
      }

      const fetchedQuestions = await getQuestionsByIds(questionIds, targetStudentId)
      if (!fetchedQuestions || fetchedQuestions.length === 0) {
        setError('未找到相关题目，请确认试卷是否有效')
        setIsLoading(false)
        return
      }

      // 保存当前掌握度状态
      setQuestions(fetchedQuestions.map((q, index) => ({
        ...q,
        _index: index,
        lifecycle_status: q.lifecycle_status || 'new',
        error_count: q.error_count || 0
      })))

      setIsLoading(false)
    } catch (err) {
      console.error('加载题目失败:', err)
      setError('加载题目失败: ' + err.message)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadQuestions()
  }, [])

  // 标记为掌握/未掌握
  const handleMarkStatus = (isCorrect) => {
    const q = questions[currentQuestionIndex]
    if (!q) return

    const currentLifecycle = gradingResults[q.id]?.newLifecycle || q.lifecycle_status || 'new'
    const newLifecycle = isCorrect ? getNextLifecycle(currentLifecycle) : 'new'

    const newResults = {
      ...gradingResults,
      [q.id]: { isCorrect, previousLifecycle: currentLifecycle, newLifecycle }
    }
    setGradingResults(newResults)

    // 本地暂存防丢失
    try {
      localStorage.setItem(`grading_temp_${studentId}`, JSON.stringify(newResults))
    } catch (e) {}

    if (currentQuestionIndex < questions.length - 1) {
      setTimeout(() => setCurrentQuestionIndex(currentQuestionIndex + 1), 300)
    } else {
      setTimeout(() => setShowResult(true), 300)
    }
  }

  const handlePrev = () => {
    if (currentQuestionIndex > 0) setCurrentQuestionIndex(currentQuestionIndex - 1)
  }

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) setCurrentQuestionIndex(currentQuestionIndex + 1)
  }

  // 统计汇总
  const calcStats = () => {
    const results = Object.values(gradingResults)
    let mastered = 0
    let upgradedToReview1 = 0
    let upgradedToMastered = 0
    let reset = 0

    for (const r of results) {
      if (r.isCorrect && r.previousLifecycle === 'new' && r.newLifecycle === 'review_1') upgradedToReview1++
      if (r.isCorrect && r.previousLifecycle === 'review_1' && r.newLifecycle === 'review_2') upgradedToMastered++
      if (r.isCorrect && r.previousLifecycle === 'review_2' && r.newLifecycle === 'mastered') upgradedToMastered++
      if (r.newLifecycle === 'mastered') mastered++
      if (!r.isCorrect) reset++
    }
    return { mastered, upgradedToReview1, upgradedToMastered, reset }
  }

  const handleComplete = async () => {
    setIsSaving(true)
    try {
      const resultsArray = Object.entries(gradingResults).map(([questionId, result]) => ({
        questionId,
        isCorrect: result.isCorrect
      }))

      if (resultsArray.length === 0) {
        onClose()
        return
      }

      if (generatedExamId) {
        // 新流程：使用 gradeGeneratedExam API（服务端处理掌握度进阶）
        await gradeGeneratedExam(generatedExamId, studentId, resultsArray)
      } else {
        // 旧流程：兼容无 generatedExamId 的二维码
        const legacyResults = resultsArray.map(r => ({
          questionId: r.questionId,
          status: r.isCorrect ? 'mastered' : 'pending',
          isCorrect: r.isCorrect
        }))
        await batchUpsertWrongQuestionStatus(studentId, legacyResults)
        if (generatedExamId) {
          await markGeneratedExamGraded(generatedExamId)
        }
      }

      try { localStorage.removeItem(`grading_temp_${studentId}`) } catch (e) {}

      const stats = calcStats()
      onComplete && onComplete({
        masteredCount: stats.mastered,
        notMasteredCount: stats.reset,
        totalQuestions: questions.length,
        results: gradingResults,
        ...stats
      })

      onClose()
    } catch (err) {
      console.error('保存批改结果失败:', err)
      setError(`保存失败: ${err.message}，请稍后重试`)
      setIsSaving(false)
    }
  }

  // ── Loading State ──
  if (isLoading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: COLORS.card,
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
      }}>
        <Loader2 size={32} style={{ color: COLORS.primary }} className="animate-spin" />
      </div>
    )
  }

  // ── Error State ──
  if (error) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: COLORS.card,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, flexDirection: 'column', gap: '16px'
      }}>
        <QrCode size={48} style={{ color: COLORS.danger }} />
        <div style={{ fontSize: '16px', color: COLORS.danger, textAlign: 'center', padding: '0 20px' }}>{error}</div>
        <button onClick={onClose} style={{
          padding: '12px 24px', background: COLORS.primary, color: '#fff',
          borderRadius: '12px', fontSize: '15px', fontWeight: 600, border: 'none', cursor: 'pointer'
        }}>返回</button>
      </div>
    )
  }

  // ── Empty State ──
  if (questions.length === 0) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: COLORS.card,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, flexDirection: 'column', gap: '16px'
      }}>
        <QrCode size={48} style={{ color: COLORS.textSecondary }} />
        <div style={{ fontSize: '16px', color: COLORS.textSecondary }}>暂无题目，请重新扫码</div>
        <button onClick={onClose} style={{
          padding: '12px 24px', background: COLORS.primary, color: '#fff',
          borderRadius: '12px', fontSize: '15px', fontWeight: 600, border: 'none', cursor: 'pointer'
        }}>返回</button>
      </div>
    )
  }

  const currentQuestion = questions[currentQuestionIndex]
  const gradedCount = Object.keys(gradingResults).length
  const currentResult = gradingResults[currentQuestion?.id]
  const progress = questions.length > 0 ? (gradedCount / questions.length) * 100 : 0
  const isShortOptions = currentQuestion?.options && currentQuestion.options.every(opt => opt.length <= 10)

  // ── Result Screen ──
  if (showResult) {
    const stats = calcStats()
    const masteredCount = stats.mastered
    const notMasteredCount = stats.reset
    const total = questions.length

    return (
      <div style={{
        position: 'fixed', inset: 0, background: COLORS.card,
        zIndex: 10000, overflow: 'auto'
      }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ padding: '48px 20px 20px' }}>
          {/* Header Icon */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: `linear-gradient(135deg, ${COLORS.success}, ${COLORS.success}dd)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px'
            }}>
              <CircleCheckBig size={40} color="#fff" strokeWidth={2.5} />
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: COLORS.text, marginBottom: '4px' }}>
              批改完成！
            </div>
            <div style={{ fontSize: '13px', color: COLORS.textSecondary }}>
              本次共批改 {total} 道题
            </div>
          </div>

          {/* Overview Stats */}
          <div className="card" style={{ padding: '16px', marginBottom: '12px', borderRadius: '12px', border: `1px solid ${COLORS.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '16px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: COLORS.success }}>{masteredCount}</div>
                <div style={{ fontSize: '12px', color: COLORS.textSecondary, marginTop: '2px' }}>已掌握</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: COLORS.danger }}>{notMasteredCount}</div>
                <div style={{ fontSize: '12px', color: COLORS.textSecondary, marginTop: '2px' }}>待复习</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: COLORS.primary }}>{total}</div>
                <div style={{ fontSize: '12px', color: COLORS.textSecondary, marginTop: '2px' }}>总计</div>
              </div>
            </div>
          </div>

          {/* Detailed Mastery Progression */}
          <div className="card" style={{ padding: '16px', marginBottom: '16px', borderRadius: '12px', border: `1px solid ${COLORS.border}` }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.text, marginBottom: '12px' }}>
              掌握度进阶详情
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: '#FFEBEE', color: COLORS.danger }}>不懂</span>
                  <span style={{ fontSize: '13px', color: COLORS.textSecondary }}>→ 略懂</span>
                </div>
                <span style={{ fontSize: '15px', fontWeight: 700, color: COLORS.primary }}>{stats.upgradedToReview1}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: '#FFF8E1', color: COLORS.warning }}>略懂</span>
                  <span style={{ fontSize: '13px', color: COLORS.textSecondary }}>→ 完全懂</span>
                </div>
                <span style={{ fontSize: '15px', fontWeight: 700, color: COLORS.primary }}>{stats.upgradedToMastered}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${COLORS.border}`, paddingTop: '10px' }}>
                <span style={{ fontSize: '13px', color: COLORS.textSecondary }}>仍未掌握（重置为不懂）</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: COLORS.danger }}>{stats.reset}</span>
              </div>
            </div>
          </div>

          {/* Student Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '13px', padding: '0 4px' }}>
            <span style={{ color: COLORS.textSecondary }}>掌握率</span>
            <span style={{ color: COLORS.success, fontWeight: 600 }}>
              {total > 0 ? Math.round(masteredCount / total * 100) : 0}%
            </span>
          </div>

          <button onClick={handleComplete} style={{
            width: '100%', padding: '12px', background: COLORS.primary, color: '#fff',
            borderRadius: '8px', fontSize: '14px', fontWeight: 600, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            opacity: isSaving ? 0.6 : 1
          }} disabled={isSaving}>
            {isSaving ? (
              <><Loader2 size={16} className="animate-spin" /> 正在保存...</>
            ) : '完成并返回'}
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: COLORS.background,
      zIndex: 10000, display: 'flex', flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        background: COLORS.card, padding: '12px 20px', paddingTop: '48px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0
      }}>
        <button onClick={onClose} style={{
          fontSize: '15px', color: COLORS.primary, background: 'none',
          border: 'none', cursor: 'pointer', fontWeight: 500
        }}>退出</button>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: COLORS.text }}>批改</h2>
        <div style={{ fontSize: '15px', color: COLORS.textSecondary }}>
          {currentQuestionIndex + 1}/{questions.length}
        </div>
      </div>

      {/* Mastery Lifecycle Bar */}
      <div style={{
        background: COLORS.card, padding: '10px 20px',
        borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>掌握度：</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {LIFECYCLE_ORDER.slice(0, 3).map((step, idx) => {
              const currentLifecycle = currentResult?.newLifecycle || currentQuestion?.lifecycle_status || 'new'
              const isActive = LIFECYCLE_ORDER.indexOf(currentLifecycle) >= LIFECYCLE_ORDER.indexOf(step)
              return (
                <span key={step} style={{
                  fontSize: '12px', padding: '2px 8px', borderRadius: '4px',
                  background: isActive ? 'var(--primary-soft)' : 'var(--bg)',
                  color: isActive ? COLORS.primary : 'var(--text-tertiary)',
                  fontWeight: isActive ? 500 : 400,
                  transition: 'all 0.3s'
                }}>
                  {LIFECYCLE_LABELS[step]}
                </span>
              )
            })}
          </div>
          {currentQuestion?.error_count > 0 && (
            <span style={{
              fontSize: '11px', padding: '1px 8px', borderRadius: '10px',
              background: '#FFEBEE', color: COLORS.danger, marginLeft: 'auto'
            }}>
              错 {currentQuestion.error_count} 次
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar & Dots */}
      <div style={{
        background: COLORS.card, padding: '8px 20px',
        borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>进度 {gradedCount}/{questions.length}</span>
          <div style={{ flex: 1, height: '3px', background: `${COLORS.primary}20`, borderRadius: '2px', overflow: 'hidden' }}>
            <motion.div
              style={{ height: '100%', background: COLORS.primary, borderRadius: '2px' }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {questions.map((q, idx) => {
            const res = gradingResults[q.id]
            let dotColor = '#E4E7ED' // pending
            if (res) dotColor = res.isCorrect ? COLORS.success : COLORS.danger
            const isActive = idx === currentQuestionIndex
            return (
              <span key={q.id} onClick={() => setCurrentQuestionIndex(idx)} style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: dotColor, cursor: 'pointer', flexShrink: 0,
                border: isActive ? `2px solid ${COLORS.primary}` : '2px solid transparent',
                transform: isActive ? 'scale(1.3)' : 'none',
                transition: 'all 0.2s', display: 'inline-block'
              }} />
            )
          })}
        </div>
      </div>

      {/* Question Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {/* Question Card */}
        <div style={{
          background: COLORS.card, borderRadius: '16px', padding: '20px',
          marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <span style={{ fontSize: '15px', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>
                第 {currentQuestionIndex + 1} 题
              </span>
              <span style={{ fontSize: '13px', color: COLORS.textSecondary }}>
                {currentQuestion?.question_type === 'choice' ? '选择题' :
                 currentQuestion?.question_type === 'fill' ? '填空题' :
                 currentQuestion?.question_type === 'judge' ? '判断题' : '解答题'}
              </span>
              {currentQuestion?.subject && (
                <span style={{ fontSize: '12px', color: COLORS.textSecondary, marginLeft: '8px' }}>
                  · {currentQuestion.subject}
                </span>
              )}
            </div>
          </div>

          <div style={{ fontSize: '15px', color: COLORS.text, lineHeight: '1.6', marginBottom: '16px', whiteSpace: 'pre-wrap' }}>
            {currentQuestion?.content}
          </div>

          {currentQuestion?.image_url && (
            <div style={{ marginBottom: '16px', textAlign: 'center' }}>
              <img src={currentQuestion.image_url} alt="题目配图" style={{
                width: '100%', maxHeight: '300px', objectFit: 'contain',
                borderRadius: '8px', background: COLORS.background
              }} />
            </div>
          )}

          {currentQuestion?.options && currentQuestion.options.length > 0 && (
            <div style={{
              display: 'flex', flexDirection: isShortOptions ? 'row' : 'column',
              gap: isShortOptions ? '24px' : '8px', marginBottom: '16px', flexWrap: 'wrap'
            }}>
              {currentQuestion.options.map((opt, i) => (
                <div key={i} style={{ fontSize: '14px', color: COLORS.text }}>
                  {formatOption(opt, i)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Answer Card */}
        <div style={{
          background: COLORS.card, borderRadius: '16px', overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <button onClick={() => setShowAnswer(!showAnswer)} style={{
            width: '100%', padding: '16px 20px', background: 'none', border: 'none',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            cursor: 'pointer', borderBottom: showAnswer ? `1px solid ${COLORS.border}` : 'none'
          }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: COLORS.text }}>
              标准答案与解析
            </span>
            {showAnswer ? <EyeOff size={20} color={COLORS.textSecondary} /> : <Eye size={20} color={COLORS.textSecondary} />}
          </button>

          <AnimatePresence>
            {showAnswer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ padding: '16px 20px', background: `${COLORS.primary}08` }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.primary, marginBottom: '8px' }}>
                    参考答案
                  </div>
                  <div style={{ fontSize: '15px', color: COLORS.text, lineHeight: '1.6' }}>
                    {currentQuestion?.answer || '暂无答案'}
                  </div>
                </div>
                {currentQuestion?.analysis && (
                  <div style={{ padding: '16px 20px', borderTop: `1px solid ${COLORS.border}`, background: `${COLORS.success}08` }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.success, marginBottom: '8px' }}>
                      解析
                    </div>
                    <div style={{ fontSize: '14px', color: COLORS.text, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                      {currentQuestion.analysis}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom Controls */}
      <div style={{
        background: COLORS.card, padding: '12px 20px',
        borderTop: `1px solid ${COLORS.border}`, flexShrink: 0
      }}>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          <button
            onClick={() => handleMarkStatus(true)}
            disabled={!!currentResult}
            style={{
              flex: 1, padding: '14px', borderRadius: '12px', fontSize: '15px',
              fontWeight: 600, border: 'none', cursor: currentResult ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              background: currentResult?.isCorrect ? COLORS.success : `${COLORS.success}15`,
              color: currentResult?.isCorrect ? '#fff' : COLORS.success,
              opacity: currentResult && !currentResult.isCorrect ? 0.4 : 1
            }}
          >
            <CheckCircle2 size={18} /> 掌握
          </button>
          <button
            onClick={() => handleMarkStatus(false)}
            disabled={!!currentResult}
            style={{
              flex: 1, padding: '14px', borderRadius: '12px', fontSize: '15px',
              fontWeight: 600, border: 'none', cursor: currentResult ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              background: currentResult && !currentResult.isCorrect ? COLORS.danger : `${COLORS.danger}15`,
              color: currentResult && !currentResult.isCorrect ? '#fff' : COLORS.danger,
              opacity: currentResult?.isCorrect ? 0.4 : 1
            }}
          >
            <XCircle size={18} /> 未掌握
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={handlePrev} disabled={currentQuestionIndex === 0} style={{
            fontSize: '15px', color: currentQuestionIndex === 0 ? `${COLORS.textSecondary}50` : COLORS.textSecondary,
            background: 'none', border: 'none', cursor: currentQuestionIndex === 0 ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}>
            <ChevronLeft size={18} /> 上一题
          </button>
          <button onClick={handleNext} disabled={currentQuestionIndex === questions.length - 1} style={{
            fontSize: '15px', color: currentQuestionIndex === questions.length - 1 ? `${COLORS.textSecondary}50` : COLORS.textSecondary,
            background: 'none', border: 'none', cursor: currentQuestionIndex === questions.length - 1 ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px'
          }}>
            下一题 <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}