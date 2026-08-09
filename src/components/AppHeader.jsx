import { User, ChevronDown, BarChart3, Bell } from 'lucide-react'

export default function AppHeader({
  currentStudent,
  isInitializing,
  onOpenStudentSwitcher,
  onOpenLearningReport,
  onOpenNotifications
}) {
  return (
    <header className="sticky top-0 z-50 glass border-b" style={{ borderColor: 'rgba(232,229,224,0.5)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenStudentSwitcher}
            className="flex items-center gap-2 text-[var(--text)] active:scale-[0.97] transition-transform"
            disabled={isInitializing}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary-soft)' }}>
              <User size={14} style={{ color: 'var(--primary)' }} />
            </div>
            <span style={{ fontSize: 'var(--fs-15)', fontWeight: 600, letterSpacing: '-0.01em' }}>
              {isInitializing ? '加载中...' : (currentStudent?.name || '选择学生')}
            </span>
            <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenLearningReport}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
            style={{ background: 'var(--bg-secondary)' }}
            title="学习报告"
          >
            <BarChart3 size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
          <button
            onClick={onOpenNotifications}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
            style={{ background: 'var(--bg-secondary)' }}
            title="通知"
          >
            <Bell size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </div>
    </header>
  )
}
