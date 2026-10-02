import { BookOpen, FileText } from 'lucide-react'
import { motion } from 'motion/react'

/**
 * 首页「新建批改任务」弹层。
 *
 * 第 46 轮（2026-10-02）从三卡减为两卡：原来的「错题重练」卡走的是
 * `openStaging('wrong_retry')` → 最末尾的通用上传分支（与「普通试卷」同一条路），
 * 它本身并不做任何重练专属处理；而重练卷的定位靠卷面二维码，
 * 从**任何**一条上传支路进来都会被 `handleFileSelect` 里的 QR 检测拦下归位（useUploadFlow.js:462-466）。
 * 负责人实际习惯也是在「组卷历史」里选卷上传答卷（stagingType='retry_bound'），
 * 所以这张卡只会多一步、多一个误选，删卡不删能力。
 */
export default function UploadOptionsModal({
  onClose,
  onStartHomework,
  onStartRegular
}) {
  return (
    <div className="absolute inset-0 z-[25000] flex items-end justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative bg-white rounded-t-3xl w-full max-w-lg mx-auto shadow-xl"
        style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-8 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="px-6 pt-2 pb-4">
          <h3 className="text-center text-[17px] font-semibold text-[var(--text)] mb-6">新建批改任务</h3>

          {/* 卡片1: 日常作业 */}
          <button
            onClick={onStartHomework}
            className="w-full flex items-center gap-4 p-4 rounded-2xl transition-all active:scale-[0.98] tap-scale mb-3"
            style={{ background: 'var(--accent-soft)' }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--accent), var(--warning))' }}>
              <BookOpen size={28} className="text-white" />
            </div>
            <div className="text-left">
              <span className="block text-[15px] font-semibold" style={{ color: 'var(--text)' }}>日常作业</span>
              <span className="block text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>拍照上传，选择练习册或AI批改</span>
            </div>
          </button>

          {/* 卡片2: 普通试卷（最后一张，不再加底部外边距）*/}
          <button
            onClick={onStartRegular}
            className="w-full flex items-center gap-4 p-4 rounded-2xl transition-all active:scale-[0.98] tap-scale"
            style={{ background: 'var(--primary-soft)' }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0" style={{ background: 'var(--primary)' }}>
              <FileText size={28} className="text-white" />
            </div>
            <div className="text-left">
              <span className="block text-[15px] font-semibold" style={{ color: 'var(--text)' }}>普通试卷</span>
              <span className="block text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>考试卷/临时卷，AI智能批改</span>
            </div>
          </button>

        </div>
        <div className="px-6 pb-2">
          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-2xl text-[15px] font-medium transition-colors active:scale-[0.98]"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
        </div>
      </motion.div>
    </div>
  )
}
