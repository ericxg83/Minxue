import { AlertCircle, CheckCircle2, ClipboardCheck, FileDown, Loader2, X } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'

const stage = e => e.status === 'graded' ? 'completed' : ['submitted', 'grading'].includes(e.status) ? 'in_progress' : 'pending'
const total = e => e.question_ids?.length || e.total_count || 0
const time = v => dayjs(v).isValid() ? dayjs(v).format('YYYY/MM/DD HH:mm') : '最近创建'

// 重练卷详情：档案动作集中在这里（查看/打印、删除、看批改结果）。
// 不放上传按钮——答卷上传唯一入口在首页「错题重练」，扫码自动定位这份卷。
export default function ExamDetailModal({ exam, onClose, onReprint, onDelete, onOpenResult }) {
  const current = stage(exam)
  const completed = current === 'completed'
  const count = total(exam)
  const score = completed && count ? `${exam.correct_count || 0}/${count} 题正确` : null

  return <div className='absolute inset-0 z-[20000] flex items-center justify-center px-4'>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className='absolute inset-0 bg-black/50 backdrop-blur-sm'
      onClick={onClose}
    />
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className='relative w-full max-w-lg mx-auto rounded-3xl bg-white shadow-xl'
      style={{ maxHeight: 'min(85vh, 720px)', display: 'flex', flexDirection: 'column', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className='flex justify-center pt-3 pb-1'>
        <div className='h-1 w-8 rounded-full' style={{ background: 'var(--border)' }} />
      </div>
      <div className='flex items-center justify-between px-5 pt-1 pb-2'>
        <h3 className='text-[16px] font-semibold' style={{ color: 'var(--text)' }}>组卷详情</h3>
        <button
          onClick={onClose}
          className='flex h-7 w-7 items-center justify-center rounded-full'
          style={{ background: 'var(--bg-mist)' }}
          aria-label='关闭'
        >
          <X size={14} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>
      <div className='overflow-y-auto px-5 pb-4'>
        <div className='flex items-start gap-3'>
          <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl' style={{ background: completed ? 'var(--success-soft)' : 'var(--primary-soft)', color: completed ? 'var(--success)' : 'var(--primary)' }}>
            {current === 'in_progress' ? <Loader2 size={18} className='animate-spin' /> : completed ? <CheckCircle2 size={18} /> : <ClipboardCheck size={18} />}
          </span>
          <div className='min-w-0 flex-1'>
            <p className='truncate text-[15px] font-semibold' style={{ color: 'var(--text)' }}>{exam.name || '重练卷'}</p>
            <p className='mt-0.5 text-[12px]' style={{ color: 'var(--text-secondary)' }}>
              {time(exam.created_at)} · {count} 道题
            </p>
            <p className='mt-1 text-[13px] font-medium' style={{ color: completed ? 'var(--success)' : current === 'in_progress' ? 'var(--primary)' : 'var(--text-secondary)' }}>
              {score || (current === 'in_progress' ? '正在整理批改结果' : '待完成')}
            </p>
          </div>
        </div>

        {!completed && current !== 'in_progress' && (
          <div className='mt-4 flex items-start gap-2.5 rounded-2xl px-3.5 py-3' style={{ background: 'var(--info-soft, var(--primary-soft))' }}>
            <AlertCircle size={15} className='mt-0.5 shrink-0' style={{ color: 'var(--primary)' }} />
            <p className='text-[12px] leading-5' style={{ color: 'var(--text-secondary)' }}>
              做完这份卷后，从首页「上传作业」选「错题重练」拍照上传，扫码会自动定位到这份卷并批改。
            </p>
          </div>
        )}

        <div className='mt-5 space-y-2.5'>
          <button
            type='button'
            onClick={() => onReprint(exam)}
            className='flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.98]'
            style={{ background: 'var(--primary)' }}
          >
            <FileDown size={16} />查看 / 打印试卷
          </button>
          {completed && (
            <button
              type='button'
              onClick={() => onOpenResult(exam)}
              className='w-full rounded-xl py-3 text-[14px] font-semibold transition-transform active:scale-[0.98]'
              style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}
            >
              查看批改结果
            </button>
          )}
          <button
            type='button'
            onClick={() => onDelete(exam)}
            className='w-full py-2.5 text-[13px] font-medium transition-transform active:scale-[0.98]'
            style={{ color: 'var(--danger)' }}
          >
            删除这份卷
          </button>
        </div>
      </div>
    </motion.div>
  </div>
}
