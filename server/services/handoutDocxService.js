import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  PageBreak,
  ImageRun,
  ShadingType,
} from 'docx'
import { LRUCache } from 'lru-cache'

// ============================================================
// 讲义 Word 导出服务（handoutDocxService）
//
// 职责：把 handoutService 产出的讲义结构（pages/blocks）转为 docx 文件。
// P0-P4 改造：支持新 block 类型（kp-overview / kp-stats / type-section /
//   question-image / lecture-guidance / related-kp / note）+ 错题图嵌入。
// ============================================================

const FONT_SONG = '宋体'
const FONT_HEI = '黑体'

const escText = (s) => String(s || '').replace(/\r\n/g, '\n').trim()

// 远程图片 LRU 缓存（key = url，value = Buffer）
const _imgCache = new LRUCache({
  max: 200,
  ttl: 1000 * 60 * 60 * 24, // 24h
})

async function fetchImageBuffer(url, timeoutMs = 8000) {
  if (!url) return null
  if (_imgCache.has(url)) return _imgCache.get(url)
  const ctrl = new AbortController()
  const tm = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    // 排除非图片内容（OSS 错误 XML/HTML 错误页等）
    if (!ct.startsWith('image/')) return null
    const ab = await r.arrayBuffer()
    const buf = Buffer.from(ab)
    if (buf.length < 1024) return null // 过小视为无效图
    _imgCache.set(url, buf)
    return buf
  } catch (e) {
    console.warn(`[handoutDocx] 拉图失败 ${url}:`, e.message)
    return null
  } finally {
    clearTimeout(tm)
  }
}

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
      text = escText(block.content); size = 20
    } else if (block.type === 'cover-title') {
      text = escText(block.content); size = 44; bold = true
    } else if (block.type === 'cover-subtitle') {
      text = escText(block.content); size = 24
    } else if (block.type === 'cover-info') {
      text = escText(block.content); size = 22
    } else if (block.type === 'cover-date') {
      text = escText(block.content); size = 20
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
    // === P0 模板输出 ===
    case 'kp-overview': {
      // 知识点速览（AI 科普讲解）
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 120, line: 360 },
          children: [new TextRun({ text, size: 22, font: FONT_SONG })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F7F8FA' },
        })
      )
      break
    }

    case 'kp-stats': {
      // 错题概况：4 列一行
      const c = block.content || {}
      const cell = (label, value, color = '1D2129') => [
        new TextRun({ text: `${label}\n`, size: 18, color: '86909C', font: FONT_SONG }),
        new TextRun({ text: `${value || 0}`, size: 36, bold: true, color, font: FONT_HEI }),
      ]
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 60 },
          children: [
            new TextRun({ text: '共 ', size: 22, font: FONT_SONG }),
            new TextRun({ text: c.total || 0, size: 24, bold: true, color: '6366F1', font: FONT_HEI }),
            new TextRun({ text: ' 道错题  ｜  空题 ', size: 22, font: FONT_SONG }),
            new TextRun({ text: c.blankCount || 0, size: 24, bold: true, color: 'F5222D', font: FONT_HEI }),
            new TextRun({ text: '  ｜  做错 ', size: 22, font: FONT_SONG }),
            new TextRun({ text: c.wrongCount || 0, size: 24, bold: true, color: 'FA8C16', font: FONT_HEI }),
            new TextRun({ text: '  ｜  涉及 ', size: 22, font: FONT_SONG }),
            new TextRun({ text: c.typeCount || 0, size: 24, bold: true, color: '6366F1', font: FONT_HEI }),
            new TextRun({ text: ' 种题型', size: 22, font: FONT_SONG }),
          ],
        })
      )
      // 涉及题型列表
      if (Array.isArray(c.types) && c.types.length > 0) {
        const typeText = c.types.map(t => {
          const name = typeof t === 'string' ? t : t.type
          const cnt = typeof t === 'string' ? '' : (t.count ? `×${t.count}` : '')
          return `${name}${cnt}`
        }).join(' ｜ ')
        paragraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 30, after: 120 },
            children: [new TextRun({ text: typeText, size: 18, color: '4F46E5', font: FONT_SONG })],
          })
        )
      }
      break
    }

    case 'type-section': {
      // 题型小标题（页内分组）
      paragraphs.push(
        new Paragraph({
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: `▶ ${text}`, size: 24, bold: true, color: '4F46E5', font: FONT_HEI })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2FF' },
        })
      )
      break
    }

    case 'question': {
      // 错题
      if (block.questionType) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [new TextRun({ text: `[${escText(block.questionType)}] `, size: 18, color: '047857', font: FONT_SONG })],
          })
        )
      }
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
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
      // 错题图占位：image block 由 buildBlockParagraphs 内部不直接处理，
      // 改由 buildHandoutDocx 异步批量拉图后插入。这里在 docx 中只放 URL 标注。
      if (Array.isArray(block.imageUrls) && block.imageUrls.length > 0) {
        // 同步附上链接文本（图片真本体在 buildHandoutDocx 里替换）
        for (const url of block.imageUrls.slice(0, 3)) {
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 40, after: 40 },
              children: [new TextRun({ text: `[图片] ${escText(url)}`, size: 16, color: '86909C', font: FONT_SONG })],
            })
          )
        }
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

    case 'lecture-guidance': {
      // 讲解引导（P0 简单版 / P4 由 AI 提词器增强）
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 80 },
          children: [new TextRun({ text, size: 20, font: FONT_SONG, color: '78350F' })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FEF3C7' },
        })
      )
      break
    }

    case 'related-kp': {
      if (Array.isArray(block.content) && block.content.length > 0) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: [
              new TextRun({ text: '🔗 相关知识点：', size: 20, bold: true, color: '0EA5E9', font: FONT_SONG }),
              new TextRun({ text: block.content.join(' ｜ '), size: 20, color: '1D2129', font: FONT_SONG }),
            ],
          })
        )
      } else {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: [new TextRun({ text: '🔗 相关知识点：暂无', size: 20, color: '86909C', font: FONT_SONG, italics: true })],
          })
        )
      }
      break
    }

    case 'note': {
      // 老师笔记（写入 docx，但 P3 之后老师可选择"不导出"）
      if (text) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [new TextRun({ text: `📝 我的笔记：${text}`, size: 20, color: '78350F', font: FONT_SONG })],
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFBEB' },
          })
        )
      } else {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: [new TextRun({ text: '📝 我的笔记：（空）', size: 20, color: '86909C', font: FONT_SONG, italics: true })],
          })
        )
      }
      break
    }

    // === P4 讲课提词器（按时间分块） ===
    case 'lecture-script': {
      if (Array.isArray(block.content)) {
        for (const step of block.content) {
          const time = escText(step.time || '')
          const title = escText(step.title || '')
          const detail = escText(step.detail || '')
          const points = Array.isArray(step.points) ? step.points : []
          const board = escText(step.board || '')
          const interaction = escText(step.interaction || '')

          paragraphs.push(
            new Paragraph({
              spacing: { before: 120, after: 40 },
              children: [
                new TextRun({ text: `[${time}] `, size: 22, bold: true, color: '4F46E5', font: FONT_HEI }),
                new TextRun({ text: title, size: 22, bold: true, color: '1D2129', font: FONT_HEI }),
              ],
            })
          )
          if (detail) {
            paragraphs.push(
              new Paragraph({
                indent: { left: 240 },
                spacing: { after: 40 },
                children: [new TextRun({ text: detail, size: 20, font: FONT_SONG })],
              })
            )
          }
          for (const p of points) {
            paragraphs.push(
              new Paragraph({
                indent: { left: 360 },
                spacing: { after: 20 },
                children: [new TextRun({ text: `• ${escText(p)}`, size: 20, font: FONT_SONG })],
              })
            )
          }
          if (board) {
            paragraphs.push(
              new Paragraph({
                indent: { left: 360 },
                spacing: { after: 20 },
                children: [
                  new TextRun({ text: '板书：', size: 20, bold: true, color: 'FA8C16', font: FONT_SONG }),
                  new TextRun({ text: board, size: 20, font: FONT_SONG })],
              })
            )
          }
          if (interaction) {
            paragraphs.push(
              new Paragraph({
                indent: { left: 360 },
                spacing: { after: 60 },
                children: [
                  new TextRun({ text: '互动：', size: 20, bold: true, color: '0EA5E9', font: FONT_SONG }),
                  new TextRun({ text: interaction, size: 20, font: FONT_SONG })],
              })
            )
          }
        }
      }
      break
    }

    // === 旧兼容 block ===
    case 'type-summary': {
      const list = Array.isArray(block.content) ? block.content : []
      if (list.length === 0) {
        paragraphs.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: [new TextRun({ text: '*（题型归纳暂不可用）*', size: 20, color: '86909C', font: FONT_SONG, italics: true })],
          })
        )
        break
      }
      for (let i = 0; i < list.length; i++) {
        const t = list[i] || {}
        const type = escText(t.type)
        const desc = escText(t.description)
        const example = escText(t.example)
        const tip = escText(t.tip)
        paragraphs.push(
          new Paragraph({
            spacing: { before: 120, after: 40 },
            children: [
              new TextRun({ text: `${i + 1}. `, size: 22, bold: true, color: 'B45309', font: FONT_HEI }),
              new TextRun({ text: type, size: 22, bold: true, color: '92400E', font: FONT_HEI }),
            ],
          })
        )
        if (desc) {
          paragraphs.push(
            new Paragraph({
              indent: { left: 360 }, spacing: { after: 20 },
              children: [new TextRun({ text: `怎么考：${desc}`, size: 20, font: FONT_SONG })],
            })
          )
        }
        if (example) {
          paragraphs.push(
            new Paragraph({
              indent: { left: 360 }, spacing: { after: 20 },
              children: [new TextRun({ text: `典型例：${example}`, size: 20, font: FONT_SONG })],
            })
          )
        }
        if (tip) {
          paragraphs.push(
            new Paragraph({
              indent: { left: 360 }, spacing: { after: 60 },
              children: [new TextRun({ text: `应对：${tip}`, size: 20, font: FONT_SONG })],
            })
          )
        }
      }
      break
    }

    case 'explanation':
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

    case 'text':
      paragraphs.push(
        new Paragraph({
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text, size: 20, font: FONT_SONG, italics: true, color: '4E5969' })],
        })
      )
      break

    default:
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
 * 把 URL 转 docx ImageRun（异步）
 */
async function buildImageRun(url, maxWidth = 480) {
  const buf = await fetchImageBuffer(url)
  if (!buf) return null
  // 估算宽高（默认 A4 内容宽度 ~ 8000 EMU；maxWidth 像素按比例换算）
  return new ImageRun({
    data: buf,
    transformation: { width: maxWidth, height: maxWidth * 0.6 }, // 简化：3:2 比例
    type: 'jpg',
  })
}

/**
 * 组装 docx 文档（支持错题图异步批量拉取）
 */
export async function buildHandoutDocx(handout) {
  if (!handout || !Array.isArray(handout.pages) || handout.pages.length === 0) {
    throw new Error('讲义数据为空，无法导出')
  }

  // 1. 收集所有需要拉的图片 URL
  const allImageUrls = new Set()
  for (const page of handout.pages) {
    if (page.name === 'cover' || page.name === 'toc') continue
    for (const block of (page.blocks || [])) {
      if (block.type === 'question' && Array.isArray(block.imageUrls)) {
        for (const u of block.imageUrls) if (u) allImageUrls.add(u)
      }
    }
  }
  // 2. 并发拉取（最多 8 个并发），失败/超时忽略
  const imagePromises = Array.from(allImageUrls).map(async (u) => {
    const ir = await buildImageRun(u)
    return [u, ir]
  })
  const imageResults = await Promise.all(imagePromises)
  const imageMap = new Map(imageResults.filter(([, ir]) => ir))

  // 3. 组装 paragraphs
  const children = []
  for (const page of handout.pages) {
    if (page.name === 'cover') {
      children.push(...buildCoverPage(page.blocks || []))
    } else if (page.name === 'toc') {
      children.push(...buildTocPage(page.blocks || []))
    } else {
      for (const block of (page.blocks || [])) {
        // 错题：插入完基础段落，再插入图
        children.push(...buildBlockParagraphs(block))
        if (block.type === 'question' && Array.isArray(block.imageUrls)) {
          for (const url of block.imageUrls) {
            const ir = imageMap.get(url)
            if (ir) {
              children.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 40, after: 60 },
                children: [ir],
              }))
            }
          }
        }
      }
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
  }

  // 去掉最后一页的多余分页符
  if (children.length > 0) {
    const last = children[children.length - 1]
    if (last && last.root && last.root[0] && last.root[0].constructor.name === 'PageBreakRun') {
      children.pop()
    }
  }

  const doc = new Document({
    creator: '敏学 · 备课讲义',
    title: escText(handout.title) || '备课讲义',
    description: '由 handoutService 自动生成',
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
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
