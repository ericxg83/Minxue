import { useEffect, useCallback, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Eye, HelpCircle, Loader2, RefreshCw, X } from 'lucide-react'
import BottomSheet from './BottomSheet'
import MathText from './MathText'
import ImagePreview from './ImagePreview'
import { getExamGradingDetail } from '../services/apiService'
import { normalizeOptions } from '../utils/optionText'

// 组卷「批改详情」逐题卡片视图（2026-10-13 方案三定稿：逐题卡片为主，原卷降级为按需查看）：
// 晚托班老师在手机上打开一份已出结果的重练卷，逐题看「学生答案 vs 参考答案 + 解析」讲题；
// 需要对照答卷原卷时，从「看原卷」进全屏可缩放查看器（当前题加粗高亮）。
//
// 纪律（几何/对位/判定口径与 PC PaperViewerPanel paper 模式同源，见 server/utils/gradingDetailView.js）：
//   · 判定用 marks[].verdict（服务端人工复核优先口径），本组件只展示、不判题、
//     不提供任何改判入口 —— 改判归 PC 复核台。
//   · matchedBy='none'（图上无作答痕迹）的题只在顶部给事实提示 + 答案位文案说明，
//     不标注、不改判 —— 缺痕迹 ≠ 未作答，判定仍归老师。
//   · marks[].question 是 questions 表权威内容（题干/选项/答案/解析），与几何对位解耦；
//     查不到按「暂无题目内容」降级，绝不用 OCR 文本伪造题干。
//   · 原卷查看器的定位框只认 retryAlign 答卷图坐标系（bbox 0-1000 归一化），框不准
//     只是参考信息，不再阻塞主流程；无 retryAlign 的旧卷自然降级为纯看图。
//
// 交互复用移动端「批改复核」（src/pages/ExamReview/index.jsx）已验证模式：
// 横向题号导航 + 左右滑动切题 + 答案双栏 + 解析折叠；滑动参数与其逐字一致。

const VERDICT_META = {
  correct: { fg: 'var(--success)', soft: 'var(--success-soft)', Icon: Check, label: '正确' },
  wrong: { fg: 'var(--danger)', soft: 'var(--danger-soft)', Icon: X, label: '错误' },
  unjudged: { fg: 'var(--warning)', soft: 'var(--warning-soft)', Icon: HelpCircle, label: '未判定' },
}

const TYPE_TEXT = { choice: '选择题', fill: '填空题', judge: '判断题', answer: '解答题' }

// 答案超过这个字符数就不挤两列：与 ExamReview 同口径（窄列塞长答案比整宽单列更费高度）
const ANSWER_STACK_THRESHOLD = 14

// ── 左右滑动切题的手感参数（与 ExamReview 同款，改一个地方就要想两边） ──
const SWIPE_FORWARD_SIGN = -1       // 手指位移为负（向左）时前进
const SWIPE_AXIS_LOCK_PX = 8        // 定主轴前允许的抖动
const SWIPE_COMMIT_PX = 44          // 慢拖时触发切题的位移
const SWIPE_FLICK_PX = 24           // 快速轻扫的最小位移
const SWIPE_FLICK_MS = 260          // 快速轻扫的时间上限
const SWIPE_FOLLOW_RATIO = 0.32     // 跟手位移的阻尼
const SWIPE_EDGE_RATIO = 0.1        // 已在首/末题时的阻尼（撞墙手感）

/** 题号导航：横向圆点（当前题实心 + 对错色点），窄屏横向滚动 */
function QuestionNav({ marks, currentIndex, onJump }) {
  return (
    <div
      className='flex gap-1.5 overflow-x-auto px-5 pb-2'
      style={{ scrollbarWidth: 'none', borderBottom: '1px solid var(--border-light)' }}
    >
      {marks.map((m, i) => {
        const meta = VERDICT_META[m.verdict] || VERDICT_META.unjudged
        const isCurrent = i === currentIndex
        return (
          <button
            key={m.questionId}
            type='button'
            onClick={() => onJump(i)}
            aria-label={`第 ${i + 1} 题 · ${meta.label}`}
            aria-current={isCurrent ? 'true' : undefined}
            className='relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold'
            style={{
              background: isCurrent ? meta.fg : 'var(--bg-secondary)',
              color: isCurrent ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {i + 1}
            {!isCurrent && (
              <span
                className='absolute rounded-full'
                style={{ width: 8, height: 8, right: -1, top: -1, background: meta.fg, border: '1.5px solid #fff' }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

/** 逐题卡片：题干 / 选项 / 学生答案 vs 参考答案 / 解析（折叠）/ 看原卷入口 */
function QuestionCard({ mark, index, hasPages, onViewPaper }) {
  // 解析展开态挂在卡片上：父组件按 questionId 做 key，切题天然重置
  const [showAnalysis, setShowAnalysis] = useState(false)
  const meta = VERDICT_META[mark.verdict] || VERDICT_META.unjudged
  const q = mark.question
  const options = normalizeOptions(q?.options)
  const optionList = Array.isArray(options) ? options : []
  const studentAnswer = mark.studentAnswer || ''
  const refAnswer = q?.answer || ''
  const stackAnswers = String(studentAnswer).length > ANSWER_STACK_THRESHOLD
    || String(refAnswer).length > ANSWER_STACK_THRESHOLD

  return (
    <div className='rounded-2xl border p-3.5' style={{ borderColor: 'var(--border-light)' }}>
      {/* 题头：第 N 题 / 原卷题号 / 题型 + 判定 chip（判定只说一次，不与导航圆点重复） */}
      <div className='flex items-start justify-between gap-2'>
        <div className='flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5'>
          <span className='text-[15px] font-semibold' style={{ color: 'var(--text)' }}>第 {index + 1} 题</span>
          {q?.questionNumber != null && (
            <span className='text-[11px]' style={{ color: 'var(--text-secondary)' }}>原卷第 {q.questionNumber} 题</span>
          )}
          {q?.questionType && (
            <span className='text-[11px]' style={{ color: 'var(--text-secondary)' }}>{TYPE_TEXT[q.questionType] || '解答题'}</span>
          )}
        </div>
        <span
          className='inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold'
          style={{ background: meta.soft, color: meta.fg }}
        >
          <meta.Icon size={11} strokeWidth={3} />{meta.label}
        </span>
      </div>

      {/* 题干（权威数据，查不到才降级） */}
      {q?.content ? (
        <div className='mt-2 text-[14px] leading-6' style={{ color: 'var(--text)' }}>
          <MathText content={q.content} />
        </div>
      ) : (
        <p className='mt-2 text-[13px]' style={{ color: 'var(--text-tertiary)' }}>暂无题目内容</p>
      )}

      {/* 选项：标号由展示层按下标生成（normalizeOptions 已剥 OCR 转录的原印标号） */}
      {optionList.length > 0 && (
        <div className='mt-1.5 grid grid-cols-2 gap-x-4'>
          {optionList.map((opt, i) => (
            <div key={i} className='text-[13px] leading-6' style={{ color: 'var(--text)' }}>
              {String.fromCharCode(65 + i)}. <MathText content={opt} />
            </div>
          ))}
        </div>
      )}

      {/* 学生答案 vs 参考答案：短答案两列对照，长答案整宽单列 */}
      <div
        className='mt-2.5 flex border-y py-2'
        style={{ flexDirection: stackAnswers ? 'column' : 'row', gap: stackAnswers ? 8 : 0, borderColor: 'var(--border-light)' }}
      >
        <div className='min-w-0 flex-1'>
          <p className='text-[11px]' style={{ color: 'var(--text-secondary)' }}>学生答案</p>
          {studentAnswer ? (
            <p
              className='mt-0.5 text-[15px] font-semibold leading-6'
              style={{ color: mark.verdict === 'wrong' ? 'var(--danger)' : 'var(--text)' }}
            >
              <MathText content={studentAnswer} />
            </p>
          ) : (
            <p className='mt-0.5 text-[13px]' style={{ color: 'var(--text-tertiary)' }}>
              {mark.matchedBy === 'none' ? '答卷上无作答痕迹' : '未识别到作答'}
            </p>
          )}
        </div>
        {stackAnswers
          ? <div className='h-px' style={{ background: 'var(--border-light)' }} />
          : <div className='mx-3 w-px shrink-0' style={{ background: 'var(--border-light)' }} />}
        <div className='min-w-0 flex-1'>
          <p className='text-[11px]' style={{ color: 'var(--text-secondary)' }}>参考答案</p>
          {refAnswer ? (
            <p className='mt-0.5 text-[15px] font-semibold leading-6' style={{ color: 'var(--text)' }}>
              <MathText content={refAnswer} />
            </p>
          ) : (
            <p className='mt-0.5 text-[13px]' style={{ color: 'var(--text-tertiary)' }}>暂无</p>
          )}
        </div>
      </div>

      {/* 解析：折叠展开；AI 自检不过时给红色警示（口径同 ExamReview） */}
      <div className='mt-2'>
        <button
          type='button'
          onClick={() => setShowAnalysis(v => !v)}
          className='flex items-center gap-1 py-1 text-[12px] font-medium'
          style={{ color: 'var(--text-secondary)' }}
        >
          {showAnalysis ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showAnalysis ? '收起解析' : '查看解析'}
        </button>
        {showAnalysis && (
          <div className='mt-1 rounded-lg px-2.5 py-2' style={{ background: 'var(--bg-mist)' }}>
            {q?.aiSelfCheckPassed === false && (
              <div
                className='mb-1.5 rounded-md px-2 py-1.5 text-[11px] leading-5'
                style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
              >
                <strong>⚠ AI 解析可能不准确</strong>
                <span style={{ color: 'var(--text-secondary)' }}>
                  （{(q.aiSelfCheckIssues || []).join(' / ')}），请人工核对
                </span>
              </div>
            )}
            {q?.analysis ? (
              <div className='text-[13px] leading-6' style={{ color: 'var(--text)' }}>
                <MathText content={q.analysis} />
              </div>
            ) : (
              <p className='text-[12px]' style={{ color: 'var(--text-tertiary)' }}>暂无解析</p>
            )}
          </div>
        )}
      </div>

      {/* 看原卷：按需进入全屏查看器（当前题所在页，无页码回退第 1 页） */}
      <div className='mt-2.5 flex items-center justify-between'>
        <button
          type='button'
          onClick={onViewPaper}
          disabled={!hasPages}
          className='inline-flex items-center gap-1 py-1 text-[12px] font-semibold disabled:opacity-40'
          style={{ color: 'var(--primary)' }}
        >
          <Eye size={13} />看原卷
        </button>
        <span className='text-[11px]' style={{ color: 'var(--text-tertiary)' }}>左右滑动切题</span>
      </div>
    </div>
  )
}

/** 全屏原卷查看器：可缩放大图 + 当前题加粗高亮 + 翻页 */
function PaperViewer({ pages, marks, page, currentIndex, onClose, onPageChange }) {
  const current = marks[currentIndex]
  return (
    <div className='fixed inset-0 z-[30000] flex flex-col' style={{ background: 'rgba(0,0,0,0.95)' }}>
      <div className='flex items-center justify-between px-4 py-3'>
        <span className='text-[13px]' style={{ color: 'rgba(255,255,255,0.75)' }}>
          第 {page} 页<span style={{ color: 'rgba(255,255,255,0.45)' }}> / </span>共 {pages.length} 页
        </span>
        <span className='text-[11px]' style={{ color: 'rgba(255,255,255,0.5)' }}>双击放大 · 双指缩放 · 拖动查看</span>
        <button
          type='button'
          onClick={onClose}
          aria-label='关闭预览'
          className='flex h-8 w-8 items-center justify-center rounded-full'
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          <X size={16} style={{ color: '#fff' }} />
        </button>
      </div>
      <ImagePreview src={pages[page - 1]?.imageUrl}>
        {marks.map((m, i) => {
          if (m.page !== page || !m.bbox) return null
          const meta = VERDICT_META[m.verdict] || VERDICT_META.unjudged
          const isCurrent = m.questionId === current?.questionId
          return (
            <div
              key={m.questionId}
              className='absolute'
              style={{
                left: `${m.bbox.x / 10}%`,
                top: `${m.bbox.y / 10}%`,
                width: `${m.bbox.width / 10}%`,
                height: `${m.bbox.height / 10}%`,
                border: `${isCurrent ? 2.5 : 1.5}px solid ${meta.fg}`,
                borderRadius: 3,
                opacity: isCurrent ? 1 : 0.75,
                pointerEvents: 'none',
              }}
            >
              <span
                className='absolute flex items-center justify-center rounded-full font-semibold text-white'
                style={{
                  width: isCurrent ? 18 : 14, height: isCurrent ? 18 : 14,
                  left: 0, top: 0, transform: 'translate(-50%, -50%)',
                  background: meta.fg, border: '1.5px solid #fff',
                  fontSize: isCurrent ? 10 : 9,
                }}
              >
                {i + 1}
              </span>
            </div>
          )
        })}
      </ImagePreview>
      <div className='flex items-center justify-between px-4 pb-5 pt-2'>
        <button
          type='button'
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label='上一页'
          className='flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-30'
          style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
        >
          <ChevronDown size={16} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <span
          className='rounded-full px-3 py-1.5 text-[12px] font-semibold'
          style={{ background: '#fff', color: 'var(--text)' }}
        >
          {current?.page === page ? `第 ${currentIndex + 1} 题 · 重练答卷` : `第 ${page} 页`}
        </span>
        <button
          type='button'
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages.length}
          aria-label='下一页'
          className='flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-30'
          style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
        >
          <ChevronDown size={16} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className='flex flex-col items-center gap-2.5 py-16'>
      <Loader2 size={22} className='animate-spin' style={{ color: 'var(--primary)' }} />
      <p className='text-[13px]' style={{ color: 'var(--text-secondary)' }}>正在加载批改详情…</p>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className='flex flex-col items-center gap-3 py-16'>
      <AlertTriangle size={24} style={{ color: 'var(--danger)' }} />
      <div className='text-center'>
        <p className='text-[14px] font-medium' style={{ color: 'var(--text)' }}>批改详情加载失败</p>
        <p className='mt-1 text-[12px]' style={{ color: 'var(--text-secondary)' }}>{message}，请检查网络后重试</p>
      </div>
      <button
        type='button'
        onClick={onRetry}
        className='flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white transition-transform active:scale-[0.98]'
        style={{ background: 'var(--primary)' }}
      >
        <RefreshCw size={13} />重新加载
      </button>
    </div>
  )
}

function EmptyState({ hasAnswerSheet }) {
  return (
    <div className='flex flex-col items-center gap-2 py-16'>
      <div className='flex h-12 w-12 items-center justify-center rounded-full' style={{ background: 'var(--bg-mist)' }}>
        <HelpCircle size={20} style={{ color: 'var(--text-tertiary)' }} />
      </div>
      <p className='text-[14px] font-medium' style={{ color: 'var(--text)' }}>
        {hasAnswerSheet ? '答卷照片已失效' : '还没有上传答卷照片'}
      </p>
      <p className='px-6 text-center text-[12px]' style={{ color: 'var(--text-secondary)' }}>
        {hasAnswerSheet ? '图片可能已过期，请从组卷详情重新上传答卷' : '上传答卷批改完成后，这里会显示每题的对错与解析'}
      </p>
    </div>
  )
}

export default function GradingDetailSheet({ exam, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, detail: null })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewerPage, setViewerPage] = useState(null)
  const [dragX, setDragX] = useState(0)

  const load = () => {
    setState({ loading: true, error: null, detail: null })
    setCurrentIndex(0)
    setViewerPage(null)
    getExamGradingDetail(exam.id)
      .then(detail => setState({ loading: false, error: null, detail }))
      .catch(e => setState({ loading: false, error: e?.message || '网络异常', detail: null }))
  }
  useEffect(() => { load() }, [exam?.id])

  const detail = state.detail
  const marks = detail?.marks || []
  const pages = detail?.pages || []
  const counts = marks.reduce(
    (acc, m) => { acc[m.verdict] = (acc[m.verdict] || 0) + 1; return acc },
    { correct: 0, wrong: 0, unjudged: 0 }
  )
  // 无作答痕迹题（matchedBy='none'）→ 事实提示，不改判定（缺痕迹 ≠ 未作答）。
  // 题号用题单序号（与导航圆点、卡片「第 N 题」同一口径），不是过滤后数组的下标
  const noTraceLabels = []
  marks.forEach((m, i) => { if (m.matchedBy === 'none') noTraceLabels.push(i + 1) })
  const current = marks[currentIndex] || null

  const jumpTo = useCallback((i) => {
    setCurrentIndex(Math.max(0, Math.min(marks.length - 1, i)))
  }, [marks.length])

  // ── 左右滑动切题（参数与 ExamReview 同款；纵向滚动优先，首末题撞墙阻尼） ──
  const swipeRef = useRef(null)
  const swallowClickRef = useRef(false)

  const handleTouchStart = useCallback((e) => {
    swallowClickRef.current = false
    if (viewerPage != null || e.touches.length !== 1) {
      swipeRef.current = null
      return
    }
    const t = e.touches[0]
    swipeRef.current = { x0: t.clientX, y0: t.clientY, t0: Date.now(), axis: null, dx: 0 }
  }, [viewerPage])

  const handleTouchMove = useCallback((e) => {
    const s = swipeRef.current
    if (!s || e.touches.length !== 1) return
    const dx = e.touches[0].clientX - s.x0
    const dy = e.touches[0].clientY - s.y0
    if (s.axis === null) {
      if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) return
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (s.axis !== 'x') return
    s.dx = dx
    const blocked = dx * SWIPE_FORWARD_SIGN > 0 ? currentIndex >= marks.length - 1 : currentIndex <= 0
    setDragX(dx * (blocked ? SWIPE_EDGE_RATIO : SWIPE_FOLLOW_RATIO))
  }, [currentIndex, marks.length])

  const handleTouchEnd = useCallback(() => {
    const s = swipeRef.current
    swipeRef.current = null
    setDragX(0)
    if (!s || s.axis !== 'x') return
    const flick = Date.now() - s.t0 < SWIPE_FLICK_MS && Math.abs(s.dx) >= SWIPE_FLICK_PX
    if (Math.abs(s.dx) < SWIPE_COMMIT_PX && !flick) return
    // 手势结束后浏览器仍会补发一次 click：吞掉，免横滑过「看原卷」顺手弹出查看器
    swallowClickRef.current = true
    jumpTo(currentIndex + (s.dx * SWIPE_FORWARD_SIGN > 0 ? 1 : -1))
  }, [currentIndex, jumpTo])

  const handleClickCapture = useCallback((e) => {
    if (!swallowClickRef.current) return
    swallowClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const openViewer = useCallback((page) => {
    if (pages.length === 0) return
    setViewerPage(Math.max(1, Math.min(pages.length, page || 1)))
  }, [pages.length])

  return (
    <BottomSheet
      title='批改详情'
      onClose={onClose}
      maxWidth={560}
      titleAction={pages.length > 0 ? (
        <button
          type='button'
          onClick={() => openViewer(current?.page)}
          className='mr-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold'
          style={{ background: 'var(--bg-mist)', color: 'var(--primary)' }}
        >
          <Eye size={13} />原卷
        </button>
      ) : null}
      header={marks.length > 1 ? <QuestionNav marks={marks} currentIndex={currentIndex} onJump={jumpTo} /> : null}
      bodyProps={{
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
        onTouchCancel: handleTouchEnd,
        onClickCapture: handleClickCapture,
        style: {
          touchAction: 'pan-y',
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragX ? 'none' : 'transform 0.18s ease-out',
        },
      }}
    >
      {state.loading && <LoadingState />}
      {!state.loading && state.error && <ErrorState message={state.error} onRetry={load} />}
      {!state.loading && !state.error && detail && (
        <>
          {/* 结果摘要：语义色 soft 底计数格，即图例（正确/错误恒显，未判定有数才显） */}
          {(() => {
            const keys = ['correct', 'wrong', ...(counts.unjudged > 0 ? ['unjudged'] : [])]
            const three = keys.length === 3
            return (
              <div className={`mb-3 grid gap-2.5 ${three ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {keys.map(key => {
                  const meta = VERDICT_META[key]
                  const { Icon } = meta
                  return (
                    <div key={key} className='flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3' style={{ background: meta.soft }}>
                      <span className='flex h-7 w-7 items-center justify-center rounded-full text-white' style={{ background: meta.fg }}>
                        <Icon size={13} strokeWidth={3} />
                      </span>
                      <span className='text-[18px] font-semibold leading-none' style={{ color: meta.fg }}>{counts[key]}</span>
                      <span className='text-[11px]' style={{ color: 'var(--text-secondary)' }}>{meta.label}</span>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {noTraceLabels.length > 0 && (
            <div className='mb-3 flex items-start gap-2 rounded-2xl px-3.5 py-3' style={{ background: 'var(--warning-soft)' }}>
              <AlertTriangle size={14} className='mt-0.5 shrink-0' style={{ color: 'var(--warning)' }} />
              <p className='text-[12px] leading-5' style={{ color: 'var(--text-secondary)' }}>
                第 {noTraceLabels.join('、')} 题在答卷照片上没有找到作答痕迹，可能是漏拍或未作答，
                请对照纸质卷确认，以老师复核结果为准。
              </p>
            </div>
          )}

          {pages.length === 0
            ? <EmptyState hasAnswerSheet={detail.hasAnswerSheet} />
            : current && (
              <>
                <QuestionCard
                  key={current.questionId}
                  mark={current}
                  index={currentIndex}
                  hasPages
                  onViewPaper={() => openViewer(current.page)}
                />
                <p className='pb-1 pt-2.5 text-center text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
                  对错以老师复核结果为准
                </p>
              </>
            )}
          {pages.length > 0 && !current && (
            <p className='py-10 text-center text-[13px]' style={{ color: 'var(--text-secondary)' }}>这份卷还没有题目</p>
          )}
        </>
      )}

      {viewerPage != null && pages.length > 0 && (
        <PaperViewer
          pages={pages}
          marks={marks}
          page={viewerPage}
          currentIndex={currentIndex}
          onClose={() => setViewerPage(null)}
          onPageChange={p => setViewerPage(Math.max(1, Math.min(pages.length, p)))}
        />
      )}
    </BottomSheet>
  )
}
