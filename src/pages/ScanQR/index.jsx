import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Image as ImageIcon, Clock, Camera, Scan } from 'lucide-react'
import jsQR from 'jsqr'

// 缩小视频帧以便 jsQR 更容易检测到二维码
const SCALE_DOWN_FACTOR = 0.3

// 尝试用 Capacitor 原生相机拍照（支持自动对焦），失败则返回 false
const tryNativeCamera = async () => {
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
    const photo = await Camera.getPhoto({
      quality: 100,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      width: 1920
    })
    return photo.base64String || null
  } catch {
    return null
  }
}

export default function ScanQR({ onClose, onScanSuccess }) {
  const [scanning, setScanning] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [cameraTimeout, setCameraTimeout] = useState(false)
  const [photoMode, setPhotoMode] = useState(false) // 是否切换到拍照模式
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
      cameraTimeoutRef.current = setTimeout(() => {
        if (!cameraReady) {
          setCameraTimeout(true)
          setScanError('摄像头启动超时，请使用相册上传图片')
        }
      }, 5000)

      // 尝试获取摄像头权限
      // Android WebView 下 getUserMedia 可能无法触发自动对焦导致画面模糊，
      // 此时可点击下方拍照按钮使用系统相机（支持自动对焦）
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: 'environment' },
          width: { min: 640, ideal: 1920 },
          height: { min: 480, ideal: 1080 }
        }
      })
      streamRef.current = stream

      // 尝试设置连续自动对焦（部分设备支持）
      try {
        const track = stream.getVideoTracks()[0]
        if (track && track.applyConstraints) {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous-video' }]
          })
        }
      } catch {
        // 不支持自动对焦，忽略
      }

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
      } else if (err.name === 'OverconstrainedError') {
        // exact environment 失败，回退到不带 exact 的约束
        try {
          cameraTimeoutRef.current = setTimeout(() => {
            if (!cameraReady) {
              setCameraTimeout(true)
            }
          }, 5000)

          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
          })
          streamRef.current = fallbackStream
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream
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
              })
            }
          }
        } catch {
          setScanError('无法访问摄像头，请使用相册上传图片')
          setCameraTimeout(true)
        }
      } else {
        setScanError('无法访问摄像头，请使用相册上传图片')
        setCameraTimeout(true)
      }
    }
  }

  const scanImageWithJsQR = useCallback((img) => {
    const canvas = canvasRef.current
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

  // 拍照识别：使用 Capacitor 原生相机（支持自动对焦）或 file input 兜底
  const handleCapturePhoto = async () => {
    setScanning(true)
    setScanError(null)
    stopCamera()

    // 先尝试原生相机（Capacitor Camera 插件，系统相机有自动对焦）
    const base64 = await tryNativeCamera()

    if (base64) {
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
      img.src = `data:image/jpeg;base64,${base64}`
    } else {
      // 原生相机不可用，使用 file input 兜底
      fileInputRef.current?.click()
      setScanning(false)
    }
  }

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [])

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

  // 尝试重新对焦（点击画面时触发）
  const handleVideoTap = async () => {
    if (!streamRef.current) return
    try {
      const track = streamRef.current.getVideoTracks()[0]
      if (track && track.applyConstraints) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous-video' }]
        })
      }
    } catch {
      // 不支持
    }
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

        {/* 顶部栏 */}
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

        {/* 摄像头区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}>
          {/* 实时摄像头预览 */}
          <video
            ref={videoRef}
            onClick={handleVideoTap}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
            }}
          />

          {/* 加载中 */}
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

          {/* 摄像头超时 */}
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

            {cameraReady && (
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

          {/* 扫描中 */}
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

          {/* 画面模糊提示 */}
          {cameraReady && !scanError && !cameraTimeout && (
            <div onClick={handleCapturePhoto} style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: '13px',
              marginTop: '12px',
              textAlign: 'center',
              padding: '6px 16px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              zIndex: 5
            }}>
              <Camera size={14} />
              画面模糊？点击拍照（系统相机自动对焦）
            </div>
          )}

          {/* 错误提示 */}
          {scanError && !cameraTimeout && (
            <div style={{ color: '#EF4444', fontSize: '14px', marginTop: '20px', textAlign: 'center', padding: '0 40px', zIndex: 5 }}>
              {scanError}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div style={{
          padding: '0 32px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div onClick={handleAlbum} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 6px'
            }}>
              <ImageIcon size={24} color="#fff" />
            </div>
            <div style={{ color: '#fff', fontSize: '12px' }}>相册</div>
          </div>

          {/* 拍照识别按钮（核心功能：使用系统相机，支持自动对焦） */}
          <div
            onClick={handleCapturePhoto}
            style={{
              width: '72px', height: '72px', borderRadius: '50%',
              border: '4px solid #2563EB',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'transform 0.2s',
              background: 'rgba(37,99,235,0.15)'
            }}
          >
            <div style={{
              width: '56px', height: '56px', borderRadius: '50%',
              background: '#2563EB',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column',
              gap: '1px'
            }}>
              <Camera size={24} color="#fff" />
            </div>
          </div>

          <div style={{ textAlign: 'center', opacity: 0.3 }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 6px'
            }}>
              <Clock size={24} color="#fff" />
            </div>
            <div style={{ color: '#fff', fontSize: '12px' }}>历史</div>
          </div>
        </div>

        {/* 底部提示文字 */}
        <div style={{ textAlign: 'center', paddingBottom: '12px' }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
            点击「拍照」使用系统相机识别 · 支持自动对焦
          </div>
        </div>
      </div>
    </AnimatePresence>
  )
}