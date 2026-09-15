import { useEffect, useState } from 'react'
import { AlertCircle, Check, Loader2, RefreshCw, X } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { getExamGradingDetail } from '../services/apiService'

// 组卷「批改详情」标注视图（2026-09-15 P1）：
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

const VERDICT_STYLE = {
  correct: { bg: 'var(--success)', icon: Check, label: '正确' },
  wrong: { bg: 'var(--danger)', icon: X, label: '错误' },
  unjudged: { bg: 'var(--warning)', icon: '?', label: '未判定' },
}

function MarkBadge({ verdict }) {
  const style = VERDICT_STYLE[verdict] || VERDICT_STYLE.unjudged
  const Icon = style.icon
  return (
    <span
      className='absolute flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white'
      style={{ background: style.bg, left: 0, top: 0, transform: 'translate(-40%, -40%)', boxShadow: '0 0 0 2px rgba(255,255,255,0.9)' }}
    >
      {typeof Icon === 'string' ? Icon : <Icon size={12} strokeWidth={3.5} />}
    </span>
  )
}

function PageCard({ page, marks, showPageNo, total }) {
  const pageMarks = marks.filter(m => m.page === page.page && m.bbox)
  return (
    <div className='mb-4'>
      {showPageNo && (
        <p className='mb-1.5 text-[12px] font-medium' style={{ color: 'var(--text-secondary)' }}>
          第 {page.page} / {total} 页
        </p>
      )}
      <div className='relative overflow-hidden rounded-xl border' style={{ borderColor: 'var(--border-light)' }}>
        <img src={page.imageUrl} alt={`答卷第 ${page.page} 页`} className='block w-full' loading='lazy' />
        {/* bbox 为 0-1000 归一化坐标，直接换算成百分比，免依赖图片自然尺寸 */}
        {pageMarks.map(m => (
          <div key={m.questionId} className='absolute rounded-md border-2' style={{
            left: `${m.bbox.x / 10}%`,
            top: `${m.bbox.y / 10}%`,
            width: `${m.bbox.width / 10}%`,
            height: `${m.bbox.height / 10}%`,
            borderColor: VERDICT_STYLE[m.verdict]?.bg || 'var(--warning)',
            background: 'transparent',
            pointerEvents: 'none',
          }}>
            <MarkBadge verdict={m.verdict} />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function GradingDetailSheet({ exam, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, detail: null })

  useEffect(() => {
    let alive = true
    getExamGradingDetail(exam.id)
      .then(detail => { if (alive) setState({ loading: false, error: null, detail }) })
      .catch(e => { if (alive) setState({ loading: false, error: e?.message || '加载失败', detail: null }) })
    return () => { alive = false }
  }, [exam?.id])

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
      {state.loading && (
        <div className='flex flex-col items-center gap-2 py-14'>
          <Loader2 size={22} className='animate-spin' style={{ color: 'var(--primary)' }} />
          <p className='text-[13px]' style={{ color: 'var(--text-secondary)' }}>正在加载批改详情…</p>
        </div>
      )}

      {!state.loading && state.error && (
        <div className='flex flex-col items-center gap-3 py-14'>
          <AlertCircle size={26} style={{ color: 'var(--danger)' }} />
          <p className='text-[13px]' style={{ color: 'var(--text-secondary)' }}>加载失败：{state.error}</p>
          <button
            type='button'
            onClick={() => setState({ loading: true, error: null, detail: null })}
            className='flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold text-white'
            style={{ background: 'var(--primary)' }}
          >
            <RefreshCw size={14} />重试
          </button>
        </div>
      )}

      {!state.loading && !state.error && detail && (
        <>
          {/* 结果摘要：与列表行同一口径（服务端 classifyQuestionResult） */}
          <div className='mb-3 flex items-center justify-center gap-4 rounded-2xl px-3 py-2.5' style={{ background: 'var(--bg-secondary)' }}>
            {[
              ['correct', `${counts.correct} 正确`],
              ['wrong', `${counts.wrong} 错误`],
              ...(counts.unjudged > 0 ? [['unjudged', `${counts.unjudged} 未判定`]] : []),
            ].map(([key, text]) => (
              <span key={key} className='text-[13px] font-semibold' style={{ color: VERDICT_STYLE[key].bg }}>
                {text}
              </span>
            ))}
          </div>

          {noTraceLabels.length > 0 && (
            <div className='mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5' style={{ background: 'var(--warning-soft)' }}>
              <AlertCircle size={14} className='mt-0.5 shrink-0' style={{ color: 'var(--warning)' }} />
              <p className='text-[12px] leading-5' style={{ color: 'var(--text-secondary)' }}>
                第 {noTraceLabels.join('、')} 题在答卷照片上没有找到作答痕迹（可能漏拍或未作答），
                请对照手里的纸质卷确认，以老师复核结果为准。
              </p>
            </div>
          )}

          {pages.length === 0 ? (
            <div className='flex flex-col items-center gap-2 py-12'>
              <AlertCircle size={22} style={{ color: 'var(--text-tertiary)' }} />
              <p className='text-[13px]' style={{ color: 'var(--text-secondary)' }}>
                {detail.hasAnswerSheet ? '这份卷的答卷图片已失效' : '还没有上传答卷照片'}
              </p>
            </div>
          ) : (
            <>
              {/* 图例 */}
              <div className='mb-3 flex items-center justify-center gap-3 text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
                <span className='flex items-center gap-1'><span className='inline-block h-2.5 w-2.5 rounded-full' style={{ background: 'var(--success)' }} />正确</span>
                <span className='flex items-center gap-1'><span className='inline-block h-2.5 w-2.5 rounded-full' style={{ background: 'var(--danger)' }} />错误</span>
                <span className='flex items-center gap-1'><span className='inline-block h-2.5 w-2.5 rounded-full' style={{ background: 'var(--warning)' }} />未判定</span>
              </div>
              {pages.map(p => (
                <PageCard key={p.page} page={p} marks={marks} showPageNo={pages.length > 1} total={pages.length} />
              ))}
              <p className='pb-1 text-center text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
                标注仅供讲题参考，对错以老师复核结果为准
              </p>
            </>
          )}
        </>
      )}
    </BottomSheet>
  )
}
