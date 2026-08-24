import { AlertCircle, Camera, ChevronRight, CircleCheck, Clock3, FileCheck2 } from 'lucide-react'
import { motion } from 'motion/react'
import { MobileList, MobileSectionHeading } from '../features/mobile/MobilePrimitives'

const done = new Set(['done', 'graded', 'completed', 'reviewed'])
const complete = (task) => done.has(task.status) || Boolean(task.result?.questionCount)
const failed = (task) => task.status === 'failed'
const processing = (task) => !complete(task) && !failed(task)

function Row({ title, detail, icon, onClick }) {
  return <button type='button' onClick={onClick} className='flex w-full items-center gap-3 border-b px-0.5 py-3.5 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]' style={{ borderColor: 'var(--border-light)' }}><span className='flex h-8 w-8 items-center justify-center rounded-full' style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>{icon}</span><span className='min-w-0 flex-1'><span className='block truncate text-[14px] font-medium' style={{ color: 'var(--text)' }}>{title}</span><span className='mt-0.5 block truncate text-[12px]' style={{ color: 'var(--text-secondary)' }}>{detail}</span></span><ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} /></button>
}

function ActionCard({ icon, eyebrow, title, detail, onClick, tone = 'primary' }) {
  const colors = tone === 'warning'
    ? { background: 'var(--warning-soft)', color: 'var(--warning)', iconBackground: 'rgba(217,119,6,.12)' }
    : { background: 'var(--primary)', color: '#fff', iconBackground: 'rgba(255,255,255,.16)' }
  return <button type='button' onClick={onClick} className='flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left shadow-sm transition-transform active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2' style={{ background: colors.background, color: colors.color }}><span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl' style={{ background: colors.iconBackground }}>{icon}</span><span className='min-w-0 flex-1'><span className='mb-0.5 block text-[11px] font-medium opacity-75'>{eyebrow}</span><span className='block text-[15px] font-semibold'>{title}</span><span className='mt-0.5 block truncate text-[12px] opacity-80'>{detail}</span></span><ChevronRight size={18} aria-hidden='true' /></button>
}

export default function HomeDashboardV2({ currentStudent, tasks, isInitializing, pendingWrongCount = 0, onStartUpload, onOpenTasks, onOpenWrongBook, onOpenReview, onRetryTask }) {
  const list = (Array.isArray(tasks) ? tasks : []).filter((task) => task.student_id === currentStudent?.id).sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0))
  const failedTask = list.find(failed)
  const activeTask = list.find(processing)
  const latest = list.find(complete)
  const priorityAction = pendingWrongCount > 0
    ? { icon: <FileCheck2 size={20} />, eyebrow: '今日重点', title: `复习 ${pendingWrongCount} 道错题`, detail: '巩固还不熟练的内容', onClick: onOpenWrongBook }
    : failedTask
      ? { icon: <AlertCircle size={20} />, eyebrow: '需要处理', title: '重新提交这份作业', detail: '上次上传未能完成批改', onClick: () => onRetryTask?.(failedTask.id) || onOpenTasks(), tone: 'warning' }
      : activeTask
        ? { icon: <Clock3 size={20} />, eyebrow: '正在进行', title: '作业批改中', detail: '完成后会自动整理错题', onClick: onOpenTasks }
        : { icon: <Camera size={20} />, eyebrow: '开始学习', title: '拍一份作业', detail: '上传图片，开始批改', onClick: onStartUpload }

  return <motion.main initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'>
    <header className='mb-5'><p className='mb-1 text-[12px] font-medium' style={{ color: 'var(--text-secondary)' }}>今天</p><h1 className='text-[24px] font-semibold tracking-[-0.04em]' style={{ color: 'var(--text)' }}>{isInitializing ? '正在准备学习数据…' : `${currentStudent?.name || '同学'}，从一件重要的事开始`}</h1></header>
    <section aria-label='今日重点' className='mb-7'><ActionCard {...priorityAction} /></section>
    <section className='mb-7'><MobileSectionHeading title='学习动态' description={isInitializing ? '正在同步最新记录' : '作业和错题的最新进展'} action='查看作业' onAction={onOpenTasks} />
      <MobileList>
        {isInitializing && <Row icon={<Clock3 size={16} />} title='正在同步学习记录' detail='稍后会显示最新状态' onClick={onOpenTasks} />}
        {!isInitializing && activeTask && <Row icon={<Clock3 size={16} />} title='有一份作业正在批改' detail='完成后会自动归入错题本' onClick={onOpenTasks} />}
        {!isInitializing && pendingWrongCount > 0 && <Row icon={<FileCheck2 size={16} />} title={`${pendingWrongCount} 道错题等待复习`} detail='完成重练，验证是否真正掌握' onClick={onOpenWrongBook} />}
        {!isInitializing && !activeTask && pendingWrongCount === 0 && <Row icon={<CircleCheck size={16} />} title='当前没有待处理内容' detail='拍一份作业，记录今天的学习' onClick={onStartUpload} />}
      </MobileList>
    </section>
    {latest && <section><MobileSectionHeading title='最近一次作业' action='查看结果' onAction={() => onOpenReview(latest)} /><button type='button' onClick={() => onOpenReview(latest)} className='flex w-full items-center justify-between border-y py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]' style={{ borderColor: 'var(--border-light)' }}><span><span className='block text-[14px] font-medium' style={{ color: 'var(--text)' }}>{latest.result?.questionCount || '本次'} 题已完成批改</span><span className='mt-0.5 block text-[12px]' style={{ color: 'var(--text-secondary)' }}>{latest.result?.wrongCount ? `${latest.result.wrongCount} 道题已加入后续复习` : '这次作业表现不错，继续保持'}</span></span><ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} /></button></section>}
  </motion.main>
}