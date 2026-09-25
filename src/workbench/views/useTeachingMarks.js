/**
 * useTeachingMarks — 白板「讲题状态」的零点击判定与落盘
 * ================================================================
 * 设计依据：`_周末班白板-讲题状态-产品评审-20260925.md` §3.7
 *
 * ── 核心承诺：老师一个按钮都不用点 ──────────────────────────────
 * 白板上所有切题路径（底栏圆点 / edge-nav / 底栏按钮 / 键盘 / 平板滑动）都收敛到
 * WeekendBoard.vue 的 `gotoQuestion()`，所以「离开某题」这一刻是确定的。本模块只需
 * 在被调用时读三个**客观信号**，即可派生状态：
 *   1. 停留时长（进入 → 离开，页面不可见期间不计）
 *   2. 这题有没有写过字（笔迹）
 *   3. 有没有点开过参考答案
 *
 * ── 为什么判据不依赖「全屏讲题模式」───────────────────────────
 * 评审初稿把「只统计全屏沉浸模式下的停留」当作防误标手段，但勘察发现：
 * `WeekendHandout.vue` 的 `openBoard()` **从不传 `fs=1`**（那里的注释已过时），
 * WeekendBoard 也从不读 `fs` —— 全屏必须老师手动点。若把它当硬门槛，老师不点全屏
 * 时自动判定会全军覆没。因此改用**停留分布 + 强信号**判据（见 JUDGE_RULES）：
 * 预览式快翻天然落进「掠过」分支，不需要靠全屏来兜。
 *
 * ── 判据 ────────────────────────────────────────────────────
 *   有笔迹            → 已讲（在题上写过字，这题一定讲了）
 *   看过参考答案       → 已讲（讲完对答案）
 *   停留 ≥ 阈值        → 已讲（全屏 20s / 非全屏 45s；快翻不会停这么久）
 *   停留 < 8s 且无信号 → 掠过（**不写标记**，等同于未讲 —— 不引入第 5 个状态）
 *   其余中间态         → **不标**
 *
 * 「中间态不标」是硬规则：用户明确要求过「答案一定要对，不要去猜」。
 * 误标「已讲」比漏标严重得多 —— 漏标只是下次再列一遍，误标会让老师把没讲的题
 * 当成讲过了。
 *
 * ── 边界（红线）─────────────────────────────────────────────
 * 只写 teaching_marks。绝不触碰：
 *   wrong_questions.lifecycle_status（掌握度，唯一写入方 gradingFinalizer）、
 *   knowledge_mastery、questions.review_status / is_correct（判分语义）。
 * 老师标记「讲过」≠ 学生会了。
 */
import { reactive, ref } from 'vue'
import { saveTeachingMarks } from '../../services/apiService'

const JUDGE_RULES = {
  /** 全屏讲题模式下的「停留够久」阈值 */
  immersiveDwellMs: 20_000,
  /** 非全屏下的阈值：抬高，因为非全屏也可能是浏览题面而非讲解 */
  normalDwellMs: 45_000,
  /** 低于此停留视为「掠过」——不写任何标记 */
  skimDwellMs: 8_000,
  /** 落盘合并窗口：连续翻页只发一次请求 */
  flushDelayMs: 1500,
  /** 待落盘条数超过它就立刻发，别攒 */
  flushBurst: 8,
}

/**
 * @param {Object} ctx
 * @param {() => string} ctx.getGrade      年级（必填，写入时带上）
 * @param {() => string} [ctx.getSubject]  学科
 * @param {() => boolean} [ctx.isImmersive] 是否处于全屏讲题模式（用于选阈值）
 */
export function useTeachingMarks(ctx = {}) {
  /** anchorKey → { 持久状态 + 本次会话信号 } */
  const state = reactive({})
  /** anchorKey → 待落盘 payload */
  const pending = new Map()
  const saving = ref(false)
  let flushTimer = null

  // ── 停留计时 ──
  let activeAnchor = null
  let enteredAt = 0
  let pageVisible = typeof document === 'undefined' ? true : !document.hidden

  const grade = () => String(ctx.getGrade?.() || '')
  const subject = () => String(ctx.getSubject?.() || '')
  const immersive = () => !!ctx.isImmersive?.()

  /** 取（或建）某题的会话状态。题上没有 anchorKey（旧版题单）时返回 null，调用方需容忍 */
  function ensure(q) {
    const a = q?.anchorKey
    if (!a) return null
    if (state[a]) return state[a]
    const m = q.mark || null
    const s = reactive({
      anchorKey: a,
      anchorKeyAlt: q.anchorKeyAlt || '',
      questionId: q.questionId || null,
      studentCount: q.studentCount ?? null,
      difficulty: q.difficulty ?? null,
      // 服务端下发的持久状态
      status: m?.status || 'new',
      source: m?.source || null,
      taughtAt: m?.taughtAt || null,
      taughtTimes: m?.taughtTimes ?? 0,
      /** 服务端算出的「讲完之后又被做错」→ 建议回炉（只提示，不自动改状态） */
      reworkDue: !!q.reworkDue,
      // 本次会话信号
      dwellMs: 0,
      /** 单次停留的最大值 —— 判定用它而不是累计值。
       *  累计值会被「反复回看同一题」凑够阈值（5 次 × 10s = 50s 就误判成讲过了）；
       *  「在某一次停留里认真讲了 ≥45s」才是可靠的证据。 */
      maxDwellMs: 0,
      hasStrokes: false,
      viewedAnswer: false,
    })
    state[a] = s
    return s
  }

  /** 把当前这一题的停留结算进 dwellMs / maxDwellMs（页面不可见期间不计） */
  function settleDwell() {
    if (!activeAnchor || !enteredAt) return
    const s = state[activeAnchor]
    if (s) {
      const visit = Math.max(0, Date.now() - enteredAt)
      s.dwellMs += visit
      if (visit > s.maxDwellMs) s.maxDwellMs = visit
    }
    enteredAt = Date.now()
  }

  /** 页面可见性变化：切走时停表（避免「人离开电脑 5 分钟」被算成讲解） */
  function onVisibilityChange() {
    const nowVisible = !document.hidden
    if (nowVisible === pageVisible) return
    if (!nowVisible) {
      settleDwell()
      enteredAt = 0
    } else if (activeAnchor) {
      enteredAt = Date.now()
    }
    pageVisible = nowVisible
  }

  function attachVisibilityListener() {
    if (typeof document === 'undefined') return () => {}
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  /**
   * 进入某题。必须在切题时调用（WeekendBoard 的 gotoQuestion）。
   * 内部会先结算上一题。
   */
  function enterQuestion(q) {
    leaveQuestion()
    const s = ensure(q)
    if (!s) return
    activeAnchor = s.anchorKey
    enteredAt = Date.now()
  }

  /**
   * 离开当前题并做自动判定。
   * @param {Object} [snapshot] - { hasStrokes, viewedAnswer }，可省略（通常已由 note* 记录）
   */
  function leaveQuestion(snapshot) {
    if (!activeAnchor) return
    const s = state[activeAnchor]
    if (s) {
      if (snapshot) {
        if (snapshot.hasStrokes) s.hasStrokes = true
        if (snapshot.viewedAnswer) s.viewedAnswer = true
      }
      settleDwell()
      judge(s)
    }
    activeAnchor = null
    enteredAt = 0
  }

  /** 自动判定：只写 done，且不覆盖已有状态 */
  function judge(s) {
    // 已讲过的题不再被自动判定覆盖 —— 服务端也遵守同一约定。
    // 老师第二次打开白板会再翻一遍；若无脑覆盖，taught_at 会被不断刷新成「刚刚」，
    // 那么「讲完之后学生又被做错」这个回炉信号永远不会触发。
    if (s.status === 'done' || s.status === 'rework' || s.status === 'skip') return

    const dwell = s.maxDwellMs
    const strong = s.hasStrokes || s.viewedAnswer
    const dwellThreshold = immersive() ? JUDGE_RULES.immersiveDwellMs : JUDGE_RULES.normalDwellMs

    // 掠过：不写标记，等同于未讲（不引入第 5 个持久状态）
    if (!strong && dwell < JUDGE_RULES.skimDwellMs) return

    // 已讲：强信号，或停留够久
    if (strong || dwell >= dwellThreshold) {
      s.status = 'done'
      s.source = 'auto'
      s.taughtAt = new Date().toISOString()
      s.taughtTimes = (s.taughtTimes || 0) + 1
      enqueue(s)
      scheduleFlush()
      return
    }
    // 其余中间态：不标。宁可漏标，不可误标。
  }

  /** 在题上写了字 —— 最强的「讲过」信号 */
  function noteStrokes(q, hasStrokes) {
    if (!hasStrokes) return
    const s = ensure(q)
    if (s) s.hasStrokes = true
  }

  /** 点开了参考答案 */
  function noteAnswerViewed(q) {
    const s = ensure(q)
    if (s) s.viewedAnswer = true
  }

  /**
   * 老师手动改判（底栏长按小圆点）。
   * source='manual' 在服务端永远生效，并可把「讲完之后又被做错」的比较基线推到当下。
   */
  function setManual(q, status) {
    const s = ensure(q)
    if (!s) return
    if (!['new', 'done', 'rework', 'skip'].includes(status)) return
    s.status = status
    s.source = 'manual'
    // 老师自己改判之后，服务端那条「讲完还错」的提示不再压过他的判断
    s.reworkDue = false
    if (status === 'done' || status === 'rework') {
      s.taughtAt = new Date().toISOString()
      s.taughtTimes = (s.taughtTimes || 0) + 1
    }
    enqueue(s)
    flush()
  }

  function enqueue(s) {
    pending.set(s.anchorKey, {
      anchorKey: s.anchorKey,
      anchorKeyAlt: s.anchorKeyAlt || '',
      status: s.status,
      source: s.source || 'auto',
      questionId: s.questionId || null,
      studentCount: s.studentCount,
      difficulty: s.difficulty,
      // 上报驱动判定的那个量（单次最长停留），不是累计值 —— 事后核对「为什么被标成已讲」时才说得清
      dwellSeconds: s.maxDwellMs ? Math.round(s.maxDwellMs / 1000) : null,
    })
  }

  function scheduleFlush(delay = JUDGE_RULES.flushDelayMs) {
    if (typeof setTimeout !== 'function') return
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null
      flush()
    }, delay)
  }

  /**
   * 落盘。失败时**保留 pending**，下次 flush 自动重试（upsert 幂等，重发安全）。
   * @param {Object} [opts] - { keepalive: true } 用于 pagehide / 离开页面，尽力送达
   */
  async function flush(opts = {}) {
    const g = grade()
    if (!g || pending.size === 0) return
    const snapshot = [...pending.entries()]
    const marks = snapshot.map(([, v]) => v)

    if (opts.keepalive) {
      try { await saveTeachingMarks({ grade: g, subject: subject() || undefined, marks }, { keepalive: true }) } catch { /* 卸载路径不抛 */ }
      for (const [k] of snapshot) pending.delete(k)
      return
    }

    if (saving.value) return
    saving.value = true
    try {
      const res = await saveTeachingMarks({ grade: g, subject: subject() || undefined, marks })
      if (res?.success) {
        for (const [k] of snapshot) pending.delete(k)
      }
    } catch { /* 保留 pending，下次重试 */ } finally {
      saving.value = false
      // 期间可能又攒了新标记，补一次
      if (pending.size > 0) scheduleFlush(1200)
    }
  }

  /** 立即落盘（离开白板 / 关页时调用） */
  function flushNow(opts = {}) {
    clearTimeout(flushTimer)
    flushTimer = null
    return flush(opts)
  }

  /**
   * 给 UI 用的展示状态（四色）。
   * reworkDue 是「讲完之后又被做错」的服务端提示，只影响展示，不写库 ——
   * 要不要回炉由老师决定（评审 §3.4）。
   */
  function statusOf(q) {
    const s = state[q?.anchorKey]
    if (!s) return 'new'
    if (s.status === 'done' && s.reworkDue) return 'rework'
    return s.status
  }

  /** 状态明细，用于 tooltip（讲了几次 / 上次什么时候讲的 / 为什么被标） */
  function detailOf(q) {
    const s = state[q?.anchorKey]
    if (!s) return null
    return {
      status: s.status,
      source: s.source,
      taughtAt: s.taughtAt,
      taughtTimes: s.taughtTimes,
      reworkDue: s.reworkDue,
      dwellMs: s.maxDwellMs,
      totalDwellMs: s.dwellMs,
      hasStrokes: s.hasStrokes,
      viewedAnswer: s.viewedAnswer,
    }
  }

  /** 未讲过的题（含掠过的）——「只看未讲」过滤器与「续讲」定位都用它 */
  function isUnTaught(q) {
    const st = statusOf(q)
    return st !== 'done' && st !== 'rework' && st !== 'skip'
  }

  function dispose() {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  return {
    state,
    saving,
    pendingCount: () => pending.size,
    JUDGE_RULES,
    attachVisibilityListener,
    enterQuestion,
    leaveQuestion,
    noteStrokes,
    noteAnswerViewed,
    setManual,
    flush,
    flushNow,
    statusOf,
    detailOf,
    isUnTaught,
    dispose,
  }
}
