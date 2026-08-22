import { AlertCircle, ArrowRight, Camera, CheckCircle2, ChevronRight, Clock3, FileCheck2, RefreshCw, Sparkles, UploadCloud } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'

const completedStatuses = new Set(['done', 'graded', 'completed', 'reviewed'])

const isCompleted = (task) => completedStatuses.has(task.status) || Boolean(task.result?.questionCount)

const isRetry = (task) => task.task_type === 'retry_paper' || task.task_type === 'wrong_retry'

const formatTime = (value) => {
  if (!value) return '刚刚'
  const date = dayjs(value)
  return date.isValid() ? date.format('MM/DD HH:mm') : '刚刚'
}

const getTaskSummary = (task) => {
  if (task.status === 'failed') {
    return { label: '需要重新上传', tone: 'danger', icon: AlertCircle }
  }
  if (task.status === 'processing' || task.status === 'queued' || task.status === 'pending') {
    return { label: '正在批改', tone: 'info', icon: RefreshCw }
  }
  if (isCompleted(task) && (task.result?.wrongCount || 0) > 0) {
    return { label: `${task.result.wrongCount} 道错题`, tone: 'warning', icon: AlertCircle }
  }
  if (isCompleted(task)) {
    return { label: '批改完成', tone: 'success', icon: CheckCircle2 }
  }
  return { label: '等待处理', tone: 'warning', icon: Clock3 }
}

const toneMap = {
  danger: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
  warning: { color: 'var(--warning)', bg: 'var(--warning-soft)' },
  info: { color: 'var(--primary)', bg: 'var(--primary-soft)' },
  success: { color: 'var(--success)', bg: 'var(--success-soft)' },
}

function SectionHeading({ title, count, action, onAction }) {
  return (
    <div className="flex items-center justify-between px-1">
      <div className="flex items-center gap-2">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em]" style={{ color: 'var(--text)' }}>{title}</h2>
        {typeof count === 'number' && count > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{count}</span>
        )}
      </div>
      {action && (
        <button onClick={onAction} className="inline-flex items-center gap-0.5 text-[13px] font-medium" style={{ color: 'var(--primary)' }}>
          {action}<ChevronRight size={14} />
        </button>
      )}
    </div>
  )
}

export default function HomeDashboard({
  currentStudent,
  tasks,
  isLoadingTasks,
  isInitializing,
  wrongCount = 0,
  pendingWrongCount = 0,
  onStartUpload,
  onOpenTasks,
  onOpenWrongBook,
  onOpenExam,
  onOpenReview,
  onRetryTask,
}) {
  const studentTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task.student_id === currentStudent?.id)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

  const attentionTasks = studentTasks.filter((task) => task.status === 'failed' || (isCompleted(task) && (task.result?.wrongCount || 0) > 0)).slice(0, 3)
  const activeTasks = studentTasks.filter((task) => !isCompleted(task) && task.status !== 'failed').slice(0, 3)
  const recentTasks = studentTasks.filter((task) => !attentionTasks.includes(task) && !activeTasks.includes(task)).slice(0, 3)
  const completedCount = studentTasks.filter(isCompleted).length
  const failedCount = studentTasks.filter((task) => task.status === 'failed').length
  const hasAttention = attentionTasks.length > 0 || pendingWrongCount > 0

  return (
    <motion.div
      key="home-dashboard"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-lg px-4 pb-4 pt-5"
    >
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="mb-1 text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>今天的教学任务</p>
          <h1 className="text-[25px] font-semibold tracking-[-0.04em]" style={{ color: 'var(--text)' }}>
            {isInitializing ? '正在准备…' : `${currentStudent?.name || '选择学生'}，晚上好`}
          </h1>
        </div>
        <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }} aria-hidden="true">
          <Sparkles size={17} strokeWidth={2} />
        </div>
      </div>

      <button
        type="button"
        onClick={onStartUpload}
        className="mb-7 flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left transition-transform active:scale-[0.985]"
        style={{ background: 'var(--primary)', color: '#fff', boxShadow: '0 6px 18px rgba(22,119,255,0.18)' }}
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgba(255,255,255,0.16)' }}><Camera size={21} /></span>
          <span>
            <span className="block text-[16px] font-semibold">拍作业</span>
            <span className="mt-0.5 block text-[12px]" style={{ color: 'rgba(255,255,255,0.78)' }}>连续上传，完成后自动整理错题</span>
          </span>
        </span>
        <ArrowRight size={19} />
      </button>

      <div className="mb-7">
        <SectionHeading title="现在需要处理" count={attentionTasks.length + (pendingWrongCount > 0 && attentionTasks.length === 0 ? 1 : 0)} action="查看全部" onAction={onOpenTasks} />
        <div className="mt-3 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-card)' }}>
          {isLoadingTasks || isInitializing ? (
            <div className="space-y-3 p-4" aria-label="正在加载任务">
              {[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl" style={{ background: 'var(--bg-secondary)' }} />)}
            </div>
          ) : !hasAttention ? (
            <div className="flex items-center gap-3 px-4 py-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><CheckCircle2 size={18} /></div>
              <div>
                <p className="text-[14px] font-medium" style={{ color: 'var(--text)' }}>目前没有待处理问题</p>
                <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>可以继续拍摄新的作业，或查看最近结果</p>
              </div>
            </div>
          ) : (
            <>
              {pendingWrongCount > 0 && (
                <button type="button" onClick={onOpenWrongBook} className="flex w-full items-center gap-3 border-b px-4 py-3.5 text-left" style={{ borderColor: 'var(--border-light)' }}>
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}><AlertCircle size={17} /></div>
                  <div className="min-w-0 flex-1"><p className="text-[14px] font-medium" style={{ color: 'var(--text)' }}>有 {pendingWrongCount} 道错题待安排重练</p><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>优先处理重复出错题</p></div>
                  <ChevronRight size={17} style={{ color: 'var(--text-tertiary)' }} />
                </button>
              )}
              {attentionTasks.map((task, index) => {
                const summary = getTaskSummary(task)
                const tone = toneMap[summary.tone]
                const Icon = summary.icon
                return (
                  <button key={task.id} type="button" onClick={() => task.status === 'failed' ? onRetryTask(task.id) : onOpenReview(task)} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${index < attentionTasks.length - 1 ? 'border-b' : ''}`} style={{ borderColor: 'var(--border-light)' }}>
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: tone.bg, color: tone.color }}><Icon size={17} className={task.status === 'processing' ? 'animate-spin' : ''} /></div>
                    <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium" style={{ color: 'var(--text)' }}>{task.status === 'failed' ? '作业图片处理失败' : `${task.result?.wrongCount || 0} 道错题需要关注`}</p><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{task.status === 'failed' ? '点击重新上传' : `${formatTime(task.created_at)} · 查看批改结果`}</p></div>
                    <span className="text-[12px] font-medium" style={{ color: tone.color }}>{task.status === 'failed' ? '重试' : '查看'}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>

      {activeTasks.length > 0 && (
        <div className="mb-7">
          <SectionHeading title="正在处理" count={activeTasks.length} action="作业" onAction={onOpenTasks} />
          <div className="mt-3 divide-y overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-card)' }}>
            {activeTasks.map((task) => {
              const summary = getTaskSummary(task)
              return <button key={task.id} type="button" onClick={onOpenTasks} className="flex w-full items-center gap-3 px-4 py-3 text-left"><div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><UploadCloud size={16} /></div><div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium" style={{ color: 'var(--text)' }}>{isRetry(task) ? '错题重练' : '日常作业'}</p><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{summary.label} · {formatTime(task.created_at)}</p></div><ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} /></button>
            })}
          </div>
        </div>
      )}

      <div className="mb-3">
        <SectionHeading title="最近活动" action="重练卷" onAction={onOpenExam} />
        <div className="mt-3 divide-y overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-card)' }}>
          {recentTasks.length === 0 ? <div className="px-4 py-4 text-[13px]" style={{ color: 'var(--text-secondary)' }}>完成一次作业后，最近结果会显示在这里</div> : recentTasks.map((task) => <button key={task.id} type="button" onClick={() => isCompleted(task) ? onOpenReview(task) : onOpenTasks()} className="flex w-full items-center gap-3 px-4 py-3 text-left"><div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: isCompleted(task) ? 'var(--success-soft)' : 'var(--bg-secondary)', color: isCompleted(task) ? 'var(--success)' : 'var(--text-secondary)' }}><FileCheck2 size={16} /></div><div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium" style={{ color: 'var(--text)' }}>{isCompleted(task) ? '批改完成' : '作业任务'}</p><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{formatTime(task.created_at)} · {task.result?.questionCount || 0} 道题</p></div><ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} /></button>)}
        </div>
      </div>

      <div className="mt-7 flex items-center justify-between border-t px-1 pt-4" style={{ borderColor: 'var(--border-light)' }}>
        <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>今日已完成 {completedCount} 项</span>
        <span className="text-[12px]" style={{ color: failedCount > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>{failedCount > 0 ? `${failedCount} 项需要重试` : `错题本 ${wrongCount} 道`}</span>
      </div>
    </motion.div>
  )
}
