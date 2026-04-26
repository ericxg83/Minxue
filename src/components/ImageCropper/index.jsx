import { useState, useCallback } from 'react'
import { Button, Mask, Toast } from 'antd-mobile'
import Cropper from 'react-easy-crop'

// 头像裁剪组件
export default function ImageCropper({ image, onCropComplete, onCancel }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)

  const onCropChange = useCallback((crop) => {
    setCrop(crop)
  }, [])

  const onZoomChange = useCallback((zoom) => {
    setZoom(zoom)
  }, [])

  const onCropCompleteCallback = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleConfirm = async () => {
    try {
      const croppedImage = await getCroppedImg(image, croppedAreaPixels)
      onCropComplete(croppedImage)
    } catch (error) {
      console.error('裁剪失败:', error)
      Toast.show({ icon: 'fail', content: '裁剪失败' })
    }
  }

  return (
    <Mask visible={true} opacity={1}>
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#000',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* 顶部导航 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          background: '#1a1a1a'
        }}>
          <Button fill="none" onClick={onCancel} style={{ color: '#fff' }}>
            取消
          </Button>
          <span style={{ color: '#fff', fontSize: '17px', fontWeight: 600 }}>
            裁剪头像
          </span>
          <Button fill="none" onClick={handleConfirm} style={{ color: '#1677ff' }}>
            确定
          </Button>
        </div>

        {/* 裁剪区域 */}
        <div style={{ flex: 1, position: 'relative' }}>
          <Cropper
            image={image}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={onCropCompleteCallback}
            style={{
              containerStyle: {
                background: '#000'
              },
              cropAreaStyle: {
                border: '2px solid #1677ff'
              }
            }}
          />
        </div>

        {/* 底部缩放控制 */}
        <div style={{
          padding: '20px 32px',
          background: '#1a1a1a'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }}>
            <svg width="20" height="20" viewBox="0 0 1024 1024" fill="#999">
              <path d="M512 128c-211.2 0-384 172.8-384 384s172.8 384 384 384 384-172.8 384-384-172.8-384-384-384z m0 704c-176 0-320-144-320-320s144-320 320-320 320 144 320 320-144 320-320 320z"/>
              <path d="M512 320c-17.6 0-32 14.4-32 32v128H352c-17.6 0-32 14.4-32 32s14.4 32 32 32h128v128c0 17.6 14.4 32 32 32s32-14.4 32-32v-128h128c17.6 0 32-14.4 32-32s-14.4-32-32-32h-128v-128c0-17.6-14.4-32-32-32z"/>
            </svg>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{
                flex: 1,
                height: '4px',
                background: '#333',
                borderRadius: '2px',
                outline: 'none',
                WebkitAppearance: 'none'
              }}
            />
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="#999">
              <path d="M512 128c-211.2 0-384 172.8-384 384s172.8 384 384 384 384-172.8 384-384-172.8-384-384-384z m0 704c-176 0-320-144-320-320s144-320 320-320 320 144 320 320-144 320-320 320z"/>
              <path d="M672 480H352c-17.6 0-32 14.4-32 32s14.4 32 32 32h320c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
            </svg>
          </div>
        </div>
      </div>
    </Mask>
  )
}

// 裁剪图片的辅助函数
async function getCroppedImg(imageSrc, pixelCrop) {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('无法创建 canvas 上下文')
  }

  // 设置输出尺寸
  const size = Math.min(pixelCrop.width, pixelCrop.height)
  canvas.width = size
  canvas.height = size

  // 绘制裁剪后的图片
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    size,
    size
  )

  // 转换为 base64
  return canvas.toDataURL('image/jpeg', 0.9)
}

// 创建图片对象
function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.src = url
  })
}
