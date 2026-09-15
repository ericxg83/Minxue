import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pickAnswerUnit, extractUniqueLessonCode } from '../server/worker.js'

const ROOT = resolve(import.meta.dirname, '..')
const WORKER_SRC = readFileSync(resolve(ROOT, 'server/worker.js'), 'utf8')

/**
 * 练习册答案单元匹配：新增的「正文小标题（section_title）」锚点。
 *
 * 事故背景：练习册页眉印的是全书通用的书名跑马灯（"新闵学校"成长·桥"练习 第01周"），
 * OCR 提示词要求 page_title 只读页眉 → 该值对不上任何 unit → 整页答案挂空。
 * 实测 3 份卷 32 题全部 pending，占老师被强制逐题点击的 70%。
 *
 * 设计约束：section_title 只在通过「与某个 unit 的 title/key 可互相包含」这一自检时才顶替
 * pageTitle，否则完全不改 pageTitle —— 拿不准就退化成改动前的行为，不放宽任何判据。
 */

const mkUnit = (unitKey, unitTitle) => {
  const qmap = new Map()
  for (const n of [1, 2, 3]) {
    qmap.set(`Q${n}`, {
      unit_key: unitKey,
      unit_title: unitTitle,
      answer: `${unitKey}-${n}`,
      question_no: n,
    })
  }
  return new Map([['s1', qmap]])
}

const twoUnits = () => new Map([
  ['27.2(2)', mkUnit('27.2(2)', '27.2（2）二次函数的图像与性质（2）')],
  ['27.4(2)', mkUnit('27.4(2)', '27.4（2）二次函数与一元二次方程（2）')],
])

// 题干刻意不含课时号，避免 lesson_code 通道抢先命中，隔离本次改动
const questions = [{ question_number: 1, content: '抛物线的开口方向与顶点坐标', student_answer: 'A' }]

const HEADER = '新闵学校“成长·桥”练习 第01周'
const SECTION = '27.4（2）二次函数与一元二次方程（2）'

test('页眉只读到书名时，正文小标题能把单元定位出来', () => {
  const abu = twoUnits()
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, null),
    null,
    '只有页眉书名时应定位不到单元（复现事故现场）')
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, SECTION),
    '27.4(2)',
    '给了正文小标题后应能定位到正确单元')
})

test('正文小标题不可信时不采用，结果与完全不传它一致', () => {
  const abu = twoUnits()
  const baseline = pickAnswerUnit(abu, HEADER, questions, 1, null, null)
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '一、选择题'), baseline)
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '数学'), baseline)
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, ''), baseline)
})

test('页眉本身就是课时小标题时仍按原路径匹配（回归）', () => {
  const abu = twoUnits()
  assert.equal(pickAnswerUnit(abu, SECTION, questions, 1, null, null), '27.4(2)')
})

test('正文小标题与页眉一致时不改变结果', () => {
  const abu = twoUnits()
  const a = pickAnswerUnit(abu, SECTION, questions, 1, null, null)
  const b = pickAnswerUnit(abu, SECTION, questions, 1, null, SECTION)
  assert.equal(b, a)
})

test('单单元练习册直接返回该单元（不受新参数影响）', () => {
  const abu = new Map([['only', mkUnit('only', '27.4（2）二次函数与一元二次方程（2）')]])
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null), 'only')
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, SECTION), 'only')
})

// ─────────────────────────────────────────────────────────────
// 编号严格通道：实测该页 OCR 读出的正是下面这种"编号与副标题矛盾"的小标题。
// 答案库：27.3(1)＝已知图像上【三点】、27.3(2)＝已知图像上【两点】。
// OCR 输出："27.3（2）已知图像上三点求二次函数的表达式"（编号 (2) + 副标题"三点"）。
// 整串模糊匹配必在 (1)/(2) 之间打平 → 放弃，因此必须让编号当硬锚点。
// 实测（真实页图 + 真实答案库单元清单）：改动前 null → 改动后 27.3(2)。
// ─────────────────────────────────────────────────────────────
const contradictionUnits = () => new Map([
  ['27.3(1)', mkUnit('27.3(1)', '27.3(1)已知图像上三点求二次函数的表达式')],
  ['27.3(2)', mkUnit('27.3(2)', '27.3(2)已知图像上两点求二次函数的表达式')],
])

test('小标题的课时编号与副标题矛盾时，以编号为准定位', () => {
  const abu = contradictionUnits()
  // 编号 (2) + 副标题"三点"（属 (1)）→ 模糊匹配会打平，编号唯一决定归属
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, '27.3（2）已知图像上三点求二次函数的表达式'),
    '27.3(2)')
  // 编号 (1) + 副标题"三点"（自洽）→ 同样以编号为准
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, '27.3（1）已知图像上三点求二次函数的表达式'),
    '27.3(1)')
  // 全角/半角括号都要能归一
  assert.equal(
    pickAnswerUnit(abu, HEADER, questions, 1, null, '27.3(2)已知图像上两点求二次函数的表达式'),
    '27.3(2)')
})

test('编号在答案库里不存在时不得乱命中', () => {
  const abu = contradictionUnits()
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '99.9（1）不存在的课时小标题'), null)
  // 只给章节号（无小节号），库里是 27.3(1)/(2)，不得含糊命中
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '第27章 二次函数'), null)
})

// ─────────────────────────────────────────────────────────────
// 整页课时编号硬锚定（2026-09-15 事故）
//
// 事故现场：一份九年级"成长·桥"周练卷，页眉第一行是全书通用书名跑马灯
// （"新闵学校"成长·桥"练习 第01周"），第二行才印着真正的课时标题
// （"27.3（2）已知图像上三点求二次函数的表达式"）。
// 系统锚到 27.2(2) / 27.4(2) 等完全无关的单元 → 按题号取答案全部张冠李戴
// → 一份卷 10 道题判错、且"把对的判成错、把错的判成对"同时发生。
//
// 真凶（务必记住）：workbookPrompt 当时【根本没有 section_title 字段】，
// `parsed.section_title` 恒为 undefined → 上面那套 section_title 通道在 workbook 管线上
// 从未生效。所以本组测试有两条线：
//   ① 行为线：只要课时编号在本页任何文本里出现过（含 OCR 原始响应），就能锚定；
//   ② 防复发线：提示词必须声明这些字段、调用点必须透传 OCR 原文。
// ─────────────────────────────────────────────────────────────

test('页眉只有书名时，OCR 原始响应里的课时编号能把单元兜回来', () => {
  const abu = contradictionUnits()
  // 不传原文 → 复现事故现场：定位不到
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null, null), null)
  // 传原文（模型这次调用读到的整页文本）→ 命中正确单元
  const raw = `{"page_title":"${HEADER}","section_title":null,"questions":[{"question_number":1,"content":"1.抛物线的形状、开口方向与 y=1/2x²-4x+3 相同"}]}`
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null, raw), null,
    '原文里没有课时号时不应无中生有')

  const rawWithCode = `{"page_title":"${HEADER}","lesson_code":"27.3(2)","questions":[...]}`
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null, rawWithCode), '27.3(2)')

  // 真实形态：编号印在正文第二行大标题里，整串出现在响应中
  const rawSecondLine = `{"page_title":"${HEADER}","section_title":"27.3（2）已知图像上三点求二次函数的表达式"}`
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null, rawSecondLine), '27.3(2)')
})

test('模型输出的 lesson_code 字段（独立字段）同样被采用', () => {
  const abu = contradictionUnits()
  const qs = [{ question_number: 1, content: '抛物线的开口方向', student_answer: 'A', _lesson_code: '27.3(2)' }]
  assert.equal(pickAnswerUnit(abu, HEADER, qs, 1, null, null, null), '27.3(2)')
})

test('课时号与序号分离的标题也要能锚定（"27.2 二次函数的图像与性质 (2)"）', () => {
  // 实测（2026-09-15 李哲瀚 27.2(2) 卷重跑）：OCR 给出的 section_title 就是这个形态，
  // 编号 27.2 与序号 (2) 之间隔着标题文字。只扫连续编号会得到 "27.2"，
  // 对不上答案库的 unit_key "27.2(2)" → 整页锚定失败、7 题全部落成"待人工"。
  const abu = new Map([
    ['27.2(2)', mkUnit('27.2(2)', '27.2(2)形如y=ax²+b的二次函数的图像与性质')],
    ['27.2(4)', mkUnit('27.2(4)', '27.2(4)形如y=a(x+m)²+h的二次函数的图像与性质')],
  ])
  const qs = [{ question_number: 1, content: '函数 y=-x²+3 与 y=-x²-2 的图像的不同之处是', student_answer: 'A' }]
  assert.equal(
    pickAnswerUnit(abu, HEADER, qs, 1, null, '27.2 二次函数的图像与性质 (2)', null),
    '27.2(2)', '分离形态的编号必须被组合回 27.2(2)')
  assert.equal(
    pickAnswerUnit(abu, HEADER, qs, 1, null, '27.2 二次函数的图像与性质 (4)', null),
    '27.2(4)')
  // 分离形态出现在 OCR 原文里同样要能用
  assert.equal(
    pickAnswerUnit(abu, HEADER, qs, 1, null, null, '{"section_title":"27.2 二次函数的图像与性质 (2)"}'),
    '27.2(2)')
})

test('整页出现多个课时编号时不锚定 —— 宁可落回原级联，也不赌', () => {
  const abu = contradictionUnits()
  const raw = '27.3（1）已知图像上三点求二次函数的表达式 … 27.3（2）已知图像上两点求二次函数的表达式'
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null, raw), null,
    '本页跨课时时应放弃硬锚定')
  // 两个不同章节的编号同样放弃
  const abu3 = new Map([
    ['27.3(2)', mkUnit('27.3(2)', '27.3(2)已知图像上两点求二次函数的表达式')],
    ['28.2(4)', mkUnit('28.2(4)', '28.2(4)二次函数y=a(x+m)²+k')],
  ])
  assert.equal(pickAnswerUnit(abu3, HEADER, questions, 1, null, null, '27.3(2) 与 28.2(4)'), null)
})

test('题干里的普通小数不会被误当成课时编号', () => {
  const abu = contradictionUnits() // 库里只有 27.3(1) / 27.3(2)
  const raw = '{"questions":[{"content":"1.5×10³ 与 3.14 的大小关系"},{"content":"x=0.4 时 y=2.5"}]}'
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null, raw), null)
})

test('编号不在答案库里时不得乱命中（内容特征不得硬凑）', () => {
  const abu = contradictionUnits()
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null, '本题出自 30.1 的拓展'), null)
})

test('不传第 7 参数时，行为与改动前逐字节一致（向后兼容）', () => {
  const abu = contradictionUnits()
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, '27.3（2）已知图像上三点求二次函数的表达式'), '27.3(2)')
  assert.equal(pickAnswerUnit(abu, HEADER, questions, 1, null, null), null)
  assert.equal(pickAnswerUnit(abu, SECTION, questions, 1, null, null), null)
})

test('extractUniqueLessonCode：唯一才返回，0 个/多个都返回 null', () => {
  const valid = new Set(['27.3(2)', '19.1(1)'])
  assert.equal(extractUniqueLessonCode(['27.3（2）已知图像上三点…'], valid), '27.3(2)')
  assert.equal(extractUniqueLessonCode(['27.3(2)', '见 27.3（2）页'], valid), '27.3(2)', '同号重复出现仍算唯一')
  assert.equal(extractUniqueLessonCode(['27.3(2) … 19.1(1)'], valid), null, '多个不同编号 → null')
  assert.equal(extractUniqueLessonCode(['1.5 与 3.14'], valid), null, '不在答案库里的小数被过滤掉')
  assert.equal(extractUniqueLessonCode([null, undefined, '', 42], valid), null)
})

// ── 防复发：本次事故的根因是提示词漏字段，必须锁死 ──

test('workbookPrompt 必须声明 section_title 与 lesson_code 字段', () => {
  const start = WORKER_SRC.indexOf('const workbookPrompt =')
  assert.ok(start > 0, '找不到 workbookPrompt')
  const end = WORKER_SRC.indexOf('只返回 JSON，不要其他文字', start)
  assert.ok(end > start, '找不到 workbookPrompt 结尾标记')
  const seg = WORKER_SRC.slice(start, end)
  assert.match(seg, /"section_title"\s*:/,
    'workbookPrompt 必须要求模型输出 section_title —— 2026-09-15 事故正是因为它缺失，' +
    '导致 pickAnswerUnit 的 section_title 通道在 workbook 管线上从未生效')
  assert.match(seg, /"lesson_code"\s*:/,
    'workbookPrompt 必须要求模型输出 lesson_code（课时编号本身），它是本页唯一的硬锚点')
  assert.match(seg, /lesson_code[\s\S]{0,400}任何位置/,
    '必须明确告知模型：课时编号可能出现在页面任何位置，不要只读页眉')
})

test('workbookPrompt 必须交代"页眉两行"的排版（第一行书名 / 第二行课时）', () => {
  const start = WORKER_SRC.indexOf('const workbookPrompt =')
  const seg = WORKER_SRC.slice(start, WORKER_SRC.indexOf('只返回 JSON，不要其他文字', start))
  assert.match(seg, /两行/, '必须点明页眉两行的排版，否则模型会把书名当唯一标题')
  assert.match(seg, /跑马灯/, '必须点名"书名跑马灯"这个坑')
})

test('pickAnswerUnit 的调用点必须把 OCR 原始响应透传下去', () => {
  const calls = [...WORKER_SRC.matchAll(/pickAnswerUnit\(([^)]*)\)/g)]
    .filter(m => m[1].includes('answersByUnit,'))
  assert.ok(calls.length >= 1, '应至少有一处 pickAnswerUnit 调用')
  for (const c of calls) {
    assert.ok(/rawOcrText/.test(c[1]),
      `pickAnswerUnit 调用必须透传 rawOcrText（OCR 原始响应），实际参数：${c[1].trim()}`)
  }
})

test('两处 OCR 解析都要读取 lesson_code，并在 pageDataList 里带 rawOcrText', () => {
  const pushCount = [...WORKER_SRC.matchAll(/rawOcrText:\s*content/g)].length
  assert.ok(pushCount >= 2, `pageDataList 与 pageDataListRetry 都要带 rawOcrText，实际 ${pushCount} 处`)
  const parseCount = [...WORKER_SRC.matchAll(/parsed\.lesson_code/g)].length
  assert.ok(parseCount >= 2, `两处解析都要读 parsed.lesson_code，实际 ${parseCount} 处`)
})
