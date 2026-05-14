import { useState, useRef, useCallback, useEffect } from 'react'

const MIN_SIZE = 40
const HANDLE_SIZE = 18

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

export default function RectCropper({ image, onConfirm, onCancel }) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const [imgRect, setImgRect] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [resizeHandle, setResizeHandle] = useState(null)
  const startRef = useRef({ x: 0, y: 0, crop: null })

  const computeLayout = useCallback(() => {
    const container = containerRef.current
    const img = imgRef.current
    if (!container || !img) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const naturalW = img.naturalWidth || img.width || cw
    const naturalH = img.naturalHeight || img.height || ch
    if (!naturalW || !naturalH) return

    // 图片完整显示在容器内（类似 object-fit: contain）
    const scale = Math.min(cw / naturalW, ch / naturalH, 1)
    const w = Math.round(naturalW * scale)
    const h = Math.round(naturalH * scale)
    const x = Math.round((cw - w) / 2)
    const y = Math.round((ch - h) / 2)
    setImgRect({ x, y, width: w, height: h, scale })

    // 默认裁剪框在图片中心，占图片 70% x 40%
    const initW = Math.max(Math.round(w * 0.7), MIN_SIZE)
    const initH = Math.max(Math.round(h * 0.4), MIN_SIZE)
    setCrop(prev => {
      if (prev.width > 0) {
        return {
          x: clamp(prev.x, 0, w - prev.width),
          y: clamp(prev.y, 0, h - prev.height),
          width: Math.min(prev.width, w),
          height: Math.min(prev.height, h)
        }
      }
      return {
        x: Math.round((w - initW) / 2),
        y: Math.round((h - initH) / 2),
        width: initW,
        height: initH
      }
    })
  }, [])

  useEffect(() => {
    if (!image) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (imgRef.current) {
        imgRef.current.src = image
      }
      requestAnimationFrame(computeLayout)
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

  const handleCropMouseDown = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()
    setDragging(true)
    const p = getPointer(e)
    startRef.current = { x: p.x, y: p.y, crop: { ...crop } }
  }, [crop, getPointer])

  const handleResizeMouseDown = useCallback((e, handle) => {
    e.stopPropagation()
    e.preventDefault()
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
      const dx = p.x - startRef.current.x
      const dy = p.y - startRef.current.y
      const sc = startRef.current.crop
      const maxW = imgRect.width
      const maxH = imgRect.height

      if (dragging) {
        setCrop({
          x: clamp(sc.x + dx, 0, Math.max(0, maxW - sc.width)),
          y: clamp(sc.y + dy, 0, Math.max(0, maxH - sc.height)),
          width: sc.width,
          height: sc.height
        })
      } else if (resizing && resizeHandle) {
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
  }, [dragging, resizing, resizeHandle, imgRect, getPointer])

  const handleConfirm = async () => {
    if (!imgRef.current || crop.width <= 0 || crop.height <= 0) return
    try {
      const img = imgRef.current
      const scale = imgRect.scale
      const sx = Math.round(crop.x / scale)
      const sy = Math.round(crop.y / scale)
      const sw = Math.round(crop.width / scale)
      const sh = Math.round(crop.height / scale)

      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      onConfirm(dataUrl)
    } catch (err) {
      console.error('裁剪失败:', err)
    }
  }

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

  // 遮罩区域：上、下、左、右 四个矩形
  const topH = imgRect.y + crop.y
  const bottomH = imgRect.height - crop.y - crop.height
  const leftW = crop.x
  const rightW = imgRect.width - crop.x - crop.width

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50000,
        display: 'flex',
        flexDirection: 'column',
        background: '#1a1a1a'
      }}
    >
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
          paddingTop: 'env(safe-area-inset-top, 0px)'
        }}
      >
        {/* 背景图片 - 完整显示 */}
        <img
          ref={imgRef}
          src={image}
          crossOrigin="anonymous"
          alt="crop"
          draggable={false}
          onLoad={computeLayout}
          style={{
            position: 'absolute',
            left: imgRect.x,
            top: imgRect.y,
            width: imgRect.width,
            height: imgRect.height,
            display: 'block',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            touchAction: 'none',
            pointerEvents: 'none'
          }}
        />

        {imgRect.width > 0 && (
          <>
            {/* 上遮罩 */}
            <div style={{
              position: 'absolute',
              left: imgRect.x,
              top: 0,
              width: imgRect.width,
              height: topH,
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none'
            }} />
            {/* 下遮罩 */}
            <div style={{
              position: 'absolute',
              left: imgRect.x,
              bottom: 0,
              width: imgRect.width,
              height: bottomH,
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none'
            }} />
            {/* 左遮罩 */}
            <div style={{
              position: 'absolute',
              left: imgRect.x,
              top: imgRect.y + crop.y,
              width: leftW,
              height: crop.height,
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none'
            }} />
            {/* 右遮罩 */}
            <div style={{
              position: 'absolute',
              right: `calc(100% - ${imgRect.x + imgRect.width}px)`,
              top: imgRect.y + crop.y,
              width: rightW,
              height: crop.height,
              background: 'rgba(0,0,0,0.55)',
              pointerEvents: 'none'
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
                zIndex: 2
              }}
            >
              {/* 边框 */}
              <div style={{
                position: 'absolute',
                inset: 0,
                border: '2px solid #10B981',
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
                    background: '#10B981',
                    border: '2px solid #fff',
                    borderRadius: '50%',
                    boxShadow: '0 0 4px rgba(0,0,0,0.4)',
                    zIndex: 3,
                    ...h.style
                  }}
                />
              ))}
              {/* 中心十字线（可选，增加截图感） */}
              <div style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                width: 1,
                background: 'rgba(16,185,129,0.3)',
                transform: 'translateX(-50%)',
                pointerEvents: 'none'
              }} />
              <div style={{
                position: 'absolute',
                top: '50%',
                left: 0,
                right: 0,
                height: 1,
                background: 'rgba(16,185,129,0.3)',
                transform: 'translateY(-50%)',
                pointerEvents: 'none'
              }} />
            </div>
          </>
        )}
      </div>

      <div
        style={{
          padding: '16px 20px',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          background: '#111',
          display: 'flex',
          gap: 12,
          alignItems: 'center'
        }}
      >
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: 10,
            border: '1px solid #333',
            background: 'transparent',
            color: '#fff',
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
            background: '#2563EB',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          确认裁剪
        </button>
      </div>
    </div>
  )
}
