/**
 * 探针：阿里云 OSS 图片处理（缩略图）是否可用 —— 只读，不写库、不写 OSS。
 *
 * 用途：`src/utils/ossThumb.js` 靠给 OSS 图 URL 追加 `?x-oss-process=image/resize,w_240`
 * 让 OSS 端出缩略图（批改中心任务列表的「试卷小图」就靠它，否则一行拉一张 0.4~1.3MB 原图）。
 * 这条链路依赖**桶侧配置**（图片处理是否开通、自定义 CDN 是否透传参数），
 * 换桶 / 换域名 / 怀疑「小图没生效」时跑一次即可定性。
 *
 * 跑法（在 server/ 下）：`node scripts/probeOssThumb.mjs`
 * 依赖：`server/.env` 里的 NEON_DATABASE_URL（取真实 image_url）与 OSS_*（仅用于拼 URL）。
 *
 * ⛔ 判定纪律（踩过，别再踩）：
 *   **不能用 HEAD 请求判定参数生不生效** —— OSS 对 HEAD 不应用 x-oss-process，
 *   会返回**原图**的 content-length，据此会得出「参数没生效」的错误结论。
 *   必须完整 GET 比字节数（本探针第一版就误判过）。
 *
 * 实测基线（2026-10-08，三张真实上传图，完整 GET）：
 *   1284KB → 15.0KB（85.9x）｜1112KB → 10.4KB（106.5x）｜392KB → 15.7KB（25.6x），均 200 + JPEG magic。
 */
import '../loadEnv.js'
import { getPool } from '../config/neon.js'

const pool = getPool()

const pick = async () => {
  const { rows } = await pool.query(
    `SELECT id, created_at, image_url
     FROM tasks
     WHERE deleted_at IS NULL AND image_url IS NOT NULL AND image_url <> ''
     ORDER BY created_at DESC LIMIT 5`
  )
  return rows
}

/** 完整 GET（见文件头 ⛔：HEAD 会给出误导性的 content-length）。 */
const fetchInfo = async (url) => {
  try {
    const res = await fetch(url)
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      status: res.status,
      type: res.headers.get('content-type'),
      len: buf.length,
      magic: buf.subarray(0, 3).toString('hex') // JPEG 应为 ffd8ff
    }
  } catch (e) {
    return { error: e.message }
  }
}

const rows = await pick()
if (!rows.length) {
  console.log('没有找到带 image_url 的任务，无法判定')
  await pool.end()
  process.exit(1)
}

let bad = 0
for (const row of rows.slice(0, 3)) {
  const url = row.image_url
  const sep = url.includes('?') ? '&' : '?'
  const thumb = `${url}${sep}x-oss-process=image/resize,w_240`
  const [plain, small] = await Promise.all([fetchInfo(url), fetchInfo(thumb)])
  const ok = small.status === 200 && plain.len > 0 && small.len > 0 && small.len < plain.len
  if (!ok) bad++
  console.log('='.repeat(72))
  console.log('task', row.id, '|', row.created_at)
  console.log('  url   :', url)
  console.log('  原图  :', JSON.stringify(plain))
  console.log('  缩图  :', JSON.stringify(small))
  console.log('  压缩比:', ok ? `${(plain.len / small.len).toFixed(1)}x  (${(plain.len / 1024).toFixed(0)}KB → ${(small.len / 1024).toFixed(1)}KB)` : '-')
  console.log('  判定  :', ok ? '✅ OSS 图片处理可用' : '❌ 参数未生效或请求失败')
}

console.log(`\n===== probeOssThumb：${3 - bad}/3 可用 =====`)
await pool.end()
process.exit(bad ? 1 : 0)
