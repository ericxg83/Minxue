import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Save, Loader2, AlertTriangle, UserCheck, Clock, Trash2,
  ChevronUp, ChevronDown
} from 'lucide-react'
import { useWrongQuestionStore } from '../../store'
import { useToast } from '../../components/ToastProvider'
import {
  updateQuestion, addWrongQuestions, deleteWrongQuestion,
  getQuestionsByTask, invalidateCache, recalculateTaskStats,
  updateTaskStatus
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
const PANEL_MIN_HEIGHT = 220
const PANEL_TOP_MARGIN = 60
const PANEL_START_OFFSET = typeof window !== 'undefined' ? window.innerHeight - 80 : 600

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
      bg: '#F3F4F6', color: COLORS.textSecondary,
      text: '未知', icon: AlertTriangle,
      isGreyed: false, source: 'unknown'
    }
  }

  // 1. 已排除
  if (q.excluded) {
    return {
      bg: '#F3F4F6', color: COLORS.textSecondary,
      text: '已排除', icon: XCircle,
      isGreyed: true, source: 'excluded'
    }
  }

  const answerSource = q.answer_source || 'recognized'
  const isBlank = answerSource === 'blank'

  // 2. 未作答 — 学生未作答
  if (isBlank && q.is_correct === null) {
    return {
      bg: '#FFF3CD', color: COLORS.warning,
      text: '未作答', icon: AlertTriangle,
      isGreyed: false, source: 'not_answered'
    }
  }

  // 3. 正确 — AI或人工判定正确
  if (q.is_correct === true) {
    const source = q.status === 'correct' ? 'human' : 'ai'
    return {
      bg: source === 'human' ? '#D1FAE5' : '#DCFCE7',
      color: source === 'human' ? '#059669' : COLORS.success,
      text: source === 'human' ? '已打勾' : 'AI判定正确',
      icon: source === 'human' ? UserCheck : CheckCircle2,
      isGreyed: source === 'human',
      source
    }
  }

  // 4. 错误 — AI判定错误
  if (q.is_correct === false) {
    return {
      bg: '#FEE2E2', color: COLORS.danger,
      text: 'AI判定错误', icon: XCircle, source: 'ai_wrong'
    }
  }

  // 5. 未批改 — AI无法判定/待人工复审
  return {
    bg: '#EFF6FF', color: '#3B82F6',
    text: '未批改 / 待复审', icon: Clock, source: 'pending'
  }
}

// ── 主组件 ──
export default function ExamReview({ task, onClose, onSave }) {
  const { wrongQuestions } = useWrongQuestionStore()
  const Toast = useToast()

  // ── 所有 state hooks (必须在最顶部, 无条件分支) ──
  const [questions, setQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAnswer, setShowAnswer] = useState(false)
  const [panelH, setPanelH] = useState(PANEL_START_OFFSET)
  const [screenH, setScreenH] = useState(window.innerHeight)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 })
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  // 复审操作: 'correct' | 'wrong' | 'excluded' | null
  const [reviewAction, setReviewAction] = useState(null)

  // ── 所有 ref hooks ──
  const draggingRef = useRef(false)
  const startYRef = useRef(0)
  const startPanelHRef = useRef(0)
  const baseContainerRef = useRef(null)
  const imgRef = useRef(null)

  // ── 派生数据 (useMemo) ──
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

  // ── 窗口尺寸监听 ──
  useEffect(() => {
    const handler = () => setScreenH(window.innerHeight)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // ── 图片加载后计算初始缩放 (使用 requestAnimationFrame 避免渲染期 setState) ──
  useEffect(() => {
    if (!imageLoaded || !imgNaturalSize.w || !viewportSize.w) return
    const scaleX = viewportSize.w / imgNaturalSize.w
    const scaleY = viewportSize.h / imgNaturalSize.h
    const scale = Math.max(scaleX, scaleY)
    const offsetX = (viewportSize.w - imgNaturalSize.w * scale) / 2
    const offsetY = (viewportSize.h - imgNaturalSize.h * scale) / 2
    setTransform({ x: offsetX, y: offsetY, scale })
  }, [imageLoaded, imgNaturalSize, viewportSize])

  // ── 图片 onLoad 处理 (使用 ref + useEffect 避免渲染期 setState) ──
  const handleImageLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target
    setImgNaturalSize({ w: naturalWidth, h: naturalHeight })
    setImageLoaded(true)
  }, [])

  // 用 useEffect 监听 imgRef 变化来设置 viewportSize
  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setViewportSize({ w: rect.width, h: rect.height })
  }, [imgRef.current])

  // ── 题号切换: 平滑滚动到对应 bbox ──
  const jumpToQuestion = useCallback((index) => {
    setCurrentIndex(index)
    setShowAnswer(false)
    const q = validQuestions[index]
    if (!q?.block_coordinates || !baseContainerRef.current || !imgNaturalSize.w) return

    const bbox = q.block_coordinates
    const baseEl = baseContainerRef.current
    const containerW = baseEl.clientWidth
    const containerH = baseEl.clientHeight
    const scale = transform.scale
    const bboxCX = (bbox.x + bbox.width / 2) * scale
    const bboxCY = (bbox.y + bbox.height / 2) * scale

    let newX = transform.x + containerW / 2 - bboxCX
    let newY = transform.y + containerH / 2 - bboxCY

    const imgW = imgNaturalSize.w * scale
    const imgH = imgNaturalSize.h * scale
    newX = Math.min(0, Math.max(containerW - imgW, newX))
    newY = Math.min(0, Math.max(containerH - imgH, newY))

    baseEl.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    setTransform({ x: newX, y: newY, scale })
  }, [validQuestions, transform, imgNaturalSize])

  // ── 触摸拖拽手势 ──
  const handleTouchStart = useCallback((e) => {
    e.preventDefault()
    const touch = e.touches[0]
    startYRef.current = touch.clientY
    startPanelHRef.current = panelH
    draggingRef.current = true
  }, [panelH])

  const handleTouchMove = useCallback((e) => {
    if (!draggingRef.current) return
    e.preventDefault()
    const touch = e.touches[0]
    const delta = startYRef.current - touch.clientY
    const newH = startPanelHRef.current + delta
    setPanelH(Math.max(PANEL_MIN_HEIGHT, Math.min(screenH - PANEL_TOP_MARGIN, newH)))
  }, [screenH])

  const handleTouchEnd = useCallback(() => {
    draggingRef.current = false
  }, [])

  // ── Mouse 拖拽 (桌面端调试) ──
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    startYRef.current = e.clientY
    startPanelHRef.current = panelH
    draggingRef.current = true

    const onMouseMove = (ev) => {
      const delta = startYRef.current - ev.clientY
      const newH = startPanelHRef.current + delta
      setPanelH(Math.max(PANEL_MIN_HEIGHT, Math.min(screenH - PANEL_TOP_MARGIN, newH)))
    }
    const onMouseUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [panelH, screenH])

  // ── 设置复审操作 ──
  const handleSetReviewAction = useCallback((action) => {
    if (!currentQuestion?.id) return
    const qId = currentQuestion.id
    
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
  }, [currentQuestion, questions])

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

  // ── 计算派生状态 ──
  const correctness = useMemo(() => {
    if (!currentQuestion) return null
    if (edits[currentQuestion.id]?.is_correct !== undefined) {
      return edits[currentQuestion.id].is_correct
    }
    return currentQuestion.is_correct
  }, [currentQuestion, edits])

  const currentStudentAnswer = useMemo(() => {
    if (!currentQuestion) return ''
    if (edits[currentQuestion.id]?.student_answer !== undefined) {
      return edits[currentQuestion.id].student_answer
    }
    return currentQuestion.student_answer || currentQuestion.ai_answer || ''
  }, [currentQuestion, edits])

  const answerStatus = useMemo(() => {
    if (!currentQuestion) return 'pending'
    const answerSource = currentQuestion.answer_source || 'recognized'
    if (answerSource === 'blank') return 'not_answered'
    if (correctness === null) return 'pending'
    return correctness ? 'correct' : 'wrong'
  }, [currentQuestion, correctness])

  const statusInfo = useMemo(() => getStatusInfo(currentQuestion), [currentQuestion])
  const geoImageUrl = currentQuestion?.geometry_image_url || currentQuestion?.enhanced_geometry_image

  // ── 条件渲染 (所有 hooks 之后) ──
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

  if (!currentQuestion || validQuestions.length === 0) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: COLORS.card,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000, flexDirection: 'column', gap: '16px'
      }}>
        <div style={{ fontSize: '16px', color: COLORS.textSecondary }}>
          {validQuestions.length === 0 ? '暂无题目数据' : '题目数据加载异常'}
        </div>
        <button onClick={onClose} style={{
          padding: '12px 24px', background: COLORS.primary, color: '#fff',
          borderRadius: '12px', fontSize: '15px', fontWeight: 600,
          border: 'none', cursor: 'pointer'
        }}>返回</button>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 10000,
      background: '#1a1a1a',
      display: 'flex', justifyContent: 'center'
    }}>
      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: 480,
        height: '100%',
        overflow: 'hidden'
      }}>
      {/* ══════════════ 底层: 原卷大图画布 ═══════════════ */}
      <div
        ref={baseContainerRef}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      >
        <div
          style={{
            position: 'relative',
            width: imgNaturalSize.w || 0,
            height: imgNaturalSize.h || 0,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            transition: 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
          }}
        >
          {/* 原卷大图 */}
          <img
            ref={imgRef}
            src={task.image_url}
            alt="原卷"
            onLoad={handleImageLoad}
            style={{
              display: 'block',
              maxWidth: 'none',
              userSelect: 'none',
              pointerEvents: 'none'
            }}
          />

          {/* 题号标记 */}
          {validQuestions.map((q, i) => {
            const bbox = q.block_coordinates
            if (!bbox) return null
            const isCurrent = i === currentIndex
            return (
              <div
                key={q.id}
                style={{
                  position: 'absolute',
                  left: bbox.x,
                  top: bbox.y,
                  width: bbox.width,
                  height: bbox.height,
                  border: `2.5px solid ${isCurrent ? '#2563EB' : 'rgba(255,255,255,0.35)'}`,
                  borderRadius: '8px',
                  pointerEvents: 'none',
                  zIndex: 2,
                  transition: 'border-color 0.3s, background 0.3s',
                  background: isCurrent ? 'rgba(37,99,235,0.08)' : 'transparent'
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: isCurrent ? 36 : 28,
                  height: isCurrent ? 36 : 28,
                  borderRadius: '50%',
                  background: (() => {
                    if (isCurrent) return COLORS.primary
                    const s = getStatusInfo(q)
                    return s.source === 'ai' || s.source === 'human'
                      ? (q.is_correct === true ? '#16A34A' : '#EF4444')
                      : s.source === 'not_answered' ? '#F59E0B'
                      : s.source === 'excluded' ? '#9CA3AF'
                      : s.bg
                  })(),
                  color: isCurrent ? '#fff' : (() => {
                    const s = getStatusInfo(q)
                    return s.source === 'ai' || s.source === 'human'
                      ? (q.is_correct === true ? '#16A34A' : '#EF4444')
                      : s.source === 'not_answered' ? '#F59E0B'
                      : s.source === 'excluded' ? '#9CA3AF'
                      : s.color
                  })(),
                  fontSize: isCurrent ? 15 : 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                  transition: 'all 0.3s'
                }}>
                  {i + 1}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══════════════ 顶层: AI结果悬浮面板 ═══════════════ */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: panelH,
          zIndex: 10,
          touchAction: 'none',
          transition: 'height 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          borderRadius: '20px 20px 0 0',
          overflow: 'hidden',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* 面板背景 */}
        <div style={{
          position: 'absolute', inset: 0, background: COLORS.card, zIndex: 0
        }} />

        {/* ─ 拖拽手柄 ── */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          style={{
            position: 'relative',
            zIndex: 1,
            padding: '10px 16px 6px',
            cursor: 'grab',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: `1px solid ${COLORS.border}`
          }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: '#D1D5DB' }} />
        </div>

        {/* ── 题号导航条 ── */}
        <div style={{
          position: 'relative', zIndex: 1,
          padding: '8px 12px',
          display: 'flex', gap: '6px',
          overflowX: 'auto', flexShrink: 0,
          scrollbarWidth: 'none'
        }}>
          {validQuestions.map((q, i) => {
            const info = getStatusInfo(q)
            let bg = COLORS.warning
            if (q.is_correct === true) bg = info.isGreyed ? '#D1FAE5' : COLORS.success
            else if (q.is_correct === false) bg = COLORS.danger
            if (i === currentIndex) bg = COLORS.primary
            return (
              <button
                key={q.id}
                onClick={() => jumpToQuestion(i)}
                style={{
                  minWidth: '32px', height: '32px', borderRadius: '16px',
                  background: bg, color: '#fff', border: 'none',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'transform 0.15s',
                  transform: i === currentIndex ? 'scale(1.15)' : 'scale(1)',
                  opacity: info.isGreyed ? 0.7 : 1
                }}
              >
                {i + 1}
              </button>
            )
          })}
        </div>

        {/* ── 面板内容区 ── */}
        <div style={{
          position: 'relative', zIndex: 1,
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: '4px 16px 20px'
        }}>
          {/* 题号标题 */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '6px', flexWrap: 'wrap', gap: '4px'
          }}>
            <div>
              <span style={{ fontSize: '14px', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>
                第 {currentIndex + 1} 题
              </span>
              <span style={{ fontSize: '12px', color: COLORS.textSecondary }}>
                {currentQuestion?.question_type === 'choice' ? '选择题' :
                 currentQuestion?.question_type === 'fill' ? '填空题' : '解答题'}
              </span>
            </div>
            <div style={{
              fontSize: '12px', padding: '3px 10px', borderRadius: '10px',
              display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
              background: statusInfo.bg, color: statusInfo.color
            }}>
              <statusInfo.icon size={12} />
              {statusInfo.text}
              {currentQuestion && wrongIdMap[currentQuestion.id] && statusInfo.source !== 'excluded' && (
                <span style={{ fontSize: '10px', opacity: 0.8 }}>(已加入错题本)</span>
              )}
            </div>
          </div>

          {/* 题干 */}
          <div style={{
            fontSize: '14.5px', color: COLORS.text,
            lineHeight: '1.65', marginBottom: '8px'
          }}>
            <MathText content={currentQuestion?.content || ''} />
          </div>

          {/* 选项 */}
          {currentQuestion?.options?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              {currentQuestion.options.map((opt, i) => (
                <div key={i} style={{
                  fontSize: '13px', color: COLORS.text,
                  padding: '4px 8px', background: COLORS.background, borderRadius: '6px'
                }}>
                  {formatOption(opt, i)}
                </div>
              ))}
            </div>
          )}

          {/* 几何配图 */}
          {geoImageUrl && (
            <div style={{
              marginBottom: '8px', background: '#FAFAFA',
              borderRadius: '8px', padding: '8px', border: '1px solid #E5E7EB'
            }}>
              <img
                src={geoImageUrl}
                alt="几何配图"
                style={{
                  width: '100%', maxHeight: '20vh',
                  objectFit: 'contain', borderRadius: '6px', display: 'block'
                }}
              />
            </div>
          )}

          {/* 答案对比区 */}
          <div style={{
            background: COLORS.background, borderRadius: '8px', padding: '8px 10px',
            marginBottom: '8px'
          }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>学生答案</div>
                <input
                  type="text"
                  value={currentStudentAnswer || ''}
                  onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                  placeholder={answerStatus === 'not_answered' ? '未作答' : '输入...'}
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: '5px',
                    border: `1px solid ${answerStatus === 'not_answered' ? COLORS.warning : COLORS.border}`,
                    fontSize: '13px', color: COLORS.text, outline: 'none',
                    boxSizing: 'border-box', background: COLORS.card
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>参考答案</div>
                <input
                  type="text"
                  value={edits[currentQuestion?.id]?.answer ?? currentQuestion?.answer ?? ''}
                  onChange={(e) => handleAnswerEdit(currentQuestion?.id, e.target.value)}
                  placeholder="输入..."
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: '5px',
                    border: `1px solid ${COLORS.border}`,
                    fontSize: '13px', color: COLORS.text,
                    outline: 'none', boxSizing: 'border-box', background: COLORS.card
                  }}
                />
              </div>
            </div>

            {/* 人工评判 */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => handleSetReviewAction('correct')}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: '8px',
                  border: (reviewAction === 'correct') ? '2px solid #16A34A' : '1px solid #E5E7EB',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  background: (reviewAction === 'correct') ? '#DCFCE7' : COLORS.card,
                  color: (reviewAction === 'correct') ? '#16A34A' : '#15803D',
                }}
              >
                <CheckCircle2 size={14} /> 正确
              </button>
              <button
                onClick={() => handleSetReviewAction('wrong')}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: '8px',
                  border: (reviewAction === 'wrong') ? '2px solid #EF4444' : '1px solid #E5E7EB',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  background: (reviewAction === 'wrong') ? '#FEE2E2' : COLORS.card,
                  color: (reviewAction === 'wrong') ? '#EF4444' : '#9CA3AF',
                }}
              >
                <XCircle size={14} /> 错误
              </button>
            </div>
            {/* 排除本题 */}
            <div style={{ marginTop: '6px' }}>
              <button
                onClick={() => handleSetReviewAction('excluded')}
                style={{
                  width: '100%', padding: '8px 0', borderRadius: '8px',
                  border: (reviewAction === 'excluded') ? '2px solid #EF4444' : '1px solid #FEE2E2',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  background: (reviewAction === 'excluded') ? '#FFF1F0' : '#FFF8F5',
                  color: (reviewAction === 'excluded') ? '#EF4444' : '#DC2626',
                }}
              >
                <Trash2 size={14} /> 排除本题
              </button>
            </div>
          </div>

          {/* 解析 */}
          <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: '8px' }}>
            <button
              onClick={() => setShowAnswer(!showAnswer)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '12px', color: COLORS.textSecondary, padding: 0, width: '100%',
                justifyContent: 'flex-start'
              }}
            >
              {showAnswer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span style={{ fontWeight: 500 }}>
                {showAnswer ? '收起解析' : '查看解析'}
              </span>
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

        {/* ── 底部操作栏 ─ */}
        <div style={{
          position: 'relative', zIndex: 1,
          padding: '8px 12px',
          display: 'flex', gap: '8px', flexShrink: 0,
          borderTop: `1px solid ${COLORS.border}`,
          background: COLORS.card
        }}>
          <button
            onClick={() => jumpToQuestion(currentIndex - 1)}
            disabled={currentIndex === 0}
            style={{
              flex: 1, padding: '8px', borderRadius: '8px',
              border: `1px solid ${COLORS.border}`,
              background: COLORS.card, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
              fontSize: '13px', color: currentIndex === 0 ? '#CCC' : COLORS.textSecondary,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}
          >
            <ChevronLeft size={14} /> 上一题
          </button>
          <button
            onClick={handleSaveClick}
            disabled={saving || Object.keys(edits).length === 0}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none',
              background: (saving || Object.keys(edits).length === 0) ? '#93C5FD' : COLORS.primary,
              color: '#fff', cursor: (saving || Object.keys(edits).length === 0) ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
              flexShrink: 0
            }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            保存
          </button>
          <button
            onClick={() => jumpToQuestion(currentIndex + 1)}
            disabled={currentIndex >= validQuestions.length - 1}
            style={{
              flex: 1, padding: '8px', borderRadius: '8px',
              border: `1px solid ${COLORS.border}`,
              background: COLORS.card,
              cursor: currentIndex >= validQuestions.length - 1 ? 'not-allowed' : 'pointer',
              fontSize: '13px', color: currentIndex >= validQuestions.length - 1 ? '#CCC' : COLORS.textSecondary,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}
          >
            下一题 <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* 返回按钮 */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 15,
          background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
          width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#fff', backdropFilter: 'blur(4px)'
        }}
      >
        <ArrowLeft size={20} />
      </button>
      </div>
    </div>
  )
}
