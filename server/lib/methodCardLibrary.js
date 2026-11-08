/**
 * 方法卡内容库 —— 「学一个会一类」的教学内容层
 * ================================================================
 * 2026-11-08 P0（八年级「二次根式」试点）：课件按考点分节后，每节开头给一张方法卡：
 *   识别信号 → 通用动作 → 易错点。这不是新系统，只是给现有考点/考法补一层「讲法」。
 *
 * 口径（改前必读）：
 *   1. 静态方法卡只覆盖试点专题的标准方法，不写具体题目的答案，也不写未经核对的结论。
 *   2. 未命中静态库时**回退到考法库** teaching_question_types 已有的
 *      teaching_notes / common_mistakes（79 条现存数据全带这两列），不复制、不写库。
 *   3. 都取不到就返回 source='none'，调用方不渲染方法卡 —— 绝不编内容。
 *   4. 纯函数，不连库、不写状态；新增专题只需往 STATIC_CARDS 加一条。
 */

/** 静态方法卡：按考点名匹配（含关键词兜底），顺序即优先级 */
const STATIC_CARDS = [
  {
    match: ['二次根式的性质'],
    signals: '被开方数含字母、或题目问「式子何时有意义」「化简 √(a²)」',
    steps: '先定被开方数 ≥ 0 → 用 √(a²)=|a| 脱根号 → 按字母正负讨论 → 化到最简',
    pitfalls: 'a<0 时漏掉 √(a²)=-a；不写定义域就直接开方',
  },
  {
    match: ['二次根式的乘法', '二次根式的乘除', '二次根式的除法'],
    signals: '多个根式相乘、相除，或根号内外都带系数',
    steps: '系数与根号内分别运算 → 提取完全平方因子 → 结果化成最简二次根式',
    pitfalls: '忘记字母取值条件；结果没化到最简；把 √(a+b) 拆成 √a+√b',
  },
  {
    match: ['分母有理化'],
    signals: '分母里带根号，或题目要求「分母有理化」',
    steps: '找有理化因式（常用平方差）→ 分子分母同乘 → 展开化简',
    pitfalls: '只乘分母漏乘分子；共轭因式选错；乘完没约分',
  },
  {
    match: ['根式运算', '二次根式', '二次根式的加减'],
    signals: '根式混合运算、化简求值，或一组「观察等式找规律」',
    steps: '先各自化成最简 → 只合并同类二次根式 → 再代入或按规律递推',
    pitfalls: '不同被开方数硬合并；符号与绝对值漏讨论；规律题没验证首项',
  },
  {
    match: ['无理数', '实数', '实数的运算', '数轴', '立方根'],
    signals: '判断无理数、在数轴上定位根式、或估算 √n 的近似值',
    steps: '先夹在相邻整数/完全平方数之间 → 用面积或勾股构造长度 → 再逐步逼近',
    pitfalls: '把带根号的数一律当无理数（如 √4）；估算时忽略题目要求精度',
  },
]

/** 从考法库 AI 生成的 teaching_notes 里抽「考法动作 / 关键步骤」，纯文本解析 */
export function parseKaofaNotes(notes) {
  const text = String(notes || '')
  const action = /考法动作[:：]\s*([^\n]+)/.exec(text)?.[1]?.trim() || ''
  const steps = /关键步骤[:：]\s*([^\n]+)/.exec(text)?.[1]?.trim() || ''
  return { action, steps }
}

/**
 * 取一张方法卡。
 * @param {string} kpName 考点名（已按同学科同名归一）
 * @param {Array<{teaching_notes?:string, common_mistakes?:string, name?:string}>} kaofaRows
 *        该考点在 teaching_question_types 下挂的考法（可为空）
 * @returns {{title:string, signals:string, steps:string, pitfalls:string, source:string}}
 */
export function getMethodCard(kpName, kaofaRows = []) {
  const name = String(kpName || '').trim()
  const blank = { title: name, signals: '', steps: '', pitfalls: '', source: 'none' }
  if (!name) return blank

  // ① 精确名优先，② 再退到关键词命中
  let hit = STATIC_CARDS.find(c => c.match.includes(name))
  if (!hit) hit = STATIC_CARDS.find(c => c.match.some(k => name.includes(k) || k.includes(name)))
  if (hit) {
    return { title: name, signals: hit.signals, steps: hit.steps, pitfalls: hit.pitfalls, source: 'library' }
  }

  // ③ 回退：直接消费考法库已有内容，不另造一套
  const row = (kaofaRows || []).find(r => r?.teaching_notes || r?.common_mistakes)
  if (row) {
    const { action, steps } = parseKaofaNotes(row.teaching_notes)
    const pitfalls = String(row.common_mistakes || '').trim()
    if (!action && !steps && !pitfalls) return blank
    return {
      title: name,
      signals: action ? `考法动作：${action}` : '',
      steps: steps || '',
      pitfalls,
      source: 'kaofa',
    }
  }
  return blank
}

/** 方法卡是否值得渲染（三段全空就不占位） */
export function hasMethodCard(card) {
  return !!card && card.source !== 'none'
    && !!(card.signals || card.steps || card.pitfalls)
}
