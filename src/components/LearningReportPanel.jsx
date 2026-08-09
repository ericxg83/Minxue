import { X } from 'lucide-react'
import { Suspense } from 'react'

const LazyFallback = () => (
  <div className="flex items-center justify-center p-8">
    <X size={24} style={{ opacity: 0 }} />
  </div>
)

export default function LearningReportPanel({ onClose, WeeklyReport }) {
  return (
    <div className="absolute inset-0 z-[100] bg-white overflow-y-auto animate-fade-in" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: 'var(--bg-secondary)' }}>
        <h3 style={{ fontSize: 'var(--fs-17)', fontWeight: 600, color: 'var(--text)' }}>学习报告</h3>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--bg-hover)' }}
          aria-label="关闭学习报告"
        >
          <X size={14} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>
      <Suspense fallback={<LazyFallback />}>
        <WeeklyReport />
      </Suspense>
    </div>
  )
}
