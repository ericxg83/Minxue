/**
 * OCR 等价题干指纹（周末班课件聚合层专用，不参与判题/错题生命周期）。
 *
 * 同一道印刷体题目经不同学生作业的 OCR 后，题干常出现等效写法差异：
 *   - 平行符号：∥ / // / ‖
 *   - 乘号：× / ✕ / ✖ / x / X
 *   - 全半角括号、句读、空格
 * 这里把这些差异归一为同一字符后再精确匹配；不做编辑距离/相似度阈值。
 */
export function ocrStemKey(raw) {
  let s = String(raw == null ? '' : raw)
  s = s.normalize('NFKC')
  s = s.replace(/\s+/g, '')
  s = s.replace(/[()（）]/g, '')
  s = s.replace(/[,;:!?。、·・，；：！？]/g, '')
  s = s.replace(/∥|\/\/|‖/g, '平行')
  s = s.replace(/[×✕✖xX]/g, 'x')
  s = s.replace(/_{2,}/g, '_')
  s = s.replace(/[-–—]{2,}/g, '—')
  return s.toLowerCase()
}
