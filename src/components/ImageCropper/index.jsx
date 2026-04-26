import { useState, useRef, useCallback, useEffect } from 'react'
import { Button, Toast, SpinLoading } from 'antd-mobile'

// 苹果风格颜色
const APPLE_COLORS = {
  primary: '#007AFF',
  success: '#34C759',
  danger: '#FF3B30',
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  border: '#E5E5EA'
}

export default function ImageCropper({ imageUrl, onConfirm, onCancel, initialPosition = null }) {
  const containerRef = useRef(null)
  const imageRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [resizeHandle, setResizeHandle] = useState(null)
  const [cropBox, setCropBox] = useState({
    x: 50,
    y: 50,
    width: 200,
    height: 150
  })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  const dragStartRef = useRef({ x: 0, y: 0 })
  const cropStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  // 初始化
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setContainerSize({ width: rect.width, height: rect.height })
    }
  }, [])

  // 图片加载完成
  const handleImageLoad = () => {
    if (imageRef.current && containerRef.current) {
      const img = imageRef.current
      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()

      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })

      // 计算初始缩放比例，使图片适应容器
      const scaleX = containerRect.width / img.naturalWidth
      const scaleY = containerRect.height / img.naturalHeight
      const initialScale = Math.min(scaleX, scaleY, 1)
      setScale(initialScale)

      // 居中显示
      const scaledWidth = img.naturalWidth * initialScale
      const scaledHeight = img.naturalHeight * initialScale
      setPosition({
        x: (containerRect.width - scaledWidth) / 2,
        y: (containerRect.height - scaledHeight) / 2
      })

      // 如果有初始位置，设置裁剪框
      if (initialPosition) {
        setCropBox({
          x: initialPosition.x * initialScale + (containerRect.width - scaledWidth) / 2,
          y: initialPosition.y * initialScale + (containerRect.height - scaledHeight) / 2,
          width: initialPosition.width * initialScale,
          height: initialPosition.height * initialScale
        })
      } else {
        // 默认裁剪框在中心
        setCropBox({
          x: containerRect.width / 2 - 100,
          y: containerRect.height / 2 - 75,
          width: 200,
          height: 150
        })
      }

      setLoading(false)
    }
  }

  // 处理缩放
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.max(0.5, Math.min(3, scale * delta))

    // 以鼠标位置为中心缩放
    const rect = containerRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const scaleRatio = newScale / scale
    setPosition({
      x: mouseX - (mouseX - position.x) * scaleRatio,
      y: mouseY - (mouseY - position.y) * scaleRatio
    })
    setScale(newScale)

    // 同步调整裁剪框位置
    setCropBox(prev => ({
      x: mouseX - (mouseX - prev.x) * scaleRatio,
      y: mouseY - (mouseY - prev.y) * scaleRatio,
      width: prev.width * scaleRatio,
      height: prev.height * scaleRatio
    }))
  }, [scale, position])

  // 开始拖拽图片
  const handleImageMouseDown = (e) => {
    if (isResizing) return
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    }
  }

  // 开始拖拽裁剪框
  const handleCropMouseDown = (e) => {
    if (isResizing) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - cropBox.x,
      y: e.clientY - cropBox.y
    }
  }

  // 开始调整大小
  const handleResizeStart = (e, handle) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    setResizeHandle(handle)
    cropStartRef.current = { ...cropBox }
    dragStartRef.current = { x: e.clientX, y: e.clientY }
  }

  // 鼠标移动
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging && !isResizing) {
        // 拖拽裁剪框
        const newX = e.clientX - dragStartRef.current.x
        const newY = e.clientY - dragStartRef.current.y

        // 限制在容器内
        const maxX = containerSize.width - cropBox.width
        const maxY = containerSize.height - cropBox.height

        setCropBox(prev => ({
          ...prev,
          x: Math.max(0, Math.min(maxX, newX)),
          y: Math.max(0, Math.min(maxY, newY))
        }))
      } else if (isResizing) {
        // 调整大小
        const deltaX = e.clientX - dragStartRef.current.x
        const deltaY = e.clientY - dragStartRef.current.y

        let newBox = { ...cropStartRef.current }

        switch (resizeHandle) {
          case 'se':
            newBox.width = Math.max(50, cropStartRef.current.width + deltaX)
            newBox.height = Math.max(50, cropStartRef.current.height + deltaY)
            break
          case 'sw':
            newBox.width = Math.max(50, cropStartRef.current.width - deltaX)
            newBox.height = Math.max(50, cropStartRef.current.height + deltaY)
            newBox.x = cropStartRef.current.x + (cropStartRef.current.width - newBox.width)
            break
          case 'ne':
            newBox.width = Math.max(50, cropStartRef.current.width + deltaX)
            newBox.height = Math.max(50, cropStartRef.current.height - deltaY)
            newBox.y = cropStartRef.current.y + (cropStartRef.current.height - newBox.height)
            break
          case 'nw':
            newBox.width = Math.max(50, cropStartRef.current.width - deltaX)
            newBox.height = Math.max(50, cropStartRef.current.height - deltaY)
            newBox.x = cropStartRef.current.x + (cropStartRef.current.width - newBox.width)
            newBox.y = cropStartRef.current.y + (cropStartRef.current.height - newBox.height)
            break
          default:
            break
        }

        // 限制在容器内
        newBox.x = Math.max(0, Math.min(containerSize.width - newBox.width, newBox.x))
        newBox.y = Math.max(0, Math.min(containerSize.height - newBox.height, newBox.y))
        newBox.width = Math.min(newBox.width, containerSize.width - newBox.x)
        newBox.height = Math.min(newBox.height, containerSize.height - newBox.y)

        setCropBox(newBox)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
      setResizeHandle(null)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, resizeHandle, containerSize, cropBox])

  // 确认裁剪
  const handleConfirm = async () => {
    if (!imageRef.current) return

    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = imageRef.current

      // 计算实际裁剪坐标（考虑缩放）
      const actualX = (cropBox.x - position.x) / scale
      const actualY = (cropBox.y - position.y) / scale
      const actualWidth = cropBox.width / scale
      const actualHeight = cropBox.height / scale

      // 设置画布尺寸
      canvas.width = actualWidth
      canvas.height = actualHeight

      // 绘制裁剪区域
      ctx.drawImage(
        img,
        actualX, actualY, actualWidth, actualHeight,
        0, 0, actualWidth, actualHeight
      )

      // 自动优化：去黑边
      const optimizedCanvas = removeBlackBorders(canvas)

      // 转换为图片数据
      const croppedImageUrl = optimizedCanvas.toDataURL('image/jpeg', 0.9)

      onConfirm(croppedImageUrl)
    } catch (error) {
      console.error('裁剪失败:', error)
      Toast.show({ icon: 'fail', content: '裁剪失败' })
    }
  }

  // 去黑边算法
  const removeBlackBorders = (canvas) => {
    const ctx = canvas.getContext('2d')
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    // 计算亮度阈值
    let minBrightness = 255
    let maxBrightness = 0
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3
      minBrightness = Math.min(minBrightness, brightness)
      maxBrightness = Math.max(maxBrightness, brightness)
    }

    const threshold = minBrightness + (maxBrightness - minBrightness) * 0.1

    // 找到内容边界
    let top = 0, bottom = canvas.height - 1
    let left = 0, right = canvas.width - 1

    // 从上往下找
    for (let y = 0; y < canvas.height; y++) {
      let hasContent = false
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
        if (brightness > threshold) {
          hasContent = true
          break
        }
      }
      if (hasContent) {
        top = y
        break
      }
    }

    // 从下往上找
    for (let y = canvas.height - 1; y >= 0; y--) {
      let hasContent = false
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
        if (brightness > threshold) {
          hasContent = true
          break
        }
      }
      if (hasContent) {
        bottom = y
        break
      }
    }

    // 从左往右找
    for (let x = 0; x < canvas.width; x++) {
      let hasContent = false
      for (let y = 0; y < canvas.height; y++) {
        const idx = (y * canvas.width + x) * 4
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
        if (brightness > threshold) {
          hasContent = true
          break
        }
      }
      if (hasContent) {
        left = x
        break
      }
    }

    // 从右往左找
    for (let x = canvas.width - 1; x >= 0; x--) {
      let hasContent = false
      for (let y = 0; y < canvas.height; y++) {
        const idx = (y * canvas.width + x) * 4
        const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
        if (brightness > threshold) {
          hasContent = true
          break
        }
      }
      if (hasContent) {
        right = x
        break
      }
    }

    // 如果边界有效，裁剪
    const padding = 5
    const newLeft = Math.max(0, left - padding)
    const newTop = Math.max(0, top - padding)
    const newRight = Math.min(canvas.width - 1, right + padding)
    const newBottom = Math.min(canvas.height - 1, bottom + padding)

    if (newRight > newLeft && newBottom > newTop) {
      const newCanvas = document.createElement('canvas')
      const newCtx = newCanvas.getContext('2d')
      newCanvas.width = newRight - newLeft
      newCanvas.height = newBottom - newTop
      newCtx.drawImage(canvas, newLeft, newTop, newCanvas.width, newCanvas.height, 0, 0, newCanvas.width, newCanvas.height)
      return newCanvas
    }

    return canvas
  }

  // 重置
  const handleReset = () => {
    if (imageRef.current && containerRef.current) {
      const img = imageRef.current
      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()

      const scaleX = containerRect.width / img.naturalWidth
      const scaleY = containerRect.height / img.naturalHeight
      const initialScale = Math.min(scaleX, scaleY, 1)
      setScale(initialScale)

      const scaledWidth = img.naturalWidth * initialScale
      const scaledHeight = img.naturalHeight * initialScale
      setPosition({
        x: (containerRect.width - scaledWidth) / 2,
        y: (containerRect.height - scaledHeight) / 2
      })

      setCropBox({
        x: containerRect.width / 2 - 100,
        y: containerRect.height / 2 - 75,
        width: 200,
        height: 150
      })
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: '#000',
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 顶部导航 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        background: '#1C1C1E'
      }}>
        <Button fill="none" style={{ color: '#fff' }} onClick={onCancel}>
          取消
        </Button>
        <span style={{ fontSize: '17px', fontWeight: 600, color: '#fff' }}>
          裁剪插图
        </span>
        <Button fill="none" style={{ color: APPLE_COLORS.primary }} onClick={handleConfirm}>
          确认
        </Button>
      </div>

      {/* 图片容器 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          background: '#000'
        }}
        onWheel={handleWheel}
      >
        {loading && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}>
            <SpinLoading style={{ '--size': '48px', '--color': '#fff' }} />
          </div>
        )}

        {/* 原图 */}
        <img
          ref={imageRef}
          src={imageUrl}
          alt="试卷原图"
          style={{
            position: 'absolute',
            left: position.x,
            top: position.y,
            width: imageSize.width * scale,
            height: imageSize.height * scale,
            objectFit: 'contain',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            opacity: loading ? 0 : 1,
            transition: isDragging ? 'none' : 'all 0.1s'
          }}
          onLoad={handleImageLoad}
          onMouseDown={handleImageMouseDown}
          draggable={false}
        />

        {/* 裁剪框 */}
        {!loading && (
          <div
            style={{
              position: 'absolute',
              left: cropBox.x,
              top: cropBox.y,
              width: cropBox.width,
              height: cropBox.height,
              border: '2px solid #fff',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              cursor: isDragging ? 'grabbing' : 'grab',
              zIndex: 10
            }}
            onMouseDown={handleCropMouseDown}
          >
            {/* 网格线 */}
            <div style={{
              position: 'absolute',
              top: '33.33%',
              left: 0,
              right: 0,
              height: '1px',
              background: 'rgba(255,255,255,0.5)'
            }} />
            <div style={{
              position: 'absolute',
              top: '66.66%',
              left: 0,
              right: 0,
              height: '1px',
              background: 'rgba(255,255,255,0.5)'
            }} />
            <div style={{
              position: 'absolute',
              left: '33.33%',
              top: 0,
              bottom: 0,
              width: '1px',
              background: 'rgba(255,255,255,0.5)'
            }} />
            <div style={{
              position: 'absolute',
              left: '66.66%',
              top: 0,
              bottom: 0,
              width: '1px',
              background: 'rgba(255,255,255,0.5)'
            }} />

            {/* 调整大小的手柄 */}
            {['nw', 'ne', 'sw', 'se'].map(handle => (
              <div
                key={handle}
                style={{
                  position: 'absolute',
                  width: '20px',
                  height: '20px',
                  background: '#fff',
                  borderRadius: '50%',
                  cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                  top: handle.includes('n') ? '-10px' : 'calc(100% - 10px)',
                  left: handle.includes('w') ? '-10px' : 'calc(100% - 10px)',
                  zIndex: 20
                }}
                onMouseDown={(e) => handleResizeStart(e, handle)}
              />
            ))}

            {/* 提示文字 */}
            <div style={{
              position: 'absolute',
              bottom: '-30px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#fff',
              fontSize: '13px',
              whiteSpace: 'nowrap'
            }}>
              拖拽移动，滚轮缩放，角点调整大小
            </div>
          </div>
        )}
      </div>

      {/* 底部工具栏 */}
      <div style={{
        padding: '12px 16px',
        background: '#1C1C1E',
        display: 'flex',
        justifyContent: 'center',
        gap: '20px'
      }}>
        <Button
          fill="none"
          style={{ color: '#fff' }}
          onClick={handleReset}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M512 128c-212.8 0-384 171.2-384 384s171.2 384 384 384 384-171.2 384-384-171.2-384-384-384z m0 704c-176.8 0-320-143.2-320-320s143.2-320 320-320 320 143.2 320 320-143.2 320-320 320z"/>
              <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v160H320c-17.6 0-32 14.4-32 32s14.4 32 32 32h160v160c0 17.6 14.4 32 32 32s32-14.4 32-32V544h160c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
            </svg>
            重置
          </span>
        </Button>
        <div style={{ color: '#8E8E93', fontSize: '14px', display: 'flex', alignItems: 'center' }}>
          缩放: {Math.round(scale * 100)}%
        </div>
      </div>
    </div>
  )
}
