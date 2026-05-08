import { useState } from 'react'
import { ActionSheet } from 'antd-mobile'
import { Camera, ChevronRight, Plus, Sparkles, User } from 'lucide-react'
import { motion } from 'motion/react'
import { useStudentStore } from '../../store'
import StudentSwitcher from '../../components/StudentSwitcher'

export default function Home({ onNavigate }) {
  const { currentStudent, setCurrentStudent } = useStudentStore()
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)

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
    ActionSheet.show({
      actions: [
        { key: 'camera', text: '鎷嶇収涓婁紶', description: '鎷嶆憚璇曞嵎鎴栦綔涓?' },
        { key: 'album', text: '浠庣浉鍐岄€夋嫨', description: '閫夋嫨宸叉湁鐓х墖' },
      ],
      onAction: (action) => openUploader(action.key === 'camera')
    })
  }

  return (
    <div className="px-5 pt-5 pb-28">
      <section className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-[22px] font-black tracking-tight text-slate-950">鏁忓閿欓鍔╂墜</h1>
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-500 mt-0.5">AI Study Assistant</p>
          </div>
          <button
            onClick={() => onNavigate && onNavigate('students')}
            className="h-9 px-3 rounded-full bg-white text-blue-600 text-[12px] font-black shadow-sm border border-blue-50 flex items-center gap-1 active:scale-95 transition-all"
          >
            <Plus size={14} strokeWidth={3} />
            鏂板
          </button>
        </div>

        <button
          onClick={() => setShowStudentSwitcher(true)}
          className="w-full bg-white rounded-2xl p-4 flex items-center justify-between shadow-sm border border-white active:scale-[0.99] transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 flex items-center justify-center overflow-hidden shrink-0">
              {currentStudent?.avatar ? (
                <img src={currentStudent.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <User size={20} className="text-blue-500" />
              )}
            </div>
            <div className="text-left min-w-0">
              <p className="text-[11px] font-bold text-gray-400">褰撳墠閫夋嫨</p>
              <p className="text-[15px] font-black text-gray-900 truncate">{currentStudent?.name || '璇烽€夋嫨瀛︾敓'}</p>
            </div>
          </div>
          <ChevronRight size={18} className="text-gray-300 shrink-0" />
        </button>
      </section>

      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={showUploadOptions}
        className="w-full relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-blue-600 to-indigo-700 p-8 min-h-[320px] text-white shadow-xl shadow-blue-200 flex flex-col items-center justify-center"
      >
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
        <div className="absolute bottom-0 left-0 w-28 h-28 bg-cyan-300/10 rounded-full blur-2xl translate-y-10 -translate-x-8" />
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-[2rem] flex items-center justify-center mb-5 border border-white/30 shadow-inner">
            <Camera size={38} strokeWidth={2.5} />
          </div>
          <h2 className="text-2xl font-black tracking-tight mb-2">鎷嶇収涓婁紶閿欓</h2>
          <p className="text-white/65 text-[13px] font-medium tracking-wide">Qwen-VL 鏅鸿兘璇嗗埆棰樼洰</p>
          <div className="mt-7 flex items-center gap-1.5 bg-white/15 px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase">
            <Sparkles size={12} fill="white" className="shrink-0" />
            <span>AI 鏅鸿兘璇嗗埆宸插氨缁?/</span>
          </div>
        </div>
      </motion.button>

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
