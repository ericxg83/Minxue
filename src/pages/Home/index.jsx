import { useState, useRef, useEffect } from 'react'
import { ActionSheet } from 'antd-mobile'
import { Camera, ChevronRight, Plus, Sparkles, User, ScanLine, BookOpen, X, Image, Upload, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useStudentStore } from '../../store'
import StudentSwitcher from '../../components/StudentSwitcher'
import UploadTypeSelector from '../../components/UploadTypeSelector'

export default function Home({ onNavigate }) {
  const { currentStudent, setCurrentStudent } = useStudentStore()
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [showUploadTypeSelector, setShowUploadTypeSelector] = useState(false)

  // ── 拍照+相册暂存区 ──
  const [staging, setStaging] = useState(false)         // 是否在暂存区模式
  const [stagingType, setStagingType] = useState(null)  // 'regular' | 'workbook' | 'wrong_retry'
  const [stagingData, setStagingData] = useState(null)  // { worksheetId, subject } 等
  const [pendingFiles, setPendingFiles] = useState([])  // [{ file, url, name }]
  const [uploading, setUploading] = useState(false)
  const cameraInputRef = useRef(null)
  const albumInputRef = useRef(null)

  // 避免 pendingFiles 在闭包中过期
  const pendingRef = useRef([])
  pendingRef.current = pendingFiles

  const toPreviews = (files) =>
    Array.from(files).map((f) => ({
      file: f,
      url: f.type?.startsWith('image/') ? URL.createObjectURL(f) : null,
      name: f.name
    }))

  const handleSelectFiles = (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setPendingFiles((prev) => [...prev, ...toPreviews(files)])
    e.target.value = ''
  }

  const removePending = (idx) => {
    setPendingFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx)
      if (prev[idx]?.url) URL.revokeObjectURL(prev[idx].url)
      return next
    })
  }

  const handleWorkbookUpload = (uploadData) => {
    window.dispatchEvent(new CustomEvent('set-workbook-flow', {
      detail: {
        flow: 'workbook',
        worksheetId: uploadData.worksheetId,
        subject: uploadData.subject
      }
    }))
    setTimeout(() => {
      const input = document.getElementById('file-input')
      if (input) {
        input.click()
      }
    }, 100)
  }

  const openUploader = (capture) => {
    const input = document.getElementById('file-input')
    if (!input) return
    if (capture) {
      input.setAttribute('capture', 'environment')
    } else {
      input.removeAttribute('capture')
    }
    input.click()
  }

  const showUploadOptions = () => {
    setShowUploadTypeSelector(true)
  }

  const handleUploadTypeSelect = (uploadData) => {
    console.log('Selected upload type:', uploadData)
    setShowUploadTypeSelector(false)

    // 进入暂存区模式，等待用户拍照/选图后统一下载
    setStagingType(uploadData.type)
    setStagingData(uploadData)
    setStaging(true)
    setPendingFiles([])
  }

  const handleRegularUpload = () => {
    window.dispatchEvent(new CustomEvent('set-workbook-flow', {
      detail: { flow: 'regular' }
    }))
    const input = document.getElementById('file-input')
    if (!input) return
    input.setAttribute('capture', 'environment')
    input.click()
  }

  const handleWrongRetryUpload = () => {
    window.dispatchEvent(new CustomEvent('set-workbook-flow', {
      detail: { flow: 'regular' }
    }))
    const input = document.getElementById('file-input')
    if (!input) return
    input.setAttribute('capture', 'environment')
    input.click()
  }

  // 提交暂存区所有文件
  const handleSubmitStaging = async () => {
    const files = pendingRef.current
    if (files.length === 0) return
    setUploading(true)

    try {
      // 先通知 App.jsx 当前上传类型
      if (stagingType === 'workbook') {
        window.dispatchEvent(new CustomEvent('set-workbook-flow', {
          detail: {
            flow: 'workbook',
            worksheetId: stagingData?.worksheetId,
            subject: stagingData?.subject
          }
        }))
      } else {
        window.dispatchEvent(new CustomEvent('set-workbook-flow', {
          detail: { flow: 'regular' }
        }))
      }

      // 通过自定义事件将文件传给 App.jsx 的 handleFileSelect
      // 使用 DataTransfer 构造 FileList 注入共享 input
      const dt = new DataTransfer()
      files.forEach((p) => dt.items.add(p.file))
      const input = document.getElementById('file-input')
      if (input) {
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    } catch (err) {
      console.error('暂存区提交失败:', err)
    } finally {
      setUploading(false)
    }
  }

  // 退出暂存区时释放对象 URL
  useEffect(() => {
    if (!staging) {
      pendingFiles.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url) })
      setPendingFiles([])
    }
  }, [staging])

  return (
    <div className="px-5 pt-5 pb-28">
      {/* Header */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              敏学错题助手
            </h1>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mt-1" style={{ color: 'var(--primary)' }}>
              AI Study Assistant
            </p>
          </div>
          <button
            onClick={() => onNavigate && onNavigate('students')}
            className="h-9 px-4 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 active:scale-95 transition-all"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
          >
            <Plus size={14} strokeWidth={3} />
            新增
          </button>
        </div>

        {/* Student Selector */}
        <button
          onClick={() => setShowStudentSwitcher(true)}
          className="w-full rounded-2xl p-4 flex items-center justify-between active:scale-[0.99] transition-all card"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden shrink-0" style={{ background: 'var(--primary-soft)' }}>
              {currentStudent?.avatar ? (
                <img src={currentStudent.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <User size={20} style={{ color: 'var(--primary)' }} />
              )}
            </div>
            <div className="text-left min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>当前选择</p>
              <p className="text-[15px] font-bold truncate" style={{ color: 'var(--text)' }}>{currentStudent?.name || '请选择学生'}</p>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
        </button>
      </section>

      {/* Hero Upload Card — 暂存区模式显示不同内容 */}
      {staging ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full rounded-3xl p-5 card"
          style={{ minHeight: '320px' }}
        >
          {/* 隐藏的拍照/相册 input */}
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={handleSelectFiles} />
          <input ref={albumInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleSelectFiles} />

          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>
              {stagingType === 'workbook' ? '练习册答案' : stagingType === 'wrong_retry' ? '错题重练' : '拍照上传'}
            </h3>
            <button
              onClick={() => setStaging(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90"
              style={{ background: 'var(--bg-mist)' }}
            >
              <X size={14} style={{ color: 'var(--text-tertiary)' }} />
            </button>
          </div>

          {/* 拍照 + 相册按钮 */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
              style={{ background: 'var(--primary)', color: '#fff' }}
            >
              <Camera size={16} />
              拍照
            </button>
            <button
              onClick={() => albumInputRef.current?.click()}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
              style={{ background: 'var(--bg-mist)', color: 'var(--text)' }}
            >
              <Image size={16} />
              相册
            </button>
          </div>

          {/* 预览网格 */}
          {pendingFiles.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {pendingFiles.map((p, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '1 / 1', background: '#F3F4F6' }}>
                  {p.url ? (
                    <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ color: '#9CA3AF' }}>
                      <Image size={20} />
                    </div>
                  )}
                  <button
                    onClick={() => removePending(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '12px' }}
                  >x</button>
                </div>
              ))}
            </div>
          )}

          {pendingFiles.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8" style={{ color: 'var(--text-tertiary)' }}>
              <Image size={32} className="mb-2" />
              <p className="text-[13px]">点击上方按钮拍摄或选择照片</p>
              <p className="text-[11px] mt-1">支持连拍和相册多选</p>
            </div>
          )}

          {/* 提交按钮 */}
          {pendingFiles.length > 0 && (
            <button
              onClick={handleSubmitStaging}
              disabled={uploading || !currentStudent}
              className="w-full py-3 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{
                background: uploading || !currentStudent ? '#CBD5E1' : '#2563EB',
                color: '#fff'
              }}
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? '上传中...' : `上传 ${pendingFiles.length} 张图片${pendingFiles.length > 1 ? '（合并为一个任务）' : ''}`}
            </button>
          )}
        </motion.div>
      ) : (
        /* Hero Upload Card — 正常模式 */
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={showUploadOptions}
          className="w-full relative overflow-hidden rounded-3xl p-8 text-white shadow-xl flex flex-col items-center justify-center"
          style={{
            minHeight: '320px',
            background: 'linear-gradient(145deg, #2563EB 0%, #3B82F6 40%, #60A5FA 100%)',
            boxShadow: 'var(--shadow-primary)',
          }}
        >
          {/* Decorative blobs */}
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="absolute -bottom-12 -left-12 w-36 h-36 rounded-full" style={{ background: 'rgba(96,165,250,0.2)' }} />
          <div className="absolute top-1/2 right-8 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />

          <div className="relative z-10 flex flex-col items-center">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5 backdrop-blur-md border border-white/20 shadow-inner" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <Camera size={36} strokeWidth={2} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight mb-1.5">拍照上传错题</h2>
            <p className="text-sm font-medium tracking-wide" style={{ color: 'rgba(255,255,255,0.7)' }}>Qwen-VL 智能识别题目</p>
            <div className="mt-6 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-semibold tracking-widest uppercase" style={{ background: 'rgba(251,146,60,0.25)' }}>
              <Sparkles size={12} fill="white" className="shrink-0" />
              <span>AI 智能识别已就绪</span>
            </div>
          </div>
        </motion.button>
      )}

      {/* Upload Type Selector Modal */}
      {showUploadTypeSelector && (
        <UploadTypeSelector
          visible={showUploadTypeSelector}
          onClose={() => setShowUploadTypeSelector(false)}
          onUpload={handleUploadTypeSelect}
        />
      )}

      {/* Quick Actions Section */}
      <section className="mt-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate && onNavigate('wrongbook')}
            className="flex-1 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-all card"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--info-soft)' }}>
              <BookOpen size={18} style={{ color: 'var(--info)' }} />
            </div>
            <div className="text-left">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>错题本</p>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>复习与管理</p>
            </div>
          </button>
          <button
            onClick={() => onNavigate && onNavigate('exam')}
            className="flex-1 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] transition-all card"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--success-soft)' }}>
              <ScanLine size={18} style={{ color: 'var(--success)' }} />
            </div>
            <div className="text-left">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>组卷记录</p>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>查看已组试卷</p>
            </div>
          </button>
        </div>
      </section>

      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        onSelect={(student) => {
          setCurrentStudent(student)
          setShowStudentSwitcher(false)
        }}
      />
    </div>
  )
}