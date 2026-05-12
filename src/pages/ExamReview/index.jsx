import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle2, XCircle, ArrowLeft, Save, RotateCcw, Loader2 } from 'lucide-react'
import { useWrongQuestionStore } from '../../store'
import { useToast } from '../../components/ToastProvider'
import { addWrongQuestions, deleteWrongQuestion } from '../../services/apiService'
import { validateAnnotationPipeline } from '../../utils/coordinateValidator'
import { computeAnnotationLayout, iconTransformString } from '../../utils/annotationLayout'
import { formalizeBoundingBoxes, generateBoundingBoxReport } from '../../utils/boundingBoxDetector'
import { diagnoseBlocks, fixBoundingBoxes } from '../../utils/bboxFixer'
import dayjs from 'dayjs'

const COLORS = {
  CORRECT: '#34C759',
  WRONG: '#FF3B30',
  CORRECT_BG: 'rgba(52,199,89,0.06)',
  WRONG_BG: 'rgba(255,59,48,0.06)',
  CORRECT_BORDER: 'rgba(52,199,89,0.25)',
  WRONG_BORDER: 'rgba(255,59,48,0.25)',
}

export default function ExamReview({ task, onClose }) {
  const { wrongQuestions, addWrongQuestion, removeWrongQuestion } = useWrongQuestionStore()
  const Toast = useToast()

  const [rawQuestions, setRawQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [blocks, setBlocks] = useState([])
  const [modifiedIds, setModifiedIds] = useState(new Set())
  const [saving, setSaving] = useState(false)

  // Fetch questions
  useEffect(() => {
    if (!task?.id) return
    const fetchQuestions = async () => {
      try {
        setLoading(true)
        const { getQuestionsByTask } = await import('../../services/apiService')
        const questions = (await getQuestionsByTask(task.id, false)).map((q, i) => ({
          ...q,
          original_is_correct: q.is_correct,
          _index: i
        }))
        setRawQuestions(questions)
      } catch (e) {
        console.error('获取题目失败:', e)
        setRawQuestions([])
      } finally {
        setLoading(false)
      }
    }
    fetchQuestions()
  }, [task?.id])

  // Image transform state
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  // Pinch state
  const lastPinchRef = useRef(null)
  const initialScaleRef = useRef(1)

  const containerRef = useRef(null)
  const [imageNaturalSize, setImageNaturalSize] = useState(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // Refs for latest values
  const dragDistanceRef = useRef(0)
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const positionRef = useRef(position)
  positionRef.current = position
  const containerSizeRef = useRef(containerSize)
  containerSizeRef.current = containerSize

  const MIN_SCALE = 0.5
  const MAX_SCALE = 5

  // Track container size (runs when loading is done and containerRef is attached)
  useEffect(() => {
    if (loading) return
    const el = containerRef.current
    if (!el) return
    setContainerSize({ width: Math.round(el.offsetWidth), height: Math.round(el.offsetHeight) })
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      const roundedW = Math.round(width)
      const roundedH = Math.round(height)
      setContainerSize(prev => (prev.width === roundedW && prev.height === roundedH) ? prev : { width: roundedW, height: roundedH })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading])

  // Initialize blocks
  useEffect(() => {
    if (rawQuestions.length === 0) return

    const mapped = rawQuestions.map((q, i) => {
      const coords = q.block_coordinates || {}
      return {
        id: q.id || `q-${i}`,
        number: i + 1,
        isCorrect: q.is_correct,
        originalIsCorrect: q.is_correct,
        blockCoordinates: coords,
        wrongQuestionId: null
      }
    })

    const wqMap = new Map()
    ;(Array.isArray(wrongQuestions) ? wrongQuestions : []).forEach(wq => {
      if (wq.question_id) wqMap.set(wq.question_id, wq)
    })
    mapped.forEach(block => {
      const wq = wqMap.get(block.id)
      if (wq) block.wrongQuestionId = wq.id
    })

    setBlocks(mapped)
  }, [rawQuestions, wrongQuestions])

  // ── Stage 1: Image preload ──────────────────────────────────────────────
  useEffect(() => {
    if (!task?.image_url) return
    console.log('[Stage 1/5] Loading image:', task.image_url)
    const img = new Image()
    img.onload = () => {
      const size = { width: img.naturalWidth, height: img.naturalHeight }
      console.log(`[Stage 1/5] Image loaded: ${size.width} × ${size.height}px`)
      setImageNaturalSize(size)
    }
    img.onerror = () => {
      console.error('[Stage 1/5] Failed to load review image:', task.image_url)
    }
    img.src = task.image_url
  }, [task?.image_url])

  // ── Stage 2: Coordinate validation ──────────────────────────────────────
  // Run the validation pipeline whenever blocks or image size change.
  // This produces validBlocks (to render) and invalidBlocks (filtered out).
  const {
    validBlocks: validatedBlocks,
    invalidBlocks,
    report: validationReport,
  } = useMemo(() => {
    console.log('[Stage 2/5] Running coordinate validation pipeline...')
    const result = validateAnnotationPipeline(blocks, imageNaturalSize)
    return result
  }, [blocks, imageNaturalSize])

  // ── Stage 2.5: Bounding box diagnosis + auto-fix ──────────────────────
  // Detect zero/negative dimensions, out-of-order blocks, and overlapping
  // boxes. Auto-fix what we can: de-overlap Y positions, reorder by Y,
  // estimate missing dimensions from peers.
  const fixedBlocks = useMemo(() => {
    if (!validatedBlocks.length || !imageNaturalSize) return validatedBlocks
    console.log('[Stage 2.5/5] Diagnosing and fixing bounding boxes...')
    const diagnosis = diagnoseBlocks(validatedBlocks, imageNaturalSize)
    console.log(diagnosis.summary)

    const hasIssues =
      diagnosis.zeroDimensions.length +
      diagnosis.negativeDimensions.length +
      diagnosis.outOfOrder.length +
      diagnosis.overlapping.length > 0

    if (!hasIssues) {
      console.log('[Stage 2.5/5] All bounding boxes healthy — no fixes needed.')
      return validatedBlocks
    }

    try {
      const { fixed, report, changes } = fixBoundingBoxes(validatedBlocks, imageNaturalSize, {
        fixOverlaps: true,
        fixOutOfOrder: false,
        fixZeroDims: true,
      })
      console.log(report)
      console.log(`[Stage 2.5/5] Applied ${changes.length} fix(es).`)
      return fixed
    } catch (err) {
      console.error('[Stage 2.5/5] Fix failed — falling back to validated blocks:', err)
      return validatedBlocks
    }
  }, [validatedBlocks, imageNaturalSize])

  // ── Stage 3: Bounding box detection ─────────────────────────────────────
  // Formalize (potentially fixed) coordinates as bounding boxes and compute
  // safe-zone margins where annotations can be placed.
  const boundingBoxes = useMemo(() => {
    if (!fixedBlocks.length || !imageNaturalSize) return []
    console.log('[Stage 3/5] Detecting bounding boxes...')
    const result = formalizeBoundingBoxes(fixedBlocks, imageNaturalSize)
    const report = generateBoundingBoxReport(result)
    console.log(report)
    return result
  }, [fixedBlocks, imageNaturalSize])

  // ── Stage 4: Rendering preparation ──────────────────────────────────────
  // Log a summary of what enters the renderer.
  useEffect(() => {
    if (fixedBlocks.length === 0 && invalidBlocks.length === 0) return

    const totalBlocks = fixedBlocks.length + invalidBlocks.length
    console.log(
      `[Stage 5/5] Rendering pipeline: ${fixedBlocks.length} valid of ${totalBlocks} total block(s)`
    )
    if (invalidBlocks.length > 0) {
      console.warn(
        `[Stage 5/5] FILTERED ${invalidBlocks.length} block(s) with invalid coordinates — ` +
        'they are excluded from rendering to prevent stacking.'
      )
    } else {
      console.log('[Stage 5/5] All blocks valid — rendering normally.')
    }

    // Log positional diversity: confirm blocks land at different positions
    if (fixedBlocks.length > 1) {
      const positions = fixedBlocks.map(b => {
        const c = b.blockCoordinates
        return c ? `(${c.x}, ${c.y})` : '(no coords)'
      })
      const uniquePositions = new Set(positions)
      if (uniquePositions.size < positions.length) {
        console.warn(
          `[Stage 5/5] POSITION COLLISION: ${positions.length - uniquePositions.size} block(s) ` +
          'share the same (x, y) — overlapping annotations expected.'
        )
      } else {
        console.log(`[Stage 5/5] All ${positions.length} blocks have unique (x, y) positions.`)
      }
    }
  }, [fixedBlocks.length, invalidBlocks])

  // Compute "contain" fit: how the image is actually displayed within the container
  const containFit = useMemo(() => {
    if (!imageNaturalSize || containerSize.width === 0 || containerSize.height === 0) return null
    const { width: imgW, height: imgH } = imageNaturalSize
    const { width: contW, height: contH } = containerSize
    const imgAspect = imgW / imgH
    const contAspect = contW / contH
    let displayW, displayH, offsetX, offsetY
    if (imgAspect > contAspect) {
      displayW = contW
      displayH = contW / imgAspect
      offsetX = 0
      offsetY = (contH - displayH) / 2
    } else {
      displayH = contH
      displayW = contH * imgAspect
      offsetY = 0
      offsetX = (contW - displayW) / 2
    }
    return { width: displayW, height: displayH, offsetX, offsetY }
  }, [imageNaturalSize, containerSize])

  const containFitRef = useRef(containFit)
  containFitRef.current = containFit

  // ── Compute block overlay styles ---
  // Convert image-pixel coordinates to percentages of the CONTAINER,
  // accounting for the contain-fit offset and size.
  const getBlockStyle = useCallback((block) => {
    const coords = block.blockCoordinates
    if (!coords || !imageNaturalSize || !containFit) {
      // Fallback grid layout — should only trigger during initial load
      // before the image is fully ready; after validation, all rendered
      // blocks should have valid coords.
      console.warn(
        `[Fallback] Block #${block.number} lacks coordinates or image context — ` +
        'using grid layout as safety net.'
      )
      const cols = Math.ceil(Math.sqrt(blocks.length))
      const row = Math.floor((block.number - 1) / cols)
      const col = (block.number - 1) % cols
      return {
        left: `${(col / cols) * 100}%`,
        top: `${(row / Math.ceil(blocks.length / cols)) * 100}%`,
        width: `${100 / cols}%`,
        height: `${100 / Math.ceil(blocks.length / cols)}%`
      }
    }

    const imgW = imageNaturalSize.width
    const imgH = imageNaturalSize.height
    const { width: displayW, height: displayH, offsetX, offsetY } = containFit
    const contW = containerSize.width
    const contH = containerSize.height

    // Map pixel coords → display coords → container percentage
    const left = (offsetX + (coords.x || 0) / imgW * displayW) / contW * 100
    const top = (offsetY + (coords.y || 0) / imgH * displayH) / contH * 100
    const width = ((coords.width || 100) / imgW * displayW) / contW * 100
    const height = ((coords.height || 100) / imgH * displayH) / contH * 100

    return {
      left: `${left}%`,
      top: `${top}%`,
      width: `${width}%`,
      height: `${height}%`
    }
  }, [blocks.length, imageNaturalSize, containFit, containerSize])

  // ── Stage 4: Collision avoidance (right-side anchoring) ─────────────
  // Icons/labels anchored to the RIGHT of each (fixed) block. Vertical-only
  // collision avoidance staggers overlapping items.
  const annotationLayout = useMemo(() => {
    if (!containerSize.width || fixedBlocks.length === 0) {
      return { annotations: [], groups: [], stats: null, debug: { guideLines: [], severityColors: [] } }
    }
    console.log(`[Stage 4/5] Computing right-side anchored layout for ${fixedBlocks.length} annotations...`)
    try {
      const result = computeAnnotationLayout(fixedBlocks, getBlockStyle, containerSize)
      if (result.stats) {
        console.log(
          `[CollisionAvoidance] ${result.stats.totalAnnotations} annotations anchored right | ` +
          `overlap: ${result.stats.overlappingCount} (mild=${result.stats.mildCount}, ` +
          `heavy=${result.stats.heavyCount}, stacked=${result.stats.stackedCount})`
        )
        if (result.stats.overlappingCount > 0) {
          console.warn('[CollisionAvoidance] Applying vertical-only stagger for overlapping annotations.')
        }
      }
      return result
    } catch (err) {
      console.error('[CollisionAvoidance] Layout computation failed:', err)
      return { annotations: [], groups: [], stats: null, debug: { guideLines: [], severityColors: [] } }
    }
  }, [fixedBlocks, getBlockStyle, containerSize])

  // Build an efficient lookup map: block.id → annotation layout data
  const layoutMap = useMemo(() => {
    return new Map(annotationLayout.annotations.map(a => [a.block.id, a]))
  }, [annotationLayout.annotations])

  const [showDebugLayout, setShowDebugLayout] = useState(false)


  // --- Toggle block ---
  const handleToggleBlock = (block) => {
    const newIsCorrect = !block.isCorrect

    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, isCorrect: newIsCorrect } : b
    ))

    if (newIsCorrect !== block.originalIsCorrect) {
      setModifiedIds(prev => new Set(prev).add(block.id))
    } else {
      setModifiedIds(prev => {
        const next = new Set(prev)
        next.delete(block.id)
        return next
      })
    }

    Toast.show({
      message: `第 ${block.number} 题 → ${newIsCorrect ? '✓ 正确' : '✗ 错误'}`,
      type: newIsCorrect ? 'success' : 'error',
      duration: 800
    })
  }

  // --- Save ---
  const handleSave = async () => {
    if (modifiedIds.size === 0) {
      Toast.show({ message: '没有修改需要保存', type: 'info' })
      return
    }

    setSaving(true)
    const changedBlocks = blocks.filter(b => modifiedIds.has(b.id))

    const toAddBlocks = changedBlocks.filter(b => !b.isCorrect && !b.wrongQuestionId)
    const toRemoveBlocks = changedBlocks.filter(b => b.isCorrect && b.wrongQuestionId)

    let addedCount = 0
    let removedCount = 0

    try {
      // Run adds and removes in parallel
      const promises = []

      if (toAddBlocks.length > 0) {
        const idsToAdd = toAddBlocks.map(b => b.id)
        promises.push(
          (async () => {
            try {
              await addWrongQuestions(task.student_id, idsToAdd)
              addedCount = idsToAdd.length

              toAddBlocks.forEach(block => {
                const rawQ = rawQuestions.find(q => q.id === block.id) || {}
                addWrongQuestion({
                  id: `wq-manual-${block.id}`,
                  question_id: block.id,
                  student_id: task.student_id,
                  question: {
                    id: block.id,
                    content: rawQ.content || '',
                    answer: rawQ.answer || '',
                    question_type: rawQ.question_type || 'choice',
                    subject: rawQ.subject || '数学',
                    ai_tags: rawQ.ai_tags || [],
                    tags_source: 'ai'
                  },
                  task_id: task.id,
                  status: 'pending',
                  error_count: 1,
                  subject: rawQ.subject || '数学',
                  added_at: dayjs().toISOString(),
                  source: 'manual_review',
                  grading_source: 'manual'
                })
                block.wrongQuestionId = `wq-manual-${block.id}`
              })
            } catch (e) {
              console.error('批量添加错题失败:', e)
            }
          })()
        )
      }

      for (const block of toRemoveBlocks) {
        promises.push(
          (async () => {
            try {
              await deleteWrongQuestion(block.wrongQuestionId)
              removeWrongQuestion(block.wrongQuestionId)
              removedCount++
            } catch (e) {
              console.error('移出错题失败:', e)
            }
          })()
        )
      }

      await Promise.all(promises)

      setModifiedIds(new Set())
      setBlocks(prev => prev.map(b => ({
        ...b,
        originalIsCorrect: b.isCorrect
      })))

      Toast.show({
        message: `保存成功！新增 ${addedCount} 道错题，移除 ${removedCount} 道错题`,
        type: 'success',
        duration: 2500
      })

      setTimeout(() => onClose?.(), 800)
    } catch (error) {
      console.error('保存复审结果失败:', error)
      Toast.show({ message: '保存失败，请重试', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // --- Pan/Drag (mouse + touch) ---
  const handlePointerDown = (e) => {
    dragDistanceRef.current = 0
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
    try { e.target.setPointerCapture(e.pointerId) } catch (_) {}
  }

  const handlePointerMove = (e) => {
    if (!isDragging) return
    const newX = e.clientX - dragStart.x
    const newY = e.clientY - dragStart.y
    dragDistanceRef.current += Math.abs(newX - position.x) + Math.abs(newY - position.y)
    setPosition({ x: newX, y: newY })
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  // --- Wheel zoom ---
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const delta = e.deltaY > 0 ? -0.15 : 0.15
    setScale(prev => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta))
      const ratio = newScale / prev
      setPosition(p => ({
        x: mouseX - (mouseX - p.x) * ratio,
        y: mouseY - (mouseY - p.y) * ratio
      }))
      return newScale
    })
  }, [])

  // --- Touch pinch zoom ---
  const getTouchDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const getTouchMidpoint = (touches) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  })

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      lastPinchRef.current = getTouchDistance(e.touches)
      initialScaleRef.current = scale
      setIsDragging(false)
    }
  }

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && lastPinchRef.current) {
      e.preventDefault()
      const currentDist = getTouchDistance(e.touches)
      const ratio = currentDist / lastPinchRef.current
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialScaleRef.current * ratio))

      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const mid = getTouchMidpoint(e.touches)
        const mx = mid.x - rect.left
        const my = mid.y - rect.top
        const sRatio = newScale / scale
        setPosition(p => ({
          x: mx - (mx - p.x) * sRatio,
          y: my - (my - p.y) * sRatio
        }))
      }

      setScale(newScale)
    }
  }

  const handleTouchEnd = () => {
    lastPinchRef.current = null
  }

  const resetView = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  // --- Click handler for block hit-testing ---
  const handleContainerClick = (e) => {
    if (dragDistanceRef.current > 5) return

    const rect = containerRef.current?.getBoundingClientRect()
    const cf = containFitRef.current
    if (!rect || !imageNaturalSize || !cf) return

    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    // Reverse the transform (pan + scale)
    const s = scaleRef.current
    const p = positionRef.current
    const localX = (clickX - p.x) / s
    const localY = (clickY - p.y) / s

    // Convert container-local coords to image pixel coords
    // (inverse of getBlockStyle)
    const imgW = imageNaturalSize.width
    const imgH = imageNaturalSize.height
    const contW = containerSizeRef.current.width
    const contH = containerSizeRef.current.height

    if (contW === 0 || contH === 0) return

    const imgX = (localX - cf.offsetX) / cf.width * imgW
    const imgY = (localY - cf.offsetY) / cf.height * imgH

    for (const block of blocksRef.current) {
      const coords = block.blockCoordinates
      if (!coords || coords.x == null) continue
      if (
        imgX >= coords.x &&
        imgX <= coords.x + (coords.width || 100) &&
        imgY >= coords.y &&
        imgY <= coords.y + (coords.height || 100)
      ) {
        handleToggleBlock(block)
        return
      }
    }
  }

  // Stats (single pass)
  const { correctCount, wrongCount } = useMemo(() => {
    let c = 0, w = 0
    for (const b of blocks) { b.isCorrect ? c++ : w++ }
    return { correctCount: c, wrongCount: w }
  }, [blocks])
  const changedCount = modifiedIds.size

  // Show a blank placeholder while image is preloading
  const showPlaceholder = !imageNaturalSize

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#F2F2F7] z-[10000] flex items-center justify-center flex-col gap-4">
        <Loader2 size={32} className="animate-spin text-blue-600" />
        <div className="text-base text-gray-400">加载题目数据...</div>
      </div>
    )
  }

  if (rawQuestions.length === 0 || !task) {
    return (
      <div className="fixed inset-0 bg-[#F2F2F7] z-[10000] flex items-center justify-center flex-col gap-4">
        <div className="text-base text-gray-400">暂无题目数据</div>
        <button onClick={onClose} className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold">返回</button>
      </div>
    )
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-[#F2F2F7] z-[10000] flex items-center justify-center p-0 md:p-4"
      >
        {/* Phone-like container */}
        <div className="w-full h-full md:max-w-md md:h-[90vh] md:rounded-3xl md:shadow-2xl bg-white flex flex-col overflow-hidden">
          {/* Header */}
          <header className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-200 flex-shrink-0">
            <button onClick={onClose} className="flex items-center gap-1 text-blue-600 text-[15px] font-medium">
              <ArrowLeft size={20} /> 返回
            </button>
            <h2 className="text-[17px] font-bold text-gray-900">复审试卷</h2>
            <button onClick={resetView} className="flex items-center gap-1 text-gray-400 text-[13px]">
              <RotateCcw size={15} /> 重置
            </button>
          </header>

          {/* Stats bar */}
          <div className="bg-white px-4 py-2 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
            <div className="flex gap-5">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-green-500" />
                <span className="text-[13px] text-gray-500">正确 <strong className="text-green-500">{correctCount}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <XCircle size={16} className="text-red-500" />
                <span className="text-[13px] text-gray-500">错误 <strong className="text-red-500">{wrongCount}</strong></span>
              </div>
            </div>
            <span className="text-[12px] text-gray-400">点击题块切换判定</span>
            <button
              onClick={() => setShowDebugLayout(v => !v)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                showDebugLayout
                  ? 'border-yellow-400 text-yellow-600 bg-yellow-50'
                  : 'border-gray-200 text-gray-300 bg-transparent'
              }`}
              title="切换布局调试可视化"
            >
              {showDebugLayout ? '布局' : '调试'}
            </button>
          </div>

          {/* Image viewer */}
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden relative bg-gray-900"
            style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onWheel={handleWheel}
            onClick={handleContainerClick}
          >
            {/* Loading placeholder */}
            {showPlaceholder && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-white/60" />
              </div>
            )}

            {/* Transformed image + overlays layer */}
            <div
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transformOrigin: '0 0',
                width: '100%',
                height: '100%',
              }}
            >
              <img
                src={task.image_url}
                alt="试卷原图"
                draggable={false}
                className="w-full h-full object-contain select-none"
                style={{ pointerEvents: 'none' }}
              />

              {/* Block overlays (fixed + valid blocks — invalid ones filtered out) */}
              {containFit && fixedBlocks.map((block) => {
                const style = getBlockStyle(block)
                const ann = layoutMap.get(block.id)
                const isCorrect = block.isCorrect
                const isModified = modifiedIds.has(block.id)

                return (
                  <div
                    key={block.id}
                    className="absolute cursor-pointer"
                    style={{
                      left: style.left,
                      top: style.top,
                      width: style.width,
                      height: style.height,
                      zIndex: 10,
                      overflow: 'visible',
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleBlock(block)
                    }}
                  >
                    {/* Block highlight background */}
                    <div
                      className="absolute inset-0 rounded-md transition-colors duration-150 pointer-events-none"
                      style={{
                        backgroundColor: isCorrect ? COLORS.CORRECT_BG : COLORS.WRONG_BG,
                        border: `1.5px ${isModified ? 'solid' : 'dashed'} ${isCorrect ? COLORS.CORRECT_BORDER : COLORS.WRONG_BORDER}`,
                      }}
                    />

                    {/* Status icon — anchored to RIGHT of block, vertically centered */}
                    {/* Vertical-only collision offsets applied via CSS transform */}
                    <div
                      className="absolute rounded-full flex items-center justify-center pointer-events-none"
                      style={{
                        right: -32,   // GAP(4) + ICON_SIZE(28) = 32px beyond block's right edge
                        top: '50%',
                        transform: iconTransformString(0, ann?.icon.offsetY ?? 0),
                        width: 28,
                        height: 28,
                        backgroundColor: isCorrect ? COLORS.CORRECT : COLORS.WRONG,
                        zIndex: 20,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                      }}
                    >
                      {isCorrect ? (
                        <CheckCircle2 size={17} color="white" strokeWidth={2.5} />
                      ) : (
                        <XCircle size={17} color="white" strokeWidth={2.5} />
                      )}
                    </div>

                    {/* Question number — to the right of the icon */}
                    <span
                      className="absolute text-[10px] font-semibold text-white/90 px-1 py-0.5 rounded pointer-events-none whitespace-nowrap"
                      style={{
                        right: -60,  // ~32(icon)+4(gap)+24(label) beyond block right edge
                        top: '50%',
                        transform: `translateY(-50%) translateY(${ann?.icon.offsetY ?? 0}px)`,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                      }}
                    >
                      {isModified && '✦ '}{block.number}
                    </span>
                  </div>
                )
              })}

              {/* ── Debug: annotation layout visualization ── */}
              {showDebugLayout && annotationLayout.annotations.length > 0 && (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  style={{ zIndex: 50 }}
                  width="100%"
                  height="100%"
                >
                  {/* Bounding box outlines */}
                  {containFit && boundingBoxes.map(bb => {
                    const style = getBlockStyle(bb)
                    const left = parseFloat(style.left)
                    const top = parseFloat(style.top)
                    const width = parseFloat(style.width)
                    const height = parseFloat(style.height)
                    return (
                      <g key={`bbox-${bb.id}`}>
                        {/* Bounding box */}
                        <rect
                          x={`${left}%`}
                          y={`${top}%`}
                          width={`${width}%`}
                          height={`${height}%`}
                          fill="rgba(59,130,246,0.06)"
                          stroke="rgba(59,130,246,0.5)"
                          strokeWidth={1.5}
                          strokeDasharray="6,3"
                          rx={4}
                        />
                        {/* Safe zone — right side */}
                        {bb.safeZone?.right && (
                          <rect
                            x={`${left + width}%`}
                            y={`${top}%`}
                            width={`${Math.min((bb.safeZone.right.w / (containFit?.width || 1)) * 100, 8)}%`}
                            height={`${height}%`}
                            fill="rgba(16,185,129,0.1)"
                            stroke="rgba(16,185,129,0.4)"
                            strokeWidth={1}
                            strokeDasharray="3,3"
                            rx={2}
                          />
                        )}
                      </g>
                    )
                  })}

                  {/* Guide lines: original → adjusted for overlapping annotations */}
                  {annotationLayout.debug.guideLines.map((line, i) => (
                    <line
                      key={`guide-${i}`}
                      x1={line.x1} y1={line.y1}
                      x2={line.x2} y2={line.y2}
                      stroke="rgba(255,200,0,0.8)"
                      strokeWidth="1.5"
                      strokeDasharray="4,3"
                    />
                  ))}
                  {/* Anchor dots + adjusted position rings (right-side) */}
                  {annotationLayout.annotations.map((ann, i) => {
                    const color = annotationLayout.debug.severityColors[i]
                    return (
                      <g key={`debug-${i}`}>
                        {/* Ideal right-anchor position */}
                        <circle
                          cx={ann.icon.idealX + ann.icon.w / 2}
                          cy={ann.icon.idealY + ann.icon.h / 2}
                          r={3}
                          fill={ann.overlapping ? '#fbbf24' : '#22c55e'}
                          stroke="white"
                          strokeWidth={1}
                        />
                        {/* Adjusted position (vertical-only offset) */}
                        {ann.icon.offsetY !== 0 && (
                          <>
                            <circle
                              cx={ann.icon.adjustedX + ann.icon.w / 2}
                              cy={ann.icon.adjustedY + ann.icon.h / 2}
                              r={4}
                              fill="none"
                              stroke={color}
                              strokeWidth={1.5}
                            />
                            {/* Severity label */}
                            <text
                              x={ann.icon.adjustedX + ann.icon.w / 2 + 8}
                              y={ann.icon.adjustedY + ann.icon.h / 2 + 4}
                              fontSize="9"
                              fill={color}
                              stroke="rgba(0,0,0,0.6)"
                              strokeWidth={0.3}
                            >
                              #{ann.block.number} {ann.severity !== 'none' ? ann.severity : ''}
                            </text>
                          </>
                        )}
                      </g>
                    )
                  })}
                </svg>
              )}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="bg-white px-4 py-3 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
            <span className="text-[13px] text-gray-400">
              缩放 {Math.round(scale * 100)}%{changedCount > 0 && ` · ${changedCount} 题已修改`}
            </span>
            <button
              onClick={handleSave}
              disabled={saving || changedCount === 0}
              className={`px-6 py-2.5 rounded-xl text-[14px] font-bold flex items-center gap-2 transition-all ${
                changedCount > 0 && !saving
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 active:bg-blue-700'
                  : 'bg-gray-100 text-gray-300'
              }`}
            >
              <Save size={16} />
              {saving ? '保存中...' : '确认保存'}
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
