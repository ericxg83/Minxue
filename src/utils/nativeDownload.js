/**
 * nativeDownload.js — 移动端「静默存文件」导出
 *
 * Capacitor Android 里 file-saver 的 saveAs 会被 WebView 拦截：blob URL + <a download>
 * 常常不走系统下载管理器，而是弹出 PDF 查看器 / 打印分享面板——这正是用户反馈的
 * 「点下载 PDF 却弹出打印框」。这里在原生环境改用 @capacitor/filesystem 把字节直接
 * 写进手机「文件 / Documents」，全程无弹窗；Web 环境仍走 saveAs。
 *
 * ⚠️ 回归记录（2026-10-10 修复）：本模块曾于 2026-10-02 的「死代码清理」中被判定不可达删除，
 * 起因是调用方 PrintPreview 里 `const { savedTo } = await saveFileToDevice(...)` 的
 * **返回值**未被读取 ⇒ eslint no-unused-vars 把这一行当成死代码删掉，但它的**副作用**
 * （把 PDF 写进设备）才是「下载PDF」按钮唯一真正的下载动作。
 * 结果：点「下载PDF」只弹「已下载」成功提示，文件从未保存（负责人 2026-10-10 反馈）。
 * 教训：调用点必须消费返回值（哪怕只用于 Toast 回显），否则会被清理器再次误杀。
 */

const isNative = () => {
  try {
    return !!(window.Capacitor?.isNativePlatform?.())
  } catch {
    return false
  }
}

// WebView 无 Node Buffer，手动分片转 base64，避免超长字符串 apply 溢出调用栈
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * 保存一个 PDF/文件 Blob。
 * @param {Blob} blob
 * @param {string} filename 含扩展名（如 xxx.pdf）
 * @param {string} [subdir] 原生环境下的子目录（写入 Documents/<subdir>/<filename>）
 * @returns {Promise<{native:boolean, savedTo:string}>} savedTo 供 Toast 展示
 */
export async function saveFileToDevice(blob, filename, subdir = '敏学试卷') {
  if (!isNative()) {
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
    return { native: false, savedTo: '浏览器下载' }
  }

  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const data = await blobToBase64(blob)
  const path = subdir ? `${subdir}/${filename}` : filename
  const res = await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Documents,
    recursive: true,
  })
  return { native: true, savedTo: res.uri || `文件 / Documents / ${path}` }
}
