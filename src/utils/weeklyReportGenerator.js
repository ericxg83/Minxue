import { createGeneratedExam, getQuestionsByIds } from '../services/apiService'
import { triggerCustomHTMLPrint } from './browserPrint'
import { renderFullHTML, exportServerPDF, getKatexCssWithInlineFonts } from './serverPdfExporter'
import { detectProductionEnv } from './wrongBookPdfExporter'
import { buildPaperCSS, renderMathInContainer, preloadKatexFonts } from './pdfGenerator'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

const A4_W = 210
const A4_H = 297

/**
 * 设计 token（PDF HTML 无法引用 CSS 变量，写死等值 hex）
 * 对齐「敏学成长中心」品牌视觉：靛蓝→紫渐变主色、蓝紫强调、清爽留白
 */
const T = {
  primary: '#6366F1', primaryDark: '#4F46E5', primarySoft: '#E0E7FF', primaryMist: '#EEF2FF',
  teal: '#A78BFA', tealSoft: '#F5F3FF',
  success: '#16A34A', successSoft: '#DCFCE7',
  warning: '#D97706', warningSoft: '#FEF3C7',
  danger: '#F0564D', dangerSoft: '#FDECEC',
  accent: '#7C3AED', accentSoft: '#EDE9FE',
  purple: '#8B5CF6', purpleSoft: '#F5F3FF',
  text: '#1E293B', textSec: '#64748B', textTer: '#9AA6B8',
  border: '#E7EDF5', borderLight: '#F1F5FB', bg: '#F6F9FE'
}

/** 品牌信息（统一维护，便于替换） */
const BRAND = {
  nameCn: '敏学成长中心',
  nameEn: 'MINXUE GROWTH CENTER',
  slogan: '用数据记录学习，用训练帮助成长'
}

/**
 * 品牌 Logo Lockup：渐变「M」标 + 中英文字号
 * @param {Object} opt
 * @param {boolean} opt.compact - 内页紧凑版（较小字号）
 */
function renderLogo({ compact = false } = {}) {
  const mark = `<svg class="brand-mark" width="${compact ? 30 : 40}" height="${compact ? 30 : 40}" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mxg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop stop-color="${T.primary}"/><stop offset="1" stop-color="${T.teal}"/>
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#mxg)"/>
    <path d="M11 28V13.5c0-.6.75-.9 1.16-.45L20 21l7.84-7.95c.41-.45 1.16-.16 1.16.45V28" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
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
    return '本周暂无明显薄弱知识点，建议保持练习节奏，适当拓展提高题型。'
  }
  const tips = subjectDiagnosis.slice(0, 2).map(s => {
    const top = s.topTags && s.topTags[0]
    if (top) return `${s.subject}重点加强「${top.tag}」类型题训练`
    return `${s.subject}保持巩固练习`
  })
  return `建议周末${tips.join('，')}；多做变式练习，及时复盘错题，提升举一反三能力。`
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
function buildDiagnosisHTML(reportData) {
  const { student, period, stats, subjectDiagnosis = [], dailyTrend = [] } = reportData
  const mode = period.mode || 'week'
  const weekNum = period.weekNum || (mode === 'week' ? dayjs(period.start).isoWeek() : null)
  const badgeLabel = mode === 'month'
    ? dayjs(period.start).format('M月')
    : mode === 'all' ? 'ALL' : `WEEK ${weekNum}`
  const accColor = colorForAccuracy(stats.accuracy)

  // 最薄弱知识点（跨学科 wrongCount 最高）
  let weakestTag = ''
  for (const s of subjectDiagnosis) {
    if (s.topTags && s.topTags[0]) { weakestTag = s.topTags[0].tag; break }
  }

  const teacherComment = buildTeacherComment(stats, weakestTag)
  const teacherAdvice = buildTeacherAdvice(subjectDiagnosis)

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
        <thead><tr><th style="width:40%">知识点</th><th>错误次数</th><th>占比</th><th>掌握情况</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }).join('') : `<div class="empty-state"><div class="empty-icon" style="font-size:32px;margin-bottom:8px">--</div><div>本周暂无薄弱知识点</div><div class="empty-sub" style="font-size:13px;color:${T.textTer};margin-top:6px">AI 将持续识别学习中的薄弱环节</div></div>`

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

  /* 寄语卡 */
  .comment{background:${T.primaryMist};border:1px solid ${T.primarySoft};border-radius:14px;padding:18px 20px;display:flex;gap:12px;align-items:flex-start}
  .comment-icon{flex-shrink:0;width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,${T.primary},${T.teal});display:flex;align-items:center;justify-content:center}
  .comment-t{font-size:13px;font-weight:700;color:${T.text};margin-bottom:5px}
  .comment-d{font-size:13px;color:${T.textSec};line-height:1.7}

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
  .kt-table td{padding:11px 12px;border-bottom:1px solid ${T.borderLight};color:${T.text}}
  .kt-table tr:last-child td{border-bottom:none}
  .kt-tag{font-weight:500}
  .kt-tag-wrap{display:flex;align-items:center;gap:10px}
  .kt-ic{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
  .kt-c{text-align:center}
  .mastery{display:inline-block;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:600}

  .advice{background:${T.accentSoft};border:1px solid #FCD9B6;border-radius:16px;padding:18px 22px;margin-top:6px;display:flex;gap:13px;align-items:flex-start}
  .advice-icon{flex-shrink:0;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,${T.accent},#FBB040);display:flex;align-items:center;justify-content:center}
  .advice-t{font-size:14px;font-weight:800;color:${T.accent};margin-bottom:6px}
  .advice-d{font-size:13px;color:#9A4A10;line-height:1.8}

  .empty-state{text-align:center;padding:80px 40px;color:${T.textTer}}
  .empty-icon{font-size:52px;margin-bottom:14px}
  .empty-sub{margin-top:8px;font-size:12px}
</style></head><body>

  <!-- ═══ 封面页 ═══ -->
  <div class="page">
    <div class="cover">
      <div class="cover-top">
        ${logoFull}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">每周学习报告</div></div>
      </div>
      <div class="cover-body">
        <div class="cover-title">成长诊断报告</div>
        <div class="cover-sub">${BRAND.slogan}</div>
        ${renderAvatar(student)}
        <div class="cover-name">${escapeHtml(student.name)}<span class="tag">同学</span></div>
        <div class="class-badge">${escapeHtml(student.grade || '')}</div>
        <div class="period-line">学习周期：${period.start} ~ ${period.end}</div>
        <div class="values">
          <div class="value-item"><div class="value-icon">${VALUE_ICONS.find}</div><div class="value-t">发现问题</div><div class="value-d">精准定位学习薄弱点</div></div>
          <div class="value-item"><div class="value-icon">${VALUE_ICONS.train}</div><div class="value-t">针对训练</div><div class="value-d">错题重练强化提升</div></div>
          <div class="value-item"><div class="value-icon">${VALUE_ICONS.grow}</div><div class="value-t">持续进步</div><div class="value-d">每周追踪看得见</div></div>
        </div>
        <div class="slogan">每一次努力，都是成长的脚印！</div>
      </div>
      <div class="wave">${waveSvg}</div>
    </div>
  </div>

  <!-- ═══ 概览页 ═══ -->
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${logoSm}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">每周学习报告</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">01</span>本周学习概览</div>
      <div class="sec-sub">整体表现速览</div>

      <div class="sub-label">核心数据</div>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-v">${stats.completedTasks}<span class="u">次</span></div><div class="kpi-l">完成作业</div></div>
        <div class="kpi"><div class="kpi-v">${stats.totalQuestions}<span class="u">题</span></div><div class="kpi-l">AI 批改题量</div></div>
        <div class="kpi ring-kpi">
          <div class="ring"><div class="ring-t">${stats.accuracy}%</div></div>
          <div class="ring-side"><div class="rl">整体正确率</div><div class="rv">${stats.correctCount}/${stats.totalQuestions} 题</div></div>
        </div>
      </div>

      <div class="tri-row">
        <div class="tri" style="background:${T.warningSoft};border-color:#FDE68A"><div class="tri-v" style="color:${T.warning}">${stats.newWrongCount}<span style="font-size:14px"> 题</span></div><div class="tri-l" style="color:#92400E">新增错题</div></div>
        <div class="tri" style="background:${T.successSoft};border-color:#BBF7D0"><div class="tri-v" style="color:${T.success}">${stats.masteredCount}<span style="font-size:14px"> 题</span></div><div class="tri-l" style="color:#166534">已掌握错题</div></div>
        <div class="tri" style="background:${T.primaryMist};border-color:${T.primarySoft}"><div class="tri-v" style="color:${T.primary}">${stats.pendingCount}<span style="font-size:14px"> 题</span></div><div class="tri-l" style="color:${T.primaryDark}">待提升错题</div></div>
      </div>

      <div class="sub-label">正确率趋势（本周）</div>
      <div class="chart-card">${renderTrendChart(dailyTrend.length ? dailyTrend : [])}</div>

      <div class="comment">
        <div class="comment-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4V5z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>
        <div><div class="comment-t">学习寄语</div><div class="comment-d">${escapeHtml(teacherComment)}</div></div>
      </div>
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- 02 -</span></div>
  </div>

  ${subjectDiagnosis.length > 0 ? `
  <!-- ═══ 学科诊断页 ═══ -->
  <div class="page">
    <div class="pad">
      <div class="ph">
        ${logoSm}
        <div class="ph-right"><div class="week-badge">${badgeLabel}</div><div class="ph-cap">每周学习报告</div></div>
      </div>
      <div class="sec-title"><span class="sec-num">02</span>学科诊断分析</div>
      <div class="sec-sub">薄弱知识点 TOP 5</div>

      ${subjectCards}

      <div class="advice">
        <div class="advice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10c.7.7 1 1.4 1 2h6c0-.6.3-1.3 1-2a6 6 0 00-4-10z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg></div>
        <div><div class="advice-t">学习建议</div><div class="advice-d">${escapeHtml(teacherAdvice)}</div></div>
      </div>
    </div>
    <div class="pf"><span>${BRAND.nameCn} · ${BRAND.slogan}</span><span>- 03 -</span></div>
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
async function renderExamFullHTMLForReport(studentId, studentName, wrongQuestionIds, examName) {
  if (!wrongQuestionIds || wrongQuestionIds.length === 0) return ''

  // 1. 拉取完整题目数据
  const fullQs = await getQuestionsByIds(wrongQuestionIds, studentId)
  if (!fullQs || fullQs.length === 0) return ''

  // 2. 先尝试创建 exam 记录（拿 examId 用于二维码）
  let qrContent = undefined
  try {
    const examRecord = await createGeneratedExam({
      student_id: studentId,
      name: examName,
      question_ids: wrongQuestionIds,
    })
    if (examRecord?.id) qrContent = 'MXG:' + examRecord.id.toUpperCase()
  } catch (e) {
    // 失败不阻塞周报生成 —— 没有二维码也能用
    console.warn('[weeklyReport] createGeneratedExam 失败，将跳过二维码:', e?.message || e)
  }

  // 3. 渲染 HTML（含可选二维码）
  return await renderFullHTML({
    title: studentName + ' - 本周错题再测',
    studentName,
    questions: fullQs,
    showAnswers: false,
    qrContent,
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

  // 2 & 3. 并行渲染：诊断报告 + 错题再测卷（两个都要建 hidden iframe + 跑 KaTeX + 等字体，可并行）
  const studentName = reportData.student?.name || '学生'
  const wrongIds = reportData.stats?.wrongQuestionIds || []
  const examName = `错题再测-${dayjs().format('MMDD')}`

  const [diagnosisHTML, examHTML] = await Promise.all([
    renderDiagnosisFullHTML(reportData),
    wrongIds.length > 0
      ? renderExamFullHTMLForReport(studentId, studentName, wrongIds, examName)
          .catch((e) => {
            console.warn('[weeklyReport] 错题再测卷渲染失败，仅返回诊断报告:', e)
            return ''
          })
      : Promise.resolve(''),
  ])

  // 4. 合并为一份完整 HTML
  const mergedHTML = mergeReportHTML(diagnosisHTML, examHTML)

  // 5. 按环境分流
  // forceMode: 'download' 强制走开发路径（直接拿 blob），用于批量生成场景
  const isProd = forceMode === 'download' ? false : detectProductionEnv()
  const studentSuffix = `${studentName}_周学习诊断报告_${dayjs().format('YYYYMMDD')}`
  const filename = `${studentSuffix}.pdf`

  if (isProd) {
    // 生产：浏览器原生打印（弹打印框另存为 PDF，矢量保真）
    try {
      await triggerCustomHTMLPrint({
        html: mergedHTML,
        renderMath: false,  // 已经在 iframe 里渲染过 KaTeX
        title: '周学习诊断报告',
      })
      return { mode: 'print', message: '请在打印对话框中"另存为 PDF"获得完整周报（含诊断报告 + 错题再测卷）' }
    } catch (e) {
      console.error('[weeklyReport] 浏览器打印失败:', e)
      throw e
    }
  } else {
    // 开发：服务端 Playwright（矢量 PDF 直接下载）
    // 把合并后的完整 HTML（含诊断报告 + 错题再测卷）直接 POST 给后端，
    // 返回 Blob 给调用方由前端 saveAs，避免「下载了 PDF 但再测卷走打印框」的分离问题。
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
    if (!stats || stats.totalQuestions === 0) {
      // 本周无数据 → 跳过但记录
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