/**
 * 家长分享卡的回归锁（2026-10-04）
 *
 * 背景：工作台「家长成长卡」从 html2canvas 三数字紧凑卡升级为服务端渲染的
 * 品牌竖版分享卡（750×1334 PNG，Playwright 截图），数据与周报完全同源。
 * 旧卡是老师转发给家长的产出物（第 91 轮回归锁明确「只能搬不能删」），
 * 本次是原地升级，业务链路不变：学习诊断页输出条 → 按钮 → 家长可转发的图片。
 *
 * 本文件锁三件事：
 *   ① 模板构建器（shareCardTemplate，纯函数）的两态与空数据兜底；
 *   ② 服务端链路完整：路由已挂载、周报数据函数已导出、PNG 渲染函数已存在；
 *   ③ 隐私红线：卡片里不得出现任何指向系统的链接/二维码 —— 分享图会离开系统
 *      传播，而后端零鉴权，链接即数据库（第 94 轮负责人营销方案共识）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildShareCardHTML } from '../server/services/shareCardTemplate.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 与周报聚合接口同形状的完整 mock（四年级学生，有对比有重练） */
const FULL_REPORT = {
  student: { id: 's1', name: '陈雨桐', grade: '四年级' },
  period: { start: '2026-09-28', end: '2026-10-04', mode: 'week', offset: 0, weekNum: 40 },
  stats: {
    totalTasks: 12, completedTasks: 11,
    totalQuestions: 86, correctCount: 71, wrongCount: 15, accuracy: 82.6,
    newWrongCount: 9, masteredCount: 6, pendingCount: 11, wrongQuestionIds: []
  },
  knowledgeDiagnosis: [],
  subjectDiagnosis: [
    {
      subject: '数学', accuracy: 82.6,
      topTags: [
        { tag: '小数乘法竖式', wrongCount: 3, totalCount: 4, accuracy: 25, ratio: 20, masteryLabel: '待加强' },
        { tag: '单位换算', wrongCount: 2, totalCount: 5, accuracy: 60, ratio: 13, masteryLabel: '需关注' },
        { tag: '简便运算', wrongCount: 1, totalCount: 6, accuracy: 83.3, ratio: 7, masteryLabel: '需巩固' }
      ]
    }
  ],
  dailyTrend: [
    { date: '09-28', accuracy: 75, count: 12 },
    { date: '09-29', accuracy: null, count: 0 },
    { date: '09-30', accuracy: 80, count: 10 },
    { date: '10-01', accuracy: null, count: 0 },
    { date: '10-02', accuracy: 88, count: 18 },
    { date: '10-03', accuracy: 90, count: 22 },
    { date: '10-04', accuracy: 85, count: 24 }
  ],
  prev: {
    period: { start: '2026-09-21', end: '2026-09-27', mode: 'week', offset: 1 },
    stats: {
      totalTasks: 10, completedTasks: 9, totalQuestions: 64, correctCount: 49,
      wrongCount: 15, accuracy: 76.6, newWrongCount: 12, masteredCount: 3, pendingCount: 15
    },
    knowledgeDiagnosis: []
  },
  retryProgress: {
    examCount: 2, retriedCount: 24, correctCount: 19, wrongCount: 5,
    pendingCount: 0, retryAccuracy: 79.2, pushedToBasic: 4, masteredCnt: 3, stillNew: 2
  }
}

test('分享卡：原图态包含全名、品牌与全部数据块', () => {
  const html = buildShareCardHTML(FULL_REPORT, { maskName: false })
  assert.match(html, /陈雨桐/, '学生姓名必须出现')
  assert.ok(!html.includes('filter:blur'), '原图态不得打码')
  assert.match(html, /敏学成长中心/)
  assert.match(html, /MINXUE GROWTH CENTER/)
  assert.match(html, /让孩子的成长，看得见/)
  // 2026-10-04 第19轮改：周徽章由英文内部口径「WEEK 40」改为家长看得懂的人话。
  // 原断言只是**记录当时行为**（内部 ISO 周数），不是产品判断；下方 periodLine
  // 已另行断言日期区间，故此处改为断言"人话周期标签"，并顺带守住"不许回退成英文"。
  assert.match(html, />本周</, '周徽章应为家长看得懂的「本周」')
  assert.doesNotMatch(html, /WEEK \d+/, '家长可见的卡片不得再出现英文周数')
  assert.match(html, /82\.6%/, '正确率')
  assert.match(html, /09\/28 ~ 10\/04/, '周期线')
  assert.match(html, /<svg/, '周模式必须有趋势图')
  assert.match(html, /较上一周期/, '有上期数据必须渲染对比')
  assert.match(html, /错题重练进步/, '有重练数据必须渲染重练块')
  assert.match(html, /小数乘法竖式/, '薄弱知识点 pill')
  assert.match(html, /待加强/, '掌握标签')
  assert.match(html, /老师寄语/, '寄语块')
})

test('分享卡：转发态姓名与头像打码（blur 烘焙），其余内容不变', () => {
  const html = buildShareCardHTML(FULL_REPORT, { maskName: true })
  assert.match(html, /filter:blur\(7px\)/, '姓名必须打码')
  assert.match(html, /filter:blur\(6px\)/, '头像首字必须打码')
  // 打码是视觉处理：文字仍在 HTML 里，截图时被 blur 覆盖 —— 这是「更真实」的设计决定
  assert.match(html, /陈雨桐/)
  assert.match(html, /82\.6%/, '数据不受打码影响')
})

test('分享卡：全零学生（免费诊断首份报告）不得出现 NaN/undefined', () => {
  const html = buildShareCardHTML({
    student: { id: 's2', name: '王小明', grade: '三年级' },
    period: { start: '2026-09-28', end: '2026-10-04', mode: 'week', offset: 0, weekNum: 40 },
    stats: { totalTasks: 0, completedTasks: 0, totalQuestions: 0, correctCount: 0, wrongCount: 0, accuracy: 0, newWrongCount: 0, masteredCount: 0, pendingCount: 0 },
    subjectDiagnosis: [],
    dailyTrend: Array.from({ length: 7 }, () => ({ date: '09-28', accuracy: null, count: 0 })),
    prev: { period: {}, stats: { totalQuestions: 0 } },
    retryProgress: { examCount: 0 },
    // 2026-10-05 r133：这是一份「免费诊断首份报告」⇒ 孩子从没被批改过，
    // 必须显式声明（旧测试没这个字段，正好被新口径的「缺省=有历史」兜住，
    // 于是断言挂在这儿 —— 这不是-lock失效，是样本没把意图写清楚）。
    // ⛔ 不要为了让测试变绿而删掉这条断言：它守的是「零数据也要有寄语，不能空/NaN」，
    // 只把 hasEverGraded 写明确，判据一行未改。
    hasEverGraded: false
  }, { maskName: true })
  assert.ok(!html.includes('NaN'), '不得出现 NaN')
  assert.ok(!html.includes('undefined'), '不得出现 undefined')
  assert.match(html, /—/, '无数据时正确率显示 —')
  assert.match(html, /学习记录刚起步/, '零数据寄语兜底（新学生/免费诊断首份报告）')
  assert.match(html, /暂无薄弱知识点/, '薄弱点空态')
  assert.ok(!html.includes('较上一周期'), '上期无数据不渲染对比')
  assert.ok(!html.includes('错题重练进步'), '无重练不渲染重练块')
})

test('分享卡：月模式隐藏趋势，徽章显示月份', () => {
  const report = {
    ...FULL_REPORT,
    period: { start: '2026-09-01', end: '2026-10-01', mode: 'month', offset: 0, weekNum: null }
  }
  const html = buildShareCardHTML(report, { maskName: false })
  assert.ok(!html.includes('正确率趋势'), '月模式没有每日趋势块')
  // 2026-10-04 第19轮改：offset=0 的月模式徽章由「9月」改为「本月」（更口语）。
  // 往期月份（offset>=2）仍显示具体月份，见 test/shareCardParentCopy.test.mjs。
  assert.match(html, />本月</, '本月的月份徽章应为「本月」')
  assert.doesNotMatch(html, />\d+月</, 'offset=0 时不该显示具体月份数字')
  assert.match(html, /较上一周期/, '月模式仍渲染对比')
})

test('分享卡：文本全部逃逸，姓名含 HTML 时不得注入', () => {
  const html = buildShareCardHTML({
    ...FULL_REPORT,
    student: { id: 's3', name: '<script>alert(1)</script>', grade: '四年级' }
  }, { maskName: false })
  assert.ok(!html.includes('<script>alert'), '姓名必须被逃逸')
  assert.match(html, /&lt;script&gt;/)
})

test('分享卡：服务端链路完整（路由挂载 + 周报函数导出 + PNG 渲染函数）', () => {
  const indexSrc = read('server/index.js')
  assert.match(indexSrc, /import shareCardRouter from '\.\/routes\/shareCard\.js'/, '路由未导入')
  assert.match(indexSrc, /app\.use\('\/api\/share-card', shareCardRouter\)/, '路由未挂载')

  const weeklySrc = read('server/routes/weeklyReport.js')
  assert.match(weeklySrc, /export async function fetchStudentWeeklyReport/, '周报数据函数未导出（分享卡与其必须同源）')

  const routeSrc = read('server/routes/shareCard.js')
  assert.match(routeSrc, /fetchStudentWeeklyReport/, '路由必须走周报同源数据')
  assert.match(routeSrc, /generateShareCardPNG/)

  const rendererSrc = read('server/services/examPdfRenderer.js')
  assert.match(rendererSrc, /export async function renderHtmlPNG/, '渲染器缺 PNG 截图函数')
})

test('分享卡：隐私红线 —— 卡片内不得出现指向系统的链接或二维码内容', () => {
  for (const maskName of [false, true]) {
    const html = buildShareCardHTML(FULL_REPORT, { maskName })
    assert.ok(!html.includes('MXG:'), '不得内嵌组卷二维码内容')
    assert.ok(!/href=|\/retry-task|\/api\//.test(html), '卡片是离开系统传播的图片，后端零鉴权，任何系统链接都是数据库入口')
  }
})
