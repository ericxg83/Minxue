import { useState, useMemo, useRef, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Save, Loader2, Trash2, ChevronUp, ChevronDown
} from 'lucide-react'
import MathText from '../../components/MathText'
import BottomSheet from '../../components/BottomSheet'
import { COLORS } from './constants'
import { formatOption, getStatusInfo, DOT_COLORS, StatChip } from './status'
import { useExamReview } from '../../hooks/useExamReview'
import { normalizeOptions } from '../../utils/optionText'

// ── 主组件 ──
export default function ExamReview({ task, onClose, onSave }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const currentIndexRef = useRef(0)
  currentIndexRef.current = currentIndex

  // ── 复审核心逻辑 (数据加载 / 人工评判 / 保存) ──
  const {
    validQuestions,
    wrongIdMap,
    loading,
    edits,
    saving,
    reviewAction,
    stats,
    handleSetReviewAction,
    handleAnswerChange,
    handleAnswerEdit,
    handleSaveClick
  } = useExamReview({ task, onSave, currentIndexRef })

  const currentQuestion = validQuestions[currentIndex] || null
  // 多图一任务：同一份作业上传的页数，用于在复核界面显式提示"这是一份 N 页作业"
  const pageCount = Array.isArray(task?.images) ? task.images.length : 0

  // ── 题号切换 ──
  const jumpToQuestion = useCallback((index) => {
    if (index < 0 || index >= validQuestions.length) return
    setCurrentIndex(index)
    setShowAnswer(false)
  }, [validQuestions.length])

  // ── 计算派生状态 ──
  const correctness = useMemo(() => {
    if (!currentQuestion) return null
    if (edits[currentQuestion.id]?.is_correct !== undefined) {
      return edits[currentQuestion.id].is_correct
    }
    return currentQuestion.is_correct
  }, [currentQuestion, edits])

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

  if (!currentQuestion || validQuestions.length === 0) {
    return (
      <BottomSheet title='批改复核' onClose={onClose}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', minHeight: 200,
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 'var(--fs-16)', color: COLORS.textSecondary }}>
            {validQuestions.length === 0 ? '暂无题目数据' : '题目数据加载异常'}
          </div>
          <button onClick={onClose} style={{
            padding: '10px 24px', background: COLORS.primary, color: '#fff',
            borderRadius: 'var(--radius-12)', fontSize: 'var(--fs-15)', fontWeight: 600,
            border: 'none', cursor: 'pointer'
          }}>返回</button>
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
        <StatChip label="待人工复核" count={stats.uncertain} color={COLORS.warning} bg="var(--warning-soft)" />
        <StatChip label="AI异常" count={stats.error} color="var(--warning)" bg="var(--warning-soft)" />
        <StatChip label="AI正确" count={stats.ai_correct} color={COLORS.success} bg="var(--success-soft)" />
        <StatChip label="AI错误" count={stats.ai_wrong} color={COLORS.danger} bg="var(--danger-soft)" />
      </div>
      <div style={{
        display: 'flex', gap: '6px', padding: '8px 12px', overflowX: 'auto', scrollbarWidth: 'none',
        borderBottom: `1px solid ${COLORS.border}`
      }}>
        {validQuestions.map((q, i) => {
          const info = getStatusInfo(q)
          const dotColor = DOT_COLORS[info.source] || COLORS.warning
          const isCurrent = i === currentIndex
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
              {i + 1}
            </button>
          )
        })}
      </div>
    </>
  )

  // ── 弹窗固定页脚：上一题 / 保存 / 下一题 ──
  const footer = (
    <div style={{
      display: 'flex', gap: '8px', padding: '8px 12px',
      borderTop: `1px solid ${COLORS.border}`, background: COLORS.card
    }}>
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
        disabled={currentIndex >= validQuestions.length - 1}
        style={{
          flex: 1, padding: '8px', borderRadius: 'var(--radius-8)',
          border: `1px solid ${COLORS.border}`,
          background: COLORS.card,
          cursor: currentIndex >= validQuestions.length - 1 ? 'not-allowed' : 'pointer',
          fontSize: 'var(--fs-13)', color: currentIndex >= validQuestions.length - 1 ? '#CCC' : COLORS.textSecondary,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
        }}
      >
        下一题 <ChevronRight size={14} />
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
            第 {currentIndex + 1} 题
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

      {/* 题干 */}
      <div style={{ fontSize: '14.5px', color: COLORS.text, lineHeight: '1.65', marginBottom: '8px' }}>
        <MathText content={currentQuestion?.content || ''} />
      </div>

      {/* 选项 */}
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

      {/* 几何配图 */}
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

      {/* 答案对比区 */}
      <div style={{
        background: COLORS.background, borderRadius: 'var(--radius-8)', padding: '8px 10px',
        marginBottom: '8px'
      }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-11)', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>学生答案</div>
            <input
              type="text"
              value={currentStudentAnswer || ''}
              onChange={(e) => handleAnswerChange(currentQuestion.id, e.target.value)}
              placeholder={answerStatus === 'not_answered' ? '未作答' : '输入...'}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 'var(--radius-5)',
                border: `1px solid ${answerStatus === 'not_answered' ? COLORS.warning : COLORS.border}`,
                fontSize: 'var(--fs-13)', color: COLORS.text, outline: 'none',
                boxSizing: 'border-box', background: COLORS.card
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-11)', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '2px' }}>参考答案</div>
            <input
              type="text"
              value={edits[currentQuestion?.id]?.answer ?? currentQuestion?.answer ?? ''}
              onChange={(e) => handleAnswerEdit(currentQuestion?.id, e.target.value)}
              placeholder="输入..."
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 'var(--radius-5)',
                border: `1px solid ${COLORS.border}`,
                fontSize: 'var(--fs-13)', color: COLORS.text,
                outline: 'none', boxSizing: 'border-box', background: COLORS.card
              }}
            />
          </div>
        </div>

        {/* 人工评判 */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => handleSetReviewAction('correct')}
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
            onClick={() => handleSetReviewAction('wrong')}
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
        {/* 排除本题 */}
        <div style={{ marginTop: '6px' }}>
          <button
            onClick={() => handleSetReviewAction('excluded')}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 'var(--radius-8)',
              border: (reviewAction === 'excluded') ? '2px solid var(--danger)' : '1px solid var(--danger-soft)',
              cursor: 'pointer', fontSize: 'var(--fs-13)', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              background: (reviewAction === 'excluded') ? '#FFF1F0' : '#FFF8F5',
              color: (reviewAction === 'excluded') ? 'var(--danger)' : 'var(--danger)',
            }}
          >
            <Trash2 size={14} /> 排除本题
          </button>
        </div>
      </div>

      {/* 解析 */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: '8px' }}>
        <button
          onClick={() => setShowAnswer(!showAnswer)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: 'var(--fs-12)', color: COLORS.textSecondary, padding: 0, width: '100%',
            justifyContent: 'flex-start'
          }}
        >
          {showAnswer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span style={{ fontWeight: 500 }}>
            {showAnswer ? '收起解析' : '查看解析'}
          </span>
        </button>
        {showAnswer && (
          <div style={{ marginTop: '6px' }}>
            <div style={{ padding: '8px 10px', background: `${COLORS.success}08`, borderRadius: 'var(--radius-6)' }}>
              <div style={{ fontSize: 'var(--fs-13)', color: COLORS.text, lineHeight: '1.6' }}>
                <MathText content={currentQuestion?.analysis || '暂无解析'} />
              </div>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
