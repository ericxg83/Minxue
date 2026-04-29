import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import Cropper from 'react-easy-crop'

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
      alert('裁剪失败')
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black z-[10000] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-12 pb-4 bg-gray-900">
          <button onClick={onCancel} className="text-[15px] font-medium text-white">
            取消
          </button>
          <h2 className="text-[17px] font-bold text-white">裁剪头像</h2>
          <button onClick={handleConfirm} className="text-[15px] font-medium text-blue-500">
            确定
          </button>
        </div>

        {/* Cropper Area */}
        <div className="flex-1 relative">
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
                border: '2px solid #3b82f6'
              }
            }}
          />
        </div>

        {/* Zoom Control */}
        <div className="px-8 py-6 bg-gray-900">
          <div className="flex items-center gap-4">
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
              className="flex-1 h-1 bg-gray-700 rounded-full outline-none appearance-none cursor-pointer"
            />
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="#999">
              <path d="M512 128c-211.2 0-384 172.8-384 384s172.8 384 384 384 384-172.8 384-384-172.8-384-384-384z m0 704c-176 0-320-144-320-320s144-320 320-320 320 144 320 320-144 320-320 320z"/>
              <path d="M672 480H352c-17.6 0-32 14.4-32 32s14.4 32 32 32h320c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
            </svg>
          </div>
        </div>
      </div>
    </AnimatePresence>
  )
}

async function getCroppedImg(imageSrc, pixelCrop) {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('无法创建 canvas 上下文')
  }

  const size = Math.min(pixelCrop.width, pixelCrop.height)
  canvas.width = size
  canvas.height = size

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

  return canvas.toDataURL('image/jpeg', 0.9)
}

function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.src = url
  })
}
