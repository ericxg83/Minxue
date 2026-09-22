import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight, ClipboardCheck, Clock, FileCheck2, FileText, Loader2, Search } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import ExamDetailModal from '../components/ExamDetailModal'
import SwipeableRow from '../components/SwipeableRow'
import { MobileList, MobileSegmentedTabs, MobileTextAction } from '../features/mobile/MobilePrimitives'
import { RETRY_EXAM_STAGE, RETRY_EXAM_STAGE_TEXT, RETRY_EXAM_STAGE_TONE, isResultStage, resolveRetryExamScore, resolveRetryExamStage } from '../domain/retryExamStage'

// 阶段 → 图标。状态判定与文案在 src/domain/retryExamStage.js，这里只做视觉映射。
const STAGE_ICON = {
  [RETRY_EXAM_STAGE.ISSUED]: ClipboardCheck,
  [RETRY_EXAM_STAGE.SUBMITTED]: FileCheck2,
  [RETRY_EXAM_STAGE.GRADING]: Loader2,
  [RETRY_EXAM_STAGE.FAILED]: AlertCircle,
  [RETRY_EXAM_STAGE.PENDING_REVIEW]: Clock,
  [RETRY_EXAM_STAGE.RESULT]: CheckCircle2,
}

const TONE_STYLE = {
  neutral: { bg: 'var(--bg-secondary)', fg: 'var(--text-secondary)' },
  primary: { bg: 'var(--primary-soft)', fg: 'var(--primary)' },
  warning: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
  success: { bg: 'var(--success-soft)', fg: 'var(--success)' },
}

const filterMatch = {
  all: () => true,
  active: e => !isResultStage(resolveRetryExamStage(e)),
  done: e => isResultStage(resolveRetryExamStage(e)),
}
const total = e => e.question_ids?.length || e.total_count || 0
const time = v => dayjs(v).isValid() ? dayjs(v).format('MM/DD HH:mm') : '最近创建'

// 组卷历史 = 档案页：一行即一份卷，整行点击打开卷详情（上传答卷、查看/打印、删除）。
// 上传答卷在详情页发起（选中这份卷=定位 examId，多页天然归一）；待办催办提醒仍归首页。
//
// 行内状态文案（2026-09-14 定稿）：等待作答 / 已提交答卷 / 正在批改 / 等待复核；
// 已出结果时直接显示结果数字（`11 正确 · 5 错误`），不再叠一句状态词、也不再有第二层入口。
function ExamRow({ exam, onOpen }) {
  const stage = resolveRetryExamStage(exam)
  const settled = isResultStage(stage)
  const tone = TONE_STYLE[RETRY_EXAM_STAGE_TONE[stage]] || TONE_STYLE.neutral
  const Icon = STAGE_ICON[stage] || ClipboardCheck
  const count = total(exam)
  const score = settled ? resolveRetryExamScore(exam) : null
  return <button
    type='button'
    onClick={() => onOpen(exam)}
    className='flex w-full items-start gap-2.5 border-b px-0.5 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]'
    style={{ borderColor: 'var(--border-light)' }}
  >
    <span className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg' style={{ background: tone.bg, color: tone.fg }}>
      <Icon size={16} className={stage === RETRY_EXAM_STAGE.GRADING ? 'animate-spin' : ''} />
    </span>
    <span className='min-w-0 flex-1'>
      <span className='block truncate text-[14px] font-semibold' style={{ color: 'var(--text)' }}>{exam.name || '重练卷'}</span>
      <span className='mt-0.5 block text-[12px]' style={{ color: 'var(--text-secondary)' }}>
        {time(exam.created_at)} · {count} 道题 · <span style={{ color: score?.allCorrect ? 'var(--success)' : settled ? 'var(--text)' : tone.fg }}>{score?.text || RETRY_EXAM_STAGE_TEXT[stage]}</span>
      </span>
    </span>
    <ChevronRight size={15} className='mt-1' style={{ color: 'var(--text-tertiary)' }} />
  </button>
}

export default function ExamPageV2({ studentExams, onReprint, onDelete, onOpenWrongBook, onUploadAnswer }) {
  const [detailExam, setDetailExam] = useState(null)
  const [filter, setFilter] = useState('all')
  const exams = (Array.isArray(studentExams) ? studentExams : [])
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  const tabs = [
    { id: 'all', label: '全部', count: exams.length },
    { id: 'active', label: '进行中', count: exams.filter(e => !isResultStage(resolveRetryExamStage(e))).length },
    { id: 'done', label: '已出结果', count: exams.filter(e => isResultStage(resolveRetryExamStage(e))).length },
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
        <MobileSegmentedTabs items={tabs} value={filter} onChange={setFilter} ariaLabel='试卷状态' />
        {!visible.length
          ? <EmptyState icon={filter === 'done' ? CheckCircle2 : Search} className='py-16'
              title={filter === 'done' ? '还没有出结果的试卷' : '没有进行中的试卷'}
              description={filter === 'done' ? '老师复核完成后会显示在这里' : '所有试卷都已出结果'}>
            <MobileTextAction className='mt-3' onClick={() => setFilter('all')}>查看全部试卷</MobileTextAction>
          </EmptyState>
          : <MobileList>
              {visible.map((exam, index) => (
                <SwipeableRow
                  key={exam.id || index}
                  radius='0'
                  onDelete={onDelete ? () => onDelete(exam) : undefined}
                >
                  <ExamRow exam={exam} onOpen={setDetailExam} />
                </SwipeableRow>
              ))}
            </MobileList>}
      </>}
    {detailExam && (
      <ExamDetailModal
        exam={detailExam}
        onClose={() => setDetailExam(null)}
        onReprint={(exam) => { setDetailExam(null); onReprint(exam) }}
        onDelete={(exam) => { setDetailExam(null); onDelete(exam) }}
        onUploadAnswer={(exam) => { setDetailExam(null); onUploadAnswer?.(exam) }}
      />
    )}
  </motion.div>
}
