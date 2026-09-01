import { useEffect, useState } from 'react'
import { Bell, X, CheckCircle2, AlertCircle, Clock, Sparkles, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import EmptyState from './EmptyState'
import { getTasksSummary, getInProgressTasks } from '../services/apiService'
import dayjs from 'dayjs'

const statusCfg = {
  done: { text: '批改完成', color: 'var(--success)', bg: 'var(--success-soft)' },
  failed: { text: '识别失败', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  processing: { text: '批改中', color: 'var(--primary)', bg: 'var(--primary-soft)' },
  pending: { text: '排队中', color: 'var(--warning)', bg: 'var(--warning-soft)' }
}

const formatElapsed = (sec) => {
  const s = Number(sec) || 0
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分${s % 60} 秒`
  const h = Math.floor(m / 60)
  return `${h} 小时${m % 60} 分`
}

export default function NotificationsPanel({ onClose }) {
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [inProgress, setInProgress] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [sum, prog] = await Promise.all([
          getTasksSummary(false),
          getInProgressTasks(10).catch(() => ({ success: false, tasks: [] }))
        ])
        if (active && sum?.success) setSummary(sum.summary)
        if (active && prog?.success) setInProgress(prog.tasks || [])
      } catch (e) {
        console.error('加载通知失败:', e)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    // 15s 轮询，与 PC Dashboard 看板同节奏
    const id = setInterval(load, 15000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const statCards = [
    { key: 'pendingReview', label: '待确认', value: summary?.pendingReview ?? 0, icon: Clock, color: 'var(--warning)' },
    { key: 'inProgressCount', label: '批改中', value: summary?.inProgressCount ?? 0, icon: Loader2, color: 'var(--primary)' },
    { key: 'todayNewWrongQuestions', label: '今日新增错题', value: summary?.todayNewWrongQuestions ?? 0, icon: Sparkles, color: 'var(--primary)' }
  ]

  const hasContent = !loading && summary && (
    summary.totalNotifications > 0 ||
    summary.inProgressCount > 0 ||
    summary.todayNewWrongQuestions > 0 ||
    (summary.recentTasks || []).length > 0 ||
    inProgress.length > 0
  )

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

              {/* 批改中（2026-09-01 上线：让老师看到正在批改的进度，不止完成时才知道） */}
              {inProgress.length > 0 && (
                <div className="space-y-2 mb-4">
                  <span style={{ fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    批改中（{inProgress.length}）
                  </span>
                  {inProgress.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { onClose(); navigate('/') }}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                      style={{ background: 'var(--bg)' }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{
                          background: t.isStalled ? 'var(--danger-soft)' : 'var(--primary-soft)',
                          color: t.isStalled ? 'var(--danger)' : 'var(--primary)'
                        }}
                      >
                        {t.isStalled ? <AlertCircle size={16} /> : <Loader2 size={16} className="animate-spin" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span style={{ fontSize: 'var(--fs-13)', fontWeight: 500, color: 'var(--text)' }} className="truncate">
                            {t.originalName || '未命名试卷'}
                          </span>
                          <span style={{
                            fontSize: 'var(--fs-10)', padding: '1px 6px', borderRadius: 'var(--radius-8)',
                            background: t.isStalled ? 'var(--danger-soft)' : 'var(--primary-soft)',
                            color: t.isStalled ? 'var(--danger)' : 'var(--primary)',
                            whiteSpace: 'nowrap', flexShrink: 0
                          }}>
                            {t.isStalled ? '已卡 5 分钟' : '批改中'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5" style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)' }}>
                          {t.studentName && <span>{t.studentName}</span>}
                          {t.studentName && <span>·</span>}
                          <span>已耗时 {formatElapsed(t.elapsedSec)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

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
