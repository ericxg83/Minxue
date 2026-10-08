/**
 * 任务/答卷图片的缩略图 URL（2026-10-08，批改中心列表加试卷小图）。
 *
 * 背景：批改中心任务列表要在每行左侧显示「这张卷长什么样」。
 * 直接 `<img src=原图>` 会拉整张手机照片 —— 实测三张真实上传图分别是
 * 1284KB / 1112KB / 392KB（见下），一屏几十行就是几十 MB。
 *
 * 方案：图片存在阿里云 OSS（`OSS_CDN_DOMAIN=https://minxue-app-oss.oss-cn-shanghai.aliyuncs.com`），
 * 直接给 URL 追加 `?x-oss-process=image/resize,w_240` 让 OSS 端出小图 —— **零后端改动、零额外存储**。
 * 实测（`server/scripts/probeOssThumb.mjs`，2026-10-08，真实任务图，完整 GET 比对字节数）：
 *   1284KB → 15.0KB（85.9x）｜1112KB → 10.4KB（106.5x）｜392KB → 15.7KB（25.6x），三张均 200 + JPEG magic。
 *
 * ⛔ 踩过的坑：**判定「参数生不生效」不能用 HEAD 请求** —— OSS 对 HEAD 不应用 x-oss-process，
 * 会返回原图 content-length，据此会得出「参数没生效」的错误结论（探针第一版就这么误判过）。
 * 必须完整 GET 比字节数。换桶 / 换域名 / 怀疑小图没生效时跑 `node scripts/probeOssThumb.mjs` 定性。
 * 回归测试 `test/ossThumbUrl.test.mjs` 锁纯函数判据边界。
 *
 * 设计取舍：
 * - **只对 OSS 域名 + 图片扩展名生效**，其余 URL（其他 CDN、data:/blob:、PDF）原样返回。
 *   宁可不缩，也不要给不支持该参数的域名硬加查询串 —— 那会把图直接加载失败。
 *   若将来上传改走自建 CDN 域名，需同步扩展 `isOssHost` 的允许名单（并更新测试）。
 * - **幂等**：URL 已带 `x-oss-process` 时原样返回，避免重复叠加。
 */

/** OSS 域名后缀。`OSS_CDN_DOMAIN` 当前就是 `minxue-app-oss.oss-cn-shanghai.aliyuncs.com`（aliyuncs 主机）。 */
const OSS_HOST_SUFFIX = '.aliyuncs.com'

/** 只有图片才谈得上 OSS 图片处理；PDF 等原样返回。 */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|bmp|gif|tiff?|heic|heif)$/i

/** 列表缩略图默认宽度。显示盒约 42×56 CSS px，240px 宽在 2x/3x 屏上都够清晰。 */
export const DEFAULT_THUMB_WIDTH = 240

/** 判断是否 OSS 主机（精确后缀匹配，避免 `evil-aliyuncs.com` 这类近似域名命中）。 */
export function isOssHost(hostname) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  return h.endsWith(OSS_HOST_SUFFIX) || h === OSS_HOST_SUFFIX.slice(1)
}

/**
 * 把 OSS 原图 URL 换成缩略图 URL。
 * 非 OSS / 非图片 / 非法 URL / 空值 ⇒ 原样返回（或空串），调用方无需再判。
 * @param {string} url 原始 image_url
 * @param {number} [width] 目标宽度（px），默认 240
 * @returns {string}
 */
export function ossThumbUrl(url, width = DEFAULT_THUMB_WIDTH) {
  if (typeof url !== 'string') return ''
  const raw = url.trim()
  if (!raw) return ''

  // 幂等：已经带了图片处理参数就不要再叠一层
  if (/[?&]x-oss-process=/i.test(raw)) return raw

  // 保留 hash（当前 OSS URL 不带，但别在拼接时吞掉它）
  const hashAt = raw.indexOf('#')
  const hash = hashAt >= 0 ? raw.slice(hashAt) : ''
  const base = hashAt >= 0 ? raw.slice(0, hashAt) : raw

  let parsed
  try {
    parsed = new URL(base)
  } catch {
    return raw // 相对路径 / 非绝对 URL —— 交给浏览器原样处理
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw
  if (!isOssHost(parsed.hostname)) return raw
  if (!IMAGE_EXT_RE.test(parsed.pathname)) return raw

  const n = Math.round(Number(width))
  const w = Number.isFinite(n) && n > 0 ? n : DEFAULT_THUMB_WIDTH
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}x-oss-process=image/resize,w_${w}${hash}`
}
