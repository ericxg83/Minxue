import { Camera, ChevronRight, FileCheck2 } from 'lucide-react'
import { motion } from 'motion/react'
import { MobileList, MobileSectionHeading } from '../features/mobile/MobilePrimitives'

const done = new Set(['done', 'graded', 'completed', 'reviewed'])
const complete = (task) => done.has(task.status) || Boolean(task.result?.questionCount)

function Row({ title, detail, icon, onClick }) {
  return <button type='button' onClick={onClick} className='flex w-full items-center gap-3 border-b px-0.5 py-3.5 text-left' style={{ borderColor: 'var(--border-light)' }}><span className='flex h-8 w-8 items-center justify-center rounded-full' style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>{icon}</span><span className='min-w-0 flex-1'><span className='block truncate text-[14px] font-medium' style={{ color: 'var(--text)' }}>{title}</span><span className='mt-0.5 block truncate text-[12px]' style={{ color: 'var(--text-secondary)' }}>{detail}</span></span><ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} /></button>
}

export default function HomeDashboardV2({ currentStudent, tasks, isInitializing, pendingWrongCount = 0, onStartUpload, onOpenTasks, onOpenWrongBook, onOpenReview }) {
  const list = (Array.isArray(tasks) ? tasks : []).filter((task) => task.student_id === currentStudent?.id)
  const active = list.filter((task) => !complete(task)).slice(0, 2)
  const latest = list.find(complete)
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'>
    <header className='mb-7'><p className='mb-1 text-[12px] font-medium' style={{ color: 'var(--text-secondary)' }}>今天</p><h1 className='text-[24px] font-semibold tracking-[-0.04em]' style={{ color: 'var(--text)' }}>{isInitializing ? '正在准备…' : `${currentStudent?.name || '同学'}，今天继续学习`}</h1></header>
    <button type='button' onClick={onStartUpload} className='mb-8 flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left shadow-sm' style={{ background: 'var(--primary)', color: '#fff' }}><span className='flex h-10 w-10 items-center justify-center rounded-xl' style={{ background: 'rgba(255,255,255,.16)' }}><Camera size={20} /></span><span className='flex-1'><span className='block text-[15px] font-semibold'>拍一份作业</span><span className='mt-0.5 block text-[12px] opacity-75'>上传图片，开始批改</span></span><ChevronRight size={18} /></button>
    <section className='mb-8'><MobileSectionHeading title='接下来做什么' description={pendingWrongCount ? `${pendingWrongCount} 道题等待复习` : '完成一次学习行动，继续积累进步'} action={active.length ? '全部作业' : undefined} onAction={onOpenTasks} />
      <MobileList>
        {pendingWrongCount > 0 && <Row icon={<FileCheck2 size={16} />} title='先复习需要关注的错题' detail={`${pendingWrongCount} 道题等待复习`} onClick={onOpenWrongBook} />}
        {active.map((task) => <Row key={task.id} icon={<Camera size={16} />} title='作业正在处理' detail='批改完成后会自动整理错题' onClick={() => onOpenTasks(task)} />)}
        {!pendingWrongCount && !active.length && <button type='button' onClick={onStartUpload} className='w-full py-4 text-left text-[13px]' style={{ color: 'var(--text-secondary)' }}>今天还没有学习记录，拍一份作业开始吧</button>}
      </MobileList>
    </section>
    {latest && <section><MobileSectionHeading title='最近一次结果' action='查看作业' onAction={onOpenTasks} /><button type='button' onClick={() => onOpenReview(latest)} className='flex w-full items-center justify-between border-y py-3.5 text-left' style={{ borderColor: 'var(--border-light)' }}><span><span className='block text-[14px] font-medium' style={{ color: 'var(--text)' }}>最近一次作业</span><span className='mt-0.5 block text-[12px]' style={{ color: 'var(--text-secondary)' }}>{latest.result?.wrongCount || 0} 道题需要关注</span></span><ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} /></button></section>}
  </motion.div>
}
