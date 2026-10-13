import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * 全屏图片预览：支持单击放大、双击复位、双指捏合缩放、滚轮缩放、放大后单指拖动平移。
 * 触摸手势基于原生 touch 事件计算 pinch 距离，无第三方依赖。
 *
 * children（可选）：叠加在图片上的标注层，随图片一起缩放/平移 —— 供「批改详情」
 * 原卷查看器画当前题高亮框。标注层按实测图片盒定位（图片在容器内居中，object-contain
 * 下元素盒即可见图像盒），不传 children 时与原先行为逐字一致。
 */

const MAX_SCALE = 4
const PAN_LIMIT = 160

const clampOffset = (o, s) => {
  if (s <= 1) return { x: 0, y: 0 }
  const lim = PAN_LIMIT * (s - 1)
  return {
    x: Math.max(-lim, Math.min(lim, o.x)),
    y: Math.max(-lim, Math.min(lim, o.y)),
  }
}

export default function ImagePreview({ src, children }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [imgBox, setImgBox] = useState(null)
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const baseScaleRef = useRef(1)
  const pinchStartRef = useRef(null)
  const panStartRef = useRef(null)
  const lastTapRef = useRef(0)

  // 实测图片在容器内的渲染盒：标注层要精确贴住可见图像（而非容器 letterbox 区）
  const measure = useCallback(() => {
    const img = imgRef.current
    const box = containerRef.current
    if (!img || !box) return
    const ir = img.getBoundingClientRect()
    const br = box.getBoundingClientRect()
    if (ir.width < 1 || ir.height < 1) return
    setImgBox({ left: ir.left - br.left, top: ir.top - br.top, width: ir.width, height: ir.height })
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, src])

  const handleDoubleTap = useCallback(() => {
    setScale(s => {
      const next = s === 1 ? 2.5 : 1
      setOffset({ x: 0, y: 0 })
      return next
    })
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
      panStartRef.current = null
      setPanning(false)
      baseScaleRef.current = scale
      pinchStartRef.current = dist(e)
      return
    }
    // 单指 + 已放大 → 拖动平移（未放大时留给容器做其它手势）
    if (e.touches.length === 1 && scale > 1) {
      const t = e.touches[0]
      panStartRef.current = { x: t.clientX - offset.x, y: t.clientY - offset.y }
      setPanning(true)
    }
  }

  const onTouchMove = (e) => {
    if (e.touches.length >= 2 && pinchStartRef.current) {
      const d = dist(e)
      const ratio = d / pinchStartRef.current
      const next = Math.min(MAX_SCALE, Math.max(1, baseScaleRef.current * ratio))
      setScale(next)
      setOffset(o => clampOffset(o, next))
      return
    }
    const p = panStartRef.current
    if (p && e.touches.length === 1) {
      const t = e.touches[0]
      setOffset(clampOffset({ x: t.clientX - p.x, y: t.clientY - p.y }, scale))
    }
  }

  const onTouchEnd = () => {
    pinchStartRef.current = null
    panStartRef.current = null
    setPanning(false)
  }

  const onWheel = (e) => {
    e.preventDefault()
    setScale(s => {
      const next = Math.min(MAX_SCALE, Math.max(1, s + (e.deltaY < 0 ? 0.2 : -0.2)))
      setOffset(o => clampOffset(o, next))
      return next
    })
  }

  const transform = `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
  const transition = panning ? 'none' : 'transform 0.2s ease-out'

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden p-2 touch-none relative"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      onClick={handleTap}
    >
      <img
        ref={imgRef}
        src={src}
        alt="预览"
        onLoad={measure}
        className="max-w-full max-h-full object-contain select-none"
        draggable={false}
        style={{
          transform,
          transition,
          cursor: 'zoom-in',
          transformOrigin: 'center center',
          pointerEvents: 'none'
        }}
      />
      {children && imgBox && (
        <div
          className="absolute"
          style={{
            left: imgBox.left, top: imgBox.top, width: imgBox.width, height: imgBox.height,
            transform, transition, transformOrigin: 'center center',
            pointerEvents: 'none'
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
