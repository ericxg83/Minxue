import { ossClient, generateOSSPath, getCDNUrl, OSS_CONFIG } from '../config/oss.js'

export const uploadFile = async (fileBuffer, originalName, type, studentId) => {
  const ossPath = generateOSSPath(type, studentId, originalName)

  try {
    const result = await ossClient.put(ossPath, fileBuffer)
    return {
      url: getCDNUrl(ossPath),
      ossPath: result.name,
      size: result.size
    }
  } catch (error) {
    console.error('OSS 上传失败:', error)
    throw new Error(`文件上传失败: ${error.message}`)
  }
}

export const uploadImage = async (fileBuffer, originalName, studentId) => {
  // 检查文件类型
  const ext = originalName.split('.').pop().toLowerCase()
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp']

  if (!allowedExts.includes(ext)) {
    throw new Error(`不支持的图片格式: ${ext}`)
  }

  return uploadFile(fileBuffer, originalName, 'images', studentId)
}

export const uploadPDF = async (fileBuffer, originalName, studentId) => {
  const ext = originalName.split('.').pop().toLowerCase()
  if (ext !== 'pdf') {
    throw new Error('只支持 PDF 格式')
  }

  return uploadFile(fileBuffer, originalName, 'pdfs', studentId)
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
