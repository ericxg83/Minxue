import { Camera, CheckCircle2, ClipboardCheck, FileDown, Loader2 } from 'lucide-react'
import dayjs from 'dayjs'
import BottomSheet from './BottomSheet'

const stage = e => e.status === 'graded' ? 'completed' : ['submitted', 'grading'].includes(e.status) ? 'in_progress' : 'pending'
const total = e => e.question_ids?.length || e.total_count || 0
const time = v => dayjs(v).isValid() ? dayjs(v).format('YYYY/MM/DD HH:mm') : '最近创建'

// 重练卷详情：档案动作集中在这里（上传答卷、查看/打印、删除、看批改结果）。
// 主入口=本页"上传答卷"（选中这份卷即定位 examId，多页天然归一）；首页扫码上传为辅助路径。
export default function ExamDetailModal({ exam, onClose, onReprint, onDelete, onOpenResult, onUploadAnswer }) {
  const current = stage(exam)
  const completed = current === 'completed'
  const inProgress = current === 'in_progress'
  const count = total(exam)
  const score = completed && count ? `${exam.correct_count || 0}/${count} 题正确` : null

  return <BottomSheet title='组卷详情' onClose={onClose}>
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

        {!completed && !inProgress && (
          <div className='mt-5 space-y-2.5'>
            <button
              type='button'
              onClick={() => onUploadAnswer(exam)}
              className='flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.98]'
              style={{ background: 'var(--primary)' }}
            >
              <Camera size={16} />上传答卷
            </button>
            <p className='text-center text-[11px] leading-4' style={{ color: 'var(--text-tertiary)' }}>
              拍整份做完的卷子，多页一起传，系统按这份卷批改并更新掌握度
            </p>
          </div>
        )}
        {inProgress && (
          <div className='mt-4 flex items-center gap-2 rounded-2xl px-3.5 py-3' style={{ background: 'var(--primary-soft)' }}>
            <Loader2 size={15} className='animate-spin' style={{ color: 'var(--primary)' }} />
            <p className='text-[12px]' style={{ color: 'var(--text-secondary)' }}>正在整理批改结果，稍后可回来查看</p>
          </div>
        )}

        <div className='mt-5 space-y-2.5'>
          <button
            type='button'
            onClick={() => onReprint(exam)}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition-transform active:scale-[0.98] ${completed || inProgress ? 'text-white' : ''}`}
            style={completed || inProgress
              ? { background: 'var(--primary)' }
              : { background: 'var(--bg-secondary)', color: 'var(--text)' }}
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
  </BottomSheet>
}
