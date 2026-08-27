import { CheckCircle2, ChevronRight, ClipboardCheck, FileDown, FileText, Loader2, UploadCloud } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import { MobileList, MobilePrimaryButton, MobileTextAction } from '../features/mobile/MobilePrimitives'

const stage = e => e.status === 'graded' ? 'completed' : ['submitted', 'grading'].includes(e.status) ? 'in_progress' : 'pending'
const labels = { pending: '待完成', in_progress: '正在整理结果', completed: '已完成' }
const stageRank = { pending: 0, in_progress: 1, completed: 2 }
const total = e => e.question_ids?.length || e.total_count || 0
const time = v => dayjs(v).isValid() ? dayjs(v).format('MM/DD HH:mm') : '最近创建'

// 一行即一份卷：待完成行的主动作是"上传答案"，完成行的主动作是"查看批改结果"，
// 批改中行只展示状态。单列表按 待完成 → 批改中 → 已完成 排序，不做状态分栏。
function PracticeRow({ exam, onDownloadPdf, onSubmitExam, onOpenExamResult, submitting }) {
  const current = stage(exam)
  const count = total(exam)
  const completed = current === 'completed'
  const score = completed && count ? `${exam.correct_count || 0}/${count} 题正确` : null
  return <div className='border-b px-0.5 py-3 last:border-b-0' style={{ borderColor: 'var(--border-light)' }}>
    <div className='flex items-start gap-2.5'>
      <span className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg' style={{ background: completed ? 'var(--success-soft)' : 'var(--primary-soft)', color: completed ? 'var(--success)' : 'var(--primary)' }}>
        {current === 'in_progress' ? <Loader2 size={16} className='animate-spin' /> : completed ? <CheckCircle2 size={16} /> : <ClipboardCheck size={16} />}
      </span>
      <div className='min-w-0 flex-1'>
        <span className='block truncate text-[14px] font-semibold'>{exam.name || '重练卷'}</span>
        <span className='mt-0.5 block text-[12px]' style={{ color: 'var(--text-secondary)' }}>
          {time(exam.created_at)} · {count} 道题 · <span style={{ color: completed ? 'var(--success)' : 'var(--text-secondary)' }}>{score || labels[current]}</span>
        </span>
      </div>
    </div>
    <div className='mt-2 flex min-h-9 items-center justify-between pl-10'>
      {completed ? (
        <>
          <MobileTextAction onClick={() => onOpenExamResult(exam)}>
            查看批改结果<ChevronRight size={13} />
          </MobileTextAction>
          <MobileTextAction onClick={() => onDownloadPdf(exam)} style={{ color: 'var(--text-secondary)' }}>
            <FileDown size={14} />查看题目
          </MobileTextAction>
        </>
      ) : current === 'pending' ? (
        <>
          <MobileTextAction onClick={() => onDownloadPdf(exam)}>
            <FileDown size={14} />查看题目<ChevronRight size={13} />
          </MobileTextAction>
          <MobilePrimaryButton onClick={() => onSubmitExam(exam)} disabled={submitting}>
            {submitting ? <Loader2 size={14} className='animate-spin' /> : <UploadCloud size={14} />} {submitting ? '上传中' : '上传答案'}
          </MobilePrimaryButton>
        </>
      ) : null}
    </div>
  </div>
}

export default function ExamPageV2({ studentExams, submitExamId, submitFileInputRef, onDownloadPdf, onSubmitExam, onSubmitFilesSelected, onOpenExamResult, onOpenWrongBook }) {
  const exams = (Array.isArray(studentExams) ? studentExams : [])
    .slice()
    .sort((a, b) => {
      const rank = stageRank[stage(a)] - stageRank[stage(b)]
      if (rank !== 0) return rank
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    })
  const pendingCount = exams.filter(e => stage(e) === 'pending').length
  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'>
    {!exams.length
      ? <EmptyState icon={FileText} title='还没有重练卷' description='在错题本挑选错题，或一键生成重点重练卷' className='py-16'>
          {onOpenWrongBook && (
            <button
              type='button'
              onClick={onOpenWrongBook}
              className='mt-4 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-transform active:scale-[0.98]'
              style={{ background: 'var(--primary)' }}
            >去错题本挑题</button>
          )}
        </EmptyState>
      : <>
          {pendingCount > 0 && (
            <p className='mb-3 px-1 text-[12px]' style={{ color: 'var(--text-secondary)' }}>
              {pendingCount} 份重练卷等待完成
            </p>
          )}
          <MobileList>
            {exams.map((exam, index) => (
              <PracticeRow
                key={exam.id || index}
                exam={exam}
                onDownloadPdf={onDownloadPdf}
                onSubmitExam={onSubmitExam}
                onOpenExamResult={onOpenExamResult}
                submitting={submitExamId === exam.id}
              />
            ))}
          </MobileList>
        </>}
    <input ref={submitFileInputRef} type='file' accept='image/*' multiple className='hidden' onChange={onSubmitFilesSelected} />
  </motion.div>
}
