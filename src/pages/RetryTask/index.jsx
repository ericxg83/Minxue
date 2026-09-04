import { useState, useRef, useEffect } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Camera, Image as ImageIcon, Loader2, Upload, ClipboardList, CheckCircle2, Clock } from 'lucide-react'
import { Toast } from 'antd-mobile'
import { apiRequest, getRetryTask } from '../../services/apiService'

// HEIC 预览格：浏览器解不开 HEIC 时 onError 切占位（不白屏）。
// HEIC 上传由后端 fixFileIfNeeded needsHeicTranscode 用 heic-decode 转 jpg。
function HeicPreviewCell({ p, onRemove }) {
  const [errored, setErrored] = useState(false)
  const showPlaceholder = errored || !p.url
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--bg-secondary)' }}>
      {showPlaceholder ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          <ImageIcon size={20} />
          {p.isHeic && <span style={{ fontSize: 'var(--fs-10)' }}>HEIC</span>}
        </div>
      ) : (
        <img
          src={p.url}
          alt={p.name}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      )}
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 'var(--fs-12)' }}
      >×</button>
    </div>
  )
}
import { taskService } from '../../services/taskService'
import { takePhotoFiles, pickPhotoFiles, isNativeCameraAvailable, describeCameraError } from '../../services/nativeCamera'
import dayjs from 'dayjs'

// 状态映射（spec：待批改 / 批改中 / 已完成）
const STATUS_META = {
  ungraded: { label: '待批改', color: 'var(--warning)', bg: 'var(--warning-soft)', icon: Clock },
  grading: { label: '批改中', color: 'var(--primary)', bg: 'var(--primary-soft)', icon: Loader2 },
  graded: { label: '已完成', color: 'var(--success)', bg: 'var(--success-soft)', icon: CheckCircle2 }
}

// PC 工作台地址。App 构建不打 workbench 入口（见 vite.config.js 的 isAppBuild），
// 此时必须由 VITE_WORKBENCH_URL 指向线上 Web 工作台，否则跳转会落到 404。
const REVIEW_WORKBENCH_BASE = import.meta.env.VITE_WORKBENCH_URL
  || (__WORKBENCH_BUNDLED__ ? '/workbench' : null)

/**
 * 错题重练任务入口页（二维码 = /retry-task/:id）
 *
 * 不做任何批改，只作为唯一任务入口：
 *   1. 展示任务信息（学生 / 名称 / 日期 / 题数 / 状态）
 *   2. 老师上传学生完成后的答卷照片（拍照 / 相册 / 多张）
 *   3. 上传后系统自动关联 student_id / paper_id，进入统一 AI 批改流程
 */
export default function RetryTask({ taskId, onBack }) {
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([]) // 已选未上传的本地文件预览
  const [pickerBusy, setPickerBusy] = useState(false) // 原生相机/相册打开中
  const cameraInputRef = useRef(null)
  const albumInputRef = useRef(null)
  const pendingRef = useRef(null)
  pendingRef.current = pendingFiles

  const loadTask = async () => {
    if (!taskId) return
    setLoading(true)
    setError(null)
    try {
      const data = await getRetryTask(taskId)
      setTask(data)
    } catch (e) {
      console.error('加载错题重练任务失败:', e)
      setError(e.message || '任务加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTask()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const status = task?.status && STATUS_META[task.status] ? task.status : 'ungraded'
  const meta = STATUS_META[status]
  const StatusIcon = meta.icon
  const questionCount = Array.isArray(task?.question_ids) ? task.question_ids.length : 0
  const isDone = status === 'graded'

  // HEIC 预览：Android WebView file.type 经常是空 → 退化靠扩展名判断。
  // 浏览器原 <img> 解不开 HEIC 会显示 broken image（onError 兜底），但不至于白屏。
  // 真 HEIC 上传给后端，fixFileIfNeeded needsHeicTranscode 走 heic-decode 转 jpg。
  const isHeic = (f) =>
    (f?.type || '').match(/^image\/(heic|heif)$/i) || /\.(heic|heif)$/i.test(f?.name || '')

  // 把 File 列表转为预览对象（保留 File 引用用于上传）
  const toPreviews = (files) =>
    Array.from(files).map((f) => ({
      file: f,
      url: URL.createObjectURL(f),
      isHeic: isHeic(f),
      name: f.name
    }))

  const handleSelectFiles = (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setPendingFiles((prev) => [...prev, ...toPreviews(files)])
    e.target.value = ''
  }

  // 拍照 / 相册：原生平台走系统相机与原生相册（WebView 的 <input capture> 会被
  // BridgeActivity 的文件选择器吞掉，点"拍照"只会打开相册），Web 端回退到 input。
  const runNativePicker = async (picker) => {
    if (pickerBusy) return
    setPickerBusy(true)
    try {
      const files = await picker()
      if (files && files.length > 0) {
        setPendingFiles((prev) => [...prev, ...toPreviews(files)])
      }
    } catch (e) {
      const msg = describeCameraError(e)
      if (msg) Toast.show({ icon: 'fail', content: msg })
    } finally {
      setPickerBusy(false)
    }
  }

  const handleCameraClick = () => {
    if (!isNativeCameraAvailable()) {
      cameraInputRef.current?.click()
      return
    }
    runNativePicker(takePhotoFiles)
  }

  const handleAlbumClick = () => {
    if (!isNativeCameraAvailable()) {
      albumInputRef.current?.click()
      return
    }
    runNativePicker(() => pickPhotoFiles(20))
  }

  const removePending = (idx) => {
    setPendingFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      if (prev[idx]?.url) URL.revokeObjectURL(prev[idx].url)
      return next
    })
  }

  const handleUpload = async () => {
    const files = pendingRef.current
    if (!files || files.length === 0) {
      Toast.show({ icon: 'fail', content: '请先选择答卷照片' })
      return
    }
    setUploading(true)
    try {
      // 自动关联：后端按 generatedExamId 取 student_id + 写入 task_type='wrong_retry'
      const res = await taskService.uploadRetryAnswer(taskId, files.map((p) => p.file))
      const created = (res.tasks || []).filter((t) => !t.error)
      if (created.length === 0) throw new Error(res?.report?.summary || '上传失败')

      // 关联批改任务并置 grading。
      // 走 apiRequest 拿超时与重试：这步失败会静默让任务永远停在"待批改"。
      const firstTaskId = created[0].id
      await apiRequest(`/retry-tasks/${taskId}/link`, {
        method: 'PATCH',
        body: JSON.stringify({ retryTaskId: firstTaskId })
      })

      // 清理本地预览
      files.forEach((p) => p.url && URL.revokeObjectURL(p.url))
      setPendingFiles([])
      Toast.show({ icon: 'success', content: '答卷已上传，开始批改' })
      // 重新拉取状态（批改中）
      await loadTask()
    } catch (e) {
      console.error('上传答卷失败:', e)
      Toast.show({ icon: 'fail', content: e.message || '上传失败，请重试' })
    } finally {
      setUploading(false)
    }
  }

  const goToWorkbench = () => {
    // 批改结果在「组卷历史」查看/改判（低置信度题回退人工判定）
    if (!REVIEW_WORKBENCH_BASE) {
      Toast.show({ icon: 'fail', content: '请在电脑端工作台查看批改结果' })
      return
    }
    const url = `${REVIEW_WORKBENCH_BASE}#/exam-history`
    window.location.href = url
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-white border-b" style={{ borderColor: 'var(--border-light)' }}>
        {onBack ? (
          <button onClick={onBack} style={{ fontSize: 'var(--fs-13)', color: 'var(--primary-hover)' }}>返回</button>
        ) : (
          <div className="w-10" />
        )}
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 600, color: 'var(--text)' }}>错题重练任务</h2>
        <div className="w-10" />
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 size={28} className="animate-spin" />
          <span style={{ fontSize: 'var(--fs-13)' }}>正在加载任务...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <span style={{ fontSize: 'var(--fs-14)', color: 'var(--danger)' }}>{error}</span>
          <button onClick={loadTask} className="px-5 py-2 rounded-lg text-[13px]" style={{ background: 'var(--primary-hover)', color: '#fff' }}>重试</button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-4 py-5">
          {/* 任务信息卡 */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2" style={{ color: 'var(--primary-hover)' }}>
                <ClipboardList size={20} />
                <span style={{ fontSize: 'var(--fs-15)', fontWeight: 600 }}>错题重练</span>
              </div>
              <span
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium"
                style={{ background: meta.bg, color: meta.color }}
              >
                <StatusIcon size={13} className={status === 'grading' ? 'animate-spin' : ''} />
                {meta.label}
              </span>
            </div>

            <div className="space-y-3">
              <InfoRow label="学生姓名" value={task?.student_name || '—'} />
              <InfoRow label="练习名称" value={task?.name || '错题重练'} />
              <InfoRow label="生成日期" value={task?.created_at ? dayjs(task.created_at).format('YYYY-MM-DD HH:mm') : '—'} />
              <InfoRow label="题目数量" value={`${questionCount} 题`} />
            </div>
          </motion.div>

          {/* 上传区（仅待批改态可上传） */}
          {!isDone && (
            <div className="mt-4 bg-white rounded-2xl p-5 shadow-sm">
              <div className="text-[14px] font-medium mb-3" style={{ color: 'var(--text)' }}>上传答案照片</div>

              {/* 已选预览 */}
              {pendingFiles.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {pendingFiles.map((p, i) => (
                    <HeicPreviewCell key={i} p={p} onRemove={() => removePending(i)} />
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleCameraClick}
                  disabled={pickerBusy}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
                  style={{ background: 'var(--primary-mist)', color: 'var(--primary-hover)' }}
                >
                  {pickerBusy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} 拍照
                </button>
                <button
                  onClick={handleAlbumClick}
                  disabled={pickerBusy}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                >
                  <ImageIcon size={16} /> 相册
                </button>
              </div>

              <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple style={{ display: 'none' }} onChange={handleSelectFiles} />
              <input ref={albumInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple style={{ display: 'none' }} onChange={handleSelectFiles} />

              <button
                onClick={handleUpload}
                disabled={uploading || pendingFiles.length === 0}
                className="w-full mt-3 py-3 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2"
                style={{
                  background: uploading || pendingFiles.length === 0 ? 'var(--bg-secondary)' : 'var(--primary-hover)',
                  color: '#fff'
                }}
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploading ? '上传并批改中...' : '上传并批改'}
              </button>
            </div>
          )}

          {/* 已完成：进入组卷历史查看批改结果 */}
          {isDone && (
            <div className="mt-4 bg-white rounded-2xl p-5 shadow-sm">
              <div className="text-[14px]" style={{ color: 'var(--success)' }}>
                本次错题重练已完成批改。
              </div>
              <button
                onClick={goToWorkbench}
                className="w-full mt-3 py-3 rounded-xl text-[14px] font-semibold"
                style={{ background: 'var(--primary-hover)', color: '#fff' }}
              >
                查看批改结果
              </button>
            </div>
          )}

          {/* 批改中：提示等待 */}
          {status === 'grading' && (
            <div className="mt-4 bg-white rounded-2xl p-5 shadow-sm flex items-center gap-3">
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary-hover)' }} />
              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)' }}>
                AI 正在批改，完成后可在「组卷历史」查看结果。
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 'var(--fs-14)', fontWeight: 500, color: 'var(--text)', textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}
