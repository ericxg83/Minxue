import { query } from '../config/neon.js'

const tableExists = async (table) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
    [table]
  )
  return rows.length > 0
}

const columnExists = async (table, column) => {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  )
  return rows.length > 0
}

// ============================================================
// 数学初中知识树种子数据
// 结构：几何 / 代数 / 概率统计 三大板块
// ============================================================
const MATH_KNOWLEDGE_TREE = [
  // ── 几何 ──
  { name: '几何', parent: null, subject: '数学', level: 0, sort: 1, synonyms: ['平面几何', '几何图形', '空间与图形'] },
  // 几何 → 三角形
  { name: '三角形', parent: '几何', subject: '数学', level: 1, sort: 1, synonyms: ['等腰三角形', '等边三角形', '直角三角形', '三角形的分类'] },
  { name: '全等三角形', parent: '三角形', subject: '数学', level: 2, sort: 1, synonyms: ['全等', '三角形全等', 'SSS', 'SAS', 'ASA', 'AAS', 'HL'] },
  { name: '相似三角形', parent: '三角形', subject: '数学', level: 2, sort: 2, synonyms: ['相似', '三角形相似', '相似比', '位似'] },
  { name: '勾股定理', parent: '三角形', subject: '数学', level: 2, sort: 3, synonyms: ['勾股', '直角三角形勾股定理', '勾股数'] },
  { name: '特殊三角形', parent: '三角形', subject: '数学', level: 2, sort: 4, synonyms: ['等腰直角三角形', '30度直角三角形', '等边三角形性质'] },
  // 几何 → 四边形
  { name: '四边形', parent: '几何', subject: '数学', level: 1, sort: 2, synonyms: ['平行四边形', '矩形', '菱形', '正方形', '梯形'] },
  { name: '平行四边形', parent: '四边形', subject: '数学', level: 2, sort: 1, synonyms: ['平行四边形的性质', '平行四边形的判定'] },
  { name: '矩形', parent: '四边形', subject: '数学', level: 2, sort: 2, synonyms: ['长方形', '矩形的性质', '矩形的判定'] },
  { name: '菱形', parent: '四边形', subject: '数学', level: 2, sort: 3, synonyms: ['菱形的性质', '菱形的判定', '对角线'] },
  { name: '正方形', parent: '四边形', subject: '数学', level: 2, sort: 4, synonyms: ['正方形的性质', '正方形的判定'] },
  // 几何 → 圆
  { name: '圆', parent: '几何', subject: '数学', level: 1, sort: 3, synonyms: ['圆的定义', '圆周角', '圆心角', '弦', '弧', '扇形'] },
  { name: '圆周角与圆心角', parent: '圆', subject: '数学', level: 2, sort: 1, synonyms: ['圆周角定理', '圆心角定理', '弧弦圆心角'] },
  { name: '切线', parent: '圆', subject: '数学', level: 2, sort: 2, synonyms: ['切线的性质', '切线的判定', '切线长定理'] },
  // 几何 → 基础几何
  { name: '线与角', parent: '几何', subject: '数学', level: 1, sort: 4, synonyms: ['线段', '射线', '直线', '垂直', '平行', '对顶角', '邻补角', '角平分线'] },
  { name: '平行线', parent: '线与角', subject: '数学', level: 2, sort: 1, synonyms: ['平行线的性质', '平行线的判定', '同位角', '内错角', '同旁内角'] },
  { name: '三角函数', parent: '几何', subject: '数学', level: 1, sort: 5, synonyms: ['正弦', '余弦', '正切', 'sin', 'cos', 'tan', '解直角三角形'] },

  // ── 代数 ──
  { name: '代数', parent: null, subject: '数学', level: 0, sort: 2, synonyms: ['代数式', '代数运算'] },
  // 代数 → 方程
  { name: '方程与方程组', parent: '代数', subject: '数学', level: 1, sort: 1, synonyms: ['方程', '方程组', '解方程'] },
  { name: '一元一次方程', parent: '方程与方程组', subject: '数学', level: 2, sort: 1, synonyms: ['一元一次方程的解法', '等式的性质'] },
  { name: '一元二次方程', parent: '方程与方程组', subject: '数学', level: 2, sort: 2, synonyms: ['一元二次方程的解法', '配方法', '公式法', '因式分解法', '韦达定理'] },
  { name: '判别式', parent: '一元二次方程', subject: '数学', level: 3, sort: 1, synonyms: ['根的判别式', 'Δ', 'b²-4ac', 'delta'] },
  { name: '分式方程', parent: '方程与方程组', subject: '数学', level: 2, sort: 3, synonyms: ['分式方程的解法', '增根'] },
  { name: '二元一次方程组', parent: '方程与方程组', subject: '数学', level: 2, sort: 4, synonyms: ['二元一次方程组的解法', '代入消元', '加减消元'] },
  // 代数 → 函数
  { name: '函数', parent: '代数', subject: '数学', level: 1, sort: 2, synonyms: ['自变量', '定义域', '值域', '函数图像'] },
  { name: '一次函数', parent: '函数', subject: '数学', level: 2, sort: 1, synonyms: ['正比例函数', 'y=kx+b', '一次函数的图像', '斜率'] },
  { name: '二次函数', parent: '函数', subject: '数学', level: 2, sort: 2, synonyms: ['抛物线', '顶点式', 'y=ax²+bx+c', '二次函数的图像', '对称轴'] },
  { name: '反比例函数', parent: '函数', subject: '数学', level: 2, sort: 3, synonyms: ['y=k/x', '反比例函数的图像', '双曲线'] },
  // 代数 → 不等式
  { name: '不等式', parent: '代数', subject: '数学', level: 1, sort: 3, synonyms: ['不等号', '不等式的性质', '不等式组'] },
  // 代数 → 基础代数
  { name: '有理数', parent: '代数', subject: '数学', level: 1, sort: 4, synonyms: ['正数', '负数', '相反数', '绝对值', '数轴'] },
  { name: '实数', parent: '代数', subject: '数学', level: 1, sort: 5, synonyms: ['无理数', '平方根', '算术平方根', '立方根'] },
  { name: '整式与分式', parent: '代数', subject: '数学', level: 1, sort: 6, synonyms: ['整式', '分式', '单项式', '多项式', '合并同类项'] },
  { name: '因式分解', parent: '整式与分式', subject: '数学', level: 2, sort: 1, synonyms: ['提公因式', '公式法', '十字相乘法', '分组分解'] },
  { name: '幂与根式', parent: '代数', subject: '数学', level: 1, sort: 7, synonyms: ['幂的运算', '二次根式', '根式的化简', '指数'] },

  // ── 概率统计 ──
  { name: '概率统计', parent: null, subject: '数学', level: 0, sort: 3, synonyms: ['概率', '统计', '数据分析'] },
  { name: '概率', parent: '概率统计', subject: '数学', level: 1, sort: 1, synonyms: ['可能性', '随机事件', '古典概型', '概率计算'] },
  { name: '统计', parent: '概率统计', subject: '数学', level: 1, sort: 2, synonyms: ['平均数', '中位数', '众数', '方差', '频率', '扇形图', '条形图', '直方图'] },

  // ── 应用专题 ──
  { name: '应用专题', parent: null, subject: '数学', level: 0, sort: 4, synonyms: ['应用题', '实际应用'] },
  { name: '行程问题', parent: '应用专题', subject: '数学', level: 1, sort: 1, synonyms: ['相遇', '追及', '速度', '路程', '时间'] },
  { name: '工程问题', parent: '应用专题', subject: '数学', level: 1, sort: 2, synonyms: ['工作效率', '合作完成', '工作总量'] },
  { name: '利润问题', parent: '应用专题', subject: '数学', level: 1, sort: 3, synonyms: ['利润率', '打折', '售价', '进价'] },
  { name: '比例问题', parent: '应用专题', subject: '数学', level: 1, sort: 4, synonyms: ['比例', '正比', '反比', '比值', '百分比'] },
]

// ── 英语知识树 ──
const ENGLISH_KNOWLEDGE_TREE = [
  { name: '语法', parent: null, subject: '英语', level: 0, sort: 1, synonyms: ['grammar', '语法规则'] },
  { name: '时态', parent: '语法', subject: '英语', level: 1, sort: 1, synonyms: ['tense', '时态语态', '动词时态'] },
  { name: '一般现在时', parent: '时态', subject: '英语', level: 2, sort: 1, synonyms: ['simple present', '一般现在时态', '第三人称单数'] },
  { name: '一般过去时', parent: '时态', subject: '英语', level: 2, sort: 2, synonyms: ['simple past', '过去式', '一般过去时态'] },
  { name: '一般将来时', parent: '时态', subject: '英语', level: 2, sort: 3, synonyms: ['simple future', 'will', 'be going to', '一般将来时态'] },
  { name: '现在进行时', parent: '时态', subject: '英语', level: 2, sort: 4, synonyms: ['present continuous', 'be doing', '现在进行时态'] },
  { name: '过去进行时', parent: '时态', subject: '英语', level: 2, sort: 5, synonyms: ['past continuous', 'was/were doing', '过去进行时态'] },
  { name: '现在完成时', parent: '时态', subject: '英语', level: 2, sort: 6, synonyms: ['present perfect', 'have/has done', '现在完成时态'] },
  { name: '过去完成时', parent: '时态', subject: '英语', level: 2, sort: 7, synonyms: ['past perfect', 'had done', '过去完成时态'] },
  { name: '被动语态', parent: '语法', subject: '英语', level: 1, sort: 2, synonyms: ['passive voice', 'be done', '被动语态结构'] },
  { name: '从句', parent: '语法', subject: '英语', level: 1, sort: 3, synonyms: ['clause', '从句类型'] },
  { name: '宾语从句', parent: '从句', subject: '英语', level: 2, sort: 1, synonyms: ['object clause', 'that从句', 'if/whether从句'] },
  { name: '定语从句', parent: '从句', subject: '英语', level: 2, sort: 2, synonyms: ['attributive clause', '关系代词', '关系副词', 'that/which/who'] },
  { name: '状语从句', parent: '从句', subject: '英语', level: 2, sort: 3, synonyms: ['adverbial clause', '时间状语从句', '条件状语从句', '原因状语从句'] },
  { name: '主语从句', parent: '从句', subject: '英语', level: 2, sort: 4, synonyms: ['subject clause', 'it作形式主语'] },
  { name: '名词性从句', parent: '从句', subject: '英语', level: 2, sort: 5, synonyms: ['noun clause', '表语从句', '同位语从句'] },
  { name: '非谓语动词', parent: '语法', subject: '英语', level: 1, sort: 4, synonyms: ['non-finite verb', '不定式', '动名词', '分词'] },
  { name: '不定式', parent: '非谓语动词', subject: '英语', level: 2, sort: 1, synonyms: ['infinitive', 'to do', '不定式作宾语'] },
  { name: '动名词', parent: '非谓语动词', subject: '英语', level: 2, sort: 2, synonyms: ['gerund', 'doing', '动名词作主语'] },
  { name: '分词', parent: '非谓语动词', subject: '英语', level: 2, sort: 3, synonyms: ['participle', '现在分词', '过去分词'] },
  { name: '情态动词', parent: '语法', subject: '英语', level: 1, sort: 5, synonyms: ['modal verb', 'can', 'must', 'should', 'may', 'need'] },
  { name: '虚拟语气', parent: '语法', subject: '英语', level: 1, sort: 6, synonyms: ['subjunctive mood', 'if虚拟条件句', 'wish从句'] },
  { name: '词法', parent: '语法', subject: '英语', level: 1, sort: 7, synonyms: ['parts of speech', '词性'] },
  { name: '名词', parent: '词法', subject: '英语', level: 2, sort: 1, synonyms: ['noun', '可数名词', '不可数名词', '名词复数', '名词所有格'] },
  { name: '冠词', parent: '词法', subject: '英语', level: 2, sort: 2, synonyms: ['article', 'a', 'an', 'the', '零冠词'] },
  { name: '代词', parent: '词法', subject: '英语', level: 2, sort: 3, synonyms: ['pronoun', '人称代词', '物主代词', '反身代词', '不定代词'] },
  { name: '形容词副词', parent: '词法', subject: '英语', level: 2, sort: 4, synonyms: ['adjective', 'adverb', '比较级', '最高级', '原级比较'] },
  { name: '介词', parent: '词法', subject: '英语', level: 2, sort: 5, synonyms: ['preposition', '时间介词', '方位介词', '介词短语'] },
  { name: '连词', parent: '词法', subject: '英语', level: 2, sort: 6, synonyms: ['conjunction', 'and', 'but', 'or', 'so', 'because', 'although'] },
  { name: '数词', parent: '词法', subject: '英语', level: 2, sort: 7, synonyms: ['numeral', '基数词', '序数词', '分数表达'] },
  { name: '主谓一致', parent: '语法', subject: '英语', level: 1, sort: 8, synonyms: ['subject-verb agreement', '就近原则', '就远原则'] },
  { name: '倒装句', parent: '语法', subject: '英语', level: 1, sort: 9, synonyms: ['inversion', '完全倒装', '部分倒装', 'never/only倒装'] },

  // 词汇
  { name: '词汇', parent: null, subject: '英语', level: 0, sort: 2, synonyms: ['vocabulary', '单词', '词汇量'] },
  { name: '词汇辨析', parent: '词汇', subject: '英语', level: 1, sort: 1, synonyms: ['word discrimination', '近义词辨析', '形近词'] },
  { name: '固定搭配', parent: '词汇', subject: '英语', level: 1, sort: 2, synonyms: ['collocation', '短语搭配', '动词短语'] },
  { name: '词组短语', parent: '固定搭配', subject: '英语', level: 2, sort: 1, synonyms: ['phrasal verb', '介词短语', '动词短语', 'look短语'] },

  // 句型
  { name: '句型', parent: null, subject: '英语', level: 0, sort: 3, synonyms: ['sentence pattern', '句式'] },
  { name: '疑问句', parent: '句型', subject: '英语', level: 1, sort: 1, synonyms: ['interrogative', '一般疑问句', '特殊疑问句', '选择疑问句', '反意疑问句'] },
  { name: '祈使句', parent: '句型', subject: '英语', level: 1, sort: 2, synonyms: ['imperative', '祈使句结构', 'let句型'] },
  { name: '感叹句', parent: '句型', subject: '英语', level: 1, sort: 3, synonyms: ['exclamatory', 'what感叹句', 'how感叹句'] },
  { name: 'there be句型', parent: '句型', subject: '英语', level: 1, sort: 4, synonyms: ['there be', '存在句', 'there be结构'] },
  { name: '强调句', parent: '句型', subject: '英语', level: 1, sort: 5, synonyms: ['emphatic', 'it is...that', '强调结构'] },

  // 阅读
  { name: '阅读', parent: null, subject: '英语', level: 0, sort: 4, synonyms: ['reading', '阅读理解'] },
  { name: '主旨大意', parent: '阅读', subject: '英语', level: 1, sort: 1, synonyms: ['main idea', '主旨题', '文章大意', '标题选择'] },
  { name: '细节理解', parent: '阅读', subject: '英语', level: 1, sort: 2, synonyms: ['detail', '细节题', '事实细节', '信息定位'] },
  { name: '推理判断', parent: '阅读', subject: '英语', level: 1, sort: 3, synonyms: ['inference', '推理题', '推断题', '隐含意义'] },
  { name: '词义猜测', parent: '阅读', subject: '英语', level: 1, sort: 4, synonyms: ['word guessing', '猜词题', '词义推断'] },
  { name: '作者态度', parent: '阅读', subject: '英语', level: 1, sort: 5, synonyms: ['author attitude', '态度题', '观点态度'] },
  { name: '七选五', parent: '阅读', subject: '英语', level: 1, sort: 6, synonyms: ['七选五', '句子还原', '补全短文'] },
  { name: '完形填空', parent: '阅读', subject: '英语', level: 1, sort: 7, synonyms: ['cloze', '完形', '完形填空'] },

  // 写作
  { name: '写作', parent: null, subject: '英语', level: 0, sort: 5, synonyms: ['writing', '作文', '书面表达'] },
  { name: '书信写作', parent: '写作', subject: '英语', level: 1, sort: 1, synonyms: ['letter writing', '书信', '邮件', '邀请信', '感谢信'] },
  { name: '议论文写作', parent: '写作', subject: '英语', level: 1, sort: 2, synonyms: ['argumentative', '议论文', '观点表达', '利弊分析'] },
  { name: '记叙文写作', parent: '写作', subject: '英语', level: 1, sort: 3, synonyms: ['narrative', '记叙文', '故事写作', '经历描述'] },
  { name: '看图写作', parent: '写作', subject: '英语', level: 1, sort: 4, synonyms: ['picture writing', '看图作文', '图画描述'] },
  { name: '语法填空', parent: '写作', subject: '英语', level: 1, sort: 5, synonyms: ['grammar填空', '语篇填空', '短文填空'] },
]

// 学科 → 根节点映射
const SUBJECT_ROOTS = {
  '数学': MATH_KNOWLEDGE_TREE,
  '英语': ENGLISH_KNOWLEDGE_TREE,
}

export const migrateKnowledgeTables = async () => {
  try {
    console.log('📦 [迁移036] 开始建立知识点驱动学习数据层...')

    // 1. knowledge_points 表
    if (!(await tableExists('knowledge_points'))) {
      await query(`
        CREATE TABLE knowledge_points (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          parent_id UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '数学',
          level INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER DEFAULT 0,
          synonyms JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `)
      // 索引
      await query(`CREATE INDEX idx_kp_parent ON knowledge_points(parent_id)`)
      await query(`CREATE INDEX idx_kp_subject ON knowledge_points(subject)`)
      await query(`CREATE INDEX idx_kp_name ON knowledge_points(name)`)
      // GIN 索引用于同义词查询
      await query(`CREATE INDEX idx_kp_synonyms ON knowledge_points USING gin(synonyms)`)
      console.log('  ✅ 已创建 knowledge_points 表')
    } else {
      console.log('  ℹ️ knowledge_points 表已存在，跳过')
    }

    // 2. question_knowledge 表（一题多知识点关联）
    if (!(await tableExists('question_knowledge'))) {
      await query(`
        CREATE TABLE question_knowledge (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
          kp_id UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'secondary')),
          weight REAL DEFAULT 1.0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(question_id, kp_id)
        )
      `)
      await query(`CREATE INDEX idx_qk_question ON question_knowledge(question_id)`)
      await query(`CREATE INDEX idx_qk_kp ON question_knowledge(kp_id)`)
      console.log('  ✅ 已创建 question_knowledge 表')
    } else {
      console.log('  ℹ️ question_knowledge 表已存在，跳过')
    }

    // 3. knowledge_mastery 表（学生知识点掌握度）
    if (!(await tableExists('knowledge_mastery'))) {
      await query(`
        CREATE TABLE knowledge_mastery (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          kp_id UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
          mastery REAL DEFAULT 0.0 CHECK (mastery >= 0 AND mastery <= 100),
          total_questions INTEGER DEFAULT 0,
          correct_questions INTEGER DEFAULT 0,
          wrong_questions INTEGER DEFAULT 0,
          consecutive_correct INTEGER DEFAULT 0,
          last_practiced_at TIMESTAMP WITH TIME ZONE,
          history JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(student_id, kp_id)
        )
      `)
      await query(`CREATE INDEX idx_km_student ON knowledge_mastery(student_id)`)
      await query(`CREATE INDEX idx_km_kp ON knowledge_mastery(kp_id)`)
      await query(`CREATE INDEX idx_km_mastery ON knowledge_mastery(mastery DESC)`)
      console.log('  ✅ 已创建 knowledge_mastery 表')
    } else {
      console.log('  ℹ️ knowledge_mastery 表已存在，跳过')
    }

    // 4. 预先插入各学科知识树种子数据（幂等）
    const existingRoots = await query(`SELECT name, subject FROM knowledge_points WHERE level = 0`)
    const existingKey = new Set(existingRoots.rows.map(r => `${r.subject}|${r.name}`))

    for (const [subject, tree] of Object.entries(SUBJECT_ROOTS)) {
      const rootNames = tree.filter(n => n.parent === null).map(n => n.name)
      const allPresent = rootNames.every(n => existingKey.has(`${subject}|${n}`))
      if (allPresent) {
        console.log(`  ℹ️ ${subject}知识树种子数据已存在，跳过`)
        continue
      }

      console.log(`  🌱 正在插入${subject}知识树种子数据...`)

      // 先建所有节点
      const nameToId = {}
      for (const node of tree) {
        const synonyms = JSON.stringify(node.synonyms || [])
        const { rows } = await query(
          `INSERT INTO knowledge_points (name, subject, level, sort_order, synonyms)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING
           RETURNING id, name`,
          [node.name, node.subject, node.level, node.sort, synonyms]
        )
        if (rows.length > 0) {
          nameToId[rows[0].name] = rows[0].id
        } else {
          const { rows: existing } = await query(
            `SELECT id FROM knowledge_points WHERE name = $1 AND subject = $2`,
            [node.name, node.subject]
          )
          if (existing.length > 0) {
            nameToId[node.name] = existing[0].id
          }
        }
      }

      // 再建立父子关系
      let updated = 0
      for (const node of tree) {
        if (!node.parent) continue
        const childId = nameToId[node.name]
        const parentId = nameToId[node.parent]
        if (childId && parentId) {
          await query(
            `UPDATE knowledge_points SET parent_id = $1 WHERE id = $2 AND parent_id IS NULL`,
            [parentId, childId]
          )
          updated++
        }
      }
      console.log(`  ✅ 已插入 ${tree.length} 个${subject}知识点节点，建立 ${updated} 个父子关系`)
    }

    // 5. 如果 knowledge_points 表没有 updated_at 触发器，手动添加
    if (!(await columnExists('knowledge_points', 'updated_at'))) {
      console.log('  ℹ️ knowledge_points 缺少 updated_at，已由建表语句创建')
    }

    console.log('✅ [迁移036] 知识点驱动学习数据层迁移完成')
  } catch (error) {
    console.error('❌ [迁移036] 失败:', error.message)
    console.error(error)
  }
}