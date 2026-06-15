import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, Loader2, QrCode, Eye, EyeOff } from 'lucide-react'
import { getQuestionsByIds, upsertWrongQuestionStatus, markGeneratedExamGraded } from '../../services/apiService'
import { useStudentStore } from '../../store'
import dayjs from 'dayjs'

/**
 * 判断选项内容是否已经自带字母前缀（如 "A. xxx"），避免显示 "A. A. xxx"
 */
const isOptionWithLetterPrefix = (opt) => {
  if (!opt) return false
  const trimmed = String(opt).trim()
  return /^[A-Da-d][.、)\)]\s/.test(trimmed)
}

/**
 * 如果选项已带字母前缀，则直接使用；否则自动添加
 */
const formatOption = (opt, index) => {
  if (isOptionWithLetterPrefix(opt)) return opt
  return `${String.fromCharCode(65 + index)}. ${opt}`
}

export default function Grading({ paperId, studentId, questionIds, onClose, onComplete, generatedExamId }) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questions, setQuestions] = useState([])
  const [gradingResults, setGradingResults] = useState({})
  const [studentInfo, setStudentInfo] = useState(null)
  const [showResult, setShowResult] = useState(false)
  const [showAnswerCard, setShowAnswerCard] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [masteredBeforeCount, setMasteredBeforeCount] = useState(0)

  const { students } = useStudentStore()

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

      const detailedQuestions = fetchedQuestions.map((q, index) => ({
        ...q,
        wrongQuestionId: q.id,
        questionId: q.id,
        index
      }))

      setQuestions(detailedQuestions)
      setMasteredBeforeCount(detailedQuestions.filter(q => q.status === 'mastered').length)

      // [P0-2c] 初始化时确保每条题目在 wrong_questions 中有记录
      detailedQuestions.forEach(q => {
        upsertWrongQuestionStatus(targetStudentId, q.id, q.status || 'pending', q.is_correct)
          .catch(e => console.error(`[P0-2c] 初始化错题记录失败 q=${q.id.substring(0, 8)}:`, e.message))
      })

      // 取第一个题目的 practice_count 作为本次练习次数
      const maxPracticeCount = detailedQuestions.reduce((max, q) => Math.max(max, q.practice_count || 0), 0)

      setStudentInfo({
        name: student?.name || '学生',
        class: student?.class || '',
        date: dayjs().format('YYYY-MM-DD'),
        practiceCount: maxPracticeCount || 1
      })

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

  const handleMarkStatus = async (status) => {
    const currentQuestion = questions[currentQuestionIndex]
    if (!currentQuestion) return

    try {
      const newStatus = status === 'mastered' ? 'mastered' : 'pending'
      const isCorrect = status === 'mastered'
      // [P0-2b] 使用 upsert 按 (student_id, question_id) 更新，修复 ID 错配
      await upsertWrongQuestionStatus(studentId, currentQuestion.id, newStatus, isCorrect)

      const newResults = {
        ...gradingResults,
        [currentQuestion.id]: {
          status,
          questionId: currentQuestion.id,
          markedAt: Date.now()
        }
      }
      setGradingResults(newResults)

      if (currentQuestionIndex < questions.length - 1) {
        setTimeout(() => {
          setCurrentQuestionIndex(currentQuestionIndex + 1)
        }, 300)
      } else {
        setTimeout(() => {
          setShowResult(true)
        }, 300)
      }
    } catch (err) {
      console.error('更新状态失败:', err)
    }
  }

  const handlePrev = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1)
    }
  }

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
    }
  }

  const handleComplete = async () => {
    Object.entries(gradingResults).forEach(([questionId, result]) => {
      const newStatus = result.status === 'mastered' ? 'mastered' : 'pending'
      upsertWrongQuestionStatus(studentId, questionId, newStatus, result.status === 'mastered')
        .catch(e => console.error(`[P0-2b] 完成时更新失败 q=${questionId.substring(0, 8)}:`, e.message))
    })

    // 标记组卷为已批改
    if (generatedExamId) {
      markGeneratedExamGraded(generatedExamId)
        .catch(e => console.error('标记组卷已批改失败:', e.message))
    }

    const masteredCount = Object.values(gradingResults).filter(r => r.status === 'mastered').length
    const notMasteredCount = Object.values(gradingResults).filter(r => r.status !== 'mastered').length

    onComplete && onComplete({
      masteredCount,
      notMasteredCount,
      totalQuestions: questions.length,
      results: gradingResults
    })

    onClose()
  }

  if (isLoading) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: COLORS.card,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}>
        <Loader2 size={32} style={{ color: COLORS.primary }} className="animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: COLORS.card,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        flexDirection: 'column',
        gap: '16px'
      }}>
        <QrCode size={48} style={{ color: COLORS.danger }} />
        <div style={{ fontSize: '16px', color: COLORS.danger, textAlign: 'center', padding: '0 20px' }}>{error}</div>
        <button
          onClick={onClose}
          style={{
            padding: '12px 24px',
            background: COLORS.primary,
            color: '#fff',
            borderRadius: '12px',
            fontSize: '15px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer'
          }}
        >
          返回
        </button>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: COLORS.card,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        flexDirection: 'column',
        gap: '16px'
      }}>
        <QrCode size={48} style={{ color: COLORS.textSecondary }} />
        <div style={{ fontSize: '16px', color: COLORS.textSecondary }}>暂无题目，请重新扫码</div>
        <button
          onClick={onClose}
          style={{
            padding: '12px 24px',
            background: COLORS.primary,
            color: '#fff',
            borderRadius: '12px',
            fontSize: '15px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer'
          }}
        >
          返回
        </button>
      </div>
    )
  }

  if (showResult) {
    const masteredCount = Object.values(gradingResults).filter(r => r.status === 'mastered').length
    const notMasteredCount = Object.values(gradingResults).filter(r => r.status !== 'mastered').length
    const total = questions.length

    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: COLORS.card,
        zIndex: 10000,
        overflow: 'auto'
      }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ padding: '48px 20px 20px' }}
        >
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: `linear-gradient(135deg, ${COLORS.success}, ${COLORS.success}dd)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px'
            }}>
              <CheckCircle2 size={40} color="#fff" strokeWidth={2.5} />
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: COLORS.text, marginBottom: '4px' }}>
              批改完成！
            </div>
            <div style={{ fontSize: '13px', color: COLORS.textSecondary }}>
              本次共批改 {total} 道题
            </div>
          </div>

          <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
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

            <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span style={{ color: COLORS.textSecondary }}>学生姓名</span>
                <span style={{ color: COLORS.text, fontWeight: 500 }}>{studentInfo?.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span style={{ color: COLORS.textSecondary }}>批改日期</span>
                <span style={{ color: COLORS.text, fontWeight: 500 }}>{studentInfo?.date}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: COLORS.textSecondary }}>掌握率</span>
                <span style={{ color: COLORS.success, fontWeight: 600 }}>
                  {total > 0 ? Math.round(masteredCount / total * 100) : 0}%
                </span>
              </div>
            </div>
          </div>

          <button onClick={handleComplete} style={{
            width: '100%', padding: '12px', background: COLORS.primary, color: '#fff',
            borderRadius: '8px', fontSize: '14px', fontWeight: 600, border: 'none', cursor: 'pointer'
          }}>
            完成并返回
          </button>
        </motion.div>
      </div>
    )
  }

  const currentQuestion = questions[currentQuestionIndex]
  const currentResult = gradingResults[currentQuestion?.wrongQuestionId]
  const progress = ((currentQuestionIndex + 1) / questions.length) * 100
  const isShortOptions = currentQuestion?.options && currentQuestion.options.every(opt => opt.length <= 10)

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: COLORS.background,
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        background: COLORS.card,
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `1px solid ${COLORS.border}`
      }}>
        <button
          onClick={onClose}
          style={{
            fontSize: '15px',
            color: COLORS.primary,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500
          }}
        >
          退出
        </button>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: COLORS.text }}>批改中</h2>
        <div style={{ fontSize: '15px', color: COLORS.textSecondary }}>
          {currentQuestionIndex + 1}/{questions.length}
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ background: COLORS.card, padding: '12px 20px', borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
          <span style={{ color: COLORS.textSecondary }}>{studentInfo?.name}</span>
          <span style={{ color: COLORS.textSecondary }}>第{studentInfo?.practiceCount}次练习</span>
        </div>
        <div style={{ width: '100%', height: '4px', background: `${COLORS.primary}20`, borderRadius: '2px', overflow: 'hidden' }}>
          <motion.div
            style={{ height: '100%', background: COLORS.primary, borderRadius: '2px' }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Question Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {/* Question Card */}
        <div style={{
          background: COLORS.card,
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <span style={{ fontSize: '15px', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>
                第 {currentQuestionIndex + 1} 题
              </span>
              <span style={{ fontSize: '13px', color: COLORS.textSecondary }}>
                {currentQuestion?.question_type === 'choice' ? '选择题' :
                  currentQuestion?.question_type === 'fill' ? '填空题' : '解答题'}
              </span>
            </div>
            <div style={{
              fontSize: '12px',
              padding: '4px 10px',
              borderRadius: '12px',
              background: currentQuestion?.status === 'mastered' ? '#E8F5E9' :
                currentQuestion?.status === 'partial' ? '#FFF8E1' : '#FFEBEE',
              color: currentQuestion?.status === 'mastered' ? COLORS.success :
                currentQuestion?.status === 'partial' ? COLORS.warning : COLORS.danger
            }}>
              {currentQuestion?.status === 'mastered' ? '已掌握' :
                currentQuestion?.status === 'partial' ? '部分掌握' : '待复习'}
            </div>
          </div>

          <div style={{ fontSize: '15px', color: COLORS.text, lineHeight: '1.6', marginBottom: '16px' }}>
            {currentQuestion?.content}
          </div>

          {currentQuestion?.image_url && (
            <div style={{ marginBottom: '16px', textAlign: 'center' }}>
              <img
                src={currentQuestion.image_url}
                alt="题目配图"
                style={{
                  width: '100%',
                  maxHeight: '300px',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  background: COLORS.background
                }}
              />
            </div>
          )}

          {currentQuestion?.options && currentQuestion.options.length > 0 && (
            <div style={{ display: 'flex', flexDirection: isShortOptions ? 'row' : 'column', gap: isShortOptions ? '24px' : '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {currentQuestion.options.map((opt, i) => (
                <div key={i} style={{ fontSize: '14px', color: COLORS.text }}>
                  {formatOption(opt, i)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Answer Card (Vertical Layout) */}
        <div style={{
          background: COLORS.card,
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <button
            onClick={() => setShowAnswerCard(!showAnswerCard)}
            style={{
              width: '100%',
              padding: '16px 20px',
              background: 'none',
              border: 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              borderBottom: showAnswerCard ? `1px solid ${COLORS.border}` : 'none'
            }}
          >
            <span style={{ fontSize: '15px', fontWeight: 600, color: COLORS.text }}>
              标准答案与解析
            </span>
            {showAnswerCard ? <Eye size={20} color={COLORS.textSecondary} /> : <EyeOff size={20} color={COLORS.textSecondary} />}
          </button>

          <AnimatePresence>
            {showAnswerCard && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                {/* Answer Section */}
                <div style={{ padding: '16px 20px', background: `${COLORS.primary}08` }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.primary, marginBottom: '8px' }}>
                    参考答案
                  </div>
                  <div style={{ fontSize: '15px', color: COLORS.text, lineHeight: '1.6' }}>
                    {currentQuestion?.answer || '暂无答案'}
                  </div>
                </div>

                {/* Analysis Section */}
                <div style={{ padding: '16px 20px', borderTop: `1px solid ${COLORS.border}`, background: `${COLORS.success}08` }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: COLORS.success, marginBottom: '8px' }}>
                    解析
                  </div>
                  <div style={{ fontSize: '14px', color: COLORS.text, lineHeight: '1.6' }}>
                    {currentQuestion?.analysis ||
                      `本题考查相关知识点。正确答案是 ${currentQuestion?.answer}。` +
                      `请根据题目条件，运用所学知识进行推导计算。`
                    }
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom Controls */}
      <div style={{
        background: COLORS.card,
        padding: '16px 20px',
        borderTop: `1px solid ${COLORS.border}`
      }}>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <button
            onClick={() => handleMarkStatus('mastered')}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: currentResult?.status === 'mastered' ? COLORS.success : `${COLORS.success}15`,
              color: currentResult?.status === 'mastered' ? '#fff' : COLORS.success
            }}
          >
            <CheckCircle2 size={18} />
            做对了
          </button>
          <button
            onClick={() => handleMarkStatus('not_mastered')}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: currentResult?.status === 'not_mastered' ? COLORS.danger : `${COLORS.danger}15`,
              color: currentResult?.status === 'not_mastered' ? '#fff' : COLORS.danger
            }}
          >
            <XCircle size={18} />
            做错了
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={handlePrev}
            disabled={currentQuestionIndex === 0}
            style={{
              fontSize: '15px',
              color: currentQuestionIndex === 0 ? `${COLORS.textSecondary}50` : COLORS.textSecondary,
              background: 'none',
              border: 'none',
              cursor: currentQuestionIndex === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <ChevronLeft size={18} />
            上一题
          </button>
          <button
            onClick={handleNext}
            disabled={currentQuestionIndex === questions.length - 1}
            style={{
              fontSize: '15px',
              color: currentQuestionIndex === questions.length - 1 ? `${COLORS.textSecondary}50` : COLORS.textSecondary,
              background: 'none',
              border: 'none',
              cursor: currentQuestionIndex === questions.length - 1 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            下一题
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
