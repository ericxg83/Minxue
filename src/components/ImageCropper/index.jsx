import { useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'

/**
 * 自由框选裁剪器（上传前裁掉不需要录入的题目区域）
 *
 * 2026-09-15 重写：原版本基于 react-easy-crop 的 1:1 圆形头像裁剪，且全库无引用。
 * react-easy-crop 只支持固定宽高比取景框，无法「拖拽框选任意区域」，故改为
 * 指针事件 + canvas 自实现：在图片上拖出一个矩形，确认后按原始分辨率裁出 JPEG dataURL。
 *
 * 用法：
 *   <ImageCropper image={url} title="裁剪图片"
 *     onCropComplete={(dataUrl) => ...} onCancel={() => ...} />
 */
export default function ImageCropper({ image, onCropComplete, onCancel, title = '裁剪图片' }) {
  const areaRef = useRef(null)   // 裁剪操作区（坐标系基准）
  const imgRef = useRef(null)    // <img> 元素，用于换算原始分辨率坐标
  const drawingRef = useRef(null) // { startX, startY } 正在拖拽的起点
  const [rect, setRect] = useState(null) // { x, y, w, h } 相对操作区的像素

  // 图片在操作区内的显示范围（相对操作区坐标）
  const getImgBox = useCallback(() => {
    const img = imgRef.current
    const area = areaRef.current
    if (!img || !area) return null
    const disp = img.getBoundingClientRect()
    const cont = area.getBoundingClientRect()
    return {
      left: disp.left - cont.left,
      top: disp.top - cont.top,
      right: disp.left - cont.left + disp.width,
      bottom: disp.top - cont.top + disp.height
    }
  }, [])

  const clampToImg = useCallback((pos) => {
    const box = getImgBox()
    if (!box) return pos
    return {
      x: Math.min(Math.max(pos.x, box.left), box.right),
      y: Math.min(Math.max(pos.y, box.top), box.bottom)
    }
  }, [getImgBox])

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    const box = getImgBox()
    if (!box) return
    const raw = { x: e.clientX - areaRef.current.getBoundingClientRect().left, y: e.clientY - areaRef.current.getBoundingClientRect().top }
    // 只有按在图片上才开始框选，避免把操作区空白处也当成起点
    if (raw.x < box.left || raw.x > box.right || raw.y < box.top || raw.y > box.bottom) return
    const start = clampToImg(raw)
    drawingRef.current = start
    setRect({ x: start.x, y: start.y, w: 0, h: 0 })
    try { areaRef.current.setPointerCapture(e.pointerId) } catch { /* WebView 兼容：捕获失败不影响拖拽 */ }
  }

  const onPointerMove = (e) => {
    if (!drawingRef.current) return
    const cur = clampToImg({
      x: e.clientX - areaRef.current.getBoundingClientRect().left,
      y: e.clientY - areaRef.current.getBoundingClientRect().top
    })
    const start = drawingRef.current
    setRect({
      x: Math.min(start.x, cur.x),
      y: Math.min(start.y, cur.y),
      w: Math.abs(cur.x - start.x),
      h: Math.abs(cur.y - start.y)
    })
  }

  const onPointerUp = () => {
    drawingRef.current = null
    // 过滤误触产生的极小选框
    setRect((prev) => (prev && prev.w >= 8 && prev.h >= 8) ? prev : null)
  }

  const hasSelection = !!rect && rect.w >= 8 && rect.h >= 8

  const handleConfirm = async () => {
    if (!hasSelection || !imgRef.current) return
    try {
      const dataUrl = await cropToDataUrl(imgRef.current, rect, areaRef.current)
      onCropComplete(dataUrl)
    } catch (error) {
      console.error('裁剪失败:', error)
      alert('裁剪失败，请重试')
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[30000] flex flex-col"
        style={{ background: '#111' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-11 pb-3" style={{ background: '#111' }}>
          <button onClick={onCancel} className="text-[15px] font-medium text-white/90 active:opacity-60">
            取消
          </button>
          <h2 className="text-[16px] font-semibold text-white">{title}</h2>
          <button
            onClick={handleConfirm}
            disabled={!hasSelection}
            className="text-[15px] font-medium active:opacity-60 disabled:opacity-40"
            style={{ color: '#818cf8' }}
          >
            确定
          </button>
        </div>

        <p className="px-5 pb-2 text-[12px] text-white/50">
          在图片上拖动，框选要录入的题目区域
        </p>

        {/* Cropper Area */}
        <div
          ref={areaRef}
          className="flex-1 relative flex items-center justify-center overflow-hidden"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <img
            ref={imgRef}
            src={image}
            alt="裁剪原图"
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
          />
          {hasSelection && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                border: '2px solid #818cf8',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)'
              }}
            />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * 把操作区坐标系里的选框换算回图片原始分辨率，canvas 裁出 JPEG dataURL。
 * 选框坐标相对 area 容器；图片居中显示（object-contain），需扣除图片与容器的偏移。
 */
async function cropToDataUrl(imgEl, rect, areaEl) {
  if (!imgEl.naturalWidth || !areaEl) {
    throw new Error('图片未加载完成')
  }
  const disp = imgEl.getBoundingClientRect()
  const cont = areaEl.getBoundingClientRect()
  const scaleX = imgEl.naturalWidth / disp.width
  const scaleY = imgEl.naturalHeight / disp.height

  const offX = disp.left - cont.left
  const offY = disp.top - cont.top

  const sx = Math.max(0, (rect.x - offX) * scaleX)
  const sy = Math.max(0, (rect.y - offY) * scaleY)
  const sw = Math.min(imgEl.naturalWidth - sx, rect.w * scaleX)
  const sh = Math.min(imgEl.naturalHeight - sy, rect.h * scaleY)

  if (sw < 2 || sh < 2) {
    throw new Error('选区太小')
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw)
  canvas.height = Math.round(sh)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建 canvas 上下文')
  }
  ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}
