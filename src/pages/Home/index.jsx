import { useState } from 'react'
import { ActionSheet } from 'antd-mobile'
import { Camera, ChevronRight, Plus, Sparkles, User, ScanLine, BookOpen } from 'lucide-react'
import { motion } from 'motion/react'
import { useStudentStore } from '../../store'
import StudentSwitcher from '../../components/StudentSwitcher'
import UploadTypeSelector from '../../components/UploadTypeSelector'

export default function Home({ onNavigate }) {
  const { currentStudent, setCurrentStudent } = useStudentStore()
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [showUploadTypeSelector, setShowUploadTypeSelector] = useState(false)

  const handleWorkbookUpload = (uploadData) => {
    // Set global state for workbook upload
    window.dispatchEvent(new CustomEvent('set-workbook-flow', {
      detail: {
        flow: 'workbook',
        worksheetId: uploadData.worksheetId,
        subject: uploadData.subject
      }
    }))

    // Trigger file input click
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

    // Continue with the selected upload type
    if (uploadData.type === 'workbook') {
      handleWorkbookUpload(uploadData)
    } else if (uploadData.type === 'regular') {
      handleRegularUpload()
    } else if (uploadData.type === 'wrong_retry') {
      handleWrongRetryUpload()
    }
  }

  const handleRegularUpload = () => {
    window.dispatchEvent(new CustomEvent('set-workbook-flow', {
      detail: { flow: 'regular' }
    }))
    // Use existing regular upload flow
    const input = document.getElementById('file-input')
    if (!input) return
    input.setAttribute('capture', 'environment')
    input.click()
  }

  const handleWrongRetryUpload = () => {
    // 拍照上传：照片中的二维码由 handleFileSelect 自动识别并定位对应重练卷
    window.dispatchEvent(new CustomEvent('set-workbook-flow', {
      detail: { flow: 'regular' }
    }))
    const input = document.getElementById('file-input')
    if (!input) return
    input.setAttribute('capture', 'environment')
    input.click()
  }

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

      {/* Hero Upload Card — Claude style */}
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
