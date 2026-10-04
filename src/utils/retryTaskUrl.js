/**
 * 重练任务入口 URL（r102 提为共享口径）
 *
 * 此前这段逻辑私有在移动端 src/pages/PrintPreview/index.jsx 里；
 * 负责人 2026-10-04 裁决①要求 PC 错题中心「直接接移动端的重练卷模块」，
 * PC 侧组卷后要生成同一张带二维码的重练卷 ⇒ 二维码入口 URL 必须两端同源，
 * 故上提到 src/utils（两侧共用），PrintPreview 改为引用本实现。
 *
 * 口径：本机 origin（localhost/127.0.0.1）不是学生扫码可达的地址，
 * 一律落到线上 App 域名（VITE_APP_BASE_URL 兜底 minxue.pages.dev）；
 * 非本机 origin 用自身 origin。examId 统一大写（扫码端按大写匹配）。
 */
export const buildRetryTaskUrl = (examId) => {
  const origin = window.location.origin
  const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
  const base = isLocalOrigin
    ? (import.meta.env.VITE_APP_BASE_URL || 'https://minxue.pages.dev')
    : origin
  return `${base}/retry-task/${examId.toUpperCase()}`
}
