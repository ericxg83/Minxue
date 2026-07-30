/**
 * 校验 buffer 是否为合法图片：用于拦截 OSS 404/403 鉴权失败返回的 XML/HTML 错误页
 * （约 3000-4000 bytes，axios 仍按 2xx 视为成功）。
 *
 * 判定规则（任一命中即视为非图片）：
 *   1. buffer 长度 < 1024 bytes
 *   2. 前 4 字节不是 JPEG / PNG / WebP / HEIC 魔数
 *   3. 前 200 字符是 XML/HTML 文档前缀
 *
 * 纯函数，独立可测。
 */
export function isValidImageBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 1024) return false
  const magic = buf.slice(0, 4)
  const isJpeg = magic[0] === 0xFF && magic[1] === 0xD8 && magic[2] === 0xFF
  const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47
  const isWebp = magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46 // RIFF
  // HEIC/HEIF/MOV：4-7 字节是 'ftyp'（ISOBMFF 容器通用标识）
  const isHeic = buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp'
  if (isJpeg || isPng || isWebp || isHeic) {
    // 命中已知图片魔数，但还应排除前端伪装的 XML/HTML（理论上不可能，但防御性兜底）
    const head = buf.slice(0, 200).toString('utf8').trim()
    if (head.startsWith('<?xml') || head.startsWith('<Error>') || head.startsWith('<html')) return false
    return true
  }
  // 魔数不匹配但前 200 字符就是 XML/HTML → 一律视为非图片（避免 3116 bytes XML 假图片通过）
  const head = buf.slice(0, 200).toString('utf8').trim()
  if (head.startsWith('<?xml') || head.startsWith('<Error>') || head.startsWith('<html')) return false
  return false
}
