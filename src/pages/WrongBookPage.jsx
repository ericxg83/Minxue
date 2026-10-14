import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import dayjs from 'dayjs'
import EmptyState from '../components/EmptyState'
import SwipeableRow from '../components/SwipeableRow'
import MathText from '../components/MathText'
import { MobileList, MobileSegmentedTabs } from '../features/mobile/MobilePrimitives'
import { formatQuestionLabel } from '../utils/questionStem'
import { searchWrongQuestions } from '../services/apiService'

// 两级掌握文案（2026-09-13 队列分层）：new 待复习 → review_1 基本掌握（周回顾验证）→ mastered 完全掌握。
// review_2 是历史残留枚举，按 review_1 语义展示。
const lifecycle = i => i.lifecycle_status || i.status || 'new'
const text = i => (i.question || i).content || i.content || '题目内容暂不可用'
const qOf = i => i.question || i
// 多小问大题：列表里加「第10题(2)」小标，完整公共题干在详情弹窗里看
const subLabelOf = i => {
  const q = qOf(i)
  const subNo = q.sub_no == null ? '' : String(q.sub_no).trim()
  return subNo ? formatQuestionLabel(q.question_number, subNo) : ''
}

// 学科筛选：字段已在 wrong_questions / questions 合并结果里透传（apiService subject），
// 这里只做展示层映射，缺数据时该组 chip 自然不出现，不引入新接口。
const SUBJECT_NAMES = { math: '数学', chinese: '语文', english: '英语', physics: '物理', chemistry: '化学', biology: '生物' }
const subjectOf = i => {
  const q = qOf(i)
  const s = q.subject || i.subject
  return s ? String(s).trim() : ''
}
const subjectLabel = s => SUBJECT_NAMES[s.toLowerCase()] || s

// 日期筛选基于 added_at/created_at（列表行已在显示同源日期），纯客户端过滤。
const inDateRange = (item, range) => {
  if (range === 'all') return true
  const d = dayjs(item.added_at || item.created_at)
  if (!d.isValid()) return false
  return d.isAfter(dayjs().subtract(range === '7d' ? 7 : 30, 'day'))
}

const DATE_CHIPS = [
  { id: 'all', label: '全部时间' },
  { id: '7d', label: '近7天' },
  { id: '30d', label: '近30天' }
]

// [2026-10-14 移动端自由组卷] 搜索结果 → 列表行同形。
// ⛔ 为什么必须做这一步：搜索接口返回的是**扁平**行（content/correct_answer 平铺），
// 而错题列表接口返回的是 `wq.* + question {...}`（题目档案在 question 子对象里）。
// 两处混进同一个 selectedQuestions 池后，PrintPreview 走 `wq.question || wq`：
//   · 列表行 → 拿到 question（有 options/几何图/难度），卷面完整；
//   · 搜索行 → 拿到 wq 本体，**没有 options、没有图**，
//     ensureEnriched 又因为拿不到 q.id（wq.id ≠ questions.id）而拉不到补全数据，
//     结果就是「组出来的卷子丢选项、丢图」，且不报错 —— 正是字段不对齐事故的典型形状。
// 所以这里把搜索行补成 { ...wq, question: { id: question_id, ... } }：
//   id 保持 wq.id（错题行主键，勾选态判重靠它，与列表行同域）；
//   question.id = question_id（题目档案主键，补全与出卷靠它）。
// 练习册自包含错题 question_id 为空 ⇒ 不造 question 子对象，
// 与列表接口 CASE WHEN q.id IS NULL THEN NULL 的口径保持一致。
const normalizeSearchHit = hit => ({
  ...hit,
  question: hit.question_id
    ? {
      id: hit.question_id,
      content: hit.content,
      subject: hit.subject,
      answer: hit.correct_answer,
      analysis: hit.analysis,
      answer_source: hit.answer_source,
      parent_stem: hit.parent_stem,
      sub_no: hit.sub_no,
      question_number: hit.question_number,
    }
    : null,
})

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] leading-none'
      style={active
        ? { background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 600, border: '1px solid transparent' }
        : { background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

export default function WrongBookPage({
  studentId,
  filteredWrongQuestions,
  bankCounts,
  selectedQuestions,
  pendingWrongQuestionCount,
  onToggleSelection,
  onSelectVisible,
  onClearSelection,
  onOpenDetail,
  onDelete,
  onPrintPreview,
  hasMore,
  loadingMore,
  onLoadMore
}) {
  const questions = Array.isArray(filteredWrongQuestions) ? filteredWrongQuestions : []
  const counts = bankCounts || { new: pendingWrongQuestionCount || 0, review: 0, mastered: 0 }
  const [filter, setFilter] = useState('new')
  const [dateRange, setDateRange] = useState('all')
  const [subject, setSubject] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const tabs = [
    { id: 'new', label: '待复习', count: counts.new || 0 },
    { id: 'review', label: '基本掌握', count: counts.review || 0 },
    { id: 'mastered', label: '完全掌握', count: counts.mastered || 0 }
  ]

  const subjects = useMemo(() => {
    const seen = []
    for (const q of questions) {
      const s = subjectOf(q)
      if (s && !seen.includes(s)) seen.push(s)
    }
    return seen
  }, [questions])

  const visible = questions.filter(i =>
    (filter === 'review' ? ['review_1', 'review_2'].includes(lifecycle(i)) : lifecycle(i) === filter)
    && inDateRange(i, dateRange)
    && (subject === 'all' || subjectOf(i) === subject)
  )

  // ── 搜索找题（2026-10-14 移动端自由组卷）──────────────────────────────
  // 动机：组卷能力本来就有（勾选 → 生成重练），但**只能靠翻**。错题按 100 条/页
  // 加载、按状态分三个 Tab，老师要挑「某几道特定的题」得反复翻页。这里补一个搜索入口：
  // 输关键词 → 勾选多道 → 直接进组卷，**不新建页面、不改出卷流程**。
  //
  // ⛔ 搜索结果与列表行共用同一个 selectedQuestions 池（同域判重靠 wq.id），
  //   所以「列表里勾 2 道 + 搜索里再勾 3 道」能拼成一张卷 —— 这才是"自由组卷"。
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchItems, setSearchItems] = useState([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchFailed, setSearchFailed] = useState(false)
  // 输入防抖 300ms：老师连续打字时不该每敲一下打一次库。
  // seqRef 是竞态守卫：慢响应晚到时若已有更新的请求在飞，直接丢弃，
  // 否则会出现「先输的宽结果覆盖后输的窄结果」（搜索框写着新词、结果是旧词的）。
  const searchSeqRef = useRef(0)
  const debounceRef = useRef(null)

  const trimmedKeyword = keyword.trim()
  const isSearchMode = trimmedKeyword.length > 0

  useEffect(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    if (!trimmedKeyword) {
      searchSeqRef.current += 1   // 作废在飞请求，防清空后旧结果又填回来
      setSearchItems([])
      setSearchTotal(0)
      setSearching(false)
      setSearchFailed(false)
      return
    }
    // ⛔ 没 studentId 就不搜：跨学生全库结果混进这个学生的重练卷是数据污染，
    //   宁可不搜也不能错搜（组卷是 per-student 的动作）。
    if (!studentId) return
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const seq = ++searchSeqRef.current
      try {
        const { items, total } = await searchWrongQuestions(trimmedKeyword, { limit: 50, studentId })
        if (seq !== searchSeqRef.current) return   // 已有更新请求，丢弃本次
        setSearchItems(items.map(normalizeSearchHit))
        setSearchTotal(total ?? items.length)
        setSearchFailed(false)
      } catch (err) {
        if (seq !== searchSeqRef.current) return
        console.error('搜索错题失败:', err)
        setSearchItems([])
        setSearchTotal(0)
        setSearchFailed(true)
      } finally {
        if (seq === searchSeqRef.current) setSearching(false)
      }
    }, 300)
    return () => { if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null } }
  }, [trimmedKeyword, studentId])

  // 卸载时作废在飞请求 + 清定时器（与长按定时器同一口径：不残留副作用）
  useEffect(() => () => { searchSeqRef.current += 1 }, [])

  const clearSearch = () => setKeyword('')

  // 搜索态下的"全选"对象是搜索结果；列表态下是筛选后可见项。
  // 两者同域（wq.id），重复勾选由 toggleSelectVisible 的合并逻辑兜住。
  // ⛔ 这里取代了原先的 allVisibleSelected（只管列表态）：同一个"是否全选"判据
  //   不允许存在两份实现，否则加搜索态后必然只改一处、底栏文案与实际勾选对不上。
  const allSelectedTarget = isSearchMode ? searchItems : visible
  const allSelected = allSelectedTarget.length > 0
    && allSelectedTarget.every(i => selectedQuestions.some(s => s.id === i.id))

  // 长按题目（450ms）进入多选模式：进入的同时勾选该题，并抑制随后触发的 click。
  const pressTimer = useRef(null)
  const longPressFired = useRef(false)
  const startPress = (item, selected) => {
    longPressFired.current = false
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setSelectMode(true)
      if (!selected) onToggleSelection(item)
    }, 450)
  }
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
  }

  // 卸载时清理长按定时器（P7 同口径）：长按进行中离开页面不残留定时器、不触碰已卸载组件
  useEffect(() => {
    return () => {
      if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null }
    }
  }, [])

  // 触底加载下一页：服务端每页 100 条，Tab 计数是全量数字，
  // 不接回加载的话超过 100 条后新错题在移动端永远不可见。
  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loadingMore) onLoadMore?.()
    }, { rootMargin: '240px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, onLoadMore])

  const showFilterRow = questions.length > 0
  const showBottomBar = selectMode || selectedQuestions.length > 0

  // 列表态与搜索态共用的行渲染（2026-10-14）。
  // ⛔ 必须抽出来共用：搜索结果和筛选结果都是「同一批错题行的同形数据」，
  //   两处各写一份 markup 的话，以后改一处（勾选圈样式/小标/详情入口）就会两边不一致，
  //   表现为「同一道题在搜索里长一个样」—— 这类漂移最难被测出来。
  const renderRow = (item, index) => {
    const selected = selectedQuestions.some(e => e.id === item.id)
    const status = lifecycle(item)
    const date = dayjs(item.added_at || item.created_at)
    const wrongTimes = `错次:${item.error_count || 1}次`
    return <SwipeableRow key={item.id || index} onDelete={() => onDelete(item)}>
      <div className='flex items-center gap-2.5 border-b px-0.5 py-2.5 last:border-b-0' style={{ borderColor: 'var(--border-light)' }}>
        <button
          type='button'
          onClick={() => onToggleSelection(item)}
          className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border'
          style={{ borderColor: selected ? 'var(--primary)' : 'var(--border)', background: selected ? 'var(--primary)' : '#fff', color: '#fff' }}
          aria-label={selected ? '取消选择' : '选择错题'}
        >
          {selected && <Check size={12} />}
        </button>
        <button
          type='button'
          className='min-w-0 flex-1 select-none text-left'
          style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
          onPointerDown={() => startPress(item, selected)}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={e => e.preventDefault()}
          onClick={() => {
            if (longPressFired.current) { longPressFired.current = false; return }
            if (selectMode) onToggleSelection(item)
            else onOpenDetail(item)
          }}
          aria-label={selectMode ? (selected ? '取消选择' : '选择错题') : '查看错题详情'}
        >
          <span className='line-clamp-2 text-[13px] font-medium leading-5' style={{ color: 'var(--text)' }}>
            {subLabelOf(item) && (
              <span className='mr-1 rounded px-1 align-middle text-[10px] font-normal' style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                {subLabelOf(item)}
              </span>
            )}
            <MathText content={text(item)} />
          </span>
          <span className='mt-0.5 block truncate text-[11px]' style={{ color: status === 'mastered' ? 'var(--success)' : 'var(--text-secondary)' }}>
            {date.isValid() ? date.format('MM/DD') : ''}{date.isValid() ? ' · ' : ''}{wrongTimes}
          </span>
        </button>
        <ChevronRight size={15} style={{ color: 'var(--text-tertiary)' }} />
      </div>
    </SwipeableRow>
  }

  return <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className='mobile-page mobile-page-wrongbook mx-auto w-full max-w-lg px-4 pb-28 pt-5'>
    {/* 搜索找题 → 勾选多道 → 生成重练（2026-10-14 移动端自由组卷）*/}
    <div className='relative mb-2'>
      <Search size={15} className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2' style={{ color: 'var(--text-tertiary)' }} />
      <input
        type='search'
        value={keyword}
        onChange={e => setKeyword(e.target.value)}
        placeholder='搜题干或答案，直接勾题组卷'
        className='w-full rounded-lg py-2 pl-8 pr-8 text-[13px] outline-none'
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text)' }}
        aria-label='搜索错题'
      />
      {keyword.length > 0 && (
        <button
          type='button'
          onClick={clearSearch}
          className='absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full'
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
          aria-label='清空搜索'
        >
          <X size={13} />
        </button>
      )}
    </div>
    {isSearchMode && (
      <div className='mb-2 text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
        {searching
          ? '正在搜索…'
          : searchFailed
            ? '搜索失败，请检查网络后重试'
            : searchTotal > 0
              ? `跨全部状态找到 ${searchTotal} 道${searchTotal > searchItems.length ? `，先显示前 ${searchItems.length} 道` : ''}；勾选后可直接生成重练`
              : `没有找到含「${trimmedKeyword}」的错题，换个关键词试试`}
      </div>
    )}
    {!isSearchMode && (
      <>
    <MobileSegmentedTabs items={tabs} value={filter} onChange={setFilter} ariaLabel='错题复习状态' />
    {showFilterRow && (
      <div className='mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5' style={{ scrollbarWidth: 'none' }}>
        {DATE_CHIPS.map(c => (
          <FilterChip key={c.id} active={dateRange === c.id} onClick={() => setDateRange(c.id)}>{c.label}</FilterChip>
        ))}
        {subjects.length > 0 && (
          <>
            <span className='mx-0.5 h-3.5 w-px flex-shrink-0' style={{ background: 'var(--border-light)' }} aria-hidden='true' />
            {subjects.map(s => (
              <FilterChip key={s} active={subject === s} onClick={() => setSubject(subject === s ? 'all' : s)}>{subjectLabel(s)}</FilterChip>
            ))}
          </>
        )}
      </div>
    )}
      </>
    )}
    {selectMode && !isSearchMode && (
      <div className='mt-2 text-[11px]' style={{ color: 'var(--text-tertiary)' }}>
        多选模式：点击题目勾选，「完成」退出
      </div>
    )}
    {isSearchMode
      ? (searching && searchItems.length === 0
        ? <div className='py-16 text-center text-[13px]' style={{ color: 'var(--text-tertiary)' }}>正在搜索…</div>
        : searchItems.length > 0
          ? <MobileList>{searchItems.map(renderRow)}</MobileList>
          : searchFailed
            ? <EmptyState icon={Search} title='搜索失败' description='请检查网络后重试，或换个关键词' className='py-16' />
            : !questions.length
              ? <EmptyState icon={Search} title='这里还没有错题' description='完成作业批改后，错题会自动进入这里' className='py-16' />
              : <EmptyState icon={Search} title={`没有找到含「${trimmedKeyword}」的错题`} description='搜索会同时匹配题干和正确答案，换个关键词试试' className='py-16' />)
      : !questions.length
      ? <EmptyState icon={Search} title='这里还没有错题' description='完成作业批改后，错题会自动进入这里' className='py-16' />
      : !visible.length
        ? <EmptyState icon={Search} title='这个分类暂时没有错题' description='试试放宽时间或学科筛选，或切换其他状态' className='py-16' />
        : <MobileList>
            {visible.map(renderRow)}
            {hasMore && (
              <div ref={sentinelRef} className='py-3 text-center text-[12px]' style={{ color: 'var(--text-tertiary)' }}>
                {loadingMore ? '正在加载…' : ''}
              </div>
            )}
          </MobileList>}
    {showBottomBar && (
      <div className='fixed inset-x-0 z-40 mx-auto max-w-lg px-4' style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>
        <div className='flex items-center gap-2 border bg-white px-3 py-2 shadow-lg' style={{ borderColor: 'var(--border-light)' }}>
          <span className='flex-shrink-0 text-[12px]' style={{ color: 'var(--text-secondary)' }}>已选 {selectedQuestions.length} 道</span>
          {allSelectedTarget.length > 0 && (
            <button
              type='button'
              onClick={() => onSelectVisible?.(allSelectedTarget)}
              className='flex-shrink-0 rounded-full px-2.5 py-1 text-[12px]'
              style={{ background: 'var(--bg-mist)', color: 'var(--primary)', fontWeight: 500 }}
            >{allSelected ? '取消全选' : '全选'}</button>
          )}
          <button
            type='button'
            onClick={() => { onClearSelection?.() }}
            className='flex-shrink-0 rounded-full px-2.5 py-1 text-[12px]'
            style={{ background: 'var(--bg-mist)', color: 'var(--text-secondary)' }}
          >清空</button>
          {selectMode ? (
            <button
              type='button'
              onClick={() => setSelectMode(false)}
              className='ml-auto rounded-lg px-3.5 py-2 text-[12px] font-semibold'
              style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}
            >完成</button>
          ) : (
            <button
              type='button'
              onClick={onPrintPreview}
              className='ml-auto rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white'
              style={{ background: 'var(--primary)' }}
            >生成重练</button>
          )}
        </div>
      </div>
    )}
  </motion.div>
}
