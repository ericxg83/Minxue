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
 * ISO 周数（周一为一周起始）
 */
export function getIsoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}
