import { useState, useRef, useEffect } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Camera, Image as ImageIcon, Loader2, Upload, ClipboardList, CheckCircle2, Clock } from 'lucide-react'
import { Toast } from 'antd-mobile'
import { getRetryTask } from '../../services/apiService'
import { taskService } from '../../services/taskService'
import { getPreviewUrl } from '../../utils/heicPreview'
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

  // 把 File 列表转为预览对象（保留 File 引用用于上传）
  // HEIC 走 heicPreview.getPreviewUrl 异步转 jpg 给 <img> 显示。
  const toPreviews = async (files) =>
    await Promise.all(
      Array.from(files).map(async (f) => ({
        file: f,
        url: await getPreviewUrl(f),
        name: f.name
      }))
    )

  const handleSelectFiles = async (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const previews = await toPreviews(files)
    setPendingFiles((prev) => [...prev, ...previews])
    e.target.value = ''
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

      // 关联批改任务并置 grading
      const firstTaskId = created[0].id
      await fetch(`${import.meta.env.VITE_API_URL || '/api'}/retry-tasks/${taskId}/link`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
                    <div key={i} className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--bg-secondary)' }}>
                      {p.url ? (
                        <img src={p.url} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
                          <ImageIcon size={20} />
                        </div>
                      )}
                      <button
                        onClick={() => removePending(i)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 'var(--fs-12)' }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--primary-mist)', color: 'var(--primary-hover)' }}
                >
                  <Camera size={16} /> 拍照
                </button>
                <button
                  onClick={() => albumInputRef.current?.click()}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5"
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
