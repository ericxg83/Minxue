import OSS from 'ali-oss'
import crypto from 'crypto'

let _ossClient = null
let _cdnDomain = null

export const getOSSClient = () => {
  if (!_ossClient) {
    const region = process.env.OSS_REGION
    const bucket = process.env.OSS_BUCKET
    const accessKeyId = process.env.OSS_ACCESS_KEY_ID
    const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
    _cdnDomain = process.env.OSS_CDN_DOMAIN

    const hasAllConfig = region && bucket && accessKeyId && accessKeySecret

    if (!hasAllConfig) {
      throw new Error('OSS 未配置：缺少环境变量。请检查 OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET')
    }

    console.log('[OSS Config] 初始化OSS客户端:')
    console.log(`  region: ${region}`)
    console.log(`  bucket: ${bucket}`)
    console.log(`  accessKeyId: ${accessKeyId?.substring(0, 8)}...`)
    console.log(`  accessKeySecret长度: ${accessKeySecret?.length}`)

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

export const ossClient = new Proxy({}, {
  get(target, prop) {
    const client = getOSSClient()
    return client[prop]
  }
})

export const OSS_CONFIG = {
  get region() { return process.env.OSS_REGION },
  get bucket() { return process.env.OSS_BUCKET },
  get cdnDomain() {
    return _cdnDomain || process.env.OSS_CDN_DOMAIN || 
      (process.env.OSS_REGION && process.env.OSS_BUCKET 
        ? `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com` 
        : '')
  },
  maxSize: 20 * 1024 * 1024,
  allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
}

export const generateOSSPath = (type, studentId, ext) => {
  const date = new Date()
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const uuid = crypto.randomUUID()
  return `${type}/${studentId}/${dateStr}/${uuid}.${ext}`
}

export const getCDNUrl = (ossPath) => {
  const cdnDomain = process.env.OSS_CDN_DOMAIN
  if (cdnDomain) {
    return `${cdnDomain}/${ossPath}`
  }
  return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${ossPath}`
}
