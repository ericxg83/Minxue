import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Image as ImageIcon, Clock, QrCode, ClipboardPaste } from 'lucide-react'
import jsQR from 'jsqr'

export default function ScanQR({ onClose, onScanSuccess }) {
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animFrameRef = useRef(null)
  const fileInputRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [])

  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) processImageFile(file)
          break
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      streamRef.current = stream
      setHasCamera(true)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', true)
        videoRef.current.play()
        setCameraReady(true)
        requestAnimationFrame(tick)
      }
    } catch (err) {
      console.warn('无法访问摄像头:', err)
      setHasCamera(false)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
    }
  }

  const tick = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.height = videoRef.current.videoHeight
      canvas.width = videoRef.current.videoWidth
      const ctx = canvas.getContext('2d')
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      })
      if (code) {
        stopCamera()
        processQRData(code.data)
        return
      }
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }

  const processQRData = (data) => {
    try {
      const parsed = JSON.parse(data)
      if (parsed.type === 'grading') {
        onScanSuccess({
          paperId: parsed.paperId,
          studentId: parsed.studentId,
          studentName: parsed.studentName,
          questionIds: parsed.questionIds,
          timestamp: parsed.timestamp
        })
      } else {
        setScanError('无效的二维码类型，请扫描试卷上的批改二维码')
        startCamera()
      }
    } catch {
      setScanError('无法解析二维码内容')
      startCamera()
    }
  }

  const processImageFile = (file) => {
    setScanning(true)
    setScanError(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const scales = [1, 2, 3, 0.5]
        let code = null

        for (const scale of scales) {
          const canvas = document.createElement('canvas')
          canvas.width = img.width * scale
          canvas.height = img.height * scale
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          
          code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
          })

          if (code) break
        }

        if (code) {
          processQRData(code.data)
        } else {
          setScanError('未检测到二维码，请确保图片中包含完整的二维码')
        }
        setScanning(false)
      }
      img.onerror = () => {
        setScanError('图片加载失败')
        setScanning(false)
      }
      img.src = event.target.result
    }
    reader.onerror = () => {
      setScanError('图片读取失败')
      setScanning(false)
    }
    reader.readAsDataURL(file)
  }

  const handleAlbum = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    processImageFile(file)
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
        <canvas ref={canvasRef} style={{ position: 'absolute', left: '-9999px', top: '-9999px', visibility: 'hidden' }} />

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '48px 16px 12px'
        }}>
          <button onClick={onClose} style={{
            padding: '4px', borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer'
          }}>
            <X size={22} color="#fff" />
          </button>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#fff' }}>扫码批改</h2>
          <div style={{ width: '36px' }} />
        </div>

        <div ref={containerRef} style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}>
          {hasCamera && cameraReady && (
            <video ref={videoRef} style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
            }} />
          )}

          <div style={{
            width: '280px',
            height: '280px',
            border: '2px solid rgba(255,255,255,0.5)',
            borderRadius: '20px',
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
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

            {!hasCamera && !scanning && (
              <QrCode size={40} color="rgba(255,255,255,0.3)" />
            )}

            {hasCamera && cameraReady && (
              <motion.div
                animate={{ top: ['0%', '100%', '0%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                style={{
                  position: 'absolute', left: 0, right: 0, height: '2px',
                  background: 'linear-gradient(to right, transparent, #2563EB, transparent)'
                }}
              />
            )}

            {scanning && (
              <Loader2 size={40} color="#2563EB" className="animate-spin" />
            )}
          </div>

          {scanError && (
            <div style={{ color: '#EF4444', fontSize: '14px', marginTop: '20px', textAlign: 'center', maxWidth: '280px' }}>
              {scanError}
            </div>
          )}

          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', marginTop: '24px', textAlign: 'center' }}>
            {hasCamera ? '将二维码放入框内，自动识别' : '请使用下方相册按钮上传图片'}
          </div>

          <div style={{
            marginTop: '16px',
            padding: '12px 20px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'rgba(255,255,255,0.6)',
            fontSize: '13px'
          }}>
            <ClipboardPaste size={16} />
            <span>或按 Ctrl+V 粘贴截图</span>
          </div>
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
