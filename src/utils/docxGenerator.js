import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  PageBreak,
  TabStopPosition,
  TabStopType,
} from 'docx'
import { saveAs } from 'file-saver'

/**
 * 将base64图片数据转换为Uint8Array
 */
function base64ToUint8Array(base64) {
  const base64Data = base64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '')
  const binaryString = atob(base64Data)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * 创建空行（间距控制）
 */
function emptyParagraph(spacing = 80) {
  return new Paragraph({
    spacing: { after: spacing },
    children: [new TextRun({ text: ' ', size: 12 })]
  })
}

/**
 * 选择题选项：2列排列（A B / C D）
 * 使用制表位实现两列对齐，这是中国标准试卷格式
 */
function createOptionsParagraphs(options) {
  if (!options || options.length === 0) return []
  
  const paragraphs = []
  const pairs = []
  
  for (let i = 0; i < options.length; i += 2) {
    if (i + 1 < options.length) {
      pairs.push([options[i], options[i + 1]])
    } else {
      pairs.push([options[i]])
    }
  }
  
  pairs.forEach(pair => {
    const children = []
    children.push(new TextRun({
      text: pair[0],
      size: 24,
      font: '宋体',
    }))
    if (pair[1]) {
      children.push(new TextRun({
        text: '\t',
        size: 24,
        font: '宋体',
      }))
      children.push(new TextRun({
        text: pair[1],
        size: 24,
        font: '宋体',
      }))
    }
    
    paragraphs.push(
      new Paragraph({
        indent: { left: 560 },
        spacing: { before: 20, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: 4200 }],
        children
      })
    )
  })
  
  return paragraphs
}

/**
 * 根据区块类型创建Word段落（专业试卷排版）
 */
function createBlockParagraph(block) {
  const paragraphs = []
  
  switch (block.type) {
    case 'title':
      // 标题已在页面头部统一处理，此处不再重复输出
      break

    case 'subtitle':
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 120 },
          children: [
            new TextRun({
              text: block.content || '',
              size: 22,
              font: '宋体'
            })
          ]
        })
      )
      break

    case 'section':
      // 大题标题： "一、选择题（共10小题，每小题3分，共30分）"
      // 使用黑体加粗，底部无多余装饰
      paragraphs.push(
        new Paragraph({
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: block.content || '',
              bold: true,
              size: 26,
              font: '黑体'
            })
          ]
        })
      )
      break

    case 'question': {
      const content = block.content || ''
      
      // 提取题号（如 "1."）
      const numMatch = content.match(/^(\d+)\./)
      const numStr = numMatch ? numMatch[1] + '. ' : ''
      const restContent = numMatch ? content.slice(numMatch[0].length).trim() : content
      
      // 题干：题号加粗 + 正文宋体，首行缩进
      const questionChildren = []
      if (numStr) {
        questionChildren.push(
          new TextRun({
            text: numStr,
            bold: true,
            size: 24,
            font: '宋体'
          })
        )
      }
      questionChildren.push(
        new TextRun({
          text: restContent,
          size: 24,
          font: '宋体'
        })
      )
      
      paragraphs.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          indent: { firstLine: 0 },
          children: questionChildren
        })
      )
      
      // 选项：2列排列
      if (block.options && block.options.length > 0) {
        const optionParagraphs = createOptionsParagraphs(block.options)
        optionParagraphs.forEach(p => paragraphs.push(p))
        paragraphs.push(emptyParagraph(60))
      } else {
        paragraphs.push(emptyParagraph(80))
      }
      break
    }

    case 'text':
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [
            new TextRun({
              text: block.content || '',
              size: 24,
              font: '宋体'
            })
          ]
        })
      )
      break

    case 'image':
      if (block.src) {
        try {
          const imageData = base64ToUint8Array(block.src)
          const isPng = block.src.startsWith('data:image/png') || block.src.startsWith('data:image/PNG')
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 100, after: 80 },
              children: [
                new ImageRun({
                  data: imageData,
                  transformation: {
                    width: 320,
                    height: 240
                  },
                  type: isPng ? 'png' : 'jpeg'
                })
              ]
            })
          )
          if (block.caption) {
            paragraphs.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 80 },
                children: [
                  new TextRun({
                    text: `图：${block.caption}`,
                    color: '666666',
                    size: 20,
                    font: '宋体'
                  })
                ]
              })
            )
          }
        } catch (e) {
          console.warn('[WordGen] 图片插入失败:', e)
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 80, after: 80 },
              children: [
                new TextRun({
                  text: `[图片：${block.caption || '未命名'}]`,
                  color: '999999',
                  size: 22,
                  font: '宋体'
                })
              ]
            })
          )
        }
      } else {
        paragraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [
              new TextRun({
                text: `[图片：${block.caption || '待插入'}]`,
                color: '999999',
                size: 20,
                font: '宋体'
              })
            ]
          })
        )
      }
      break

    case 'table':
      if (block.rows && block.rows.length > 0) {
        const tableRows = block.rows.map(row =>
          new TableRow({
            children: row.map(cell =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: cell || '',
                        size: 22,
                        font: '宋体'
                      })
                    ]
                  })
                ],
                width: {
                  size: 100 / row.length,
                  type: WidthType.PERCENTAGE
                },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
                  left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
                  right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
                }
              })
            )
          })
        )
        
        const table = new Table({
          rows: tableRows,
          width: {
            size: 85,
            type: WidthType.PERCENTAGE
          }
        })
        
        paragraphs.push(table)
        paragraphs.push(emptyParagraph(80))
      }
      break

    case 'footer':
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 300, after: 60 },
          border: {
            top: {
              color: '000000',
              space: 1,
              style: BorderStyle.SINGLE,
              size: 6
            }
          },
          children: [
            new TextRun({
              text: block.content || '',
              size: 20,
              font: '宋体'
            })
          ]
        })
      )
      break

    default:
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [
            new TextRun({
              text: block.content || '',
              size: 24,
              font: '宋体'
            })
          ]
        })
      )
  }
  
  return paragraphs
}

/**
 * 根据试卷数据结构生成Word文档（专业排版）
 */
export async function generatePaperWord(paper) {
  const sections = []
  
  if (!paper.pages || paper.pages.length === 0) {
    throw new Error('没有页面数据')
  }
  
  paper.pages.forEach((page, pageIdx) => {
    const pageChildren = []
    
    // 第一页：试卷标题头（居中黑体大标题 + 信息行 + 粗分隔线）
    if (pageIdx === 0) {
      // 试卷名称（只在此处输出一次，block中的title会被跳过）
      pageChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 300, after: 100 },
          children: [
            new TextRun({
              text: paper.name || '未命名试卷',
              bold: true,
              size: 40,
              font: '黑体'
            })
          ]
        })
      )
      
      // 信息行：数学 · 初中 · 课堂练习
      const infoText = [paper.subject, paper.grade, paper.examType].filter(Boolean).join(' · ')
      if (infoText) {
        pageChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 160 },
            children: [
              new TextRun({
                text: infoText,
                size: 24,
                font: '宋体'
              })
            ]
          })
        )
      }
      
      // 粗分隔线
      pageChildren.push(
        new Paragraph({
          spacing: { after: 200 },
          border: {
            bottom: {
              color: '000000',
              space: 1,
              style: BorderStyle.SINGLE,
              size: 24
            }
          },
          children: []
        })
      )
    }
    
    // 添加页面内容区块（跳过title，因为已在头部统一处理）
    if (page.layoutBlocks && page.layoutBlocks.length > 0) {
      page.layoutBlocks.forEach(block => {
        // 跳过title类型，避免重复
        if (block.type === 'title') return
        const blockParagraphs = createBlockParagraph(block)
        blockParagraphs.forEach(p => pageChildren.push(p))
      })
    }
    
    // 分页符（最后一页除外）
    if (pageIdx < paper.pages.length - 1) {
      pageChildren.push(
        new Paragraph({
          children: [new PageBreak()]
        })
      )
    }
    
    sections.push({
      properties: {},
      children: pageChildren
    })
  })
  
  const doc = new Document({
    sections,
    creator: '明学试卷入库系统',
    title: paper.name || '试卷',
    description: `科目: ${paper.subject || ''}, 年级: ${paper.grade || ''}`
  })
  
  const blob = await Packer.toBlob(doc)
  return blob
}

/**
 * 生成并下载Word文件
 */
export async function downloadPaperWord(paper, filename) {
  const blob = await generatePaperWord(paper)
  const finalName = filename || paper.name || '试卷'
  saveAs(blob, `${finalName}.docx`)
  return blob
}
