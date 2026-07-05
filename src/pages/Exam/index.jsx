import { useEffect, useState } from 'react'
import { Button, Toast, Empty, Badge, SwipeAction, Dialog } from 'antd-mobile'
import { RightOutline } from 'antd-mobile-icons'
import { useStudentStore, useExamStore } from '../../store'
import { getGeneratedExamsByStudent, getQuestionsByIds, deleteGeneratedExam } from '../../services/apiService'
import StudentSwitcher from '../../components/StudentSwitcher'
import ExamReview from '../ExamReview'
import dayjs from 'dayjs'
import { saveAs } from 'file-saver'
import { generateExamPDF } from '../../utils/pdfGenerator'
import { FileText, RefreshCw, User, Printer, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react'

const USE_MOCK_DATA = false

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

const generatePaperId = () => {
  return 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

// Claude-inspired status config
const STATUS_CONFIG = {
  ungraded: { text: '未批改', color: 'var(--warning)', bgColor: 'var(--warning-soft)' },
  graded: { text: '已批改', color: 'var(--success)', bgColor: 'var(--success-soft)' },
  done: { text: '已批改', color: 'var(--success)', bgColor: 'var(--success-soft)' },
  failed: { text: '失败', color: 'var(--danger)', bgColor: 'var(--danger-soft)' },
}

export default function Exam() {
  const { currentStudent } = useStudentStore()
  const { setGeneratedExams, generatedExams } = useExamStore()

  const [activeFilter, setActiveFilter] = useState('all')
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [allExams, setAllExams] = useState([])
  const [showReview, setShowReview] = useState(false)
  const [reviewExam, setReviewExam] = useState(null)

  const loadGeneratedExams = async (forceRefresh = false) => {
    if (!currentStudent) return

    try {
      if (USE_MOCK_DATA) return
      const generatedExamList = await getGeneratedExamsByStudent(currentStudent.id, !forceRefresh)

      const existingIds = new Set(generatedExams.map(e => e.id))
      const dbIds = new Set(generatedExamList.map(e => e.id))
      const localOnly = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id === currentStudent.id && !dbIds.has(e.id))
      const otherStudents = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id !== currentStudent.id)
      setGeneratedExams([...generatedExamList, ...localOnly, ...otherStudents])
    } catch (error) {
      console.error('加载生成试卷失败:', error)
    }
  }

  useEffect(() => {
    if (currentStudent) loadGeneratedExams(true)
  }, [currentStudent?.id])

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadGeneratedExams(true)
    }, 3000)
    return () => clearInterval(interval)
  }, [currentStudent?.id])

  useEffect(() => {
    const generated = generatedExams
      .filter(e => e.student_id === currentStudent?.id)
      .map(e => ({ ...e, source: 'generated' }))
    const sorted = generated.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setAllExams(sorted)
  }, [generatedExams, currentStudent?.id])

  const filteredExams = allExams.filter(exam => {
    if (activeFilter === 'all') return true
    return exam.status === activeFilter
  })

  const getStatusCount = (status) => {
    if (status === 'all') return allExams.length
    return allExams.filter(e => e.status === status).length
  }

  const totalUngradedCount = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.status === 'ungraded').length

  const handleOpenReview = (exam) => {
    setReviewExam(exam)
    setShowReview(true)
  }

  const handleReviewSave = () => loadGeneratedExams(true)

  const handleReviewClose = () => {
    setShowReview(false)
    loadGeneratedExams(true)
    setReviewExam(null)
  }

  const renderStatusTag = (status) => {
    const config = STATUS_CONFIG[status]
    if (!config) return null
    return (
      <span className="inline-flex items-center gap-1" style={{
        color: config.color,
        fontSize: '11px',
        padding: '2px 10px',
        borderRadius: 'var(--radius-full)',
        background: config.bgColor,
        fontWeight: 600
      }}>
        {status === 'done' && <CheckCircle size={10} />}
        {status === 'ungraded' && <Clock size={10} />}
        {config.text}
      </span>
    )
  }

  const handleReprint = async (exam) => {
    const questionIds = exam.question_ids || []
    if (questionIds.length === 0) {
      Toast.show({ icon: 'fail', content: '该试卷暂无题目可打印' })
      return
    }

    let examQuestions = []
    try {
      examQuestions = await getQuestionsByIds(questionIds)
    } catch (error) {
      console.error('获取题目失败:', error)
      Toast.show({ icon: 'fail', content: '获取题目失败' })
      return
    }

    if (examQuestions.length === 0) {
      Toast.show({ icon: 'fail', content: '该试卷暂无题目可打印' })
      return
    }

    const examTitle = exam.name
    const newPaperId = generatePaperId()
    const qrContent = JSON.stringify({
      type: 'grading', studentId: currentStudent?.id, qIds: questionIds, ts: Date.now()
    })

    try {
      const filename = `${currentStudent?.name || 'student'}_${examTitle}_${dayjs().format('YYYYMMDD_HHmm')}`
      const result = await generateExamPDF({
        title: `${currentStudent?.name || '学生'} - ${examTitle}`,
        studentName: currentStudent?.name || '',
        questions: examQuestions,
        filename,
        showAnswers: false,
        qrContent,
      })
      if (result && result.pdfBlob) saveAs(result.pdfBlob, `${filename}.pdf`)
      Toast.show({ icon: 'success', content: 'PDF已生成，请查看下载' })
    } catch (error) {
      console.error('PDF生成失败:', error)
      Toast.show({ icon: 'fail', content: 'PDF生成失败' })
    }
  }

  const handleDelete = (exam) => {
    Dialog.confirm({
      content: '确定删除这份试卷？删除后不可恢复。',
      confirmText: '删除',
      onConfirm: async () => {
        try {
          await deleteGeneratedExam(exam.id)
          Toast.show({ icon: 'success', content: '删除成功' })
          loadGeneratedExams(true)
        } catch (error) {
          console.error('删除试卷失败:', error)
          Toast.show({ icon: 'fail', content: '删除失败' })
        }
      }
    })
  }

  if (!currentStudent) {
    return (
      <div className="flex items-center justify-center py-24" style={{ color: 'var(--text-tertiary)' }}>
        <div className="text-center">
          <User size={36} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <p style={{ fontSize: '14px' }}>请先选择学生</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100%', paddingBottom: '80px' }}>
      {/* Student Info Card */}
      <section className="mx-4 mt-3 mb-2">
        <div className="card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden" style={{ background: 'var(--primary-soft)' }}>
              {currentStudent.avatar ? (
                <img src={currentStudent.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <User size={22} style={{ color: 'var(--primary)' }} />
              )}
            </div>
            <div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
                {currentStudent.name}
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '1px' }}>
                {currentStudent.class || '暂无班级'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowStudentSwitcher(true)}
            className="flex items-center gap-1 text-[13px] font-medium px-3 py-1.5 rounded-xl transition-colors"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
          >
            切换
            <Badge
              content={totalUngradedCount > 0 ? (totalUngradedCount > 9 ? '9+' : String(totalUngradedCount)) : null}
              style={{ '--color': 'var(--primary)', '--background': '#fff', '--padding': '0 6px', '--font-size': '11px' }}
            >
              <RightOutline />
            </Badge>
          </button>
        </div>
      </section>

      {/* Filter Tabs */}
      <section className="px-4 mb-3 overflow-x-auto no-scrollbar">
        <div className="flex gap-2 min-w-max">
          {['all', 'ungraded', 'graded'].map((key) => {
            const count = getStatusCount(key)
            const isActive = activeFilter === key
            return (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                className={`filter-chip ${isActive ? 'active' : 'inactive'}`}
              >
                {key === 'all' ? '全部' : key === 'ungraded' ? '未批改' : '已批改'}
                <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '3px' }}>{count}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Exam List */}
      <section className="px-4 space-y-2.5">
        {filteredExams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
              <FileText size={28} style={{ color: 'var(--text-tertiary)' }} />
            </div>
            <p className="mt-4" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>暂无试卷</p>
            <p className="mt-1" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>上传试卷后将在此处显示</p>
          </div>
        ) : (
          filteredExams.map((exam) => (
            <SwipeAction
              key={exam.id}
              rightActions={[{
                key: 'delete',
                text: '删除',
                color: 'danger',
                onClick: () => handleDelete(exam)
              }]}
            >
              <div
                onClick={() => (exam.status === 'graded' || exam.status === 'done') ? handleOpenReview(exam) : handleReprint(exam)}
                className="card list-card active:scale-[0.99] transition-all"
              >
              <div className="list-card-row items-center">
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--primary-soft)' }}>
                  <FileText size={18} style={{ color: 'var(--primary)' }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-card-title truncate">
                      {exam.name}
                    </p>
                    {exam.status === 'failed' && (
                      <AlertCircle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-meta">{dayjs(exam.created_at).format('MM/DD HH:mm')}</span>
                    <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                    <span className="text-meta-highlight">{exam.question_ids?.length || 0} 题</span>
                    {exam.status !== 'done' && exam.status !== 'graded' && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                        {renderStatusTag(exam.status)}
                      </>
                    )}
                  </div>

                  {/* Grading Results */}
                  {exam.status === 'done' && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="stat-pill" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                        <CheckCircle size={10} />
                        正确 {exam.correct_count || 0}
                      </span>
                      <span className="stat-pill" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                        <XCircle size={10} />
                        错误 {exam.wrong_count || 0}
                      </span>
                      {exam.not_answered_count > 0 && (
                        <span className="stat-pill" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                          <AlertCircle size={10} />
                          未作答 {exam.not_answered_count}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Right side actions */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {exam.status === 'done' && renderStatusTag(exam.status)}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReprint(exam) }}
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-colors tap-scale"
                    style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                  >
                    <Printer size={11} />
                    {isMobile ? 'PDF' : 'PDF'}
                  </button>
                </div>
              </div>
            </SwipeAction>
          ))
        )}
      </section>

      {/* Student Switcher */}
      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        badgeType="grading"
      />

      {/* Exam Review Modal */}
      {showReview && reviewExam && (
        <ExamReview
          task={reviewExam}
          onClose={handleReviewClose}
          onSave={handleReviewSave}
        />
      )}
    </div>
  )
}