import { useRef, useState, useEffect, useCallback } from 'react'
import { Trash2 } from 'lucide-react'

/**
 * SwipeableRow — 鸿蒙风格「左滑露出删除」列表交互
 *
 * 用法：
 *   <SwipeableRow onDelete={() => ...}>
 *     <div className="card ...">列表卡片内容</div>
 *   </SwipeableRow>
 *
 * 交互说明：
 *  - 手指（或鼠标）在卡片上向左滑动 → 露出右侧红色删除按钮
 *  - 松手后根据滑动距离自动吸附「打开 / 关闭」
 *  - 同一时刻只允许一行处于打开状态（打开新行会自动收起其它行）
 *  - 行处于打开态时点击卡片主体 → 先收起，不触发卡片自身点击
 */

// 模块级事件总线：保证同时只有一行处于打开状态
const OPEN_EVENT = 'minxue-swipeable-open'
let uid = 0

const ACTION_WIDTH = 76 // 删除按钮宽度(px)
const OPEN_THRESHOLD = 32 // 超过该滑动距离即判定为「打开」
const TAP_SLOP = 8 // 小于该位移视为点击

export default function SwipeableRow({
  children,
  onDelete,
  disabled = false,
  actionLabel = '删除',
  radius = 'var(--radius-md)',
}) {
  const idRef = useRef(++uid)
  const contentRef = useRef(null)
  const [tx, setTx] = useState(0) // 用于驱动删除按钮显隐的渲染
  const [animating, setAnimating] = useState(true)

  // 拖动过程中的实时状态全部放在 ref，避免闭包读到过期的 state
  const drag = useRef({ active: false, x0: 0, y0: 0, base: 0, cur: 0, axis: null })
  const openRef = useRef(false)
  const justDraggedRef = useRef(false) // 刚发生过拖动 → 抑制随后的 click

  const applyTx = useCallback((v) => {
    drag.current.cur = v
    if (contentRef.current) {
      contentRef.current.style.transform = `translateX(${v}px)`
    }
    setTx(v)
  }, [])

  const close = useCallback(() => {
    setAnimating(true)
    openRef.current = false
    applyTx(0)
  }, [applyTx])

  const open = useCallback(() => {
    setAnimating(true)
    openRef.current = true
    applyTx(-ACTION_WIDTH)
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: idRef.current }))
  }, [applyTx])

  // 监听其它行打开 → 收起自己
  useEffect(() => {
    const handler = (e) => {
      if (e.detail !== idRef.current && openRef.current) close()
    }
    window.addEventListener(OPEN_EVENT, handler)
    return () => window.removeEventListener(OPEN_EVENT, handler)
  }, [close])

  const onPointerDown = (e) => {
    if (disabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current.active = true
    drag.current.x0 = e.clientX
    drag.current.y0 = e.clientY
    drag.current.base = drag.current.cur
    drag.current.axis = null
    setAnimating(false)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* noop */ }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d.active) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0

    if (d.axis === null) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (d.axis === 'y') return // 纵向手势交给页面滚动
    e.preventDefault()

    let next = d.base + dx
    if (next > 0) next = next * 0.25 // 向右回弹阻尼
    if (next < -ACTION_WIDTH) next = -ACTION_WIDTH + (next + ACTION_WIDTH) * 0.25
    applyTx(next)
  }

  const finish = (e) => {
    const d = drag.current
    if (!d.active) return
    d.active = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    if (d.axis === 'x') {
      justDraggedRef.current = true // 拦截紧随其后的 click
      if (d.cur < -OPEN_THRESHOLD) open()
      else close()
    }
  }

  // 打开态时点击主体：拦截并收起，不触发卡片点击；
  // 或刚结束一次横向拖动时，吞掉这次误触发的 click
  const onClickCapture = (e) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (openRef.current) {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    close()
    onDelete?.()
  }

  const revealed = tx < -4

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: radius,
      }}
    >
      {/* 底层删除按钮 */}
      <button
        onClick={handleDelete}
        aria-label={actionLabel}
        tabIndex={openRef.current ? 0 : -1}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: `${ACTION_WIDTH}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          border: 'none',
          background: 'var(--danger, #DC2626)',
          color: '#fff',
          cursor: 'pointer',
          opacity: revealed ? 1 : 0,
          pointerEvents: tx < -OPEN_THRESHOLD ? 'auto' : 'none',
          transition: animating ? 'opacity 0.2s ease' : 'none',
        }}
      >
        <Trash2 size={18} strokeWidth={2} />
        <span style={{ fontSize: '11px', fontWeight: 600, lineHeight: 1 }}>{actionLabel}</span>
      </button>

      {/* 上层可滑动内容 */}
      <div
        ref={contentRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(${tx}px)`,
          transition: animating ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          position: 'relative',
          zIndex: 1,
          background: 'var(--bg, #EEF2FF)',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  )
}
