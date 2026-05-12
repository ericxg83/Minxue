import { ossClient, generateOSSPath, getCDNUrl, OSS_CONFIG } from '../config/oss.js'

export const uploadFile = async (fileBuffer, ext, type, studentId) => {
  const ossPath = generateOSSPath(type, studentId, ext)

  console.log(`[OSS Upload Debug] 准备上传:`)
  console.log(`  路径: ${ossPath}`)
  console.log(`  文件大小: ${fileBuffer.length} bytes`)
  console.log(`  扩展名: ${ext}`)
  console.log(`  类型: ${type}`)
  console.log(`  学生ID: ${studentId}`)

  try {
    console.log('[OSS Upload Debug] 正在调用 ossClient.put()...')
    const result = await ossClient.put(ossPath, fileBuffer)
    console.log('[OSS Upload Debug] ossClient.put() 调用成功')
    console.log(`  响应状态: ${result.res?.status}`)
    console.log(`  URL: ${result.url}`)
    return getCDNUrl(ossPath)
  } catch (error) {
    console.error('OSS 上传失败:', error)
    console.error('OSS 上传错误详情:', {
      name: error.name,
      code: error.code,
      status: error.status,
      requestId: error.requestId,
      message: error.message,
      hostId: error.hostId
    })
    throw new Error(`文件上传失败: ${error.message}`)
  }
}

export const uploadImage = async (fileBuffer, originalName, studentId) => {
  // Filename is already UTF-8 decoded at the upload endpoint.
  // Just extract the extension for the OSS object key.
  const ext = originalName.split('.').pop().toLowerCase()
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp']

  if (!allowedExts.includes(ext)) {
    throw new Error(`不支持的图片格式: ${ext}`)
  }

  // Upload with ASCII-only key (UUID + ext), original name stays in DB only
  return uploadFile(fileBuffer, ext, 'images', studentId)
}

export const uploadPDF = async (fileBuffer, originalName, studentId) => {
  // Filename is already UTF-8 decoded at the upload endpoint.
  const ext = originalName.split('.').pop().toLowerCase()
  if (ext !== 'pdf') {
    throw new Error('只支持 PDF 格式')
  }

  return uploadFile(fileBuffer, ext, 'pdfs', studentId)
}

export const deleteFile = async (ossPath) => {
  try {
    await ossClient.delete(ossPath)
    return true
  } catch (error) {
    console.error('OSS 删除失败:', error)
    throw new Error(`文件删除失败: ${error.message}`)
  }
}

export const getSignedUrl = async (ossPath, expires = 3600) => {
  try {
    const url = ossClient.signatureUrl(ossPath, { expires })
    return url
  } catch (error) {
    console.error('生成签名URL失败:', error)
    throw error
  }
}

export const listFiles = async (prefix, maxKeys = 100) => {
  try {
    const result = await ossClient.list({
      prefix,
      'max-keys': maxKeys
    })
    return result.objects || []
  } catch (error) {
    console.error('列出文件失败:', error)
    throw error
  }
}
