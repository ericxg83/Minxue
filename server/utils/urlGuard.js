/**
 * urlGuard.js — 图片 URL 安全校验（提案⑱，2026-10-04）
 *
 * 背景（backlog 提案⑱/⑲）：POST /api/tasks/create-by-url 对 imageUrl 零校验
 * （唯一"校验"是 startsWith('http')），而抓图处曾三处内联复制 axios.get、
 * 绕过统一入口 —— 任何人可不登录让服务器访问任意 URL（SSRF：内网/回环/云元数据），
 * 并无限触发付费 AI 批改烧额度。
 *
 * 两道防线（只加校验，不改抓取行为；符合「校验器只许加规则不许放宽」纪律）：
 *   1. assertImageUrlAllowed(url)  —— 端点层：协议 + 域名白名单；
 *   2. assertNotPrivateUrl(url)    —— 抓图层（downloadImageBufferNoProxy 统一入口）：
 *      不做域名白名单（避免误伤历史存量图床），但硬拦私网/回环/链路本地/元数据地址
 *      （字面 IP + DNS 解析后双重判断）。
 *
 * 之所以必须放在统一入口才有效：三处内联副本已于同日收敛为调用封装，
 * test/imageFetchGuard.test.mjs 锁住「直接 axios 抓图的点为 0」，防止回退。
 *
 * 逃生门：IMAGE_URL_ALLOW_PRIVATE=1 时放行私网地址 —— 仅限本地开发
 * （Render 生产绝不配置）。白名单外新增自有图床用 IMAGE_URL_EXTRA_HOSTS（逗号分隔）。
 */
import dns from 'node:dns'
import { promises as dnsPromises } from 'node:dns'

/** 私有/保留网段（IPv4 + IPv6），命中即拒绝 */
const PRIVATE_V4 = [
  ['0.0.0.0', 8], // 本机通配
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGN / 云元数据过渡段
  ['127.0.0.0', 8], // 回环
  ['169.254.0.0', 16], // 链路本地（含 169.254.169.254 云元数据）
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
]
const PRIVATE_V6_PREFIX = ['::1', '::', 'fc', 'fd', 'fe80']

function v4ToInt(ip) {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n
}

function isPrivateIP(ip) {
  if (ip.includes(':')) {
    const low = ip.toLowerCase()
    return PRIVATE_V6_PREFIX.some((p) => low === p || low.startsWith(p))
  }
  const n = v4ToInt(ip)
  if (n == null) return false
  return PRIVATE_V4.some(([base, bits]) => {
    const b = v4ToInt(base)
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (b & mask)
  })
}

/** 字面 IP 或主机名是否指向私网（主机名做 DNS 解析后判断，含多记录） */
export async function resolvesToPrivateAddress(hostname) {
  const literal = hostname.replace(/^\[|\]$/g, '')
  if (isPrivateIP(literal)) return true
  if (!/^[a-zA-Z]/.test(hostname) && !hostname.includes(':')) return false
  try {
    const records = await dnsPromises.lookup(hostname, { all: true, verbatim: true })
    return records.some((r) => isPrivateIP(r.address))
  } catch {
    // 解析失败（不存在/临时故障）：按可疑处理，交给调用方按错误拒绝
    return true
  }
}

/** 域名白名单：自家 OSS（任意区域 bucket）、Cloudflare Pages、env 追加 */
function isWhitelistedHost(hostname) {
  const host = hostname.toLowerCase()
  const extra = (process.env.IMAGE_URL_EXTRA_HOSTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const allowed = [...extra, 'aliyuncs.com', 'minxue.pages.dev', 'localhost']
  return allowed.some((h) => host === h || host.endsWith('.' + h))
}

export function isUrlSchemeAllowed(url) {
  let parsed
  try { parsed = new URL(url) } catch { return false }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

/**
 * 端点层校验：协议 + 白名单（不查私网——白名单域名解析到私网的情形由第二道防线兜）。
 * 通过时返回规范化 URL 字符串；不通过抛 Error（message 面向老师可读）。
 */
export async function assertImageUrlAllowed(url) {
  if (!url || typeof url !== 'string') throw new Error('缺少图片地址')
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('图片地址格式无效') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('图片地址仅支持 http/https')
  }
  if (!isWhitelistedHost(parsed.hostname)) {
    throw new Error(
      `图片地址域名不在允许列表（${parsed.hostname}）。`
      + `仅允许自家 OSS / minxue.pages.dev${process.env.IMAGE_URL_EXTRA_HOSTS ? ' / 配置的额外图床' : ''}`
    )
  }
  if (process.env.IMAGE_URL_ALLOW_PRIVATE !== '1' && (await resolvesToPrivateAddress(parsed.hostname))) {
    throw new Error('图片地址解析到内网/回环地址，已拒绝')
  }
  return parsed.toString()
}

/**
 * 抓图层校验（第二道防线）：不做白名单（避免误伤历史存量图床），但硬拦私网/回环/元数据。
 * allowPrivate 仅在 IMAGE_URL_ALLOW_PRIVATE=1（本地开发）时放行。
 */
export async function assertNotPrivateUrl(url) {
  if (!isUrlSchemeAllowed(url)) throw new Error(`下载地址仅支持 http/https：${String(url).slice(0, 80)}`)
  if (process.env.IMAGE_URL_ALLOW_PRIVATE === '1') return
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('下载地址格式无效') }
  if (await resolvesToPrivateAddress(parsed.hostname)) {
    throw new Error(`下载地址解析到内网/回环/元数据地址，已拦截（SSRF 防线）：${parsed.hostname}`)
  }
}

export { isPrivateIP, isWhitelistedHost, dns }
