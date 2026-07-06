import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Image as ImageIcon } from 'lucide-react'
import jsQR from 'jsqr'

const isNative = () => {
  try {
    return !!(window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

// 扫码成功后处理结果
const handleScanResult = (rawValue, onScanSuccess, setScanError) => {
  try {
    const data = JSON.parse(rawValue)
    if (data.type === 'grading') {
      onScanSuccess({
        paperId: data.paperId || '',
        studentId: data.studentId,
        studentName: data.studentName || '',
        questionIds: data.questionIds || data.qIds,
        generatedExamId: data.generatedExamId || '',
        timestamp: data.timestamp || data.ts
      })
      return true
    } else {
      setScanError('无效的二维码类型')
      return false
    }
  } catch {
    setScanError('无法解析二维码内容')
    return false
  }
}

export default function ScanQR({ onClose, onScanSuccess }) {
  const [scanning, setScanning] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [scanError, setScanError] = useState(null)
  const [cameraTimeout, setCameraTimeout] = useState(false)
  const [initMsg, setInitMsg] = useState('正在启动相机...')
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animFrameRef = useRef(null)
  const fileInputRef = useRef(null)
  const cameraTimeoutRef = useRef(null)
  const scanLockRef = useRef(false)
  const mountedRef = useRef(true)

  // ----- getUserMedia + jsQR（兜底方案）-----
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
    const cropX = Math.max(0, (video.videoWidth - centerSize) / 2)
    const cropY = Math.max(0, (video.videoHeight - centerSize) / 2)
    const cropW = Math.min(centerSize, video.videoWidth)
    const cropH = Math.min(centerSize, video.videoHeight)

    canvas.width = scaledWidth
    canvas.height = scaledHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(video, 0, 0, scaledWidth, scaledHeight)

    const imageData = ctx.getImageData(
      Math.floor(cropX * SCALE_DOWN_FACTOR), Math.floor(cropY * SCALE_DOWN_FACTOR),
      Math.floor(cropW * SCALE_DOWN_FACTOR), Math.floor(cropH * SCALE_DOWN_FACTOR)
    )
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' })

    if (code && !scanLockRef.current) {
      scanLockRef.current = true
      const ok = handleScanResult(code.data, onScanSuccess, setScanError)
      if (ok) { stopCamera(); return }
      scanLockRef.current = false
    }
    if (streamRef.current) {
      animFrameRef.current = requestAnimationFrame(processFrame)
    }
  }, [stopCamera, onScanSuccess])

  const startWebCamera = useCallback(async () => {
    try {
      setInitMsg('正在启动摄像头...')
      cameraTimeoutRef.current = setTimeout(() => {
        if (!cameraReady && mountedRef.current) {
          setCameraTimeout(true)
          setScanError('摄像头启动超时，请使用相册上传图片或重试')
        }
      }, 8000)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', 'true')
        videoRef.current.setAttribute('autoplay', 'true')
        videoRef.current.setAttribute('muted', 'true')
        await videoRef.current.play()
        if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current)
        if (mountedRef.current) {
          setCameraReady(true)
          setScanError(null)
          setCameraTimeout(false)
          animFrameRef.current = requestAnimationFrame(processFrame)
        }
      }
    } catch (err) {
      console.error('Web camera error:', err)
      if (mountedRef.current) {
        setScanError(err.name === 'NotAllowedError' ? '摄像头权限被拒绝' : '无法访问摄像头')
        setCameraTimeout(true)
      }
    }
  }, [cameraReady, processFrame])

  // ----- 原生扫码层 -----
  const tryGoogleScan = async () => {
    // 方法 1: GmsBarcodeScanner.scan() — Google 扫码模块，有独立 UI
    const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning')
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    if (!available) {
      return null
    }
    const result = await BarcodeScanner.scan({
      formats: [BarcodeFormat.QrCode],
      autoZoom: true,
    })
    return result?.barcodes?.[0]?.rawValue || null
  }

  const tryEmbeddedScan = async () => {
    // 方法 2: CameraX + ML Kit startScan() — 嵌入 WebView 的预览
    const { BarcodeScanner, BarcodeFormat, LensFacing } = await import('@capacitor-mlkit/barcode-scanning')

    const eventResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        BarcodeScanner.removeAllListeners()
        BarcodeScanner.stopScan().catch(() => {})
        reject(new Error('startScan timeout'))
      }, 15000)

      BarcodeScanner.addListener('barcodesScanned', async (event) => {
        const barcode = event.barcodes?.[0]
        if (barcode?.rawValue) {
          clearTimeout(timeout)
          await BarcodeScanner.removeAllListeners().catch(() => {})
          await BarcodeScanner.stopScan().catch(() => {})
          resolve(barcode.rawValue)
        }
      }).catch(reject)

      BarcodeScanner.startScan({
        formats: [BarcodeFormat.QrCode],
        lensFacing: LensFacing.Back,
      }).catch(reject)
    })

    return eventResult
  }

  const startNativeScan = async () => {
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')

      // 1. 请求权限
      const perm = await BarcodeScanner.requestPermissions()
      if (perm.camera !== 'granted') {
        setScanError('摄像头权限被拒绝')
        setCameraTimeout(true)
        return
      }

      // 2. 先尝试 Google 扫码模块 (有独立原生 UI，最可靠)
      setInitMsg('正在启动扫码...')
      try {
        const rawValue = await tryGoogleScan()
        if (rawValue) {
          handleScanResult(rawValue, onScanSuccess, setScanError)
          return
        }
      } catch (e) {
        console.warn('Google scan failed, trying embedded:', e)
      }

      // 3. Google 模块不可用，尝试 CameraX 嵌入预览
      setInitMsg('正在启动相机...')
      const rawValue = await tryEmbeddedScan()
      if (rawValue) {
        handleScanResult(rawValue, onScanSuccess, setScanError)
      }
    } catch (err) {
      console.error('All native scan methods failed:', err)
      // 4. 全部失败，降级到 getUserMedia
      if (mountedRef.current) {
        setScanError(null)
        await startWebCamera()
      }
    }
  }

  const stopNativeScan = async () => {
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
      await BarcodeScanner.removeAllListeners().catch(() => {})
      await BarcodeScanner.stopScan().catch(() => {})
    } catch { /* ignore */ }
  }

  // ----- 启动 -----
  useEffect(() => {
    mountedRef.current = true
    if (isNative()) {
      startNativeScan()
    } else {
      startWebCamera()
    }
    return () => {
      mountedRef.current = false
      if (isNative()) {
        stopNativeScan()
      } else {
        stopCamera()
      }
    }
  }, [])

  const handleAlbum = () => { fileInputRef.current?.click() }

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
        const res = [1200, 800, 600]
        let code = null
        for (const d of res) {
          const s = Math.min(1, d / Math.max(img.width, img.height))
          canvas.width = Math.floor(img.width * s)
          canvas.height = Math.floor(img.height * s)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })
          if (code) break
        }
        if (code) handleScanResult(code.data, onScanSuccess, setScanError)
        else setScanError('未检测到二维码，请确保图片清晰')
        setScanning(false)
      }
      img.onerror = () => { setScanError('图片加载失败'); setScanning(false) }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed', inset: 0, background: '#000',
        zIndex: 10000, display: 'flex', flexDirection: 'column'
      }}>
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
          {/* 非原生端：实时摄像头预览 */}
          {!isNative() && (
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
                {initMsg}
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