import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  PageBreak,
  TabStopPosition,
  TabStopType,
  UnderlineType,
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
 * 根据区块类型创建对应的Word段落
 */
function createBlockParagraph(block) {
  const paragraphs = []
  
  switch (block.type) {
    case 'title':
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 100 },
          children: [
            new TextRun({
              text: block.content || '',
              bold: true,
              size: 32, // 16pt
              font: '宋体'
            })
          ]
        })
      )
      break

    case 'subtitle':
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 60 },
          children: [
            new TextRun({
              text: block.content || '',
              size: 22, // 11pt
              color: '666666',
              font: '宋体'
            })
          ]
        })
      )
      break

    case 'section':
      paragraphs.push(
        new Paragraph({
          spacing: { before: 240, after: 120 },
          border: {
            bottom: {
              color: '999999',
              space: 1,
              style: BorderStyle.SINGLE,
              size: 12
            }
          },
          children: [
            new TextRun({
              text: block.content || '',
              bold: true,
              size: 26, // 13pt
              font: '宋体'
            })
          ]
        })
      )
      break

    case 'question':
      // 题干
      paragraphs.push(
        new Paragraph({
          spacing: { before: 80, after: 60 },
          indent: { left: 360 },
          children: [
            new TextRun({
              text: block.content || '',
              size: 24, // 12pt
              font: '宋体'
            })
          ]
        })
      )
      
      // 选项
      if (block.options && block.options.length > 0) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 40, after: 60 },
            indent: { left: 720 },
            children: [
              new TextRun({
                text: block.options.join('    '),
                size: 24,
                font: '宋体'
              })
            ]
          })
        )
      }
      break

    case 'text':
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 360 },
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
          // 检测图片类型（PNG vs JPEG）
          const isPng = block.src.startsWith('data:image/png') || block.src.startsWith('data:image/PNG')
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 80, after: 80 },
              children: [
                new ImageRun({
                  data: imageData,
                  transformation: {
                    width: 380,
                    height: 260
                  },
                  type: isPng ? 'png' : 'jpeg'
                })
              ]
            })
          )
          // 如果有caption，在图片下方添加说明
          if (block.caption) {
            paragraphs.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 40, after: 80 },
                children: [
                  new TextRun({
                    text: `图: ${block.caption}`,
                    color: '666666',
                    italics: true,
                    size: 20,
                    font: '宋体'
                  })
                ]
              })
            )
          }
          // 如果有TikZ代码，在注释中添加TikZ源码供后续编辑
          if (block.tikzCode) {
            paragraphs.push(
              new Paragraph({
                spacing: { before: 20, after: 40 },
                children: [
                  new TextRun({
                    text: `<!-- TikZ: ${block.tikzCode.substring(0, 100)}... -->`,
                    color: 'CCCCCC',
                    italics: true,
                    size: 16,
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
              spacing: { before: 60, after: 60 },
              children: [
                new TextRun({
                  text: `[图片: ${block.caption || '未命名'}]`,
                  color: '999999',
                  italics: true,
                  size: 22,
                  font: '宋体'
                })
              ]
            })
          )
        }
      } else if (block.tikzCode) {
        // 没有局部图但有TikZ代码，在Word中显示TikZ源码注释
        paragraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [
              new TextRun({
                text: `[TikZ矢量图: ${block.caption || '图形'}]`,
                color: '666666',
                italics: true,
                size: 20,
                font: '宋体'
              })
            ]
          })
        )
        // 添加TikZ源码作为注释
        paragraphs.push(
          new Paragraph({
            spacing: { before: 20, after: 60 },
            children: [
              new TextRun({
                text: block.tikzCode,
                color: '999999',
                size: 14,
                font: 'Courier New'
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
                }
              })
            )
          })
        )
        
        const table = new Table({
          rows: tableRows,
          width: {
            size: 100,
            type: WidthType.PERCENTAGE
          }
        })
        
        // Table is added as a "paragraph" equivalent
        paragraphs.push(table)
      }
      break

    case 'footer':
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 60 },
          border: {
            top: {
              color: 'CCCCCC',
              space: 1,
              style: BorderStyle.SINGLE,
              size: 6
            }
          },
          children: [
            new TextRun({
              text: block.content || '',
              size: 20, // 10pt
              color: '999999',
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
 * 根据试卷数据结构生成Word文档
 * @param {Object} paper - 试卷数据
 * @returns {Promise<Blob>} Word文件Blob
 */
export async function generatePaperWord(paper) {
  const sections = []
  
  if (!paper.pages || paper.pages.length === 0) {
    throw new Error('没有页面数据')
  }
  
  paper.pages.forEach((page, pageIdx) => {
    const pageChildren = []
    
    // 第一页添加标题
    if (pageIdx === 0) {
      pageChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 100 },
          children: [
            new TextRun({
              text: paper.name || '未命名试卷',
              bold: true,
              size: 32,
              font: '宋体'
            })
          ]
        })
      )
      
      const infoText = [paper.subject, paper.grade, paper.examType].filter(Boolean).join(' · ')
      if (infoText) {
        pageChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 200 },
            children: [
              new TextRun({
                text: infoText,
                size: 22,
                color: '666666',
                font: '宋体'
              })
            ]
          })
        )
        
        // 分隔线
        pageChildren.push(
          new Paragraph({
            spacing: { after: 100 },
            border: {
              bottom: {
                color: '000000',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 18
              }
            },
            children: []
          })
        )
      }
    }
    
    // 添加页面内容区块
    if (page.layoutBlocks && page.layoutBlocks.length > 0) {
      page.layoutBlocks.forEach(block => {
        const blockParagraphs = createBlockParagraph(block)
        blockParagraphs.forEach(p => pageChildren.push(p))
      })
    }
    
    // 添加分页符（最后一页除外）
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
 * @param {Object} paper - 试卷数据
 * @param {string} filename - 文件名（不含扩展名）
 */
export async function downloadPaperWord(paper, filename) {
  const blob = await generatePaperWord(paper)
  const finalName = filename || paper.name || '试卷'
  saveAs(blob, `${finalName}.docx`)
  return blob
}
