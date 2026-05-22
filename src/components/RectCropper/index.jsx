import { useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect } from 'react'

const HANDLE_HIT_PAD = 6

function getResponsiveSizes() {
  if (typeof window === 'undefined') return { MIN_SIZE: 40, HANDLE_SIZE: 18, BORDER_WIDTH: 2 }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  const smallScreen = Math.min(vw, vh) < 600

  // 固定最小裁剪尺寸为10x10像素，支持精确选择小区域
  return { MIN_SIZE: 10, HANDLE_SIZE: smallScreen && touchDevice ? 26 : 22, BORDER_WIDTH: 2 }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

export default function RectCropper({ image, onConfirm, onCancel, theme = 'light', enableOptimization = true }) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const previewRafRef = useRef(null)
  const [imgRect, setImgRect] = useState({ x: 0, y: 0, width: 0, height: 0, scale: 1 })
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [resizeHandle, setResizeHandle] = useState(null)
  const [showInstruction, setShowInstruction] = useState(true)
  const startRef = useRef({ x: 0, y: 0, crop: null })
  const imgNaturalRef = useRef({ w: 0, h: 0 })
  const [processing, setProcessing] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [optimizationOptions, setOptimizationOptions] = useState({
    removeBlack: true,
    blackThreshold: 40,
    contrastFactor: 1.3,
    sharpenAmount: 0.8,
    outputFormat: 'image/png'
  })

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
    if (!container || !img || !imgNaturalRef.current.w) return

    const containerRect = container.getBoundingClientRect()
    const imgRectDOM = img.getBoundingClientRect()

    const x = Math.round(imgRectDOM.left - containerRect.left)
    const y = Math.round(imgRectDOM.top - containerRect.top)
    const w = Math.round(imgRectDOM.width)
    const h = Math.round(imgRectDOM.height)

    if (w <= 0 || h <= 0) return

    const naturalW = imgNaturalRef.current.w
    const naturalH = imgNaturalRef.current.h
    const scale = w / naturalW

    setImgRect({ x, y, width: w, height: h, scale, naturalW, naturalH })
  }, [])

  useEffect(() => {
    if (imgRect.width <= 0) return
    // 只在crop未初始化时才设置默认值（crop.width === 0且crop.height === 0）
    if (crop.width > 0 || crop.height > 0) return
    const { width: w, height: h } = imgRect
    if (w <= 0 || h <= 0) return
    const ratio = 0.8
    const cw = Math.round(w * ratio)
    const ch = Math.round(h * ratio)
    setCrop({
      x: Math.round((w - cw) / 2),
      y: Math.round((h - ch) / 2),
      width: cw,
      height: ch
    })
  }, [imgRect.width, imgRect.height])

  useLayoutEffect(() => {
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

  const [imgSrc, setImgSrc] = useState(null)

  // Load image - convert cross-origin images to blob URLs to avoid canvas tainting
  useEffect(() => {
    if (!image) { setImgSrc(null); return }
    
    const loadImage = async () => {
      // For data URLs and same-origin images, use directly
      if (image.startsWith('data:') || !image.startsWith('http')) {
        setImgSrc(image)
        return
      }
      
      // For cross-origin HTTP images, fetch as blob and convert to blob URL
      try {
        const response = await fetch(image)
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
        const blob = await response.blob()
        if (!blob.type.startsWith('image/')) throw new Error(`Not an image: ${blob.type}`)
        const blobUrl = URL.createObjectURL(blob)
        setImgSrc(blobUrl)
        return () => { URL.revokeObjectURL(blobUrl) }
      } catch (e) {
        console.warn('Failed to fetch image as blob, using direct URL:', e)
        setImgSrc(image)
      }
    }
    
    loadImage()
  }, [image])

  useEffect(() => {
    if (!showInstruction) return
    const timer = setTimeout(() => setShowInstruction(false), 3000)
    return () => clearTimeout(timer)
  }, [showInstruction])

  useEffect(() => {
    if (!imgSrc) return
    const img = new Image()
    img.onload = () => {
      imgNaturalRef.current = { w: img.naturalWidth, h: img.naturalHeight }
      if (imgRef.current) {
        imgRef.current.src = imgSrc
      }
      setCrop({ x: 0, y: 0, width: 0, height: 0 })
      setShowInstruction(true)
      setTimeout(() => {
        computeLayout()
      }, 80)
    }
    img.onerror = () => {
      if (imgRef.current) {
        imgRef.current.src = imgSrc
      }
      setTimeout(() => computeLayout(), 80)
    }
    img.src = imgSrc
  }, [imgSrc, computeLayout])

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

  const handleCropMouseDown = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()
    setShowInstruction(false)
    setDragging(true)
    const p = getPointer(e)
    startRef.current = { x: p.x, y: p.y, crop: { ...crop } }
  }, [crop, getPointer])

  const handleResizeMouseDown = useCallback((e, handle) => {
    e.stopPropagation()
    e.preventDefault()
    setShowInstruction(false)
    setResizing(true)
    setResizeHandle(handle)
    const p = getPointer(e)
    startRef.current = { x: p.x, y: p.y, crop: { ...crop } }
  }, [crop, getPointer])

  useEffect(() => {
    if (!dragging && !resizing) return

    const handleMove = (e) => {
      e.preventDefault()
      const p = getPointer(e)

      if (dragging) {
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
  }, [dragging, resizing, resizeHandle, imgRect, getPointer, MIN_SIZE])

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

  // Track if confirm is in progress to prevent double-fires
  const confirmingRef = useRef(false)

  const handleConfirm = async () => {
    if (confirmingRef.current) {
      console.log('[RectCropper] handleConfirm already in progress, ignoring')
      return
    }
    confirmingRef.current = true

    console.log('[RectCropper] handleConfirm called', {
      hasImg: !!imgRef.current,
      crop,
      scale: imgRect.scale
    })
    if (!imgRef.current || crop.width <= 0 || crop.height <= 0) {
      console.warn('[RectCropper] handleConfirm returned early - invalid state')
      confirmingRef.current = false
      return
    }
    try {
      setProcessing(true)
      const scale = imgRect.scale
      const sx = Math.round(crop.x / scale)
      const sy = Math.round(crop.y / scale)
      const sw = Math.round(crop.width / scale)
      const sh = Math.round(crop.height / scale)

      console.log('[RectCropper] crop coords', { sx, sy, sw, sh, scale })

      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d')

      const displayedSrc = imgRef.current.src
      const isDirectHttpUrl = displayedSrc && displayedSrc.startsWith('http')
      
      console.log('[RectCropper] image source:', { displayedSrc, isDirectHttpUrl })
      
      if (isDirectHttpUrl) {
        // Direct HTTP URL (no blob conversion): fetch through proxy
        try {
          // Use different proxy path for Pages vs local dev
          const proxyPath = window.location.hostname === 'localhost' ? '/api/proxy-image' : '/proxy-image'
          const proxyUrl = `${proxyPath}?url=${encodeURIComponent(displayedSrc)}`
          console.log('[RectCropper] fetching via proxy:', proxyUrl)
          const response = await fetch(proxyUrl)
          if (!response.ok) throw new Error(`Proxy returned ${response.status}`)
          const blob = await response.blob()
          if (!blob.type.startsWith('image/')) throw new Error(`Not an image: ${blob.type}`)
          const blobUrl = URL.createObjectURL(blob)
          const img = new Image()
          await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = () => reject(new Error('Blob image failed'))
            img.src = blobUrl
          })
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
          URL.revokeObjectURL(blobUrl)
        } catch (e) {
          console.error('[RectCropper] Cross-origin crop failed:', e)
          throw new Error('图片跨域限制导致无法导出，请尝试使用本地图片')
        }
      } else {
        // blob URL or data URL - already same-origin, safe to draw directly
        ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh)
      }
      
      let dataUrl
      try {
        dataUrl = canvas.toDataURL('image/jpeg', 0.92)
        console.log('[RectCropper] dataUrl generated, length:', dataUrl.length)
      } catch (canvasErr) {
        console.error('[RectCropper] Canvas export failed (tainted):', canvasErr)
        throw new Error('图片跨域限制导致无法导出，请尝试使用本地图片')
      }
      
      console.log('[RectCropper] calling onConfirm')
      onConfirm(dataUrl)
    } catch (err) {
      console.error('[RectCropper] 裁剪失败:', err)
      alert('裁剪失败: ' + (err.message || '未知错误'))
    } finally {
      setProcessing(false)
      confirmingRef.current = false
    }
  }

  const handleResetCrop = () => {
    if (imgRect.width <= 0) return
    const ratio = 0.8
    const cw = Math.round(imgRect.width * ratio)
    const ch = Math.round(imgRect.height * ratio)
    setCrop({
      x: Math.round((imgRect.width - cw) / 2),
      y: Math.round((imgRect.height - ch) / 2),
      width: cw,
      height: ch
    })
  }

  const cropX = crop.x
  const cropY = crop.y
  const cropW = crop.width
  const cropH = crop.height

  const topH = imgRect.y + cropY
  const bottomH = imgRect.height - cropY - cropH
  const leftW = cropX
  const rightW = imgRect.width - cropX - cropW

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

  const hasValidCrop = crop.width >= MIN_SIZE && crop.height >= MIN_SIZE

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
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
          paddingTop: 'env(safe-area-inset-top, 12px)',
          cursor: 'default'
        }}
      >
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
                拖动裁剪框调整范围，或拖动角点缩放
              </div>
            )}

            {hasValidCrop && (
              <>
                <div style={{
                  position: 'absolute', left: imgRect.x, top: 0,
                  width: imgRect.width, height: topH,
                  background: colors.mask, pointerEvents: 'none'
                }} />
                <div style={{
                  position: 'absolute', left: imgRect.x, bottom: 0,
                  width: imgRect.width, height: bottomH,
                  background: colors.mask, pointerEvents: 'none'
                }} />
                <div style={{
                  position: 'absolute',
                  left: imgRect.x, top: imgRect.y + cropY,
                  width: leftW, height: cropH,
                  background: colors.mask, pointerEvents: 'none'
                }} />
                <div style={{
                  position: 'absolute',
                  right: `calc(100% - ${imgRect.x + imgRect.width}px)`,
                  top: imgRect.y + cropY,
                  width: rightW, height: cropH,
                  background: colors.mask, pointerEvents: 'none'
                }} />

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
                  <div style={{
                    position: 'absolute', inset: 0,
                    border: `${BORDER_WIDTH}px dashed ${colors.accent}`,
                    boxSizing: 'border-box'
                  }} />
                  {handles.map((h) => (
                    <div
                      key={h.key}
                      onMouseDown={(e) => handleResizeMouseDown(e, h.key)}
                      onTouchStart={(e) => handleResizeMouseDown(e, h.key)}
                      style={{
                        position: 'absolute',
                        width: HANDLE_SIZE + HANDLE_HIT_PAD * 2,
                        height: HANDLE_SIZE + HANDLE_HIT_PAD * 2,
                        padding: HANDLE_HIT_PAD,
                        backgroundClip: 'content-box',
                        background: 'transparent',
                        borderRadius: '2px',
                        zIndex: 3,
                        cursor: h.key === 'n' || h.key === 's' ? 'ns-resize' :
                                h.key === 'e' || h.key === 'w' ? 'ew-resize' :
                                h.key === 'nw' || h.key === 'se' ? 'nwse-resize' : 'nesw-resize',
                        ...h.style
                      }}
                    />
                  ))}
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
        {imgRect.width > 0 ? (
          <>
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

            {enableOptimization && (
              <div style={{ marginBottom: 12 }}>
                <button
                  onClick={() => setShowOptions(!showOptions)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: 8,
                    border: `1px solid ${colors.accent}30`,
                    background: showOptions ? `${colors.accent}10` : 'transparent',
                    color: colors.accent,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1m16.36-5.66l-4.24 4.24m-4.24 4.24l-4.24 4.24m0-12.72l4.24 4.24m4.24 4.24l4.24 4.24"/>
                  </svg>
                  {showOptions ? '隐藏优化选项' : '显示图片优化选项'}
                </button>

                {showOptions && (
                  <div style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 8,
                    background: theme === 'light' ? '#F9FAFB' : '#2A2A2A',
                    border: `1px solid ${colors.accent}20`
                  }}>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        color: colors.textPrimary,
                        cursor: 'pointer'
                      }}>
                        <input
                          type="checkbox"
                          checked={optimizationOptions.removeBlack}
                          onChange={(e) => setOptimizationOptions(prev => ({ ...prev, removeBlack: e.target.checked }))}
                          style={{ accentColor: colors.accent }}
                        />
                        去黑处理
                      </label>
                    </div>

                    {optimizationOptions.removeBlack && (
                      <div style={{ marginBottom: 10, paddingLeft: 24 }}>
                        <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
                          去黑阈值: {optimizationOptions.blackThreshold}
                        </div>
                        <input
                          type="range"
                          min="20"
                          max="80"
                          step="5"
                          value={optimizationOptions.blackThreshold}
                          onChange={(e) => setOptimizationOptions(prev => ({ ...prev, blackThreshold: Number(e.target.value) }))}
                          style={{ width: '100%', accentColor: colors.accent }}
                        />
                      </div>
                    )}

                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
                        对比度: {optimizationOptions.contrastFactor.toFixed(1)}
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={optimizationOptions.contrastFactor}
                        onChange={(e) => setOptimizationOptions(prev => ({ ...prev, contrastFactor: Number(e.target.value) }))}
                        style={{ width: '100%', accentColor: colors.accent }}
                      />
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
                        锐化强度: {optimizationOptions.sharpenAmount.toFixed(1)}
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2.0"
                        step="0.1"
                        value={optimizationOptions.sharpenAmount}
                        onChange={(e) => setOptimizationOptions(prev => ({ ...prev, sharpenAmount: Number(e.target.value) }))}
                        style={{ width: '100%', accentColor: colors.accent }}
                      />
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>输出格式</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['image/png', 'image/jpeg'].map(format => (
                          <button
                            key={format}
                            onClick={() => setOptimizationOptions(prev => ({ ...prev, outputFormat: format }))}
                            style={{
                              flex: 1,
                              padding: '6px 8px',
                              borderRadius: 6,
                              border: `1px solid ${optimizationOptions.outputFormat === format ? colors.accent : '#D1D5DB'}`,
                              background: optimizationOptions.outputFormat === format ? `${colors.accent}15` : 'transparent',
                              color: optimizationOptions.outputFormat === format ? colors.accent : colors.textSecondary,
                              fontSize: 12,
                              cursor: 'pointer'
                            }}
                          >
                            {format === 'image/png' ? 'PNG' : 'JPEG'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleResetCrop}
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
                重置
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
                onClick={(e) => { e.preventDefault(); handleConfirm(); }}
                onTouchStart={(e) => { e.preventDefault(); }}
                onTouchEnd={(e) => { e.preventDefault(); handleConfirm(); }}
                disabled={!hasValidCrop || processing}
                style={{
                  flex: 1,
                  padding: '14px',
                  borderRadius: 10,
                  border: 'none',
                  background: hasValidCrop && !processing ? colors.confirmBg : '#D1D5DB',
                  color: hasValidCrop && !processing ? colors.confirmText : '#9CA3AF',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: hasValidCrop && !processing ? 'pointer' : 'not-allowed',
                  opacity: hasValidCrop && !processing ? 1 : 0.6,
                  position: 'relative',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                {processing ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    处理中...
                  </span>
                ) : '确认裁剪'}
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
