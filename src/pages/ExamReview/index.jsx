import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Save, Loader2, ChevronDown, ChevronUp, AlertTriangle, Sparkles
} from 'lucide-react'
import { useWrongQuestionStore } from '../../store'
import { useToast } from '../../components/ToastProvider'
import { updateQuestion, addWrongQuestions, deleteWrongQuestion, getQuestionsByTask, invalidateCache, recalculateTaskStats } from '../../services/apiService'
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

const isOptionWithLetterPrefix = (opt) => {
  if (!opt) return false
  return /^[A-Da-d][.、)\)]\s/.test(String(opt).trim())
}

const formatOption = (opt, index) => {
  if (isOptionWithLetterPrefix(opt)) return <MathText content={opt} />
  return <>{String.fromCharCode(65 + index)}. <MathText content={opt} /></>
}

const getStatusInfo = (q) => {
  const isCorrect = q.is_correct
  const source = q.status === 'correct' && isCorrect === true ? 'human' : (q._ai_graded ? 'ai' : 'unknown')
  if (isCorrect === true) {
    return { bg: source === 'human' ? '#D1FAE5' : '#DCFCE7', color: source === 'human' ? '#059669' : COLORS.success, text: source === 'human' ? '已打勾' : 'AI判定正确', icon: source === 'human' ? Sparkles : CheckCircle2, isGreyed: source === 'human', source }
  }
  if (isCorrect === false) {
    return { bg: '#FEE2E2', color: COLORS.danger, text: 'AI判定错误', icon: XCircle, source: 'ai' }
  }
  return { bg: '#FEF3C7', color: COLORS.warning, text: '未批改', icon: AlertTriangle, source: 'pending' }
}

export default function ExamReview({ task, onClose, onSave }) {
  const { wrongQuestions } = useWrongQuestionStore()
  const Toast = useToast()
  const [questions, setQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAnalysis, setShowAnalysis] = useState(false)

  const wrongIdMap = useMemo(() => {
    const map = {}
    ;(Array.isArray(wrongQuestions) ? wrongQuestions : []).forEach(wq => { if (wq.question_id) map[wq.question_id] = wq.id })
    return map
  }, [wrongQuestions])

  useEffect(() => {
    if (!task?.id) return
    const fetchQuestions = async () => {
      try {
        setLoading(true)
        const qs = await getQuestionsByTask(task.id, false)
        setQuestions(qs.map(q => ({ ...q, _ai_graded: q.status !== 'correct' || q._ai_graded === true })))
      } catch (e) {
        console.error('获取题目失败:', e)
        Toast.show({ message: '获取题目失败', type: 'error' })
      } finally { setLoading(false) }
    }
    fetchQuestions()
  }, [task?.id])

  const getCorrectness = (qId) => edits[qId]?.is_correct !== undefined ? edits[qId].is_correct : (questions.find(x => x.id === qId)?.is_correct ?? null)
  const getStudentAnswer = (qId) => edits[qId]?.student_answer !== undefined ? edits[qId].student_answer : (questions.find(x => x.id === qId)?.student_answer || questions.find(x => x.id === qId)?.ai_answer || '')

  const handleToggleCorrect = (qId, value) => setEdits(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), is_correct: value } }))
  const handleAnswerChange = (qId, value) => { const q = questions.find(x => x.id === qId); setEdits(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), student_answer: value, ...(q?.answer_source === 'blank' && value ? { answer_source: 'manual' } : {}) } })) }
  const handleRefAnswerChange = (qId, value) => setEdits(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), answer: value } }))

  const handleSave = async () => {
    const dirtyIds = Object.keys(edits)
    if (dirtyIds.length === 0) { Toast.show({ message: '没有需要保存的修改', type: 'info' }); return }
    setSaving(true)
    let successCount = 0
    for (const qId of dirtyIds) {
      try {
        await updateQuestion(qId, edits[qId]); successCount++
        const edit = edits[qId]; const wrongId = wrongIdMap[qId]
        if (edit.is_correct === false && !wrongId) await addWrongQuestions(task.student_id, [qId]).catch(() => {})
        else if (edit.is_correct === true && wrongId) await deleteWrongQuestion(wrongId).catch(() => {})
      } catch (e) { console.error('保存失败:', qId, e) }
    }
    setSaving(false)
    if (successCount > 0) {
      setQuestions(prev => prev.map(q => { const edit = edits[q.id]; return edit ? { ...q, ...edit, _ai_graded: true } : q }))
      setEdits({})
      if (task?.student_id) { invalidateCache('generated', task.student_id); invalidateCache('questions', task.student_id); invalidateCache('tasks', task.student_id) }
      if (task?.id) await recalculateTaskStats(task.id).catch(() => {})
      Toast.show({ message: `已保存 ${successCount} 题`, type: 'success' })
      if (onSave) onSave()
    } else { Toast.show({ message: '保存失败', type: 'error' }) }
  }

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, background: COLORS.card, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
      <Loader2 size={32} style={{ color: COLORS.primary }} className="animate-spin" />
    </div>
  )

  if (questions.length === 0) return (
    <div style={{ position: 'fixed', inset: 0, background: COLORS.card, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '16px', color: COLORS.textSecondary }}>暂无题目数据</div>
      <button onClick={onClose} style={{ padding: '12px 24px', background: COLORS.primary, color: '#fff', borderRadius: '12px', fontSize: '15px', fontWeight: 600, border: 'none', cursor: 'pointer' }}>返回</button>
    </div>
  )

  const q = questions[currentIndex]
  const correctness = getCorrectness(q.id)
  const studentAnswer = getStudentAnswer(q.id)
  const refAnswer = edits[q.id]?.answer ?? q.answer ?? ''
  const statusInfo = getStatusInfo(q)
  const geoUrl = q.geometry_image_url || q.enhanced_geometry_image
  const hasRefAnswer = refAnswer && refAnswer.length > 0
  const hasException = q.result?.answer_exception === true

  return (
    <div style={{ position: 'fixed', inset: 0, background: COLORS.background, zIndex: 10000, display: 'flex', flexDirection: 'column' }}>

      {/* 顶部栏 */}
      <div style={{ background: COLORS.card, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${COLORS.border}`, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: COLORS.primary, fontSize: '14px', fontWeight: 500, padding: '4px 0' }}>
          <ArrowLeft size={18} /> 返回
        </button>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: COLORS.text }}>复审试卷</h2>
        <div style={{ fontSize: '14px', color: COLORS.textSecondary }}>{currentIndex + 1}/{questions.length}</div>
      </div>

      {/* 题号导航 */}
      <div style={{ background: COLORS.card, padding: '10px 16px', borderBottom: `1px solid ${COLORS.border}`, overflowX: 'auto', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
          {questions.map((item, i) => {
            const info = getStatusInfo(item)
            let bg = COLORS.warning
            if (item.is_correct === true) bg = info.isGreyed ? '#D1FAE5' : COLORS.success
            else if (item.is_correct === false) bg = COLORS.danger
            if (i === currentIndex) bg = COLORS.primary
            return (
              <button key={item.id} onClick={() => setCurrentIndex(i)} style={{ width: '32px', height: '32px', borderRadius: '50%', background: bg, color: '#fff', border: 'none', fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.15s', transform: i === currentIndex ? 'scale(1.15)' : 'scale(1)', opacity: info.isGreyed ? 0.7 : 1 }}>
                {i + 1}
              </button>
            )
          })}
        </div>
      </div>

      {/* 题目内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px' }}>
        <AnimatePresence mode="wait">
          <motion.div key={q.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }}>
            <div style={{ background: COLORS.card, borderRadius: '12px', padding: '14px', marginBottom: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

              {/* 1. 题目头信息 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>第 {currentIndex + 1} 题</span>
                  <span style={{ fontSize: '12px', color: COLORS.textSecondary }}>
                    {q.question_type === 'choice' ? '选择题' : q.question_type === 'fill' ? '填空题' : '解答题'}
                  </span>
                </div>
                <div style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, background: statusInfo.bg, color: statusInfo.color }}>
                  <statusInfo.icon size={12} />{statusInfo.text}
                </div>
              </div>

              {/* 2. 题干 (KaTeX 渲染) */}
              <div style={{ fontSize: '15px', color: COLORS.text, lineHeight: '1.7', marginBottom: geoUrl ? '8px' : '14px', whiteSpace: 'pre-wrap' }}>
                <MathText content={q.content} />
              </div>

              {/* 题目原图 */}
              {q.image_url && (
                <div style={{ marginBottom: '14px', textAlign: 'center' }}>
                  <img src={q.image_url} alt="题目配图" style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '8px', background: COLORS.background }} />
                </div>
              )}

              {/* 3. V3 智能配图 (多模态) */}
              {geoUrl && (
                <div style={{ marginBottom: '14px', background: '#FAFAFA', borderRadius: '12px', padding: '10px', border: '1px solid #E5E7EB' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <Sparkles size={14} style={{ color: '#2563EB' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#2563EB' }}>V3 智能配图</span>
                  </div>
                  <img src={geoUrl} alt="几何配图" style={{ width: '100%', maxHeight: '25vh', objectFit: 'contain', borderRadius: '8px', display: 'block', background: '#FFFFFF', border: '1px solid #E5E7EB' }} />
                  {q.geometry_image?.description && (
                    <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '6px', fontStyle: 'italic' }}>{q.geometry_image.description}</div>
                  )}
                </div>
              )}

              {/* 选项 */}
              {q.options?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                  {q.options.map((opt, i) => (
                    <div key={i} style={{ fontSize: '14px', color: COLORS.text, padding: '6px 12px', background: COLORS.background, borderRadius: '8px' }}>{formatOption(opt, i)}</div>
                  ))}
                </div>
              )}

              {/* 4. 答案对比区 — 上下单列流 */}
              <div style={{ background: COLORS.background, borderRadius: '10px', padding: '12px' }}>
                {/* 学生作答 */}
                <div style={{ marginBottom: hasRefAnswer || hasException ? '12px' : 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '6px' }}>学生作答</div>
                  <input
                    type="text" value={studentAnswer || ''}
                    onChange={e => handleAnswerChange(q.id, e.target.value)}
                    placeholder="输入学生答案..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${COLORS.border}`, fontSize: '16px', fontWeight: 600, color: studentAnswer ? COLORS.text : '#9CA3AF', outline: 'none', background: COLORS.card, boxSizing: 'border-box' }}
                  />
                  {studentAnswer && studentAnswer.includes('\\') && (
                    <div style={{ marginTop: '6px', padding: '8px 10px', borderRadius: '8px', background: '#F9FAFB', border: '1px dashed #D1D5DB', fontSize: '15px' }}>
                      <MathText content={studentAnswer} />
                    </div>
                  )}
                </div>

                {/* 标准答案 — 有值才显示 */}
                {(hasRefAnswer || hasException) && (
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '6px' }}>标准答案</div>
                    {hasException ? (
                      <div style={{ padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.warning}`, fontSize: '14px', color: COLORS.warning, background: '#FFFBEB' }}>
                        &#9888; 解析异常，请人工复核
                        {q.result?.exception_reason && <div style={{ fontSize: '11px', color: '#92400E', marginTop: '2px' }}>{q.result.exception_reason}</div>}
                      </div>
                    ) : (
                      <>
                        <input
                          type="text" value={refAnswer}
                          onChange={e => handleRefAnswerChange(q.id, e.target.value)}
                          placeholder="输入参考答案..."
                          style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${COLORS.border}`, fontSize: '16px', fontWeight: 600, color: refAnswer ? COLORS.text : '#9CA3AF', outline: 'none', background: COLORS.card, boxSizing: 'border-box' }}
                        />
                        {refAnswer && refAnswer.includes('\\') && (
                          <div style={{ marginTop: '6px', padding: '8px 10px', borderRadius: '8px', background: '#F9FAFB', border: '1px dashed #D1D5DB', fontSize: '15px' }}>
                            <MathText content={refAnswer} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 5. 动态复审动作区 */}
              <div style={{ marginTop: '12px' }}>
                {/* AI 判定错误 → 突出"改判为正确" */}
                {correctness === false && (
                  <>
                    <button
                      onClick={() => handleToggleCorrect(q.id, true)}
                      style={{
                        width: '100%', padding: '14px 16px', borderRadius: '12px',
                        border: '2px solid #16A34A', cursor: 'pointer', fontSize: '15px', fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        background: '#DCFCE7', color: '#16A34A', transition: 'all 0.15s'
                      }}
                    >
                      <CheckCircle2 size={18} />
                      改判为正确并移出
                    </button>
                    <button
                      onClick={() => handleToggleCorrect(q.id, false)}
                      style={{
                        width: '100%', padding: '10px 16px', borderRadius: '10px', marginTop: '8px',
                        border: '1px solid #E5E7EB', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        background: COLORS.card, color: '#9CA3AF', transition: 'all 0.15s'
                      }}
                    >
                      维持错误判定
                    </button>
                  </>
                )}

                {/* AI 判定正确 → 只显示"改判为错误" */}
                {correctness === true && (
                  <button
                    onClick={() => handleToggleCorrect(q.id, false)}
                    style={{
                      width: '100%', padding: '14px 16px', borderRadius: '12px',
                      border: '2px solid #EF4444', cursor: 'pointer', fontSize: '15px', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      background: '#FEF2F2', color: '#EF4444', transition: 'all 0.15s'
                    }}
                  >
                    <XCircle size={18} />
                    改判为错误并入库
                  </button>
                )}

                {/* 未判定 */}
                {correctness === null && (
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => handleToggleCorrect(q.id, true)} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #E5E7EB', background: COLORS.card, cursor: 'pointer', fontSize: '14px', color: COLORS.success, fontWeight: 600 }}>
                      <CheckCircle2 size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} /> 正确
                    </button>
                    <button onClick={() => handleToggleCorrect(q.id, false)} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #E5E7EB', background: COLORS.card, cursor: 'pointer', fontSize: '14px', color: COLORS.danger, fontWeight: 600 }}>
                      <XCircle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} /> 错误
                    </button>
                  </div>
                )}
              </div>

              {/* 6. 底部解析区 (默认折叠) */}
              <div style={{ marginTop: '10px', borderTop: `1px solid ${COLORS.border}`, paddingTop: '8px' }}>
                <button onClick={() => setShowAnalysis(!showAnalysis)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: COLORS.textSecondary, padding: 0, width: '100%', justifyContent: 'flex-start' }}>
                  {showAnalysis ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <span style={{ fontWeight: 500 }}>{showAnalysis ? '收起解析' : '查看解析'}</span>
                </button>
                <AnimatePresence>
                  {showAnalysis && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                      <div style={{ marginTop: '8px', padding: '10px', background: `${COLORS.success}08`, borderRadius: '8px' }}>
                        <div style={{ fontSize: '13px', color: COLORS.text, lineHeight: '1.6' }}>
                          <MathText content={q.analysis || '暂无解析'} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 底部操作栏 */}
      <div style={{ background: COLORS.card, padding: '12px 16px', borderTop: `1px solid ${COLORS.border}`, display: 'flex', gap: '10px', flexShrink: 0 }}>
        <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', fontSize: '14px', color: currentIndex === 0 ? '#CCC' : COLORS.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <ChevronLeft size={16} /> 上一题
        </button>
        <button onClick={handleSave} disabled={saving || Object.keys(edits).length === 0} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: (saving || Object.keys(edits).length === 0) ? '#93C5FD' : COLORS.primary, color: '#fff', cursor: (saving || Object.keys(edits).length === 0) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 保存
        </button>
        <button onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))} disabled={currentIndex >= questions.length - 1} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: currentIndex >= questions.length - 1 ? 'not-allowed' : 'pointer', fontSize: '14px', color: currentIndex >= questions.length - 1 ? '#CCC' : COLORS.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          下一题 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
