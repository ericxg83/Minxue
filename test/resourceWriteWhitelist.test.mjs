/**
 * 回归锁（2026-10-04）：`PUT /api/resources/:id` 不得把请求体里的**任意 key** 当列名写进库。
 *
 * 缺陷：`updateResource(id, updates)` 会把传入对象的 key 直接当列名拼进 SQL
 * （`setClauses.push(`${col} = $n`)`），而这条路由原先把 `req.body` 原样转发 ——
 * 前端一个笔误（或恶意键名）就能改到 `id` / `created_at` / `answer_count` 这类不该动的列；
 * 键名里带 `,` 或 `= (SELECT …)` 还能拼出额外 SQL（值是参数化的，列名不是）。
 *
 * 修法：路由改用白名单 `pickWritableResourceFields()` 过滤，未知字段忽略但打日志。
 * 反向自检：本文件导出 collectFailures()，套在修复前的源码上必须判红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pickWritableResourceFields } from '../server/routes/resources.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'server/routes/resources.js'), 'utf8')

/** 供反向自检复用：只做源码级检查（旧版里这个函数还不存在） */
export function collectFailures(src = SRC) {
  const fails = []
  if (!/export function pickWritableResourceFields\(/.test(src)) {
    fails.push('缺少白名单函数 pickWritableResourceFields')
  }
  if (!/updateResource\(req\.params\.id,\s*patch\)/.test(src)) {
    fails.push('PUT /:id 未使用白名单过滤后的 patch，仍在转发原始 req.body')
  }
  if (/updateResource\(req\.params\.id,\s*req\.body\)/.test(src)) {
    fails.push('仍存在 updateResource(id, req.body) 的裸转发')
  }
  return fails
}

test('契约：PUT /:id 必须经白名单过滤，不得裸转发 req.body', () => {
  const fails = collectFailures()
  assert.deepEqual(fails, [], fails.join('；'))
})

test('白名单：业务字段放行', () => {
  const out = pickWritableResourceFields({
    name: '九上期中卷', status: 'published', subject: '数学',
    grade: '初三', examDate: '2026-11-01', answerStatus: 'teacher_verified',
  })
  assert.deepEqual(out, {
    name: '九上期中卷', status: 'published', subject: '数学',
    grade: '初三', examDate: '2026-11-01', answerStatus: 'teacher_verified',
  })
})

test('白名单：身份列 / 审计列 / 统计列一律拦下', () => {
  const out = pickWritableResourceFields({
    name: 'ok',
    id: 'ffffffff-0000-0000-0000-000000000000',
    created_at: '1970-01-01',
    updated_at: '1970-01-01',
    answer_count: 999,
  })
  assert.deepEqual(out, { name: 'ok' })
})

test('白名单：畸形键名（尝试拼 SQL）一律拦下', () => {
  const out = pickWritableResourceFields({
    'name = (SELECT 1), name': 'x',
    'a, b': 1,
  })
  assert.deepEqual(out, {})
})

test('白名单：空体/undefined 不炸', () => {
  assert.deepEqual(pickWritableResourceFields(undefined), {})
  assert.deepEqual(pickWritableResourceFields({}), {})
})
