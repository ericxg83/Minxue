import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  PageBreak,
} from 'docx'

// ============================================================
// 讲义 Word 导出服务（handoutDocxService）
//
// 职责：把 handoutService 产出的讲义结构（pages/blocks）转为 docx 文件。
// 与前端 src/utils/docxGenerator.js 风格保持一致（宋体/黑体），便于老师拿
// 到和前端 Web 预览一致的排版。
// ============================================================

const FONT_SONG = '宋体'
const FONT_HEI = '黑体'

const escText = (s) => String(s || '').replace(/\r\n/g, '\n').trim()

/**
 * 封面页（居中布局）
 */
function buildCoverPage(blocks) {
  const paragraphs = []
  paragraphs.push(new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: '' })] }))

  for (const block of blocks) {
    let text = ''
    let size = 24
    let bold = false
    if (block.type === 'cover-label') {
      text = escText(block.content)
      size = 20
    } else if (block.type === 'cover-title') {
      text = escText(block.content)
      size = 44
      bold = true
    } else if (block.type === 'cover-subtitle') {
      text = escText(block.content)
      size = 24
    } else if (block.type === 'cover-info') {
      text = escText(block.content)
      size = 22
    } else if (block.type === 'cover-date') {
      text = escText(block.content)
      size = 20
    } else {
      text = escText(block.content)
    }
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 120 },
        children: [new TextRun({ text, size, bold, font: block.type === 'cover-title' ? FONT_HEI : FONT_SONG })],
      })
    )
  }

  // 封面后强制分页
  paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  return paragraphs
}

/**
 * 目录页
 */
function buildTocPage(blocks) {
  const paragraphs = []
  for (const block of blocks) {
    if (block.type === 'section') {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 240 },
          children: [new TextRun({ text: escText(block.content), size: 32, bold: true, font: FONT_HEI })],
        })
      )
    } else if (block.type === 'toc-item') {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 240 },
          children: [new TextRun({ text: escText(block.content), size: 24, font: FONT_SONG })],
        })
      )
    }
  }
  paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  return paragraphs
}

/**
 * 单个讲义 block → 1 段或多段 Paragraph
 */
function buildBlockParagraphs(block) {
  const paragraphs = []
  const text = escText(block.content)

  switch (block.type) {
    case 'explanation':
      // 知识点讲解（Markdown 简单剥掉标记）
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 120, line: 360 },
          children: [new TextRun({ text, size: 22, font: FONT_SONG })],
        })
      )
      break

    case 'section':
      paragraphs.push(
        new Paragraph({
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text, size: 28, bold: true, font: FONT_HEI })],
        })
      )
      break

    case 'page-title':
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 240 },
          children: [new TextRun({ text, size: 32, bold: true, font: FONT_HEI })],
        })
      )
      break

    case 'question': {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [new TextRun({ text, size: 22, font: FONT_SONG })],
        })
      )
      if (Array.isArray(block.options) && block.options.length > 0) {
        block.options.forEach((opt, idx) => {
          paragraphs.push(
            new Paragraph({
              indent: { left: 360 },
              spacing: { after: 40 },
              children: [new TextRun({ text: `${String.fromCharCode(65 + idx)}. ${escText(opt)}`, size: 22, font: FONT_SONG })],
            })
          )
        })
      }
      break
    }

    case 'answer': {
      const parts = []
      if (text) parts.push(new TextRun({ text, size: 20, font: FONT_SONG }))
      if (block.correctAnswer) {
        parts.push(new TextRun({ text: `   正确答案：${escText(block.correctAnswer)}`, size: 20, bold: true, color: '52C41A', font: FONT_SONG }))
      }
      paragraphs.push(new Paragraph({ spacing: { before: 40, after: 40 }, children: parts }))
      break
    }

    case 'analysis':
      paragraphs.push(
        new Paragraph({
          spacing: { before: 40, after: 80 },
          children: [new TextRun({ text, size: 20, font: FONT_SONG, italics: true, color: 'F5222D' })],
        })
      )
      break

    case 'variant': {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [
            new TextRun({ text: '【变式】', size: 20, bold: true, color: '3B82F6', font: FONT_HEI }),
            new TextRun({ text, size: 22, font: FONT_SONG }),
          ],
        })
      )
      if (Array.isArray(block.options) && block.options.length > 0) {
        block.options.forEach((opt, idx) => {
          paragraphs.push(
            new Paragraph({
              indent: { left: 360 },
              spacing: { after: 40 },
              children: [new TextRun({ text: `${String.fromCharCode(65 + idx)}. ${escText(opt)}`, size: 22, font: FONT_SONG })],
            })
          )
        })
      }
      if (block.answer) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 40, after: 40 },
            children: [new TextRun({ text: `答案：${escText(block.answer)}`, size: 20, bold: true, color: '52C41A', font: FONT_SONG })],
          })
        )
      }
      if (block.analysis) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 20, after: 60 },
            children: [new TextRun({ text: `解析：${escText(block.analysis)}`, size: 20, font: FONT_SONG, color: '86909C' })],
          })
        )
      }
      break
    }

    case 'text':
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text, size: 20, font: FONT_SONG, italics: true, color: '4E5969' })],
        })
      )
      break

    default:
      // 未知类型：原样输出，避免丢内容
      if (text) {
        paragraphs.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text, size: 22, font: FONT_SONG })],
          })
        )
      }
  }
  return paragraphs
}

/**
 * 组装 docx 文档
 * @param {Object} handout 来自 handoutService.buildHandout 的结构
 * @returns {Promise<Buffer>} docx 二进制
 */
export async function buildHandoutDocx(handout) {
  if (!handout || !Array.isArray(handout.pages) || handout.pages.length === 0) {
    throw new Error('讲义数据为空，无法导出')
  }

  const children = []
  for (const page of handout.pages) {
    if (page.name === 'cover') {
      children.push(...buildCoverPage(page.blocks || []))
    } else if (page.name === 'toc') {
      children.push(...buildTocPage(page.blocks || []))
    } else {
      for (const block of page.blocks || []) {
        children.push(...buildBlockParagraphs(block))
      }
      // 每个知识点页之后分页（最后页不分）
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
  }

  // 去掉最后一页的多余分页符：检查最后一个 child
  if (children.length > 0) {
    const last = children[children.length - 1]
    if (last && last.root && last.root[0] && last.root[0].constructor.name === 'PageBreakRun') {
      children.pop()
    }
  }

  const doc = new Document({
    creator: '明学 · 教学讲义',
    title: escText(handout.title) || '教学讲义',
    description: '由 handoutService 自动生成',
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch
          },
        },
        children,
      },
    ],
    styles: {
      default: {
        document: { run: { font: FONT_SONG, size: 22 } },
      },
    },
  })

  return await Packer.toBuffer(doc)
}
