/**
 * 下载外部图片（OSS 页图 / 答案页图 / 错题裁片）时统一使用的 axios 选项（2026-09-22）。
 *
 * 为什么必须集中一份：
 *   本机或容器环境里只要设了 `HTTP_PROXY` / `HTTPS_PROXY`（开发机沙箱、公司网关、CI），
 *   **axios 默认就会把请求交给该代理**。OSS 页图请求经代理后返回 400，于是抛
 *   「下载图片失败: Request failed with status code 400」→ 整个任务 failed。
 *   `server/config/ai.js` 早就对 AI 调用显式关代理（`proxyOff`），但下载图片的四处
 *   调用各写各的、全都漏了 —— 事故当天三个作业任务因此共 50 道题的参考答案永久为空。
 *
 * 实测（同一 OSS URL，环境设了 HTTP_PROXY）：
 *   旧写法（不传 proxy）  → ❌ Request failed with status code 400
 *   本选项（proxy:false） → ✅ HTTP 200, 939485 bytes, JPEG
 *
 * ⚠️ 新增任何"从 URL 取图片"的调用，都必须带上本选项，不要再手写 axios 参数。
 * 回归测试 test/noProxyDownload.test.mjs 会扫描下载调用点，漏带即失败。
 */
import axios from 'axios'

export const NO_PROXY_DOWNLOAD_OPTS = Object.freeze({
  responseType: 'arraybuffer',
  timeout: 30000,
  proxy: false,
  httpsAgent: false,
  httpAgent: false
})

/** 下载图片并返回 Buffer（统一走 NO_PROXY_DOWNLOAD_OPTS） */
export const downloadImageBufferNoProxy = async (url) => {
  const resp = await axios.get(url, NO_PROXY_DOWNLOAD_OPTS)
  return Buffer.from(resp.data)
}
