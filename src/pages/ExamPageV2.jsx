import { useState } from 'react'
import { CheckCircle2, ChevronRight, ClipboardCheck, FileDown, FileText, Loader2, UploadCloud } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import { MobileList, MobileSegmentedTabs } from '../features/mobile/MobilePrimitives'

const stage = (exam) => exam.status === 'graded' ? 'completed' : ['submitted', 'grading'].includes(exam.status) ? 'in_progress' : 'pending'
const labels = { pending: '待完成', in_progress: '正在整理结果', completed: '已完成' }
const total = (exam) => exam.question_ids?.length || exam.total_count || 0

function PracticeRow({ exam, onDownloadPdf, onSubmitExam, submitting }) {
  const current = stage(exam)
  const count = total(exam)
  const completed = current === 'completed'
  const score = completed && count ? `${exam.correct_count || 0}/${count} 题正确` : null
  return <div className='border-b px-0.5 py-4 last:border-b-0' style={{ borderColor: 'var(--border-light)' }}><div className='flex items-start gap-3'><span className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full' style={{ background: completed ? 'var(--success-soft)' : 'var(--primary-soft)', color: completed ? 'var(--success)' : 'var(--primary)' }}>{current === 'in_progress' ? <Loader2 size={16} className='animate-spin' /> : completed ? <CheckCircle2 size={16} /> : <ClipboardCheck size={16} />}</span><div className='min-w-0 flex-1'><span className='block truncate text-[14px] font-semibold' style={{ color: 'var(--text)' }}>{exam.name || '错题重练'}</span><span className='mt-1 block text-[12px]' style={{ color: 'var(--text-secondary)' }}>{dayjs(exam.created_at).isValid() ? dayjs(exam.created_at).format('MM/DD HH:mm') : '最近创建'} · {count} 道题</span><span className='mt-2 block text-[12px] font-medium' style={{ color: completed ? 'var(--success)' : 'var(--text-secondary)' }}>{score || labels[current]}</span></div></div><div className='mt-3 flex items-center justify-end gap-3'><button type='button' onClick={() => onDownloadPdf(exam)} className='inline-flex items-center gap-1.5 text-[12px] font-medium' style={{ color: 'var(--primary)' }}><FileDown size={14} />查看题目</button>{!completed && <button type='button' onClick={() => onSubmitExam(exam)} disabled={submitting || current === 'in_progress'} className='inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white' style={{ background: 'var(--primary)' }}>{submitting ? <Loader2 size={14} className='animate-spin' /> : <UploadCloud size={14} />}{submitting ? '上传中' : '上传答案'}</button>}{completed && <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />}</div></div>
}

export default function ExamPageV2({ studentExams, submitExamId, submitFileInputRef, onDownloadPdf, onSubmitExam, onSubmitFilesSelected }) {
  const exams = Array.isArray(studentExams) ? studentExams : []
  const groups = { pending: exams.filter((exam) => stage(exam) === 'pending'), in_progress: exams.filter((exam) => stage(exam) === 'in_progress'), completed: exams.filter((exam) => stage(exam) === 'completed') }
  const [filter, setFilter] = useState('pending')
  const visible = groups[filter] || []
  const tabs = [{ id: 'pending', label: '待完成', count: groups.pending.length }, { id: 'in_progress', label: '处理中', count: groups.in_progress.length }, { id: 'completed', label: '已完成', count: groups.completed.length }]
  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'><header className='mb-6'><p className='mb-1 text-[12px] font-medium' style={{ color: 'var(--text-secondary)' }}>用练习确认掌握情况</p><h1 className='text-[24px] font-semibold tracking-[-0.04em]' style={{ color: 'var(--text)' }}>重练</h1><p className='mt-1.5 text-[13px]' style={{ color: 'var(--text-secondary)' }}>{groups.pending.length ? `${groups.pending.length} 份练习等待完成` : '从错题本开始一次重练'}</p></header><MobileSegmentedTabs items={tabs} value={filter} onChange={setFilter} ariaLabel='重练状态' />{!exams.length ? <EmptyState icon={FileText} title='还没有重练记录' description='在错题本选择题目后，可以开始一次重练' className='py-16' /> : !visible.length ? <EmptyState icon={ClipboardCheck} title='这里还没有记录' description='切换其他状态查看重练' className='py-12' /> : <MobileList>{visible.map((exam, index) => <PracticeRow key={exam.id || index} exam={exam} onDownloadPdf={onDownloadPdf} onSubmitExam={onSubmitExam} submitting={submitExamId === exam.id} />)}</MobileList>}<input ref={submitFileInputRef} type='file' accept='image/*' multiple className='hidden' onChange={onSubmitFilesSelected} /></motion.div>
}
