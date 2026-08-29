import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Loader2, Trash2, ChevronUp, ChevronDown, Image as ImageIcon,
  AlertTriangle, Clock, Pencil
} from 'lucide-react'
import MathText from '../../components/MathText'
import BottomSheet from '../../components/BottomSheet'
import { COLORS } from './constants'
import { formatOption, getStatusInfo, DOT_COLORS } from './status'
import { useExamReview } from '../../hooks/useExamReview'
import { normalizeOptions } from '../../utils/optionText'
import { REVIEW_STATUS, getReviewState, getReviewStateLabel, getUnjudgedReasonText } from '../../utils/reviewDecision'

// 需要老师人工介入的状态（与 PC 端 needsAttentionCount 同口径）
const ATTENTION_SOURCES = ['uncertain', 'error', 'processing']

// 答案超过这个字符数就不再挤两列：136px 的列宽塞长答案比整宽单列更费高度
const ANSWER_STACK_THRESHOLD = 14

// 编辑态是否值得显示渲染预览（纯数字/字母不需要）
const hasMathMarkup = (s) => /[\\^_${}]/.test(String(s || ''))

// AI 判定小标签：只表达 AI 的原始结论；人工结论由页脚判定按钮的选中态表达，不再单独占一行
function AiJudgeTag({ Icon, text, color, note }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <Icon size={12} style={{ color }} />
      <span style={{ fontSize: 'var(--fs-11)', fontWeight: 600, color }}>{text}</span>
      {note && <span style={{ fontSize: 'var(--fs-10)', color: 'var(--text-tertiary)' }}>· {note}</span>}
    </span>
  )
}

// 复核范围下拉：原先是一整行 6 个统计 chip（其中三个常年为 0）占掉 34px 首屏高度，
// 收进标题行后只剩一个按钮，且零值范围直接不列出。
function RangeMenu({ options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.key === value) || options[0]

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!current) return null

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          height: 26, padding: '0 8px', borderRadius: 'var(--radius-full)',
          border: `1px solid ${COLORS.border}`, background: COLORS.card, cursor: 'pointer',
          fontSize: 'var(--fs-12)', fontWeight: 600, color: COLORS.text, whiteSpace: 'nowrap'
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: current.dot, flexShrink: 0 }} />
        {current.label} {current.count}
        <ChevronDown size={12} style={{ color: 'var(--text-tertiary)' }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
          <div
            role="listbox"
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 2,
              minWidth: 150, padding: 4, background: COLORS.card,
              border: `1px solid ${COLORS.border}`, borderRadius: 'var(--radius-8)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            }}
          >
            {options.map(o => (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={o.key === value}
                onClick={() => { setOpen(false); onChange(o.key) }}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', gap: 6,
                  padding: '7px 8px', border: 'none', borderRadius: 'var(--radius-6)',
                  background: o.key === value ? 'var(--primary-soft)' : 'transparent',
                  color: o.key === value ? COLORS.primary : COLORS.text,
                  fontSize: 'var(--fs-13)', fontWeight: o.key === value ? 600 : 500,
                  cursor: 'pointer', textAlign: 'left'
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: o.dot, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{o.label}</span>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-tertiary)' }}>{o.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// 答案对比的单列：默认纯文本展示，不是常驻输入框。
// 学生答案那一列的主点击是"看原卷"——复核最常做的动作是核对 AI 抄的字对不对，
// 改字是次要动作，所以改字收进旁边的铅笔按钮。参考答案没有原卷可对，整格即编辑。
function AnswerCell({
  label, value, placeholder, warn, editing,
  onStartEdit, onChange, onDone, onViewPaper
}) {
  const textStyle = {
    fontSize: 'var(--fs-16)', fontWeight: 600, lineHeight: 1.45,
    color: warn ? 'var(--warning)' : (value ? COLORS.text : 'var(--text-tertiary)'),
    overflowWrap: 'anywhere', textAlign: 'left'
  }

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2,
        fontSize: 'var(--fs-11)', color: COLORS.textSecondary
      }}>
        {label}
        {onViewPaper && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: COLORS.primary }}>
            <ImageIcon size={11} />原卷
          </span>
        )}
      </div>
      {editing ? (
        <>
          <input
            type="text"
            autoFocus
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onDone}
            onKeyDown={(e) => { if (e.key === 'Enter') onDone() }}
            placeholder={placeholder}
            style={{
              width: '100%', padding: '4px 6px', borderRadius: 'var(--radius-5)',
              border: `1px solid ${COLORS.primary}`,
              fontSize: 'var(--fs-14)', color: COLORS.text, outline: 'none',
              boxSizing: 'border-box', background: COLORS.card
            }}
          />
          {hasMathMarkup(value) && (
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3,
              fontSize: 'var(--fs-11)', color: 'var(--text-tertiary)'
            }}>
              预览<span style={{ color: COLORS.text }}><MathText content={value} /></span>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <button
            onClick={onViewPaper || onStartEdit}
            aria-label={onViewPaper ? `${label}：查看原卷核对` : `${label}：点击编辑`}
            style={{
              flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0,
              cursor: 'pointer', ...textStyle
            }}
          >
            {value ? <MathText content={value} /> : placeholder}
          </button>
          <button
            onClick={onStartEdit}
            aria-label={`编辑${label}`}
            style={{
              flexShrink: 0, background: 'none', border: 'none', padding: '2px 0 0',
              cursor: 'pointer', lineHeight: 1
            }}
          >
            <Pencil size={11} style={{ color: 'var(--text-tertiary)' }} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── 主组件 ──
export default function ExamReview({ task, onClose, onSave, onViewImage }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [filter, setFilter] = useState('attention')
  const [editingField, setEditingField] = useState(null)

  // ── 复审核心逻辑 (数据加载 / 人工评判 / 保存) ──
  const {
    validQuestions,
    wrongIdMap,
    loading,
    edits,
    saving,
    stats,
    needsAttentionCount,
    handleSetReviewAction,
    handleAnswerChange,
    handleAnswerEdit,
    handleSaveClick,
    handleCompleteReview
  } = useExamReview({ task, onSave })

  // 手机上逐题翻完整份作业成本太高，默认只进「需处理」队列，点顶部筛选可切到其它范围。
  // 队列成员在进入该筛选时一次性锁定（按全卷序号记录）：判完一题它不该当场消失，
  // 否则会把自己锁进空态、翻不回刚判的题；已保存的结论也不能参与锁定，否则重开仍是空。
  const queueSnapshotRef = useRef(null)
  const lastFilterRef = useRef(null)
  if (validQuestions.length > 0 && lastFilterRef.current !== filter) {
    lastFilterRef.current = filter
    queueSnapshotRef.current = filter === 'all' ? null : new Set(
      validQuestions
        .map((q, abs) => ({ q, abs }))
        .filter(({ q }) => (filter === 'attention'
          ? ATTENTION_SOURCES
          : [filter]).includes(getStatusInfo(q).source))
        .map(({ abs }) => abs)
    )
  }
  const displayQuestions = useMemo(() => {
    if (filter === 'all') return validQuestions
    const snap = queueSnapshotRef.current
    return validQuestions.filter((_, abs) => snap?.has(abs))
  }, [validQuestions, filter])

  const currentQuestion = displayQuestions[currentIndex] || null
  // 多图一任务：同一份作业上传的页数，用于在复核界面显式提示"这是一份 N 页作业"
  const pageCount = Array.isArray(task?.images) ? task.images.length : 0

  // ── 题号切换 ──
  // 手动翻页要撤掉待执行的自动前进，否则刚跳过去又被 250ms 前的定时器带走
  const advanceTimerRef = useRef(null)
  const clearAdvance = useCallback(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }, [])
  useEffect(() => clearAdvance, [clearAdvance])

  const jumpToQuestion = useCallback((index) => {
    if (index < 0 || index >= displayQuestions.length) return
    clearAdvance()
    setCurrentIndex(index)
    setShowAnswer(false)
    setConfirmComplete(false)
    setEditingField(null)
  }, [displayQuestions.length, clearAdvance])

  // 切换复核范围（下拉选择，不再有"再点一次退回"的隐含语义）
  const applyFilter = useCallback((next) => {
    clearAdvance()
    setFilter(next)
    setCurrentIndex(0)
    setShowAnswer(false)
    setConfirmComplete(false)
    setEditingField(null)
  }, [clearAdvance])

  // 整份作业都没有要人工介入的题时，默认落到「全部」——否则打开就是空态，
  // 想抽查还得多点一次「查看全部 N 题」。只在首次拿到题目时判一次，之后尊重手动选择。
  const autoRangeRef = useRef(false)
  useEffect(() => {
    if (autoRangeRef.current || validQuestions.length === 0) return
    autoRangeRef.current = true
    const hasAttention = validQuestions.some(q => ATTENTION_SOURCES.includes(getStatusInfo(q).source))
    if (!hasAttention) setFilter('all')
  }, [validQuestions])

  // ── 关闭：自动落盘未保存的修改（弱化"保存"概念），失败则留在页面避免丢改动 ──
  const handleClose = useCallback(async () => {
    if (Object.keys(edits).length > 0) {
      const saved = await handleSaveClick()
      if (!saved) return
    }
    onClose()
  }, [edits, handleSaveClick, onClose])

  // ── 计算派生状态 ──
  const correctness = useMemo(() => {
    if (!currentQuestion) return null
    if (edits[currentQuestion.id]?.is_correct !== undefined) {
      return edits[currentQuestion.id].is_correct
    }
    return currentQuestion.is_correct
  }, [currentQuestion, edits])

  // 判定按钮高亮：本次未保存的修改优先，其次是已落库的人工结论。
  // 从当前题派生而非用全局 state，避免翻页后残留上一题的高亮。
  const reviewAction = useMemo(() => {
    if (!currentQuestion) return null
    const status = edits[currentQuestion.id]?.review_status ?? currentQuestion.review_status ?? null
    if (status === REVIEW_STATUS.CORRECT) return 'correct'
    if (status === REVIEW_STATUS.WRONG || status === REVIEW_STATUS.WRONG_NO_BOOK) return 'wrong'
    if (status === REVIEW_STATUS.EXCLUDE) return 'excluded'
    return null
  }, [currentQuestion, edits])

  // 判定即前进：点完正确/错误先显示 250ms 选中态再自动跳下一题，
  // 11 题卷的点击数从 22 降到 11。再点同一判定是"撤回结论"，不前进；「上一题」可回退。
  const judgeAndAdvance = useCallback((action) => {
    if (!currentQuestion) return
    const isUndo = reviewAction === action
    handleSetReviewAction(action, currentQuestion.id)
    if (isUndo || currentIndex >= displayQuestions.length - 1) return
    clearAdvance()
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null
      jumpToQuestion(currentIndex + 1)
    }, 250)
  }, [
    currentQuestion, reviewAction, currentIndex, displayQuestions.length,
    handleSetReviewAction, jumpToQuestion, clearAdvance
  ])

  const handleCompleteClick = useCallback(() => {
    if (needsAttentionCount > 0 && !confirmComplete) {
      setConfirmComplete(true)
      return
    }
    setConfirmComplete(false)
    handleCompleteReview()
  }, [needsAttentionCount, confirmComplete, handleCompleteReview])

  const currentStudentAnswer = useMemo(() => {
    if (!currentQuestion) return ''
    if (edits[currentQuestion.id]?.student_answer !== undefined) {
      return edits[currentQuestion.id].student_answer
    }
    return currentQuestion.student_answer || currentQuestion.ai_answer || ''
  }, [currentQuestion, edits])

  const answerStatus = useMemo(() => {
    if (!currentQuestion) return 'pending'
    const answerSource = currentQuestion.answer_source || 'recognized'
    if (answerSource === 'blank') return 'not_answered'
    if (correctness === null) return 'pending'
    return correctness ? 'correct' : 'wrong'
  }, [currentQuestion, correctness])

  const geoImageUrl = currentQuestion?.geometry_image_url || currentQuestion?.enhanced_geometry_image

  const currentReferenceAnswer = edits[currentQuestion?.id]?.answer ?? currentQuestion?.answer ?? ''

  // 长答案不挤两列：136px 的列宽下「底角的余弦值等于 3/4 或 1/3」这类整句答案会折成一堆碎行，
  // 比整宽上下两行更费高度。超阈值就退回单列。
  const stackAnswers = String(currentStudentAnswer || '').length > ANSWER_STACK_THRESHOLD
    || String(currentReferenceAnswer || '').length > ANSWER_STACK_THRESHOLD

  // 当前题所在页的原卷图：复核要核对 AI 抄的学生答案是否等于纸上写的，必须能看到原图。
  // questions.image_url 存的是整页图而非题目切图，因此按 page_number 从 task.images 定位。
  const paperImage = useMemo(() => {
    const pages = Array.isArray(task?.images) ? task.images : []
    const pn = currentQuestion?.page_number
    if (pn) {
      const hit = pages.find(p => p.page_number === pn)
      if (hit?.image_url) return hit.image_url
    }
    return currentQuestion?.image_url || task?.image_url || pages[0]?.image_url || ''
  }, [task, currentQuestion])

  // 当前题在全卷中的序号：筛选后仍要显示原卷位置，避免「第 1 题」其实是第 4 题
  const absoluteIndex = useMemo(
    () => (currentQuestion ? validQuestions.findIndex(q => q.id === currentQuestion.id) : -1),
    [validQuestions, currentQuestion]
  )

  // AI 对这道题的原始判定（不含本次人工修改）。人工结论不再单独占一行，
  // 由页脚「正确 / 错误」按钮的选中态表达 —— 同一件事只说一次。
  const aiJudge = useMemo(() => {
    if (!currentQuestion) return null
    // 判定与文案都取同源实现，避免这里与列表 chip、PC 端各说一套
    const state = getReviewState(currentQuestion)
    const text = getReviewStateLabel(currentQuestion)
    if (state === 'correct') return { text: 'AI判对', color: 'var(--success)', Icon: CheckCircle2 }
    if (state === 'wrong') return { text: 'AI判错', color: 'var(--danger)', Icon: XCircle }
    if (state === 'processing') return { text, color: COLORS.textSecondary, Icon: Clock }
    if (state === 'exception') return { text, color: 'var(--warning)', Icon: AlertTriangle }
    return { text, color: COLORS.warning, Icon: Clock }
  }, [currentQuestion])

  // 「AI未判定」的原因（缺参考答案 / 参考答案无法核对）。老师看到原因才知道
  // 这题需要自己定，而不是系统坏了。纯展示，不参与判定。
  const unjudgedReason = useMemo(
    () => getUnjudgedReasonText(currentQuestion),
    [currentQuestion]
  )

  // 题型文案
  const typeText = currentQuestion?.question_type === 'choice' ? '选择题'
    : currentQuestion?.question_type === 'fill' ? '填空题'
    : currentQuestion?.question_type === 'judge' ? '判断题' : '解答题'

  // 选项：短选项（如分数、字母）用两列省高度，长选项单列
  const optionList = useMemo(() => {
    const list = normalizeOptions(currentQuestion?.options)
    return Array.isArray(list) ? list : []
  }, [currentQuestion])
  const compactOptions = optionList.length > 0 && optionList.every(opt => String(opt).trim().length <= 6)

  // ── 条件渲染 (所有 hooks 之后) ──
  if (loading) {
    return (
      <BottomSheet title='批改复核' onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <Loader2 size={28} style={{ color: COLORS.primary }} className="animate-spin" />
        </div>
      </BottomSheet>
    )
  }

  // 当前筛选下没有题：区分「这份作业没题」和「AI 判定都很确定，没有要人工介入的题」
  if (!currentQuestion) {
    const filteredEmpty = validQuestions.length > 0
    return (
      <BottomSheet title='批改复核' onClose={onClose}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', minHeight: 200,
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 'var(--fs-16)', color: COLORS.textSecondary, textAlign: 'center' }}>
            {filteredEmpty ? 'AI 判定都很确定，没有需要人工复核的题' : '暂无题目数据'}
          </div>
          {filteredEmpty ? (
            <button onClick={() => applyFilter('all')} style={{
              padding: '10px 24px', background: COLORS.primary, color: '#fff',
              borderRadius: 'var(--radius-12)', fontSize: 'var(--fs-15)', fontWeight: 600,
              border: 'none', cursor: 'pointer'
            }}>查看全部 {validQuestions.length} 题</button>
          ) : (
            <button onClick={onClose} style={{
              padding: '10px 24px', background: COLORS.primary, color: '#fff',
              borderRadius: 'var(--radius-12)', fontSize: 'var(--fs-15)', fontWeight: 600,
              border: 'none', cursor: 'pointer'
            }}>返回</button>
          )}
        </div>
      </BottomSheet>
    )
  }

  // ── 复核范围下拉的选项：零值范围不列出（三个常年为 0 的 chip 原先白占一行） ──
  const rangeOptions = [
    { key: 'attention', label: '需处理', count: needsAttentionCount, dot: COLORS.warning },
    { key: 'uncertain', label: '待复核', count: stats.uncertain, dot: COLORS.warning },
    { key: 'error', label: 'AI未判定', count: stats.error, dot: 'var(--warning)' },
    { key: 'ai_correct', label: 'AI正确', count: stats.ai_correct, dot: COLORS.success },
    { key: 'ai_wrong', label: 'AI错误', count: stats.ai_wrong, dot: COLORS.danger },
    { key: 'all', label: '全部', count: validQuestions.length, dot: 'var(--text-tertiary)' }
  ].filter(o => o.count > 0 || o.key === 'all' || o.key === filter)

  // ── 弹窗固定页眉：只剩题号导航一行（筛选已收进标题行） ──
  const header = (
    <div style={{
      display: 'flex', gap: 6, padding: '2px 16px 6px', overflowX: 'auto', scrollbarWidth: 'none',
      borderBottom: `1px solid ${COLORS.border}`
    }}>
      {displayQuestions.map((q, i) => {
        const info = getStatusInfo({ ...q, ...(edits[q.id] || {}) })
        const dotColor = DOT_COLORS[info.source] || COLORS.warning
        const isCurrent = i === currentIndex
        // 圆点上是全卷序号，与题目标题的「第 N 题」一致
        const absNo = validQuestions.findIndex(x => x.id === q.id) + 1
        return (
          <button
            key={q.id}
            onClick={() => jumpToQuestion(i)}
            title={info.text}
            aria-label={`第 ${absNo} 题 · ${info.text}`}
            aria-current={isCurrent ? 'true' : undefined}
            style={{
              position: 'relative', width: 27, height: 27, borderRadius: '50%', flexShrink: 0,
              border: 'none', cursor: 'pointer',
              background: isCurrent ? COLORS.primary : 'var(--bg-secondary)',
              color: isCurrent ? '#fff' : COLORS.text,
              fontSize: 'var(--fs-12)', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: info.isGreyed ? 0.45 : 1,
              transition: 'background 0.15s'
            }}
          >
            {absNo}
            {!isCurrent && (
              <span style={{
                position: 'absolute', top: -1, right: -1, width: 8, height: 8,
                borderRadius: '50%', background: dotColor, border: '1.5px solid #fff'
              }} />
            )}
          </button>
        )
      })}
    </div>
  )

  // ── 弹窗固定页脚：上一题 / 下一题 + 完成复核（唯一主 CTA） ──
  // ── 弹窗固定页脚：主判定（高频）常驻，翻页降为箭头，「完成复核」（一次性）延后升起 ──
  // 原先固定页脚给了翻页 + 完成复核共 100px，而真正高频的「正确 / 错误」在滚动区里，
  // 长题要先滚到底才点得到。现在反过来：判定永远在拇指位置。
  const atFirst = currentIndex === 0
  const atLast = currentIndex >= displayQuestions.length - 1
  const showComplete = needsAttentionCount === 0 || atLast

  const navBtnStyle = (disabled) => ({
    width: 38, height: 40, flexShrink: 0, borderRadius: 'var(--radius-8)', border: 'none',
    background: 'var(--bg-secondary)', cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'var(--text-tertiary)' : COLORS.text,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  })

  const judgeBtnStyle = (active, tone) => ({
    flex: 1, minWidth: 0, height: 40, borderRadius: 'var(--radius-8)', cursor: 'pointer',
    border: active ? `1.5px solid var(--${tone})` : `1px solid ${COLORS.border}`,
    background: active ? `var(--${tone}-soft)` : COLORS.card,
    color: active ? `var(--${tone})` : COLORS.textSecondary,
    fontSize: 'var(--fs-14)', fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5
  })

  const footer = (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 16px 8px',
      borderTop: `1px solid ${COLORS.border}`, background: COLORS.card
    }}>
      {showComplete && (
        <button
          onClick={handleCompleteClick}
          disabled={saving}
          style={{
            width: '100%', height: 36, borderRadius: 'var(--radius-8)', border: 'none',
            background: confirmComplete ? 'var(--warning)' : (saving ? 'var(--primary-soft)' : COLORS.primary),
            color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 'var(--fs-14)', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {confirmComplete
            ? `还有 ${needsAttentionCount} 题未确认，仍要完成？`
            : needsAttentionCount > 0
              ? `完成复核（${needsAttentionCount} 题待确认）`
              : '完成复核'}
        </button>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={() => jumpToQuestion(currentIndex - 1)}
          disabled={atFirst}
          aria-label="上一题"
          style={navBtnStyle(atFirst)}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          onClick={() => judgeAndAdvance('correct')}
          aria-pressed={reviewAction === 'correct'}
          style={judgeBtnStyle(reviewAction === 'correct', 'success')}
        >
          <CheckCircle2 size={15} /> 正确
        </button>
        <button
          onClick={() => judgeAndAdvance('wrong')}
          aria-pressed={reviewAction === 'wrong'}
          style={judgeBtnStyle(reviewAction === 'wrong', 'danger')}
        >
          <XCircle size={15} /> 错误
        </button>
        <button
          onClick={() => jumpToQuestion(currentIndex + 1)}
          disabled={atLast}
          aria-label="下一题"
          style={navBtnStyle(atLast)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  )

  return (
    <BottomSheet
      title='批改复核'
      titleAction={<RangeMenu options={rangeOptions} value={filter} onChange={applyFilter} />}
      onClose={handleClose}
      header={header}
      footer={footer}
      showHandle={false}
      bodyClassName='px-4 pt-2 pb-3'
    >
      {/* ① 题目头：第几题 / 原卷题号 / 题型 + AI 判定（人工结论看页脚按钮的选中态） */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 8, marginBottom: 6
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontSize: 'var(--fs-15)', fontWeight: 700, color: COLORS.primary }}>
            第 {absoluteIndex + 1} 题
          </span>
          {currentQuestion?.question_number && (
            <span style={{ fontSize: 'var(--fs-11)', color: COLORS.textSecondary }}>
              原卷第 {currentQuestion.question_number} 题
            </span>
          )}
          <span style={{ fontSize: 'var(--fs-11)', color: COLORS.textSecondary }}>{typeText}</span>
          {pageCount > 1 && (
            <span style={{ fontSize: 'var(--fs-11)', color: COLORS.textSecondary }}>
              {currentQuestion?.page_number ? `第${currentQuestion.page_number}页/共${pageCount}页` : `共${pageCount}页`}
            </span>
          )}
        </div>
        {aiJudge && (
          <AiJudgeTag
            {...aiJudge}
            note={
              wrongIdMap[currentQuestion.id] && reviewAction !== 'excluded'
                ? '已入错题本'
                : unjudgedReason || null
            }
          />
        )}
      </div>

      {/* ② 题干：先看题目问了什么，再看答案 */}
      <div style={{ fontSize: 15, lineHeight: 1.7, color: COLORS.text, marginBottom: optionList.length > 0 || geoImageUrl ? 6 : 10 }}>
        <MathText content={currentQuestion?.content || ''} />
      </div>

      {/* ③ 选项 / 几何配图 */}
      {optionList.length > 0 && (
        <div style={{
          display: compactOptions ? 'grid' : 'flex',
          gridTemplateColumns: '1fr 1fr',
          flexDirection: compactOptions ? undefined : 'column',
          gap: compactOptions ? '4px 16px' : 4,
          marginBottom: geoImageUrl ? 8 : 10
        }}>
          {optionList.map((opt, i) => (
            <div key={i} style={{ fontSize: 13.5, color: COLORS.text, lineHeight: 1.55 }}>
              {formatOption(opt, i)}
            </div>
          ))}
        </div>
      )}
      {geoImageUrl && (
        <div style={{
          marginBottom: 10, background: '#FAFAFA',
          borderRadius: 'var(--radius-8)', padding: 8, border: '1px solid var(--border-light)'
        }}>
          <img
            src={geoImageUrl}
            alt="几何配图"
            loading="lazy"
            style={{
              width: '100%', maxHeight: '20vh',
              objectFit: 'contain', borderRadius: 'var(--radius-6)', display: 'block'
            }}
          />
        </div>
      )}

      {/* ④ 答案对比：短答案两列直接对照；长答案退回整宽单列。
          学生答案那格主点击 = 弹原卷图（核对 AI 抄的字），铅笔才是改字。 */}
      <div style={{
        display: 'flex', flexDirection: stackAnswers ? 'column' : 'row',
        gap: stackAnswers ? 8 : 12,
        borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}`,
        padding: '9px 0', marginBottom: 8
      }}>
        <AnswerCell
          label="学生答案"
          value={currentStudentAnswer || ''}
          placeholder={answerStatus === 'not_answered' ? '未作答' : '点击填写'}
          warn={answerStatus === 'not_answered'}
          editing={editingField === 'student'}
          onStartEdit={() => setEditingField('student')}
          onChange={(v) => handleAnswerChange(currentQuestion.id, v)}
          onDone={() => setEditingField(null)}
          onViewPaper={paperImage && onViewImage ? () => onViewImage(paperImage) : undefined}
        />
        <div style={stackAnswers
          ? { height: 1, background: COLORS.border }
          : { width: 1, background: COLORS.border, flexShrink: 0 }} />
        <AnswerCell
          label="参考答案"
          value={currentReferenceAnswer}
          placeholder="点击填写"
          editing={editingField === 'answer'}
          onStartEdit={() => setEditingField('answer')}
          onChange={(v) => handleAnswerEdit(currentQuestion.id, v)}
          onDone={() => setEditingField(null)}
        />
      </div>

      {/* ⑤ 辅助操作：解析（怀疑判错时的证据）与排除（低频异常），均为轻量文字链接。
          判定按钮已移到固定页脚 —— 长题不必滚到底才点得到。 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setShowAnswer(!showAnswer)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 'var(--fs-12)', color: COLORS.textSecondary
          }}
        >
          {showAnswer ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <span style={{ fontWeight: 500 }}>{showAnswer ? '收起解析' : '查看解析'}</span>
        </button>
        <button
          onClick={() => handleSetReviewAction('excluded', currentQuestion.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 'var(--fs-12)',
            fontWeight: reviewAction === 'excluded' ? 600 : 500,
            color: reviewAction === 'excluded' ? 'var(--danger)' : COLORS.textSecondary
          }}
        >
          <Trash2 size={12} />
          {reviewAction === 'excluded' ? '已排除 · 点击撤销' : '排除本题'}
        </button>
      </div>
      {showAnswer && (
        <div style={{
          marginTop: 2, padding: '8px 10px',
          background: 'var(--bg-mist)', borderRadius: 'var(--radius-6)',
          fontSize: 'var(--fs-13)', color: COLORS.text, lineHeight: 1.6
        }}>
          <MathText content={currentQuestion?.analysis || '暂无解析'} />
        </div>
      )}
    </BottomSheet>
  )
}
