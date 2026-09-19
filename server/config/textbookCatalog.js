/**
 * 标准教材章节目录（上海五四制 · 数学 · 八/九年级）
 * ================================================================
 * 用途：周末班错题课件「章节筛选」的唯一展示轴。
 *
 * 口径（2026-09-19 产品评审确认）：
 *   1. 章节名必须与正式教材目录一致，不得使用 OCR 识别出的 unit_title。
 *   2. 每个节点有稳定 id；错题归属时只引用 id，不在错题侧复制章节名。
 *   3. 当前先覆盖「八、九年级数学」逐章逐节（含课时级 27.2(1) 这类小节）。
 *   4. 目录为只读配置（方案 B），后续需要多版本/老师维护时再升级为表。
 *
 * 结构约定：
 *   - grade: 学生表年级值（初二 / 初三）
 *   - nodes: 扁平节点数组；id 即展示/筛选键
 *   - parentId: 父节点 id；章节名节点直接挂年级 root
 *   - sortKey: 教材顺序排序键，必须可按字符串比较
 *   - aliases: 用于把 OCR/任务名里的编号/名称归一映射到本节点
 */

export const TEXTBOOK_CATALOG = [
  {
    grade: '初二',
    subject: '数学',
    edition: '上海五四制',
    nodes: [
      { id: 'g8', parentId: null, name: '八年级数学', sortKey: '0' },
      { id: 'g8-c18', parentId: 'g8', name: '第18章 一次函数', sortKey: '18', aliases: ['18', '第18章', '一次函数'] },
      { id: 'g8-c18-s1', parentId: 'g8-c18', name: '18.1 一次函数的概念', sortKey: '18.1', aliases: ['18.1', '一次函数的概念'] },
      { id: 'g8-c18-s2', parentId: 'g8-c18', name: '18.2 正比例函数', sortKey: '18.2', aliases: ['18.2', '正比例函数'] },
      { id: 'g8-c18-s3', parentId: 'g8-c18', name: '18.3 一次函数的图像与性质', sortKey: '18.3', aliases: ['18.3', '一次函数的图像与性质'] },
      { id: 'g8-c18-s4', parentId: 'g8-c18', name: '18.4 一次函数与一元一次方程、一元一次不等式', sortKey: '18.4', aliases: ['18.4', '一次函数与方程', '一次函数与不等式'] },
      { id: 'g8-c19', parentId: 'g8', name: '第19章 四边形', sortKey: '19', aliases: ['19', '第19章', '四边形'] },
      { id: 'g8-c19-s1', parentId: 'g8-c19', name: '19.1 多边形内角和', sortKey: '19.1', aliases: ['19.1', '多边形内角和'] },
      { id: 'g8-c19-s2', parentId: 'g8-c19', name: '19.2 平行四边形', sortKey: '19.2', aliases: ['19.2', '平行四边形'] },
      { id: 'g8-c19-s3', parentId: 'g8-c19', name: '19.3 矩形', sortKey: '19.3', aliases: ['19.3', '矩形'] },
      { id: 'g8-c19-s4', parentId: 'g8-c19', name: '19.4 菱形', sortKey: '19.4', aliases: ['19.4', '菱形'] },
      { id: 'g8-c19-s5', parentId: 'g8-c19', name: '19.5 正方形', sortKey: '19.5', aliases: ['19.5', '正方形'] },
      { id: 'g8-c19-s6', parentId: 'g8-c19', name: '19.6 梯形', sortKey: '19.6', aliases: ['19.6', '梯形'] },
      { id: 'g8-c19-s7', parentId: 'g8-c19', name: '19.7 等腰梯形', sortKey: '19.7', aliases: ['19.7', '等腰梯形'] },
      { id: 'g8-c19-s8', parentId: 'g8-c19', name: '19.8 平面图形的镶嵌', sortKey: '19.8', aliases: ['19.8', '平面图形的镶嵌', '镶嵌'] },
      { id: 'g8-c20', parentId: 'g8', name: '第20章 数据的整理与初步处理', sortKey: '20', aliases: ['20', '第20章', '数据的整理与初步处理', '统计'] },
      { id: 'g8-c20-s1', parentId: 'g8-c20', name: '20.1 平均数', sortKey: '20.1', aliases: ['20.1', '平均数'] },
      { id: 'g8-c20-s2', parentId: 'g8-c20', name: '20.2 中位数、众数', sortKey: '20.2', aliases: ['20.2', '中位数', '众数'] },
      { id: 'g8-c20-s3', parentId: 'g8-c20', name: '20.3 方差', sortKey: '20.3', aliases: ['20.3', '方差'] },
      { id: 'g8-c20-s4', parentId: 'g8-c20', name: '20.4 频数分布', sortKey: '20.4', aliases: ['20.4', '频数', '频数分布'] },
      { id: 'g8-c21', parentId: 'g8', name: '第21章 一元二次方程', sortKey: '21', aliases: ['21', '第21章', '一元二次方程'] },
      { id: 'g8-c21-s1', parentId: 'g8-c21', name: '21.1 一元二次方程', sortKey: '21.1', aliases: ['21.1', '一元二次方程'] },
      { id: 'g8-c21-s2', parentId: 'g8-c21', name: '21.2 一元二次方程的解法', sortKey: '21.2', aliases: ['21.2', '配方法', '公式法', '因式分解法'] },
      { id: 'g8-c21-s3', parentId: 'g8-c21', name: '21.3 一元二次方程的根的判别式', sortKey: '21.3', aliases: ['21.3', '判别式', '根的判别式'] },
      { id: 'g8-c21-s4', parentId: 'g8-c21', name: '21.4 一元二次方程的应用', sortKey: '21.4', aliases: ['21.4', '一元二次方程的应用', '增长率', '利润'] },
      { id: 'g8-c22', parentId: 'g8', name: '第22章 二次根式', sortKey: '22', aliases: ['22', '第22章', '二次根式'] },
      { id: 'g8-c22-s1', parentId: 'g8-c22', name: '22.1 二次根式', sortKey: '22.1', aliases: ['22.1', '二次根式'] },
      { id: 'g8-c22-s2', parentId: 'g8-c22', name: '22.2 二次根式的乘除', sortKey: '22.2', aliases: ['22.2', '二次根式的乘除'] },
      { id: 'g8-c22-s3', parentId: 'g8-c22', name: '22.3 二次根式的加减', sortKey: '22.3', aliases: ['22.3', '二次根式的加减'] },
    ],
  },
  {
    grade: '初三',
    subject: '数学',
    edition: '上海五四制',
    nodes: [
      { id: 'g9', parentId: null, name: '九年级数学', sortKey: '0' },
      { id: 'g9-c27', parentId: 'g9', name: '第27章 二次函数', sortKey: '27', aliases: ['27', '第27章', '二次函数'] },
      { id: 'g9-c27-s1', parentId: 'g9-c27', name: '27.1 二次函数的概念', sortKey: '27.1', aliases: ['27.1', '二次函数的概念'] },
      { id: 'g9-c27-s2', parentId: 'g9-c27', name: '27.2 二次函数的图像与性质', sortKey: '27.2', aliases: ['27.2', '二次函数的图像与性质'] },
      { id: 'g9-c27-s2-1', parentId: 'g9-c27-s2', name: '27.2(1) 形如y=ax²的图像与性质', sortKey: '27.2(1)', aliases: ['27.2(1)', 'y=ax2', 'y=ax²'] },
      { id: 'g9-c27-s2-2', parentId: 'g9-c27-s2', name: '27.2(2) 形如y=ax²+b的图像与性质', sortKey: '27.2(2)', aliases: ['27.2(2)', 'y=ax2+b', 'y=ax²+b'] },
      { id: 'g9-c27-s2-3', parentId: 'g9-c27-s2', name: '27.2(3) 形如y=a(x+m)²的图像与性质', sortKey: '27.2(3)', aliases: ['27.2(3)', 'y=a(x+m)2', 'y=a(x+m)²'] },
      { id: 'g9-c27-s2-4', parentId: 'g9-c27-s2', name: '27.2(4) 形如y=a(x+m)²+h的图像与性质', sortKey: '27.2(4)', aliases: ['27.2(4)', 'y=a(x+m)2+h', 'y=a(x+m)²+h'] },
      { id: 'g9-c27-s2-5', parentId: 'g9-c27-s2', name: '27.2(5) 形如y=ax²+bx+c的图像与性质', sortKey: '27.2(5)', aliases: ['27.2(5)', 'y=ax2+bx+c', 'y=ax²+bx+c'] },
      { id: 'g9-c27-s3', parentId: 'g9-c27', name: '27.3 二次函数表达式的确定', sortKey: '27.3', aliases: ['27.3', '二次函数表达式的确定', '待定系数法'] },
      { id: 'g9-c27-s4', parentId: 'g9-c27', name: '27.4 二次函数与一元二次方程', sortKey: '27.4', aliases: ['27.4', '二次函数与一元二次方程'] },
      { id: 'g9-c27-s5', parentId: 'g9-c27', name: '27.5 二次函数的应用', sortKey: '27.5', aliases: ['27.5', '二次函数的应用'] },
      { id: 'g9-c28', parentId: 'g9', name: '第28章 相似三角形', sortKey: '28', aliases: ['28', '第28章', '相似三角形'] },
      { id: 'g9-c28-s1', parentId: 'g9-c28', name: '28.1 成比例线段', sortKey: '28.1', aliases: ['28.1', '成比例线段', '比例线段'] },
      { id: 'g9-c28-s1-1', parentId: 'g9-c28-s1', name: '28.1(1) 比例线段', sortKey: '28.1(1)', aliases: ['28.1(1)', '比例线段'] },
      { id: 'g9-c28-s1-2', parentId: 'g9-c28-s1', name: '28.1(2) 平行线分线段成比例定理', sortKey: '28.1(2)', aliases: ['28.1(2)', '平行线分线段成比例'] },
      { id: 'g9-c28-s1-3', parentId: 'g9-c28-s1', name: '28.1(3) 平行线分线段成比例定理的推论', sortKey: '28.1(3)', aliases: ['28.1(3)', '平行线分线段成比例定理2', '平分线分线段成比例'] },
      { id: 'g9-c28-s2', parentId: 'g9-c28', name: '28.2 相似三角形的判定与性质', sortKey: '28.2', aliases: ['28.2', '相似三角形的判定', '相似三角形的性质'] },
      { id: 'g9-c28-s2-1', parentId: 'g9-c28-s2', name: '28.2(1) 相似三角形的判定(1)', sortKey: '28.2(1)', aliases: ['28.2(1)', '相似三角形的判定1'] },
      { id: 'g9-c28-s2-2', parentId: 'g9-c28-s2', name: '28.2(2) 相似三角形的判定(2)', sortKey: '28.2(2)', aliases: ['28.2(2)', '相似三角形的判定2'] },
      { id: 'g9-c28-s2-3', parentId: 'g9-c28-s2', name: '28.2(3) 相似三角形的判定(3)', sortKey: '28.2(3)', aliases: ['28.2(3)', '相似三角形的判定3'] },
      { id: 'g9-c28-s2-4', parentId: 'g9-c28-s2', name: '28.2(4) 相似三角形的性质', sortKey: '28.2(4)', aliases: ['28.2(4)', '相似三角形的性质'] },
      { id: 'g9-c28-s3', parentId: 'g9-c28', name: '28.3 相似多边形', sortKey: '28.3', aliases: ['28.3', '相似多边形'] },
      { id: 'g9-c28-s4', parentId: 'g9-c28', name: '28.4 位似图形', sortKey: '28.4', aliases: ['28.4', '位似', '位似图形'] },
      { id: 'g9-c29', parentId: 'g9', name: '第29章 锐角的三角比', sortKey: '29', aliases: ['29', '第29章', '锐角的三角比', '三角函数'] },
      { id: 'g9-c29-s1', parentId: 'g9-c29', name: '29.1 锐角三角比', sortKey: '29.1', aliases: ['29.1', '锐角三角比', '正弦', '余弦', '正切'] },
      { id: 'g9-c29-s2', parentId: 'g9-c29', name: '29.2 解直角三角形', sortKey: '29.2', aliases: ['29.2', '解直角三角形'] },
      { id: 'g9-c30', parentId: 'g9', name: '第30章 投影与视图', sortKey: '30', aliases: ['30', '第30章', '投影与视图', '三视图'] },
      { id: 'g9-c30-s1', parentId: 'g9-c30', name: '30.1 投影', sortKey: '30.1', aliases: ['30.1', '投影', '中心投影', '平行投影'] },
      { id: 'g9-c30-s2', parentId: 'g9-c30', name: '30.2 三视图', sortKey: '30.2', aliases: ['30.2', '三视图', '直棱柱', '圆柱', '圆锥'] },
    ],
  },
]

/** 展平后的目录节点 Map：id → node */
const NODE_INDEX = new Map()
for (const catalog of TEXTBOOK_CATALOG) {
  for (const node of catalog.nodes) NODE_INDEX.set(node.id, node)
}

/** 归一化编号：压空白、全角括号转半角、字母转小写、统一 y=ax² 写法 */
export function normalizeCatalogKey(input) {
  return String(input || '')
    .replace(/[\s　]+/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .toLowerCase()
}

/** 取某年级目录（含节点 id 到节点引用） */
export function getCatalogForGrade(grade) {
  return TEXTBOOK_CATALOG.find(c => c.grade === grade) || null
}

/**
 * 把 OCR/任务名里的单元编号解析成标准章节节点。
 * 优先级：
 *   1. 精确编号（如 27.2(3)）
 *   2. 章节编号（如 27.2）→ 若无小节则回落到该节，有课时子节点则回落节
 *   3. 章号（如 27）→ 章节点
 * 只返回「命中唯一节点」的结果；歧义或未命中返回 null（调用方归为未识别）。
 */
export function resolveChapter(grade, rawUnitKey, rawUnitTitle = '', taskName = '') {
  const catalog = getCatalogForGrade(grade)
  if (!catalog) return null
  const nodes = catalog.nodes

  const normKey = normalizeCatalogKey(rawUnitKey)
  const normTitle = normalizeCatalogKey(rawUnitTitle)
  const normTask = normalizeCatalogKey(taskName)

  // 0. 教材编号别名精确命中（目录 id 带 g8/g9 前缀，不能用 id 直接比编号）
  const keyHits = nodes.filter(n => (n.aliases || []).some(a => normalizeCatalogKey(a) === normKey))
  if (keyHits.length === 1) return keyHits[0]

  // 1. 编号精确命中
  const byKey = nodes.find(n => normalizeCatalogKey(n.id) === normKey)
  if (byKey) return byKey

  // 2. unit_title / task_name 里的编号（如 27.4（1））精确命中
  const codeRe = /(\d{1,2}\.\d{1,2}(?:\(\d+\))?)/
  const codeMatch = normTitle.match(codeRe) || normTask.match(codeRe)
  if (codeMatch) {
    const code = codeMatch[1]
    const byCode = nodes.filter(n => (n.aliases || []).some(a => normalizeCatalogKey(a) === code))
    if (byCode.length === 1) return byCode[0]
    const sectionCode = code.replace(/\(\d+\)$/, '')
    const bySection = nodes.filter(n => (n.aliases || []).some(a => normalizeCatalogKey(a) === sectionCode))
    if (bySection.length === 1) return bySection[0]
  }

  // 3. 名称包含命中（按最长名称优先）
  const titleHits = nodes.filter(n => {
    const name = normalizeCatalogKey(n.name)
    return name && normTitle && (normTitle.includes(name) || name.includes(normTitle))
  })
  if (titleHits.length === 1) return titleHits[0]
  const taskHits = nodes.filter(n => {
    const name = normalizeCatalogKey(n.name)
    return name && normTask && (normTask.includes(name) || name.includes(normTask))
  })
  if (taskHits.length === 1) return taskHits[0]

  // 4. 章号（27/28/29/30）
  const chapterRe = /^(\d{1,2})$/
  const chapterMatch = normKey.match(chapterRe) || normTitle.match(chapterRe) || normTask.match(chapterRe)
  if (chapterMatch) {
    const chapter = nodes.filter(n =>
      n.parentId && n.parentId.startsWith('g') &&
      (n.aliases || []).some(a => normalizeCatalogKey(a) === chapterMatch[1])
    )
    if (chapter.length === 1) return chapter[0]
  }

  return null
}

/**
 * 构建树形下拉数据（Element Plus el-tree-select 可用）。
 * @param {string} grade
 * @returns {Array<{value,label,children}>}
 */
export function buildChapterTree(grade) {
  const catalog = getCatalogForGrade(grade)
  if (!catalog) return []
  const byId = new Map()
  for (const n of catalog.nodes) {
    byId.set(n.id, { value: n.id, label: n.name, children: [] })
  }
  const roots = []
  for (const n of catalog.nodes) {
    const node = byId.get(n.id)
    if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId).children.push(node)
    else roots.push(node)
  }
  const sortRec = (list) => {
    list.sort((a, b) => {
      const ka = catalog.nodes.find(n => n.id === a.value)?.sortKey || a.value
      const kb = catalog.nodes.find(n => n.id === b.value)?.sortKey || b.value
      return String(ka).localeCompare(String(kb), 'en', { numeric: true })
    })
    list.forEach(n => sortRec(n.children))
    return list
  }
  return sortRec(roots)
}

/** 判断某节点是否应展示为“叶子可筛节点”（章、节、课时都可选，根年级不可选） */
export function isLeafChapter(nodeId) {
  const n = NODE_INDEX.get(nodeId)
  return !!n && !!n.parentId
}
