/**
 * 截图来源「链接 + 时间点」的统一口径（2026-11-07）。
 *
 * 场景：老师看网课截了一张题，来源是一个视频链接，但真正要记的是「第几分钟」。
 * 于是一个来源拆成两项：`clip_source` = 链接（或纯文字说明），
 * `clip_source_note` = 时间点 / 备注。两项都只是字符串，旧数据零兼容成本。
 *
 * 本文件只放纯函数：URL 安全判据、时间点解析、视频跳转链接生成。
 * 页面展示与回归测试必须共用这一份，禁止各写一套。
 */

/** 严格只认 http(s)：手写文字、javascript: 之类一律不得渲染成可点链接。 */
export const isSourceUrl = (s) => /^https?:\/\//i.test(String(s || '').trim())

/**
 * 从备注里读出「第几秒」。支持的写法（按优先级）：
 *   12:35 / 1:02:35 / 12分35秒 / 12分 / 第3分钟 / 735秒
 * 读不出返回 null（不是为了报错，是让调用方原样打开链接）。
 */
export function parseTimestampSeconds(text) {
  const s = String(text || '')
  // ① H:MM:SS 或 M:SS（放在最前，避免「12:35」被「35秒」类规则抢走）
  const colon = s.match(/(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/)
  if (colon) {
    if (colon[3] != null) {
      return Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3])
    }
    return Number(colon[1]) * 60 + Number(colon[2])
  }
  // ② X分Y秒 / X分
  const cn = s.match(/(\d{1,3})\s*分\s*(\d{1,2})?\s*秒?/)
  if (cn) return Number(cn[1]) * 60 + Number(cn[2] || 0)
  // ③ 第N分钟
  const nth = s.match(/第\s*(\d{1,3})\s*分钟/)
  if (nth) return Number(nth[1]) * 60
  // ④ N秒
  const sec = s.match(/(\d{1,5})\s*秒/)
  if (sec) return Number(sec[1])
  return null
}

/** 只有确认支持 t=<秒> 的视频站才追加参数，别给普通网页乱拼查询串。 */
const TIMESTAMP_HOSTS = /(^|\.)(bilibili\.com|b23\.tv|youtu\.be|youtube\.com)$/i

/**
 * 把「链接 + 12:35」变成能直接跳到 12:35 的链接。
 * 已有 t= / start= 参数的链接原样返回（尊重老师自己贴的定位）。
 * 非视频站、非 http(s)、读不出时间点 ⇒ 原样返回。
 */
export function sourceHref(url, note = '') {
  const u = String(url || '').trim()
  if (!isSourceUrl(u)) return u
  const sec = parseTimestampSeconds(note)
  if (sec == null || sec <= 0) return u
  let parsed
  try { parsed = new URL(u) } catch { return u }
  if (!TIMESTAMP_HOSTS.test(parsed.hostname)) return u
  if (parsed.searchParams.has('t') || parsed.searchParams.has('start')) return u
  parsed.searchParams.set('t', String(sec))
  return parsed.toString()
}
