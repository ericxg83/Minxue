import { ossClient, generateOSSPath, getCDNUrl, OSS_CONFIG } from '../config/oss.js'

export const uploadFile = async (fileBuffer, originalName, type, studentId) => {
  const ossPath = generateOSSPath(type, studentId, originalName)

  try {
    const result = await ossClient.put(ossPath, fileBuffer)
    return getCDNUrl(ossPath)
  } catch (error) {
    console.error('OSS 上传失败:', error)
    throw new Error(`文件上传失败: ${error.message}`)
  }
}

export const uploadImage = async (fileBuffer, originalName, studentId) => {
  // Decode UTF-8 filename (multer may pass latin1-encoded bytes)
  let decodedName = originalName
  try {
    decodedName = Buffer.from(originalName, 'latin1').toString('utf8')
    // Verify it's valid UTF-8
    Buffer.from(decodedName, 'utf8').toString()
  } catch (e) {
    // If decoding fails, use original name
    decodedName = originalName
  }

  // Extract extension from decoded filename
  const ext = decodedName.split('.').pop().toLowerCase()
  const allowedExts = ['jpg', 'jpeg', 'png', 'webp']

  if (!allowedExts.includes(ext)) {
    throw new Error(`不支持的图片格式: ${ext}`)
  }

  return uploadFile(fileBuffer, decodedName, 'images', studentId)
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
