import { Bell, X } from 'lucide-react'
import EmptyState from './EmptyState'

export default function NotificationsPanel({ onClose }) {
  return (
    <div className="absolute inset-0 z-[100] animate-fade-in" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div
        className="absolute bottom-0 left-0 right-0 animate-slide-up"
        style={{
          background: '#fff',
          borderRadius: 'var(--radius-16) var(--radius-16) 0 0',
          maxHeight: '70vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: 'var(--fs-16)', fontWeight: 600, color: 'var(--text)' }}>通知</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--bg-hover)' }}
          >
            <X size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <EmptyState
            icon={Bell}
            iconSize={32}
            title="暂无新通知"
            description="批改完成、系统消息将在此显示"
            className="py-12"
            iconStyle={{ marginBottom: '12px' }}
            titleStyle={{ fontSize: 'var(--fs-14)', fontWeight: 500, color: 'var(--text-secondary)' }}
            descriptionStyle={{ fontSize: 'var(--fs-12)', marginTop: '4px', color: 'var(--text-secondary)' }}
          />
        </div>
      </div>
    </div>
  )
}
