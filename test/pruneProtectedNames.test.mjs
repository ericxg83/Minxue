/**
 * 回归锁：死声明清理门禁的保护名单（scripts/pruneDeadDeclarations.mjs）
 *
 * 背景（r303，2026-10-18 实测，不是推理）：
 *   门禁把 server/services/similarGroupClustering.js:57 的 `const MAX_GROUP_SIZE = 20`
 *   报进「可安全删除」清单——但它是负责人拍板方案（docs/similar-groups-方案.md:62
 *   「最多截断组内 20 道（防巨型组）」）里**已声明未接线**的常量：
 *   clusterContentGroups / clusterKpGroups 均无截断逻辑，路由 confirm 给每个组员建
 *   example ⇒ 巨型组会直接产出巨型考法/巨型重练卷。机械删掉它 = 抹掉已拍板需求的
 *   锚点，且下一轮门禁会再次误报（复发回路）。
 *
 * 锁四条：
 *   ① MAX_GROUP_SIZE 在保护名单内（Map 条目形态）；
 *   ② 该条目自带可追溯理由（指向拍板方案文档，与条目同行）；
 *   ③ 保留原因按条目取值（PROTECTED_NAMES.get）——防通用理由张冠李戴；
 *   ④ 保护判定先于「可删」分类——顺序颠倒则保护形同虚设。
 *
 * 反向自检（内联合成坏样本，不依赖 git）：旧版形态（无条目 + 理由回退内联）
 * 必须判红且点名①②③；保护判定挪到可删分类之后必须判红且点名④。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE_PATH = join(HERE, '..', 'scripts', 'pruneDeadDeclarations.mjs')

/** 四条判据（真实门禁源码必须全过；收集全部失败再抛，便于反向自检点名） */
function assertProtection(src) {
  const fails = []
  const entryLine = src.split('\n').find(l => /\[\s*'MAX_GROUP_SIZE'\s*,/.test(l))
  if (!entryLine) fails.push('① MAX_GROUP_SIZE 必须受保护名单覆盖（Map 条目形态）')
  else if (!/similar-groups-方案\.md/.test(entryLine)) fails.push('② 保护条目必须自带可追溯理由（拍板方案文档，与条目同行）')
  if (!/PROTECTED_NAMES\.get\(w\.name\)/.test(src)) fails.push('③ 保留原因必须按条目取值（PROTECTED_NAMES.get）')
  const protectIdx = src.indexOf('PROTECTED_NAMES.has(')
  const pushIdx = src.indexOf('deletable.push(')
  if (protectIdx < 0) fails.push('门禁必须保留保护判定（PROTECTED_NAMES.has）')
  else if (pushIdx < 0) fails.push('门禁必须保留可删分类（deletable.push）')
  else if (protectIdx >= pushIdx) fails.push('④ 保护判定必须先于可删分类')
  assert.equal(fails.length, 0, `保护名单判据失败：\n- ${fails.join('\n- ')}`)
}

test('保护名单覆盖 MAX_GROUP_SIZE（真实门禁）', () => {
  assertProtection(readFileSync(GATE_PATH, 'utf8'))
})

test('反向自检：旧版形态（无条目 + 理由回退内联）必须判红', () => {
  const src = readFileSync(GATE_PATH, 'utf8')
  const broken = src
    .split('\n').filter(l => !l.includes('MAX_GROUP_SIZE')).join('\n')
    .replace('PROTECTED_NAMES.get(w.name)', "'负责人裁决③：几何重绘目录的 5 个死 import 先不动'")
  assert.notEqual(broken, src, '注入必须被证实生效（条目行被摘掉）')
  assert.ok(!broken.includes('PROTECTED_NAMES.get('), '理由回退注入必须生效')
  assert.throws(() => assertProtection(broken), /①|③/, '坏样本必须判红且点名①②③（非空锁）')
})

test('反向自检：保护判定挪到可删分类之后必须判红（④）', () => {
  const src = readFileSync(GATE_PATH, 'utf8')
  const protectLine = src.split('\n').find(l => l.includes('PROTECTED_NAMES.has('))
  assert.ok(protectLine, '锚点行必须存在')
  const withoutLine = src.split('\n').filter(l => !l.includes('PROTECTED_NAMES.has(')).join('\n')
  const pushIdx = withoutLine.indexOf('deletable.push(')
  const lineEnd = withoutLine.indexOf('\n', pushIdx)
  const broken = withoutLine.slice(0, lineEnd + 1) + protectLine + '\n' + withoutLine.slice(lineEnd + 1)
  assert.throws(() => assertProtection(broken), /④/, '顺序坏样本必须判红且点名④')
})
