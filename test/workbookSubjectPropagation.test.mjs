import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (file) => readFileSync(resolve(ROOT, file), 'utf8')

const WORKER = read('server/worker.js')
const INDEX = read('server/index.js')
const PAGE_SERVICE = read('server/services/worksheetPageService.js')

const from = (source, marker) => {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `未找到源码标记: ${marker}`)
  return source.slice(start)
}

test('workbook 批改以练习册资源 subject 为权威并自愈空 tasks.subject', () => {
  const fn = from(WORKER, 'export const processWorkbookGrading')
  assert.match(fn, /r\.subject AS resource_subject/)
  assert.match(fn, /r\.resource_type = 'worksheet'/)
  assert.match(fn, /normalizeSubject\(subjectRows\[0\]\?\.resource_subject\)/)
  assert.match(fn, /UPDATE \$\{TABLES\.TASKS\}[\s\S]*BTRIM\(subject\) = ''/)
})

test('workbook 题目和错题本必须写入同一 subject', () => {
  const fn = from(WORKER, 'export const processWorkbookGrading')
  const questionWrite = fn.indexOf('subject: workbookSubject || q.subject || null')
  const wrongWrite = fn.indexOf('subject: workbookSubject || wq.subject || null')
  assert.ok(questionWrite > 0, 'questions 写入必须传播 workbookSubject')
  assert.ok(wrongWrite > questionWrite, 'wrong_questions 写入必须传播同一 workbookSubject')
  assert.notEqual(fn.indexOf('subject: null', wrongWrite - 200), wrongWrite - 200, '不得恢复 subject: null')
})

test('上传和重试 job 都携带 subject 作为 worker 兜底', () => {
  const uploadJob = from(INDEX, 'const jobData = {')
  assert.match(uploadJob.slice(0, 600), /subject: subject \|\| null/)
  // retryTaskById 的 queue.add 是「process-task' 第二处内联对象（第一处是 create-by-url，
  // 该路径没有 worksheet/subject 概念），用 task.worksheet_id 字段锚定 retry 路径。
  const retryJob = from(INDEX, "taskType: task.task_type || null,")
  assert.match(retryJob.slice(0, 700), /subject: task\.subject \|\| null/)
})

test('手动单页重批改同步 questions.subject 和 wrong_questions.subject', () => {
  assert.match(PAGE_SERVICE, /COALESCE\(NULLIF\(BTRIM\(r\.subject\), ''\), NULLIF\(BTRIM\(t\.subject\), ''\)\) AS subject/)
  assert.match(PAGE_SERVICE, /subject = COALESCE\(NULLIF\(BTRIM\(\$4\), ''\), subject\)/)
  assert.match(PAGE_SERVICE, /question_type, answer_type, subject, status/)
  assert.match(PAGE_SERVICE, /syncWrongQuestions\(taskId, studentId, worksheetId, pageNumber, subject, changes\)/)
  assert.match(PAGE_SERVICE, /UPDATE wrong_questions[\s\S]*?BTRIM\(w\.subject\) = ''/)
})
