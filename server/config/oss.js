import OSS from 'ali-oss'

const region = process.env.OSS_REGION
const bucket = process.env.OSS_BUCKET
const accessKeyId = process.env.OSS_ACCESS_KEY_ID
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
const cdnDomain = process.env.OSS_CDN_DOMAIN

const hasAllConfig = region && bucket && accessKeyId && accessKeySecret

if (!hasAllConfig) {
  console.warn('⚠️  缺少 OSS 环境变量配置，文件上传功能将不可用')
  console.warn('请检查: OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET')
}

// 懒加载 OSS 客户端，避免启动时报错
let _ossClient = null

export const getOSSClient = () => {
  if (!_ossClient) {
    if (!hasAllConfig) {
      throw new Error('OSS 未配置：缺少环境变量。请检查 OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET')
    }
    _ossClient = new OSS({
      region,
      bucket,
      accessKeyId,
      accessKeySecret,
      secure: true,
      timeout: 60000
    })
  }
  return _ossClient
}

// 兼容旧代码的导出
export const ossClient = new Proxy({}, {
  get(target, prop) {
    const client = getOSSClient()
    return client[prop]
  }
})

export const OSS_CONFIG = {
  region,
  bucket,
  cdnDomain: cdnDomain || (region && bucket ? `https://${bucket}.${region}.aliyuncs.com` : ''),
  maxSize: 20 * 1024 * 1024, // 20MB
  allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
}

export const generateOSSPath = (type, studentId, filename) => {
  const date = new Date()
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const random = Math.random().toString(36).substring(2, 10)
  const ext = filename.split('.').pop()
  return `${type}/${studentId}/${dateStr}/${random}.${ext}`
}

export const getCDNUrl = (ossPath) => {
  if (cdnDomain) {
    return `${cdnDomain}/${ossPath}`
  }
  return `https://${bucket}.${region}.aliyuncs.com/${ossPath}`
}
