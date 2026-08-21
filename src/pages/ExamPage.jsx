import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, FileDown, FileText, Loader2, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import SwipeableRow from '../components/SwipeableRow'
import EmptyState from '../components/EmptyState'

export default function ExamPage({
  studentExams,
  submitExamId,
  submitFileInputRef,
  onDeleteExam,
  onDownloadPdf,
  onSubmitExam,
  onSubmitFilesSelected
}) {
  const [filter, setFilter] = useState('all')
  const exams = Array.isArray(studentExams) ? studentExams : []
  const gradedCount = exams.filter((exam) => exam.status === 'graded').length
  const questionCount = exams.reduce((total, exam) => total + (exam.question_ids?.length || exam.total_count || 0), 0)
  const visibleExams = useMemo(() => {
    if (filter === 'graded') return exams.filter((exam) => exam.status === 'graded')
    if (filter === 'pending') return exams.filter((exam) => exam.status !== 'graded')
    return exams
  }, [exams, filter])

  const getExamStatus = (exam) => exam.status === 'graded'
    ? { label: '已批改', color: 'var(--success)', background: 'var(--success-soft)', icon: CheckCircle2 }
    : { label: '待提交', color: 'var(--warning)', background: 'var(--warning-soft)', icon: ClipboardList }

  const getScoreSummary = (exam) => {
    const total = exam.total_count || exam.question_ids?.length || 0
    if (exam.status !== 'graded' || !total) return null
    return `${exam.correct_count || 0}/${total} 题正确`
  }

  return (
    <motion.div
      key="exam-page"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="w-full"
    >
      <section className="px-4 pt-4 mb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 style={{ fontSize: 'var(--fs-20)', fontWeight: 750, color: 'var(--text)', letterSpacing: '-0.02em' }}>组卷历史</h2>
            <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', marginTop: '3px' }}>
              查看试卷、提交答卷并追踪批改结果
            </p>
          </div>
          <div className="flex items-center justify-center rounded-2xl" style={{ width: 44, height: 44, background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <FileText size={21} strokeWidth={2.2} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            { label: '试卷', value: exams.length },
            { label: '题目', value: questionCount },
            { label: '已批改', value: gradedCount },
          ].map((item) => (
            <div key={item.label} className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-secondary)' }}>
              <p style={{ fontSize: 'var(--fs-18)', lineHeight: 1.1, fontWeight: 750, color: 'var(--text)' }}>{item.value}</p>
              <p style={{ fontSize: 'var(--fs-10)', color: 'var(--text-secondary)', marginTop: 4 }}>{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pb-4">
        {exams.length > 0 && (
          <div className="flex gap-1.5 mb-3 p-1 rounded-xl" style={{ background: 'var(--bg-secondary)' }} role="tablist" aria-label="组卷历史筛选">
            {[
              { key: 'all', label: '全部' },
              { key: 'pending', label: '待提交' },
              { key: 'graded', label: '已批改' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                onClick={() => setFilter(item.key)}
                className="flex-1 rounded-lg py-1.5 transition-all active:scale-95"
                style={{
                  border: 0,
                  background: filter === item.key ? 'var(--bg)' : 'transparent',
                  color: filter === item.key ? 'var(--text)' : 'var(--text-secondary)',
                  boxShadow: filter === item.key ? '0 1px 4px rgba(31, 35, 41, 0.08)' : 'none',
                  fontSize: 'var(--fs-11)',
                  fontWeight: filter === item.key ? 650 : 500,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {exams.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="暂无组卷历史"
            description={'在错题本选择题目后点击"生成试卷"'}
            className="py-16"
          />
        ) : visibleExams.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="暂无符合条件的试卷"
            description="可以切换上方筛选条件查看全部"
            className="py-12"
          />
        ) : (
          <div className="space-y-2.5">
            {visibleExams.map((exam) => {
              const status = getExamStatus(exam)
              const StatusIcon = status.icon
              const scoreSummary = getScoreSummary(exam)
              const totalQuestions = exam.question_ids?.length || exam.total_count || 0
              return (
                <SwipeableRow key={exam.id} onDelete={() => onDeleteExam(exam.id)}>
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    data-exam-id={exam.id}
                    data-exam-card="true"
                    className="card"
                    style={{ padding: '14px' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 style={{ fontSize: 'var(--fs-14)', fontWeight: 650, color: 'var(--text)' }} className="truncate">{exam.name}</h3>
                          <span className="badge flex-shrink-0" style={{ background: status.background, color: status.color, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <StatusIcon size={11} strokeWidth={2.5} />
                            {status.label}
                          </span>
                        </div>
                        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', marginTop: '5px' }}>
                          {dayjs(exam.created_at).format('YYYY/MM/DD HH:mm')}
                        </p>
                        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          共 {totalQuestions} 道题{scoreSummary ? ` · ${scoreSummary}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => onDownloadPdf(exam)}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--primary-hover)', fontSize: 'var(--fs-10)', fontWeight: 600 }}
                          aria-label="下载 PDF"
                        >
                          <FileDown size={13} />
                          下载
                        </button>
                        <button
                          type="button"
                          onClick={() => onSubmitExam(exam)}
                          disabled={submitExamId === exam.id}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
                          style={{ background: submitExamId === exam.id ? '#EDE9FE' : 'var(--bg-secondary)', color: '#7C3AED', fontSize: 'var(--fs-10)', fontWeight: 600 }}
                          aria-label="提交答卷"
                        >
                          {submitExamId === exam.id ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                          提交
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </SwipeableRow>
              )
            })}
          </div>
        )}
      </section>

      <input
        ref={submitFileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={onSubmitFilesSelected}
      />
    </motion.div>
  )
}
