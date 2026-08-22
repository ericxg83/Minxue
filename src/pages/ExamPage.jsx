import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronRight, ClipboardCheck, FileDown, FileText, Loader2, UploadCloud } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import SwipeableRow from '../components/SwipeableRow'
import EmptyState from '../components/EmptyState'
import { MobilePageHeader, MobileStatGrid, MobileSegmentedTabs, MobileList } from '../features/mobile/MobilePrimitives'

const getTotalQuestions = (exam) => exam.question_ids?.length || exam.total_count || 0

const getExamStage = (exam) => {
  if (exam.status === 'graded') return 'completed'
  if (exam.status === 'submitted' || exam.status === 'grading') return 'in_progress'
  return 'pending'
}

const stageConfig = {
  pending: { label: '待学生完成', color: 'var(--warning)', background: 'var(--warning-soft)', icon: ClipboardCheck },
  in_progress: { label: '批改中', color: 'var(--primary)', background: 'var(--primary-soft)', icon: Loader2 },
  completed: { label: '已完成', color: 'var(--success)', background: 'var(--success-soft)', icon: CheckCircle2 },
}

function SummaryItem({ value, label, tone = 'var(--text)' }) {
  return <div className="px-3 py-3"><p className="text-[20px] font-semibold leading-none" style={{ color: tone }}>{value}</p><p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</p></div>
}

export default function ExamPage({
  studentExams,
  submitExamId,
  submitFileInputRef,
  onDeleteExam,
  onDownloadPdf,
  onSubmitExam,
  onSubmitFilesSelected,
}) {
  const [filter, setFilter] = useState('pending')
  const exams = Array.isArray(studentExams) ? studentExams : []
  const pendingExams = exams.filter((exam) => getExamStage(exam) === 'pending')
  const inProgressExams = exams.filter((exam) => getExamStage(exam) === 'in_progress')
  const completedExams = exams.filter((exam) => getExamStage(exam) === 'completed')
  const visibleExams = useMemo(() => {
    if (filter === 'pending') return pendingExams
    if (filter === 'in_progress') return inProgressExams
    if (filter === 'completed') return completedExams
    return exams
  }, [completedExams, exams, filter, inProgressExams, pendingExams])
  const totalQuestions = exams.reduce((total, exam) => total + getTotalQuestions(exam), 0)

  return (
    <motion.div key="retry-page" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="mobile-page mx-auto w-full max-w-lg px-4 pb-4 pt-4">
      <header className="mb-5 flex items-end justify-between"><div><p className="mb-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{'\u91cd\u7ec3\u5377'}</p><h1 className="text-[24px] font-semibold tracking-[-0.04em]" style={{ color: 'var(--text)' }}>{exams.length} {'\u4efd\u7ec3\u4e60\u5377'}</h1></div><span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{pendingExams.length ? `${pendingExams.length} \u4efd\u5f85\u5b8c\u6210` : '\u6682\u65e0\u5f85\u5b8c\u6210'}</span></header>
      <div className="mb-4 flex gap-5 border-b" style={{ borderColor: 'var(--border-light)' }}>{[{ id: 'pending', label: '\u5f85\u5b8c\u6210', count: pendingExams.length }, { id: 'in_progress', label: '\u5904\u7406\u4e2d', count: inProgressExams.length }, { id: 'completed', label: '\u5df2\u5b8c\u6210', count: completedExams.length }].map((tab) => <button key={tab.id} type="button" onClick={() => setFilter(tab.id)} className="relative pb-2.5 text-[13px] font-medium" style={{ color: filter === tab.id ? 'var(--primary)' : 'var(--text-secondary)' }}>{tab.label} <span className="ml-0.5 text-[11px]">{tab.count}</span>{filter === tab.id && <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: 'var(--primary)' }} />}</button>)}</div>
      {exams.length === 0 ? <EmptyState icon={FileText} title="还没有重练卷" description="在错题本选择题目后，可以快速安排一次重练" className="rounded-2xl border py-16" /> : visibleExams.length === 0 ? <EmptyState icon={ClipboardCheck} title="这里还没有记录" description="切换其他状态查看重练卷" className="rounded-2xl border py-12" /> : <MobileList>{visibleExams.map((exam, index) => { const stage = getExamStage(exam); const config = stageConfig[stage]; const StatusIcon = config.icon; const total = getTotalQuestions(exam); const isSubmitting = submitExamId === exam.id; const isCompleted = stage === 'completed'; const score = isCompleted && total ? `${exam.correct_count || 0}/${total} 题正确` : null; return <SwipeableRow key={exam.id || index} onDelete={() => onDeleteExam(exam.id)}><motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="border-b px-4 py-4 last:border-b-0" style={{ borderColor: 'var(--border-light)' }}><div className="flex items-start gap-3"><div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: config.background, color: config.color }}><StatusIcon size={17} className={stage === 'in_progress' ? 'animate-spin' : ''} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{exam.name || '错题重练'}</h3><span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: config.background, color: config.color }}>{config.label}</span></div><p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{dayjs(exam.created_at).isValid() ? dayjs(exam.created_at).format('MM/DD HH:mm') : '最近创建'} · {total} 道题</p>{score ? <p className="mt-2 text-[13px] font-medium" style={{ color: 'var(--success)' }}>{score} · 可以查看仍需关注的题目</p> : <p className="mt-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{stage === 'pending' ? '学生完成后上传答案' : '系统正在整理本次结果'}</p>}</div></div><div className="mt-3 flex items-center justify-end gap-2"><button type="button" onClick={() => onDownloadPdf(exam)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium" style={{ background: 'var(--bg-secondary)', color: 'var(--primary)' }}><FileDown size={14} />查看题目</button><button type="button" onClick={() => onSubmitExam(exam)} disabled={isSubmitting || isCompleted} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: isCompleted ? 'var(--bg-secondary)' : isSubmitting ? 'var(--accent-soft)' : 'var(--primary)', color: isCompleted ? 'var(--text-tertiary)' : isSubmitting ? 'var(--accent)' : '#fff' }}>{isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}{isCompleted ? '已完成' : isSubmitting ? '上传中' : '上传答案'}</button><ChevronRight size={15} className="hidden sm:block" style={{ color: 'var(--text-tertiary)' }} /></div></motion.div></SwipeableRow> })}</MobileList>}


      <input ref={submitFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onSubmitFilesSelected} />
    </motion.div>
  )
}
