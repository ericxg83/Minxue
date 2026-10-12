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

/** YYYY-MM-DD 字符串上平移 N 天（纯 UTC 日历运算，与运行环境时区无关）；格式非法时原样返回 */
export function shiftYmd(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) return String(ymd || '')
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10)
}

/**
 * 「排他边界 → 对外展示的最后一天」：取边界时刻的上海日历日，再往前挪一天。
 *
 * ⛔ 不要写 `toLocalYmd(new Date(boundary.getTime() - 1))`（r266 实测生产缺陷）：
 *   周期边界由 `new Date(y, m, d)` 按**服务器本地时区**算 —— Render 容器 TZ=UTC，
 *   边界是 UTC 零点；而 toLocalYmd 固定按 Asia/Shanghai(+8) 格式化。
 *   于是在 UTC 服务器上「边界 − 1ms」加 8 小时后仍落在边界的上海日历日里，
 *   减 1ms 被完全抵消 ⇒ 周报 / 家长分享卡把「学习周期」印成 10/12 ~ 10/19
 *   （把下周一也算了进去；月模式印成 10/01 ~ 11/01）。生产 GET /api/weekly-report
 *   2026-10-12（周一）实测 period.end = "2026-10-19"。
 *   先取边界的上海日历日、再在**日历日字符串**上减一天，两种服务器时区下都对：
 *   · Render(TZ=UTC)：边界 10/19 00:00 UTC → 上海日 '2026-10-19' → 减一 → '2026-10-18' ✓
 *   · 本机(TZ=+8)：边界 10/19 00:00 +08 → 上海日 '2026-10-19' → 减一 → '2026-10-18' ✓（与旧行为逐字一致）
 *
 * @param {Date} periodEnd - 排他边界（下周一 / 次月 1 日 00:00）
 * @returns {string} YYYY-MM-DD，该周期对家长展示的「最后一天」
 */
export function exclusiveEndYmd(periodEnd) {
  return shiftYmd(toLocalYmd(periodEnd), -1)
}

/**
 * 「N 天前的本地日历日」（YYYY-MM-DD），供统计类接口的默认窗口起点使用。
 *
 * ⛔ 不要用 `new Date(Date.now() - days*86400000).toISOString().slice(0,10)`：
 *    toISOString 印的是 UTC 日。生产容器在 UTC+8，本地 00:00~08:00 之间算出来的
 *    窗口起点会退到**前一天**——r148/r151/r155 连续清过三轮时区类漏网
 *    （weeklyReport / teaching / wrongRetryPdf），这是 r157 清掉的最后一处：
 *    `server/index.js` 的误判统计接口默认 since。
 *    该接口虽只影响管理员统计（影响 ≤1 天），但同一类错误每轮都要重新认一遍，
 *    故收敛成一个纯函数，锁 test/adminStatsSince.test.mjs 盯死它。
 *
 * @param {number} days - 往前推多少天
 * @param {Date|number} [now] - 当前时刻，便于注入做确定性断言
 * @returns {string} YYYY-MM-DD（上海时区）
 */
export function localDaysAgoYmd(days, now = new Date()) {
  const at = now instanceof Date ? now.getTime() : Number(now)
  return toLocalYmd(new Date(at - days * 86400000))
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
