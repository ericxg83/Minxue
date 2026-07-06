import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Image as ImageIcon, Camera } from 'lucide-react'
import jsQR from 'jsqr'

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
  const scanLockRef = useRef(false) // 防止重复处理

  // ----- getUserMedia + jsQR（Web/PWA 兜底方案）-----
  const SCALE_DOWN_FACTOR = 0.3

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

    const imageData = ctx.getImageData(scaledCropX, scaledCropY, scaledCropWidth, scaledCropHeight)
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    })

    if (code && !scanLockRef.current) {
      scanLockRef.current = true
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
      scanLockRef.current = false
    }

    if (streamRef.current) {
      animFrameRef.current = requestAnimationFrame(processFrame)
    }
  }, [stopCamera, onScanSuccess])

  const startWebCamera = async () => {
    try {
      cameraTimeoutRef.current = setTimeout(() => {
        if (!cameraReady) {
          setCameraTimeout(true)
          setScanError('摄像头启动超时，请使用相册上传图片或重试')
        }
      }, 5000)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      })
      streamRef.current = stream

      try {
        const track = stream.getVideoTracks()[0]
        if (track?.applyConstraints) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous-video' }] })
        }
      } catch { /* 不支持自动对焦，忽略 */ }

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
          }).catch(() => {
            setScanError('摄像头启动失败')
            setCameraTimeout(true)
          })
        }
      }
    } catch (err) {
      console.error('Camera error:', err)
      if (err.name === 'NotAllowedError') {
        setScanError('摄像头权限被拒绝')
      } else if (err.name === 'OverconstrainedError') {
        try {
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
                if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current)
                setCameraReady(true)
                setScanError(null)
                setCameraTimeout(false)
                animFrameRef.current = requestAnimationFrame(processFrame)
              })
            }
          }
        } catch {
          setScanError('无法访问摄像头')
          setCameraTimeout(true)
        }
      } else {
        setScanError('无法访问摄像头')
        setCameraTimeout(true)
      }
    }
  }

  // ----- 原生扫码（@capacitor-mlkit/barcode-scanning）-----
  const startNativeScan = async () => {
    try {
      const { BarcodeScanner, BarcodeFormat, LensFacing } = await import('@capacitor-mlkit/barcode-scanning')

      const permResult = await BarcodeScanner.requestPermissions()
      if (permResult.camera !== 'granted') {
        setScanError('摄像头权限被拒绝')
        setCameraTimeout(true)
        return
      }

      // 让 WebView 背景透明，原生摄像头画面透出
      document.body?.classList.add('barcode-scanner-active')

      // 监听二维码检测
      await BarcodeScanner.addListener('barcodesScanned', async (event) => {
        if (scanLockRef.current) return
        const barcode = event.barcodes?.[0]
        if (barcode?.rawValue) {
          scanLockRef.current = true
          try {
            const data = JSON.parse(barcode.rawValue)
            if (data.type === 'grading') {
              await BarcodeScanner.removeAllListeners()
              await BarcodeScanner.stopScan()
              document.body?.classList.remove('barcode-scanner-active')
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
              scanLockRef.current = false
            }
          } catch {
            setScanError('无法解析二维码内容')
            scanLockRef.current = false
          }
        }
      })

      // 启动原生摄像头（支持自动对焦）
      await BarcodeScanner.startScan({
        formats: [BarcodeFormat.QrCode],
        lensFacing: LensFacing.Back,
      })

      setCameraReady(true)
    } catch (err) {
      console.error('Native scan error:', err)
      // 降级到 getUserMedia
      setScanError(null)
      startWebCamera()
    }
  }

  const stopNativeScan = async () => {
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
      await BarcodeScanner.removeAllListeners()
      await BarcodeScanner.stopScan()
    } catch { /* ignore */ }
    document.body?.classList.remove('barcode-scanner-active')
  }

  // ----- 启动逻辑 -----
  useEffect(() => {
    if (isNative()) {
      startNativeScan()
    } else {
      startWebCamera()
    }
    return () => {
      if (isNative()) {
        stopNativeScan()
      } else {
        stopCamera()
      }
    }
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
          code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
          if (code) break
        }
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
          setScanError('未检测到二维码，请确保图片清晰')
        }
        setScanning(false)
      }
      img.onerror = () => { setScanError('图片加载失败'); setScanning(false) }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  const isOnNative = isNative()

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed', inset: 0, background: isOnNative ? 'transparent' : '#000',
        zIndex: 10000, display: 'flex', flexDirection: 'column'
      }}>
        {/* 全局样式：原生扫码时透明背景 */}
        <style>{`
          body.barcode-scanner-active {
            background: transparent !important;
          }
        `}</style>

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* 顶部栏 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '48px 16px 12px', position: 'relative', zIndex: 10
        }}>
          <button onClick={onClose} style={{
            padding: '4px', borderRadius: '50%', background: 'rgba(0,0,0,0.3)', border: 'none', cursor: 'pointer',
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <X size={22} color="#fff" />
          </button>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>扫码批改</h2>
          <div style={{ width: '36px' }} />
        </div>

        {/* 摄像头区域 */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative'
        }}>
          {/* Web 模式：实时摄像头预览 */}
          {!isOnNative && (
            <video ref={videoRef} style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
            }} />
          )}

          {/* 加载中 */}
          {!cameraReady && !cameraTimeout && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: '12px', zIndex: 5
            }}>
              <Loader2 size={32} color="#fff" className="animate-spin" />
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                正在启动相机...
              </div>
            </div>
          )}

          {/* 超时/错误 */}
          {cameraTimeout && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: '16px', zIndex: 5, background: 'rgba(0,0,0,0.85)', padding: '20px'
            }}>
              <div style={{ color: '#fff', fontSize: '15px', textAlign: 'center', lineHeight: '1.6' }}>
                {scanError || '无法启动相机'}
              </div>
              <button onClick={handleAlbum} style={{
                padding: '12px 32px', background: '#2563EB', color: '#fff', borderRadius: '8px',
                fontSize: '15px', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
              }}>
                <ImageIcon size={18} />
                打开相册
              </button>
            </div>
          )}

          {/* 扫码框 */}
          <div style={{
            width: '280px', height: '280px',
            border: '2px solid rgba(255,255,255,0.6)',
            borderRadius: '20px', position: 'relative', zIndex: 1,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)'
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
              position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.6)'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <Loader2 size={40} color="#2563EB" className="animate-spin" />
                <div style={{ color: '#fff', fontSize: '15px' }}>识别中...</div>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {scanError && !cameraTimeout && (
            <div style={{
              color: '#EF4444', fontSize: '14px', marginTop: '20px', textAlign: 'center',
              padding: '0 20px', zIndex: 5, textShadow: '0 1px 4px rgba(0,0,0,0.5)'
            }}>
              {scanError}
            </div>
          )}

          {/* 提示文字 */}
          {cameraReady && !scanError && !cameraTimeout && (
            <div style={{
              color: 'rgba(255,255,255,0.9)', fontSize: '14px', marginTop: '24px',
              textAlign: 'center', zIndex: 5, textShadow: '0 1px 4px rgba(0,0,0,0.5)'
            }}>
              将二维码放入框内，自动识别
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div style={{
          padding: '0 32px 32px', display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div onClick={handleAlbum} style={{
            textAlign: 'center', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '24px', background: 'rgba(0,0,0,0.3)'
          }}>
            <ImageIcon size={20} color="#fff" />
            <div style={{ color: '#fff', fontSize: '13px' }}>相册</div>
          </div>
        </div>
      </div>
    </AnimatePresence>
  )
}