import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, PageBreak, ShadingType } from 'docx'

/**
 * 周末讲题错题卷 Word 生成器（wrongPaperDocxService）
 *
 * 复用 docx 基础结构，与 handoutDocxService 平行（不耦合 handout.pages/blocks）。
 *
 * 设计原则：
 *   - 全班卷（含答案）：老师讲题用，列题目、正确答案、错的学生名单、错误率
 *   - 个人卷（不含答案）：学生周末重练用，列题目 + 学生自己的错答 + 错因；
 *     末尾附「答案附录页」（老师可自行撕下，不发到学生手里），保持「先练后看」产品口径
 *   - 题干以纯文字为主，不强制嵌图（避免 docx 拉远程图慢、文件大）
 */

const FONT_SONG = '宋体'
const FONT_HEI = '黑体'

const escText = (s) => String(s || '').replace(/\r\n/g, '\n').trim()

/**
 * 构造错题卷 docx。
 *
 * @param {Object} args
 * @param {string} args.title 标题（"八年级本周错题卷"）
 * @param {string} args.grade 年级
 * @param {{start:string,end:string,mode:string,offset:number}} args.period
 * @param {string} [args.subject]
 * @param {number} args.totalStudentCount 年级总人数
 * @param {Array} args.items 错题列表（来自 /api/teaching/wrong-paper）
 * @param {'all'|'student'} args.mode
 * @param {string} [args.studentName] mode='student' 时必填
 * @param {string} [args.studentId] mode='student' 时必填
 * @returns {Promise<Buffer>} docx 二进制
 */
export async function buildWrongPaperDocx(args) {
  const {
    title,
    grade: gradeName,
    period,
    subject = '全部学科',
    totalStudentCount,
    items = [],
    mode,
    studentName = '',
  } = args

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('错题卷数据为空，无法生成')
  }

  const children = []
  children.push(...buildCoverPage({ title, gradeName, period, subject, totalStudentCount, mode, studentName }))

  // 题主体（mode='student' 时只显示该学生错过的题；mode='all' 时显示全部）
  const filteredItems = mode === 'student'
    ? items.filter(it => Array.isArray(it.involvedStudents) &&
        it.involvedStudents.some(s => s.name === studentName))
    : items

  if (filteredItems.length === 0) {
    children.push(new Paragraph({
      spacing: { before: 600, after: 200 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '本周暂无错题记录', size: 28, font: FONT_SONG })],
    }))
  } else {
    filteredItems.forEach((item, idx) => {
      children.push(...buildQuestionSection({ idx: idx + 1, item, mode, studentName, totalStudentCount }))
      // 题间分隔
      if (idx < filteredItems.length - 1) {
        children.push(new Paragraph({
          spacing: { before: 80, after: 80 },
          border: { bottom: { color: 'CCCCCC', space: 4, style: 'single', size: 4 } },
          children: [],
        }))
      }
    })
  }

  // 个人卷：末尾附"答案附录页"（不强制老师撕下，但视觉上独立分页方便处理）
  if (mode === 'student') {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(...buildAnswerAppendixPage({ studentName, items: filteredItems }))
  }

  const doc = new Document({
    creator: '敏学 · 周末讲题',
    title: escText(title),
    description: `${gradeName} · ${period?.start || ''}~${period?.end || ''}`,
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

  return Packer.toBuffer(doc)
}

/**
 * 封面页
 */
function buildCoverPage({ title, gradeName, period, subject, totalStudentCount, mode, studentName }) {
  const paragraphs = []

  // 顶部留白
  paragraphs.push(new Paragraph({ spacing: { before: 1800 }, children: [new TextRun({ text: '' })] }))

  // 顶部徽标
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: mode === 'all' ? '全班讲义卷' : '个人错题卷', size: 20, color: '6366F1', font: FONT_SONG })],
  }))

  // 主标题
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: escText(title), size: 44, bold: true, font: FONT_HEI })],
  }))

  // 副标题：年级 · 学科 · 时段
  const subtitle = `${gradeName} · ${subject} · ${period?.start || ''} ~ ${period?.end || ''}`
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [new TextRun({ text: subtitle, size: 24, font: FONT_SONG })],
  }))

  // 受众信息
  const audience = mode === 'all'
    ? `年级共 ${totalStudentCount} 名学生`
    : `学生：${studentName || '未知'}`
  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: audience, size: 20, color: '666666', font: FONT_SONG })],
  }))

  // 个人卷附教学纪律提示
  if (mode === 'student') {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({
        text: '学生用卷：请先独立完成本页所有题目，做完后再翻到最后一页对照答案。',
        size: 18, color: '999999', italics: true, font: FONT_SONG,
      })],
    }))
  }

  // 全班卷附"含答案"提示
  if (mode === 'all') {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({
        text: '老师讲题用：每题附正确答案、错的学生名单与错误率，方便按重点讲解。',
        size: 18, color: '999999', italics: true, font: FONT_SONG,
      })],
    }))
  }

  paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  return paragraphs
}

/**
 * 单题段落。
 * 全班卷：题干 / 正确答案 / 错的学生名单 / 错因分布 / 错误率
 * 个人卷：题干 / 学生自己的错答 / 错因（**不含正确答案**）
 */
function buildQuestionSection({ idx, item, mode, studentName, totalStudentCount }) {
  const paragraphs = []

  // 题号 + 知识点标签
  const headerChildren = [
    new TextRun({ text: `${idx}. `, size: 26, bold: true, font: FONT_HEI }),
    new TextRun({ text: escText(item.content || '(题干缺失)'), size: 24, font: FONT_SONG }),
  ]
  if (Array.isArray(item.knowledgeTags) && item.knowledgeTags.length > 0) {
    headerChildren.push(new TextRun({
      text: `    [${item.knowledgeTags.slice(0, 3).join(' / ')}]`,
      size: 18, color: '888888', font: FONT_SONG,
    }))
  }
  paragraphs.push(new Paragraph({
    spacing: { before: 120, after: 80 },
    children: headerChildren,
  }))

  if (mode === 'all') {
    // 全班卷：正确答案
    paragraphs.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: '【正确答案】', size: 18, bold: true, color: '059669', font: FONT_HEI }),
        new TextRun({ text: ' ' + escText(item.correctAnswer || '—'), size: 22, font: FONT_SONG }),
      ],
    }))

    // 错的学生名单
    if (Array.isArray(item.involvedStudents) && item.involvedStudents.length > 0) {
      const names = item.involvedStudents.map(s => `${s.name}${s.wrongTimes > 1 ? `×${s.wrongTimes}` : ''}`).join('、')
      paragraphs.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: '【错的学生】', size: 18, bold: true, color: 'DC2626', font: FONT_HEI }),
          new TextRun({ text: ` ${names}`, size: 22, font: FONT_SONG }),
        ],
      }))
    }

    // 错因分布
    if (Array.isArray(item.errorDistribution) && item.errorDistribution.length > 0) {
      const distText = item.errorDistribution
        .map(d => `${d.errorType} ${d.count}次 (${d.ratio}%)`)
        .join('；')
      paragraphs.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: '【错因分布】', size: 18, bold: true, color: 'D97706', font: FONT_HEI }),
          new TextRun({ text: ` ${distText}`, size: 22, font: FONT_SONG }),
        ],
      }))
    }

    // 错误率
    paragraphs.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: '【错误率】', size: 18, bold: true, color: '6366F1', font: FONT_HEI }),
        new TextRun({
          text: ` ${item.errorRate || 0}% （${item.studentCount || 0} 人错 / 年级 ${totalStudentCount || 0} 人）`,
          size: 22, bold: true, font: FONT_SONG,
        }),
      ],
    }))
  } else {
    // 个人卷：只展示学生自己的错答 + 错因（无正确答案）
    const myRow = Array.isArray(item.involvedStudents)
      ? item.involvedStudents.find(s => s.name === studentName)
      : null
    const mySample = item.sample?.studentName === studentName ? item.sample : null

    const studentAnswerText = mySample
      ? (mySample.isBlank ? '（空题未作答）' : (mySample.studentAnswer || '（未填写）'))
      : (myRow ? '（该题未单独采样）' : '（本周无该题错答记录）')
    const errorTypeText = mySample?.errorType || (myRow?.errorTypes?.join('、') || '未标注')

    paragraphs.push(new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: '【你的作答】', size: 18, bold: true, color: 'DC2626', font: FONT_HEI }),
        new TextRun({ text: ` ${studentAnswerText}`, size: 22, font: FONT_SONG }),
      ],
    }))

    if (mySample?.errorReason || errorTypeText) {
      paragraphs.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: '【错因】', size: 18, bold: true, color: 'D97706', font: FONT_HEI }),
          new TextRun({
            text: ` ${errorTypeText}${mySample?.errorReason ? `：${mySample.errorReason}` : ''}`,
            size: 22, font: FONT_SONG,
          }),
        ],
      }))
    }

    // 个人卷提示
    paragraphs.push(new Paragraph({
      spacing: { before: 60, after: 40 },
      children: [new TextRun({
        text: '请独立重做本题，做完后再翻到最后一页对照答案。',
        size: 18, color: '999999', italics: true, font: FONT_SONG,
      })],
    }))
  }

  return paragraphs
}

/**
 * 答案附录页（仅个人卷）：列出全部题的标准答案，老师可撕下不发。
 */
function buildAnswerAppendixPage({ studentName, items }) {
  const paragraphs = []

  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 240 },
    children: [new TextRun({
      text: '答案附录（教师版）',
      size: 32, bold: true, font: FONT_HEI,
    })],
  }))

  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [new TextRun({
      text: `${studentName || '学生'} · 共 ${items.length} 题`,
      size: 20, color: '666666', font: FONT_SONG,
    })],
  }))

  paragraphs.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [new TextRun({
      text: '提示：建议教师剪下本页分发给学生，或让学生在交卷后再翻阅。',
      size: 16, color: '999999', italics: true, font: FONT_SONG,
    })],
  }))

  items.forEach((item, idx) => {
    paragraphs.push(new Paragraph({
      spacing: { before: 100, after: 40 },
      children: [
        new TextRun({ text: `${idx + 1}. `, size: 20, bold: true, font: FONT_HEI }),
        new TextRun({ text: escText(item.content || '(题干缺失)'), size: 20, font: FONT_SONG }),
      ],
    }))
    paragraphs.push(new Paragraph({
      spacing: { after: 80 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: '答案：', size: 18, color: '059669', bold: true, font: FONT_HEI }),
        new TextRun({ text: ' ' + escText(item.correctAnswer || '—'), size: 20, font: FONT_SONG }),
      ],
    }))
  })

  return paragraphs
}