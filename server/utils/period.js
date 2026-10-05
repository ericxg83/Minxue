/**
 * 周期解析工具：周/月/全部 三种模式 + offset 偏移。
 * 从 routes/weeklyReport.js 抽取，供周报、教学诊断等路由共用。
 */

/**
 * 解析周期参数，向后兼容 ?weeks=N
 * @param {Object} query - req.query
 * @returns {{ periodStart: Date, periodEnd: Date, mode: string, offset: number }}
 */
export function parsePeriod(query) {
  // 兼容旧参数 weeks: weeks=1 本周, weeks=2 上周
  if (query.weeks !== undefined && !query.mode) {
    const weeks = parseInt(query.weeks) || 1
    return {
      mode: 'week',
      offset: weeks - 1,
      ...getWeekRange(weeks - 1)
    }
  }

  const mode = query.mode || 'week'
  const offset = parseInt(query.offset) || 0
  const { periodStart, periodEnd } = getPeriodRange(mode, offset)
  return { mode, offset, periodStart, periodEnd }
}

/**
 * 根据 mode 和 offset 计算起止日期
 */
export function getPeriodRange(mode, offset = 0) {
  const now = new Date()

  if (mode === 'all') {
    return {
      periodStart: new Date('2000-01-01T00:00:00Z'),
      periodEnd: new Date('2099-12-31T23:59:59Z')
    }
  }

  if (mode === 'month') {
    const year = now.getFullYear()
    const month = now.getMonth() - offset
    const start = new Date(year, month, 1)
    const end = new Date(year, month + 1, 1)
    return { periodStart: start, periodEnd: end }
  }

  return getWeekRange(offset)
}

/**
 * 计算第 N 周（offset=0 本周）的周一~下周一
 */
export function getWeekRange(offset = 0) {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff - offset * 7)
  monday.setHours(0, 0, 0, 0)
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return { periodStart: monday, periodEnd: end }
}

/**
 * 把 Date 格式化成「本地日历日」YYYY-MM-DD（显式 Asia/Shanghai）。
 *
 * ⛔ 不要用 `d.toISOString().split('T')[0]`：toISOString 是 UTC，
 *   而本模块的周期边界全部由 `new Date(y, m, d)` 按**本地时区**算，
 *   UTC+8 的本地 00:00 换算成 UTC 会退到**前一天**（r148 实测，家长可见产出物）：
 *     · 周模式：周一 10/05 印成周日 10/04 —— 比屏幕上早一天，且与工作台/移动端
 *       页面用 dayjs isoWeek 算出的「10/05 ~ 10/11」自相矛盾；
 *     · 月模式：10 月周期的 start 印成 09-30 ⇒ PDF 封面月徽章
 *       `dayjs(period.start).format('M月')` 直接写成「9月」（每份月报都错）。
 *   与 server/lib/weekendHandout.js 的 toYmd 同一口径（同实现，勿再各写一份）。
 */
export function toLocalYmd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)
}

/**
 * ISO 周数（周一为一周起始）
 */
export function getIsoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}
