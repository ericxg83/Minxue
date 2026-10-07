import { query } from '../config/neon.js'

// ============================================================
// 062: 知识点前置关系表（kp_relations）
//
// 为什么建这张表（2026-10-07 知识树治理）：
//   原 knowledge_points 只有 parent_id（谁属于谁），没有「谁先学谁」。
//   学生错在「二次函数」，无法回答「根子是不是一元二次方程没掌握」——
//   这正是晚托班最值钱的问题。参照外部高中数学知识网络的 PREREQUISITE_OF 边设计。
//
// 口径：
//   - from 必须先掌握，才能学 to（有向）。
//   - basis 记录依据类型：'课标顺序'（教材教学先后）| '数学依赖'（后者定义/证明用到前者）。
//   - status 两级：'proposed'（提案，未核）→ 'confirmed'（人工确认）→ 'rejected'。
//     ⛔ 只有 confirmed 才可用于「错题溯源补练」，proposed 仅作展示建议。
//   - 本表是纯派生数据，可整体 DROP 重建，不影响 question_knowledge / knowledge_mastery。
//
// 回滚：DROP TABLE kp_relations 即可，其余零改动。
// ============================================================

const EDGES = [
  { from: '有理数', to: '实数', basis: '课标顺序', reason: '有理数先于实数；实数引入无理数后统一数系' },
  { from: '有理数', to: '数轴', basis: '课标顺序', reason: '数轴用来表示有理数' },
  { from: '有理数', to: '相反数', basis: '课标顺序', reason: '相反数是正负数概念的延伸' },
  { from: '有理数', to: '绝对值', basis: '课标顺序', reason: '绝对值建立在有理数与数轴上' },
  { from: '实数', to: '平方根', basis: '数学依赖', reason: '平方根是实数开方运算的基础' },
  { from: '平方根', to: '立方根', basis: '数学依赖', reason: '立方根与平方根同类，均属开方运算' },
  { from: '平方根', to: '二次根式', basis: '数学依赖', reason: '二次根式建立在算术平方根之上' },
  { from: '实数', to: '二次根式', basis: '课标顺序', reason: '二次根式需先有无理数与实数概念' },
  { from: '二次根式', to: '分母有理化', basis: '数学依赖', reason: '分母有理化是二次根式运算的组成部分' },
  { from: '整式与分式', to: '因式分解', basis: '课标顺序', reason: '因式分解是整式乘法的逆运算' },
  { from: '幂与根式', to: '整式与分式', basis: '课标顺序', reason: '幂的运算是整式运算的前置' },
  { from: '整式与分式', to: '分式化简', basis: '课标顺序', reason: '分式建立在整式与因式分解之上' },
  { from: '因式分解', to: '分式化简', basis: '数学依赖', reason: '分式约分依赖因式分解' },
  { from: '平方差公式', to: '因式分解', basis: '数学依赖', reason: '平方差公式是公式法因式分解的工具' },
  { from: '完全平方公式', to: '因式分解', basis: '数学依赖', reason: '完全平方公式是公式法因式分解的工具' },
  { from: '整式与分式', to: '一元一次方程', basis: '数学依赖', reason: '解方程需先去分母/去括号/合并同类项' },
  { from: '有理数', to: '一元一次方程', basis: '课标顺序', reason: '有理数运算是一元一次方程解法的前提' },
  { from: '一元一次方程', to: '二元一次方程组', basis: '课标顺序', reason: '代入/加减消元建立在一元一次方程解法上' },
  { from: '一元一次方程', to: '分式方程', basis: '数学依赖', reason: '分式方程最后化归为一元一次方程' },
  { from: '分式化简', to: '分式方程', basis: '数学依赖', reason: '分式方程需先掌握分式运算' },
  { from: '一元一次方程', to: '不等式', basis: '课标顺序', reason: '不等式解法与一元一次方程解法同源（注意变号）' },
  { from: '不等式', to: '一元一次不等式组', basis: '数学依赖', reason: '不等式组由多个不等式联立' },
  { from: '因式分解', to: '一元二次方程', basis: '数学依赖', reason: '因式分解法是解一元二次方程的主要方法之一' },
  { from: '一元二次方程', to: '判别式', basis: '数学依赖', reason: '判别式由一元二次方程求根公式导出' },
  { from: '判别式', to: '二次函数', basis: '数学依赖', reason: '判别式决定抛物线与 x 轴交点个数' },
  { from: '实数', to: '有序数对与平面直角坐标系', basis: '课标顺序', reason: '坐标系建立在实数（数轴）之上' },
  { from: '有序数对与平面直角坐标系', to: '点的坐标', basis: '数学依赖', reason: '点坐标是坐标系的基本表示' },
  { from: '有序数对与平面直角坐标系', to: '函数的概念', basis: '课标顺序', reason: '函数图象需在坐标系中刻画' },
  { from: '函数的概念', to: '一次函数', basis: '课标顺序', reason: '一次函数是最基本的函数模型' },
  { from: '一次函数', to: '反比例函数', basis: '课标顺序', reason: '反比例函数在学完一次函数后引入' },
  { from: '一元二次方程', to: '二次函数', basis: '数学依赖', reason: '二次函数与一元二次方程关系紧密' },
  { from: '一次函数', to: '二次函数', basis: '课标顺序', reason: '二次函数承接一次函数的图象与性质研究方法' },
  { from: '二次函数', to: '抛物线顶点', basis: '数学依赖', reason: '顶点是二次函数图象的核心要素' },
  { from: '抛物线顶点', to: '顶点坐标', basis: '数学依赖', reason: '顶点坐标是顶点研究的具体化' },
  { from: '二次函数', to: '对称轴', basis: '数学依赖', reason: '对称轴是二次函数图象的基本性质' },
  { from: '二次函数', to: '开口方向', basis: '数学依赖', reason: '开口方向由二次项系数决定' },
  { from: '二次函数', to: '最值', basis: '数学依赖', reason: '二次函数最值由顶点决定' },
  { from: '线与角', to: '平行线', basis: '课标顺序', reason: '平行线的判定与性质建立在角的关系上' },
  { from: '平行线', to: '三角形内角和定理及证明', basis: '数学依赖', reason: '内角和证明依赖平行线性质' },
  { from: '线与角', to: '三角形的边的关系', basis: '课标顺序', reason: '三角形由线段与角构成' },
  { from: '三角形的边的关系', to: '全等三角形', basis: '课标顺序', reason: '全等判定需要对应边角关系' },
  { from: '全等三角形', to: '特殊三角形', basis: '数学依赖', reason: '等腰/等边/直角三角形的性质由全等推出' },
  { from: '全等三角形', to: '轴对称与轴对称图形', basis: '数学依赖', reason: '轴对称是研究全等与等腰三角形的工具' },
  { from: '特殊三角形', to: '勾股定理', basis: '数学依赖', reason: '勾股定理研究直角三角形的边关系' },
  { from: '勾股定理', to: '勾股定理的逆定理', basis: '数学依赖', reason: '逆定理是勾股定理的反向判定' },
  { from: '勾股定理', to: '三角函数', basis: '数学依赖', reason: '锐角三角比建立在直角三角形边比之上' },
  { from: '相似三角形的性质', to: '三角函数', basis: '数学依赖', reason: '锐角三角比的值与三角形大小无关，依据相似' },
  { from: '三角函数', to: '解直角三角形及实际应用', basis: '数学依赖', reason: '解直角三角形是锐角三角比的直接应用' },
  { from: '全等三角形', to: '平行四边形', basis: '课标顺序', reason: '平行四边形判定与性质依赖全等' },
  { from: '平行四边形', to: '矩形', basis: '数学依赖', reason: '矩形是特殊的平行四边形' },
  { from: '平行四边形', to: '菱形', basis: '数学依赖', reason: '菱形是特殊的平行四边形' },
  { from: '矩形', to: '正方形', basis: '数学依赖', reason: '正方形同时是矩形与菱形' },
  { from: '菱形', to: '正方形', basis: '数学依赖', reason: '正方形同时是矩形与菱形' },
  { from: '全等三角形', to: '三角形中位线', basis: '数学依赖', reason: '中位线定理用全等/相似证明' },
  { from: '比例', to: '比例线段', basis: '数学依赖', reason: '比例线段是比例在几何中的具体化' },
  { from: '比例线段', to: '相似三角形', basis: '课标顺序', reason: '相似三角形的判定基于成比例线段' },
  { from: '相似三角形的判定', to: '相似三角形的性质', basis: '课标顺序', reason: '先判定相似再谈性质' },
  { from: '全等三角形', to: '相似三角形', basis: '数学依赖', reason: '全等是相似比为 1 的特殊情形' },
  { from: '相似三角形', to: '位似变换', basis: '课标顺序', reason: '位似是相似的特殊情形' },
  { from: '三角形中位线', to: '相似三角形', basis: '数学依赖', reason: '中位线定理可用相似证明' },
  { from: '圆的概念', to: '半径', basis: '数学依赖', reason: '半径是圆的基本要素' },
  { from: '圆的概念', to: '圆的基本概念与垂径定理', basis: '课标顺序', reason: '垂径定理建立在圆的基本概念上' },
  { from: '圆的基本概念与垂径定理', to: '弧、弦、圆心角的关系与圆周角定理', basis: '数学依赖', reason: '垂径定理是圆中弦弧关系的基础' },
  { from: '弧、弦、圆心角的关系与圆周角定理', to: '圆周角与圆心角', basis: '数学依赖', reason: '圆周角定理是圆心角与圆周角关系的核心' },
  { from: '圆周角与圆心角', to: '切线', basis: '数学依赖', reason: '切线判定常借助圆周角/直径所对直角' },
  { from: '圆的基本概念与垂径定理', to: '点、直线与圆的位置关系', basis: '课标顺序', reason: '位置关系以半径与距离比较为基础' },
  { from: '点、直线与圆的位置关系', to: '切线', basis: '数学依赖', reason: '切线是直线与圆相切的位置关系' },
  { from: '切线', to: '三角形的内切圆', basis: '数学依赖', reason: '内切圆由三条切线（内心）构成' },
  { from: '圆的基本概念与垂径定理', to: '三角形的外接圆', basis: '数学依赖', reason: '外接圆由三角形顶点确定，用到垂径/中垂线' },
  { from: '圆的基本概念与垂径定理', to: '弧长公式', basis: '数学依赖', reason: '弧长公式依赖圆心角与半径' },
  { from: '弧长公式', to: '弧长、扇形面积与圆锥侧面积', basis: '数学依赖', reason: '扇形与圆锥侧面由弧长/圆心角导出' },
  { from: '弧、弦、圆心角的关系与圆周角定理', to: '正多边形与圆', basis: '数学依赖', reason: '正多边形的中心角与圆心角同源' },
  { from: '数据收集', to: '数据整理', basis: '课标顺序', reason: '先收集后整理' },
  { from: '数据整理', to: '数据描述', basis: '课标顺序', reason: '整理后做统计描述' },
  { from: '数据描述', to: '平均数、中位数、众数', basis: '数学依赖', reason: '三者是最基本的集中趋势量' },
  { from: '平均数、中位数、众数', to: '方差与标准差', basis: '数学依赖', reason: '方差/标准差刻画离散程度，需先有集中趋势' },
  { from: '数据整理', to: '频数', basis: '数学依赖', reason: '频数是整理阶段的计数结果' },
  { from: '频数', to: '频率直方图', basis: '数学依赖', reason: '频率分布直方图建立在频数之上' },
  { from: '不确定事件', to: '随机事件与概率的概念', basis: '课标顺序', reason: '概率以随机事件为基础' },
  { from: '随机事件与概率的概念', to: '用列举法（列表/树状图）求概率', basis: '数学依赖', reason: '列举法是求等可能事件概率的方法' },
  { from: '用列举法（列表/树状图）求概率', to: '用频率估计概率', basis: '数学依赖', reason: '频率估计概率是概率的统计解释' },
  { from: '一元一次方程', to: '行程问题', basis: '数学依赖', reason: '行程问题建模为一元一次方程' },
  { from: '一元一次方程', to: '工程问题', basis: '数学依赖', reason: '工程问题建模为一元一次方程' },
  { from: '一元一次方程', to: '利润问题', basis: '数学依赖', reason: '利润问题建模为方程' },
  { from: '比例', to: '比例问题', basis: '数学依赖', reason: '比例问题是比例关系的应用' },
  { from: '二元一次方程组', to: '实际问题建模', basis: '数学依赖', reason: '多未知量实际问题常用方程组建模' },
  { from: '二次函数', to: '实际问题建模', basis: '数学依赖', reason: '最值类实际问题用二次函数建模' },
  { from: '解直角三角形及实际应用', to: '测量问题', basis: '数学依赖', reason: '测量问题用解直角三角形求解' },
]

export const migrateKpRelations = async () => {
  try {
    console.log('📦 [迁移062] 知识点前置关系表 kp_relations...')

    await query(`
      CREATE TABLE IF NOT EXISTS kp_relations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        from_kp_id uuid NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
        to_kp_id uuid NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
        relation text NOT NULL DEFAULT 'prerequisite',
        basis text,
        reason text,
        status text NOT NULL DEFAULT 'proposed',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_kp_relations UNIQUE (from_kp_id, to_kp_id, relation)
      )
    `)

    const { rows: ck } = await query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'kp_relations_status_check'`)
    if (ck.length === 0) {
      await query(`
        ALTER TABLE kp_relations
        ADD CONSTRAINT kp_relations_status_check
        CHECK (status IN ('proposed', 'confirmed', 'rejected'))
      `)
    }

    await query(`CREATE INDEX IF NOT EXISTS idx_kpr_to ON kp_relations(to_kp_id, status)`)
    await query(`CREATE INDEX IF NOT EXISTS idx_kpr_from ON kp_relations(from_kp_id, status)`)

    // ---- 种子：按名字解析 id，幂等 UPSERT ----
    // ⛔ 用名字解析而不是硬编码 uuid：迁移要能在任何库上重放。
    //    解析不到的（节点被合并/归档）跳过并计数，不报错。
    const { rows: nodes } = await query(
      `SELECT id, name FROM knowledge_points WHERE subject = '数学' AND archived = false`)
    const byName = new Map(nodes.map(r => [r.name, r.id]))

    let seeded = 0, skipped = 0
    const skipNames = []
    for (const e of EDGES) {
      const f = byName.get(e.from)
      const t = byName.get(e.to)
      if (!f || !t || f === t) { skipped++; skipNames.push(e.from + '->' + e.to); continue }
      const { rows } = await query(`
        INSERT INTO kp_relations (from_kp_id, to_kp_id, relation, basis, reason, status)
        VALUES ($1, $2, 'prerequisite', $3, $4, 'proposed')
        ON CONFLICT (from_kp_id, to_kp_id, relation) DO UPDATE
          SET basis = EXCLUDED.basis, reason = EXCLUDED.reason, updated_at = now()
        RETURNING id
      `, [f, t, e.basis, e.reason])
      if (rows.length) seeded++
    }

    const { rows: selfLoop } = await query(
      `SELECT count(*)::int AS n FROM kp_relations WHERE from_kp_id = to_kp_id`)
    const { rows: toArchived } = await query(`
      SELECT count(*)::int AS n FROM kp_relations r
        JOIN knowledge_points k ON k.id = r.to_kp_id WHERE k.archived = true`)

    console.log(`   ✅ 表就绪；种子 ${seeded} 条（跳过 ${skipped}）`)
    if (skipped) console.warn('   ⚠️ 跳过（节点已合并/归档）: ' + skipNames.slice(0, 10).join('、') + (skipNames.length > 10 ? ' …' : ''))
    if (selfLoop[0].n) console.warn('   ⚠️ 自环边 ' + selfLoop[0].n + ' 条（应为 0）')
    if (toArchived[0].n) console.warn('   ⚠️ 指向归档节点的边 ' + toArchived[0].n + ' 条（应为 0）')
  } catch (error) {
    console.error('❌ [迁移062] 失败:', error.message)
    throw error
  }
}
