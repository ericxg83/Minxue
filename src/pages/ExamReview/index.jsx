import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Save, Loader2, AlertTriangle, UserCheck,
  ChevronUp, ChevronDown
} from 'lucide-react'
import { useWrongQuestionStore } from '../../store'
import { useToast } from '../../components/ToastProvider'
import {
  updateQuestion, addWrongQuestions, deleteWrongQuestion,
  getQuestionsByTask, invalidateCache, recalculateTaskStats
} from '../../services/apiService'
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

// ── 面板边界常量 ──
const MIN_EXPOSED = 60             // 底部最少露出 60px
const PC_CONTAINER_WIDTH = 430     // PC 端模拟器宽度
const PC_BREAKPOINT = 1024         // PC 断点

const isOptionWithLetterPrefix = (opt) => {
  if (!opt) return false
  return /^[A-Da-d][.、)\)]\s/.test(String(opt).trim())
}

const formatOption = (opt, index) => {
  if (isOptionWithLetterPrefix(opt)) return <MathText content={opt} />
  return <>{String.fromCharCode(65 + index)}. <MathText content={opt} /></>
}

const getStatusInfo = (q) => {
  if (!q) {
    return {
      bg: COLORS.warning, color: COLORS.textSecondary,
      text: '未知', icon: AlertTriangle,
      isGreyed: false, source: 'unknown'
    }
  }
  const isCorrect = q.is_correct
  const source = q.status === 'correct' && isCorrect === true
    ? 'human'
    : (q._ai_graded ? 'ai' : 'unknown')

  if (isCorrect === true) {
    return {
      bg: source === 'human' ? '#D1FAE5' : '#DCFCE7',
      color: source === 'human' ? '#059669' : COLORS.success,
      text: source === 'human' ? '已打勾' : 'AI判定正确',
      icon: source === 'human' ? UserCheck : CheckCircle2,
      isGreyed: source === 'human',
      source
    }
  }
  if (isCorrect === false) {
    return {
      bg: '#FEE2E2', color: COLORS.danger,
      text: 'AI判定错误', icon: XCircle, source: 'ai'
    }
  }
  return {
    bg: '#FEF3C7', color: COLORS.warning,
    text: '未批改', icon: AlertTriangle, source: 'pending'
  }
}

// ── 主组件 ──
export default function ExamReview({ task, onClose, onSave }) {
  const { wrongQuestions } = useWrongQuestionStore()
  const Toast = useToast()

  // ── 所有 state hooks ──
  const [questions, setQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAnswer, setShowAnswer] = useState(false)
  const [isPC, setIsPC] = useState(() => typeof window !== 'undefined' && window.innerWidth >= PC_BREAKPOINT)
  const [screenSize, setScreenSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 375,
    h: typeof window !== 'undefined' ? window.innerHeight : 800
  }))

  // panelH = 面板高度（从底部算起，BottomSheet）
  const [panelH, setPanelH] = useState(0)
  const isInitializedRef = useRef(false)

  // 图片原始尺寸
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 })
  // 图片实际渲染尺寸（缩放后的像素值，用于 OCR 框定位）
  const [renderedSize, setRenderedSize] = useState({ w: 0, h: 0 })
  // 图片居中偏移
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 })
  // 图片 translateY（切换题目时平移）
  const [imgTranslateY, setImgTranslateY] = useState(0)
  // 是否正在拖拽
  const [isDragging, setIsDragging] = useState(false)

  // ── refs ──
  const draggingRef = useRef(false)
  const startYRef = useRef(0)
  const startPanelHRef = useRef(0)
  const imgRef = useRef(null)

  // ── 窗口 resize ──
  useEffect(() => {
    const handleResize = () => {
      setIsPC(window.innerWidth >= PC_BREAKPOINT)
      setScreenSize({ w: window.innerWidth, h: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const containerW = isPC ? PC_CONTAINER_WIDTH : screenSize.w
  const containerH = screenSize.h

  // ── 派生数据 ──
  const validQuestions = useMemo(() => questions.filter(Boolean), [questions])
  const wrongIdMap = useMemo(() => {
    const map = {}
    ;(Array.isArray(wrongQuestions) ? wrongQuestions : []).forEach(wq => {
      if (wq.question_id) map[wq.question_id] = wq.id
    })
    return map
  }, [wrongQuestions])
  const currentQuestion = validQuestions[currentIndex] || null

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
        if (!cancelled) Toast.show({ message: '获取题目失败', type: 'error' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchQuestions()
    return () => { cancelled = true }
  }, [task?.id])

  // ── 图片加载后计算初始缩放 ──
  useEffect(() => {
    if (!imgNaturalSize.w || !containerW || !containerH) return

    // 可见区域高度 = 总高度 - 面板最小高度
    const availH = containerH - MIN_EXPOSED

    // Contain 模式：取较小比例确保完整显示
    const scaleX = containerW / imgNaturalSize.w
    const scaleY = availH / imgNaturalSize.h
    const scale = Math.min(scaleX, scaleY)

    // 计算实际渲染尺寸（像素值）
    const rw = imgNaturalSize.w * scale
    const rh = imgNaturalSize.h * scale

    setRenderedSize({ w: rw, h: rh })

    // 居中偏移
    const offsetX = (containerW - rw) / 2
    const offsetY = (availH - rh) / 2
    setImgOffset({ x: offsetX, y: offsetY })

    // 初始化面板高度
    if (!isInitializedRef.current) {
      setPanelH(containerH - MIN_EXPOSED)
      isInitializedRef.current = true
    }
  }, [imgNaturalSize, containerW, containerH])

  // ── 图片 onLoad ──
  const handleImageLoad = useCallback((e) => {
    setImgNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight })
  }, [])

  // ── 题号切换：平移图片 ──
  const jumpToQuestion = useCallback((index) => {
    setCurrentIndex(index)
    setShowAnswer(false)
    const q = validQuestions[index]
    if (!q?.block_coordinates || !renderedSize.w) return

    const bbox = q.block_coordinates
    // 基于实际渲染尺寸计算题目中心
    const bboxCY = bbox.y + bbox.height / 2

    // 可用高度
    const availH = containerH - panelH

    // 目标：题目中心在可用区域中部
    const targetY = availH / 2 - bboxCY - imgOffset.y

    // 限制范围
    const minY = availH - renderedSize.h
    const maxY = 0

    setImgTranslateY(Math.max(minY, Math.min(maxY, targetY)))
  }, [validQuestions, renderedSize, imgOffset, containerH, panelH])

  // ── 触摸拖拽 ──
  const handleTouchStart = useCallback((e) => {
    e.preventDefault()
    startYRef.current = e.touches[0].clientY
    startPanelHRef.current = panelH
    draggingRef.current = true
    setIsDragging(true)
  }, [panelH])

  const handleTouchMove = useCallback((e) => {
    if (!draggingRef.current) return
    e.preventDefault()
    const delta = e.touches[0].clientY - startYRef.current
    const newH = startPanelHRef.current - delta
    setPanelH(Math.max(MIN_EXPOSED, Math.min(containerH - 20, newH)))
  }, [containerH])

  const handleTouchEnd = useCallback(() => {
    draggingRef.current = false
    setIsDragging(false)
  }, [])

  // ── Mouse 拖拽 ──
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    startYRef.current = e.clientY
    startPanelHRef.current = panelH
    draggingRef.current = true
    setIsDragging(true)

    const onMouseMove = (ev) => {
      const delta = ev.clientY - startYRef.current
      const newH = startPanelHRef.current - delta
      setPanelH(Math.max(MIN_EXPOSED, Math.min(containerH - 20, newH)))
    }
    const onMouseUp = () => {
      draggingRef.current = false
      setIsDragging(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [panelH, containerH])

  // ── 评判/答案/保存逻辑 ──
  const handleToggleCorrect = useCallback((qId, value) => {
    setEdits(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), is_correct: value } }))
  }, [])

  const handleAnswerChange = useCallback((qId, value) => {
    const q = questions.find(x => x.id === qId)
    const wasBlank = q && (q.answer_source === 'blank')
    setEdits(prev => ({
      ...prev, [qId]: {
        ...(prev[qId] || {}), student_answer: value,
        ...(wasBlank && value ? { answer_source: 'manual' } : {})
      }
    }))
  }, [questions])

  const handleAnswerEdit = useCallback((qId, value) => {
    setEdits(prev => ({ ...prev, [qId]: { ...(prev[qId] || {}), answer: value } }))
  }, [])

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
        await updateQuestion(qId, edits[qId])
        successCount++
        const wrongId = wrongIdMap[qId]
        if (edits[qId].is_correct === false && !wrongId) {
          await addWrongQuestions(task.student_id, [qId]).catch(() => {})
        } else if (edits[qId].is_correct === true && wrongId) {
          await deleteWrongQuestion(wrongId).catch(() => {})
        }
      } catch (e) { console.error('保存失败:', qId, e) }
    }
    setSaving(false)
    if (successCount > 0) {
      setQuestions(prev => prev.map(q => {
        const edit = edits[q.id]
        return edit ? { ...q, ...edit, _ai_graded: true } : q
      }))
      setEdits({})
      if (task?.student_id) {
        invalidateCache('generated', task.student_id)
        invalidateCache('questions', task.student_id)
        invalidateCache('tasks', task.student_id)
      }
      if (task?.id) await recalculateTaskStats(task.id).catch(() => {})
      Toast.show({ message: `已保存 ${successCount} 题`, type: 'success' })
      if (onSave) onSave()
    } else {
      Toast.show({ message: '保存失败', type: 'error' })
    }
  }, [edits, wrongIdMap, task, Toast, onSave])

  // ── 派生状态 ──
  const correctness = useMemo(() => {
    if (!currentQuestion) return null
    return edits[currentQuestion.id]?.is_correct !== undefined
      ? edits[currentQuestion.id].is_correct : currentQuestion.is_correct
  }, [currentQuestion, edits])

  const currentStudentAnswer = useMemo(() => {
    if (!currentQuestion) return ''
    return edits[currentQuestion.id]?.student_answer !== undefined
      ? edits[currentQuestion.id].student_answer
      : currentQuestion.student_answer || currentQuestion.ai_answer || ''
  }, [currentQuestion, edits])

  const answerStatus = useMemo(() => {
    if (!currentQuestion) return 'pending'
    if (currentQuestion.answer_source === 'blank') return 'not_answered'
    if (correctness === null) return 'pending'
    return correctness ? 'correct' : 'wrong'
  }, [currentQuestion, correctness])

  const statusInfo = useMemo(() => getStatusInfo(currentQuestion), [currentQuestion])
  const geoImageUrl = currentQuestion?.geometry_image_url || currentQuestion?.enhanced_geometry_image
  const isAiWrong = correctness === false
  const panelContentHeight = Math.max(0, panelH - 40 - 44 - 52)

  // ── 条件渲染 (所有 hooks 之后) ──
  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: COLORS.card, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
        <Loader2 size={32} style={{ color: COLORS.primary }} className="animate-spin" />
      </div>
    )
  }

  if (!currentQuestion || validQuestions.length === 0) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: COLORS.card, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '16px', color: COLORS.textSecondary }}>
          {validQuestions.length === 0 ? '暂无题目数据' : '题目数据加载异常'}
        </div>
        <button onClick={onClose} style={{ padding: '12px 24px', background: COLORS.primary, color: '#fff', borderRadius: '12px', fontSize: '15px', fontWeight: 600, border: 'none', cursor: 'pointer' }}>返回</button>
      </div>
    )
  }

  // ── 面板内容 ──
  const panelContent = (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      height: panelH, zIndex: 10, touchAction: 'none',
      transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      borderRadius: '20px 20px 0 0', overflow: 'hidden',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ position: 'absolute', inset: 0, background: COLORS.card, zIndex: 0 }} />

      {/* 拖拽手柄 */}
      <div
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        style={{ position: 'relative', zIndex: 1, padding: '10px 16px 6px', cursor: 'grab', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${COLORS.border}` }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: '#D1D5DB' }} />
      </div>

      {/* 题号导航 */}
      <div style={{ position: 'relative', zIndex: 1, padding: '8px 12px', display: 'flex', gap: '6px', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }}>
        {validQuestions.map((q, i) => {
          const info = getStatusInfo(q)
          let bg = COLORS.warning
          if (q.is_correct === true) bg = info.isGreyed ? '#D1FAE5' : COLORS.success
          else if (q.is_correct === false) bg = COLORS.danger
          if (i === currentIndex) bg = COLORS.primary
          return (
            <button key={q.id} onClick={() => jumpToQuestion(i)} style={{
              minWidth: '32px', height: '32px', borderRadius: '16px', background: bg, color: '#fff', border: 'none',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform 0.15s', transform: i === currentIndex ? 'scale(1.15)' : 'scale(1)', opacity: info.isGreyed ? 0.7 : 1
            }}>
              {i + 1}
            </button>
          )
        })}
      </div>

      {/* 面板内容区 */}
      <div style={{ position: 'relative', zIndex: 1, height: panelContentHeight, overflowY: 'auto', overflowX: 'hidden', padding: '4px 16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div>
            <span style={{ fontSize: '14px', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>第 {currentIndex + 1} 题</span>
            <span style={{ fontSize: '12px', color: COLORS.textSecondary }}>
              {currentQuestion?.question_type === 'choice' ? '选择题' : currentQuestion?.question_type === 'fill' ? '填空题' : '解答题'}
            </span>
          </div>
          <div style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, background: statusInfo.bg, color: statusInfo.color }}>
            <statusInfo.icon size={12} /> {statusInfo.text}
          </div>
        </div>

        <div style={{ fontSize: '14.5px', color: COLORS.text, lineHeight: '1.65', marginBottom: '8px' }}>
          <MathText content={currentQuestion?.content || ''} />
        </div>

        {currentQuestion?.options?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
            {currentQuestion.options.map((opt, i) => (
              <div key={i} style={{ fontSize: '13px', color: COLORS.text, padding: '4px 8px', background: COLORS.background, borderRadius: '6px' }}>
                {formatOption(opt, i)}
              </div>
            ))}
          </div>
        )}

        {geoImageUrl && (
          <div style={{ marginBottom: '8px', background: '#FAFAFA', borderRadius: '8px', padding: '8px', border: '1px solid #E5E7EB' }}>
            <img src={geoImageUrl} alt="几何配图" style={{ width: '100%', maxHeight: '20vh', objectFit: 'contain', borderRadius: '6px', display: 'block' }} />
          </div>
        )}

        <div style={{ background: COLORS.background, borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>学生答案</div>
              <input type="text" value={currentStudentAnswer || ''} onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)} placeholder={answerStatus === 'not_answered' ? '未作答' : '输入...'} style={{ width: '100%', padding: '6px 8px', borderRadius: '5px', border: `1px solid ${answerStatus === 'not_answered' ? COLORS.warning : COLORS.border}`, fontSize: '13px', color: COLORS.text, outline: 'none', boxSizing: 'border-box', background: COLORS.card }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>参考答案</div>
              <input type="text" value={edits[currentQuestion?.id]?.answer ?? currentQuestion?.answer ?? ''} onChange={(e) => handleAnswerEdit(currentQuestion?.id, e.target.value)} placeholder="输入..." style={{ width: '100%', padding: '6px 8px', borderRadius: '5px', border: `1px solid ${COLORS.border}`, fontSize: '13px', color: COLORS.text, outline: 'none', boxSizing: 'border-box', background: COLORS.card }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {isAiWrong ? (
              <>
                <button onClick={() => handleToggleCorrect(currentQuestion.id, true)} style={{ flex: 1, padding: '8px 0', borderRadius: '8px', border: correctness === true ? '2px solid #16A34A' : '1px solid #BBF7D0', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: correctness === true ? '#DCFCE7' : '#F0FDF4', color: correctness === true ? '#16A34A' : '#15803D' }}>
                  <CheckCircle2 size={14} /> 改判为对
                </button>
                <button onClick={() => handleToggleCorrect(currentQuestion.id, false)} style={{ flex: 1, padding: '8px 0', borderRadius: '8px', border: correctness === false ? '2px solid #EF4444' : '1px solid #E5E7EB', cursor: 'pointer', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: correctness === false ? '#FEE2E2' : COLORS.card, color: correctness === false ? '#EF4444' : '#9CA3AF' }}>
                  <XCircle size={14} /> 维持
                </button>
              </>
            ) : (
              <>
                <button onClick={() => handleToggleCorrect(currentQuestion.id, true)} style={{ flex: 1, padding: '8px 0', borderRadius: '8px', border: correctness === true ? '2px solid #16A34A' : '1px solid #E5E7EB', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: correctness === true ? '#DCFCE7' : COLORS.card, color: correctness === true ? '#16A34A' : COLORS.success }}>
                  <CheckCircle2 size={14} /> 正确
                </button>
                <button onClick={() => handleToggleCorrect(currentQuestion.id, false)} style={{ flex: 1, padding: '8px 0', borderRadius: '8px', border: correctness === false ? '2px solid #EF4444' : '1px solid #E5E7EB', cursor: 'pointer', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: correctness === false ? '#FEE2E2' : COLORS.card, color: correctness === false ? '#EF4444' : COLORS.textSecondary }}>
                  <XCircle size={14} /> 错误
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: '8px' }}>
          <button onClick={() => setShowAnswer(!showAnswer)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: COLORS.textSecondary, padding: 0, width: '100%', justifyContent: 'flex-start' }}>
            {showAnswer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span style={{ fontWeight: 500 }}>{showAnswer ? '收起解析' : '查看解析'}</span>
          </button>
          {showAnswer && (
            <div style={{ marginTop: '6px' }}>
              <div style={{ padding: '8px 10px', background: `${COLORS.success}08`, borderRadius: '6px' }}>
                <div style={{ fontSize: '13px', color: COLORS.text, lineHeight: '1.6' }}>
                  <MathText content={currentQuestion?.analysis || '暂无解析'} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div style={{ position: 'relative', zIndex: 1, padding: '8px 12px', display: 'flex', gap: '8px', flexShrink: 0, borderTop: `1px solid ${COLORS.border}`, background: COLORS.card }}>
        <button onClick={() => jumpToQuestion(currentIndex - 1)} disabled={currentIndex === 0} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', fontSize: '13px', color: currentIndex === 0 ? '#CCC' : COLORS.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          <ChevronLeft size={14} /> 上一题
        </button>
        <button onClick={handleSaveClick} disabled={saving || Object.keys(edits).length === 0} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: (saving || Object.keys(edits).length === 0) ? '#93C5FD' : COLORS.primary, color: '#fff', cursor: (saving || Object.keys(edits).length === 0) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} 保存
        </button>
        <button onClick={() => jumpToQuestion(currentIndex + 1)} disabled={currentIndex >= validQuestions.length - 1} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: currentIndex >= validQuestions.length - 1 ? 'not-allowed' : 'pointer', fontSize: '13px', color: currentIndex >= validQuestions.length - 1 ? '#CCC' : COLORS.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          下一题 <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )

  // ── 返回按钮 ──
  const backButton = (
    <button onClick={onClose} style={{
      position: 'absolute', top: 12, left: 12, zIndex: 15,
      background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
      width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', color: '#fff', backdropFilter: 'blur(4px)'
    }}>
      <ArrowLeft size={20} />
    </button>
  )

  // ── 试卷图渲染（PC 和手机共用） ──
  const renderExamImage = () => {
    const availH = containerH - panelH

    return (
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: availH,
        overflow: 'hidden', zIndex: 1
      }}>
        {/* 图片容器：基于实际渲染尺寸定位 */}
        <div style={{
          position: 'absolute',
          left: imgOffset.x,
          top: imgOffset.y + imgTranslateY,
          width: renderedSize.w,
          height: renderedSize.h,
          transition: isDragging ? 'none' : 'top 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        }}>
          {/* 原卷大图 */}
          <img
            ref={imgRef}
            src={task.image_url}
            alt="原卷"
            onLoad={handleImageLoad}
            style={{ display: 'block', width: '100%', height: '100%', userSelect: 'none', pointerEvents: 'none' }}
          />

          {/* 题号标记 - 基于实际渲染尺寸等比缩放 */}
          {validQuestions.map((q, i) => {
            const bbox = q.block_coordinates
            if (!bbox || !renderedSize.w || !imgNaturalSize.w) return null
            const isCurrent = i === currentIndex

            // 计算等比缩放比例：实际渲染尺寸 / 原始尺寸
            const ratioW = renderedSize.w / imgNaturalSize.w
            const ratioH = renderedSize.h / imgNaturalSize.h

            return (
              <div key={q.id} style={{
                position: 'absolute',
                left: bbox.x * ratioW,
                top: bbox.y * ratioH,
                width: bbox.width * ratioW,
                height: bbox.height * ratioH,
                border: `2.5px solid ${isCurrent ? '#2563EB' : 'rgba(255,255,255,0.35)'}`,
                borderRadius: '8px', pointerEvents: 'none', zIndex: 2,
                transition: 'border-color 0.3s, background 0.3s',
                background: isCurrent ? 'rgba(37,99,235,0.08)' : 'transparent'
              }}>
                <div style={{
                  position: 'absolute', left: '50%', top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: isCurrent ? 36 : 28, height: isCurrent ? 36 : 28,
                  borderRadius: '50%',
                  background: isCurrent ? COLORS.primary : 'rgba(255,255,255,0.88)',
                  color: isCurrent ? '#fff' : COLORS.text,
                  fontSize: isCurrent ? 15 : 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)', transition: 'all 0.3s'
                }}>
                  {i + 1}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── 主渲染 ──
  if (isPC) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(26,26,26,0.95)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden'
      }}>
        <div
          ref={containerElRef}
          style={{
            width: PC_CONTAINER_WIDTH, height: containerH,
            background: '#1a1a1a', overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 0 60px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          {renderExamImage()}
          {backButton}
          {panelContent}
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 10000, background: '#1a1a1a' }}>
      {renderExamImage()}
      {backButton}
      {panelContent}
    </div>
  )
}
