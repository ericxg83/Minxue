/**
 * 构造式 DSL 通道（阶段 2）——对外唯一入口。
 *
 * 设计目标（来自用户诉求"让 latex 画图真正用上"）：
 *   原来的做法是「视觉模型看图 → 目测像素坐标 → 渲染」。目测这一步是主要误差源，
 *   而且错了没法自查。GeoBuildBench（ooongs/GeoBuildBench, MIT）给了另一条路：
 *   模型只声明**构造命令**，坐标由执行器算。
 *
 * 本模块把那条路接到我们既有的管线上：
 *
 *   DSL 文本 ──executeDsl──▶ 结构 ──normalizeStructure──▶ 既有下游
 *                                                        （内容闸门 → 渲染器）
 *
 * 因此**不需要改任何既有模块**：内容闸门、渲染器、告警链路都原样复用。
 * 与函数图象通道（server/utils/functionGraph）一样，属于"确定性通道"——
 * 坐标是算出来的，不再需要约束求解器去纠偏。
 *
 * 注意与 GeoBuildBench 的关系：**只借鉴设计，不引入其代码**。
 * 命令表是我们自己按它的 prompt 语义重写的 Node 实现（见 commands.js 的偏离说明）。
 */

import { executeDsl } from './executor.js'
import { normalizeStructure } from '../structure.js'
import { commandReference } from './commands.js'

/**
 * 把 DSL 文本编译成项目结构。
 * @param {string} dsl
 * @param {object} [options]
 * @returns {{ok:boolean, structure:object|null, errors:object[], stats:object, labels:string[]}}
 */
export function buildStructureFromDsl(dsl, options = {}) {
  const r = executeDsl(dsl, options)
  if (!r.ok) return { ...r, structure: null }
  return { ...r, structure: normalizeStructure(r.structure) }
}

export { executeDsl } from './executor.js'
export { parseDsl } from './parser.js'
export { evalExpr } from './expr.js'
export { COMMANDS, commandNames, hasCommand, commandReference } from './commands.js'
export { renderDslToSvg, rasterizeSvg, composeComparison, toDataUrl } from './render.js'
export { correctDslByVision, buildDslPrompts, parseDslReply } from './reactLoop.js'
