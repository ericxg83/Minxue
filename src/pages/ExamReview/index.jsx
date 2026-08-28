import { useState, useMemo, useRef, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Save, Loader2, Trash2, ChevronUp, ChevronDown, Image as ImageIcon, Pencil
} from 'lucide-react'
import MathText from '../../components/MathText'
import BottomSheet from '../../components/BottomSheet'
import { COLORS } from './constants'
import { formatOption, getStatusInfo, DOT_COLORS, StatChip } from './status'
import { useExamReview } from '../../hooks/useExamReview'
import { normalizeOptions } from '../../utils/optionText'
import { REVIEW_STATUS } from '../../utils/reviewDecision'

// 需要老师人工介入的状态（与 PC 端 needsAttentionCount 同口径）
const ATTENTION_SOURCES = ['uncertain', 'error', 'processing']

// 答案字段：默认用 MathText 渲染，避免手机上把根式分数显示成裸 LaTeX；点击才进编辑态
function AnswerField({ label, value, placeholder, editing, onStartEdit, onChange, onDone, warn }) {
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ fontSize: 'var(--fs-11)', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>
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
            width: '100%', padding: '8px', borderRadius: 'var(--radius-5)',
            border: `1px solid ${COLORS.primary}`,
            fontSize: 'var(--fs-14)', color: COLORS.text, outline: 'none',
            boxSizing: 'border-box', background: COLORS.card
          }}
        />
      ) : (
        <button
          onClick={onStartEdit}
          style={{
            width: '100%', minHeight: '36px', padding: '7px 8px',
            borderRadius: 'var(--radius-5)',
            border: `1px solid ${warn ? COLORS.warning : COLORS.border}`,
            background: COLORS.card, cursor: 'pointer', textAlign: 'left',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
            fontSize: 'var(--fs-14)', color: value ? COLORS.text : COLORS.textSecondary
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {value ? <MathText content={value} /> : placeholder}
          </span>
          <Pencil size={12} style={{ flexShrink: 0, color: COLORS.textSecondary }} />
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
  const [showStem, setShowStem] = useState(null)

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

  // 手机上逐题翻完整份作业成本太高，默认只进「需处理」队列，点顶部统计可切到其它范围。
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
    setShowStem(null)
  }, [displayQuestions.length])

  // 切换筛选范围：再次点击同一范围回到「需处理」
  const applyFilter = useCallback((next) => {
    setFilter(prev => (prev === next ? 'attention' : next))
    setCurrentIndex(0)
    setShowAnswer(false)
    setConfirmComplete(false)
    setEditingField(null)
    setShowStem(null)
  }, [])

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

  const statusInfo = useMemo(() => getStatusInfo(currentQuestion), [currentQuestion])
  const geoImageUrl = currentQuestion?.geometry_image_url || currentQuestion?.enhanced_geometry_image

  const currentReferenceAnswer = edits[currentQuestion?.id]?.answer ?? currentQuestion?.answer ?? ''

  // 题目内容默认收起（复核时判定依据是答案而非题干）；选择题要看选项、几何题要看图，默认展开
  const stemOpen = showStem === null
    ? (currentQuestion?.question_type === 'choice' || !!geoImageUrl)
    : showStem

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

  // ── 弹窗固定页眉：统计 + 题号导航 ──
  const header = (
    <>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '2px 12px 6px'
      }}>
        <StatChip label="待人工复核" count={stats.uncertain} color={COLORS.warning} bg="var(--warning-soft)"
          onClick={() => applyFilter('uncertain')} active={filter === 'uncertain'} />
        <StatChip label="AI异常" count={stats.error} color="var(--warning)" bg="var(--warning-soft)"
          onClick={() => applyFilter('error')} active={filter === 'error'} />
        <StatChip label="AI正确" count={stats.ai_correct} color={COLORS.success} bg="var(--success-soft)"
          onClick={() => applyFilter('ai_correct')} active={filter === 'ai_correct'} />
        <StatChip label="AI错误" count={stats.ai_wrong} color={COLORS.danger} bg="var(--danger-soft)"
          onClick={() => applyFilter('ai_wrong')} active={filter === 'ai_wrong'} />
        <StatChip label="全部" count={validQuestions.length} color={COLORS.textSecondary} bg="var(--bg-secondary)"
          onClick={() => applyFilter('all')} active={filter === 'all'} />
      </div>
      <div style={{ padding: '0 12px 4px', fontSize: 'var(--fs-11)', color: COLORS.textSecondary }}>
        {filter === 'attention'
          ? `仅显示需处理 ${displayQuestions.length} 题 · 点上方标签切换范围`
          : `当前范围 ${displayQuestions.length} 题 · 再次点击标签回到需处理`}
      </div>
      <div style={{
        display: 'flex', gap: '6px', padding: '8px 12px', overflowX: 'auto', scrollbarWidth: 'none',
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
              style={{
                minWidth: '32px', height: '32px', borderRadius: 'var(--radius-16)',
                background: isCurrent ? COLORS.primary : dotColor,
                color: '#fff', border: 'none',
                fontSize: 'var(--fs-13)', fontWeight: 600, cursor: 'pointer',
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'transform 0.15s',
                transform: isCurrent ? 'scale(1.15)' : 'scale(1)',
                opacity: info.isGreyed ? 0.6 : 1
              }}
            >
              {absNo}
            </button>
          )
        })}
      </div>
    </>
  )

  // ── 弹窗固定页脚：上一题 / 保存 / 下一题 + 完成复核 ──
  const footer = (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 12px',
      borderTop: `1px solid ${COLORS.border}`, background: COLORS.card
    }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => jumpToQuestion(currentIndex - 1)}
          disabled={currentIndex === 0}
          style={{
            flex: 1, padding: '8px', borderRadius: 'var(--radius-8)',
            border: `1px solid ${COLORS.border}`,
            background: COLORS.card, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
            fontSize: 'var(--fs-13)', color: currentIndex === 0 ? '#CCC' : COLORS.textSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
          }}
        >
          <ChevronLeft size={14} /> 上一题
        </button>
        <button
          onClick={handleSaveClick}
          disabled={saving || Object.keys(edits).length === 0}
          style={{
            padding: '8px 16px', borderRadius: 'var(--radius-8)', border: 'none',
            background: (saving || Object.keys(edits).length === 0) ? 'var(--primary-soft)' : COLORS.primary,
            color: '#fff', cursor: (saving || Object.keys(edits).length === 0) ? 'not-allowed' : 'pointer',
            fontSize: 'var(--fs-13)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
            flexShrink: 0
          }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          保存
        </button>
        <button
          onClick={() => jumpToQuestion(currentIndex + 1)}
          disabled={currentIndex >= displayQuestions.length - 1}
          style={{
            flex: 1, padding: '8px', borderRadius: 'var(--radius-8)',
            border: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            cursor: currentIndex >= displayQuestions.length - 1 ? 'not-allowed' : 'pointer',
            fontSize: 'var(--fs-13)', color: currentIndex >= displayQuestions.length - 1 ? '#CCC' : COLORS.textSecondary,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
          }}
        >
          下一题 <ChevronRight size={14} />
        </button>
      </div>
      <button
        onClick={handleCompleteClick}
        disabled={saving}
        style={{
          width: '100%', padding: '10px 0', borderRadius: 'var(--radius-8)', border: 'none',
          background: confirmComplete ? 'var(--warning)' : (saving ? 'var(--primary-soft)' : COLORS.primary),
          color: '#fff', cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: 'var(--fs-14)', fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
        }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        {confirmComplete
          ? `还有 ${needsAttentionCount} 题未确认，仍要完成？`
          : needsAttentionCount > 0
            ? `完成复核（${needsAttentionCount} 题待确认）`
            : '完成复核'}
      </button>
    </div>
  )

  return (
    <BottomSheet title='批改复核' onClose={onClose} header={header} footer={footer} bodyClassName='px-4 py-3'>
      {/* 题号标题 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '6px', flexWrap: 'wrap', gap: '4px'
      }}>
        <div>
          <span style={{ fontSize: 'var(--fs-14)', fontWeight: 600, color: COLORS.primary, marginRight: '8px' }}>
            第 {absoluteIndex + 1} 题
          </span>
          {currentQuestion?.question_number && (
            <span style={{
              fontSize: 'var(--fs-11)', color: '#fff', background: COLORS.primary,
              padding: '1px 6px', borderRadius: 'var(--radius-4)', marginRight: '6px'
            }}>
              原卷题号 {currentQuestion.question_number}
            </span>
          )}
          {pageCount > 1 && (
            <span style={{
              fontSize: 'var(--fs-11)', color: COLORS.primary, background: 'var(--primary-soft)',
              padding: '1px 6px', borderRadius: 'var(--radius-4)', marginRight: '6px'
            }}>
              {currentQuestion?.page_number ? `第${currentQuestion.page_number}页` : '本题'} / 共{pageCount}页
            </span>
          )}
          <span style={{ fontSize: 'var(--fs-12)', color: COLORS.textSecondary }}>
            {currentQuestion?.question_type === 'choice' ? '选择题' :
             currentQuestion?.question_type === 'fill' ? '填空题' :
             currentQuestion?.question_type === 'judge' ? '判断题' : '解答题'}
          </span>
        </div>
        <div style={{
          fontSize: 'var(--fs-12)', padding: '3px 10px', borderRadius: 'var(--radius-sm)',
          display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
          background: statusInfo.bg, color: statusInfo.color
        }}>
          <statusInfo.icon size={12} />
          {statusInfo.text}
          {currentQuestion && wrongIdMap[currentQuestion.id] && statusInfo.source !== 'excluded' && (
            <span style={{ fontSize: 'var(--fs-10)', opacity: 0.8 }}>(已加入错题本)</span>
          )}
        </div>
      </div>

      {/* 原卷入口：核对 AI 识别的学生答案是否等于纸上写的 */}
      {paperImage && onViewImage && (
        <button
          onClick={() => onViewImage(paperImage)}
          style={{
            width: '100%', padding: '8px 0', marginBottom: '8px',
            borderRadius: 'var(--radius-8)', border: '1px solid var(--primary-soft)',
            background: 'var(--primary-soft)', color: 'var(--primary-hover)',
            fontSize: 'var(--fs-13)', fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
          }}
        >
          <ImageIcon size={14} />
          {pageCount > 1 && currentQuestion?.page_number
            ? `查看原卷第 ${currentQuestion.page_number} 页`
            : '查看原卷'}
        </button>
      )}

      {/* 答案对比区：判定依据放最前，题干下移为辅助信息 */}
      <div style={{
        background: COLORS.background, borderRadius: 'var(--radius-8)', padding: '8px 10px',
        marginBottom: '8px'
      }}>
        <AnswerField
          label="学生答案"
          value={currentStudentAnswer || ''}
          placeholder={answerStatus === 'not_answered' ? '未作答' : '点击填写'}
          warn={answerStatus === 'not_answered'}
          editing={editingField === 'student'}
          onStartEdit={() => setEditingField('student')}
          onChange={(v) => handleAnswerChange(currentQuestion.id, v)}
          onDone={() => setEditingField(null)}
        />
        <AnswerField
          label="参考答案"
          value={currentReferenceAnswer}
          placeholder="点击填写"
          editing={editingField === 'answer'}
          onStartEdit={() => setEditingField('answer')}
          onChange={(v) => handleAnswerEdit(currentQuestion.id, v)}
          onDone={() => setEditingField(null)}
        />

        {/* 解析：怀疑 AI 判错时最需要的证据，放在判定按钮旁而不是页面底部 */}
        <button
          onClick={() => setShowAnswer(!showAnswer)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
            display: 'flex', alignItems: 'center', gap: '4px', width: '100%',
            fontSize: 'var(--fs-12)', color: COLORS.textSecondary, justifyContent: 'flex-start'
          }}
        >
          {showAnswer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span style={{ fontWeight: 500 }}>{showAnswer ? '收起解析' : '查看解析'}</span>
        </button>
        {showAnswer && (
          <div style={{
            marginBottom: '6px', padding: '8px 10px',
            background: `${COLORS.success}08`, borderRadius: 'var(--radius-6)',
            fontSize: 'var(--fs-13)', color: COLORS.text, lineHeight: '1.6'
          }}>
            <MathText content={currentQuestion?.analysis || '暂无解析'} />
          </div>
        )}

        {/* 人工评判 */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => handleSetReviewAction('correct', currentQuestion.id)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 'var(--radius-8)',
              border: (reviewAction === 'correct') ? '2px solid var(--success)' : '1px solid var(--border-light)',
              cursor: 'pointer', fontSize: 'var(--fs-13)', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
              background: (reviewAction === 'correct') ? 'var(--success-soft)' : COLORS.card,
              color: (reviewAction === 'correct') ? 'var(--success)' : 'var(--success)',
            }}
          >
            <CheckCircle2 size={14} /> 正确
          </button>
          <button
            onClick={() => handleSetReviewAction('wrong', currentQuestion.id)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 'var(--radius-8)',
              border: (reviewAction === 'wrong') ? '2px solid var(--danger)' : '1px solid var(--border-light)',
              cursor: 'pointer', fontSize: 'var(--fs-13)', fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
              background: (reviewAction === 'wrong') ? 'var(--danger-soft)' : COLORS.card,
              color: (reviewAction === 'wrong') ? 'var(--danger)' : 'var(--text-secondary)',
            }}
          >
            <XCircle size={14} /> 错误
          </button>
        </div>
      </div>

      {/* 题目内容：复核判定看答案即可，题干是辅助信息，默认收起省掉滚动 */}
      <button
        onClick={() => setShowStem(!stemOpen)}
        style={{
          width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-start',
          fontSize: 'var(--fs-12)', color: COLORS.textSecondary,
          borderTop: `1px solid ${COLORS.border}`
        }}
      >
        {stemOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span style={{ fontWeight: 500 }}>{stemOpen ? '收起题目内容' : '展开题目内容'}</span>
      </button>

      {stemOpen && (
        <>
          <div style={{ fontSize: '14.5px', color: COLORS.text, lineHeight: '1.65', marginBottom: '8px' }}>
            <MathText content={currentQuestion?.content || ''} />
          </div>

          {currentQuestion?.options?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              {normalizeOptions(currentQuestion.options).map((opt, i) => (
                <div key={i} style={{
                  fontSize: 'var(--fs-13)', color: COLORS.text,
                  padding: '4px 8px', background: COLORS.background, borderRadius: 'var(--radius-6)'
                }}>
                  {formatOption(opt, i)}
                </div>
              ))}
            </div>
          )}
          {geoImageUrl && (
            <div style={{
              marginBottom: '8px', background: '#FAFAFA',
              borderRadius: 'var(--radius-8)', padding: '8px', border: '1px solid var(--border-light)'
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
        </>
      )}

      {/* 排除本题：低频异常处理（题目识别错、重复题等），降为次级操作 */}
      <button
        onClick={() => handleSetReviewAction('excluded', currentQuestion.id)}
        style={{
          width: '100%', padding: '8px 0', marginTop: '4px',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
          fontSize: 'var(--fs-12)',
          fontWeight: reviewAction === 'excluded' ? 700 : 500,
          color: reviewAction === 'excluded' ? 'var(--danger)' : COLORS.textSecondary,
          textDecoration: reviewAction === 'excluded' ? 'none' : 'underline'
        }}
      >
        <Trash2 size={12} />
        {reviewAction === 'excluded' ? '已排除本题（点击撤销）' : '排除本题'}
      </button>
    </BottomSheet>
  )
}
