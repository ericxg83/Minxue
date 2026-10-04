/**
 * shareCardTemplate.js — 家长分享卡 HTML 模板（纯函数，无任何依赖）
 *
 * 数据源与周报完全同源（fetchStudentWeeklyReport 的返回值），
 * 视觉 token 与周报诊断报告（src/utils/weeklyReportGenerator.js 的 T/BRAND）保持一致 ——
 * 服务端无法 import 前端模块，此处等值复制，两处须同步维护。
 *
 * 两态：
 *   - 原图（maskName=false）：全名，发给家长本人。
 *   - 转发版（maskName=true）：姓名与头像首字做马赛克（CSS blur 烘焙进 PNG），
 *     比替换成「某同学」更像真实转发的成长记录。对外转发默认用这一版。
 *
 * 卡片固定 750×1334（微信聊天 9:16 视感），所有内容做逃逸与 NaN 兜底，
 * 空数据学生（免费诊断场景的第一份报告）也能完整渲染。
 */

const T = {
  primary: '#0F6B6D', primaryDark: '#0A5052', primarySoft: '#D9ECE9', primaryMist: '#EEF7F5',
  teal: '#287E7C',
  success: '#4CAF50', successSoft: '#EAF6EA',
  warning: '#A66A24', warningSoft: '#FBF4E8',
  danger: '#B85A4F', dangerSoft: '#F9ECEA',
  text: '#203836', textSec: '#60726F', textTer: '#91A09E',
  border: '#DCE6E2', borderLight: '#EAF0ED', bg: '#F6F7F5'
}

const BRAND = {
  nameCn: '敏学成长中心',
  nameEn: 'MINXUE GROWTH CENTER',
  slogan: '让孩子的成长，看得见'
}

function escapeHtml(text) {
  if (text == null) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 数字兜底：undefined/null/NaN → 0 */
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function colorForAccuracy(acc) {
  if (acc == null) return T.textTer
  return acc >= 80 ? T.success : acc >= 60 ? T.warning : T.danger
}

function masteryStyle(label) {
  switch (label) {
    case '待加强': return { bg: T.dangerSoft, color: T.danger }
    case '需关注': return { bg: T.warningSoft, color: T.warning }
    case '需巩固': return { bg: T.primaryMist, color: T.primary }
    default: return { bg: T.borderLight, color: T.textSec }
  }
}

/** 品牌 Logo Lockup（与周报 renderLogo 同一 SVG 路径） */
function renderLogo() {
  return `<div class="brand">
    <svg width="34" height="34" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="${T.primary}"/>
      <path d="M10.5 27V14.5c0-.7.86-1.04 1.35-.53L20 22l8.15-8.03c.49-.51 1.35-.17 1.35.53V27" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="20" cy="22" r="2.3" fill="${T.success}"/>
    </svg>
    <div class="brand-tx"><div class="brand-cn">${BRAND.nameCn}</div><div class="brand-en">${BRAND.nameEn}</div></div>
  </div>`
}

/** 学习寄语（依据统计自动拼装，口径同周报 buildTeacherComment，另兜底零数据） */
function buildShareComment(stats, weakestTag, periodWord) {
  if (!stats.totalQuestions) return '学习记录刚起步，先完成一次作业，成长就会被看见！'
  const parts = []
  const completeRate = stats.totalTasks > 0 ? stats.completedTasks / stats.totalTasks : 0
  if (completeRate >= 0.8) parts.push(`${periodWord}学习态度认真，作业完成情况良好`)
  else if (completeRate >= 0.4) parts.push(`${periodWord}作业完成情况尚可，仍有提升空间`)
  else parts.push(`${periodWord}作业完成率偏低，请督促孩子按时完成练习`)

  if (stats.accuracy >= 85) parts.push('整体正确率优秀，继续保持')
  else if (stats.accuracy >= 60) parts.push(`整体正确率 ${stats.accuracy}%，${weakestTag ? '「' + weakestTag + '」' : '部分知识点'}仍需加强练习`)
  else parts.push(`整体正确率 ${stats.accuracy}%，建议重点复习本周错题，夯实基础`)

  return parts.join('，') + '！'
}

/** 内联 SVG 折线趋势图（本周每日正确率，尺寸为卡片版紧凑适配） */
function renderTrendChart(dailyTrend) {
  const W = 650, H = 175
  const padL = 34, padR = 10, padT = 16, padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const n = dailyTrend.length
  const stepX = n > 1 ? innerW / (n - 1) : innerW

  const xOf = (i) => padL + i * stepX
  const yOf = (acc) => padT + innerH - (acc / 100) * innerH

  let grid = ''
  for (let v = 0; v <= 100; v += 25) {
    const y = yOf(v)
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${T.borderLight}" stroke-width="1"/>`
    grid += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${T.textTer}">${v}%</text>`
  }

  const pts = dailyTrend.map((d, i) => ({ i, acc: d.accuracy, x: xOf(i), y: d.accuracy != null ? yOf(d.accuracy) : null }))
  let segs = ''
  let prev = null
  for (const p of pts) {
    if (p.y != null) {
      if (prev) segs += `<line x1="${prev.x}" y1="${prev.y}" x2="${p.x}" y2="${p.y}" stroke="${T.primary}" stroke-width="2.5" stroke-linecap="round"/>`
      prev = p
    }
  }

  let dots = ''
  for (const p of pts) {
    if (p.y != null) {
      dots += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#fff" stroke="${T.primary}" stroke-width="2.5"/>`
    } else {
      dots += `<circle cx="${p.x}" cy="${yOf(0)}" r="2.5" fill="${T.textTer}" opacity="0.4"/>`
    }
  }

  let xlabels = ''
  for (const p of pts) {
    xlabels += `<text x="${p.x}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="${T.textSec}">${dailyTrend[p.i].date}</text>`
  }

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${grid}${segs}${dots}${xlabels}
  </svg>`
}

/** 跨学科汇总薄弱知识点（按错误次数排序取前 5，与周报 subjectDiagnosis 同源） */
function collectWeakTags(subjectDiagnosis, cap = 5) {
  const all = []
  for (const s of subjectDiagnosis || []) {
    for (const t of s.topTags || []) {
      all.push(t)
    }
  }
  return all
    .sort((a, b) => num(b.wrongCount) - num(a.wrongCount) || num(b.totalCount) - num(a.totalCount))
    .slice(0, cap)
}

/** 单个对比指标（与周报 compareItemHTML 同语义：升=好/坏按指标方向） */
function compareItem(label, cur, prev, goodWhenUp, unit = '') {
  const curText = `${num(cur)}${unit}`
  if (prev == null) {
    return { label, curText, delta: '上周无数据', cls: 'dim', prevText: '' }
  }
  const d = Math.round((num(cur) - num(prev)) * 10) / 10
  if (d === 0) {
    return { label, curText, delta: '持平', cls: 'dim', prevText: `上周 ${num(prev)}${unit}` }
  }
  const good = (d > 0) === goodWhenUp
  const sign = d > 0 ? '+' : ''
  return {
    label,
    curText,
    delta: `${sign}${d}${unit}`,
    cls: good ? 'good' : 'bad',
    prevText: `上周 ${num(prev)}${unit}`
  }
}

/**
 * 构建分享卡完整 HTML
 * @param {Object} reportData - fetchStudentWeeklyReport 的返回值（student/period/stats/subjectDiagnosis/dailyTrend/prev/retryProgress）
 * @param {Object} [opt]
 * @param {boolean} [opt.maskName=false] - true 时姓名与头像打码（转发版）
 * @returns {string} 完整 HTML（750×1334 固定尺寸）
 */
export function buildShareCardHTML(reportData, { maskName = false } = {}) {
  const {
    student: rawStudent,
    period: rawPeriod,
    stats: rawStats,
    subjectDiagnosis: rawSubjectDiagnosis,
    dailyTrend: rawDailyTrend,
    prev = null,
    retryProgress = null
  } = reportData || {}

  // ⚠️ 解构默认值**只对 undefined 生效，对 null 不生效**（JS 语义，容易踩）。
  // weeklyReport.js 的异常分支返回的是 `{ student, stats: null, error }`，
  // 于是下面 `num(stats.totalTasks)` 会抛
  // 「Cannot read properties of null (reading 'totalTasks')」，
  // 让整张分享卡渲染失败、接口回 500 —— 老师点"生成分享卡"直接报错，
  // 看起来像功能坏了，其实只是这一次取数失败。
  // 数组同理：null 之后 .map / .length 会炸。
  // 这里统一兜住，让"取不到数据"降级成"显示暂无数据"，而不是整体崩掉。
  const student = rawStudent || {}
  const period = rawPeriod || {}
  const stats = rawStats || {}
  const subjectDiagnosis = Array.isArray(rawSubjectDiagnosis) ? rawSubjectDiagnosis : []
  const dailyTrend = Array.isArray(rawDailyTrend) ? rawDailyTrend : []

  const mode = period.mode || 'week'
  const periodWord = mode === 'month' ? '本月' : '本周'
  const s = {
    totalTasks: num(stats.totalTasks),
    completedTasks: num(stats.completedTasks),
    totalQuestions: num(stats.totalQuestions),
    correctCount: num(stats.correctCount),
    wrongCount: num(stats.wrongCount),
    accuracy: num(stats.accuracy),
    newWrongCount: num(stats.newWrongCount),
    masteredCount: num(stats.masteredCount),
    pendingCount: num(stats.pendingCount)
  }

  const name = escapeHtml(student.name || '同学')
  const nameStyle = maskName ? 'filter:blur(7px);' : ''
  const avatarStyle = maskName ? 'filter:blur(6px);' : ''
  const grade = escapeHtml(student.grade || '')

  // 周期徽章与时间段
  let badge = '成长记录'
  if (mode === 'week' && period.weekNum) badge = `WEEK ${period.weekNum}`
  else if (mode === 'month') badge = `${String(period.start || '').slice(5, 7).replace(/^0/, '')}月`
  else if (mode === 'all') badge = '成长总览'
  const fmtMD = (iso) => {
    const str = String(iso || '')
    return /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(5, 10).replace('-', '/') : str
  }
  const periodLine = period.start && period.end ? `${fmtMD(period.start)} ~ ${fmtMD(period.end)}` : ''

  // 正确率圆环（无数据时灰色 —）
  const hasQuestions = s.totalQuestions > 0
  const accColor = colorForAccuracy(hasQuestions ? s.accuracy : null)
  const ringText = hasQuestions ? `${s.accuracy}%` : '—'

  // 薄弱知识点 pills
  const weakTags = collectWeakTags(subjectDiagnosis)
  const weakHtml = weakTags.length > 0
    ? weakTags.map((t) => {
        const ms = masteryStyle(t.masteryLabel)
        return `<span class="kp"><span class="kp-name">${escapeHtml(t.tag)}</span><span class="kp-wrong">错 ${num(t.wrongCount)} 次</span><span class="kp-chip" style="background:${ms.bg};color:${ms.color}">${escapeHtml(t.masteryLabel || '')}</span></span>`
      }).join('')
    : `<span class="kp-empty">${periodWord}暂无薄弱知识点，继续保持</span>`

  // 成长对比（上一周期有数据才渲染）
  const prevStats = prev && prev.stats ? prev.stats : null
  const hasCompare = mode !== 'all' && prevStats && num(prevStats.totalQuestions) > 0
  let compareHtml = ''
  if (hasCompare) {
    const items = [
      compareItem('正确率', s.accuracy, num(prevStats.accuracy), true, '%'),
      compareItem('新增错题', s.newWrongCount, num(prevStats.newWrongCount), false, ' 题'),
      compareItem('待提升错题', s.pendingCount, num(prevStats.pendingCount), false, ' 题'),
      compareItem('完成题量', s.totalQuestions, num(prevStats.totalQuestions), true, ' 题')
    ]
    compareHtml = `
    <div class="card-block">
      <div class="block-title">较上一周期</div>
      <div class="cmp-grid">
        ${items.map((it) => `
        <div class="cmp"><div class="cmp-l">${escapeHtml(it.label)}</div><div class="cmp-v">${escapeHtml(it.curText)}</div><div class="cmp-d ${it.cls}">${escapeHtml(it.delta)}</div><div class="cmp-p">${escapeHtml(it.prevText)}</div></div>`).join('')}
      </div>
    </div>`
  }

  // 重练进步（本周期有重练卷才渲染）
  let retryHtml = ''
  if (retryProgress && num(retryProgress.examCount) > 0) {
    retryHtml = `
    <div class="card-block">
      <div class="block-title">错题重练进步</div>
      <div class="retry-grid">
        <div class="rt"><div class="rt-v">${num(retryProgress.examCount)}</div><div class="rt-l">完成重练卷</div></div>
        <div class="rt"><div class="rt-v">${num(retryProgress.retriedCount)}</div><div class="rt-l">重练题目</div></div>
        <div class="rt"><div class="rt-v">${num(retryProgress.retryAccuracy)}<small>%</small></div><div class="rt-l">重练正确率</div></div>
        <div class="rt"><div class="rt-v">${num(retryProgress.pushedToBasic)}</div><div class="rt-l">推进基本掌握</div></div>
      </div>
    </div>`
  }

  // 趋势（仅周模式；整周无批改时给占位文案）
  const hasTrendData = (dailyTrend || []).some((d) => num(d.count) > 0)
  let trendHtml = ''
  if (mode === 'week') {
    trendHtml = `
    <div class="card-block">
      <div class="block-title">正确率趋势（${periodWord}）</div>
      ${hasTrendData ? renderTrendChart(dailyTrend) : `<div class="trend-empty">暂无分日批改数据</div>`}
    </div>`
  }

  // 学科正确率（月/全部模式没有每日趋势，用同源 subjectDiagnosis 的学科正确率补位）
  const subjectRows = mode !== 'week'
    ? (subjectDiagnosis || []).filter((sd) => sd && sd.accuracy != null)
    : []
  let subjectHtml = ''
  if (subjectRows.length > 0) {
    subjectHtml = `
    <div class="card-block">
      <div class="block-title">学科正确率（${periodWord}）</div>
      <div class="subj-rows">
        ${subjectRows.map((sd) => {
          const c = colorForAccuracy(sd.accuracy)
          const w = Math.max(0, Math.min(100, num(sd.accuracy)))
          return `<div class="subj-row"><span class="subj-name">${escapeHtml(sd.subject || '其他')}</span><span class="subj-track"><span class="subj-fill" style="width:${w}%;background:${c}"></span></span><b class="subj-acc" style="color:${c}">${num(sd.accuracy)}%</b></div>`
        }).join('')}
      </div>
    </div>`
  }

  const comment = buildShareComment(s, weakTags[0]?.tag || '', periodWord)

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif;color:${T.text};background:#fff}
  .card{width:750px;height:1334px;background:${T.bg};overflow:hidden;display:flex;flex-direction:column;position:relative}
  .brandbar{height:8px;background:linear-gradient(90deg,${T.primary},${T.teal});flex-shrink:0}
  /* space-between 把剩余高度均匀分到块间，保证任何数据形态都填满 1334 高度不留底部空洞 */
  .body{flex:1;display:flex;flex-direction:column;justify-content:space-between;gap:12px;padding:18px 32px 0}

  /* 页头 */
  .head{display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  .brand{display:flex;align-items:center;gap:10px}
  .brand-cn{font-size:19px;font-weight:800;color:${T.primary};letter-spacing:.5px;line-height:1.1}
  .brand-en{font-size:8px;font-weight:600;color:${T.textTer};letter-spacing:1.2px;margin-top:2px}
  .badge{display:inline-block;background:${T.primary};color:#fff;font-size:13px;font-weight:700;padding:7px 18px;border-radius:4px;letter-spacing:1.5px}

  /* 学生 hero */
  .hero{background:#fff;border:1px solid ${T.border};border-radius:10px;padding:20px 26px 18px;text-align:center}
  .st-row{display:flex;align-items:center;justify-content:center;gap:12px}
  .avatar{width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,${T.primary},${T.teal});display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .avatar span{color:#fff;font-size:26px;font-weight:700}
  .st-name{font-size:28px;font-weight:800;color:${T.text};line-height:1.2}
  .st-grade{display:inline-block;font-size:13px;color:${T.primaryDark};background:${T.primaryMist};border-radius:4px;padding:4px 12px;font-weight:500}
  .st-period{font-size:12px;color:${T.textTer};margin-top:10px}
  .hero-main{display:flex;align-items:center;gap:30px;margin-top:16px}
  .ring-wrap{display:flex;flex-direction:column;align-items:center;gap:9px;flex-shrink:0}
  .ring{width:114px;height:114px;border-radius:50%;background:conic-gradient(${accColor} ${hasQuestions ? s.accuracy * 3.6 : 0}deg, ${T.borderLight} 0);display:flex;align-items:center;justify-content:center;position:relative}
  .ring::before{content:'';position:absolute;width:83px;height:83px;border-radius:50%;background:#fff}
  .ring-t{position:relative;z-index:1;font-size:26px;font-weight:800;color:${accColor}}
  .ring-l{font-size:12px;color:${T.textSec}}
  .kpi-col{flex:1;display:flex;flex-direction:column;gap:10px}
  .kpi-row2{display:flex;gap:10px}
  .kpi{flex:1;background:${T.bg};border:1px solid ${T.borderLight};border-radius:8px;padding:12px 8px;text-align:center}
  .kpi-v{font-size:24px;font-weight:800;color:${T.primary};line-height:1.1}
  .kpi-v small{font-size:13px;font-weight:500;color:${T.textTer}}
  .kpi-l{font-size:11px;color:${T.textSec};margin-top:4px}

  /* 通用块 */
  .card-block{background:#fff;border:1px solid ${T.border};border-radius:10px;padding:15px 22px 13px}
  .block-title{font-size:15px;font-weight:700;color:${T.primary};margin-bottom:10px;display:flex;align-items:center;gap:7px}
  .block-title::before{content:'';width:3px;height:14px;border-radius:2px;background:${T.success}}

  /* 趋势 */
  .trend-empty{padding:48px 0;text-align:center;color:${T.textTer};font-size:12px}

  /* 学科正确率（月/全部模式的趋势替代块） */
  .subj-rows{display:flex;flex-direction:column;gap:12px;padding:2px 0 4px}
  .subj-row{display:flex;align-items:center;gap:12px}
  .subj-name{width:64px;flex-shrink:0;font-size:13px;font-weight:600;color:${T.text}}
  .subj-track{flex:1;height:10px;background:${T.borderLight};border-radius:5px;overflow:hidden}
  .subj-fill{display:block;height:100%;border-radius:5px}
  .subj-acc{width:54px;flex-shrink:0;text-align:right;font-size:14px;font-weight:800}

  /* 三色卡 */
  .tri-row{display:flex;gap:10px}
  .tri{flex:1;border-radius:8px;padding:13px 8px;text-align:center}
  .tri-v{font-size:25px;font-weight:800;line-height:1.1}
  .tri-v small{font-size:13px;font-weight:500}
  .tri-l{font-size:11px;margin-top:4px;font-weight:500}

  /* 对比 */
  .cmp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
  .cmp{border:1px solid ${T.borderLight};border-radius:8px;padding:10px 12px 9px;background:${T.bg}}
  .cmp-l{font-size:10.5px;color:${T.textSec}}
  .cmp-v{font-size:21px;font-weight:800;color:${T.text};line-height:1.25}
  .cmp-d{font-size:12px;font-weight:700;margin-top:3px}
  .cmp-d.good{color:${T.success}}
  .cmp-d.bad{color:${T.danger}}
  .cmp-d.dim{color:${T.textTer};font-weight:500}
  .cmp-p{font-size:10px;color:${T.textTer};margin-top:2px}

  /* 重练 */
  .retry-grid{display:flex;gap:9px}
  .rt{flex:1;background:${T.primaryMist};border:1px solid ${T.primarySoft};border-radius:8px;padding:11px 6px;text-align:center}
  .rt-v{font-size:23px;font-weight:800;color:${T.primary}}
  .rt-v small{font-size:12px;font-weight:500}
  .rt-l{font-size:10.5px;color:${T.textSec};margin-top:3px}

  /* 知识点 */
  .kp-wrap{display:flex;flex-wrap:wrap;gap:9px}
  .kp{display:inline-flex;align-items:center;gap:8px;background:${T.bg};border:1px solid ${T.borderLight};border-radius:16px;padding:8px 14px}
  .kp-name{font-size:14px;font-weight:600;color:${T.text}}
  .kp-wrong{font-size:11.5px;color:${T.textSec}}
  .kp-chip{font-size:11px;font-weight:600;padding:3px 10px;border-radius:11px}
  .kp-empty{font-size:12px;color:${T.textTer};padding:4px 0}

  /* 寄语 */
  .comment{background:${T.primary};border-radius:10px;padding:16px 20px;display:flex;gap:12px;align-items:flex-start}
  .comment-icon{flex-shrink:0;width:32px;height:32px;border-radius:50%;background:${T.success};display:flex;align-items:center;justify-content:center}
  .comment-t{font-size:12px;font-weight:700;color:${T.primarySoft};margin-bottom:4px}
  .comment-d{font-size:14px;color:#fff;line-height:1.65}

  /* 页脚 */
  .foot{flex-shrink:0;padding:14px 32px 18px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:${T.textTer};border-top:1px solid ${T.borderLight};background:${T.bg}}
</style></head><body>
  <div class="card">
    <div class="brandbar"></div>
    <div class="body">
      <div class="head">
        ${renderLogo()}
        <div class="badge">${escapeHtml(badge)}</div>
      </div>

      <div class="hero">
        <div class="st-row">
          <div class="avatar" style="${avatarStyle}"><span>${escapeHtml((student.name || '学').trim().charAt(0))}</span></div>
          <span class="st-name" style="${nameStyle}">${name}</span>
          ${grade ? `<span class="st-grade">${grade}</span>` : ''}
        </div>
        ${periodLine ? `<div class="st-period">学习周期 ${escapeHtml(periodLine)}</div>` : ''}
        <div class="hero-main">
          <div class="ring-wrap">
            <div class="ring"><div class="ring-t">${ringText}</div></div>
            <div class="ring-l">整体正确率</div>
          </div>
          <div class="kpi-col">
            <div class="kpi-row2">
              <div class="kpi"><div class="kpi-v">${s.completedTasks}<small> 次</small></div><div class="kpi-l">完成作业</div></div>
              <div class="kpi"><div class="kpi-v">${s.totalQuestions}<small> 题</small></div><div class="kpi-l">批改题量</div></div>
            </div>
            <div class="kpi-row2">
              <div class="kpi"><div class="kpi-v" style="color:${T.warning}">${s.newWrongCount}<small> 题</small></div><div class="kpi-l">新增错题</div></div>
              <div class="kpi"><div class="kpi-v" style="color:${T.success}">${s.masteredCount}<small> 题</small></div><div class="kpi-l">完全掌握</div></div>
            </div>
          </div>
        </div>
      </div>

      ${trendHtml}
      ${subjectHtml}

      <div class="tri-row">
        <div class="tri" style="background:${T.warningSoft}"><div class="tri-v" style="color:${T.warning}">${s.newWrongCount}<small> 题</small></div><div class="tri-l" style="color:${T.warning}">新增错题</div></div>
        <div class="tri" style="background:${T.successSoft}"><div class="tri-v" style="color:${T.success}">${s.masteredCount}<small> 题</small></div><div class="tri-l" style="color:${T.success}">完全掌握</div></div>
        <div class="tri" style="background:${T.primaryMist}"><div class="tri-v" style="color:${T.primary}">${s.pendingCount}<small> 题</small></div><div class="tri-l" style="color:${T.primaryDark}">待提升错题</div></div>
      </div>

      ${compareHtml}
      ${retryHtml}

      <div class="card-block">
        <div class="block-title">重点关注知识点</div>
        <div class="kp-wrap">${weakHtml}</div>
      </div>

      <div class="comment">
        <div class="comment-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4V5z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>
        <div><div class="comment-t">老师寄语</div><div class="comment-d">${escapeHtml(comment)}</div></div>
      </div>
    </div>

    <div class="foot">
      <span>${BRAND.nameCn} · ${BRAND.slogan}</span>
      <span>${escapeHtml(periodLine || badge)}</span>
    </div>
  </div>
</body></html>`
}
