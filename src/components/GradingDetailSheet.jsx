import { useEffect, useState } from 'react'
import { AlertTriangle, Check, HelpCircle, Loader2, RefreshCw, X } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { getExamGradingDetail } from '../services/apiService'

// 组卷「批改详情」标注视图（2026-09-15 P1，16:30 视觉打磨）：
// 晚托班老师在手机上打开一份已出结果的重练卷，看答卷图上每题的勾/叉标注，
// 对照学生手里的纸质卷逐题讲解。
//
// 纪律（与 PC PaperViewerPanel paper 模式同源，见 server/utils/gradingDetailView.js）：
//   · 定位框只认 retryAlign 的【答卷图坐标系】坐标（bbox 为 0-1000 归一化），
//     服务端已按「text_bbox ∪ image_bbox 并集 → block_coordinates」取框；
//     bbox=null 的题不画框（缺痕迹/旧数据），绝无回退坐标。
//   · 判定用 marks[].verdict（服务端人工复核优先口径），本组件只展示、
//     不判题、不提供任何改判入口 —— 改判归 PC 复核台。
//   · matchedBy='none'（图上无作答痕迹）的题只在顶部给事实提示，
//     不标注、不改判 —— 缺痕迹 ≠ 未作答，判定仍归老师。
//   · 无 retryAlign 的旧卷自然降级为纯看图（marks 全部 bbox=null）。
//
// 视觉口径（MINXUE_UI_DESIGN_SYSTEM）：三态只用既有状态语义色（success/danger/warning
// 的 fg + soft 底），小面积状态色；不画图例（摘要即是图例，不重复表达）；
// 定位框细线低干扰、徽标小圆点紧贴框角，不遮挡学生笔迹。

const VERDICT_META = {
  correct: { fg: 'var(--success)', soft: 'var(--success-soft)', Icon: Check, label: '正确' },
  wrong: { fg: 'var(--danger)', soft: 'var(--danger-soft)', Icon: X, label: '错误' },
  unjudged: { fg: 'var(--warning)', soft: 'var(--warning-soft)', Icon: HelpCircle, label: '未判定' },
}

/** 框角徽标：18px 圆点贴框左上角，白描边在照片上保持清晰 */
function MarkBadge({ verdict }) {
  const meta = VERDICT_META[verdict] || VERDICT_META.unjudged
  const { Icon } = meta
  return (
    <span
      className='absolute flex items-center justify-center rounded-full text-white'
      style={{
        width: 18, height: 18, left: 0, top: 0,
        transform: 'translate(-50%, -50%)',
        background: meta.fg,
        border: '2px solid #fff',
        boxShadow: '0 1px 3px rgba(15,23,42,0.25)',
      }}
    >
      <Icon size={10} strokeWidth={3.5} />
    </span>
  )
}

function PageCard({ page, marks, total }) {
  const pageMarks = marks.filter(m => m.page === page.page && m.bbox)
  return (
    <div className='mb-4'>
      {total > 1 && (
        <div className='mb-1.5 flex items-center justify-between'>
          <p className='text-[12px] font-medium' style={{ color: 'var(--text-secondary)' }}>
            第 {page.page} 页<span className='mx-1' style={{ color: 'var(--text-tertiary)' }}>/</span>共 {total} 页
          </p>
          <p className='text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
            {pageMarks.length} 处标注
          </p>
        </div>
      )}
      <div className='relative overflow-hidden rounded-lg border' style={{ borderColor: 'var(--border-light)' }}>
        <img src={page.imageUrl} alt={`答卷第 ${page.page} 页`} className='block w-full' loading='lazy' />
        {/* bbox 为 0-1000 归一化坐标，直接换算成百分比，免依赖图片自然尺寸。
            细线 1.5px + 0.85 透明：让老师看清对错区域，但不压住笔迹 */}
        {pageMarks.map(m => {
          const meta = VERDICT_META[m.verdict] || VERDICT_META.unjudged
          return (
            <div key={m.questionId} className='absolute' style={{
              left: `${m.bbox.x / 10}%`,
              top: `${m.bbox.y / 10}%`,
              width: `${m.bbox.width / 10}%`,
              height: `${m.bbox.height / 10}%`,
              border: `1.5px solid ${meta.fg}`,
              borderRadius: 3,
              opacity: 0.85,
              pointerEvents: 'none',
            }}>
              <MarkBadge verdict={m.verdict} />
            </div>
          )
        })}
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
        {hasAnswerSheet ? '图片可能已过期，请从组卷详情重新上传答卷' : '上传答卷批改完成后，这里会显示每题的对错标注'}
      </p>
    </div>
  )
}

export default function GradingDetailSheet({ exam, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, detail: null })

  const load = () => {
    setState({ loading: true, error: null, detail: null })
    getExamGradingDetail(exam.id)
      .then(detail => setState({ loading: false, error: null, detail }))
      .catch(e => setState({ loading: false, error: e?.message || '网络异常', detail: null }))
  }
  useEffect(() => { load() }, [exam?.id])

  const detail = state.detail
  const marks = detail?.marks || []
  const counts = marks.reduce(
    (acc, m) => { acc[m.verdict] = (acc[m.verdict] || 0) + 1; return acc },
    { correct: 0, wrong: 0, unjudged: 0 }
  )
  // 无作答痕迹题（matchedBy='none'）→ 事实提示，不改判定（缺痕迹 ≠ 未作答）
  const noTraceLabels = marks.filter(m => m.matchedBy === 'none').map(m => m.label)
  const pages = detail?.pages || []

  return (
    <BottomSheet title='批改详情' onClose={onClose} maxWidth={560}>
      {state.loading && <LoadingState />}
      {!state.loading && state.error && <ErrorState message={state.error} onRetry={load} />}
      {!state.loading && !state.error && detail && (
        <>
          {/* 结果摘要：语义色 soft 底计数格，即图例（正确/错误恒显，未判定有数才显）。
              列数随格数自适应：2 格两列，3 格三列，避免第三格孤行 */}
          {(() => {
            const keys = ['correct', 'wrong', ...(counts.unjudged > 0 ? ['unjudged'] : [])]
            const three = keys.length === 3
            return (
              <div className={`mb-4 grid gap-2.5 ${three ? 'grid-cols-3' : 'grid-cols-2'}`}>
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
            <div className='mb-4 flex items-start gap-2 rounded-2xl px-3.5 py-3' style={{ background: 'var(--warning-soft)' }}>
              <AlertTriangle size={14} className='mt-0.5 shrink-0' style={{ color: 'var(--warning)' }} />
              <p className='text-[12px] leading-5' style={{ color: 'var(--text-secondary)' }}>
                第 {noTraceLabels.join('、')} 题在答卷照片上没有找到作答痕迹，可能是漏拍或未作答，
                请对照纸质卷确认，以老师复核结果为准。
              </p>
            </div>
          )}

          {pages.length === 0
            ? <EmptyState hasAnswerSheet={detail.hasAnswerSheet} />
            : <>
                {pages.map(p => (
                  <PageCard key={p.page} page={p} marks={marks} total={pages.length} />
                ))}
                <p className='pb-1 pt-1 text-center text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
                  标注仅供讲题参考，对错以老师复核结果为准
                </p>
              </>}
        </>
      )}
    </BottomSheet>
  )
}
