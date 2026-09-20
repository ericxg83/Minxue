/**
 * DSL 执行器：把命令序列算成一堆几何对象，再导出成**项目现有的结构格式**。
 *
 * 这是阶段 2 的核心：模型不再目测像素坐标，而是声明构造（`point` / `midpoint` /
 * `intersect` / `mirror` …），坐标由这里确定性算出来。算错的概率远低于目测，
 * 而且**错法可枚举**（未定义引用、类型不符、交点个数不符），
 * 正好交给 ReAct 循环去修。
 *
 * 导出的结构直接喂给既有下游（内容闸门 → 渲染器），
 * 所以这一路不需要改任何既有模块——见 index.js 的 buildStructureFromDsl。
 *
 * 纪律：
 *   - 一个 label 只能定义一次（重复定义直接报错，不覆盖）。
 *   - 引用未定义对象直接报错，**不猜**（模型常把顺序写错，这必须让它自己修）。
 *   - 输入类型不符直接报错，并列出该命令接受的类型。
 */

import { parseDsl } from './parser.js'
import { evalExpr, parseFunctionExpr } from './expr.js'
import { COMMANDS, hasCommand, commandNames } from './commands.js'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** 把命令表的 inputs 规格展开成「每位的可接受类型集合」 */
function slotsOf(spec, n) {
  const slots = []
  for (let i = 0; i < n; i++) {
    const s = spec[i]
    if (s == null) slots.push(null) // variadic 的第 4+ 位沿用最后一位的类型
    else slots.push(Array.isArray(s) ? s : [s])
  }
  return slots
}

/**
 * 执行 DSL。
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxObjects] 对象数上限（防模型刷屏）
 * @returns {{
 *   ok:boolean, structure:object|null,
 *   errors:{line:number, raw:string, message:string, hint?:string}[],
 *   stats:{commands:number, points:number, segments:number, circles:number, curves:number, derived:number},
 *   labels:string[]
 * }}
 */
export function executeDsl(text, options = {}) {
  const maxObjects = options.maxObjects || 400
  const { commands, errors } = parseDsl(text)

  // ── 多元素合并容错（2026-09-19，M5 实测驱动） ──
  // 模型常把多条命令合并成一行（如 `point : 0 0 100 100 -> X Y` 本应是两条 point）。
  // 这类写法语义**确定**（输入个数恰为规格的整数倍、输出名 1:1 对应），不是"猜"，
  // 拆成多条等价命令顺序执行即可，与 registerSegAliases 的无向别名一样属于宽容。
  // 只对「输入组大小固定 + 每组恰好 1 个输出」的命令生效；
  // intersect（输出个数随交点不定）与 polygon/shade（本来就变参）不参与，保持原报错语义。
  const SPLITTABLE = new Set([
    'point', 'segment', 'line', 'ray', 'midpoint', 'foot',
    'circle', 'rotate', 'mirror', 'line_bisector', 'angular_bisector',
    'orthogonal_line', 'parallel_line'
  ])
  const expanded = []
  for (const c of commands) {
    const def = COMMANDS[c.cmd]
    const minArgs = def?.inputs?.length || 0
    const perOutput = def?.outputs === 'any' ? 1 : def?.outputs || 1
    const splittable = def && SPLITTABLE.has(c.cmd) && minArgs > 0
      && c.inputs.length > minArgs && c.inputs.length % minArgs === 0
    if (splittable) {
      const groups = c.inputs.length / minArgs
      if (c.outputs.length === groups * perOutput) {
        for (let g = 0; g < groups; g++) {
          expanded.push({
            line: c.line, cmd: c.cmd, raw: c.raw,
            inputs: c.inputs.slice(g * minArgs, (g + 1) * minArgs),
            outputs: c.outputs.slice(g * perOutput, (g + 1) * perOutput),
          })
        }
        continue
      }
    }
    expanded.push(c)
  }

  // 单一对象注册表：点/线段/直线/射线/圆/圆弧/多边形/标记/文字**全部**按 label 登记，
  // 否则 `mirror : B AC` / `intersect : l c` 这类引用会误报 UNDEFINED_ELEMENT。
  // 导出结构时再按 kind 分派（见 toStructure）。
  const objects = new Map()
  const order = []            // 定义顺序（调试用）
  const edgeKeys = new Set()  // 多边形自动边的去重键

  // ── 无向对象的方向别名 ──
  // 线段/直线是无向的：`segment : C A -> CA` 与 `segment : A C -> AC` 是同一条。
  // 模型两种写法都会出现（题干写 "AC"、它自己写 "CA"），不做别名就会报
  // UNDEFINED_ELEMENT，白白浪费一轮 ReAct。射线是有向的，**不加别名**。
  const aliases = new Map()   // 别名 → 正名
  // 端点对 → 对象 label：用于幂等合并（同一条边声明两次不报错、不画两遍）
  const segByKey = new Map()  // 'A|B' → label

  const fail = (line, raw, message, hint) => errors.push({ line, raw, message, hint })

  const lookup = (tok) => {
    if (objects.has(tok)) return objects.get(tok)
    const canon = aliases.get(tok)
    return canon != null ? objects.get(canon) : undefined
  }
  const taken = (tok) => objects.has(tok) || aliases.has(tok)

  /** 注册无向对象的双向别名（a+b 与 b+a 都指向它） */
  const registerSegAliases = (label, a, b) => {
    for (const nm of [`${a}${b}`, `${b}${a}`]) {
      if (nm !== label && !taken(nm)) aliases.set(nm, label)
    }
    segByKey.set([a, b].sort().join('|'), label)
  }

  /** 解析单个参数 token → 已求值的对象或数值 */
  const resolveArg = (tok, line, raw, cmd) => {
    // 引号 token → 字符串字面量。kind 用 'str'（不是 'text'）以免和
    // "文字标注对象" 的 kind:'text' 撞名。
    if (/^".*"$/.test(tok)) return { kind: 'str', value: tok.slice(1, -1) }
    const found = lookup(tok)
    if (found) return found
    const v = evalExpr(tok)
    if (v != null) return v
    fail(line, raw, `UNDEFINED_ELEMENT:${tok}`,
      hasCommand(cmd)
        ? `对象 ${tok} 尚未定义，或它不是一个能求值的算式（表达式里不能有空格）`
        : `未知命令 ${cmd}`)
    return null
  }

  const ctx = {
    point: (label) => {
      const o = objects.get(label)
      return o && o.kind === 'p' ? o : null
    },
    /** 多边形边界边也要登记成线段：既保证渲染出边框，也让内容闸门看得到这些边 */
    registerPolygonEdges: (labelsList) => {
      for (let i = 0; i < labelsList.length; i++) {
        const a = labelsList[i]
        const b = labelsList[(i + 1) % labelsList.length]
        const key = [a, b].sort().join('|')
        if (edgeKeys.has(key)) continue
        edgeKeys.add(key)
        const label = `s_${a}${b}`
        if (!objects.has(label)) {
          objects.set(label, { kind: 's', label, a, b, implicit: true })
          registerSegAliases(label, a, b)
        }
      }
    }
  }

  for (const c of expanded) {
    const def = COMMANDS[c.cmd]
    if (!def) {
      fail(c.line, c.raw, `UNKNOWN_COMMAND:${c.cmd}`, `可用命令：${commandNames().join(' ')}`)
      continue
    }
    if (objects.size > maxObjects) {
      fail(c.line, c.raw, 'TOO_MANY_OBJECTS', `对象数超过上限 ${maxObjects}`)
      break
    }

    // 参数个数：variadic 命令允许 ≥ inputs.length
    const minArgs = def.inputs.length
    if (def.variadic) {
      if (c.inputs.length < minArgs) {
        fail(c.line, c.raw, 'TOO_FEW_INPUTS', `${c.cmd} 至少需要 ${minArgs} 个输入`)
        continue
      }
    } else if (c.inputs.length !== minArgs) {
      fail(c.line, c.raw, 'ARG_COUNT_MISMATCH',
        `${c.cmd} 需要 ${minArgs} 个输入，实际给了 ${c.inputs.length}。用法：${def.help || ''}`)
      continue
    }
    if (def.outputs !== 'any' && c.outputs.length !== def.outputs) {
      fail(c.line, c.raw, 'OUTPUT_COUNT_MISMATCH',
        `${c.cmd} 需要 ${def.outputs} 个输出，实际给了 ${c.outputs.length}`)
      continue
    }

    // 解析参数。**按槽位规格解析**：`f`（函数表达式）槽位不做数值求值，
    // 而是保留源码交给命令自己代入 x 采样——否则 `x^2-2x-3` 会被当成
    // "未定义元素" 报错（表达式里不认对象名，是 expr.js 的既定纪律）。
    // 这样也保证其它槽位的行为逐字不变：只有 curve 的第 1 个参数走这条路。
    const slots = slotsOf(def.inputs, c.inputs.length)
    const args = []
    let argErr = false
    for (let i = 0; i < c.inputs.length; i++) {
      const tok = c.inputs[i]
      const allowed = slots[i] || slots[slots.length - 1]
      if (allowed && allowed.length === 1 && allowed[0] === 'f') {
        const fn = parseFunctionExpr(tok)
        if (!fn) {
          fail(c.line, c.raw, 'BAD_FUNCTION_EXPR',
            `${tok} 不是含变量 x 的函数表达式。表达式里**只能出现变量 x**，系数必须先按题干算成数字`
            + `（不能写 a*x^2+b*x 这种把 a、b 当变量的式子——它们求不出值就没法画）。`
            + `正确写法如 curve : x^2-2*x-3 -1 4 -> k1`)
          argErr = true
          break
        }
        args.push(fn)
        continue
      }
      const v = resolveArg(tok, c.line, c.raw, c.cmd)
      if (v == null) { argErr = true; break }
      args.push(v)
    }
    if (argErr) continue

    // 类型检查（variadic 的超出部分沿用最后一位规格）
    let typeErr = null
    args.forEach((v, i) => {
      const allowed = slots[i] || slots[slots.length - 1]
      if (!allowed) return
      const t = typeof v === 'number' ? 'n' : v.kind
      if (!allowed.includes(t)) {
        typeErr = `ARG_TYPE_MISMATCH@${i + 1}:期望 ${allowed.join('|')}，实际 ${t}`
      }
    })
    if (typeErr) {
      fail(c.line, c.raw, typeErr, def.help || '')
      continue
    }

    let outs
    try {
      outs = def.run(args, ctx, c.outputs)
    } catch (e) {
      fail(c.line, c.raw, `EXEC_ERROR:${e.message}`)
      continue
    }
    if (outs && !Array.isArray(outs) && outs.error) {
      fail(c.line, c.raw, outs.error, outs.hint)
      continue
    }
    if (!Array.isArray(outs)) { fail(c.line, c.raw, 'EXEC_NO_OUTPUT'); continue }

    for (const o of outs) {
      if (!o || !o.label) {
        fail(c.line, c.raw, 'EXEC_NO_OUTPUT')
        continue
      }
      // 无向对象**幂等合并**：同一条边用反方向再声明一次（`segment : B A -> BA`），
      // 不报错也不画两遍——只把输出名登记成别名。这是宽容不是放任：
      // 图是完全相同的，让模型为这种冗余多跑一轮 ReAct 没有意义。
      if ((o.kind === 's' || o.kind === 'l') && o.a && o.b) {
        const existing = segByKey.get([o.a, o.b].sort().join('|'))
        if (existing) {
          if (!taken(o.label)) aliases.set(o.label, existing)
          continue
        }
      }
      if (taken(o.label)) {
        fail(c.line, c.raw, `DUPLICATE_LABEL:${o.label}`, '每个 label 只能定义一次')
        continue
      }
      objects.set(o.label, o)
      order.push(o.label)
      if ((o.kind === 's' || o.kind === 'l') && o.a && o.b) {
        registerSegAliases(o.label, o.a, o.b)
      }
    }
  }

  // 有语法/语义错误就不产出结构——让 ReAct 循环先修，绝不半成品入库。
  const ok = errors.length === 0
  const structure = ok ? toStructure(objects) : null

  const all = [...objects.values()]
  return {
    ok,
    structure,
    errors,
    stats: {
      commands: commands.length,
      points: all.filter(o => o.kind === 'p').length,
      segments: all.filter(o => o.kind === 's').length,
      circles: all.filter(o => o.kind === 'c').length,
      curves: all.filter(o => o.kind === 'k').length,
      derived: all.filter(o => o.kind === 'p' && o.derived).length
    },
    labels: order
  }
}

/**
 * 导出成项目结构格式（normalizeStructure 的输入形态）。
 * 只输出**画得出来**的东西：直线/射线是构造辅助对象，渲染器没有无限直线图元，
 * 所以不进 segments（它们只在求交时起作用，见 commands.js 的说明）。
 */
export function toStructure(objects) {
  const all = [...objects.values()]
  const pts = all.filter(o => o.kind === 'p')
  const circles = all.filter(o => o.kind === 'c')

  // 线段按「无序端点对」去重：多边形会自动登记边界边，模型又常按 prompt 要求
  // 显式写一遍 `segment : A B -> AB`，不去重就会画两遍同样的线。
  const seenSeg = new Set()
  const segments = []
  for (const s of all.filter(o => o.kind === 's')) {
    const key = [s.a, s.b].sort().join('|')
    if (seenSeg.has(key)) continue
    seenSeg.add(key)
    segments.push({ from: s.a, to: s.b, style: s.style || 'solid', relation: 'normal' })
  }

  return {
    points: pts.map(p => {
      const out = { label: p.label, x: p.x, y: p.y, type: p.type || 'vertex' }
      if (p.derived) out.derived = p.derived
      return out
    }),
    segments,
    circles: circles.map(c => ({ label: c.label, cx: c.c.x, cy: c.c.y, r: c.r })),
    polygons: all.filter(o => o.kind === 'P').map(p => ({ points: p.points, style: 'solid', fill: !!p.fill })),
    arcs: all.filter(o => o.kind === 'C').map(a => ({ center: a.center, from: a.from, to: a.to, style: 'solid' })),
    // 函数图象：采样点是原始数学坐标对，**不引用 label**，所以不参与内容闸门
    // （闸门核对的是"点/线/圆有没有画对"，曲线是解析式确定性算出来的）。
    // breaks：采样时跳过无定义点造成的断点下标（渲染端据此切成多段，不靠间距启发式猜）。
    curves: all.filter(o => o.kind === 'k').map(k => {
      const c = { points: k.points, style: 'solid' }
      if (k.breaks?.length) c.breaks = k.breaks
      return c
    }),
    angleMarks: all.filter(o => o.kind === 'mark' && o.mark === 'angle')
      .map(m => ({ vertex: m.vertex, from: m.from, to: m.to, style: 'solid' })),
    rightAngles: all.filter(o => o.kind === 'mark' && o.mark === 'right')
      .map(m => ({ vertex: m.vertex, from: m.from, to: m.to })),
    labels: all.filter(o => o.kind === 'text').map(l => ({ text: l.text, x: l.x, y: l.y })),
    figure_type: 'geometry',
    coordinate_system: { exists: false, origin: '', x_axis: false, y_axis: false },
    constraints: []
  }
}
