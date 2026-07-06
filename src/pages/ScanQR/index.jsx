import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Image as ImageIcon, Clock, Camera } from 'lucide-react'
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

  const nativePlatform = isNative()

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

    const scaledWidth = Math.floor(video.videoWidth * SCALE_DOWN_FACTOR)
    const scaledHeight = Math.floor(video.videoHeight * SCALE_DOWN_FACTOR)

    const centerSize = 280
    const frameWidth = video.videoWidth
    const frameHeight = video.videoHeight
    const cropX = Math.max(0, (frameWidth - centerSize) / 2)
    const cropY = Math.max(0, (frameHeight - centerSize) / 2)
    const cropWidth = Math.min(centerSize, frameWidth)
    const cropHeight = Math.min(centerSize, frameHeight)

    const scaledCropX = Math.floor(cropX * SCALE_DOWN_FACTOR)
    const scaledCropY = Math.floor(cropY * SCALE_DOWN_FACTOR)
    const scaledCropWidth = Math.floor(cropWidth * SCALE_DOWN_FACTOR)
    const scaledCropHeight = Math.floor(cropHeight * SCALE_DOWN_FACTOR)

    canvas.width = scaledWidth
    canvas.height = scaledHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(video, 0, 0, scaledWidth, scaledHeight)

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
          return
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

      cameraTimeoutRef.current = setTimeout(() => {
        if (!cameraReady) {
          setCameraTimeout(true)
          setScanError('摄像头启动超时，请使用相册上传图片')
        }
      }, 3000)

      // Android WebView 的 getUserMedia 无法触发自动对焦，导致画面模糊。
      // 这里是针对非原生环境（浏览器/PWA）的回退方案，使用较高分辨率以获取更清晰的画面。
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
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

  const scanImageWithJsQR = useCallback((img) => {
    const canvas = canvasRef.current
    // 尝试多个分辨率以提升 jsQR 检测率
    const scanResolutions = [1200, 800, 600]
    let code = null

    for (const maxDim of scanResolutions) {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.floor(img.width * scale)
      const h = Math.floor(img.height * scale)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      })
      if (code) break
    }
    return code
  }, [])

  // 原生拍照：使用 Capacitor Camera 插件打开系统相机（支持自动对焦），然后扫描照片
  const handleNativeCapture = async () => {
    setScanning(true)
    setScanError(null)
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const photo = await Camera.getPhoto({
        quality: 100,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        width: 1920
      })

      if (!photo.base64String) {
        throw new Error('No photo data')
      }

      const img = new Image()
      img.onload = () => {
        const code = scanImageWithJsQR(img)

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
      img.src = `data:image/jpeg;base64,${photo.base64String}`
    } catch (err) {
      console.error('Native camera error:', err)
      // 用户取消拍照不算错误，静默处理
      if (err.message && !err.message.toLowerCase().includes('cancell')) {
        setScanError('拍照失败，请重试或使用相册')
      }
      setScanning(false)
    }
  }

  useEffect(() => {
    if (nativePlatform) {
      // 原生端：不启动 getUserMedia（Android WebView 不支持自动对焦），
      // 改用系统拍照界面（已有原生自动对焦支持）
      setCameraTimeout(false)
      setScanError(null)
      return
    }

    // 非原生端（浏览器/PWA）：使用 getUserMedia 实时预览
    startCamera()
    return () => stopCamera()
  }, [nativePlatform])

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
        const code = scanImageWithJsQR(img)

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

  const showNativeUI = nativePlatform && !scanning

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
          {/* 原生端：不显示视频，显示拍照提示 */}
          {showNativeUI && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', position: 'absolute', zIndex: 5, padding: '20px'
            }}>
              <Camera size={64} color="rgba(255,255,255,0.3)" />
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', textAlign: 'center' }}>
                点击下方拍照按钮，使用系统相机识别二维码
              </div>
            </div>
          )}

          {/* 非原生端：实时摄像头预览 */}
          {!nativePlatform && (
            <video ref={videoRef} style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
            }} />
          )}

          {/* 摄像头加载中（仅非原生端） */}
          {!nativePlatform && !cameraReady && !cameraTimeout && (
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

          {/* 摄像头超时（仅非原生端） */}
          {!nativePlatform && cameraTimeout && (
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

          {/* 扫码框 */}
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

            {!nativePlatform && (
              <motion.div
                animate={{ top: ['0%', '100%', '0%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                style={{
                  position: 'absolute', left: 0, right: 0, height: '2px',
                  background: 'linear-gradient(to right, transparent, #2563EB, transparent)'
                }}
              />
            )}
          </div>

          {/* 扫描中加载指示 */}
          {scanning && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.6)'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <Loader2 size={40} color="#2563EB" className="animate-spin" />
                <div style={{ color: '#fff', fontSize: '15px' }}>识别中...</div>
              </div>
            </div>
          )}

          {/* 错误提示（非超时状态） */}
          {scanError && !cameraTimeout && (
            <div style={{ color: '#EF4444', fontSize: '14px', marginTop: '20px', textAlign: 'center', padding: '0 20px' }}>
              {scanError}
            </div>
          )}

          {/* 提示文字 */}
          {!nativePlatform && cameraReady && !scanError && !cameraTimeout && (
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

          {/* 拍照按钮：原生端触发系统拍照，非原生端为占位 */}
          <div
            onClick={nativePlatform ? handleNativeCapture : undefined}
            style={{
              width: '64px', height: '64px', borderRadius: '50%',
              border: nativePlatform ? '4px solid #2563EB' : '4px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: nativePlatform ? 'pointer' : 'default',
              transition: 'transform 0.2s',
              ...(nativePlatform ? { active: { transform: 'scale(0.95)' } } : {})
            }}
          >
            <div style={{
              width: '52px', height: '52px', borderRadius: '50%',
              background: nativePlatform ? '#2563EB' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Camera size={28} color="#fff" />
            </div>
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

        {nativePlatform && (
          <div style={{ textAlign: 'center', paddingBottom: '8px' }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
              点击拍照按钮，使用系统相机识别
            </div>
          </div>
        )}
      </div>
    </AnimatePresence>
  )
}