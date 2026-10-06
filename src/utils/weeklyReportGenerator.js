import { createGeneratedExam, getGeneratedExamsByStudent, getQuestionsByIds, getTasksByStudent, updateGeneratedExam } from '../services/apiService'
import { triggerCustomHTMLPrint } from './browserPrint'
import { renderFullHTML, exportServerPDF, getKatexCssWithInlineFonts } from './serverPdfExporter'
import { detectProductionEnv } from './wrongBookPdfExporter'
import { buildPaperCSS, renderMathInContainer, preloadKatexFonts } from './pdfGenerator'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)


/**
 * 设计 token（PDF HTML 无法引用 CSS 变量，写死等值 hex）
 *
 * r135 品牌对齐（负责人 2026-10-04：「希望 UI 统一，和系统统一」）：
 *   旧值是 r120q 的「深海军蓝 #123A5F + 金 #C8A24A」自成一派，
 *   与系统实际主色 **蓝 #3157D5**（workbench-theme.css / index.css）不一致 ——
 *   家长手里的 PDF 与老师手里的系统看起来像两个产品。
 *   现在直接对齐系统 token（同一批 hex），改动只落在这一个对象里：
 *   23 个 T.* key 保留（全仓多处引用），只换值 ⇒ 影响面可控。
 *   灰阶同步换成系统的 slate 系（#1E293B / #64748B / #94A3B8 / #E2E8F0）。
 *   语义色与系统一致：绿 #16A34A、琥珀 #D97706、赤 #DC2626。
 */
const T = {
  primary: '#3157D5', primaryDark: '#2847B8', primarySoft: '#E8EDFF', primaryMist: '#F2F5FF',
  teal: '#0D9488', tealSoft: '#E3F5F2',
  success: '#16A34A', successSoft: '#E7F6EC',
  warning: '#D97706', warningSoft: '#FDF3E3',
  danger: '#DC2626', dangerSoft: '#FDECEC',
  accent: '#3157D5', accentSoft: '#E8EDFF',
  purple: '#7C3AED', purpleSoft: '#F1EAFE',
  text: '#1E293B', textSec: '#64748B', textTer: '#94A3B8',
  border: '#E2E8F0', borderLight: '#F1F5F9', bg: '#F5F6F8', card: '#FFFFFF'
}

/** 品牌信息（统一维护，便于替换） */
const BRAND = {
  nameCn: '敏学成长中心',
  nameEn: 'MINXUE GROWTH CENTER',
  slogan: '让孩子的成长，看得见'
}

/**
 * 本周重点重练卷题量上限。
 * 一份报告不该把本周全部错题（重周可能 100+ 道）都塞进重练卷——学生做不完、无重点、无效果。
 * 后端已按「学科均衡 + 错误次数」排序，这里只取最该重练的前 N 道；其余仍在错题本可日常安排。
 * 2026-10-04 负责人要求「重练卷题目数据可扩大点」：20 → 30（仍可一周内完成，但覆盖面更广）。
 */
const RETRY_CAP = 30

/**
 * 品牌 Logo Lockup：蓝绿色牵手路径标 + 中英文字号
 * @param {Object} opt
 * @param {boolean} opt.compact - 内页紧凑版（较小字号）
 */
function renderLogo({ compact = false } = {}) {
  const mark = `<svg class="brand-mark" width="${compact ? 30 : 40}" height="${compact ? 30 : 40}" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="38" height="38" rx="11" fill="${T.primary}"/>
    <path d="M10.5 27V14.5c0-.7.86-1.04 1.35-.53L20 22l8.15-8.03c.49-.51 1.35-.17 1.35.53V27" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="20" cy="22" r="2.3" fill="${T.success}"/>
  </svg>`
  return `<div class="brand ${compact ? 'brand-sm' : ''}">${mark}<div class="brand-tx"><div class="brand-cn">${BRAND.nameCn}</div><div class="brand-en">${BRAND.nameEn}</div></div></div>`
}

function colorForAccuracy(acc) {
  if (acc == null) return T.textTer
  return acc >= 80 ? T.success : acc >= 60 ? T.warning : T.danger
}

/** 掌握标签配色 */
function masteryStyle(label) {
  switch (label) {
    case '待加强': return { bg: T.dangerSoft, color: T.danger }
    case '需关注': return { bg: T.warningSoft, color: T.warning }
    case '需巩固': return { bg: T.accentSoft, color: T.accent }
    default: return { bg: T.borderLight, color: T.textSec }
  }
}

/** 知识点行首彩色图标（循环取色，呼应参考图的圆形图标） */
const KT_ICON_PALETTE = [
  { bg: T.primary, soft: T.primaryMist },
  { bg: T.primaryDark, soft: T.primarySoft },
  { bg: T.teal, soft: T.tealSoft },
  { bg: T.success, soft: T.successSoft },
  { bg: T.purple, soft: T.purpleSoft },
]
function ktRowIcon(index) {
  const c = KT_ICON_PALETTE[index % KT_ICON_PALETTE.length]
  return `<span class="kt-ic" style="background:${c.soft};color:${c.bg}">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="4.5" stroke="currentColor" stroke-width="2"/><path d="M8.5 12h7M12 8.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
  </span>`
}

/**
 * 封面学习周期文案（r135）。
 * ⛔ 「全部」模式的 period 是 2000-01-01 ~ 2099-12-31（period.js 的 all 分支），
 *   直接印给家长看很荒谬：「学习周期：2000-01-01 ~ 2099-12-31」。
 *   改为按 mode 说人话。
 */
function periodLabelText(period) {
  if (!period) return ''
  const y1 = String(period.start || '').slice(0, 4)
  const y2 = String(period.end || '').slice(0, 4)
  // 跨度异常大 ⇒ 是「全部」模式
  if (y1 === '2000' || y2 === '2099') {
    return y1 && y1 !== '2000' ? `学习周期：${y1} 年至今` : '学习周期：全部记录'
  }
  return `学习周期：${period.start} ~ ${period.end}`
}

/** 学习寄语（依据统计自动拼装模板话术） */
function buildTeacherComment(stats, weakestTag) {
  const parts = []
  const completeRate = stats.totalTasks > 0 ? stats.completedTasks / stats.totalTasks : 0
  if (completeRate >= 0.8) parts.push('本周学习态度认真，作业完成情况良好')
  else if (completeRate >= 0.4) parts.push('本周作业完成情况尚可，仍有提升空间')
  else parts.push('本周作业完成率偏低，请督促孩子按时完成练习')

  if (stats.accuracy >= 85) parts.push('整体正确率优秀，继续保持')
  else if (stats.accuracy >= 60) parts.push(`整体正确率 ${stats.accuracy}%，${weakestTag ? '「' + weakestTag + '」' : '部分知识点'}仍需加强练习`)
  else parts.push(`整体正确率 ${stats.accuracy}%，建议重点复习本周错题，夯实基础`)

  return parts.join('，') + '！'
}

/** 学习建议（按薄弱学科自动生成） */
function buildTeacherAdvice(subjectDiagnosis) {
  if (!subjectDiagnosis || subjectDiagnosis.length === 0) {
    return '本周暂无明确薄弱知识点，暂不增加题量，保持观察并在出现重复错误时安排针对训练。'
  }
  const tips = subjectDiagnosis.slice(0, 2).map(s => {
    const top = s.topTags && s.topTags[0]
    if (!top) return `${s.subject}保持巩固练习`
    if (top.accuracy < 60 || top.wrongCount >= 3) return `${s.subject}先讲清「${top.tag}」的方法，再安排次日重练`
    if (top.wrongCount >= 2) return `${s.subject}安排「${top.tag}」相近变式，观察能否独立完成`
    return `${s.subject}复测「${top.tag}」，确认是否能够迁移`
  })
  return tips.join('；') + '。'
}

function buildTeachingSummary(stats, subjectDiagnosis) {
  const focus = subjectDiagnosis?.flatMap(s => s.topTags || [])
    .sort((a, b) => b.wrongCount - a.wrongCount || a.accuracy - b.accuracy)[0]
  // r135：口径与全篇一致 —— 主数字是「已记住」（答对 1 次即算），
  // 彻底掌握只作补充。旧版写「已有 2 题完成掌握验证」，与封面的「16 道已记住」
  // 和 01 页的战果头直接矛盾，家长会以为两份材料数字对不上。
  const secured = (stats.masteredCount || 0) + (stats.basicMasteredCount || 0)
  const mastered = stats.masteredCount || 0
  const seen = secured > 0
    ? `已记住 ${secured} 道错题${mastered > 0 ? `，其中 ${mastered} 道彻底掌握` : ''}`
    : (stats.notStartedCount || stats.pendingCount || 0) > 0
      ? `本周期新增 ${stats.notStartedCount || stats.pendingCount} 道错题，正在攻克`
      : '本周期暂未形成可验证的掌握记录'
  const action = !focus
    ? '保持观察，出现重复错误后再安排针对训练'
    : focus.accuracy < 60 || focus.wrongCount >= 3
      ? `先讲解「${focus.tag}」，次日用相近变式独立复测`
      : `安排「${focus.tag}」重练，观察是否还需要提示`
  return { seen, focus: focus ? `「${focus.tag}」${focus.wrongCount}次错误，正确率${focus.accuracy}%` : '暂无明确薄弱知识点', action }
}

/** 内联 SVG 折线趋势图（本周每日正确率） */
function renderTrendChart(dailyTrend) {
  const W = 700, H = 180
  const padL = 40, padR = 20, padT = 20, padB = 34
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const n = dailyTrend.length
  const stepX = n > 1 ? innerW / (n - 1) : innerW

  const xOf = (i) => padL + i * stepX
  const yOf = (acc) => padT + innerH - (acc / 100) * innerH

  // 网格线 + y 轴刻度
  let grid = ''
  for (let v = 0; v <= 100; v += 25) {
    const y = yOf(v)
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${T.borderLight}" stroke-width="1"/>`
    grid += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="${T.textTer}">${v}%</text>`
  }

  // 折线：仅连接有数据的相邻点
  const pts = dailyTrend.map((d, i) => ({ i, acc: d.accuracy, x: xOf(i), y: d.accuracy != null ? yOf(d.accuracy) : null }))
  let segs = ''
  let prev = null
  for (const p of pts) {
    if (p.y != null) {
      if (prev) segs += `<line x1="${prev.x}" y1="${prev.y}" x2="${p.x}" y2="${p.y}" stroke="${T.primary}" stroke-width="2.5" stroke-linecap="round"/>`
      prev = p
    }
  }

  // 数据点 + 百分比标签
  let dots = ''
  for (const p of pts) {
    if (p.y != null) {
      dots += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="${T.primary}" stroke-width="2.5"/>`
      dots += `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="11" font-weight="600" fill="${T.primaryDark}">${p.acc}%</text>`
    } else {
      dots += `<circle cx="${p.x}" cy="${yOf(0)}" r="3" fill="${T.textTer}" opacity="0.4"/>`
    }
  }

  // x 轴标签
  let xlabels = ''
  for (const p of pts) {
    xlabels += `<text x="${p.x}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${T.textSec}">${dailyTrend[p.i].date}</text>`
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${grid}${segs}${dots}${xlabels}
  </svg>`
}

/**
 * 学科正确率横向条形图（HTML/CSS，非 SVG）。
 * 用于日维度趋势为空时（mode=all / 无每日数据）的替代可视化：
 * 旧版直接渲染一张只有网格的空折线图，看起来像坏掉——改为恒有数据的学科正确率对比。
 */
function renderSubjectBarChart(subjectDiagnosis) {
  const rows = (subjectDiagnosis || []).filter(s => s && s.accuracy != null)
  if (rows.length === 0) return ''
  const max = 100
  const bars = rows.map(s => {
    const c = colorForAccuracy(s.accuracy)
    const w = Math.max(2, Math.min(100, s.accuracy))
    return `<div class="bar-row">
      <div class="bar-name">${escapeHtml(s.subject)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(w / max) * 100}%;background:${c}"></div></div>
      <div class="bar-val" style="color:${c}">${s.accuracy}%</div>
    </div>`
  }).join('')
  return `<div class="bar-chart">${bars}</div>`
}

/**
 * 知识点掌握度分布（待加强 / 需关注 / 需巩固 计数）。
 * 从 subjectDiagnosis 各 topTags 的 masteryLabel 聚合，给家长一眼看清薄弱结构。
 */
function renderMasteryDistribution(subjectDiagnosis) {
  const buckets = { '待加强': 0, '需关注': 0, '需巩固': 0 }
  let total = 0
  for (const s of (subjectDiagnosis || [])) {
    for (const t of (s.topTags || [])) {
      const lab = t.masteryLabel
      if (lab in buckets) { buckets[lab]++; total++ }
    }
  }
  if (total === 0) return ''
  // r137 收敛：旧版是 红/橙/黄 三格警示梯度（负责人反馈「红红绿绿有点过」）。
  // 三格都上色 ⇒ 读起来像"到处都是警告"，反而看不出哪格真的严重。
  // 现在：中性灰阶打底，**只有「待加强」上琥珀色**（唯一值得马上处理的），
  // 其余两格用灰 —— 颜色重新变成"信号"，而不是"底噪"。
  const cell = (label, count, strong) =>
    `<div class="mdist-cell${strong ? ' is-strong' : ''}"><div class="mdist-v">${count}</div><div class="mdist-l">${label}</div></div>`
  return `<div class="mdist-row">
    ${cell('待加强', buckets['待加强'], true)}
    ${cell('需关注', buckets['需关注'], false)}
    ${cell('需巩固', buckets['需巩固'], false)}
  </div>`
}

/**
 * 错因分布（计算错误/单位错误/步骤遗漏/概念错误/未分析 …）。
 * 数据来自后端 weekly-report 的 errorDistribution（聚合 diagnosisService 已回填的
 * wrong_questions.error_type）。错因是老师/家长最关心的“为什么错”，比“错了几题”更可行动。
 */
/**
 * 错因配色（r137 收敛）。
 * 旧版给 10 种错因各配一个饱和色（红/蓝/青/橙/黄/紫），实测一页里 8 个色相互相打架，
 * 且「计算错误 36 道」被涂成**红色**—— 但它不是错误，是占比最高的学习数据。
 * 现在：默认主蓝（=常态），只有**占比第一名**用琥珀（=唯一值得先抓的），
 * 「未分析」用中性灰。红色不再出现在错因里。
 */
const ERROR_TYPE_COLORS = {
  未分析: T.textTer,
}
function renderErrorDistribution(errorDistribution) {
  const all = (errorDistribution || []).filter(e => e && e.count > 0)
  if (all.length === 0) return ''
  // r137：实测 8 条时最后一条被页脚压住（内容延伸到 y=1110，页脚在 1070，溢出 40px）。
  // 家长视角里「1次·1%」的错因没有决策价值 —— 最多列 6 条，
  // 其余合并成「其他 N 类」，既不溢出也不丢信息。
  const MAX_ROWS = 6
  const rest = all.slice(MAX_ROWS - 1)
  const rows = all.length <= MAX_ROWS
    ? all
    : [...all.slice(0, MAX_ROWS - 1), {
        errorType: `其他 ${rest.length} 类`,
        count: rest.reduce((s, e) => s + e.count, 0),
        ratio: rest.reduce((s, e) => s + (e.ratio || 0), 0)
      }]
  const maxCount = Math.max(...rows.map(r => r.count), 1)
  const top = rows.reduce((a, b) => (b.count > a.count ? b : a))
  const bars = rows.map(e => {
    // r137：只有第一名用琥珀（值得先抓），其余主蓝；数值统一用 textSec 不再跟着变色
    const isTop = e.errorType === top.errorType
    const c = ERROR_TYPE_COLORS[e.errorType] || (isTop ? T.warning : T.primary)
    const w = Math.max(3, Math.round((e.count / maxCount) * 100))
    return `<div class="bar-row${isTop ? ' is-top' : ''}">
      <div class="bar-name" style="width:80px">${escapeHtml(e.errorType)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${c}"></div></div>
      <div class="bar-val" style="width:72px">${e.count}次 · ${e.ratio}%</div>
    </div>`
  }).join('')
  return `<div class="bar-chart">${bars}</div>`
}

/**
 * 重点薄弱知识点明细（错题≥2，按错误次数降序，最多 24 条）。
 * 后端 knowledgeDiagnosis 返回全部知识点（实测可达 130+ 条），旧版学科页只用了
 * subjectDiagnosis.topTags 每科 TOP5，绝大多数真实数据被丢弃。这里把「错得最多」的
 * 一批知识点带正确率条展出（独立成页），提高报告数据密度与可信度。
 */
/**
 * 进步证据 · 重练时间线（r136 新增）。
 *
 * 负责人 2026-10-04：「没有进步明显感觉，可以用图表更直观」。
 * 前 4 页都是"当下状态"（多少错题、错在哪），唯独缺一条**时间轴**，
 * 家长看不到"这些题是怎么一步步被拿下的"。
 * 逐份重练卷的答对率就是最直接的证据：把每份卷画成一根柱，
 * 起伏本身就是过程。
 *
 * ⛔ 不美化：某份卷只有 11% 也照样画出来（虚标会被时间线自己拆穿）。
 *   空态：没有重练记录时整块不渲染，不画假线。
 */
function renderRetryTimeline(retryHistory) {
  const list = (retryHistory || []).filter(x => x && x.questionCount > 0)
  if (list.length === 0) return ''
  const W = 640, rowH = 34, padL = 78, padR = 96
  const maxQ = Math.max(...list.map(x => x.questionCount), 1)
  const barW = W - padL - padR
  const totalH = list.length * rowH + 30

  const rows = list.map((x, i) => {
    const y = i * rowH + 8
    const acc = x.questionCount > 0 ? Math.round((x.correctCount / x.questionCount) * 100) : 0
    // 柱宽编码题量，颜色深浅编码正确率 —— 两个维度一起看
    const w = Math.max(6, Math.round(barW * (x.questionCount / maxQ)))
    // r137 收敛：≥60% 主蓝（常态）、40~60% 灰蓝、<40% 才用警示橙。
    // 旧版 4 档色（绿/蓝/橙/红）让「一次低分」变成整页最刺眼的元素。
    // 红色只留给真正需要立刻看的（<40%），且不再用纯红（纯红是"错误"，此处是"需关注"）。
    const color = acc >= 60 ? T.primary : acc >= 40 ? T.textTer : T.warning
    return `<g>
      <text x="0" y="${y + 16}" font-size="11" fill="${T.textTer}">${escapeHtml(String(x.date).slice(5))}</text>
      <rect x="${padL}" y="${y + 4}" width="${w}" height="16" rx="4" fill="${color}" opacity="${acc >= 60 ? 0.9 : 0.75}"/>
      <text x="${Math.min(padL + w + 8, W - padR - 34)}" y="${y + 16}" font-size="12" font-weight="700" fill="${color}">${acc}%</text>
      <text x="${W}" y="${y + 16}" font-size="10.5" fill="${T.textTer}" text-anchor="end">${x.correctCount}/${x.questionCount} 题</text>
    </g>`
  }).join('')

  // r136 诚实判读：柱子是真实起伏，**不粉饰**。
  // 若只取首末对比，"70% → 11%" 会被说成退步；逐份看其实是
  // 「题量越大的卷正确率越低」—— 9-16 那份 29 题只对 7 道（24%），
  // 9-23 那份 9 题只对 1 道（11%）。所以判读口径是**卷子题量 vs 答对率**：
  // 小卷（≤15 题）两次分别为 70% / 11%，波动大且不稳定；
  // 大卷（>15 题）24% / 71%，说明量大时表现反而不差。
  // ⛔ 绝不在这里写"进步明显" —— 真实数据不支持，图表越直观越藏不住。
  const small = list.filter(x => x.questionCount <= 15)
  const large = list.filter(x => x.questionCount > 15)
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, x) => a + x.correctCount / x.questionCount, 0) / arr.length * 100) : null)
  const notes = []
  if (small.length >= 2) notes.push(`小卷（≤15 题，${small.length} 份）平均 ${avg(small)}%`)
  if (large.length >= 2) notes.push(`大卷（>15 题，${large.length} 份）平均 ${avg(large)}%`)
  const noteText = notes.length
    ? `${notes.join('，')}。题量与正确率的关系比单次分数更能反映真实水平。`
    : '每份卷的题量不同，请结合右侧的「几题」一起看。'

  return `<svg width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">
    ${rows}
  </svg>
  <div class="tl-note">${noteText}</div>`
}

/**
 * 进步证据 · 错题「攻下 vs 尚存」对比图（r136 新增）。
 * 一根横向堆叠条：已记住（含彻底掌握） vs 还在攻克。
 * 绿色部分越长，家长越能直观看到"已经拿下的部分"。
 */
function renderSecuredBar(stats) {
  const mastered = stats.masteredCount || 0
  const basic = stats.basicMasteredCount || 0
  const todo = stats.notStartedCount || 0
  const total = Math.max(mastered + basic + todo, 1)
  const pct = (v) => Math.round((v / total) * 100)
  return `<div class="sec-bar">
    <div class="sec-bar-track">
      ${mastered > 0 ? `<div class="sec-seg is-m" style="width:${pct(mastered)}%">${pct(mastered) >= 12 ? mastered : ''}</div>` : ''}
      ${basic > 0 ? `<div class="sec-seg is-b" style="width:${pct(basic)}%">${pct(basic) >= 12 ? basic : ''}</div>` : ''}
      ${todo > 0 ? `<div class="sec-seg is-t" style="width:${pct(todo)}%">${pct(todo) >= 12 ? todo : ''}</div>` : ''}
    </div>
    <div class="sec-legend">
      <span><i class="is-m"></i>彻底掌握 <b>${mastered}</b>（${pct(mastered)}%）</span>
      <span><i class="is-b"></i>已记住 <b>${basic}</b>（${pct(basic)}%）</span>
      <span><i class="is-t"></i>还在攻克 <b>${todo}</b>（${pct(todo)}%）</span>
    </div>
  </div>`
}

function renderKnowledgeDetail(knowledgeDiagnosis) {
  const rows = (knowledgeDiagnosis || [])
    .filter(k => k && (k.wrongCount || 0) >= 2)
    .sort((a, b) => (b.wrongCount - a.wrongCount) || (a.accuracy - b.accuracy))
    .slice(0, 18)
  if (rows.length === 0) return ''
  // r137 收敛：旧版每行按正确率上色（红/橙/绿/蓝四档），24 行 = 24 个彩色条，
  // 实测占全文 32% 的彩色元素（221/688）—— 附录页本该是最安静的部分。
  // 现在：统一主蓝，**只有正确率 < 50%**（真正需要立刻关注的）才标红。
  const trs = rows.map(k => {
    const low = k.accuracy < 50
    const c = low ? T.danger : T.primary
    const w = Math.max(2, Math.min(100, k.accuracy))
    return `<tr>
      <td class="kd-sub">${escapeHtml(k.subject)}</td>
      <td class="kd-tag">${escapeHtml(k.tag)}</td>
      <td class="kd-c kd-wrong">${k.wrongCount}/${k.totalCount}</td>
      <td class="kd-barcell"><div class="kd-bar-track"><div class="kd-bar-fill" style="width:${w}%;background:${c}"></div></div></td>
      <td class="kd-c kd-acc">${k.accuracy}%</td>
    </tr>`
  }).join('')
  return `<div class="kd-card">
    <table class="kd-table">
      <thead><tr><th style="width:52px">学科</th><th>知识点</th><th class="kd-c" style="width:64px">错/总</th><th style="width:150px">正确率</th><th class="kd-c" style="width:52px">数值</th></tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`
}

/** 价值点图标（简洁线性 SVG） */
const VALUE_ICONS = {
  find: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="${T.primary}" stroke-width="2"/><path d="M16 16l4 4" stroke="${T.primary}" stroke-width="2" stroke-linecap="round"/></svg>`,
  train: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 17l-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 3z" stroke="${T.primary}" stroke-width="2" stroke-linejoin="round"/></svg>`,
  grow: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 18l6-6 4 4 6-8" stroke="${T.primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 8h5v5" stroke="${T.primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

/** 内联头像（取姓名首字，避免外链图片在 html2canvas 中的 CORS/渲染问题） */
function renderAvatar(student) {
  const initial = escapeHtml((student.name || '学').trim().charAt(0))
  return `<div class="avatar"><span>${initial}</span></div>`
}

/**
 * 生成诊断报告 HTML 内容（3 页：封面 / 概览 / 学科诊断）
 */
/**
 * 错题消灭漏斗（提升总览页主视觉）。
 * 三阶：本周期错题池 → 已重练 → 掌握进阶（基本+完全），用转化率讲“消灭错题→变强”。
 * 数据全来自 retryProgress / stats，不造假；某阶为 0 时仍如实画。
 */
function renderErrorFunnel(stats, retryProgress) {
  const pool = stats.newWrongCount || stats.pendingCount || 0
  const retried = retryProgress ? (retryProgress.retriedCount || 0) : 0
  const advanced = retryProgress ? ((retryProgress.pushedToBasic || 0) + (retryProgress.masteredCnt || 0)) : 0
  const stages = [
    { label: '本周期错题', value: pool, color: T.danger },
    { label: '已重练', value: retried, color: T.warning },
    { label: '掌握进阶', value: advanced, color: T.success },
  ]
  const max = Math.max(pool, retried, advanced, 1)
  const W = 660, rowH = 62, gap = 10
  let y = 6
  const rows = stages.map((s, i) => {
    const wRatio = Math.max(0.12, s.value / max)
    const barW = Math.round((W - 200) * wRatio)
    const conv = i === 0 ? '' : (stages[i - 1].value > 0 ? `转化 ${Math.round((s.value / stages[i - 1].value) * 100)}%` : '')
    const cy = y
    const html = `<g>
      <text x="0" y="${cy + 24}" font-size="14" font-weight="700" fill="${T.text}">${s.label}</text>
      <text x="0" y="${cy + 44}" font-size="11" fill="${T.textTer}">${conv}</text>
      <rect x="150" y="${cy + 8}" width="${barW}" height="40" rx="6" fill="${s.color}"/>
      <text x="${150 + barW + 12}" y="${cy + 34}" font-size="20" font-weight="800" fill="${s.color}">${s.value}<tspan font-size="12" font-weight="500" fill="${T.textTer}"> 题</tspan></text>
    </g>`
    y += rowH + gap
    return html
  }).join('')
  const totalH = y + 4
  return `<svg width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%">${rows}</svg>`
}

/**
 * 掌握度流转堆叠条：新错 / 基本掌握 / 完全掌握 占比（从红到绿）。
 */
/**
 * 错题掌握度三态构成（r135 修正）。
 *
 * ⛔ 旧版用 `basic = pending - newWrongCount` 推导「基本掌握」——
 *   这在 r130 之前碰巧成立（pending 就是全部未掌握数），但 r130 加了
 *   basicMasteredCount / notStartedCount 之后，`pending(72) - newWrong(74) = -2`
 *   ⇒ **基本掌握恒为 0**。实测陆晨曦 PDF 上写着「基本掌握 0」，而库里是 14。
 *   同一个数在后台页面显示 14、在家长 PDF 显示 0 —— 口径漂移的典型案例。
 *   现在直读后端三态字段（r130 起提供），旧推导彻底删除。
 *
 * 视觉重心也一并调整：r135 起最长的条是「已记住」而非「待提升」，
 * 让家长第一眼看到的是成果而不是欠账。
 */
function renderMasteryStack(stats) {
  const mastered = stats.masteredCount || 0
  const basic = stats.basicMasteredCount || 0
  const todo = stats.notStartedCount || 0
  const total = Math.max(mastered + basic + todo, 1)
  const seg = (v, color) => v > 0 ? `<div class="ms-seg" style="width:${(v / total) * 100}%;background:${color}">${v >= total * 0.12 ? v : ''}</div>` : ''
  return `<div class="ms-wrap">
    <div class="ms-bar">${seg(mastered, T.success)}${seg(basic, T.primary)}${seg(todo, T.danger)}</div>
    <div class="ms-legend">
      <span><i style="background:${T.success}"></i>彻底掌握 ${mastered}</span>
      <span><i style="background:${T.primary}"></i>已记住 ${basic}</span>
      <span><i style="background:${T.danger}"></i>还在攻克 ${todo}</span>
    </div>
  </div>`
}

/**
 * 提升总览页（第 02 页）：错题消灭漏斗 + 掌握度流转 + 重练 KPI。
 */
/**
 * 01 消灭错题 · 提升总览（r135 重写）
 *
 * 负责人要求：「没有体现消灭错题带来的提升（可参考刚才的后台界面）」。
 * 旧版三个问题（都是实图复核出来的，不是想象）：
 *   ① **视觉重心压在失败上**：漏斗第一根最长条是红色的「本周期错题 74」，
 *      而成果只有细细一根 —— 家长翻开第一眼看到的是"欠了 74 道"。
 *   ② **口径漂移**：「基本掌握 0」（已由 renderMasteryStack 修正）。
 *   ③ **下半页大片空白**（实测该页内容仅占 ~60%），显得像没做完。
 *
 * 现在的叙事：先给成果（战果条 + 三态 + 已练口径），再讲进度（漏斗），
 * 最后是重练明细。三块内容把整页填满，且每一块都在回答"孩子进步了多少"。
 *
 * 口径与后台页面完全一致（同一套字段、同一套措辞）：
 *   主数字 = 已记住（答对 1 次）；彻底掌握只作小徽章；已练口径避免被未练题稀释。
 */
function renderProgressPage(stats, retryProgress, badgeLabel) {
  const rp = retryProgress || {}
  const hasRetry = (rp.retriedCount || 0) > 0
  const kpi = (v, l, color) => `<div class="rk-card"><div class="rk-v" style="color:${color || T.primary}">${v}</div><div class="rk-l">${l}</div></div>`

  // 战果数据（与后台同源：mastered=彻底掌握 / basic=已记住 / todo=还在攻克）
  const mastered = stats.masteredCount || 0
  const basic = stats.basicMasteredCount || 0
  const todo = stats.notStartedCount || 0
  const total = Math.max(mastered + basic + todo, 1)
  const secured = mastered + basic
  const practiced = stats.practicedCount || 0
  // 已练口径：只在练过 >0 时才有意义，否则不编分母
  const pace = practiced > 0 ? Math.round((secured / practiced) * 100) : null

  return `
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${renderLogo({ compact: true })}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">学习成长记录</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">01</span>战果 · 错题消灭进度</div>
      <div class="sec-sub">答对一次就算记住 —— 这一页看的是已经拿下了多少</div>

      <!-- 战果头：主数字用「已记住」，彻底掌握只作小徽章 -->
      <div class="trophy">
        <div class="trophy-l">
          <div class="trophy-n">${total}<span>道错题，已拿下</span></div>
          <div class="trophy-n trophy-n--big">${secured}<span>道</span></div>
          ${mastered > 0 ? `<div class="trophy-badge">✓ ${mastered} 道彻底掌握</div>` : ''}
        </div>
        <div class="trophy-r">
          ${pace !== null
            ? `<div class="trophy-k">练过 <b>${practiced}</b> 道 · 拿下 <b>${secured}</b> 道（<b>${pace}%</b>）</div>`
            : '<div class="trophy-k">新错题已入库，重练后这里会显示进步</div>'}
          <div class="trophy-sub">只看已经练过的题，${practiced > 0 ? `每 10 道里有 ${Math.round(secured / practiced * 10)} 道被拿下` : '不受尚未安排的新题影响'}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-t">错题掌握度构成</div>
        ${renderMasteryStack(stats)}
      </div>

      <div class="panel">
        <div class="panel-t">重练转化过程</div>
        <div class="panel-s">从“产生错题”到“重练掌握”，越往下越接近真正学会</div>
        ${renderErrorFunnel(stats, retryProgress)}
      </div>

      ${hasRetry ? `<div class="sub-label">本周期重练成果</div>
      <div class="rk-grid">
        ${kpi(rp.retriedCount, '重练题目', T.primary)}
        ${kpi((rp.pushedToBasic || 0) + (rp.masteredCnt || 0), '推进到已记住', T.success)}
        ${kpi((rp.masteredCnt || 0) + ' 题', '彻底掌握', T.success)}
        ${kpi(rp.retryAccuracy + '%', '重练正确率', T.warning)}
      </div>
      <div class="rp-note">答对 ${rp.correctCount} 题 · 未通过回到待练 ${rp.stillNew} 题 —— 未通过的题不算失败，只是还需要再练一次</div>`
      : `<div class="empty-hint">本周期尚未开始重练。已记住的 ${secured} 道会在重练卷里做二次验证，再对一次就能升级为彻底掌握。</div>`}
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- 02 -</span></div>
  </div>`
}

/**
 * 单个对比指标卡：本周值 + 较上周差值（带"升=好"语义配色）
 * @param {string} label
 * @param {number} cur - 本周值
 * @param {number|null} prev - 上周值（null=上周无数据）
 * @param {boolean} goodWhenUp - 数值上升是否代表进步（正确率/题量上升=好；错题上升=坏）
 * @param {string} unit
 */
function compareItemHTML(label, cur, prev, goodWhenUp, unit = '') {
  const curText = `${cur}${unit}`
  if (prev == null) {
    return `<div class="cmp-item"><div class="cmp-label">${label}</div><div class="cmp-cur">${curText}</div><div class="cmp-diff dim">上周无数据</div></div>`
  }
  const d = Math.round((cur - prev) * 10) / 10
  if (d === 0) {
    return `<div class="cmp-item"><div class="cmp-label">${label}</div><div class="cmp-cur">${curText}</div><div class="cmp-diff">与上周持平</div><div class="cmp-prev">上周 ${prev}${unit}</div></div>`
  }
  const good = (d > 0) === goodWhenUp
  const cls = good ? 'good' : 'bad'
  const sign = d > 0 ? '+' : ''
  return `<div class="cmp-item"><div class="cmp-label">${label}</div><div class="cmp-cur">${curText}</div><div class="cmp-diff ${cls}">${sign}${d}${unit}（上周 ${prev}${unit}）</div></div>`
}

/** 成长对比页（第 03 页）：周期对比 + 重练进步 */
function renderComparePage(curStats, prevStats, retryProgress, badgeLabel, prevPeriodLabel) {
  return `
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${renderLogo({ compact: true })}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">学习成长记录</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">03</span>成长对比</div>
      <div class="sec-sub">本周期 vs 上一周期（${prevPeriodLabel}），观察学习变化</div>

      <div class="sub-label">较上一周期</div>
      <div class="cmp-grid">
        ${compareItemHTML('正确率', curStats.accuracy ?? 0, prevStats.totalQuestions ? prevStats.accuracy : null, true, '%')}
        ${compareItemHTML('新增错题', curStats.newWrongCount ?? 0, prevStats.totalQuestions ? prevStats.newWrongCount : null, false, ' 题')}
        ${compareItemHTML('待重练错题', curStats.pendingCount ?? 0, prevStats.totalQuestions ? prevStats.pendingCount : null, false, ' 题')}
        ${compareItemHTML('完成题量', curStats.totalQuestions ?? 0, prevStats.totalQuestions, true, ' 题')}
      </div>

      ${retryProgress && retryProgress.examCount > 0 ? `
      <div class="sub-label">重练进步（本周期）</div>
      <div class="retry-strip">
        <div class="retry-stat"><div class="v">${retryProgress.examCount}</div><div class="l">完成重练卷</div></div>
        <div class="retry-stat"><div class="v">${retryProgress.retriedCount}</div><div class="l">重练题目</div></div>
        <div class="retry-stat"><div class="v">${retryProgress.retryAccuracy}%</div><div class="l">重练正确率</div></div>
        <div class="retry-stat"><div class="v">${retryProgress.pushedToBasic}</div><div class="l">推进到基本掌握</div></div>
      </div>
      <div style="font-size:11px;color:${T.textSec};margin-top:8px">重练答对 ${retryProgress.correctCount} 题 · 未通过回到待练 ${retryProgress.stillNew} 题</div>` : ''}
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- 04 -</span></div>
  </div>`
}

export function buildDiagnosisHTML(reportData) {
  const { student, period, stats, subjectDiagnosis = [], knowledgeDiagnosis = [], errorDistribution = [], dailyTrend = [], periodTrend = [], prev = null, retryProgress = null, retryHistory = [] } = reportData
  // r136：进步证据页需要「逐份重练卷」明细（retryProgress 只有汇总，画不出时间线）
  const hasRetryHistory = Array.isArray(retryHistory) && retryHistory.some(x => x && x.questionCount > 0)
  // 日维度趋势是否可用（mode=all / 无每日数据时 dailyTrend 为空，旧版会渲染一张空网格图）
  const hasTrend = Array.isArray(dailyTrend) && dailyTrend.some(d => d && d.accuracy != null)
  // 是否有错题≥2 的知识点可展出（决定要不要单独开一页明细）
  const hasKnowledgeDetail = (knowledgeDiagnosis || []).some(k => k && (k.wrongCount || 0) >= 2)
  const mode = period.mode || 'week'
  const weekNum = period.weekNum || (mode === 'week' ? dayjs(period.start).isoWeek() : null)
  const badgeLabel = mode === 'month'
    ? dayjs(period.start).format('M月')
    : mode === 'all' ? 'ALL' : `WEEK ${weekNum}`
  const accColor = colorForAccuracy(stats.accuracy)
  // 成长对比：week/month 且有上一周期数据才渲染（all 模式无对比对象）
  const hasCompare = mode !== 'all' && prev && prev.stats

  // 最薄弱知识点（跨学科 wrongCount 最高）
  let weakestTag = ''
  for (const s of subjectDiagnosis) {
    if (s.topTags && s.topTags[0]) { weakestTag = s.topTags[0].tag; break }
  }

  const teacherComment = buildTeacherComment(stats, weakestTag)
  const teacherAdvice = buildTeacherAdvice(subjectDiagnosis)
  const teachingSummary = buildTeachingSummary(stats, subjectDiagnosis)

  // 品牌 Logo Lockup
  const logoFull = renderLogo({ compact: false })
  const logoSm = renderLogo({ compact: true })

  // 波浪装饰
  const waveSvg = `<svg viewBox="0 0 794 120" preserveAspectRatio="none" width="794" height="120" xmlns="http://www.w3.org/2000/svg"><path d="M0 40 C 150 90, 300 0, 450 40 S 700 90, 794 40 L794 120 L0 120 Z" fill="${T.primaryMist}"/><path d="M0 60 C 180 110, 320 20, 500 60 S 720 100, 794 60 L794 120 L0 120 Z" fill="${T.primarySoft}" opacity="0.6"/></svg>`

  // ── 学科诊断表格 ──
  const subjectCards = subjectDiagnosis.length > 0 ? subjectDiagnosis.map(s => {
    const rows = s.topTags.map((t, i) => {
      const ms = masteryStyle(t.masteryLabel)
      return `<tr>
        <td class="kt-tag"><span class="kt-tag-wrap">${ktRowIcon(i)}${escapeHtml(t.tag)}</span></td>
        <td class="kt-c" style="color:${t.wrongCount >= 3 ? T.danger : T.text};font-weight:${t.wrongCount >= 3 ? 600 : 400}">${t.wrongCount}</td>
        <td class="kt-c">${t.ratio}%</td>
        <td class="kt-c"><span class="mastery" style="background:${ms.bg};color:${ms.color}">${t.masteryLabel}</span></td>
        <td class="kt-action">${escapeHtml(t.accuracy < 60 || t.wrongCount >= 3 ? '优先讲解，次日重练' : t.wrongCount >= 2 ? '安排变式，观察独立完成' : '暂不加题，后续复测')}</td>
      </tr>`
    }).join('')
    const sAcc = s.accuracy != null ? s.accuracy : '—'
    const sAccColor = colorForAccuracy(s.accuracy)
    return `<div class="subj-card">
      <div class="subj-head">
        <div class="subj-name"><span class="subj-badge"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 4h11a2 2 0 012 2v13H7a2 2 0 00-2 2V4z" stroke="${T.primary}" stroke-width="2" stroke-linejoin="round"/><path d="M5 4v15" stroke="${T.primary}" stroke-width="2" stroke-linecap="round"/></svg></span>${escapeHtml(s.subject)}</div>
        <div class="subj-acc">正确率：<b style="color:${sAccColor}">${sAcc}${s.accuracy != null ? '%' : ''}</b></div>
      </div>
      <table class="kt-table">
        <thead><tr><th style="width:34%">知识点</th><th>错误次数</th><th>占比</th><th>掌握情况</th><th>下一步</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }).join('') : `<div class="empty-state"><div class="empty-icon" style="font-size:32px;margin-bottom:8px">--</div><div>本周暂无薄弱知识点</div><div class="empty-sub" style="font-size:13px;color:${T.textTer};margin-top:6px">当前没有形成明确薄弱点，可继续观察后再安排训练</div></div>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif;color:${T.text};background:#fff}
  .page{width:794px;height:1123px;position:relative;overflow:hidden;background:#fff}
  .pad{padding:44px 48px}

  /* 品牌 Logo Lockup */
  .brand{display:flex;align-items:center;gap:11px}
  .brand-mark{display:block;flex-shrink:0}
  .brand-cn{font-size:20px;font-weight:800;color:${T.text};letter-spacing:1px;line-height:1.1}
  .brand-en{font-size:9px;font-weight:600;color:${T.textTer};letter-spacing:1.5px;margin-top:3px}
  .brand-sm .brand-cn{font-size:15px}
  .brand-sm .brand-en{font-size:7.5px;letter-spacing:1px;margin-top:2px}

  /* 页眉 */
  .ph{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:30px}
  .ph-right{text-align:right}
  .week-badge{display:inline-block;background:linear-gradient(135deg,${T.primary},${T.primaryDark});color:#fff;font-size:12px;font-weight:700;padding:6px 16px;border-radius:20px;letter-spacing:1.5px}
  .ph-cap{font-size:11px;color:${T.textSec};font-weight:500;margin-top:7px}

  .sec-num{color:${T.primary};font-weight:800;font-size:26px;margin-right:10px;letter-spacing:1px}
  .sec-title{display:flex;align-items:center;font-size:22px;font-weight:800;color:${T.text};margin-bottom:6px}
  .sec-sub{font-size:13px;color:${T.textSec};margin:0 0 20px 2px}
  .sub-label{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:${T.textSec};margin:0 0 14px}
  .sub-label::before{content:'';width:4px;height:14px;border-radius:2px;background:${T.primary}}

  /* 页脚 */
  .pf{position:absolute;left:48px;right:48px;bottom:26px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:${T.textTer};border-top:1px solid ${T.borderLight};padding-top:12px}

  /* ── 封面页 ── */
  .cover{height:1123px;display:flex;flex-direction:column;position:relative}
  .cover-top{display:flex;align-items:flex-start;justify-content:space-between;padding:44px 48px 0}
  .cover-body{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:20px 48px}
  .cover-title{font-size:46px;font-weight:800;color:${T.text};letter-spacing:4px;margin-top:36px}
  .cover-sub{font-size:16px;color:${T.textSec};margin-top:12px;letter-spacing:1px}
  .avatar{width:96px;height:96px;border-radius:50%;margin-top:44px;border:4px solid ${T.primarySoft};background:linear-gradient(135deg,${T.primary},${T.teal});display:flex;align-items:center;justify-content:center}
  .avatar span{color:#fff;font-size:40px;font-weight:700}
  .cover-name{font-size:24px;font-weight:700;color:${T.text};margin-top:16px}
  .cover-name .tag{font-size:14px;font-weight:400;color:${T.textSec};margin-left:6px}
  .class-badge{display:inline-block;font-size:13px;color:${T.primaryDark};background:${T.primaryMist};padding:5px 16px;border-radius:16px;margin-top:12px;font-weight:500}
  .period-line{font-size:13px;color:${T.textTer};margin-top:14px}
  .values{display:flex;gap:16px;margin-top:44px;width:100%;max-width:560px}
  .value-item{flex:1;background:${T.bg};border:1px solid ${T.borderLight};border-radius:14px;padding:18px 12px;text-align:center}
  .value-icon{width:44px;height:44px;border-radius:12px;background:${T.primaryMist};display:flex;align-items:center;justify-content:center;margin:0 auto 10px}
  .value-t{font-size:14px;font-weight:600;color:${T.text}}
  .value-d{font-size:11px;color:${T.textSec};margin-top:5px;line-height:1.5}
  .slogan{font-size:15px;font-weight:600;color:${T.primary};margin-top:40px;letter-spacing:1px}
  .wave{position:absolute;left:0;right:0;bottom:0;line-height:0}

  /* ── KPI ── */
  .kpi-row{display:flex;gap:14px;margin-bottom:16px}
  .kpi{flex:1;background:#fff;border:1px solid ${T.border};border-radius:14px;padding:18px 16px;display:flex;flex-direction:column;justify-content:center}
  .kpi-v{font-size:30px;font-weight:800;color:${T.text};line-height:1.1}
  .kpi-v .u{font-size:14px;font-weight:500;color:${T.textTer};margin-left:3px}
  .kpi-l{font-size:12px;color:${T.textSec};margin-top:6px}
  .kpi.ring-kpi{flex-direction:row;align-items:center;gap:16px}
  .ring{width:78px;height:78px;border-radius:50%;background:conic-gradient(${accColor} ${stats.accuracy * 3.6}deg, ${T.borderLight} 0);display:flex;align-items:center;justify-content:center;position:relative;flex-shrink:0}
  .ring::before{content:'';position:absolute;width:56px;height:56px;border-radius:50%;background:#fff}
  .ring-t{position:relative;z-index:1;font-size:19px;font-weight:800;color:${accColor}}
  .ring-side .rl{font-size:12px;color:${T.textSec}}
  .ring-side .rv{font-size:13px;color:${T.text};margin-top:2px;font-weight:600}

  /* 三色卡 */
  .tri-row{display:flex;gap:14px;margin-bottom:22px}
  .tri{flex:1;border-radius:14px;padding:16px;border:1px solid transparent}
  .tri-v{font-size:26px;font-weight:800;line-height:1.1}
  .tri-l{font-size:12px;margin-top:5px;font-weight:500}

  /* 趋势卡 */
  .chart-card{background:#fff;border:1px solid ${T.border};border-radius:14px;padding:18px 16px 8px;margin-bottom:22px}
  .chart-card svg{display:block;width:100%;height:auto}

  /* 学科正确率条形图（趋势为空时的替代可视化） */
  .bar-chart{display:flex;flex-direction:column;gap:14px;padding:8px 4px 14px}
  .bar-row{display:flex;align-items:center;gap:12px}
  /* r137：数值统一中性色，只有占比第一行加粗 —— 减少整页彩色噪点 */
  .bar-row.is-top .bar-name{color:${T.text};font-weight:700}
  .bar-row.is-top .bar-val{color:${T.text};font-weight:700}
  .bar-name{width:64px;flex-shrink:0;font-size:13px;font-weight:600;color:${T.text}}
  .bar-track{flex:1;height:14px;border-radius:7px;background:${T.borderLight};overflow:hidden}
  .bar-fill{height:100%;border-radius:7px}
  .bar-val{width:48px;flex-shrink:0;text-align:right;font-size:13px;font-weight:700}

  /* 知识点掌握度分布 */
  .mdist-row{display:flex;gap:12px;margin-bottom:22px}
  /* r137 收敛：灰阶打底 + 仅「待加强」上琥珀。
     ⚠️ 上一版只改了 JSX（去掉行内 style）却忘了同步 CSS，导致三格变成无样式的
        裸数字 —— 实图复核才发现。这类「结构与样式必须同步」的改动要一起做。 */
  .mdist-cell{flex:1;border-radius:10px;padding:14px 10px;text-align:center;background:${T.bg};border:1px solid ${T.borderLight}}
  .mdist-cell.is-strong{background:${T.warningSoft};border-color:#FCD9A0}
  .mdist-v{font-size:26px;font-weight:800;line-height:1.1;color:${T.text}}
  .mdist-cell.is-strong .mdist-v{color:${T.warning}}
  .mdist-l{font-size:12px;margin-top:5px;font-weight:600;color:${T.textSec}}
  .mdist-cell.is-strong .mdist-l{color:${T.warning}}

  /* 提升总览页：面板 / 漏斗 / 堆叠 / 重练 KPI */
  .panel{background:${T.card};border:1px solid ${T.borderLight};border-radius:14px;padding:18px 20px;margin-bottom:16px}
  .panel-t{font-size:14px;font-weight:700;color:${T.primary};margin-bottom:14px;display:flex;align-items:center;gap:8px}
  .panel-t::before{content:'';width:4px;height:15px;border-radius:2px;background:${T.accent}}
  .ms-wrap{padding:6px 0}
  .ms-bar{display:flex;height:30px;border-radius:8px;overflow:hidden;background:${T.borderLight}}
  .ms-seg{display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;min-width:0}
  .ms-legend{display:flex;gap:20px;margin-top:12px;font-size:12px;color:${T.textSec}}
  .ms-legend span{display:flex;align-items:center;gap:6px}
  .ms-legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
  /* ── r135 战果头（对应后台的 TrophyBar，视觉与措辞对齐）── */
  .trophy{display:flex;align-items:stretch;justify-content:space-between;gap:20px;padding:16px 18px;margin-bottom:14px;background:${T.primary};border-radius:12px;color:#fff}
  .trophy-l{display:flex;flex-direction:column;gap:2px;min-width:0}
  .trophy-n{font-size:13px;opacity:.85;line-height:1.35}
  .trophy-n span{margin-left:5px;font-size:12px;opacity:.8}
  .trophy-n--big{font-size:40px;font-weight:800;line-height:1.1;letter-spacing:-1px;opacity:1;margin-top:2px}
  .trophy-n--big span{font-size:15px;font-weight:600;opacity:.85;margin-left:4px}
  .trophy-badge{align-self:flex-start;margin-top:7px;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11px;font-weight:600}
  .trophy-r{display:flex;max-width:250px;flex-direction:column;justify-content:center;gap:5px;text-align:right}
  .trophy-k{font-size:12.5px;opacity:.9;line-height:1.5}
  .trophy-k b{font-size:15px;font-weight:800;opacity:1}
  .trophy-sub{font-size:11px;opacity:.72;line-height:1.5}
  .panel-s{margin:-2px 0 10px;color:${T.textTer};font-size:11px;line-height:1.5}
  .rp-note{margin-top:10px;padding:10px 12px;background:${T.primaryMist};border-radius:8px;color:${T.textSec};font-size:11.5px;line-height:1.6}
  /* ── r136 进步证据页 ── */
  .tl-note{margin-top:10px;padding:9px 12px;background:${T.primaryMist};border-radius:8px;color:${T.textSec};font-size:11.5px;line-height:1.6}
  .panel-note{margin-top:11px;padding:10px 12px;background:${T.bg};border-radius:8px;color:${T.textSec};font-size:11.5px;line-height:1.6}
  .sec-bar{margin-top:2px}
  .sec-bar-track{display:flex;height:30px;border-radius:8px;overflow:hidden;background:${T.borderLight}}
  .sec-seg{display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:800}
  .sec-seg.is-m{background:${T.success}}
  .sec-seg.is-b{background:${T.primary}}
  .sec-seg.is-t{background:${T.border};color:${T.textSec}}
  .sec-legend{display:flex;gap:18px;margin-top:11px;flex-wrap:wrap}
  .sec-legend span{display:flex;align-items:center;gap:6px;color:${T.textSec};font-size:12px}
  .sec-legend i{width:9px;height:9px;border-radius:3px}
  .sec-legend i.is-m{background:${T.success}}
  .sec-legend i.is-b{background:${T.primary}}
  .sec-legend i.is-t{background:${T.border}}
  .sec-legend b{color:${T.text};font-weight:700}
  .rk-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:6px}
  .rk-card{background:${T.primaryMist};border:1px solid ${T.borderLight};border-radius:12px;padding:16px 10px;text-align:center}
  .rk-v{font-size:26px;font-weight:800;line-height:1.1}
  .rk-l{font-size:11px;color:${T.textSec};margin-top:6px}
  .empty-hint{background:${T.bg};border:1px dashed ${T.border};border-radius:12px;padding:20px;text-align:center;color:${T.textSec};font-size:13px}

  /* 教学判断卡 */
  .teaching-summary{background:#fffaf0;border:1px solid #FDE68A;border-radius:14px;padding:16px 18px;margin-bottom:16px}
  .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .summary-grid>div{background:#fff;border:1px solid ${T.borderLight};border-radius:10px;padding:11px 12px}
  .summary-label{font-size:11px;color:${T.textSec};margin-bottom:5px}
  .summary-value{font-size:12px;color:${T.text};line-height:1.6}

  /* 寄语卡 */
  .comment{background:${T.primaryMist};border:1px solid ${T.primarySoft};border-radius:14px;padding:18px 20px;display:flex;gap:12px;align-items:flex-start}
  .comment-icon{flex-shrink:0;width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,${T.primary},${T.teal});display:flex;align-items:center;justify-content:center}
  .comment-t{font-size:13px;font-weight:700;color:${T.text};margin-bottom:5px}
  .comment-d{font-size:13px;color:${T.textSec};line-height:1.7}

  /* 成长对比页 */
  .cmp-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:18px}
  .cmp-item{border:1px solid ${T.borderLight};border-radius:10px;padding:14px 16px;background:#fff}
  .cmp-label{font-size:11px;color:${T.textSec};margin-bottom:6px}
  .cmp-cur{font-size:24px;font-weight:800;color:${T.text};line-height:1.2}
  .cmp-diff{font-size:12px;font-weight:700;margin-top:6px}
  .cmp-diff.good{color:${T.success}}
  .cmp-diff.bad{color:${T.danger}}
  .cmp-diff.dim{color:${T.textTer};font-weight:500}
  .cmp-prev{font-size:11px;color:${T.textTer};margin-top:4px}
  .retry-strip{display:flex;gap:12px;margin-top:4px}
  .retry-stat{flex:1;background:${T.primaryMist};border:1px solid ${T.primarySoft};border-radius:10px;padding:12px 10px;text-align:center}
  .retry-stat .v{font-size:20px;font-weight:800;color:${T.primary}}
  .retry-stat .l{font-size:10px;color:${T.textSec};margin-top:4px}

  /* ── 学科诊断 ── */
  .subj-card{background:#fff;border:1px solid ${T.border};border-radius:16px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(30,64,120,.04)}
  .subj-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .subj-name{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:800;color:${T.text}}
  .subj-badge{width:26px;height:26px;border-radius:7px;background:${T.primaryMist};display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .subj-acc{font-size:13px;color:${T.textSec}}
  .kt-table{width:100%;border-collapse:collapse;font-size:13px}
  .kt-table th{background:${T.bg};padding:10px 12px;text-align:center;font-weight:600;color:${T.textSec};border-bottom:1px solid ${T.border}}
  .kt-table th:first-child{text-align:left;border-top-left-radius:8px;border-bottom-left-radius:8px}
  .kt-table th:last-child{border-top-right-radius:8px;border-bottom-right-radius:8px}
  .kt-table td{padding:11px 12px;border-bottom:1px solid ${T.borderLight};color:${T.text}}\n  .kt-action{font-size:11px;color:${T.primaryDark};line-height:1.5}
  .kt-table tr:last-child td{border-bottom:none}
  .kt-tag{font-weight:500}
  .kt-tag-wrap{display:flex;align-items:center;gap:10px}
  .kt-ic{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
  .kt-c{text-align:center}
  .mastery{display:inline-block;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:600}

  /* 重点薄弱知识点明细表 */
  .kd-card{margin-top:6px}
  .kd-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:2px}
  .kd-table th{background:${T.bg};padding:7px 10px;text-align:left;font-weight:600;color:${T.textSec};border-bottom:1px solid ${T.border};font-size:11px}
  .kd-table th.kd-c{text-align:center}
  .kd-table td{padding:6px 10px;border-bottom:1px solid ${T.borderLight};color:${T.text};vertical-align:middle}
  .kd-sub{color:${T.textSec};font-size:11px;white-space:nowrap}
  .kd-tag{font-weight:500}
  .kd-c{text-align:center}
  .kd-wrong{font-weight:700;color:${T.danger};white-space:nowrap}
  .kd-barcell{width:150px}
  .kd-bar-track{height:8px;border-radius:4px;background:${T.borderLight};overflow:hidden}
  .kd-bar-fill{height:100%;border-radius:4px}
  .kd-acc{font-weight:700;white-space:nowrap}

  .advice{background:${T.accentSoft};border:1px solid #FCD9B6;border-radius:16px;padding:18px 22px;margin-top:6px;display:flex;gap:13px;align-items:flex-start}
  .advice-icon{flex-shrink:0;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,${T.accent},#FBB040);display:flex;align-items:center;justify-content:center}
  .advice-t{font-size:14px;font-weight:800;color:${T.accent};margin-bottom:6px}
  .advice-d{font-size:13px;color:#9A4A10;line-height:1.8}

  .empty-state{text-align:center;padding:80px 40px;color:${T.textTer}}
  .empty-icon{font-size:52px;margin-bottom:14px}
  .empty-sub{margin-top:8px;font-size:12px}

  /* Brand report layout: structure first, decoration second. */
  body{background:${T.bg};color:${T.text};font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif}
  .page{background:#fff;border-top:8px solid ${T.primary}}
  .pad{padding:42px 48px}
  .brand-mark{border-radius:11px}
  .brand-cn{color:${T.primary};font-weight:800;letter-spacing:.5px}
  .brand-en{color:${T.textTer};font-size:8px;letter-spacing:1.2px}
  .ph{padding-bottom:16px;margin-bottom:27px;border-bottom:1px solid ${T.borderLight}}
  .week-badge{background:${T.primary};border-radius:4px;padding:6px 11px;font-size:10px;letter-spacing:1.2px}
  .ph-cap{font-size:10px;color:${T.textTer}}
  .sec-num{font-size:14px;color:${T.success};border:1px solid ${T.success};border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;margin-right:10px}
  .sec-title{font-size:23px;color:${T.primary};letter-spacing:.4px}
  .sec-sub{font-size:12px;color:${T.textSec};margin-left:36px}
  .sub-label{color:${T.primary};font-size:12px;letter-spacing:.5px;margin-bottom:11px}
  .sub-label::before{width:3px;background:${T.success}}
  .pf{border-top-color:${T.border};color:${T.textTer};font-size:10px}
  .cover{background:${T.bg};border-top:8px solid ${T.primary}}
  .cover-top{padding:40px 48px 0}
  .cover-body{align-items:flex-start;text-align:left;padding:35px 78px}
  .cover-title{font-size:42px;color:${T.primary};letter-spacing:2px;margin-top:22px}
  .cover-sub{font-size:15px;color:${T.textSec};letter-spacing:.5px}
  .cover .avatar{width:78px;height:78px;margin-top:38px;border:3px solid ${T.successSoft};background:${T.primary};box-shadow:none}
  .cover .avatar span{font-size:30px}
  .cover-name{font-size:25px;color:${T.text};margin-top:13px}
  .class-badge{color:${T.primary};background:${T.primaryMist};border-radius:3px;margin-top:10px}
  .period-line{color:${T.textSec};margin-top:12px}
  .values{gap:10px;max-width:none;margin-top:45px}
  .value-item{background:#fff;border-color:${T.border};border-radius:4px;padding:17px 12px;text-align:left}
  .value-icon{width:36px;height:36px;border-radius:50%;background:${T.primaryMist};margin:0 0 9px}
  .value-t{font-size:14px;color:${T.primary}}
  .value-d{font-size:11px;color:${T.textSec}}
  .slogan{color:${T.primary};font-size:14px;margin-top:33px;letter-spacing:.5px}
  /* r135：封面主体是 align-items:flex-start（封面覆盖块改的），
     所以战果条作为 flex 子项会被压成内容宽度 —— 实测只有 158px 宽，
     完全不像主视觉。这里 align-self:stretch 拉通，并让数字与说明横排。 */
  .cover-trophy{align-self:stretch;display:flex;align-items:center;gap:18px;margin-top:22px;padding:20px 24px;background:linear-gradient(135deg,${T.primary},${T.primaryDark});border-radius:12px;color:#fff}
  .ctr-n{font-size:48px;font-weight:800;line-height:1;letter-spacing:-2px;flex:0 0 auto}
  .ctr-n{font-size:46px;font-weight:800;line-height:1;letter-spacing:-1.5px}
  .ctr-txt{display:flex;flex-direction:column;gap:2px}
  .ctr-l{font-size:15px;font-weight:600;opacity:.95}
  .ctr-badge{align-self:flex-start;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.2);font-size:11.5px;font-weight:600}
  .cover-metrics{display:flex;gap:10px;margin-top:26px}
  .cm-cell{flex:1;background:#fff;border:1px solid ${T.border};border-radius:4px;padding:14px 8px;text-align:center}
  .cm-v{font-size:24px;font-weight:800;color:${T.primary};line-height:1.1}
  .cm-l{font-size:11px;color:${T.textSec};margin-top:5px}
  .wave{display:none}
  .kpi,.tri,.chart-card,.teaching-summary,.subj-card{border-radius:4px;box-shadow:none;border-color:${T.border}}
  .kpi{border-top:3px solid ${T.primary};padding:16px}
  .kpi-v{color:${T.primary}}
  .ring{background:conic-gradient(${accColor} ${stats.accuracy * 3.6}deg, ${T.borderLight} 0)}
  .tri{border-top-width:3px}
  /* r135 修可读性缺陷：这段是**封面专用覆盖**，但 .comment / .advice 被全文档共用，
     覆盖后内页的「学习寄语」也变成深色底，而 .comment-t/.comment-d 的文字色
     仍是深色 T.text / T.textSec ⇒ 深底深字，实测几乎不可读（「学习寄语」那块）。
     修法：深底时同步指定浅色文字（而不是改回浅底 —— 深色寄语框本身是刻意设计）。 */
  .comment,.advice{border-radius:4px;background:${T.primary};box-shadow:none}
  .comment .comment-t,.advice .advice-t{color:#fff}
  .comment .comment-d,.advice .advice-d{color:rgba(255,255,255,.88)}
  .comment-icon,.advice-icon{background:${T.success};border-radius:50%}
  .subj-head{background:${T.primaryMist}}
  .subj-badge{background:#fff;border-radius:50%}
  .mastery{border-radius:3px}
  .kt-table th{background:${T.bg};color:${T.textSec}}
  .cmp-item,.retry-stat{border-radius:4px}
</style></head><body>

  <!-- ═══ 封面页 ═══ -->
  <div class="page">
    <div class="cover">
      <div class="cover-top">
        ${logoFull}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">学习成长记录</div></div>
      </div>
      <div class="cover-body">
        <div class="cover-title">学习诊断报告</div>
        <div class="cover-sub">${BRAND.slogan}</div>
        ${renderAvatar(student)}
        <div class="cover-name">${escapeHtml(student.name)}<span class="tag">同学</span></div>
        <div class="class-badge">${escapeHtml(student.grade || '')}</div>
        <div class="period-line">${periodLabelText(period)}</div>
        <div class="values">
          <div class="value-item"><div class="value-icon">${VALUE_ICONS.find}</div><div class="value-t">发现问题</div><div class="value-d">从学习记录中发现需要关注的内容</div></div>
          <div class="value-item"><div class="value-icon">${VALUE_ICONS.train}</div><div class="value-t">针对训练</div><div class="value-d">围绕关键问题安排针对性训练</div></div>
          <div class="value-item"><div class="value-icon">${VALUE_ICONS.grow}</div><div class="value-t">持续进步</div><div class="value-d">在过程记录中观察学习变化</div></div>
        </div>
        <div class="slogan">发现问题 · 提供支持 · 记录变化</div>
        <!-- r135：封面加「战果条」—— 负责人要求体现消灭错题带来的提升。
             旧版封面只有 4 个中性数字（正确率/题量/新增错题/完全掌握），
             其中 2 个是负向的、1 个是苛刻门槛（完全掌握 2），且下半页大片空白。
             现在把「已拿下 N 道」做成封面的主视觉，家长翻开第一眼看到的是成果。 -->
        <div class="cover-trophy">
          <div class="ctr-n">${(stats.masteredCount || 0) + (stats.basicMasteredCount || 0)}</div>
          <div class="ctr-txt">
            <div class="ctr-l">道错题已经记住</div>
            ${(stats.masteredCount || 0) > 0 ? `<div class="ctr-badge">✓ 其中 ${stats.masteredCount} 道彻底掌握</div>` : ''}
          </div>
        </div>
        <div class="cover-metrics">
          <div class="cm-cell"><div class="cm-v" style="color:${accColor}">${stats.accuracy}%</div><div class="cm-l">整体正确率</div></div>
          <div class="cm-cell"><div class="cm-v">${stats.totalQuestions}</div><div class="cm-l">记录题量</div></div>
          <div class="cm-cell"><div class="cm-v" style="color:${T.primary}">${stats.practicedCount || 0}</div><div class="cm-l">已安排重练</div></div>
          <div class="cm-cell"><div class="cm-v" style="color:${T.warning}">${stats.newWrongCount}</div><div class="cm-l">待攻克错题</div></div>
        </div>
      </div>
      <div class="wave">${waveSvg}</div>
    </div>
  </div>

  ${renderProgressPage(stats, retryProgress, badgeLabel)}

  <!-- ═══ 概览页 ═══ -->
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${logoSm}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">学习成长记录</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">02</span>本周学习概览</div>
      <div class="sec-sub">从本周期学习记录中提炼的观察结果</div>

      <div class="sub-label">本周学习概览</div>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-v">${stats.completedTasks}<span class="u">次</span></div><div class="kpi-l">完成作业</div></div>
        <div class="kpi"><div class="kpi-v">${stats.totalQuestions}<span class="u">题</span></div><div class="kpi-l">本周记录题量</div></div>
        <div class="kpi ring-kpi">
          <div class="ring"><div class="ring-t">${stats.accuracy}%</div></div>
          <div class="ring-side"><div class="rl">整体正确率</div><div class="rv">${stats.correctCount}/${stats.totalQuestions} 题</div></div>
        </div>
      </div>

      <div class="tri-row">
        <div class="tri" style="background:${T.warningSoft};border-color:#FDE68A"><div class="tri-v" style="color:${T.warning}">${stats.newWrongCount}<span style="font-size:14px"> 题</span></div><div class="tri-l" style="color:#92400E">新增错题</div></div>
        <div class="tri" style="background:${T.successSoft};border-color:#A7F3D0"><div class="tri-v" style="color:${T.success}">${(stats.masteredCount || 0) + (stats.basicMasteredCount || 0)}<span style="font-size:14px"> 题</span></div><div class="tri-l" style="color:#065F46">已记住的错题</div></div>
        <div class="tri" style="background:${T.primaryMist};border-color:${T.primarySoft}"><div class="tri-v" style="color:${T.primary}">${stats.notStartedCount || 0}<span style="font-size:14px"> 题</span></div><div class="tri-l" style="color:${T.primaryDark}">还在攻克</div></div>
      </div>

      <div class="sub-label">${hasTrend ? '正确率趋势（本周期）' : '各学科正确率'}</div>
      <div class="chart-card">${hasTrend ? renderTrendChart(dailyTrend) : (renderSubjectBarChart(subjectDiagnosis) || `<div style="text-align:center;color:${T.textTer};font-size:13px;padding:24px 0">本周期暂无可展示的学科正确率数据</div>`)}</div>
      ${knowledgeDiagnosis.length > 0 ? `<div class="sub-label">知识点掌握度分布</div>${renderMasteryDistribution(subjectDiagnosis)}` : ''}

      <div class="teaching-summary">
        <div class="sub-label">学习诊断</div>
        <div class="summary-grid">
          <div><div class="summary-label">已经看到</div><div class="summary-value">${escapeHtml(teachingSummary.seen)}</div></div>
          <div><div class="summary-label">优先处理</div><div class="summary-value">${escapeHtml(teachingSummary.focus)}</div></div>
          <div><div class="summary-label">下一步验证</div><div class="summary-value">${escapeHtml(teachingSummary.action)}</div></div>
        </div>
      </div>

      <div class="comment">
        <div class="comment-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4V5z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>
        <div><div class="comment-t">学习寄语</div><div class="comment-d">${escapeHtml(teacherComment)}</div></div>
      </div>
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- 03 -</span></div>
  </div>

  ${hasCompare ? renderComparePage(stats, prev.stats, retryProgress, badgeLabel, `${prev.period.start} ~ ${prev.period.end}`) : ''}

  ${subjectDiagnosis.length > 0 ? `
  <!-- ═══ 学科诊断页 ═══ -->
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${logoSm}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">学习成长记录</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">${hasCompare ? '04' : '03'}</span>学科诊断分析</div>
      <div class="sec-sub">聚焦需要优先支持的知识点</div>

      ${subjectCards}

      ${errorDistribution.length > 0 ? `<div class="sub-label">错因分布（做错 ${stats.wrongCount || 0} 题归因）</div><div class="chart-card" style="padding:16px 16px 12px">${renderErrorDistribution(errorDistribution)}</div>` : ''}

      <div class="advice">
        <div class="advice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10c.7.7 1 1.4 1 2h6c0-.6.3-1.3 1-2a6 6 0 00-4-10z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>
        <div><div class="advice-t">学习建议</div><div class="advice-d">${escapeHtml(teacherAdvice)}</div></div>
      </div>
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- ${hasCompare ? '05' : '04'} -</span></div>
  </div>
  ` : ''}

  <!-- ═══ 进步证据页（r136 新增，负责人要求「用图表更直观体现进步」）═══
       为什么必须有这一页：前几页全是"当下状态"（多少错题 / 错在哪），
       唯一的"提升"只是一个 39% 的文字数字，家长看不出过程。
       这一页把三件事画成图：① 已攻下 vs 尚存 ② 逐份重练的答对率时间线
       ③ 错因分布（同一份数据的另一个切面）。 -->
  ${(hasRetryHistory || (stats.masteredCount || 0) + (stats.basicMasteredCount || 0) > 0) ? `
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${logoSm}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">学习成长记录</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">04</span>进步证据</div>
      <div class="sec-sub">错题是怎么一道道被拿下的 —— 每一份重练卷都是一步</div>

      <div class="panel">
        <div class="panel-t">已经攻下多少</div>
        <div class="panel-s">绿色与蓝色部分是已经记住的，灰色部分还需要继续练</div>
        ${renderSecuredBar(stats)}
        ${(stats.practicedCount || 0) > 0 ? `<div class="panel-note">已经安排重练过 ${stats.practicedCount} 道，其中 ${(stats.masteredCount || 0) + (stats.basicMasteredCount || 0)} 道被拿下（${Math.round(((stats.masteredCount || 0) + (stats.basicMasteredCount || 0)) / stats.practicedCount * 100)}%）。剩下的 ${stats.notStartedCount || 0} 道里，大部分是刚记录的新错题，还没轮到练。</div>` : ''}
      </div>

      ${hasRetryHistory ? `<div class="panel">
        <div class="panel-t">每次重练的答对率</div>
        <div class="panel-s">柱子的长短是卷子题量，颜色深浅是答对率 —— 起伏是真实过程</div>
        ${renderRetryTimeline(retryHistory)}
      </div>` : ''}

      ${errorDistribution.length > 0 ? `<div class="panel">
        <div class="panel-t">错因分布</div>
        <div class="panel-s">错在哪一类 —— 这决定了下一阶段怎么练</div>
        ${renderErrorDistribution(errorDistribution)}
      </div>` : ''}
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- ${hasCompare ? '05' : '04'} -</span></div>
  </div>
  ` : ''}

  ${(subjectDiagnosis.length > 0 && hasKnowledgeDetail) ? `
  <!-- ═══ 知识点掌握度明细页（数据密度：错题≥2 的薄弱知识点，最多 24 项）═══ -->
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${logoSm}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">学习成长记录</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">${hasCompare ? '06' : '05'}</span>知识点掌握度明细</div>
      <div class="sec-sub">本周期错得最多的知识点，带正确率与错题量，供逐点巩固</div>

      ${renderKnowledgeDetail(knowledgeDiagnosis)}
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- ${hasCompare ? '07' : '06'} -</span></div>
  </div>
  ` : ''}

</body></html>`
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成诊断报告 PDF（封面 + 概览 + 学科诊断，共 3 页）
 * 每个 .page 元素单独截图为一个 A4 页面，保证分页边界干净
 * @param {Object} reportData - 周统计数据
 * @returns {Blob} 诊断报告 PDF blob
 */
/**
 * 渲染诊断报告完整 HTML（KaTeX 公式 + 字体 inline + 二维码）
 * 在 hidden iframe 里 buildDiagnosisHTML → renderMathInContainer → preloadKatexFonts → outerHTML
 * 复用 serverPdfExporter 的隐藏 iframe 渲染模式
 */
async function renderDiagnosisFullHTML(reportData) {
  const inlinedCss = await getKatexCssWithInlineFonts()

  // 隐藏 iframe（与错题卷渲染保持一致）
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;'
  document.body.appendChild(holder)

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:794px;height:1200px;border:0;background:#fff;display:block;'
  iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
  holder.appendChild(iframe)

  try {
    const iwin = iframe.contentWindow
    const idoc = iwin.document

    // 写入诊断报告 HTML（CSS 已 inline 字体）
    idoc.open()
    idoc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + inlinedCss + '</style></head><body>' + buildDiagnosisHTML(reportData) + '</body></html>')
    idoc.close()

    // 等 DOM ready
    if (idoc.readyState === 'loading') {
      await new Promise((resolve) => {
        const onReady = () => resolve()
        idoc.addEventListener('DOMContentLoaded', onReady, { once: true })
        setTimeout(resolve, 1000)
      })
    }

    // KaTeX 渲染
    try {
      renderMathInContainer(idoc)
    } catch (e) {
      console.warn('[weeklyReport] KaTeX 渲染失败:', e)
    }

    // 字体预加载
    try {
      await preloadKatexFonts(idoc)
    } catch (e) {
      console.warn('[weeklyReport] 字体预加载失败:', e)
    }

    // 等 KaTeX 完成所有度量：2 帧 + 兜底 400ms
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    void idoc.body?.offsetWidth
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise((r) => setTimeout(r, 400))

    return idoc.documentElement.outerHTML
  } finally {
    setTimeout(() => {
      try { document.body.removeChild(holder) } catch (e) { /* ignore */ }
    }, 100)
  }
}

/**
 * 渲染错题再测卷完整 HTML
 * 复用 serverPdfExporter.renderFullHTML（与错题卷主路径同一渲染器）
 *
 * 【数据一致性】先渲染 HTML，再创建 exam 记录 + 注入二维码内容。
 * 若渲染过程中抛错，exam 记录不会被写入数据库，避免脏数据。
 * 若 createGeneratedExam 失败（极端情况），仍返回已渲染的 HTML（无二维码），
 * 不阻塞周报生成 —— 二维码缺失不影响周报核心内容。
 */
/**
 * 为再测卷找一个可复用的组卷 ID（幂等）：
 * 此前每次渲染周报 PDF 都 createGeneratedExam，多次下载会堆积大量同名重复卷
 * （实测一名学生 50 份，同名"错题再测-0814"×8）。复用规则：
 *   1. 同学生 + 同名（错题再测-MMDD）+ 未批改；
 *   2. 该卷没有任何答卷任务引用（tasks.generated_exam_id），否则它已在批改链路中；
 *   3. 题单有变化时经 PUT 刷新 question_ids（服务端守卫同样校验 1/2），
 *      保证打印的题与扫码批改的判题基准一致。
 * 找不到可复用的才新建。
 */
async function resolveReusableExamId(studentId, examName, wrongQuestionIds) {
  let exams = []
  let tasks = []
  try { exams = await getGeneratedExamsByStudent(studentId, false) || [] } catch { return null }
  const candidate = exams.find(e => e.name === examName && e.status !== 'graded')
  if (!candidate) return null
  try { tasks = await getTasksByStudent(studentId, false) || [] } catch { tasks = [] }
  if (tasks.some(t => t.generatedExamId === candidate.id || t.generated_exam_id === candidate.id)) return null

  const normalize = (ids) => Array.isArray(ids) ? [...ids].map(String).sort() : []
  const sameIds = normalize(candidate.question_ids).join() === normalize(wrongQuestionIds).join()
  if (sameIds) return candidate.id
  try {
    const updated = await updateGeneratedExam(candidate.id, { questionIds: wrongQuestionIds })
    return updated?.id || candidate.id
  } catch (e) {
    // 409（已批改/已被引用）等场景：放弃复用，走新建
    console.warn('[weeklyReport] 复用组卷刷新题单失败，改为新建:', e?.message || e)
    return null
  }
}

async function renderExamFullHTMLForReport(studentId, studentName, wrongQuestionIds, examName, totalCount = 0) {
  if (!wrongQuestionIds || wrongQuestionIds.length === 0) return ''

  // 1. 拉取完整题目数据
  const fullQs = await getQuestionsByIds(wrongQuestionIds, studentId)
  if (!fullQs || fullQs.length === 0) return ''

  // 2. 先拿到 exam 记录（幂等复用优先，否则新建；examId 用于二维码）
  let qrContent = undefined
  try {
    let examId = await resolveReusableExamId(studentId, examName, wrongQuestionIds)
    if (!examId) {
      const examRecord = await createGeneratedExam({
        student_id: studentId,
        name: examName,
        question_ids: wrongQuestionIds,
      })
      examId = examRecord?.id
    }
    if (examId) qrContent = 'MXG:' + examId.toUpperCase()
  } catch (e) {
    // 失败不阻塞周报生成 —— 没有二维码也能用
    console.warn('[weeklyReport] 获取组卷ID失败，将跳过二维码:', e?.message || e)
  }

  // 3. 渲染 HTML（含可选二维码）
  // embedPaperCssInBody：把 buildPaperCSS scoped 内嵌到 body，合并周报时样式随 body 保留，
  // 排版与移动端「生成试卷」（PrintPreview）完全一致
  // 标题如实标注「精选 N / 本周共 M」，让家长知道这是优先重练的一小批、其余在错题本。
  const shown = fullQs.length
  const titleSuffix = totalCount > shown
    ? `（精选 ${shown} 题 · 本周共 ${totalCount} 题）`
    : `（${shown} 题）`
  return await renderFullHTML({
    title: studentName + ' - 本周错题再测' + titleSuffix,
    studentName,
    questions: fullQs,
    showAnswers: false,
    qrContent,
    embedPaperCssInBody: true,
  })
}

/**
 * 合并诊断报告 HTML + 错题再测卷 HTML 为一份完整 HTML
 * 把 examHTML 的 body 节点追加到 diagnosisHTML 的 body 后面
 */
function mergeReportHTML(diagnosisHTML, examHTML) {
  if (!examHTML) return diagnosisHTML
  if (!diagnosisHTML) return examHTML

  // 用 DOMParser 解析两份 HTML
  const parser = new DOMParser()
  const diagDoc = parser.parseFromString(diagnosisHTML, 'text/html')
  const examDoc = parser.parseFromString(examHTML, 'text/html')

  // 把 examDoc.body 的所有子节点搬到 diagDoc.body 后面
  const examBodyChildren = Array.from(examDoc.body.childNodes)
  examBodyChildren.forEach((node) => {
    diagDoc.body.appendChild(diagDoc.importNode(node, true))
  })

  return diagDoc.documentElement.outerHTML
}

/**
 * 生成完整的周学习诊断报告（诊断 + 错题再测卷，合并为一个 PDF）
 * @param {string} studentId
 * @param {Object} options
 * @param {string} options.mode - 'week' | 'month' | 'all'
 * @param {number} options.offset - 偏移量
 * @returns {Blob} 合并后的 PDF blob
 */
/**
 * 生成完整的周学习诊断报告（按环境分流）
 *
 * 生产环境（Render 部署 / 用户线上访问）：
 *   1. 渲染诊断报告 HTML（KaTeX 公式矢量）
 *   2. 渲染错题再测卷 HTML（与错题卷主路径 100% 一致）
 *   3. 合并为一份完整 HTML
 *   4. 调 triggerCustomHTMLPrint → 弹打印框 → 用户另存为 PDF（1 个 PDF，含全部内容）
 *   5. 返回 { mode: 'print', message: '...' }
 *
 * 开发环境（localhost）：
 *   1-3 同上
 *   4. 调 exportServerPDF → 服务端 Playwright → 浏览器下载 PDF
 *   5. 返回 { mode: 'download', pdfBlob, filename }
 *
 * @param {string} studentId
 * @param {Object} options
 * @param {string} options.mode - 'week' | 'month' | 'all'
 * @param {number} options.offset - 偏移量
 * @returns {Promise<{mode: 'print'|'download', pdfBlob?: Blob, message?: string}>}
 */
export async function generateWeeklyReport(studentId, { mode = 'week', offset = 0, forceMode } = {}) {
  // 1. 获取周期统计数据
  const API_BASE = import.meta.env.VITE_API_URL || '/api'
  const resp = await fetch(`${API_BASE}/weekly-report/${studentId}?mode=${mode}&offset=${offset}`)
  if (!resp.ok) throw new Error('获取周统计数据失败')
  const reportData = await resp.json()
  if (!reportData.success) throw new Error(reportData.error || '获取周统计数据失败')

  // 空数据闸（产出物质量）：本周期没有任何批改题量 → 返回 null，交调用方提示。
  // 两端调用方（移动端 WeeklyReport / PC WeeklyReportWorkbench）都已有 `if (!result)`
  // 分支展示「该时段暂无学习数据」——以前生成器从不返 null，那条分支是死的；现在接上。
  // 避免产出一份全 0/全空、发给家长没有意义的 PDF。
  if (!reportData.stats || (reportData.stats.totalQuestions || 0) === 0) {
    return null
  }

  // 2 & 3. 并行渲染：诊断报告 + 错题再测卷（两个都要建 hidden iframe + 跑 KaTeX + 等字体，可并行）
  const studentName = reportData.student?.name || '学生'
  // 错题再测卷只取「本周最该重练」的前 RETRY_CAP 道（后端已按学科均衡 + 错误次数排序）。
  // retryTotal 保留本周可重练错题总数，用于报告里如实标注「精选 N / 本周共 M」。
  const allWrongIds = reportData.stats?.wrongQuestionIds || []
  const retryTotal = allWrongIds.length
  const wrongIds = allWrongIds.slice(0, RETRY_CAP)
  const examName = `错题再测-${dayjs().format('MMDD')}`

  const [diagnosisHTML, examHTML] = await Promise.all([
    renderDiagnosisFullHTML(reportData),
    wrongIds.length > 0
      ? renderExamFullHTMLForReport(studentId, studentName, wrongIds, examName, retryTotal)
          .catch((e) => {
            console.warn('[weeklyReport] 错题再测卷渲染失败，仅返回诊断报告:', e)
            return ''
          })
      : Promise.resolve(''),
  ])

  // 4. 合并为一份完整 HTML
  const mergedHTML = mergeReportHTML(diagnosisHTML, examHTML)

  // 5. 按环境分流
  // forceMode: 'download' 强制走服务端下载路径，用于批量生成场景
  const isProd = forceMode === 'download' ? false : detectProductionEnv()
  const studentSuffix = `${studentName}_周学习诊断报告_${dayjs().format('YYYYMMDD')}`
  const filename = `${studentSuffix}.pdf`

  // 生产/开发统一优先走服务端 Playwright 下载（不再弹浏览器打印框）
  // 将合并后的完整 HTML（含诊断报告 + 错题再测卷）POST 给后端，
  // 返回 Blob 由调用方 saveAs 触发下载。
  try {
    const result = await exportServerPDF({
      html: mergedHTML,                 // 模式 B：直接传已构造好的完整 HTML
      filename,
      title: '周学习诊断报告',
      studentName,
      questions: [],                    // 已合并到 html，传空数组避免被当成模式 A
      showAnswers: false,
      returnPdfBlob: true,              // 返回 blob，由调用方 saveAs 触发下载
    })
    return { mode: 'download', pdfBlob: result.pdfBlob, filename }
  } catch (e) {
    console.error('[weeklyReport] 服务端 PDF 渲染失败，降级到浏览器打印:', e)
    // 服务端不可用时降级到浏览器原生打印（弹打印框另存为 PDF，矢量保真）
    try {
      await triggerCustomHTMLPrint({
        html: mergedHTML,
        renderMath: false,
        title: '周学习诊断报告',
      })
      return { mode: 'print', message: '服务端 PDF 不可用，请在打印对话框中"另存为 PDF"获得完整周报（含诊断报告 + 错题再测卷）' }
    } catch (printErr) {
      console.error('[weeklyReport] 浏览器打印也失败:', printErr)
      throw printErr
    }
  }
}

/**
 * 为所有学生生成周学习诊断报告
 * @param {Object} options
 * @param {string} options.mode - 'week' | 'month' | 'all'
 * @param {number} options.offset - 偏移量
 * @param {Function} options.onProgress - 进度回调 (studentName, status)
 * @returns {Array<{student, pdfBlob, status, error?}>}
 */
export async function generateAllWeeklyReports({ mode = 'week', offset = 0, onProgress, studentIds = null } = {}) {
  const API_BASE = import.meta.env.VITE_API_URL || '/api'

  // 1. 获取所有学生的摘要
  const summaryResp = await fetch(`${API_BASE}/weekly-report?mode=${mode}&offset=${offset}`)
  if (!summaryResp.ok) throw new Error('获取学生周统计失败')
  const summaryData = await summaryResp.json()

  const results = []

  // 若指定了 studentIds，仅生成勾选的学生
  const idSet = Array.isArray(studentIds) && studentIds.length > 0 ? new Set(studentIds) : null
  const targetReports = idSet
    ? summaryData.reports.filter(r => idSet.has(r.student.id))
    : summaryData.reports

  // 串行为每个学生生成（避免浏览器内存爆炸）
  for (const report of targetReports) {
    const { student, stats } = report
    if (!stats) {
      // stats===null = 后端取数失败（不是「本周无数据」）。绝不能当作 skipped，
      // 否则老师批量生成时该生报告被静默跳过，看似「这周没作业」。
      // 先单独重试一次单学生接口（全班版失败常是并发瞬时错误）。
      onProgress?.(student.name, 'retrying')
      let ok = false
      try {
        const one = await generateWeeklyReport(student.id, { mode, offset, forceMode: 'download' })
        if (one?.pdfBlob) {
          results.push({ student, pdfBlob: one.pdfBlob, status: 'done' })
          onProgress?.(student.name, 'done')
          ok = true
        }
      } catch (err) {
        console.error(`重试生成 ${student.name} 的报告失败:`, err)
      }
      if (!ok) {
        results.push({ student, pdfBlob: null, status: 'failed', error: report.error || '取数失败' })
        onProgress?.(student.name, 'failed')
      }
      continue
    }
    if (stats.totalQuestions === 0) {
      // 真·本周无数据 → 跳过但记录
      onProgress?.(student.name, 'skipped')
      results.push({ student, pdfBlob: null, status: 'skipped' })
      continue
    }

    onProgress?.(student.name, 'generating')
    try {
      // 批量生成：永远走"开发环境"路径（即直接拿 PDF blob），
      // 因为 triggerCustomHTMLPrint 弹打印框不适合批量场景（每个学生都弹一次）
      // 批量生成是教师/管理员开发工具，不面向普通用户
      const result = await generateWeeklyReport(student.id, { mode, offset, forceMode: 'download' })
      results.push({ student, pdfBlob: result?.pdfBlob || null, status: result?.pdfBlob ? 'done' : 'failed' })
      onProgress?.(student.name, result?.pdfBlob ? 'done' : 'failed')
    } catch (err) {
      console.error(`生成 ${student.name} 的报告失败:`, err)
      results.push({ student, pdfBlob: null, status: 'failed', error: err.message })
      onProgress?.(student.name, 'failed')
    }
  }

  return results
}
