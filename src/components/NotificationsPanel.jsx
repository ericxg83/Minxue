import { useEffect, useState } from 'react'
import { Bell, X, CheckCircle2, AlertCircle, Clock, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from './EmptyState'
import { getTasksSummary } from '../services/apiService'
import dayjs from 'dayjs'

const statusCfg = {
  done: { text: '批改完成', color: 'var(--success)', bg: 'var(--success-soft)' },
  failed: { text: '识别失败', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  processing: { text: '批改中', color: 'var(--primary)', bg: 'var(--primary-soft)' },
  pending: { text: '排队中', color: 'var(--warning)', bg: 'var(--warning-soft)' }
}

export default function NotificationsPanel({ onClose }) {
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await getTasksSummary(false)
        if (active && data?.success) setSummary(data.summary)
      } catch (e) {
        console.error('加载通知失败:', e)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  const statCards = [
    { key: 'pendingReview', label: '待确认', value: summary?.pendingReview ?? 0, icon: Clock, color: 'var(--warning)' },
    { key: 'failedTasks', label: '识别失败', value: summary?.failedTasks ?? 0, icon: AlertCircle, color: 'var(--danger)' },
    { key: 'todayNewWrongQuestions', label: '今日新增错题', value: summary?.todayNewWrongQuestions ?? 0, icon: Sparkles, color: 'var(--primary)' }
  ]

  const hasContent = !loading && summary && (summary.totalNotifications > 0 || summary.todayNewWrongQuestions > 0)

  return (
    <div className="absolute inset-0 z-[100] animate-fade-in" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div
        className="absolute bottom-0 left-0 right-0 animate-slide-up"
        style={{
          background: '#fff',
          borderRadius: 'var(--radius-16) var(--radius-16) 0 0',
          maxHeight: '75vh',
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
            aria-label="关闭通知"
          >
            <X size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-13)' }}>
              加载中...
            </div>
          ) : !hasContent ? (
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
          ) : (
            <div style={{ padding: '14px' }}>
              {/* 统计卡片 */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                {statCards.map((s) => (
                  <div key={s.key} className="rounded-xl p-3 flex flex-col items-center" style={{ background: 'var(--bg)' }}>
                    <s.icon size={18} style={{ color: s.color, marginBottom: '4px' }} />
                    <span style={{ fontSize: 'var(--fs-18)', fontWeight: 700, color: 'var(--text)' }}>
                      {s.value}
                    </span>
                    <span style={{ fontSize: 'var(--fs-10)', color: 'var(--text-secondary)' }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* 最近任务 */}
              {(summary.recentTasks || []).length > 0 && (
                <div className="space-y-2">
                  <span style={{ fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--text-secondary)' }}>最近任务</span>
                  {summary.recentTasks.map((t) => {
                    const cfg = statusCfg[t.status] || statusCfg.pending
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          onClose()
                          navigate('/')
                        }}
                        className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                        style={{ background: 'var(--bg)' }}
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg }}>
                          {t.status === 'done' ? (
                            <CheckCircle2 size={16} style={{ color: cfg.color }} />
                          ) : t.status === 'failed' ? (
                            <AlertCircle size={16} style={{ color: cfg.color }} />
                          ) : (
                            <Clock size={16} style={{ color: cfg.color }} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span style={{ fontSize: 'var(--fs-13)', fontWeight: 500, color: 'var(--text)' }} className="truncate">
                              {t.originalName || '未命名试卷'}
                            </span>
                            <span style={{
                              fontSize: 'var(--fs-10)', padding: '1px 6px', borderRadius: 'var(--radius-8)',
                              background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap', flexShrink: 0
                            }}>
                              {cfg.text}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5" style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)' }}>
                            {t.studentName && <span>{t.studentName}</span>}
                            {t.studentName && <span>·</span>}
                            <span>{dayjs(t.createdAt).format('MM/DD HH:mm')}</span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
