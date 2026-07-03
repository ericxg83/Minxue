import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Image as ImageIcon, Clock } from 'lucide-react'
import jsQR from 'jsqr'

// 缩小视频帧以便 jsQR 更容易检测到二维码
// 手机摄像头分辨率太高(如1920x1080)，二维码在画面中太小无法识别
const SCALE_DOWN_FACTOR = 0.3

const isNative = () => {
  try {
    return !!(window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

export default function ScanQR({ onClose, onScanSuccess }) {
  const [scanning, setScanning] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [cameraTimeout, setCameraTimeout] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animFrameRef = useRef(null)
  const fileInputRef = useRef(null)
  const cameraTimeoutRef = useRef(null)

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (cameraTimeoutRef.current) {
      clearTimeout(cameraTimeoutRef.current)
      cameraTimeoutRef.current = null
    }
    setCameraReady(false)
  }, [])

  const processFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      animFrameRef.current = requestAnimationFrame(processFrame)
      return
    }

    // 缩小帧尺寸以提高 jsQR 检测率
    const scaledWidth = Math.floor(video.videoWidth * SCALE_DOWN_FACTOR)
    const scaledHeight = Math.floor(video.videoHeight * SCALE_DOWN_FACTOR)

    // Phase 2: 只处理中心识别框区域，提升性能约 40%
    // 计算中心 280x280 框在视频中的位置
    const centerSize = 280
    const frameWidth = video.videoWidth
    const frameHeight = video.videoHeight
    const cropX = Math.max(0, (frameWidth - centerSize) / 2)
    const cropY = Math.max(0, (frameHeight - centerSize) / 2)
    const cropWidth = Math.min(centerSize, frameWidth)
    const cropHeight = Math.min(centerSize, frameHeight)

    // 按缩放比例调整裁剪区域
    const scaledCropX = Math.floor(cropX * SCALE_DOWN_FACTOR)
    const scaledCropY = Math.floor(cropY * SCALE_DOWN_FACTOR)
    const scaledCropWidth = Math.floor(cropWidth * SCALE_DOWN_FACTOR)
    const scaledCropHeight = Math.floor(cropHeight * SCALE_DOWN_FACTOR)

    canvas.width = scaledWidth
    canvas.height = scaledHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(video, 0, 0, scaledWidth, scaledHeight)

    // 只获取框内区域的图像数据
    const imageData = ctx.getImageData(
      scaledCropX,
      scaledCropY,
      scaledCropWidth,
      scaledCropHeight
    )

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    })

    if (code) {
      try {
        const data = JSON.parse(code.data)
        if (data.type === 'grading') {
          stopCamera()
          onScanSuccess({
            paperId: data.paperId || '',
            studentId: data.studentId,
            studentName: data.studentName || '',
            questionIds: data.questionIds || data.qIds,
            generatedExamId: data.generatedExamId || '',
            timestamp: data.timestamp || data.ts
          })
          return // 识别成功后立即停止，不再继续下一帧
        } else {
          setScanError('无效的二维码类型')
        }
      } catch {
        setScanError('无法解析二维码内容')
      }
    }

    if (streamRef.current) {
      animFrameRef.current = requestAnimationFrame(processFrame)
    }
  }, [stopCamera, onScanSuccess])

  const startCamera = async () => {
    try {
      // Capacitor Android 需要运行时权限，先检查并请求
      if (isNative()) {
        try {
          const { Camera } = await import('@capacitor/camera')
          const permResult = await Camera.requestPermissions()
          if (permResult.camera !== 'granted') {
            setScanError('摄像头权限被拒绝，请前往系统设置允许相机权限，或使用相册上传')
            setCameraTimeout(true)
            return
          }
        } catch {
          // Capacitor 权限请求失败，继续尝试 getUserMedia 兜底
        }
      }

      // 设置 3 秒超时，如果摄像头无响应则提示使用相册
      cameraTimeoutRef.current = setTimeout(() => {
        if (!cameraReady) {
          setCameraTimeout(true)
          setScanError('摄像头启动超时，请使用相册上传图片')
        }
      }, 3000)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', 'true')
        videoRef.current.setAttribute('autoplay', 'true')
        videoRef.current.setAttribute('muted', 'true')

        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => {
            if (cameraTimeoutRef.current) {
              clearTimeout(cameraTimeoutRef.current)
              cameraTimeoutRef.current = null
            }
            setCameraReady(true)
            setScanError(null)
            setCameraTimeout(false)
            animFrameRef.current = requestAnimationFrame(processFrame)
          }).catch(err => {
            console.error('Video play failed:', err)
            setScanError('摄像头启动失败，请使用相册上传图片')
            setCameraTimeout(true)
          })
        }
      }
    } catch (err) {
      console.error('Camera error:', err)
      if (err.name === 'NotAllowedError') {
        setScanError('摄像头权限被拒绝，请在浏览器设置中允许访问摄像头，或使用相册上传')
      } else {
        setScanError('无法访问摄像头，请使用相册上传图片')
      }
      setCameraTimeout(true)
    }
  }

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [stopCamera])

  const handleAlbum = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setScanning(true)
    setScanError(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        // Phase 2: 复用 canvas，优化内存使用
        const canvas = canvasRef.current
        const scale = Math.min(1, 600 / Math.max(img.width, img.height))
        canvas.width = Math.floor(img.width * scale)
        canvas.height = Math.floor(img.height * scale)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)

        if (code) {
          try {
            const data = JSON.parse(code.data)
            if (data.type === 'grading') {
              onScanSuccess({
                paperId: data.paperId || '',
                studentId: data.studentId,
                studentName: data.studentName || '',
                questionIds: data.questionIds || data.qIds,
                generatedExamId: data.generatedExamId || '',
                timestamp: data.timestamp || data.ts
              })
            } else {
              setScanError('无效的二维码类型')
            }
          } catch {
            setScanError('无法解析二维码内容')
          }
        } else {
          setScanError('未检测到二维码，请确保图片清晰并包含二维码')
        }
        setScanning(false)
      }
      img.onerror = () => {
        setScanError('图片加载失败')
        setScanning(false)
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column'
      }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '48px 16px 12px',
          position: 'relative',
          zIndex: 10
        }}>
          <button onClick={onClose} style={{
            padding: '4px', borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer'
          }}>
            <X size={22} color="#fff" />
          </button>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#fff' }}>扫码批改</h2>
          <div style={{ width: '36px' }} />
        </div>

        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}>
          <video ref={videoRef} style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
          }} />

          {!cameraReady && !cameraTimeout && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: '12px', zIndex: 5
            }}>
              <Loader2 size={32} color="#2563EB" className="animate-spin" />
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                正在启动摄像头...
              </div>
            </div>
          )}

          {cameraTimeout && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: '16px', zIndex: 5,
              background: 'rgba(0,0,0,0.8)', padding: '20px'
            }}>
              <ImageIcon size={48} color="#EF4444" />
              <div style={{ color: '#fff', fontSize: '15px', textAlign: 'center', lineHeight: '1.6' }}>
                {scanError}
              </div>
              <button
                onClick={handleAlbum}
                style={{
                  padding: '12px 32px',
                  background: '#2563EB',
                  color: '#fff',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <ImageIcon size={18} />
                打开相册
              </button>
            </div>
          )}

          <div style={{
            width: '280px',
            height: '280px',
            border: '2px solid rgba(255,255,255,0.5)',
            borderRadius: '20px',
            position: 'relative',
            zIndex: 1
          }}>
            <div style={{
              position: 'absolute', top: '-2px', left: '-2px', width: '30px', height: '30px',
              borderTop: '4px solid #2563EB', borderLeft: '4px solid #2563EB', borderTopLeftRadius: '10px'
            }} />
            <div style={{
              position: 'absolute', top: '-2px', right: '-2px', width: '30px', height: '30px',
              borderTop: '4px solid #2563EB', borderRight: '4px solid #2563EB', borderTopRightRadius: '10px'
            }} />
            <div style={{
              position: 'absolute', bottom: '-2px', left: '-2px', width: '30px', height: '30px',
              borderBottom: '4px solid #2563EB', borderLeft: '4px solid #2563EB', borderBottomLeftRadius: '10px'
            }} />
            <div style={{
              position: 'absolute', bottom: '-2px', right: '-2px', width: '30px', height: '30px',
              borderBottom: '4px solid #2563EB', borderRight: '4px solid #2563EB', borderBottomRightRadius: '10px'
            }} />

            <motion.div
              animate={{ top: ['0%', '100%', '0%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              style={{
                position: 'absolute', left: 0, right: 0, height: '2px',
                background: 'linear-gradient(to right, transparent, #2563EB, transparent)'
              }}
            />
          </div>

          {scanError && !cameraTimeout && (
            <div style={{ color: '#EF4444', fontSize: '14px', marginTop: '20px', textAlign: 'center', padding: '0 20px' }}>
              {scanError}
            </div>
          )}

          {cameraReady && !scanError && !cameraTimeout && (
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', marginTop: '24px', textAlign: 'center' }}>
              将二维码放入框内，自动识别
            </div>
          )}
        </div>

        <div style={{
          padding: '0 40px 48px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div onClick={handleAlbum} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 8px'
            }}>
              <ImageIcon size={24} color="#fff" />
            </div>
            <div style={{ color: '#fff', fontSize: '12px' }}>相册</div>
          </div>

          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            border: '4px solid #fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '50%',
              background: '#fff'
            }} />
          </div>

          <div style={{ textAlign: 'center', opacity: 0.3 }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 8px'
            }}>
              <Clock size={24} color="#fff" />
            </div>
            <div style={{ color: '#fff', fontSize: '12px' }}>历史</div>
          </div>
        </div>
      </div>
    </AnimatePresence>
  )
}
