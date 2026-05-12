import { fileTypeFromBuffer } from 'file-type'

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const MAGIC_BYTES = {
  jpg: [
    { offset: 0, bytes: [0xFF, 0xD8, 0xFF] },
  ],
  png: [
    { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] },
  ],
  webp: [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  ],
}

export const VALIDATION_CONFIG = {
  MAX_FILE_SIZE: 20 * 1024 * 1024,
  MIN_FILE_SIZE: 1024,
  ALLOWED_MIME_TYPES: ALLOWED_IMAGE_TYPES,
  ALLOWED_EXTENSIONS,
}

export const validateFileExtension = (filename) => {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: '文件名无效' }
  }
  const ext = filename.split('.').pop().toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `不支持的文件格式: .${ext}`, ext }
  }
  return { valid: true, ext }
}

export const validateFileSize = (size) => {
  if (size == null || typeof size !== 'number') {
    return { valid: false, error: '文件大小未知' }
  }
  if (size === 0) {
    return { valid: false, error: '文件为空 (0 bytes)' }
  }
  if (size < VALIDATION_CONFIG.MIN_FILE_SIZE) {
    return { valid: false, error: `文件过小 (${size} bytes)，可能已损坏` }
  }
  if (size > VALIDATION_CONFIG.MAX_FILE_SIZE) {
    const sizeMB = (size / (1024 * 1024)).toFixed(2)
    return { valid: false, error: `文件过大 (${sizeMB}MB)，超过限制 20MB` }
  }
  return { valid: true }
}

export const validateFileHeader = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, error: '文件缓冲区为空' }
  }

  try {
    const fileType = await fileTypeFromBuffer(buffer)
    if (!fileType) {
      return {
        valid: false,
        error: '无法识别文件类型 — 文件头损坏或格式不支持',
      }
    }

    const detectedMime = fileType.mime
    const detectedExt = fileType.ext

    if (!ALLOWED_IMAGE_TYPES.has(detectedMime)) {
      return {
        valid: false,
        error: `检测到不支持的MIME类型: ${detectedMime}`,
        detectedType: detectedMime,
      }
    }

    return {
      valid: true,
      detectedMime,
      detectedExt,
    }
  } catch (err) {
    return {
      valid: false,
      error: `文件头解析失败: ${err.message}`,
    }
  }
}

export const validateImageIntegrity = async (buffer) => {
  try {
    const { default: sharp } = await import('sharp')
    const metadata = await sharp(buffer).metadata()

    if (!metadata.width || !metadata.height) {
      return { valid: false, error: '图片维度无效 — 文件可能已损坏' }
    }

    if (metadata.width < 10 || metadata.height < 10) {
      return {
        valid: false,
        error: `图片尺寸过小 (${metadata.width}x${metadata.height})`,
      }
    }

    return {
      valid: true,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    }
  } catch (err) {
    return {
      valid: false,
      error: `图片完整性检查失败: ${err.message}`,
    }
  }
}

export const validateFile = async (fileBuffer, originalName, fileMeta = {}) => {
  const logs = []
  const timestamp = new Date().toISOString()
  const filename = originalName || 'unknown'
  const size = fileMeta.size || (fileBuffer ? fileBuffer.length : 0)

  const report = {
    filename,
    timestamp,
    size,
    steps: [],
  }

  const addStep = (name, result) => {
    const step = { name, ...result, timestamp: new Date().toISOString() }
    report.steps.push(step)
    logs.push(`[Validate] [${filename}] ${name}: ${result.valid ? 'PASS' : 'FAIL'}${result.error ? ' — ' + result.error : ''}`)
  }

  console.log(`\n[Validate] ========== 开始验证文件: ${filename} ==========`)
  console.log(`  大小: ${size} bytes`)

  const extResult = validateFileExtension(filename)
  addStep('extension_check', { valid: extResult.valid, error: extResult.error, ext: extResult.ext })
  if (!extResult.valid) {
    console.log(`[Validate] ❌ 验证失败: ${extResult.error}`)
    report.valid = false
    report.errorType = 'UNSUPPORTED_FORMAT'
    report.error = extResult.error
    report.logs = logs
    return report
  }

  const sizeResult = validateFileSize(size)
  addStep('size_check', { valid: sizeResult.valid, error: sizeResult.error })
  if (!sizeResult.valid) {
    console.log(`[Validate] ❌ 验证失败: ${sizeResult.error}`)
    report.valid = false
    report.errorType = size === 0 || size < VALIDATION_CONFIG.MIN_FILE_SIZE ? 'CORRUPTED_FILE' : 'FILE_SIZE_EXCEEDED'
    report.error = sizeResult.error
    report.logs = logs
    return report
  }

  const headerResult = await validateFileHeader(fileBuffer)
  addStep('header_check', {
    valid: headerResult.valid,
    error: headerResult.error,
    detectedMime: headerResult.detectedMime,
    detectedExt: headerResult.detectedExt,
  })
  if (!headerResult.valid) {
    console.log(`[Validate] ❌ 验证失败: ${headerResult.error}`)
    report.valid = false
    report.errorType = 'CORRUPTED_FILE'
    report.error = headerResult.error
    report.logs = logs
    return report
  }

  const integrityResult = await validateImageIntegrity(fileBuffer)
  addStep('integrity_check', {
    valid: integrityResult.valid,
    error: integrityResult.error,
    width: integrityResult.width,
    height: integrityResult.height,
    format: integrityResult.format,
  })
  if (!integrityResult.valid) {
    console.log(`[Validate] ❌ 验证失败: ${integrityResult.error}`)
    report.valid = false
    report.errorType = 'CORRUPTED_FILE'
    report.error = integrityResult.error
    report.logs = logs
    return report
  }

  console.log(`[Validate] ✅ 文件验证通过: ${filename}`)
  report.valid = true
  report.detectedType = headerResult.detectedMime
  report.detectedExt = headerResult.detectedExt || extResult.ext
  report.imageDimensions = { width: integrityResult.width, height: integrityResult.height }
  report.logs = logs

  return report
}

export const fixFileIfNeeded = async (fileBuffer, originalName) => {
  const logs = []
  const filename = originalName || 'unknown'
  let fixedBuffer = fileBuffer
  let fixed = false
  let fixDescription = ''

  try {
    const { default: sharp } = await import('sharp')
    const headerCheck = await validateFileHeader(fixedBuffer)

    if (!headerCheck.valid) {
      logs.push(`[Fix] [${filename}] 尝试重新编码文件...`)
      fixedBuffer = await sharp(fileBuffer)
        .jpeg({ quality: 85, progressive: true })
        .toBuffer()

      const recheck = await validateFileHeader(fixedBuffer)
      if (recheck.valid) {
        fixed = true
        fixDescription = '文件已重新编码为 JPEG'
        logs.push(`[Fix] [${filename}] ✅ 重新编码成功`)
      } else {
        logs.push(`[Fix] [${filename}] ❌ 重新编码后仍无法识别`)
      }
    } else {
      const integrityCheck = await validateImageIntegrity(fixedBuffer)
      if (!integrityCheck.valid) {
        logs.push(`[Fix] [${filename}] 尝试修复图片完整性...`)
        try {
          fixedBuffer = await sharp(fileBuffer)
            .jpeg({ quality: 85, progressive: true })
            .toBuffer()
          const recheck = await validateImageIntegrity(fixedBuffer)
          if (recheck.valid) {
            fixed = true
            fixDescription = '损坏图片已修复并重新编码'
            logs.push(`[Fix] [${filename}] ✅ 图片修复成功`)
          }
        } catch (err) {
          logs.push(`[Fix] [${filename}] ❌ 图片修复失败: ${err.message}`)
        }
      }
    }
  } catch (err) {
    logs.push(`[Fix] [${filename}] 修复过程异常: ${err.message}`)
  }

  return {
    fixedBuffer,
    fixed,
    fixDescription,
    logs,
  }
}
