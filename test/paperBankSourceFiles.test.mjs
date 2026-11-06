/**
 * 试卷题库「上传原件可点击 + OCR 题干可就地校对」回归锁（2026-11-06）
 *
 * 事故背景：2026 上海嘉定一模 23(2) 卷面是「BC · CF = AC · DF」，OCR 写成
 *   「BC · CF = AC² - DE²」；老师想对照自己上传的原卷 PDF 却没有入口，
 *   且旧的答案上传会覆盖 resources.pdf_url（题目原卷指针），照片上传根本没留原件。
 *
 * 本文件锁死四条：
 *   ① 题目原件与答案原件分开留档，答案上传不得覆盖 pdf_url；
 *   ② 列表接口字段名 question_files / answer_files 与前端逐字对齐，老卷用 pdf_url 兜底；
 *   ③ 前端卷级 + 题级都有可点入口，PDF 跳到本题页码；
 *   ④ 题干/公共题干可在界面上改（后端真的支持写），且保存时不得整体覆盖有效答案。
 *
 * 全部静态锁走 fail-closed，并配反向自检（写坏的版本必须判红）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

const ROUTES = 'server/routes/paperBank.js'
const SERVICE = 'server/services/paperBankService.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'

/** 去掉 JS/HTML 注释，避免「注释里提到某写法」被误判成真的写了。 */
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** 两个上传路由各自的代码体（按 router.post 边界切，别把答案分支混进题目分支）。 */
const answerRouteBody = (s) => {
  const a = s.indexOf("router.post('/papers/:id/parse-answers'")
  const b = s.indexOf("router.post('/papers/:id/parse'", a)
  return a < 0 || b < 0 ? '' : s.slice(a, b)
}
const questionsRouteBody = (s) => {
  const a = s.indexOf("router.post('/papers/:id/parse'")
  const b = s.indexOf("router.get('/papers/:id/questions'", a)
  return a < 0 || b < 0 ? '' : s.slice(a, b)
}

/** @returns {string[]} 违规列表，空数组 = 通过 */
function checkSourceFiles(src) {
  const bad = []
  const s = stripComments(src)
  const ans = answerRouteBody(s)
  const qst = questionsRouteBody(s)
  if (!ans || !qst) return ['找不到 parse / parse-answers 两个上传路由体']

  // ① pdf_url 是题目原卷（worksheets 视图也在读），答案册绝不能覆盖它
  if (/UPDATE\s+resources\s+SET\s+pdf_url/i.test(ans)) bad.push('答案上传仍在覆盖 pdf_url（老师点原卷会打开答案册）')
  if (!/saveSourceFiles\(resourceId,\s*'answers',\s*answerFiles\)/.test(ans)) bad.push('答案原件未留档')
  if (!/saveSourceFiles\(resourceId,\s*'questions',\s*questionFiles\)/.test(qst)) bad.push('题目原件未留档')
  // 照片上传也必须留原件（以前只有 PDF 留过）
  if (!/archiveUploads\(pdf\s*\?\s*\[pdf\]\s*:\s*images/.test(ans)) bad.push('答案照片未留档')
  if (!/archiveUploads\(pdf\s*\?\s*\[pdf\]\s*:\s*images/.test(qst)) bad.push('题目照片未留档')

  // ② 列表接口 + 老卷兼容
  if (!/question_files:\s*normalizeSourceFiles\(src\.questions,\s*r\.pdf_url\)/.test(s)) {
    bad.push('列表接口未提供 question_files，或丢了对老卷 pdf_url 的兼容')
  }
  if (!/answer_files:\s*normalizeSourceFiles\(src\.answers,\s*null\)/.test(s)) {
    bad.push('列表接口未提供 answer_files')
  }
  return bad
}

function checkView(src) {
  const bad = []
  const s = stripComments(src)
  if (!/\bp\.question_files\b/.test(s)) bad.push('卷级未读 p.question_files')
  if (!/\bp\.answer_files\b/.test(s)) bad.push('卷级未读 p.answer_files')
  if (!/:href="questionSourceUrl\(q\)"/.test(s)) bad.push('题目行缺少「看原卷」入口')
  if (!/#page=\$\{q\.page_no\}/.test(s)) bad.push('单份 PDF 没有按本题页码 #page= 跳转')
  if (!/\bsaveText\(q\)/.test(s)) bad.push('缺少题干保存入口')
  // 保存后整体覆盖 updated 会把「有效答案（官方答案册）」清成题目自带答案
  if (/Object\.assign\(q,\s*updated,\s*patch\)/.test(s)) bad.push('整体覆盖 updated 会清空参考答案显示')
  return bad
}

function checkService(src) {
  const bad = []
  const s = stripComments(src)
  if (!/if \('parent_stem' in patch\) put\('parent_stem', patch\.parent_stem\)/.test(s)) {
    bad.push('公共题干不可写（前端会静默丢字段）')
  }
  if (!/逐字照抄/.test(s)) bad.push('缺少 OCR 等式逐字照抄约束（AC·DF 被读成 AC²-DE² 会复发）')
  if (!/rq\.page_no/.test(s)) bad.push('题目读取缺 page_no，题级「看原卷」无法跳页')
  return bad
}

test('★ 上传题目/答案原件分别留档，答案不覆盖题目原卷 pdf_url', () => {
  assert.deepEqual(checkSourceFiles(read(ROUTES)), [], ROUTES)
})

test('★ 前端卷级 + 题级都有原卷入口，且保存不污染有效答案', () => {
  assert.deepEqual(checkView(read(VIEW)), [], VIEW)
})

test('★ 题干/公共题干可写、OCR 等式逐字照抄、题目带页码', () => {
  assert.deepEqual(checkService(read(SERVICE)), [], SERVICE)
})

test('★ 前后端字段名逐字对齐（question_files / answer_files）', () => {
  const r = stripComments(read(ROUTES))
  const v = stripComments(read(VIEW))
  for (const f of ['question_files', 'answer_files']) {
    assert.ok(r.includes(`${f}:`), `后端 papers 接口须返回 ${f}`)
    assert.ok(v.includes(`p.${f}`), `前端须读 p.${f}`)
  }
})

test('反向自检：写坏的版本喂给同一检查函数必须判红', () => {
  const routes = read(ROUTES)
  const view = read(VIEW)
  const service = read(SERVICE)

  // 答案分支重新覆盖 pdf_url
  const overwrite = routes.replace(
    "await saveSourceFiles(resourceId, 'answers', answerFiles)",
    "await query(`UPDATE resources SET pdf_url = $2 WHERE id = $1`, [resourceId, 'x'])"
  )
  assert.ok(checkSourceFiles(overwrite).length > 0, '答案覆盖 pdf_url 必须判红')

  // 列表接口改字段名（前端还读旧名 ⇒ 恒空的入口且不报错）
  const renamed = routes.replace('question_files: normalizeSourceFiles', 'questionFiles: normalizeSourceFiles')
  assert.ok(checkSourceFiles(renamed).length > 0, '字段名不一致必须判红')

  // 前端丢掉题级入口 / 整体覆盖 updated
  assert.ok(checkView(view.replace(':href="questionSourceUrl(q)"', ':href="q.image_url"')).length > 0)
  assert.ok(checkView(view.replace('for (const k of [', 'Object.assign(q, updated, patch); for (const k of [')).length > 0)

  // 后端不写 parent_stem（前端传了也静默丢弃）
  const noStem = service.replace("if ('parent_stem' in patch) put('parent_stem', patch.parent_stem)", '')
  assert.ok(checkService(noStem).length > 0)
})
