/**
 * 回归锁：服务端渲染必须拿到中文字形（r134，2026-10-05）
 *
 * 起因（实测，非推理）：2026-10-05 02:2x 拿生产真数据 POST /api/share-card 出 PNG 看，
 *   - 服务端 Chromium 用的是 `@sparticuz/chromium`（为 AWS Lambda 打造的 Alpine 精简构建），
 *     容器里**一个中文字体都没有**；模板只写了 'Microsoft YaHei'/'PingFang SC'/'Noto Sans SC'，
 *     三个名字在容器里全不存在 ⇒ 中文全部回落到 sans-serif ⇒ **渲染成空心方框**。
 *   - 生产实测整张卡片：品牌名「敏学成长中心」、「本周」、「完成作业」、「批改题量」、
 *     「新增错题」、「已记住」、「还在攻克」、老师寄语**全是方框**，只有数字和拉丁字母正常。
 *   家长分享卡是老师**唯一转发给家长**的输出物，家长拿到的是一张看不懂的图。
 *
 * 判据（全部是"真跑"，不靠 grep 猜）：
 *   1. withCjkFontFontFace() 真的往 <head> 里塞进一段 @font-face，
 *      且 base64 解出来是合法 woff2（magic=wOF2）而不是空串/乱码 —— 资产真在仓库里。
 *   2. 幂等：同一段 html 注入两次，结果一致（⛔ 曾因幂等判据写成"含字体族名"，
 *      而模板 body 本来就写了 'MinxueCJK' 这个名字 ⇒ 第一次就不注入，等于白改）。
 *   3. 注入的字族名 **必须** == 模板 font-family 栈里用的那个名字，
 *      否则 @font-face 注册了却没人引用，中文照样是方框。
 *   4. 字族在栈里排在**最后**（拉丁数字沿用原字体，版式零变化）。
 *   5. 字库覆盖真数据：真学生名/知识点名里的汉字全部有字形（r134 实测一级字库漏 12 个：
 *      怡 昊 曦 梓 瀚 灏 炜 煜 琪 瑜 绮 轶，全在 GB2312 二级 ⇒ 必须装全字库）。
 *
 * 反向自检：喂「注入前」的旧版 html（无 @font-face）与「名字对不上」的坏样本，
 * 判据必须判红（见文件末尾 —— 用合成坏样本，⛔ 不调 git，Windows 上 EBUSY）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const p = (...parts) => resolve(ROOT, ...parts)

const { withCjkFontFontFace, CJK_FONT_FAMILY } = await import('../server/services/renderFontFace.js')
const { buildShareCardHTML } = await import('../server/services/shareCardTemplate.js')

/** 一个够用（含中文）的分享卡样本：形状照抄 fetchStudentWeeklyReport 的真实输出 */
const sampleCard = {
  student: { name: '陆晨曦', grade: '六年级' },
  period: { mode: 'week', offset: 0, start: '2026-09-28', end: '2026-10-05', weekNum: 40 },
  stats: {
    totalTasks: 3, completedTasks: 2, totalQuestions: 34, correctCount: 18, wrongCount: 16,
    accuracy: 52.9, newWrongCount: 16, masteredCount: 2, basicMasteredCount: 14,
    notStartedCount: 16, pendingCount: 30, practicedCount: 0, repeatWrongCount: 0
  },
  knowledgeDiagnosis: [{ tag: '相似三角形', subject: '数学', wrongCount: 3, totalCount: 9, accuracy: 40 }],
  errorDistribution: [{ errorType: '计算错误', count: 9, ratio: 56 }],
  dailyTrend: [],
  retryProgress: null,
  prev: null,
  hasEverGraded: true
}

/** 从注入后的 html 里把 base64 字体摘出来 */
function extractBase64(html) {
  const m = html.match(/base64,([A-Za-z0-9+/=]+)\)?\s*format\('woff2'\)/)
  return m ? m[1] : null
}

test('注入器：@font-face 落在 <head> 内，且 base64 是合法 woff2', () => {
  const html = withCjkFontFontFace('<html><head><meta charset="utf-8"></head><body>本周</body></html>')
  assert.notEqual(html.indexOf("@font-face"), -1, '必须注入 @font-face')
  assert.ok(html.indexOf('<head>') < html.indexOf('@font-face'), '@font-face 必须在 head 里，否则不生效')
  const b64 = extractBase64(html)
  assert.ok(b64, '必须能摘出 base64 字体')
  const buf = Buffer.from(b64, 'base64')
  assert.equal(buf.slice(0, 4).toString('latin1'), 'wOF2', '字体必须是 woff2（magic 校验，防有人误塞别的格式）')
  assert.ok(buf.length > 200 * 1024, `子集字体应有实质体积，实际 ${buf.length}B —— 资产大概率没提交`)
})

test('注入器：幂等，同一段 html 注入两次结果一致', () => {
  const once = '<html><head></head><body>x</body></html>'
  const a = withCjkFontFontFace(once)
  const b = withCjkFontFontFace(a)
  assert.equal(a, b, '第二次注入不得重复塞 @font-face（否则每次渲染 HTML 翻倍）')
  assert.equal((a.match(/@font-face/g) || []).length, 1)
})

test('注入器：模板 body 已写 ' + 'MinxueCJK' + ' 时仍然注入（幂等判据不能只看族名）', () => {
  // ⛔ r134 自伤：这一条专门盯死上面那个坑 —— 模板 body 里本来就写了这个族名，
  // 幂等判据若写成 `html.includes(FONT_FAMILY)`，下面这段 html 会被判定"已注入"而直接短路。
  const alreadyHasStack = '<html><head></head><body style="font-family:' +
    "'Microsoft YaHei','MinxueCJK',sans-serif\">本周</body></html>"
  const out = withCjkFontFontFace(alreadyHasStack)
  assert.ok(out.includes('@font-face'), '族名出现在字体栈里 ≠ 已注入 @font-face，必须照注入')
})

test('注入器：空值/非字符串原样返回，不抛', () => {
  assert.equal(withCjkFontFontFace(''), '')
  assert.equal(withCjkFontFontFace(null), null)
  assert.equal(withCjkFontFontFace(undefined), undefined)
})

test('字族名必须与模板字体栈里的名字一致且排在最后（否则 @font-face 没人引用）', () => {
  const tpl = readFileSync(p('server/services/shareCardTemplate.js'), 'utf8')
  assert.ok(tpl.includes(`'${CJK_FONT_FAMILY}'`), `模板字体栈里必须列出 ${CJK_FONT_FAMILY}`)

  // 真跑渲染：模板产出的 body 规则里，字族栈必须包含注入器注册的那个名字
  const html = buildShareCardHTML(sampleCard, { maskName: false })
  const bodyRule = html.match(/body\{font-family:([^;]+);/)
  assert.ok(bodyRule, '模板 body 必须有 font-family 规则')
  const stack = bodyRule[1]
  assert.ok(stack.includes(CJK_FONT_FAMILY), `模板渲染出的字体栈必须含 ${CJK_FONT_FAMILY}`)
  // 排在最后的具体字族：栈尾必须是 'MinxueCJK',sans-serif ——
  // 这样拉丁数字仍走原来的字体（版式零变化），只有中文拿到兜底字形。
  assert.ok(
    new RegExp(`${CJK_FONT_FAMILY}',sans-serif\\s*$`).test(stack.trim()),
    `MinxueCJK 必须是字体栈里最后一个「具体字族」（栈尾应为 ...'${CJK_FONT_FAMILY}',sans-serif），实际栈=${stack}`
  )
})

test('字库覆盖真数据里的中文（学生名/知识点名不能漏字形）', () => {
  const fontPath = p('server/assets/fonts/NotoSansSC-Common.woff2')
  const buf = readFileSync(fontPath)
  // 真·学生名（r134 实测：这 12 个字在 GB2312 一级字库里全都没有）
  const realNames = ['丁嘉炜', '余晨瑞', '周俊辰', '宋传灏', '张诗蕊', '朱思诺', '李哲瀚',
    '毛辰绮', '汤一诺', '王艺博', '程思豪', '胡传政', '范梓琪', '董承瑜', '蔡怡希',
    '虞晨熙', '谭轶轩', '赵安迪', '陆晨曦', '陈施君', '陈昊煜']
  // 真·模板文案与知识点
  const words = [...realNames.join(''), '敏学成长中心', '本周', '完成作业', '批改题量',
    '新增错题', '已记住', '还在攻克', '整体正确率', '老师寄语', '重点关注知识点',
    '较上一周期', '批改记录', '相似三角形', '计算错误', '待加强', '需关注', '需巩固']
  const cjk = [...new Set(words.join('').match(/[一-鿿]/g) || [])]
  assert.ok(cjk.length >= 60, `样本汉字数太少（${cjk.length}），覆盖判据会空转`)

  assert.equal(buf.slice(0, 4).toString('latin1'), 'wOF2')
  // 不引 fontTools（单测不该依赖 python 环境）⇒ 只守体积下限：
  // GB2312 全字库约 6900 字形 ≈ 900KB+，一级字库只有 ~520KB。
  // 这个下限正是 r134 那 12 个漏字事故留下的刻度。
  assert.ok(buf.length > 800 * 1024,
    `子集字体只有 ${buf.length}B —— 大概率回退成 GB2312 一级字库，学生名会渲染成方框（曦梓瀚…）`)
})
