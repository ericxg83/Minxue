import { AlertCircle, Camera, Check, CheckCircle2, ChevronRight, Clock3, FileCheck2, Loader2, RotateCcw, UploadCloud } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import SwipeableRow from '../components/SwipeableRow'
import EmptyState from '../components/EmptyState'
import { MobilePageHeader, MobileStatGrid, MobileSegmentedTabs, MobileList } from '../features/mobile/MobilePrimitives'

const completedStatuses = new Set(['done', 'graded', 'completed', 'reviewed'])
const isCompleted = (task) => completedStatuses.has(task.status) || Boolean(task.result?.questionCount)
const isRetryTask = (task) => task.task_type === 'retry_paper' || task.task_type === 'wrong_retry'

const getStage = (task) => {
  if (task.status === 'failed') return 'failed'
  if (task.status === 'processing' || task.status === 'queued' || task.status === 'pending') return 'processing'
  if (isCompleted(task)) return 'completed'
  return 'waiting'
}

const stageConfig = {
  failed: { label: '需要重试', color: 'var(--danger)', background: 'var(--danger-soft)', icon: AlertCircle },
  processing: { label: '正在批改', color: 'var(--primary)', background: 'var(--primary-soft)', icon: Loader2 },
  completed: { label: '批改完成', color: 'var(--success)', background: 'var(--success-soft)', icon: CheckCircle2 },
  waiting: { label: '等待处理', color: 'var(--warning)', background: 'var(--warning-soft)', icon: Clock3 },
}

const formatTime = (value) => {
  const date = dayjs(value)
  return date.isValid() ? date.format('MM/DD HH:mm') : '刚刚'
}

export default function ProcessingPage({
  currentStudent,
  tasks,
  filteredTasks,
  isLoadingTasks,
  isInitializing,
  processingFilter,
  onFilterChange,
  onViewImage,
  onRetryTask,
  onDeleteTask,
  onOpenReview,
}) {
  const studentTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => task.student_id === currentStudent?.id)
  const visibleTasks = Array.isArray(filteredTasks) ? filteredTasks : []
  const failedTasks = studentTasks.filter((task) => getStage(task) === 'failed')
  const processingTasks = studentTasks.filter((task) => getStage(task) === 'processing')
  const completedTasks = studentTasks.filter((task) => getStage(task) === 'completed')
  const waitingTasks = studentTasks.filter((task) => getStage(task) === 'waiting')

  const tabs = [
    { id: 'all', label: '全部', count: studentTasks.length },
    { id: 'homework', label: '日常作业', count: studentTasks.filter((task) => !isRetryTask(task)).length },
    { id: 'retry', label: '错题重练', count: studentTasks.filter(isRetryTask).length },
  ]

  return (
    <motion.div key="tasks-page" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="mobile-page mx-auto w-full max-w-lg px-4 pb-4 pt-4">
      <MobilePageHeader eyebrow="学习证据" title="作业" description="查看上传、批改和需要确认的任务" icon={UploadCloud} />

      <MobileStatGrid items={[{ value: failedTasks.length, label: '需重试', color: failedTasks.length ? 'var(--danger)' : 'var(--text)' }, { value: processingTasks.length, label: '批改中', color: processingTasks.length ? 'var(--primary)' : 'var(--text)' }, { value: completedTasks.length, label: '已完成', color: 'var(--success)' }]} className="mb-4" />

      {failedTasks.length > 0 && <div className="mb-6 flex items-center gap-3 rounded-2xl border px-4 py-3.5" style={{ borderColor: 'rgba(240,68,56,0.25)', background: 'var(--danger-soft)' }}><div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(240,68,56,0.14)', color: 'var(--danger)' }}><AlertCircle size={17} /></div><div className="min-w-0 flex-1"><p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>有 {failedTasks.length} 项作业需要重试</p><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>图片未能完成识别，不影响其他任务</p></div><button type="button" onClick={() => onRetryTask(failedTasks[0].id)} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white" style={{ background: 'var(--danger)' }}>重试</button></div>}

      <MobileSegmentedTabs items={tabs} value={processingFilter} onChange={onFilterChange} ariaLabel="作业类型" />

      <div className="mb-3 flex items-end justify-between px-1"><div><h2 className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>任务记录</h2><p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{visibleTasks.length ? `${visibleTasks.length} 项任务 · ${currentStudent?.name || '当前学生'}` : '完成上传后，任务会显示在这里'}</p></div><span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>最近优先</span></div>

      {isLoadingTasks || isInitializing ? <div className="space-y-3" aria-label="正在加载作业"><div className="h-20 animate-pulse rounded-2xl" style={{ background: 'var(--bg-secondary)' }} /><div className="h-20 animate-pulse rounded-2xl" style={{ background: 'var(--bg-secondary)' }} /></div> : visibleTasks.length === 0 ? <EmptyState icon={Camera} title="还没有作业任务" description="从工作台拍摄作业后，上传和批改进度会显示在这里" className="rounded-2xl border py-16" iconContainerStyle={{ background: 'var(--bg-secondary)' }} iconStyle={{ color: 'var(--text-secondary)' }} titleStyle={{ color: 'var(--text)', fontSize: 'var(--fs-15)', fontWeight: 600 }} descriptionStyle={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-12)' }} /> : <MobileList>{visibleTasks.map((task, index) => { const stage = getStage(task); const config = stageConfig[stage]; const StatusIcon = config.icon; const completed = stage === 'completed'; const wrongCount = task.result?.wrongCount || 0; const total = task.result?.questionCount || 0; return <SwipeableRow key={task.id || index} onDelete={() => onDeleteTask(task.id)}><motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="border-b px-4 py-4 last:border-b-0" style={{ borderColor: 'var(--border-light)' }}><button type="button" onClick={() => completed ? onOpenReview(task) : onViewImage(task)} className="flex w-full items-start gap-3 text-left"><div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: config.background, color: config.color }}><StatusIcon size={17} className={stage === 'processing' ? 'animate-spin' : ''} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{isRetryTask(task) ? '错题重练' : '日常作业'}</h3><span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: config.background, color: config.color }}>{config.label}</span></div><p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{formatTime(task.created_at)} · {task.original_name || task.name || '未命名作业'}</p>{completed && total > 0 ? <div className="mt-2 flex items-center gap-2 text-[12px]"><span className="inline-flex items-center gap-1" style={{ color: 'var(--success)' }}><Check size={13} />{total - wrongCount} 道正确</span><span className="inline-flex items-center gap-1" style={{ color: wrongCount ? 'var(--danger)' : 'var(--text-tertiary)' }}><AlertCircle size={13} />{wrongCount} 道错题</span></div> : <p className="mt-2 text-[12px]" style={{ color: stage === 'failed' ? 'var(--danger)' : 'var(--text-secondary)' }}>{stage === 'failed' ? task.result?.error || '图片处理失败，点击重试' : stage === 'processing' ? '批改完成后会自动整理错题' : '等待系统开始处理'}</p>}</div><ChevronRight size={16} className="mt-1 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} /></button>{stage === 'failed' && <button type="button" onClick={() => onRetryTask(task.id)} className="mt-3 ml-12 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><RotateCcw size={13} />重新上传</button>}{stage === 'processing' && <div className="mt-3 ml-12 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-secondary)' }}><motion.div className="h-full w-1/2 rounded-full" style={{ background: 'var(--primary)' }} animate={{ x: ['-100%', '200%'] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }} /></div>}{stage === 'completed' && wrongCount > 0 && <button type="button" onClick={() => onOpenReview(task)} className="mt-3 ml-12 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>查看批改结果<ChevronRight size={13} /></button>}</motion.div></SwipeableRow> })}</MobileList>}

      <div className="mt-6 border-t px-1 pt-4" style={{ borderColor: 'var(--border-light)' }}><p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>共 {studentTasks.length} 项任务 · 已完成 {completedTasks.length} 项</p><p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>批改完成后，错题会自动进入错题本</p></div>
    </motion.div>
  )
}
