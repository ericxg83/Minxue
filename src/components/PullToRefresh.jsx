import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'

// 移动端原生下拉刷新（裁决④，2026-10-04 负责人拍板走「原生手势」路线）。
//
// 为什么不用 antd-mobile 的 PullToRefresh：
//   vite.config.js 的 manualChunks 把 antd-mobile 单独切进 vendor 块，历史上引入它的
//   PullToRefresh 触发过分包断裂白屏（见 docs/auto/lanes.md 接手提示#2）。这里只用
//   原生 Touch Events，零新增依赖、零分包影响。
//
// 手势约定（滚动容器唯一是 main.overflow-scroll-area，body 不滚）：
//   - 仅当容器已滚到顶（scrollTop<=0）且向下拖时才进入下拉；列表纵向滚动不受影响。
//   - 下拉带阻尼（RESISTANCE），最多拉出 PULL_MAX 的可视距离。
//   - 松手时可视距离 ≥ PULL_THRESHOLD 才真正触发 onRefresh，否则回弹。
//   - 刷新期间锁定，不接受新的下拉，防止并发重复请求。
const PULL_THRESHOLD = 56   // 松手触发刷新的可视位移
const PULL_MAX = 88         // 阻尼后可视位移上限（指示器预留高度）
const RESISTANCE = 0.42     // 手指位移 → 可视位移 阻尼系数

// 指示器预留高度 = PULL_MAX：内容整体 translateY(pull) 时，顶部让出这块空白显示状态。
function Indicator({ pull, refreshing }) {
  const ready = pull >= PULL_THRESHOLD || refreshing
  const label = refreshing ? '正在刷新…' : ready ? '松开刷新' : '下拉刷新'
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex items-end justify-center"
      style={{ top: -PULL_MAX, height: PULL_MAX, paddingBottom: 10 }}
      aria-hidden="true"
    >
      <div className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-12)' }}>
        {refreshing
          ? <Loader2 size={15} className="animate-spin" style={{ color: 'var(--primary)' }} />
          : <ArrowDown
              size={15}
              style={{
                color: ready ? 'var(--primary)' : 'var(--text-tertiary)',
                transition: 'transform .2s',
                transform: `rotate(${Math.min(180, (pull / PULL_THRESHOLD) * 180)}deg)`,
              }}
            />}
        <span>{label}</span>
      </div>
    </div>
  )
}

export default function PullToRefresh({ onRefresh, disabled = false, className = '', style, children }) {
  const scrollRef = useRef(null)
  const startRef = useRef(null)        // { y, canPull } —— touchstart 时捕获
  const busyRef = useRef(false)        // 刷新锁（避免 state 异步未提交时并发触发）
  const pullRef = useRef(0)            // 最近一次可视位移，供松手时判阈值（不放进 state updater）
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // 事件用原生监听器挂到滚动容器上：React 合成的 touchmove 在部分 WebView 下是
  // passive 的，preventDefault 会被忽略 → 原生橡皮筋/父级滚动链会抢走手势。
  // passive:false 才能在下拉时真正按住容器。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined

    const onTouchStart = (e) => {
      if (disabledRef.current || busyRef.current) { startRef.current = null; return }
      // 只在已滚到顶时允许下拉；否则交给列表自身纵向滚动
      startRef.current = { y: e.touches[0].clientY, canPull: el.scrollTop <= 0 }
    }

    const onTouchMove = (e) => {
      const s = startRef.current
      if (!s || !s.canPull || busyRef.current) return
      if (e.touches.length !== 1) return
      const dy = e.touches[0].clientY - s.y
      if (dy <= 0) {
        // 上滑（正常浏览）：复位，绝不 preventDefault，把滚动还给列表
        if (startRef.current) { pullRef.current = 0; setPull(0); setDragging(false) }
        return
      }
      // 仍处于顶部才继续下拉手势
      if (el.scrollTop > 0) { startRef.current = null; pullRef.current = 0; setPull(0); setDragging(false); return }
      e.preventDefault()
      setDragging(true)
      const next = Math.min(PULL_MAX, dy * RESISTANCE)
      pullRef.current = next
      setPull(next)
    }

    const finish = () => {
      const s = startRef.current
      startRef.current = null
      setDragging(false)
      if (!s || !s.canPull || busyRef.current) { pullRef.current = 0; setPull(0); return }
      if (pullRef.current >= PULL_THRESHOLD && typeof onRefresh === 'function') {
        busyRef.current = true
        setRefreshing(true)
        pullRef.current = PULL_THRESHOLD
        setPull(PULL_THRESHOLD) // 停在阈值高度显示 spinner
        Promise.resolve()
          .then(() => onRefresh())
          .catch(() => {})
          .finally(() => {
            busyRef.current = false
            setRefreshing(false)
            pullRef.current = 0
            setPull(0)
          })
      } else {
        pullRef.current = 0
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', finish)
    el.addEventListener('touchcancel', finish)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', finish)
      el.removeEventListener('touchcancel', finish)
    }
  }, [onRefresh])

  const transitioning = !dragging   // 松手回弹/停驻时补动画，拖拽中贴手无延迟
  return (
    <main
      ref={scrollRef}
      className={`w-full overflow-scroll-area ${className}`.trim()}
      style={{ overscrollBehaviorY: 'contain', ...style }}
    >
      <div
        style={{
          position: 'relative',
          // 用 margin-top 位移而非 transform：transform 会给 fixed 后代建参考系，
          // 错题本底部多选栏（position:fixed，渲染在本容器内）会被带偏。
          marginTop: pull,
          transition: transitioning ? 'margin-top .25s ease' : 'none',
        }}
      >
        <Indicator pull={pull} refreshing={refreshing} />
        {children}
      </div>
    </main>
  )
}
