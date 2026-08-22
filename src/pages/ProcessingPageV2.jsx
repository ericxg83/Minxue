import { AlertCircle, Camera, CheckCircle2, ChevronRight, Clock3, Loader2, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import { MobileList, MobileSegmentedTabs } from '../features/mobile/MobilePrimitives'

const done = new Set(['done', 'graded', 'completed', 'reviewed'])
const complete = (task) => done.has(task.status) || Boolean(task.result?.questionCount)
const retry = (task) => task.task_type === 'retry_paper' || task.task_type === 'wrong_retry'
const time = (value) => dayjs(value).isValid() ? dayjs(value).format('MM/DD HH:mm') : '刚刚'
const stage = (task) => task.status === 'failed' ? 'failed' : ['processing', 'queued', 'pending'].includes(task.status) ? 'processing' : complete(task) ? 'completed' : 'waiting'

function TaskRow({ task, onViewImage, onRetryTask, onOpenReview }) {
  const current = stage(task)
  const wrong = task.result?.wrongCount || 0
  const Icon = current === 'failed' ? AlertCircle : current === 'processing' ? Loader2 : current === 'completed' ? CheckCircle2 : Clock3
  const detail = current === 'failed' ? '图片处理没有完成' : current === 'processing' ? '正在整理批改结果' : current === 'completed' ? `${wrong} 道题需要关注` : '等待系统开始处理'
  return <div className='border-b px-0.5 py-4 last:border-b-0' style={{ borderColor: 'var(--border-light)' }}><button type='button' onClick={() => current === 'completed' ? onOpenReview(task) : onViewImage(task)} className='flex w-full items-start gap-3 text-left'><span className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full' style={{ background: current === 'failed' ? 'var(--danger-soft)' : 'var(--primary-soft)', color: current === 'failed' ? 'var(--danger)' : 'var(--primary)' }}><Icon size={16} className={current === 'processing' ? 'animate-spin' : ''} /></span><span className='min-w-0 flex-1'><span className='block truncate text-[14px] font-semibold' style={{ color: 'var(--text)' }}>{retry(task) ? '错题重练' : '日常作业'}</span><span className='mt-1 block truncate text-[12px]' style={{ color: current === 'failed' ? 'var(--danger)' : 'var(--text-secondary)' }}>{time(task.created_at)} · {detail}</span></span><ChevronRight size={16} className='mt-1' style={{ color: 'var(--text-tertiary)' }} /></button>{current === 'failed' && <button type='button' onClick={() => onRetryTask(task.id)} className='ml-11 mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold' style={{ color: 'var(--danger)' }}><RotateCcw size={13} />重新上传</button>}{current === 'completed' && wrong > 0 && <button type='button' onClick={() => onOpenReview(task)} className='ml-11 mt-3 text-[12px] font-semibold' style={{ color: 'var(--primary)' }}>查看批改结果</button>}</div>
}

export default function ProcessingPageV2({ currentStudent, tasks, filteredTasks, isLoadingTasks, isInitializing, processingFilter, onFilterChange, onViewImage, onRetryTask, onOpenReview }) {
  const all = (Array.isArray(tasks) ? tasks : []).filter((task) => task.student_id === currentStudent?.id)
  const visible = Array.isArray(filteredTasks) ? filteredTasks : []
  const tabs = [{ id: 'all', label: '全部', count: all.length }, { id: 'homework', label: '作业', count: all.filter((task) => !retry(task)).length }, { id: 'retry', label: '重练', count: all.filter(retry).length }]
  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'><header className='mb-6'><p className='mb-1 text-[12px] font-medium' style={{ color: 'var(--text-secondary)' }}>最近的学习记录</p><h1 className='text-[24px] font-semibold tracking-[-0.04em]' style={{ color: 'var(--text)' }}>作业</h1><p className='mt-1.5 text-[13px]' style={{ color: 'var(--text-secondary)' }}>查看提交、批改进度和学习结果</p></header><MobileSegmentedTabs items={tabs} value={processingFilter} onChange={onFilterChange} ariaLabel='作业类型' />{isLoadingTasks || isInitializing ? <div className='space-y-3'><div className='h-20 animate-pulse border-y' style={{ background: 'var(--bg-secondary)' }} /><div className='h-20 animate-pulse border-y' style={{ background: 'var(--bg-secondary)' }} /></div> : visible.length === 0 ? <EmptyState icon={Camera} title='还没有作业记录' description='拍一份作业后，批改进度会显示在这里' className='py-16' /> : <MobileList>{visible.map((task, index) => <TaskRow key={task.id || index} task={task} onViewImage={onViewImage} onRetryTask={onRetryTask} onOpenReview={onOpenReview} />)}</MobileList>}<p className='mt-5 text-[12px]' style={{ color: 'var(--text-tertiary)' }}>批改完成后，错题会自动进入错题本</p></motion.div>
}
