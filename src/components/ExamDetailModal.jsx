import { AlertCircle, Camera, CheckCircle2, ClipboardCheck, Clock, FileCheck2, FileDown, Loader2 } from 'lucide-react'
import dayjs from 'dayjs'
import BottomSheet from './BottomSheet'
import { RETRY_EXAM_STAGE, RETRY_EXAM_STAGE_HINT, RETRY_EXAM_STAGE_TEXT, RETRY_EXAM_STAGE_TONE, canSubmitAnswerSheet, isResultStage, resolveRetryExamScore, resolveRetryExamStage } from '../domain/retryExamStage'

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

const total = e => e.question_ids?.length || e.total_count || 0
const time = v => dayjs(v).isValid() ? dayjs(v).format('YYYY/MM/DD HH:mm') : '最近创建'

// 重练卷详情：档案动作集中在这里（上传答卷、查看/打印、删除）。
// 主入口=本页"上传答卷"（选中这份卷即定位 examId，多页天然归一）；首页扫码上传为辅助路径。
//
// 状态口径与列表页同源（src/domain/retryExamStage.js）：等待作答 / 已提交答卷 /
// 正在批改 / 等待复核，已出结果时直接给结果数字。上传答卷入口只在「等待作答」和
// 「批改出错」两档出现，避免重复交卷。
//
// 2026-09-14：删掉「查看批改结果」二级入口 —— 移动端只需要知道结果数字（本页已有），
// 逐题明细归错题本、改判归 PC 复核台；且重练答卷不建 questions 行，按 task_id 必然取空。
export default function ExamDetailModal({ exam, onClose, onReprint, onDelete, onUploadAnswer }) {
  const stage = resolveRetryExamStage(exam)
  const settled = isResultStage(stage)
  const canSubmit = canSubmitAnswerSheet(stage)
  const tone = TONE_STYLE[RETRY_EXAM_STAGE_TONE[stage]] || TONE_STYLE.neutral
  const Icon = STAGE_ICON[stage] || ClipboardCheck
  const hint = RETRY_EXAM_STAGE_HINT[stage]
  const count = total(exam)
  const score = settled ? resolveRetryExamScore(exam) : null

  return <BottomSheet title='组卷详情' onClose={onClose}>
    <div className='flex items-start gap-3'>
          <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl' style={{ background: tone.bg, color: tone.fg }}>
            <Icon size={18} className={stage === RETRY_EXAM_STAGE.GRADING ? 'animate-spin' : ''} />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='truncate text-[15px] font-semibold' style={{ color: 'var(--text)' }}>{exam.name || '重练卷'}</p>
            <p className='mt-0.5 text-[12px]' style={{ color: 'var(--text-secondary)' }}>
              {time(exam.created_at)} · {count} 道题
            </p>
            <p className='mt-1 text-[13px] font-medium' style={{ color: score?.allCorrect ? 'var(--success)' : settled ? 'var(--text)' : tone.fg }}>
              {score?.text || RETRY_EXAM_STAGE_TEXT[stage]}
            </p>
          </div>
        </div>

        {canSubmit && (
          <div className='mt-5 space-y-2.5'>
            <button
              type='button'
              onClick={() => onUploadAnswer(exam)}
              className='flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.98]'
              style={{ background: 'var(--primary)' }}
            >
              <Camera size={16} />{stage === RETRY_EXAM_STAGE.FAILED ? '重新上传答卷' : '上传答卷'}
            </button>
            <p className='text-center text-[11px] leading-4' style={{ color: 'var(--text-tertiary)' }}>
              拍整份做完的卷子，多页一起传，系统按这份卷批改并更新掌握度
            </p>
          </div>
        )}
        {!canSubmit && !settled && hint && (
          <div className='mt-4 flex items-center gap-2 rounded-2xl px-3.5 py-3' style={{ background: tone.bg }}>
            <Icon size={15} className={stage === RETRY_EXAM_STAGE.GRADING ? 'animate-spin' : ''} style={{ color: tone.fg }} />
            <p className='text-[12px]' style={{ color: 'var(--text-secondary)' }}>{hint}</p>
          </div>
        )}

        <div className='mt-5 space-y-2.5'>
          <button
            type='button'
            onClick={() => onReprint(exam)}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition-transform active:scale-[0.98] ${settled ? 'text-white' : ''}`}
            style={settled
              ? { background: 'var(--primary)' }
              : { background: 'var(--bg-secondary)', color: 'var(--text)' }}
          >
            <FileDown size={16} />查看 / 打印试卷
          </button>
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
