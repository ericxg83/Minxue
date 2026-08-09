import { FileText, Upload, Loader2 } from 'lucide-react'
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
  return (
    <motion.div
      key="exam-page"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="w-full"
    >
      {/* Page Title */}
      <section className="px-4 pt-3 mb-2">
        <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 700, color: 'var(--text)' }}>组卷历史</h2>
        <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', marginTop: '1px' }}>
          共 {studentExams.length} 份试卷
        </p>
      </section>

      {/* Exam List */}
      <section className="px-4 space-y-2">
        {studentExams.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="暂无组卷历史"
            description={'在错题本选择题目后点击"生成试卷"'}
            className="py-16"
          />
        ) : (
          studentExams.map((exam) => (
            <SwipeableRow
              key={exam.id}
              onDelete={() => onDeleteExam(exam.id)}
            >
            <motion.div
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="card"
              style={{ padding: '12px' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: 'var(--text)' }} className="truncate">{exam.name}</h3>
                  <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {dayjs(exam.created_at).format('YYYY/MM/DD HH:mm')}
                  </p>
                  <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', marginTop: '1px' }}>
                    共 {exam.question_ids?.length || 0} 道题
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="badge" style={{ background: exam.printed ? 'var(--success-soft)' : 'var(--warning-soft)', color: exam.printed ? 'var(--success)' : 'var(--warning)' }}>
                    {exam.printed ? '已打印' : '未打印'}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onDownloadPdf(exam)}
                      className="px-2 py-1 rounded-lg"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--primary-hover)' }}
                      title="下载PDF"
                    >
                      <FileText size={12} />
                    </button>
                    <button
                      onClick={() => onSubmitExam(exam)}
                      disabled={submitExamId === exam.id}
                      className="px-2 py-1 rounded-lg"
                      style={{ background: submitExamId === exam.id ? '#EDE9FE' : 'var(--bg-secondary)', color: '#7C3AED' }}
                      title="提交作业"
                    >
                      {submitExamId === exam.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
            </SwipeableRow>
          ))
        )}
      </section>

      {/* 提交作业隐藏文件输入（拍照/相册，多张） */}
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
