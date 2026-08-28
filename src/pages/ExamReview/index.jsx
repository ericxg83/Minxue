import { useState, useMemo, useRef, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, Ban,
  Loader2, Trash2, ChevronUp, ChevronDown, Image as ImageIcon,
  AlertTriangle, Clock, Pencil
} from 'lucide-react'
import MathText from '../../components/MathText'
import BottomSheet from '../../components/BottomSheet'
import { COLORS } from './constants'
import { formatOption, getStatusInfo, DOT_COLORS } from './status'
import { useExamReview } from '../../hooks/useExamReview'
import { normalizeOptions } from '../../utils/optionText'
import { REVIEW_STATUS } from '../../utils/reviewDecision'

// 需要老师人工介入的状态（与 PC 端 needsAttentionCount 同口径）
const ATTENTION_SOURCES = ['uncertain', 'error', 'processing']

// 复核状态小标签：彩色文字 + 图标，无底色块（颜色只做强调，不铺背景）
function StatusTag({ Icon, text, color, note }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--fs-12)', fontWeight: 600, color }}>
        <Icon size={13} />
        {text}
      </span>
      {note && <span style={{ fontSize: 'var(--fs-10)', color: 'var(--text-tertiary)' }}>{note}</span>}
    </span>
  )
}

// 轻量筛选 chip：文字 + 状态点，选中才出现浅色底
function FilterChip({ label, count, dot, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        padding: '3px 8px', borderRadius: 'var(--radius-full)',
        border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
        background: active ? 'var(--primary-soft)' : 'transparent',
        color: active ? COLORS.primary : COLORS.textSecondary,
        fontSize: 'var(--fs-11)', fontWeight: active ? 600 : 500
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: dot, flexShrink: 0 }} />
      {label} {count}
    </button>
  )
}

// 答案对比的单列：默认纯文本展示（点击进编辑态），不是常驻输入框
function AnswerCell({ label, value, placeholder, warn, editing, onStartEdit, onChange, onDone }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 'var(--fs-11)', color: COLORS.textSecondary, marginBottom: 2 }}>
        {label}
      </div>
      {editing ? (
        <input
          type="text"
          autoFocus
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
      ) : (
        <button
          onClick={onStartEdit}
          style={{
            width: '100%', background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left',
            display: 'flex', alignItems: 'flex-start', gap: 5
          }}
        >
          <span style={{
            fontSize: 'var(--fs-16)', fontWeight: 600, lineHeight: 1.45,
            color: warn ? 'var(--warning)' : (value ? COLORS.text : 'var(--text-tertiary)'),
            overflowWrap: 'anywhere'
          }}>
            {value ? <MathText content={value} /> : placeholder}
          </span>
          <Pencil size={11} style={{ flexShrink: 0, color: 'var(--text-tertiary)', marginTop: 5 }} />
        </button>
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
  const jumpToQuestion = useCallback((index) => {
    if (index < 0 || index >= displayQuestions.length) return
    setCurrentIndex(index)
    setShowAnswer(false)
    setConfirmComplete(false)
    setEditingField(null)
  }, [displayQuestions.length])

  // 切换筛选范围：再次点击同一范围回到「需处理」
  const applyFilter = useCallback((next) => {
    setFilter(prev => (next === 'attention' ? 'attention' : (prev === next ? 'attention' : next)))
    setCurrentIndex(0)
    setShowAnswer(false)
    setConfirmComplete(false)
    setEditingField(null)
  }, [])

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

  // AI 对这道题的原始判定（不含本次人工修改；人工结论单独显示在「复核结果」）
  const aiJudge = useMemo(() => {
    if (!currentQuestion) return null
    if (currentQuestion.answer_source === 'blank') {
      return { text: '未作答', color: 'var(--warning)', Icon: AlertTriangle }
    }
    if (currentQuestion.is_correct === true) {
      return { text: '判对', color: 'var(--success)', Icon: CheckCircle2 }
    }
    if (currentQuestion.is_correct === false) {
      return { text: '判错', color: 'var(--danger)', Icon: XCircle }
    }
    if (currentQuestion.confidence == null) {
      return { text: '处理中', color: COLORS.textSecondary, Icon: Clock }
    }
    return { text: '异常', color: 'var(--warning)', Icon: AlertTriangle }
  }, [currentQuestion])

  // 统一的「当前复核状态」：人工结论优先，未判定则待确认
  const reviewResult = useMemo(() => {
    if (reviewAction === 'correct') return { text: '正确', color: 'var(--success)', Icon: CheckCircle2, decided: true }
    if (reviewAction === 'wrong') return { text: '错误', color: 'var(--danger)', Icon: XCircle, decided: true }
    if (reviewAction === 'excluded') return { text: '已排除', color: COLORS.textSecondary, Icon: Ban, decided: true }
    return { text: '待确认', color: 'var(--warning)', Icon: Clock, decided: false }
  }, [reviewAction])

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

  // ── 弹窗固定页眉：题号导航 + 轻量状态筛选 ──
  const header = (
    <div style={{ borderBottom: `1px solid ${COLORS.border}` }}>
      {/* 题号快速导航：当前题实心主色，其余靠右上角状态点表达，不整圈铺色 */}
      <div style={{
        display: 'flex', gap: 8, padding: '6px 16px', overflowX: 'auto', scrollbarWidth: 'none'
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
              style={{
                position: 'relative', width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
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
                  position: 'absolute', top: -1, right: -1, width: 9, height: 9,
                  borderRadius: '50%', background: dotColor, border: '1.5px solid #fff'
                }} />
              )}
            </button>
          )
        })}
      </div>
      {/* 统计降级为轻量筛选入口，不再占据首屏主视觉 */}
      <div style={{
        display: 'flex', gap: 4, padding: '0 16px 6px', overflowX: 'auto', scrollbarWidth: 'none'
      }}>
        <FilterChip label="需处理" count={needsAttentionCount} dot={COLORS.warning}
          active={filter === 'attention'} onClick={() => applyFilter('attention')} />
        <FilterChip label="待复核" count={stats.uncertain} dot={COLORS.warning}
          active={filter === 'uncertain'} onClick={() => applyFilter('uncertain')} />
        <FilterChip label="AI异常" count={stats.error} dot="var(--warning)"
          active={filter === 'error'} onClick={() => applyFilter('error')} />
        <FilterChip label="AI正确" count={stats.ai_correct} dot={COLORS.success}
          active={filter === 'ai_correct'} onClick={() => applyFilter('ai_correct')} />
        <FilterChip label="AI错误" count={stats.ai_wrong} dot={COLORS.danger}
          active={filter === 'ai_wrong'} onClick={() => applyFilter('ai_wrong')} />
        <FilterChip label="全部" count={validQuestions.length} dot="var(--text-tertiary)"
          active={filter === 'all'} onClick={() => applyFilter('all')} />
      </div>
    </div>
  )

  // ── 弹窗固定页脚：上一题 / 下一题 + 完成复核（唯一主 CTA） ──
  const footer = (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 16px',
      borderTop: `1px solid ${COLORS.border}`, background: COLORS.card
    }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => jumpToQuestion(currentIndex - 1)}
          disabled={currentIndex === 0}
          style={{
            flex: 1, height: 36, borderRadius: 'var(--radius-8)', border: 'none',
            background: 'var(--bg-secondary)', cursor: currentIndex === 0 ? 'default' : 'pointer',
            fontSize: 'var(--fs-13)', fontWeight: 500,
            color: currentIndex === 0 ? 'var(--text-tertiary)' : COLORS.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2
          }}
        >
          <ChevronLeft size={15} /> 上一题
        </button>
        <button
          onClick={() => jumpToQuestion(currentIndex + 1)}
          disabled={currentIndex >= displayQuestions.length - 1}
          style={{
            flex: 1, height: 36, borderRadius: 'var(--radius-8)', border: 'none',
            background: 'var(--bg-secondary)',
            cursor: currentIndex >= displayQuestions.length - 1 ? 'default' : 'pointer',
            fontSize: 'var(--fs-13)', fontWeight: 500,
            color: currentIndex >= displayQuestions.length - 1 ? 'var(--text-tertiary)' : COLORS.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2
          }}
        >
          下一题 <ChevronRight size={15} />
        </button>
      </div>
      <button
        onClick={handleCompleteClick}
        disabled={saving}
        style={{
          width: '100%', height: 40, borderRadius: 'var(--radius-8)', border: 'none',
          background: confirmComplete ? 'var(--warning)' : (saving ? 'var(--primary-soft)' : COLORS.primary),
          color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: 'var(--fs-15)', fontWeight: 600,
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
    </div>
  )

  return (
    <BottomSheet
      title={(
        <>
          批改复核
          <span style={{ marginLeft: 8, fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--text-tertiary)' }}>
            {absoluteIndex + 1}/{validQuestions.length}
          </span>
        </>
      )}
      onClose={handleClose}
      header={header}
      footer={footer}
      bodyClassName='px-4 pt-2.5 pb-3'
    >
      {/* ① 题目头：第几题 / 原卷题号 / 题型，「查看原卷」只作右上角轻量入口 */}
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
        {paperImage && onViewImage && (
          <button
            onClick={() => onViewImage(paperImage)}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
              background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer',
              fontSize: 'var(--fs-12)', fontWeight: 500, color: COLORS.primary
            }}
          >
            <ImageIcon size={13} />
            原卷
          </button>
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

      {/* ④ 答案对比：一屏两列直接对照，点击才进编辑态，不再占两个大输入框 */}
      <div style={{
        display: 'flex', gap: 12,
        borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}`,
        padding: '9px 0', marginBottom: 10
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
        />
        <div style={{ width: 1, background: COLORS.border, flexShrink: 0 }} />
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

      {/* ⑤ AI判定 + 复核结果 + 人工确认：状态只在这里统一表达一次 */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 'var(--fs-11)', color: COLORS.textSecondary }}>AI判定</span>
          {aiJudge && <StatusTag {...aiJudge} />}
          <span style={{ width: 1, height: 10, background: COLORS.border }} />
          <span style={{ fontSize: 'var(--fs-11)', color: COLORS.textSecondary }}>复核结果</span>
          <StatusTag
            {...reviewResult}
            text={reviewResult.decided ? `${reviewResult.text} ✓` : reviewResult.text}
            note={wrongIdMap[currentQuestion.id] && reviewAction !== 'excluded' ? '已入错题本' : null}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => handleSetReviewAction('correct', currentQuestion.id)}
            style={{
              flex: 1, height: 36, borderRadius: 'var(--radius-8)', cursor: 'pointer',
              border: reviewAction === 'correct' ? '1.5px solid var(--success)' : `1px solid ${COLORS.border}`,
              background: reviewAction === 'correct' ? 'var(--success-soft)' : COLORS.card,
              color: reviewAction === 'correct' ? 'var(--success)' : COLORS.textSecondary,
              fontSize: 'var(--fs-14)', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5
            }}
          >
            <CheckCircle2 size={15} /> 正确
          </button>
          <button
            onClick={() => handleSetReviewAction('wrong', currentQuestion.id)}
            style={{
              flex: 1, height: 36, borderRadius: 'var(--radius-8)', cursor: 'pointer',
              border: reviewAction === 'wrong' ? '1.5px solid var(--danger)' : `1px solid ${COLORS.border}`,
              background: reviewAction === 'wrong' ? 'var(--danger-soft)' : COLORS.card,
              color: reviewAction === 'wrong' ? 'var(--danger)' : COLORS.textSecondary,
              fontSize: 'var(--fs-14)', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5
            }}
          >
            <XCircle size={15} /> 错误
          </button>
        </div>
      </div>

      {/* ⑥ 辅助操作：解析（怀疑判错时的证据）与排除（低频异常），均为轻量文字链接 */}
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
