/**
 * 回归锁（2026-10-04）：`POST /api/variants/:id/generate-all` 不得把**已存在的策略**重复入库。
 *
 * 缺陷：`variant_questions` 表上**没有** `(source_question_id, strategy)` 唯一约束
 * （线上实测只有 pkey(id) 与三个普通索引），而 `generate-all` 虽然算出了 `missing`，
 * 却仍调用 `generateVariantsForQuestion(question, kpName)` 让它把 AI 返回的**全部 4 种策略**
 * 都 INSERT 一遍 —— 于是「部分策略已存在」时（例如上次 AI 只解析出 3 种），再点一次
 * 就会把已有策略**重复插一行**，前端变式列表出现重复项。
 *
 * 修法（两处，缺一不可）：
 *   ① 路由把 `missing` 作为第三个参数传下去；
 *   ② 服务按白名单过滤，不在名单里的策略直接跳过、不入库。
 *
 * 反向自检：本文件导出 collectFailures()，套在修复前版本上必须判红
 * （见 tmp 里的一次性自检脚本，不 spawnSync git —— Windows 上会 EBUSY）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
export const ROUTE_SRC = fs.readFileSync(path.join(ROOT, 'server/routes/variants.js'), 'utf8')
export const SERVICE_SRC = fs.readFileSync(path.join(ROOT, 'server/services/variantService.js'), 'utf8')

/** 收集失败项（供反向自检复用：同一批判据套在旧版上应全部命中） */
export function collectFailures(routeSrc = ROUTE_SRC, serviceSrc = SERVICE_SRC) {
  const fails = []

  // ① 路由：generate-all 必须把 missing 传下去（不能只算不用）
  if (!/generateVariantsForQuestion\(\s*question\s*,\s*kpName\s*,\s*missing\s*\)/.test(routeSrc)) {
    fails.push('路由未把 missing 作为第三参数传给 generateVariantsForQuestion')
  }
  // ② 服务：必须按白名单过滤（不在名单里就跳过）
  if (!/allow\s*&&\s*!allow\.has\(v\.strategy\)/.test(serviceSrc)) {
    fails.push('服务未按 onlyStrategies 白名单过滤，已有策略会被重复 INSERT')
  }
  // ③ 服务：签名必须收第三个参数
  if (!/generateVariantsForQuestion\(\s*question\s*,\s*kpName\s*=\s*null\s*,\s*onlyStrategies\s*=\s*null\s*\)/.test(serviceSrc)) {
    fails.push('generateVariantsForQuestion 签名缺 onlyStrategies 参数')
  }
  return fails
}

test('契约：generate-all 只补缺失策略，不得重复入库已有策略', () => {
  const fails = collectFailures()
  assert.deepEqual(fails, [], fails.join('；'))
})

test('契约：白名单为空数组/null 时行为与旧版一致（全保存，不误伤）', () => {
  // 空数组/未传 ⇒ allow 为 null ⇒ 不过滤。这是「默认行为不变」的保证。
  assert.ok(
    /Array\.isArray\(onlyStrategies\)\s*&&\s*onlyStrategies\.length\s*\?\s*new Set\(onlyStrategies\)\s*:\s*null/.test(SERVICE_SRC),
    'onlyStrategies 为空时应退化为 null（不过滤）'
  )
})
