import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Save, Loader2, Trash2, ChevronUp, ChevronDown
} from 'lucide-react'
import MathText from '../../components/MathText'
import { COLORS, PANEL_MIN_HEIGHT, PANEL_TOP_MARGIN, PANEL_START_OFFSET } from './constants'
import { formatOption, getStatusInfo, DOT_COLORS, StatChip } from './status'
import { useExamReview } from '../../hooks/useExamReview'

// ── 主组件 ──
export default function ExamReview({ task, onClose, onSave }) {
  // ── 所有 state hooks (必须在最顶部, 无条件分支) ──
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [panelH, setPanelH] = useState(PANEL_START_OFFSET)
  const [screenH, setScreenH] = useState(window.innerHeight)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 })
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })

  // ── 所有 ref hooks ──
  const draggingRef = useRef(false)
  const startYRef = useRef(0)
  const startPanelHRef = useRef(0)
  const baseContainerRef = useRef(null)
  const imgRef = useRef(null)
  const currentIndexRef = useRef(0)
  currentIndexRef.current = currentIndex

  // ── 复审核心逻辑 (数据加载 / 人工评判 / 保存) ──
  const {
    validQuestions,
    wrongIdMap,
    loading,
    edits,
    saving,
    reviewAction,
    stats,
    handleSetReviewAction,
    handleAnswerChange,
    handleAnswerEdit,
    handleSaveClick
  } = useExamReview({ task, onSave, currentIndexRef })

  const currentQuestion = validQuestions[currentIndex] || null

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
    // block_coordinates 为归一化 0-1000 坐标，先换算为图片像素再计算中心
    const bboxPxX = bbox.x / 1000 * imgNaturalSize.w
    const bboxPxY = bbox.y / 1000 * imgNaturalSize.h
    const bboxPxW = bbox.width / 1000 * imgNaturalSize.w
    const bboxPxH = bbox.height / 1000 * imgNaturalSize.h
    const bboxCX = (bboxPxX + bboxPxW / 2) * scale
    const bboxCY = (bboxPxY + bboxPxH / 2) * scale

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
        <div style={{ fontSize: 'var(--fs-16)', color: COLORS.textSecondary }}>
          {validQuestions.length === 0 ? '暂无题目数据' : '题目数据加载异常'}
        </div>
        <button onClick={onClose} style={{
          padding: '12px 24px', background: COLORS.primary, color: '#fff',
          borderRadius: 'var(--radius-12)', fontSize: 'var(--fs-15)', fontWeight: 600,
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
            if (!bbox || !imgNaturalSize.w || !imgNaturalSize.h) return null
            // block_coordinates 为归一化 0-1000 坐标，按图片自然尺寸换算为像素
            const px = {
              left: bbox.x / 1000 * imgNaturalSize.w,
              top: bbox.y / 1000 * imgNaturalSize.h,
              width: bbox.width / 1000 * imgNaturalSize.w,
              height: bbox.height / 1000 * imgNaturalSize.h
            }
            const isCurrent = i === currentIndex
            return (
              <div
                key={q.id}
                style={{
                  position: 'absolute',
                  left: px.left,
                  top: px.top,
                  width: px.width,
                  height: px.height,
                  border: `2.5px solid ${isCurrent ? 'var(--primary)' : 'rgba(255,255,255,0.35)'}`,
                  borderRadius: 'var(--radius-8)',
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
                  borderRadius: 'var(--radius-full)',
                  background: (() => {
                    if (isCurrent) return COLORS.primary
                    const s = getStatusInfo(q)
                    return DOT_COLORS[s.source] || COLORS.warning
                  })(),
                  color: '#fff',
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
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
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
          <div style={{ width: 40, height: 4, borderRadius: 'var(--radius-2)', background: 'var(--border)' }} />
        </div>

        {/* ── 顶部统计 ── */}
        <div style={{
          position: 'relative', zIndex: 1,
          padding: '6px 12px',
          display: 'flex', flexWrap: 'wrap', gap: '6px',
          borderBottom: `1px solid ${COLORS.border}`,
          flexShrink: 0
        }}>
          <StatChip label="待人工复核" count={stats.uncertain} color={COLORS.warning} bg="var(--warning-soft)" />
          <StatChip label="AI异常" count={stats.error} color="var(--warning)" bg="var(--warning-soft)" />
          <StatChip label="AI正确" count={stats.ai_correct} color={COLORS.success} bg="var(--success-soft)" />
          <StatChip label="AI错误" count={stats.ai_wrong} color={COLORS.danger} bg="var(--danger-soft)" />
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
            const dotColor = DOT_COLORS[info.source] || COLORS.warning
            const isCurrent = i === currentIndex
            return (
              <button
                key={q.id}
                onClick={() => jumpToQuestion(i)}
                title={info.text}
                style={{
                  minWidth: '32px', height: '32px', borderRadius: 'var(--radius-16)',
                  background: isCurrent ? COLORS.primary : dotColor,
                  color: '#fff', border: 'none',
                  fontSize: 'var(--fs-13)', fontWeight: 600, cursor: 'pointer',
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'transform 0.15s',
                  transform: isCurrent ? 'scale(1.15)' : 'scale(1)',
                  opacity: info.isGreyed ? 0.6 : 1
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
              <span style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>
                第 {currentIndex + 1} 题
              </span>
              {currentQuestion?.question_number && (
                <span style={{
                  fontSize: 'var(--fs-11)', color: '#fff', background: COLORS.primary,
                  padding: '1px 6px', borderRadius: 'var(--radius-4)', marginRight: '6px'
                }}>
                  原卷题号 {currentQuestion.question_number}
                </span>
              )}
              <span style={{ fontSize: 'var(--fs-12)', color: COLORS.textSecondary }}>
                {currentQuestion?.question_type === 'choice' ? '选择题' :
                 currentQuestion?.question_type === 'fill' ? '填空题' :
                 currentQuestion?.question_type === 'judge' ? '判断题' : '解答题'}
              </span>
            </div>
            <div style={{
              fontSize: 'var(--fs-12)', padding: '3px 10px', borderRadius: 'var(--radius-sm)',
              display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
              background: statusInfo.bg, color: statusInfo.color
            }}>
              <statusInfo.icon size={12} />
              {statusInfo.text}
              {currentQuestion && wrongIdMap[currentQuestion.id] && statusInfo.source !== 'excluded' && (
                <span style={{ fontSize: 'var(--fs-10)', opacity: 0.8 }}>(已加入错题本)</span>
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
                  fontSize: 'var(--fs-13)', color: COLORS.text,
                  padding: '4px 8px', background: COLORS.background, borderRadius: 'var(--radius-6)'
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
              borderRadius: 'var(--radius-8)', padding: '8px', border: '1px solid var(--border-light)'
            }}>
              <img
                src={geoImageUrl}
                alt="几何配图"
                style={{
                  width: '100%', maxHeight: '20vh',
                  objectFit: 'contain', borderRadius: 'var(--radius-6)', display: 'block'
                }}
              />
            </div>
          )}

          {/* 答案对比区 */}
          <div style={{
            background: COLORS.background, borderRadius: 'var(--radius-8)', padding: '8px 10px',
            marginBottom: '8px'
          }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-11)', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>学生答案</div>
                <input
                  type="text"
                  value={currentStudentAnswer || ''}
                  onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
                  placeholder={answerStatus === 'not_answered' ? '未作答' : '输入...'}
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: 'var(--radius-5)',
                    border: `1px solid ${answerStatus === 'not_answered' ? COLORS.warning : COLORS.border}`,
                    fontSize: 'var(--fs-13)', color: COLORS.text, outline: 'none',
                    boxSizing: 'border-box', background: COLORS.card
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-11)', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>参考答案</div>
                <input
                  type="text"
                  value={edits[currentQuestion?.id]?.answer ?? currentQuestion?.answer ?? ''}
                  onChange={(e) => handleAnswerEdit(currentQuestion?.id, e.target.value)}
                  placeholder="输入..."
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: 'var(--radius-5)',
                    border: `1px solid ${COLORS.border}`,
                    fontSize: 'var(--fs-13)', color: COLORS.text,
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
                  flex: 1, padding: '8px 0', borderRadius: 'var(--radius-8)',
                  border: (reviewAction === 'correct') ? '2px solid var(--success)' : '1px solid var(--border-light)',
                  cursor: 'pointer', fontSize: 'var(--fs-13)', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  background: (reviewAction === 'correct') ? 'var(--success-soft)' : COLORS.card,
                  color: (reviewAction === 'correct') ? 'var(--success)' : 'var(--success)',
                }}
              >
                <CheckCircle2 size={14} /> 正确
              </button>
              <button
                onClick={() => handleSetReviewAction('wrong')}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 'var(--radius-8)',
                  border: (reviewAction === 'wrong') ? '2px solid var(--danger)' : '1px solid var(--border-light)',
                  cursor: 'pointer', fontSize: 'var(--fs-13)', fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  background: (reviewAction === 'wrong') ? 'var(--danger-soft)' : COLORS.card,
                  color: (reviewAction === 'wrong') ? 'var(--danger)' : 'var(--text-secondary)',
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
                  width: '100%', padding: '8px 0', borderRadius: 'var(--radius-8)',
                  border: (reviewAction === 'excluded') ? '2px solid var(--danger)' : '1px solid var(--danger-soft)',
                  cursor: 'pointer', fontSize: 'var(--fs-13)', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  background: (reviewAction === 'excluded') ? '#FFF1F0' : '#FFF8F5',
                  color: (reviewAction === 'excluded') ? 'var(--danger)' : 'var(--danger)',
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
                fontSize: 'var(--fs-12)', color: COLORS.textSecondary, padding: 0, width: '100%',
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
                <div style={{ padding: '8px 10px', background: `${COLORS.success}08`, borderRadius: 'var(--radius-6)' }}>
                  <div style={{ fontSize: 'var(--fs-13)', color: COLORS.text, lineHeight: '1.6' }}>
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
              flex: 1, padding: '8px', borderRadius: 'var(--radius-8)',
              border: `1px solid ${COLORS.border}`,
              background: COLORS.card, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
              fontSize: 'var(--fs-13)', color: currentIndex === 0 ? '#CCC' : COLORS.textSecondary,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}
          >
            <ChevronLeft size={14} /> 上一题
          </button>
          <button
            onClick={handleSaveClick}
            disabled={saving || Object.keys(edits).length === 0}
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius-8)', border: 'none',
              background: (saving || Object.keys(edits).length === 0) ? 'var(--primary-soft)' : COLORS.primary,
              color: '#fff', cursor: (saving || Object.keys(edits).length === 0) ? 'not-allowed' : 'pointer',
              fontSize: 'var(--fs-13)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
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
              flex: 1, padding: '8px', borderRadius: 'var(--radius-8)',
              border: `1px solid ${COLORS.border}`,
              background: COLORS.card,
              cursor: currentIndex >= validQuestions.length - 1 ? 'not-allowed' : 'pointer',
              fontSize: 'var(--fs-13)', color: currentIndex >= validQuestions.length - 1 ? '#CCC' : COLORS.textSecondary,
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
          background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 'var(--radius-full)',
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
