import { FileText, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'

export default function ExamChoiceModal({
  examChoiceFiles,
  availableExamResources,
  onBackdrop,
  onUploadWithResource,
  onUploadFresh
}) {
  return (
    <div className="absolute inset-0 z-[25000] flex items-end justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onBackdrop}
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
          <h3 className="text-center text-[17px] font-semibold text-[var(--text)] mb-1">检测到已有答案库</h3>
          <p className="text-center text-[13px] mb-6" style={{ color: 'var(--text-secondary)' }}>
            共 {examChoiceFiles.length} 张图片，选择批改方式
          </p>

          <div className="max-h-[40vh] overflow-y-auto mb-3 -mx-2">
            {availableExamResources.map(r => (
              <button
                key={r.id}
                onClick={() => onUploadWithResource(r.id, r.name)}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all active:scale-[0.98] text-left mb-1"
                style={{ background: 'rgba(217, 119, 6, 0.06)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(217, 119, 6, 0.1)' }}>
                  <FileText size={20} style={{ color: 'var(--warning)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-medium truncate" style={{ color: 'var(--text)' }}>
                      {r.name}
                    </span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(217, 119, 6, 0.1)', color: 'var(--warning)' }}>
                      {r.answer_status === 'official_verified' ? '官方审核' : '已审核'}
                    </span>
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {r.grade || ''} {r.subject || ''} · {r.answer_count || 0} 题
                  </div>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={onUploadFresh}
            className="w-full flex items-center gap-4 p-4 rounded-2xl transition-all active:scale-[0.98] tap-scale"
            style={{ background: 'var(--primary-soft)' }}
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0" style={{ background: 'var(--primary)' }}>
              <Sparkles size={28} className="text-white" />
            </div>
            <div className="text-left">
              <span className="block text-[15px] font-semibold" style={{ color: 'var(--text)' }}>全新批改</span>
              <span className="block text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>不使用已有答案，AI 重新智能批改</span>
            </div>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
