import { useState } from 'react'
import { CheckCircle2, ChevronRight, ClipboardCheck, FileText, Loader2, Search } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import ExamDetailModal from '../components/ExamDetailModal'
import { MobileList, MobileSegmentedTabs, MobileTextAction } from '../features/mobile/MobilePrimitives'

const stage = e => e.status === 'graded' ? 'completed' : ['submitted', 'grading'].includes(e.status) ? 'in_progress' : 'pending'
const labels = { pending: '待完成', in_progress: '正在整理结果', completed: '已完成' }
const filterMatch = {
  all: () => true,
  pending: e => stage(e) !== 'completed',
  completed: e => stage(e) === 'completed',
}
const total = e => e.question_ids?.length || e.total_count || 0
const time = v => dayjs(v).isValid() ? dayjs(v).format('MM/DD HH:mm') : '最近创建'

// 组卷历史 = 档案页：一行即一份卷，整行点击打开卷详情（查看/打印、删除、看批改结果）。
// 不在此页上传答卷、不做状态置顶催办——上传唯一入口在首页，待办提醒归首页。
function ExamRow({ exam, onOpen }) {
  const current = stage(exam)
  const completed = current === 'completed'
  const count = total(exam)
  const score = completed && count ? `${exam.correct_count || 0}/${count} 题正确` : null
  const Icon = current === 'in_progress' ? Loader2 : completed ? CheckCircle2 : ClipboardCheck
  return <button
    type='button'
    onClick={() => onOpen(exam)}
    className='flex w-full items-start gap-2.5 border-b px-0.5 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]'
    style={{ borderColor: 'var(--border-light)' }}
  >
    <span className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg' style={{ background: completed ? 'var(--success-soft)' : 'var(--primary-soft)', color: completed ? 'var(--success)' : 'var(--primary)' }}>
      <Icon size={16} className={current === 'in_progress' ? 'animate-spin' : ''} />
    </span>
    <span className='min-w-0 flex-1'>
      <span className='block truncate text-[14px] font-semibold' style={{ color: 'var(--text)' }}>{exam.name || '重练卷'}</span>
      <span className='mt-0.5 block text-[12px]' style={{ color: 'var(--text-secondary)' }}>
        {time(exam.created_at)} · {count} 道题 · <span style={{ color: completed ? 'var(--success)' : 'var(--text-secondary)' }}>{score || labels[current]}</span>
      </span>
    </span>
    <ChevronRight size={15} className='mt-1' style={{ color: 'var(--text-tertiary)' }} />
  </button>
}

export default function ExamPageV2({ studentExams, onReprint, onDelete, onOpenResult, onOpenWrongBook }) {
  const [detailExam, setDetailExam] = useState(null)
  const [filter, setFilter] = useState('all')
  const exams = (Array.isArray(studentExams) ? studentExams : [])
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  const tabs = [
    { id: 'all', label: '全部', count: exams.length },
    { id: 'pending', label: '待完成', count: exams.filter(e => stage(e) !== 'completed').length },
    { id: 'completed', label: '已完成', count: exams.filter(e => stage(e) === 'completed').length },
  ]
  const visible = exams.filter(filterMatch[filter])
  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mx-auto w-full max-w-lg px-4 pb-6 pt-5'>
    {!exams.length
      ? <EmptyState icon={FileText} title='还没有组卷记录' description='在错题本挑选错题，或一键生成重点重练卷' className='py-16'>
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
        <MobileSegmentedTabs items={tabs} value={filter} onChange={setFilter} ariaLabel='组卷完成状态' />
        {!visible.length
          ? <EmptyState icon={filter === 'completed' ? CheckCircle2 : Search} className='py-16'
              title={filter === 'completed' ? '还没有已完成的试卷' : '没有待完成的试卷'}
              description={filter === 'completed' ? '重练卷批改完成后会显示在这里' : '所有试卷都已批改完成'}>
            <MobileTextAction className='mt-3' onClick={() => setFilter('all')}>查看全部试卷</MobileTextAction>
          </EmptyState>
          : <MobileList>
              {visible.map((exam, index) => (
                <ExamRow key={exam.id || index} exam={exam} onOpen={setDetailExam} />
              ))}
            </MobileList>}
      </>}
    {detailExam && (
      <ExamDetailModal
        exam={detailExam}
        onClose={() => setDetailExam(null)}
        onReprint={(exam) => { setDetailExam(null); onReprint(exam) }}
        onDelete={(exam) => { setDetailExam(null); onDelete(exam) }}
        onOpenResult={(exam) => { setDetailExam(null); onOpenResult(exam) }}
      />
    )}
  </motion.div>
}
