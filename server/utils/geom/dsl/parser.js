/**
 * DSL 解析器：把多行文本解析成命令序列。
 *
 * 语法（GeoBuildBench 约定）：`command : inputs -> outputs`
 *   - 一行一条命令；`#` 起注释；空行忽略
 *   - 输入/输出以空白分隔
 *   - 表达式内**不得有空格**（`100*cos(60°)` 是一个 token），
 *     所以按空白切分是安全的，不需要真正的词法分析
 *
 * 容错：箭头/冒号的中英文写法（`->` / `→`、`:` / `：`）都接受；
 * 代码围栏 ``` 与行内编号（`1. point : ...`）一并剥掉——
 * 视觉模型几乎总会带这些包装。
 *
 * 解析**不做语义检查**（命令是否存在、参数类型是否对）——那是 executor 的事。
 * 这里只回答"这一行长什么样"，并把语法错误连同行号返回。
 */

const ARROW = /\s*(?:->|→|=>)\s*/
const COLON = /\s*[:：]\s*/

/**
 * 撇号归一化：把 ASCII `'` 与右单引号 `’` 统一成排版撇 `′`。
 *
 * 为什么必须在解析期做：模型写 `A'` 和 `A′` 是同一个点，但作为字符串是两个不同 label。
 * 不归一化的话 `mirror : B AC -> B'` 与后面 `segment : A B′` 会各建一个点，
 * 图上看不出差别、内容闸门却会判"多画了一个点"，排查成本极高。
 * 引号内的文字（label 命令的标注文本）不动——那里撇号可能是内容本身。
 */
const normPrimeTok = (tok) => (/^"/.test(tok) ? tok : tok.replace(/['’]/g, '′'))

/** 剥掉代码围栏、行号前缀、Markdown 强调符号 */
function stripWrappers(line) {
  let s = String(line ?? '')
  s = s.replace(/^\s*```[a-zA-Z]*\s*$/, '')
  s = s.replace(/^\s*\d+\s*[.)、]\s+/, '')       // "1. point : ..."
  s = s.replace(/^[\s*_`>]+/, '')                 // 行首 markdown 记号
  s = s.replace(/[\s`]+$/, '')                    // 行尾反引号
  return s
}

/**
 * 按空白切分参数，但**引号内的空白不切**。
 * 只有 `label` 命令需要（文字标注如 "8cm"、"60°"），
 * 其余命令的参数都是单 token 的表达式或对象名。
 * 保留引号本身，让 executor 能识别这是「文本」而不是表达式。
 */
function splitArgs(s) {
  const norm = s.replace(/[“”]/g, '"')
  const out = []
  let cur = ''
  let inQuote = false
  for (const ch of norm) {
    if (ch === '"') { inQuote = !inQuote; cur += ch; continue }
    if (/\s/.test(ch) && !inQuote) { if (cur) { out.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/**
 * @param {string} text DSL 源码
 * @returns {{commands: object[], errors: {line:number, raw:string, message:string, hint?:string}[]}}
 *   commands 项：{ line, cmd, inputs:string[], outputs:string[], raw:string }
 */
export function parseDsl(text) {
  const commands = []
  const errors = []
  const lines = String(text ?? '').split(/\r?\n/)

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1
    const s = stripWrappers(rawLine)
    if (!s) return
    if (s.startsWith('#')) return

    const arrow = s.split(ARROW)
    if (arrow.length !== 2) {
      errors.push({
        line: lineNo, raw: rawLine,
        message: arrow.length < 2 ? 'MISSING_ARROW' : 'MULTIPLE_ARROWS',
        hint: '格式必须是 `command : inputs -> outputs`'
      })
      return
    }
    const [lhs, rhs] = arrow
    const ci = lhs.search(/[:：]/)
    if (ci < 0) {
      errors.push({
        line: lineNo, raw: rawLine,
        message: 'MISSING_COLON',
        hint: '格式必须是 `command : inputs -> outputs`'
      })
      return
    }
    const cmd = lhs.slice(0, ci).trim()
    const inputs = splitArgs(lhs.slice(ci + 1).trim()).map(normPrimeTok)
    const outputs = splitArgs(rhs.trim()).map(normPrimeTok)

    if (!cmd) {
      errors.push({ line: lineNo, raw: rawLine, message: 'EMPTY_COMMAND' })
      return
    }
    if (outputs.length === 0) {
      errors.push({
        line: lineNo, raw: rawLine,
        message: 'MISSING_OUTPUT',
        hint: '`->` 右边必须给出至少一个输出名'
      })
      return
    }
    commands.push({ line: lineNo, cmd, inputs, outputs, raw: s })
  })

  return { commands, errors }
}
