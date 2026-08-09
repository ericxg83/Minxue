import { AlertCircle } from 'lucide-react'
import { motion } from 'motion/react'

export default function DeleteConfirmModal({ onCancel, onConfirm }) {
  return (
    <div className="absolute inset-0 z-[20000] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative card mx-5 w-full max-w-sm"
        style={{ padding: '24px' }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--danger-soft)' }}>
            <AlertCircle size={24} style={{ color: 'var(--danger)' }} />
          </div>
          <h3 style={{ fontSize: 'var(--fs-17)', fontWeight: 700, color: 'var(--text)', marginBottom: '6px' }}>确认删除</h3>
          <p style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
            删除后不可恢复，确定要删除吗？
          </p>
          <div className="flex gap-3 w-full">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl text-[14px] font-medium transition-colors active:scale-[0.98]"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-white transition-colors active:scale-[0.98]"
              style={{ background: 'var(--danger)' }}
            >
              删除
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
