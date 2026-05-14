import { useState, useRef, useCallback, useEffect, useMemo } from 'react'

const HANDLE_HIT_PAD = 6

function getResponsiveSizes() {
  if (typeof window === 'undefined') return { MIN_SIZE: 40, HANDLE_SIZE: 18, BORDER_WIDTH: 2 }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const smallScreen = Math.min(vw, vh) < 600

  if (smallScreen && touchDevice) {
    return { MIN_SIZE: 56, HANDLE_SIZE: 26, BORDER_WIDTH: 2.5 }
  }
  if (touchDevice || vw < 768) {
    return { MIN_SIZE: 50, HANDLE_SIZE: 22, BORDER_WIDTH: 2 }
  }
  return { MIN_SIZE: 40, HANDLE_SIZE: 18, BORDER_WIDTH: 2 }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

export default function RectCropper({ image, onConfirm, onCancel, theme = 'light' }) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const previewRafRef = useRef(null)
  const [imgRect, setImgRect] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [hasSelection, setHasSelection] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState(null)
  const [selectionEnd, setSelectionEnd] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [resizeHandle, setResizeHandle] = useState(null)
  const [showInstruction, setShowInstruction] = useState(true)
  const startRef = useRef({ x: 0, y: 0, crop: null })

  const responsive = useMemo(() => getResponsiveSizes(), [])
  const { MIN_SIZE, HANDLE_SIZE, BORDER_WIDTH } = responsive

  const colors = useMemo(() => {
    if (theme === 'dark') {
      return {
        bg: '#1a1a1a',
        footerBg: '#111',
        mask: 'rgba(0,0,0,0.55)',
        accent: '#10B981',
        accentLight: 'rgba(16,185,129,0.3)',
        confirmBg: '#2563EB',
        confirmText: '#fff',
        cancelBg: 'transparent',
        cancelBorder: '#333',
        cancelText: '#fff',
        textPrimary: '#fff',
        textSecondary: '#9CA3AF',
        instructionBg: 'rgba(0,0,0,0.6)',
        instructionText: 'rgba(255,255,255,0.85)',
      }
    }
    return {
      bg: '#ffffff',
      footerBg: '#ffffff',
      mask: 'rgba(0,0,0,0.4)',
      accent: '#2563EB',
      accentLight: 'rgba(37,99,235,0.2)',
      confirmBg: '#2563EB',
      confirmText: '#ffffff',
      cancelBg: '#F3F4F6',
      cancelBorder: 'transparent',
      cancelText: '#111827',
      textPrimary: '#111827',
      textSecondary: '#6B7280',
      instructionBg: 'rgba(0,0,0,0.5)',
      instructionText: 'rgba(255,255,255,0.85)',
    }
  }, [theme])

  const computeLayout = useCallback(() => {
    const container = containerRef.current
    const img = imgRef.current
    if (!container || !img) return

    // 通过 getBoundingClientRect 获取 CSS 布局后的实际图片位置
    const containerRect = container.getBoundingClientRect()
    const imgRectDOM = img.getBoundingClientRect()

    const x = Math.round(imgRectDOM.left - containerRect.left)
    const y = Math.round(imgRectDOM.top - containerRect.top)
    const w = Math.round(imgRectDOM.width)
    const h = Math.round(imgRectDOM.height)

    if (w <= 0 || h <= 0) return

    const naturalW = img.naturalWidth || w
    const naturalH = img.naturalHeight || h
    const scale = w / naturalW // 图片显示宽度 / 原始宽度

    setImgRect({ x, y, width: w, height: h, scale })
  }, [])

  // 锁定 body 滚动，防止 iOS 回弹
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    const prevPosition = document.body.style.position
    const prevWidth = document.body.style.width
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.width = '100%'
    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.position = prevPosition
      document.body.style.width = prevWidth
    }
  }, [])

  // Instruction auto-dismiss
  useEffect(() => {
    if (!showInstruction) return
    const timer = setTimeout(() => setShowInstruction(false), 4000)
    return () => clearTimeout(timer)
  }, [showInstruction])

  useEffect(() => {
    if (!image) return
    // 不加 crossOrigin：OSS 图片无 CORS 头时依然能显示
    const img = new Image()
    img.onload = () => {
      if (imgRef.current) {
        imgRef.current.src = image
      }
      requestAnimationFrame(computeLayout)
    }
    img.onerror = () => {
      // 直接设置 src 尝试让浏览器原样加载
      if (imgRef.current) {
        imgRef.current.src = image
      }
    }
    img.src = image
  }, [image, computeLayout])

  useEffect(() => {
    const onResize = () => computeLayout()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [computeLayout])

  const getPointer = useCallback((e) => {
    const container = containerRef.current
    if (!container) return { x: 0, y: 0 }
    const rect = container.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    }
  }, [])

  /** 手指按下 — 开始划拉选择 */
  const handleSelectionMouseDown = useCallback((e) => {
    if (hasSelection) return // 已有选区时交给 handleCropMouseDown
    e.stopPropagation()
    e.preventDefault()
    setShowInstruction(false)
    const p = getPointer(e)
    setSelecting(true)
    setSelectionStart(p)
    setSelectionEnd(p)
  }, [hasSelection, getPointer])

  const handleCropMouseDown = useCallback((e) => {
    if (!hasSelection) return
    e.stopPropagation()
    e.preventDefault()
    setShowInstruction(false)
    setDragging(true)
    const p = getPointer(e)
    startRef.current = { x: p.x, y: p.y, crop: { ...crop } }
  }, [hasSelection, crop, getPointer])

  const handleResizeMouseDown = useCallback((e, handle) => {
    e.stopPropagation()
    e.preventDefault()
    setShowInstruction(false)
    setResizing(true)
    setResizeHandle(handle)
    const p = getPointer(e)
    startRef.current = { x: p.x, y: p.y, crop: { ...crop } }
  }, [crop, getPointer])

  /** 全局 move/up — 处理选择 + 拖拽 + 缩放 */
  useEffect(() => {
    if (!selecting && !dragging && !resizing) return

    const handleMove = (e) => {
      e.preventDefault()
      const p = getPointer(e)

      if (selecting) {
        setSelectionEnd(p)
      } else if (dragging) {
        const dx = p.x - startRef.current.x
        const dy = p.y - startRef.current.y
        const sc = startRef.current.crop
        const maxW = imgRect.width
        const maxH = imgRect.height
        setCrop({
          x: clamp(sc.x + dx, 0, Math.max(0, maxW - sc.width)),
          y: clamp(sc.y + dy, 0, Math.max(0, maxH - sc.height)),
          width: sc.width,
          height: sc.height
        })
      } else if (resizing && resizeHandle) {
        const dx = p.x - startRef.current.x
        const dy = p.y - startRef.current.y
        const sc = startRef.current.crop
        const maxW = imgRect.width
        const maxH = imgRect.height
        let nx = sc.x, ny = sc.y, nw = sc.width, nh = sc.height
        if (resizeHandle.includes('e')) nw = clamp(sc.width + dx, MIN_SIZE, Math.max(MIN_SIZE, maxW - sc.x))
        if (resizeHandle.includes('w')) {
          const newW = clamp(sc.width - dx, MIN_SIZE, sc.x + sc.width)
          nx = sc.x + sc.width - newW
          nw = newW
        }
        if (resizeHandle.includes('s')) nh = clamp(sc.height + dy, MIN_SIZE, Math.max(MIN_SIZE, maxH - sc.y))
        if (resizeHandle.includes('n')) {
          const newH = clamp(sc.height - dy, MIN_SIZE, sc.y + sc.height)
          ny = sc.y + sc.height - newH
          nh = newH
        }
        setCrop({ x: nx, y: ny, width: nw, height: nh })
      }
    }

    const handleUp = () => {
      if (selecting && selectionStart && selectionEnd) {
        // 计算最终选区
        let sx = Math.min(selectionStart.x, selectionEnd.x)
        let sy = Math.min(selectionStart.y, selectionEnd.y)
        let sw = Math.abs(selectionEnd.x - selectionStart.x)
        let sh = Math.abs(selectionEnd.y - selectionStart.y)

        // 相对图片区域的偏移
        sx = clamp(sx - imgRect.x, 0, imgRect.width)
        sy = clamp(sy - imgRect.y, 0, imgRect.height)
        sw = clamp(sw, MIN_SIZE, imgRect.width - sx)
        sh = clamp(sh, MIN_SIZE, imgRect.height - sy)

        if (sw >= MIN_SIZE && sh >= MIN_SIZE) {
          setCrop({ x: sx, y: sy, width: sw, height: sh })
          setHasSelection(true)
          setShowInstruction(false)
        }
      }
      setSelecting(false)
      setSelectionStart(null)
      setSelectionEnd(null)
      setDragging(false)
      setResizing(false)
      setResizeHandle(null)
    }

    window.addEventListener('mousemove', handleMove, { passive: false })
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('touchend', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleUp)
    }
  }, [selecting, dragging, resizing, resizeHandle, imgRect, getPointer, selectionStart, selectionEnd, MIN_SIZE])

  // 实时预览裁剪结果
  const updatePreview = useCallback(() => {
    if (!imgRef.current || !previewCanvasRef.current) return
    if (crop.width <= 0 || crop.height <= 0) return
    const canvas = previewCanvasRef.current
    const ctx = canvas.getContext('2d')
    const scale = imgRect.scale
    if (!scale) return
    const sx = Math.round(crop.x / scale)
    const sy = Math.round(crop.y / scale)
    const sw = Math.round(crop.width / scale)
    const sh = Math.round(crop.height / scale)

    const maxPreview = 100
    const ratio = Math.min(maxPreview / sw, maxPreview / sh, 1)
    canvas.width = Math.round(sw * ratio)
    canvas.height = Math.round(sh * ratio)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  }, [crop, imgRect.scale])

  useEffect(() => {
    if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current)
    previewRafRef.current = requestAnimationFrame(updatePreview)
    return () => {
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current)
    }
  }, [updatePreview])

  const handleConfirm = async () => {
    if (!imgRef.current || crop.width <= 0 || crop.height <= 0) return
    try {
      const scale = imgRect.scale
      const sx = Math.round(crop.x / scale)
      const sy = Math.round(crop.y / scale)
      const sw = Math.round(crop.width / scale)
      const sh = Math.round(crop.height / scale)

      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d')

      // 外部 URL 通过后端代理获取（绕过 CORS），data URL 直接绘制
      const src = imgRef.current.src
      if (src && src.startsWith('http')) {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(src)}`
        const proxyImg = new Image()
        proxyImg.crossOrigin = 'anonymous'
        await new Promise((resolve, reject) => {
          proxyImg.onload = resolve
          proxyImg.onerror = reject
          proxyImg.src = proxyUrl
        })
        ctx.drawImage(proxyImg, sx, sy, sw, sh, 0, 0, sw, sh)
      } else {
        ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh)
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      onConfirm(dataUrl)
    } catch (err) {
      console.error('裁剪失败:', err)
    }
  }

  const handleReselect = () => {
    setHasSelection(false)
    setCrop({ x: 0, y: 0, width: 0, height: 0 })
    setShowInstruction(true)
  }

  // --- 选择状态：划拉画框时的临时矩形 ---
  const selRect = selecting && selectionStart && selectionEnd ? {
    x: Math.min(selectionStart.x, selectionStart.x, selectionEnd.x),
    y: Math.min(selectionStart.y, selectionStart.y, selectionEnd.y),
    width: Math.abs(selectionEnd.x - selectionStart.x),
    height: Math.abs(selectionEnd.y - selectionStart.y)
  } : null

  // --- 有选区时的遮罩计算 ---
  const cropX = hasSelection ? crop.x : 0
  const cropY = hasSelection ? crop.y : 0
  const cropW = hasSelection ? crop.width : 0
  const cropH = hasSelection ? crop.height : 0

  const topH = imgRect.y + cropY
  const bottomH = imgRect.height - cropY - cropH
  const leftW = cropX
  const rightW = imgRect.width - cropX - cropW

  // 实际裁剪像素尺寸
  const naturalCropWidth = Math.round(crop.width / (imgRect.scale || 1))
  const naturalCropHeight = Math.round(crop.height / (imgRect.scale || 1))

  const half = HANDLE_SIZE / 2
  const handles = [
    { key: 'nw', style: { top: -half, left: -half } },
    { key: 'n',  style: { top: -half, left: '50%', transform: 'translateX(-50%)' } },
    { key: 'ne', style: { top: -half, right: -half } },
    { key: 'w',  style: { top: '50%', left: -half, transform: 'translateY(-50%)' } },
    { key: 'e',  style: { top: '50%', right: -half, transform: 'translateY(-50%)' } },
    { key: 'sw', style: { bottom: -half, left: -half } },
    { key: 's',  style: { bottom: -half, left: '50%', transform: 'translateX(-50%)' } },
    { key: 'se', style: { bottom: -half, right: -half } }
  ]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50000,
        display: 'flex',
        flexDirection: 'column',
        background: colors.bg
      }}
    >
      <div
        ref={containerRef}
        onMouseDown={!hasSelection ? handleSelectionMouseDown : undefined}
        onTouchStart={!hasSelection ? handleSelectionMouseDown : undefined}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
          paddingTop: 'env(safe-area-inset-top, 12px)',
          cursor: !hasSelection ? 'crosshair' : 'default'
        }}
      >
        {/* 背景图片 - CSS 居中显示（始终可见，不加 crossOrigin 以兼容无 CORS 的 OSS） */}
        <img
          ref={imgRef}
          src={image}
          alt="crop"
          draggable={false}
          onLoad={computeLayout}
          style={{
            position: 'absolute',
            maxWidth: '100%',
            maxHeight: '100%',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            objectFit: 'contain',
            display: 'block',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            touchAction: 'none',
            pointerEvents: 'none'
          }}
        />

        {imgRect.width > 0 && (
          <>
            {/* 操作提示 */}
            {showInstruction && (
              <div style={{
                position: 'absolute',
                top: imgRect.y + 16,
                left: '50%',
                transform: 'translateX(-50%)',
                background: colors.instructionBg,
                color: colors.instructionText,
                padding: '8px 18px',
                borderRadius: '20px',
                fontSize: '14px',
                fontWeight: 500,
                zIndex: 10,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                transition: 'opacity 0.3s',
                opacity: showInstruction ? 1 : 0
              }}>
                在图片上划拉选择裁剪区域
              </div>
            )}

            {/* 划拉选择时的临时矩形 */}
            {selecting && selRect && selRect.width > 0 && selRect.height > 0 && (
              <div style={{
                position: 'absolute',
                left: imgRect.x + selRect.x,
                top: imgRect.y + selRect.y,
                width: selRect.width,
                height: selRect.height,
                border: `${BORDER_WIDTH}px dashed ${colors.accent}`,
                background: 'rgba(37,99,235,0.08)',
                pointerEvents: 'none',
                zIndex: 3
              }} />
            )}

            {/* 有选区时的遮罩 + 裁剪框 */}
            {hasSelection && (
              <>
                {/* 上遮罩 */}
                <div style={{
                  position: 'absolute', left: imgRect.x, top: 0,
                  width: imgRect.width, height: topH,
                  background: colors.mask, pointerEvents: 'none'
                }} />
                {/* 下遮罩 */}
                <div style={{
                  position: 'absolute', left: imgRect.x, bottom: 0,
                  width: imgRect.width, height: bottomH,
                  background: colors.mask, pointerEvents: 'none'
                }} />
                {/* 左遮罩 */}
                <div style={{
                  position: 'absolute',
                  left: imgRect.x, top: imgRect.y + cropY,
                  width: leftW, height: cropH,
                  background: colors.mask, pointerEvents: 'none'
                }} />
                {/* 右遮罩 */}
                <div style={{
                  position: 'absolute',
                  right: `calc(100% - ${imgRect.x + imgRect.width}px)`,
                  top: imgRect.y + cropY,
                  width: rightW, height: cropH,
                  background: colors.mask, pointerEvents: 'none'
                }} />

                {/* 裁剪框 */}
                <div
                  onMouseDown={handleCropMouseDown}
                  onTouchStart={handleCropMouseDown}
                  style={{
                    position: 'absolute',
                    left: imgRect.x + crop.x,
                    top: imgRect.y + crop.y,
                    width: crop.width,
                    height: crop.height,
                    cursor: dragging ? 'grabbing' : 'grab',
                    touchAction: 'none',
                    zIndex: 2,
                    willChange: (dragging || resizing) ? 'left, top, width, height' : 'auto'
                  }}
                >
                  {/* 边框 */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    border: `${BORDER_WIDTH}px solid ${colors.accent}`,
                    boxSizing: 'border-box'
                  }} />
                  {/* 角点手柄 */}
                  {handles.map((h) => (
                    <div
                      key={h.key}
                      onMouseDown={(e) => handleResizeMouseDown(e, h.key)}
                      onTouchStart={(e) => handleResizeMouseDown(e, h.key)}
                      style={{
                        position: 'absolute',
                        width: HANDLE_SIZE,
                        height: HANDLE_SIZE,
                        padding: HANDLE_HIT_PAD,
                        backgroundClip: 'content-box',
                        background: colors.accent,
                        border: `${BORDER_WIDTH}px solid #fff`,
                        borderRadius: '50%',
                        boxShadow: '0 0 4px rgba(0,0,0,0.4)',
                        zIndex: 3,
                        ...h.style
                      }}
                    />
                  ))}
                  {/* 中心十字线 */}
                  <div style={{
                    position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1,
                    background: colors.accentLight, transform: 'translateX(-50%)', pointerEvents: 'none'
                  }} />
                  <div style={{
                    position: 'absolute', top: '50%', left: 0, right: 0, height: 1,
                    background: colors.accentLight, transform: 'translateY(-50%)', pointerEvents: 'none'
                  }} />
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div
        style={{
          padding: '12px 20px',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          background: colors.footerBg,
          borderTop: theme === 'light' ? '1px solid #E5E7EB' : 'none'
        }}
      >
        {hasSelection ? (
          <>
            {/* 预览 + 尺寸 */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 12, marginBottom: 12
            }}>
              <div style={{
                border: `2px solid ${colors.accent}`, borderRadius: '6px',
                overflow: 'hidden', background: '#f0f0f0',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <canvas
                  ref={previewCanvasRef}
                  style={{ display: 'block', maxWidth: '72px', maxHeight: '72px' }}
                />
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 2, fontSize: '11px', color: colors.textSecondary
              }}>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {naturalCropWidth} × {naturalCropHeight}
                </span>
                <span style={{ fontSize: '10px' }}>px</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleReselect}
                style={{
                  padding: '14px 12px',
                  borderRadius: 10,
                  border: '1px solid #D1D5DB',
                  background: '#fff',
                  color: '#6B7280',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                重新选择
              </button>
              <button
                onClick={onCancel}
                style={{
                  flex: 1,
                  padding: '14px',
                  borderRadius: 10,
                  border: colors.cancelBorder !== 'transparent' ? `1px solid ${colors.cancelBorder}` : 'none',
                  background: colors.cancelBg,
                  color: colors.cancelText,
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  flex: 1,
                  padding: '14px',
                  borderRadius: 10,
                  border: 'none',
                  background: colors.confirmBg,
                  color: colors.confirmText,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                确认裁剪
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onCancel}
              style={{
                flex: 1,
                padding: '14px',
                borderRadius: 10,
                border: colors.cancelBorder !== 'transparent' ? `1px solid ${colors.cancelBorder}` : 'none',
                background: colors.cancelBg,
                color: colors.cancelText,
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              disabled
              style={{
                flex: 1,
                padding: '14px',
                borderRadius: 10,
                border: 'none',
                background: '#D1D5DB',
                color: '#9CA3AF',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'not-allowed',
                opacity: 0.6
              }}
            >
              确认裁剪
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
