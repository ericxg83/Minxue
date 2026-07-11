import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Loader2, Image as ImageIcon } from 'lucide-react'
import jsQR from 'jsqr'
import { getGeneratedExamById } from '../../services/apiService'

const isNative = () => {
  try {
    return !!(window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

// 灰度化 + 对比度增强，用于打印件二维码在暗光/模糊场景下的二次尝试
const enhanceContrast = (imageData) => {
  const { data, width, height } = imageData
  const out = new Uint8ClampedArray(data.length)
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    sum += g
  }
  const avg = sum / (data.length / 4)
  const factor = 1.6
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    let v = avg + (g - avg) * factor
    v = v < 0 ? 0 : v > 255 ? 255 : v
    out[i] = out[i + 1] = out[i + 2] = v
    out[i + 3] = 255
  }
  return { data: out, width, height }
}

// 扫码成功后处理结果（异步：短格式需要从服务端拉取组卷详情）
const handleScanResult = async (rawValue, onScanSuccess, setScanError, setLoading) => {
  const raw = String(rawValue || '').trim()

  // 错题重练任务入口 URL：https://{domain}/retry-task/<id>
  // 扫码后只定位 task，进入「任务入口页」，不再直接进批改页
  const urlM = raw.match(/\/retry-task\/([0-9a-fA-F-]{36})(?:[/?#]|$)/)
  if (urlM) {
    onScanSuccess({ retryTaskId: urlM[1].toLowerCase() })
    return true
  }

  // 新短格式：MXG:<组卷ID>（二维码只含ID，密度低易扫描）
  const m = raw.match(/^MXG:([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/i)
  if (m) {
    const examId = m[1].toLowerCase()
    try {
      setLoading?.(true)
      const exam = await getGeneratedExamById(examId)
      if (!exam) throw new Error('exam not found')
      onScanSuccess({
        paperId: '',
        studentId: exam.student_id,
        studentName: exam.student_name || '',
        questionIds: exam.question_ids || [],
        generatedExamId: exam.id,
        timestamp: Date.now()
      })
      return true
    } catch (e) {
      console.error('获取组卷详情失败:', e)
      setScanError('获取试卷信息失败，请检查网络后重试')
      return false
    } finally {
      setLoading?.(false)
    }
  }

  // 旧 JSON 格式（兼容已打印的旧试卷）
  try {
    const data = JSON.parse(raw)
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
  const [usingNative, setUsingNative] = useState(false) // 是否正在使用 ML Kit 原生扫码
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animFrameRef = useRef(null)
  const fileInputRef = useRef(null)
  const cameraTimeoutRef = useRef(null)
  const scanLockRef = useRef(false)
  const mountedRef = useRef(true)
  const onScanSuccessRef = useRef(onScanSuccess)
  onScanSuccessRef.current = onScanSuccess

  const restoreWebView = useCallback(() => {
    document.documentElement.style.background = ''
    document.body.style.background = ''
    document.body.style.backgroundColor = ''
  }, [])

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
    setUsingNative(false)
  }, [])

  // ===== getUserMedia + jsQR（Web / 降级兜底） =====
  const processFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      animFrameRef.current = requestAnimationFrame(processFrame)
      return
    }

    const scanFullWidth = video.videoWidth
    const scanFullHeight = video.videoHeight
    const maxScanWidth = 1280
    const scale = Math.min(1, maxScanWidth / scanFullWidth)
    const scanWidth = Math.floor(scanFullWidth * scale)
    const scanHeight = Math.floor(scanFullHeight * scale)

    canvas.width = scanWidth
    canvas.height = scanHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(video, 0, 0, scanWidth, scanHeight)

    const imageData = ctx.getImageData(0, 0, scanWidth, scanHeight)
    let code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })

    if (!code) {
      const enhanced = enhanceContrast(imageData)
      code = jsQR(enhanced.data, enhanced.width, enhanced.height, { inversionAttempts: 'attemptBoth' })
    }

    if (code && !scanLockRef.current) {
      scanLockRef.current = true
      handleScanResult(code.data, onScanSuccessRef.current, setScanError, setScanning).then(ok => {
        if (ok) { stopCamera(); return }
        scanLockRef.current = false
      })
    }
    if (mountedRef.current && streamRef.current) {
      animFrameRef.current = requestAnimationFrame(processFrame)
    }
  }, [stopCamera])

  const startWebCamera = useCallback(async () => {
    try {
      setInitMsg('正在启动摄像头...')
      cameraTimeoutRef.current = setTimeout(() => {
        if (!cameraReady && mountedRef.current) {
          setCameraTimeout(true)
          setScanError('摄像头启动超时，请使用相册上传图片或重试')
        }
      }, 12000)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
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
      console.error('Camera error:', err)
      if (mountedRef.current) {
        setScanError(err.name === 'NotAllowedError' ? '摄像头权限被拒绝' : '无法访问摄像头')
        setCameraTimeout(true)
      }
    }
  }, [cameraReady, processFrame])

  // ===== 原生 ML Kit 扫码（不依赖 GMS，大陆可用） =====
  const stopNativeScan = useCallback(async () => {
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
      await BarcodeScanner.removeAllListeners().catch(() => {})
      await BarcodeScanner.stopScan().catch(() => {})
    } catch { /* ignore */ }
    restoreWebView()
    setUsingNative(false)
  }, [restoreWebView])

  const startNativeScan = useCallback(async () => {
    try {
      setInitMsg('正在启动原生扫码...')
      cameraTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current && !cameraReady) {
          console.warn('Native scan startup timeout, falling back to jsQR')
          restoreWebView()
          setUsingNative(false)
          startWebCamera()
        }
      }, 15000)

      const { BarcodeScanner, BarcodeFormat, LensFacing } = await import('@capacitor-mlkit/barcode-scanning')

      // 请求相机权限
      const perm = await BarcodeScanner.requestPermissions()
      if (perm.camera !== 'granted') {
        throw new Error('camera permission denied')
      }

      // 设定原生模式（Native overlay 处理扫码框和关闭按钮）
      setUsingNative(true)

      if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current)
      if (!mountedRef.current) { setUsingNative(false); return }

      setCameraReady(true)
      setScanError(null)
      setCameraTimeout(false)

      // 注册扫码监听 + 启动 CameraX
      const rawValue = await new Promise((resolve, reject) => {
        const scanTimeout = setTimeout(() => {
          reject(new Error('native scan timeout'))
        }, 60000)

        BarcodeScanner.addListener('barcodesScanned', (event) => {
          const barcode = event.barcodes?.[0]
          if (barcode?.rawValue) {
            clearTimeout(scanTimeout)
            resolve(barcode.rawValue)
          }
        })

        BarcodeScanner.startScan({
          formats: [BarcodeFormat.QrCode],
          lensFacing: LensFacing.Back,
        }).catch(reject)
      })

      // 扫码成功
      if (mountedRef.current) {
        await stopNativeScan()
        const ok = await handleScanResult(rawValue, onScanSuccessRef.current, setScanError, setScanning)
        if (!ok && mountedRef.current) {
          // 解析/拉取失败：显示错误并提供重试入口
          setCameraTimeout(true)
        }
      }
    } catch (err) {
      console.warn('Native scan failed, falling back to jsQR:', err)
      if (mountedRef.current) {
        restoreWebView()
        setUsingNative(false)
        await startWebCamera()
      }
    }
  }, [cameraReady, startWebCamera, stopNativeScan, restoreWebView])

  // 监听原生层"关闭"按钮事件
  useEffect(() => {
    const handler = () => {
      if (mountedRef.current) {
        stopNativeScan()
        onClose()
      }
    }
    document.addEventListener('scan-cancelled', handler)
    return () => document.removeEventListener('scan-cancelled', handler)
  }, [onClose, stopNativeScan])

  // ----- 组件挂载 -----
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
        const res = [1600, 1200, 1000, 800, 600]
        let code = null
        for (const d of res) {
          const s = Math.min(1, d / Math.max(img.width, img.height))
          canvas.width = Math.floor(img.width * s)
          canvas.height = Math.floor(img.height * s)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
          if (code) break
          const enhanced = enhanceContrast(imageData)
          code = jsQR(enhanced.data, enhanced.width, enhanced.height, { inversionAttempts: 'attemptBoth' })
          if (code) break
        }
        if (code) {
          handleScanResult(code.data, onScanSuccess, setScanError, setScanning).then(ok => {
            if (!ok) setScanning(false)
          })
        } else {
          setScanError('未检测到二维码，请确保图片清晰')
          setScanning(false)
        }
      }
      img.onerror = () => { setScanError('图片加载失败'); setScanning(false) }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  const isNativeMode = usingNative && !cameraTimeout

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed', inset: 0,
        background: isNativeMode ? 'transparent' : '#000',
        zIndex: 10000, display: 'flex', flexDirection: 'column'
      }}>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* 原生模式：native overlay 已经处理扫码框和关闭按钮，React 只保留加载/错误状态 */}
        {!isNativeMode && (<>
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
            <video ref={videoRef} style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
            }} />

            {/* 加载中（仅在 web 模式显示） */}
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

            {/* 扫码框 */}
            {!cameraTimeout && (
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
        </>)}

        {/* 超时/错误 — 任何模式下都显示 */}
        {cameraTimeout && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: '16px', zIndex: 9999, background: 'rgba(0,0,0,0.85)', padding: '20px'
          }}>
            <div style={{ color: '#fff', fontSize: '15px', textAlign: 'center', lineHeight: '1.6' }}>
              {scanError || '无法启动相机'}
            </div>
            <button onClick={handleAlbum} style={{
              padding: '12px 32px', background: '#2563EB', color: '#fff', borderRadius: '8px',
              fontSize: '15px', fontWeight:600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <ImageIcon size={18} />
              打开相册
            </button>
            <button onClick={() => { setCameraTimeout(false); setScanError(null); if (isNative()) startNativeScan(); else startWebCamera(); }} style={{
              padding: '12px 32px', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: '8px',
              fontSize: '15px', fontWeight: 500, border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              重试
            </button>
          </div>
        )}

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

        {/* 错误提示（非超时） */}
        {scanError && !cameraTimeout && (
          <div style={{
            color: '#EF4444', fontSize: '14px', marginTop: '20px', textAlign: 'center',
            padding: '0 20px', zIndex: 5, textShadow: '0 1px 4px rgba(0,0,0,0.5)'
          }}>
            {scanError}
          </div>
        )}
      </div>
    </AnimatePresence>
  )
}