import { useState, useRef, useCallback } from 'react'

/**
 * 全屏图片预览：支持单击放大、双击复位、双指捏合缩放、滚轮缩放。
 * 触摸手势基于原生 touch 事件计算 pinch 距离，无第三方依赖。
 */
export default function ImagePreview({ src, onClose }) {
  const [scale, setScale] = useState(1)
  const baseScaleRef = useRef(1)
  const pinchStartRef = useRef(null)
  const lastTapRef = useRef(0)
  const containerRef = useRef(null)

  const toggleZoom = useCallback(() => {
    setScale(s => (s === 1 ? 2.5 : 1))
  }, [])

  const handleDoubleTap = useCallback(() => {
    setScale(s => (s === 1 ? 2.5 : 1))
  }, [])

  const handleTap = useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      // 双击 → 放大/复位
      handleDoubleTap()
      lastTapRef.current = 0
    } else {
      lastTapRef.current = now
    }
  }, [handleDoubleTap])

  const dist = (t) => {
    if (t.touches.length < 2) return 0
    const dx = t.touches[0].clientX - t.touches[1].clientX
    const dy = t.touches[0].clientY - t.touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const onTouchStart = (e) => {
    if (e.touches.length >= 2) {
      baseScaleRef.current = scale
      pinchStartRef.current = dist(e)
    }
  }

  const onTouchMove = (e) => {
    if (e.touches.length >= 2 && pinchStartRef.current) {
      const d = dist(e)
      const ratio = d / pinchStartRef.current
      setScale(Math.min(4, Math.max(1, baseScaleRef.current * ratio)))
    }
  }

  const onTouchEnd = () => {
    pinchStartRef.current = null
  }

  const onWheel = (e) => {
    e.preventDefault()
    setScale(s => Math.min(4, Math.max(1, s + (e.deltaY < 0 ? 0.2 : -0.2))))
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden p-2 touch-none"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      onClick={handleTap}
    >
      <img
        src={src}
        alt="预览"
        className="max-w-full max-h-full object-contain select-none"
        draggable={false}
        style={{
          transform: `scale(${scale})`,
          transition: 'transform 0.2s ease-out',
          cursor: 'zoom-in',
          transformOrigin: 'center center',
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}
