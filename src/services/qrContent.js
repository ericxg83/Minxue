// 生成二维码内容（用于学生重练）
export const generateQRCodeContent = (studentId, questionIds) => {
  const data = {
    type: 'training',
    studentId,
    questionIds,
    timestamp: Date.now()
  }
  return JSON.stringify(data)
}

// 解析二维码内容
export const parseQRCodeContent = (content) => {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}
