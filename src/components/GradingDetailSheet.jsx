import { useEffect, useCallback, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Eye, HelpCircle, Loader2, RefreshCw, X } from 'lucide-react'
import BottomSheet from './BottomSheet'
import MathText from './MathText'
import ImagePreview from './ImagePreview'
import { getExamGradingDetail } from '../services/apiService'
import { normalizeOptions } from '../utils/optionText'

// 组卷「批改详情」双视图（2026-10-13 方案四定稿：原卷优先，点框出卡）：
// 晚托班老师讲错题的锚点是手里的纸质卷 —— 默认进「原卷」可缩放视图，点题目框/编号徽标
// 弹出该题卡片（学生答案 vs 参考答案 + 解析）；「逐题」tab 保留卡片流，错题多时按序过一遍。
// 无答卷页图（pages 空）时自动回退逐题视图并禁用原卷 tab。
//
// 纪律（几何/对位/判定口径与 PC PaperViewerPanel paper 模式同源，见 server/utils/gradingDetailView.js）：
//   · 判定用 marks[].verdict（服务端人工复核优先口径），本组件只展示、不判题、
//     不提供任何改判入口 —— 改判归 PC 复核台。
//   · matchedBy='none'（图上无作答痕迹）的题只给事实提示 + 答案位文案说明，
//     不标注、不改判 —— 缺痕迹 ≠ 未作答，判定仍归老师。
//   · marks[].question 是 questions 表权威内容（题干/选项/答案/解析），与几何对位解耦；
//     查不到按「暂无题目内容」降级，绝不用 OCR 文本伪造题干。
//   · 原卷叠加框只认 retryAlign 答卷图坐标系（bbox 0-1000 归一化），框只承担「定位入口」
//     职责：点错了关掉即可，卡片段落里的题干文字负责确认是哪道题。对位错框（框画到别的
//     题上）属上游识别质量，本层不修数据，靠弹卡兜底。
//   · 徽标文字用 mark.label（卷面题号，如 4(2)），与印刷卷对照；叠加层渲染按
//     (page, y, x) 排序，保证命中与遮挡顺序稳定（不解决上游错位框）。
//
// 交互复用移动端「批改复核」（src/pages/ExamReview/index.jsx）已验证模式：
// 左右滑动切题 + 答案双栏 + 解析折叠；滑动参数与其逐字一致。

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
function QuestionCard({ mark, index, hasPages, onViewPaper, hint = '左右滑动切题' }) {
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

      {/* 看原卷：切回原卷 tab 并定位到该题所在页（卡片弹层里则先收起弹层） */}
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
        {hint && <span className='text-[11px]' style={{ color: 'var(--text-tertiary)' }}>{hint}</span>}
      </div>
    </div>
  )
}

/** 原卷叠加框：bbox 定位 + 卷面题号徽标；框体/徽标都可点（命中区外扩 8px 好点中） */
function PaperMarkBox({ mark, isCurrent, onTap }) {
  const meta = VERDICT_META[mark.verdict] || VERDICT_META.unjudged
  const { bbox } = mark
  const label = mark.label || ''
  return (
    <div
      className='absolute'
      style={{
        left: `${bbox.x / 10}%`,
        top: `${bbox.y / 10}%`,
        width: `${bbox.width / 10}%`,
        height: `${bbox.height / 10}%`,
        border: `${isCurrent ? 2.5 : 1.5}px solid ${meta.fg}`,
        borderRadius: 3,
        opacity: isCurrent ? 1 : 0.7,
        pointerEvents: 'none', // 视觉层不挡手势；命中交给下面的热区
      }}
    >
      {/* 命中区：比可见框大一圈，缩放/平移后命中判定由浏览器按 transform 原生处理 */}
      <div
        aria-label={`第 ${label || ''} 题 · ${meta.label}`}
        role='button'
        className='absolute'
        style={{ inset: -8, pointerEvents: 'auto', cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); onTap(mark) }}
      />
      <span
        role='button'
        aria-label={`第 ${label || ''} 题 · ${meta.label}`}
        className='absolute flex items-center justify-center whitespace-nowrap rounded-full font-semibold text-white'
        style={{
          minWidth: isCurrent ? 18 : 15,
          height: isCurrent ? 18 : 15,
          padding: '0 3px',
          left: 0, top: 0, transform: 'translate(-50%, -50%)',
          background: meta.fg, border: '1.5px solid #fff',
          fontSize: isCurrent ? 10 : 9,
          pointerEvents: 'auto', cursor: 'pointer',
        }}
        onClick={e => { e.stopPropagation(); onTap(mark) }}
      >
        {label}
      </span>
    </div>
  )
}

/** 原卷视图（默认）：摘要条 + 可缩放原卷（点框出卡）+ 翻页 */
function PaperPane({ pages, paperMarks, page, focusMark, onTapMark, onPageChange }) {
  const meta = focusMark ? (VERDICT_META[focusMark.verdict] || VERDICT_META.unjudged) : null
  return (
    <>
      <div className='relative flex' style={{ height: 'min(60vh, 560px)' }}>
        <ImagePreview key={page} src={pages[page - 1]?.imageUrl}>
          {paperMarks.map(m => (
            m.page === page && m.bbox ? (
              <PaperMarkBox
                key={m.questionId}
                mark={m}
                isCurrent={m.questionId === focusMark?.questionId}
                onTap={onTapMark}
              />
            ) : null
          ))}
        </ImagePreview>
      </div>
      <div className='flex items-center justify-between pt-1.5'>
        <button
          type='button'
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label='上一页'
          className='flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30'
          style={{ background: 'var(--bg-mist)', color: 'var(--text-secondary)' }}
        >
          <ChevronDown size={15} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <span className='text-[12px] font-semibold' style={{ color: 'var(--text-secondary)' }}>
          第 {page} 页 · 共 {pages.length} 页
          {focusMark && focusMark.page === page && (
            <span style={{ color: meta.fg }}> · 卷面第 {focusMark.label || ''} 题{meta.label}</span>
          )}
        </span>
        <button
          type='button'
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages.length}
          aria-label='下一页'
          className='flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30'
          style={{ background: 'var(--bg-mist)', color: 'var(--text-secondary)' }}
        >
          <ChevronDown size={15} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      </div>
      <p className='pb-1 pt-1.5 text-center text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
        双击 / 双指缩放 · 点题目框查看该题解析与答案
      </p>
    </>
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
  const [mode, setMode] = useState('paper')            // 'paper'（默认原卷）| 'cards'（逐题）
  const [paperPage, setPaperPage] = useState(null)     // 原卷页码；null = 跟随焦点题所在页
  const [focusId, setFocusId] = useState(null)         // 原卷上高亮/最近查看的题
  const [popupQid, setPopupQid] = useState(null)       // 原卷模式下点框弹出的题卡片
  const [currentIndex, setCurrentIndex] = useState(0)  // 逐题模式的当前题
  const [dragX, setDragX] = useState(0)

  const load = () => {
    setState({ loading: true, error: null, detail: null })
    setCurrentIndex(0)
    setPaperPage(null)
    setFocusId(null)
    setPopupQid(null)
    setDragX(0)
    setMode('paper')
    getExamGradingDetail(exam.id)
      .then(detail => setState({ loading: false, error: null, detail }))
      .catch(e => setState({ loading: false, error: e?.message || '网络异常', detail: null }))
  }
  useEffect(() => { load() }, [exam?.id])

  const detail = state.detail
  const marks = detail?.marks || []
  const pages = detail?.pages || []
  const hasPages = pages.length > 0
  // 实际生效模式：没有页图时原卷无从谈起，强制逐题
  const effMode = hasPages ? mode : 'cards'
  const counts = marks.reduce(
    (acc, m) => { acc[m.verdict] = (acc[m.verdict] || 0) + 1; return acc },
    { correct: 0, wrong: 0, unjudged: 0 }
  )
  // 无作答痕迹题（matchedBy='none'）→ 事实提示，不改判定（缺痕迹 ≠ 未作答）。
  // 题号用题单序号（与导航圆点、卡片「第 N 题」同一口径），不是过滤后数组的下标
  const noTraceLabels = []
  marks.forEach((m, i) => { if (m.matchedBy === 'none') noTraceLabels.push(i + 1) })

  // 原卷叠加层：只画有框有页的题，按 (page, y, x) 排序 —— 徽标自上而下与卷面同序，
  // 命中/遮挡顺序稳定。徽标文字用 mark.label（卷面题号），上游错位框本层不修。
  const paperMarks = marks
    .filter(m => m.bbox && m.page)
    .sort((a, b) => (a.page - b.page) || (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x))

  // 原卷焦点题：显式 focusId 优先，否则默认第一道错题（老师最关心的），再退到第一题
  const focusMark = (focusId && marks.find(m => m.questionId === focusId))
    || paperMarks.find(m => m.verdict === 'wrong')
    || paperMarks[0]
    || null
  const activePage = Math.max(1, Math.min(paperPage ?? focusMark?.page ?? 1, pages.length || 1))

  const current = marks[currentIndex] || null
  const popupMark = popupQid ? marks.find(m => m.questionId === popupQid) : null
  const popupIndex = popupMark ? marks.indexOf(popupMark) : 0

  const jumpTo = useCallback((i) => {
    setCurrentIndex(Math.max(0, Math.min(marks.length - 1, i)))
  }, [marks.length])

  // ── tab 切换：两边互相同步焦点（原卷焦点题 ↔ 逐题当前题） ──
  const switchMode = useCallback((next) => {
    if (next === 'paper' && !hasPages) return
    setPopupQid(null)
    if (next === 'paper') {
      const cm = marks[currentIndex]
      if (cm) {
        setFocusId(cm.questionId)
        if (cm.page) setPaperPage(cm.page)
      }
    } else if (focusMark) {
      const idx = marks.findIndex(m => m.questionId === focusMark.questionId)
      if (idx >= 0) setCurrentIndex(idx)
    }
    setMode(next)
  }, [hasPages, marks, currentIndex, focusMark])

  // 原卷翻页：焦点顺移到该页第一题，底部「卷面第 N 题」跟着走
  const gotoPage = useCallback((p) => {
    const next = Math.max(1, Math.min(p, pages.length))
    setPaperPage(next)
    const first = paperMarks.find(m => m.page === next)
    if (first) setFocusId(first.questionId)
  }, [pages.length, paperMarks])

  // 点框出卡：同时设为焦点（关掉卡片后该框保持加粗高亮）
  const tapMark = useCallback((m) => {
    setFocusId(m.questionId)
    setPopupQid(m.questionId)
  }, [])

  // 逐题卡片的「看原卷」：切 tab + 定位页码 + 高亮该题
  const viewPaperFromCard = useCallback((m) => {
    setPopupQid(null)
    setFocusId(m.questionId)
    if (m.page) setPaperPage(m.page)
    setMode('paper')
  }, [])

  // ── 逐题模式：左右滑动切题（参数与 ExamReview 同款；纵向滚动优先，首末题撞墙阻尼） ──
  const swipeRef = useRef(null)
  const swallowClickRef = useRef(false)

  const handleTouchStart = useCallback((e) => {
    swallowClickRef.current = false
    if (e.touches.length !== 1) {
      swipeRef.current = null
      return
    }
    const t = e.touches[0]
    swipeRef.current = { x0: t.clientX, y0: t.clientY, t0: Date.now(), axis: null, dx: 0 }
  }, [])

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
    // 手势结束后浏览器仍会补发一次 click：吞掉，免横滑过「看原卷」顺手切 tab
    swallowClickRef.current = true
    jumpTo(currentIndex + (s.dx * SWIPE_FORWARD_SIGN > 0 ? 1 : -1))
  }, [currentIndex, jumpTo])

  const handleClickCapture = useCallback((e) => {
    if (!swallowClickRef.current) return
    swallowClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // 原卷模式不挂横滑手势（ImagePreview 自管捏合/双击/平移），逐题模式才挂
  const bodyProps = effMode === 'cards'
    ? {
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
    }
    : { style: { touchAction: 'pan-y' } }

  const summaryKeys = ['correct', 'wrong', ...(counts.unjudged > 0 ? ['unjudged'] : [])]

  return (
    <BottomSheet
      title='批改详情'
      onClose={onClose}
      maxWidth={560}
      header={(
        <div>
          {/* 原卷 / 逐题 双 tab：原卷默认；无页图时禁用 */}
          <div className='mx-5 mb-2 flex gap-1 rounded-full p-1' style={{ background: 'var(--bg-mist)' }}>
            <button
              type='button'
              onClick={() => switchMode('paper')}
              disabled={!hasPages}
              aria-pressed={effMode === 'paper'}
              className='flex-1 rounded-full py-1.5 text-[12px] font-semibold transition-all disabled:opacity-40'
              style={effMode === 'paper'
                ? { background: 'var(--primary)', color: '#fff' }
                : { color: 'var(--text-secondary)' }}
            >
              原卷
            </button>
            <button
              type='button'
              onClick={() => switchMode('cards')}
              aria-pressed={effMode === 'cards'}
              className='flex-1 rounded-full py-1.5 text-[12px] font-semibold transition-all'
              style={effMode === 'cards'
                ? { background: 'var(--primary)', color: '#fff' }
                : { color: 'var(--text-secondary)' }}
            >
              逐题
            </button>
          </div>
          {effMode === 'cards' && marks.length > 1 && (
            <QuestionNav marks={marks} currentIndex={currentIndex} onJump={jumpTo} />
          )}
        </div>
      )}
      bodyProps={bodyProps}
    >
      {state.loading && <LoadingState />}
      {!state.loading && state.error && <ErrorState message={state.error} onRetry={load} />}
      {!state.loading && !state.error && detail && (
        <>
          {effMode === 'paper' ? (
            <>
              {/* 原卷模式摘要：紧凑 chip 行（大数字网格留在逐题模式） */}
              <div className='mb-2 flex flex-wrap items-center gap-1.5'>
                {summaryKeys.map(key => {
                  const meta = VERDICT_META[key]
                  const { Icon } = meta
                  return (
                    <span
                      key={key}
                      className='inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold'
                      style={{ background: meta.soft, color: meta.fg }}
                    >
                      <Icon size={11} strokeWidth={3} />{counts[key]} {meta.label}
                    </span>
                  )
                })}
              </div>
              <PaperPane
                pages={pages}
                paperMarks={paperMarks}
                page={activePage}
                focusMark={focusMark}
                onTapMark={tapMark}
                onPageChange={gotoPage}
              />
            </>
          ) : (
            <>
              {/* 逐题模式：大数字摘要格（即图例） */}
              <div className={`mb-3 grid gap-2.5 ${summaryKeys.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {summaryKeys.map(key => {
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

              {pages.length === 0
                ? <EmptyState hasAnswerSheet={detail.hasAnswerSheet} />
                : current && (
                  <>
                    <QuestionCard
                      key={current.questionId}
                      mark={current}
                      index={currentIndex}
                      hasPages
                      onViewPaper={() => viewPaperFromCard(current)}
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

          {noTraceLabels.length > 0 && (
            <div className='mb-1 mt-2 flex items-start gap-2 rounded-2xl px-3.5 py-3' style={{ background: 'var(--warning-soft)' }}>
              <AlertTriangle size={14} className='mt-0.5 shrink-0' style={{ color: 'var(--warning)' }} />
              <p className='text-[12px] leading-5' style={{ color: 'var(--text-secondary)' }}>
                第 {noTraceLabels.join('、')} 题在答卷照片上没有找到作答痕迹，可能是漏拍或未作答，
                请对照纸质卷确认，以老师复核结果为准。
              </p>
            </div>
          )}
        </>
      )}

      {/* 原卷模式点框弹出的题卡片：底部面板，点遮罩关闭 */}
      {effMode === 'paper' && popupMark && (
        <div className='fixed inset-0 z-[21000] flex flex-col justify-end' onClick={() => setPopupQid(null)}>
          <div className='absolute inset-0' style={{ background: 'rgba(0,0,0,0.45)' }} />
          <div
            className='relative mx-auto w-full px-3'
            style={{ maxWidth: 560, paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className='relative max-h-[70vh] overflow-y-auto rounded-3xl bg-white p-4'
              style={{ boxShadow: '0 -8px 30px rgba(0,0,0,0.2)' }}
            >
              <button
                type='button'
                onClick={() => setPopupQid(null)}
                aria-label='关闭题目卡片'
                className='absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full'
                style={{ background: 'var(--bg-mist)' }}
              >
                <X size={14} style={{ color: 'var(--text-secondary)' }} />
              </button>
              <QuestionCard
                key={popupMark.questionId}
                mark={popupMark}
                index={popupIndex}
                hasPages
                hint='关掉卡片可继续点其他题目框'
                onViewPaper={() => {
                  setPopupQid(null)
                  setFocusId(popupMark.questionId)
                  if (popupMark.page) setPaperPage(popupMark.page)
                }}
              />
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
