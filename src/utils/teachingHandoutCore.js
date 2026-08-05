/**
 * 教学讲义纯逻辑核心（无浏览器/Vite 依赖，可 Node 端单测）
 */

const ERROR_ADVICE = {
  '计算错误': '回归运算法则，强调竖式对齐与进位退位，做限时口算/笔算训练',
  '审题错误': '训练圈画关键词、逐句读题，先明确问题再动笔',
  '公式记忆错误': '引导公式推导过程，配合记忆卡片每日默写',
  '概念不理解': '用生活实例重新讲解概念，建立直观表象后再抽象',
  '步骤遗漏': '强调按步骤给分规范，示范完整书写过程',
  '单位错误': '整理单位换算表，答题后检验结果单位是否合理',
  '方法选择错误': '按题型归纳方法，讲清每种方法的适用条件',
  '不会分析': '引导分步拆解题干，先写已知与所求，再找数量关系',
  '抄写错误': '养成抄题后再核对一遍的习惯，减少低级失误',
  '粗心': '培养自查清单，答后回读条件与计算过程',
}

export function adviceFor(errorType) {
  if (!errorType) return '回归知识点讲解，结合典型例题强化训练'
  if (ERROR_ADVICE[errorType]) return ERROR_ADVICE[errorType]
  const kw = Object.keys(ERROR_ADVICE).find(k => errorType.includes(k))
  return kw ? ERROR_ADVICE[kw] : '回归知识点讲解，结合典型例题强化训练'
}

export function buildHandoutPaper({ diagnosis, details, periodText, maxItems }) {
  const top = diagnosis.slice(0, maxItems)
  const pages = []

  // ── 第 1 页：封面 + 概览 ──
  const coverBlocks = [
    { type: 'subtitle', content: '—— 基于全班共性错题的课堂讲解讲义 ——' },
    {
      type: 'text',
      content: `时间范围：${periodText}\n生成时间：${new Date().toLocaleDateString('zh-CN')}\n覆盖：按「空题优先」排序，共 ${top.length} 个重点知识点。空题即学生没写/写不出来，是最该讲的信号。`
    },
    { type: 'section', content: '一、本周重点讲解知识点' },
    {
      type: 'table',
      rows: [
        ['序号', '知识点', '学科', '空题', '做错', '涉及人数'],
        ...top.map((t, i) => [
          String(i + 1),
          t.tag,
          t.subject,
          String(t.blankCount),
          String(t.wrongCount),
          String(t.studentCount)
        ])
      ]
    },
    { type: 'text', content: '说明：空题 = 学生未作答；做错 = 已作答但答错（含错因分析）。按空题 > 做错 > 人数排序，优先讲解。' }
  ]

  pages.push({
    name: '周学习诊断教学讲义',
    subject: diagnosis[0]?.subject ? `学科：${diagnosis[0].subject}` : '学科：全部',
    grade: '',
    examType: periodText,
    layoutBlocks: coverBlocks
  })

  // ── 之后每个知识点一页 ──
  top.forEach((t, idx) => {
    const detail = details[t.tag]
    const blocks = []

    blocks.push({ type: 'section', content: `${idx + 2}、知识点：${t.tag}（${t.subject}）` })
    blocks.push({
      type: 'text',
      content: `概况：${t.studentCount} 人涉及，做错 ${t.wrongCount} 道，空题 ${t.blankCount} 道（空题占比 ${t.blankRatio}%）。`
    })

    blocks.push({ type: 'section', content: `错因分布与讲解建议（做错题 ${detail?.totalWrong || 0} 道）` })
    if (detail?.errorDist?.length) {
      blocks.push({
        type: 'table',
        rows: [
          ['错因', '次数', '占比', '讲什么'],
          ...detail.errorDist.map(e => [e.errorType, String(e.count), `${e.ratio}%`, adviceFor(e.errorType)])
        ]
      })
    } else {
      blocks.push({ type: 'text', content: '该知识点暂无做错题（仅有空题），空题不分析错因，建议课堂提问排查。' })
    }

    blocks.push({ type: 'section', content: '典型错题（例题）' })
    const samples = detail?.sampleQuestions || []
    if (samples.length === 0) {
      blocks.push({ type: 'text', content: '（暂未取到该知识点的错题样本）' })
    }
    samples.forEach((q, qi) => {
      blocks.push({ type: 'question', content: `例题 ${qi + 1}. ${q.content}` })
      blocks.push({
        type: 'text',
        content: `【${q.studentName}】作答：${q.isBlank ? '（空题，未作答）' : (q.studentAnswer || '（未填写）')}　正确答案：${q.correctAnswer || '—'}`
      })
      if (q.isBlank) {
        blocks.push({ type: 'text', content: '【提醒】该题为空题，建议当堂请学生口述思路，再全班订正。' })
      } else {
        blocks.push({ type: 'text', content: `【错因】${q.errorType || '未标注'}${q.errorReason ? `：${q.errorReason}` : '（待分析）'}` })
      }
    })

    pages.push({ name: '', subject: '', grade: '', examType: '', layoutBlocks: blocks })
  })

  return {
    name: '周学习诊断教学讲义',
    subject: '教学讲义',
    grade: '',
    examType: periodText,
    pages
  }
}
