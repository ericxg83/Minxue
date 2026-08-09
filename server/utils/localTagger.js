// 本地规则标签生成 — 零 LLM、零 API、纯关键词匹配。
//
// 设计目标：把上传批改热路径里的"AI 标签生成"替换为确定性的本地分类，
// 彻底消除该步骤的 API 调用与并发压力（429 治理）。
//
// 难度值：本地无法可靠判定，统一返回默认 3（中等），留待每日回填任务用 LLM 修正。
//
// 知识点字典的数据源与 config/ai.js buildTaggingPrompt 中列出的各学科知识点表保持一致，
// 每个知识点配一组关键词/别名；命中任一关键词即打上该标签，可命中多个。

// 学科 → [ { tag: 知识点, keywords: [关键词...] } ]
const SUBJECT_KNOWLEDGE = {
  数学: [
    { tag: '有理数', keywords: ['有理数', '正数', '负数', '相反数', '绝对值'] },
    { tag: '实数', keywords: ['实数', '无理数', '平方根', '算术平方根', '立方根'] },
    { tag: '整数运算', keywords: ['整数', '加减乘除', '四则运算'] },
    { tag: '小数运算', keywords: ['小数'] },
    { tag: '分数运算', keywords: ['分数', '通分', '约分', '最简分数'] },
    { tag: '百分数', keywords: ['百分数', '百分比', '%'] },
    { tag: '比例', keywords: ['比例', '正比', '反比', '比值'] },
    { tag: '代数式', keywords: ['代数式', '整式', '单项式', '多项式', '合并同类项', '因式分解'] },
    { tag: '一次函数', keywords: ['一次函数', '正比例函数', 'y=kx'] },
    { tag: '二次函数', keywords: ['二次函数', '抛物线', '顶点式'] },
    { tag: '反比例函数', keywords: ['反比例函数'] },
    { tag: '函数', keywords: ['函数', '自变量', '定义域', '值域'] },
    { tag: '方程', keywords: ['方程', '一元一次方程', '一元二次方程', '解方程', '根的判别式'] },
    { tag: '方程组', keywords: ['方程组', '二元一次'] },
    { tag: '不等式', keywords: ['不等式', '不等号'] },
    { tag: '一元一次方程', keywords: ['一元一次方程'] },
    { tag: '一元二次方程', keywords: ['一元二次方程', '求根公式', '韦达定理'] },
    { tag: '三角形', keywords: ['三角形', '等腰三角形', '等边三角形', '直角三角形', '中线', '角平分线', '高线'] },
    { tag: '勾股定理', keywords: ['勾股定理', '直角边', '斜边'] },
    { tag: '四边形', keywords: ['四边形', '平行四边形', '矩形', '菱形', '正方形', '梯形'] },
    { tag: '圆', keywords: ['圆', '半径', '直径', '弦', '弧', '圆心', '切线', '圆周角'] },
    { tag: '相似', keywords: ['相似', '相似三角形', '相似比'] },
    { tag: '全等', keywords: ['全等', '全等三角形'] },
    { tag: '三角函数', keywords: ['三角函数', '正弦', '余弦', '正切', 'sin', 'cos', 'tan'] },
    { tag: '平面几何', keywords: ['几何', '线段', '射线', '垂直', '平行', '对顶角', '邻补角'] },
    { tag: '概率', keywords: ['概率', '可能性', '随机'] },
    { tag: '统计', keywords: ['统计', '平均数', '中位数', '众数', '方差', '频率', '扇形图', '条形图'] },
    { tag: '数列', keywords: ['数列', '等差数列', '等比数列', '通项'] },
    { tag: '应用题', keywords: ['应用题'] },
    { tag: '行程问题', keywords: ['行程', '相遇', '追及', '速度', '路程'] },
    { tag: '工程问题', keywords: ['工程', '工作效率', '合作完成'] },
  ],
  物理: [
    { tag: '机械运动', keywords: ['机械运动', '参照物', '匀速', '路程', '速度'] },
    { tag: '声现象', keywords: ['声音', '声现象', '响度', '音调', '音色', '振动'] },
    { tag: '光现象', keywords: ['光现象', '反射', '折射', '光线', '影子'] },
    { tag: '透镜', keywords: ['透镜', '凸透镜', '凹透镜', '焦距', '成像'] },
    { tag: '物态变化', keywords: ['物态变化', '熔化', '凝固', '汽化', '液化', '升华', '凝华'] },
    { tag: '内能', keywords: ['内能', '热量', '比热容', '热值'] },
    { tag: '电路', keywords: ['电路', '串联', '并联', '电流', '电压', '电阻'] },
    { tag: '欧姆定律', keywords: ['欧姆定律'] },
    { tag: '电功率', keywords: ['电功率', '电功', '焦耳'] },
    { tag: '电与磁', keywords: ['磁场', '磁感线', '电磁', '通电导线'] },
    { tag: '力', keywords: ['力', '重力', '弹力', '摩擦力', '牛顿'] },
    { tag: '压强', keywords: ['压强', '大气压', '帕斯卡'] },
    { tag: '浮力', keywords: ['浮力', '阿基米德', '排开', '漂浮', '悬浮'] },
    { tag: '功和机械能', keywords: ['做功', '机械能', '动能', '势能'] },
    { tag: '简单机械', keywords: ['杠杆', '滑轮', '斜面', '机械效率'] },
  ],
  化学: [
    { tag: '物质的变化和性质', keywords: ['物理变化', '化学变化', '物理性质', '化学性质'] },
    { tag: '化学实验', keywords: ['实验', '试管', '酒精灯', '过滤', '蒸发'] },
    { tag: '空气', keywords: ['空气', '氮气'] },
    { tag: '氧气', keywords: ['氧气', '氧化', '燃烧'] },
    { tag: '燃烧与灭火', keywords: ['燃烧', '灭火', '着火点'] },
    { tag: '碳和碳的氧化物', keywords: ['二氧化碳', '一氧化碳', '碳', '木炭'] },
    { tag: '溶液', keywords: ['溶液', '溶解度', '溶质', '溶剂', '饱和'] },
    { tag: '酸碱盐', keywords: ['酸', '碱', '盐', 'pH', '中和', '指示剂'] },
    { tag: '金属', keywords: ['金属', '合金', '金属活动性', '铁', '铜', '铝'] },
    { tag: '化学计算', keywords: ['化学方程式', '摩尔', '相对分子质量', '化合价'] },
  ],
  语文: [
    { tag: '字音字形', keywords: ['字音', '字形', '拼音', '注音', '错别字'] },
    { tag: '词语理解', keywords: ['词语', '词义', '近义词', '反义词'] },
    { tag: '成语运用', keywords: ['成语'] },
    { tag: '病句修改', keywords: ['病句', '修改句子', '语病'] },
    { tag: '标点符号', keywords: ['标点', '标点符号'] },
    { tag: '修辞手法', keywords: ['修辞', '比喻', '拟人', '排比', '夸张'] },
    { tag: '文学常识', keywords: ['文学常识', '作者', '朝代', '名著'] },
    { tag: '古诗词默写', keywords: ['默写', '补写', '上句', '下句'] },
    { tag: '古诗词鉴赏', keywords: ['古诗', '诗词', '鉴赏', '赏析'] },
    { tag: '文言文翻译', keywords: ['翻译', '文言', '实词', '虚词'] },
    { tag: '文言文阅读', keywords: ['文言文'] },
    { tag: '现代文阅读', keywords: ['阅读理解', '现代文', '记叙文', '说明文', '议论文'] },
    { tag: '写作', keywords: ['作文', '写作', '习作'] },
  ],
  英语: [
    // ── 语法：时态/语态/从句/非谓语/虚拟 ──
    { tag: '一般现在时', keywords: ['一般现在时', '第三人称单数', 'does', 'do', 'always', 'usually', 'often', 'every day', 'simple present'] },
    { tag: '一般过去时', keywords: ['一般过去时', '过去式', 'yesterday', 'ago', 'last week', 'simple past', 'did'] },
    { tag: '一般将来时', keywords: ['一般将来时', 'will', 'be going to', 'tomorrow', 'next week', 'simple future'] },
    { tag: '现在进行时', keywords: ['现在进行时', 'present continuous', 'am doing', 'is doing', 'are doing', 'look!', 'now'] },
    { tag: '过去进行时', keywords: ['过去进行时', 'past continuous', 'was doing', 'were doing', 'at that time', 'when ...'] },
    { tag: '现在完成时', keywords: ['现在完成时', 'present perfect', 'have done', 'has done', 'already', 'yet', 'just', 'ever', 'never', 'since', 'for'] },
    { tag: '过去完成时', keywords: ['过去完成时', 'past perfect', 'had done', 'by the time', 'before'] },
    { tag: '将来完成时', keywords: ['将来完成时', 'future perfect', 'will have done', 'by next year'] },
    { tag: '被动语态', keywords: ['被动语态', 'passive voice', 'be done', 'be made', 'be + 过去分词', 'be + p.p.', 'by + sb.'] },
    { tag: '宾语从句', keywords: ['宾语从句', 'object clause', 'that 从句', 'if/whether', 'whether', '疑问词 + 动词原形'] },
    { tag: '定语从句', keywords: ['定语从句', 'attributive clause', '关系代词', '关系副词', 'that/which/who/whom/whose', 'where/when/why'] },
    { tag: '状语从句', keywords: ['状语从句', 'adverbial clause', '时间状语从句', '条件状语从句', '原因状语从句', 'if', 'because', 'when', 'although', 'as soon as'] },
    { tag: '主语从句', keywords: ['主语从句', 'subject clause', 'it 作形式主语', 'what 引导主语从句'] },
    { tag: '名词性从句', keywords: ['名词性从句', 'noun clause', '表语从句', '同位语从句'] },
    { tag: '非谓语动词', keywords: ['非谓语', 'non-finite', '不定式', '动名词', '分词', 'to do', 'doing', 'done', 'to + v.', 'v.-ing'] },
    { tag: '不定式', keywords: ['不定式', 'infinitive', 'to do', 'to + v.', '不定式作宾语', '不定式作目的状语'] },
    { tag: '动名词', keywords: ['动名词', 'gerund', 'doing', 'v.-ing', 'enjoy doing', 'mind doing', 'practice doing'] },
    { tag: '分词', keywords: ['分词', 'participle', '现在分词', '过去分词', '-ing 分词', '-ed 分词', 'v.-ing', 'v.-ed', 'p.p.'] },
    { tag: '情态动词', keywords: ['情态动词', 'modal verb', 'can', 'could', 'may', 'might', 'must', 'should', 'would', 'need', 'had better', 'be able to'] },
    { tag: '虚拟语气', keywords: ['虚拟语气', 'subjunctive', 'if 虚拟', 'wish + 虚拟', 'as if', 'would rather'] },
    { tag: '主谓一致', keywords: ['主谓一致', 'subject-verb agreement', '就近原则', '就远原则', 'each/every + 单数', 'and 连接主语'] },
    { tag: '倒装句', keywords: ['倒装', 'inversion', '完全倒装', '部分倒装', 'never/only/hardly 倒装', 'so ... that', 'such ... that'] },
    { tag: '强调句', keywords: ['强调', 'emphatic', 'it is/was ... that', '强调结构'] },
    { tag: 'it 用法', keywords: ['it 用法', '形式主语', '形式宾语', 'it 作代词', 'it is + adj. + to do', 'it takes sb. some time to do'] },
    { tag: '感叹句', keywords: ['感叹', 'exclamatory', 'what + n. + !', 'how + adj./adv. + !', 'how + 句子'] },
    { tag: '祈使句', keywords: ['祈使', 'imperative', 'let 句型', 'do 型', '动词原形开头'] },
    { tag: '疑问句', keywords: ['疑问句', 'interrogative', '一般疑问句', '特殊疑问句', '反意疑问句', 'tag question', '选择疑问句'] },
    { tag: 'there be 句型', keywords: ['there be', '存在句', 'there is/are', 'there was/were', 'there will be', 'there have been'] },

    // ── 词法：词性/词形 ──
    { tag: '名词', keywords: ['名词', 'noun', '可数名词', '不可数名词', '名词复数', '名词所有格', 'a/an + n.', 'the + n.'] },
    { tag: '冠词', keywords: ['冠词', 'article', 'a/an', 'the', '零冠词', '元音音素', '辅音音素'] },
    { tag: '代词', keywords: ['代词', 'pronoun', '人称代词', '物主代词', '反身代词', '不定代词', 'some/any', 'each/every', 'one/ones'] },
    { tag: '形容词副词', keywords: ['形容词', '副词', 'adjective', 'adverb', '比较级', '最高级', '原级比较', 'as ... as', 'more ... than', 'the most'] },
    { tag: '介词', keywords: ['介词', 'preposition', '时间介词', '方位介词', '介词短语', 'in/on/at', 'by/with/of'] },
    { tag: '连词', keywords: ['连词', 'conjunction', 'and/but/or/so/because/although/when/while/if'] },
    { tag: '数词', keywords: ['数词', 'numeral', '基数词', '序数词', '分数', '百分数'] },

    // ── 词汇 ──
    { tag: '词汇辨析', keywords: ['词汇辨析', '词义辨析', '近义词', '反义词', '形近词', 'word discrimination'] },
    { tag: '固定搭配', keywords: ['固定搭配', 'collocation', '短语搭配', '动词短语', 'phrasal verb', 'look forward to', 'be used to', 'get used to'] },
    { tag: '词组短语', keywords: ['词组', '短语', 'phrasal verb', '动词短语', '介词短语', 'take off', 'put on', 'look after'] },
    { tag: '构词法', keywords: ['构词法', 'word formation', '前缀', '后缀', '派生', '合成', 'un-', 're-', 'in-', '-tion', '-ment', '-ful', '-less'] },

    // ── 阅读/完形/语法填空/写作 ──
    { tag: '阅读理解', keywords: ['阅读理解', 'reading comprehension', 'reading'] },
    { tag: '主旨大意', keywords: ['主旨大意', 'main idea', '主旨题', '文章大意', '标题选择', 'best title'] },
    { tag: '细节理解', keywords: ['细节理解', 'detail', '细节题', '事实细节', '信息定位', 'according to the passage'] },
    { tag: '推理判断', keywords: ['推理判断', 'inference', '推理题', '推断题', '隐含意义', 'can be inferred', 'we can learn that'] },
    { tag: '词义猜测', keywords: ['词义猜测', 'word guessing', '猜词题', '词义推断', 'the word ... means'] },
    { tag: '作者态度', keywords: ['作者态度', 'author attitude', '态度题', '观点态度', 'the author thinks', 'the writer believes'] },
    { tag: '七选五', keywords: ['七选五', '句子还原', '补全短文', 'sentence insertion'] },
    { tag: '完形填空', keywords: ['完形填空', 'cloze', '完形'] },
    { tag: '语法填空', keywords: ['语法填空', 'grammar 填空', '语篇填空', '短文填空', '用所给词的适当形式填空'] },
    { tag: '短文改错', keywords: ['短文改错', 'proofreading', 'error correction', '短文纠错'] },
    { tag: '翻译', keywords: ['翻译', 'translation', '英译汉', '汉译英', '中译英'] },
    { tag: '书面表达', keywords: ['书面表达', 'writing', '作文', 'composition'] },
    { tag: '书信写作', keywords: ['书信', 'letter', '邮件', '邀请信', '感谢信', '道歉信', '建议信'] },
    { tag: '议论文写作', keywords: ['议论文', 'argumentative', '观点表达', '利弊分析', 'opinion', 'agree or disagree'] },
    { tag: '记叙文写作', keywords: ['记叙文', 'narrative', '故事写作', '经历描述', 'an unforgettable experience'] },
    { tag: '看图写作', keywords: ['看图写作', 'picture writing', '看图作文', '图画描述', 'describe the picture'] },
    { tag: '应用文', keywords: ['应用文', 'notice', 'poster', 'invitation', '日记', '启事', '通知'] },
  ],
}

// 无学科时用于粗判学科的信号词
const SUBJECT_HINTS = {
  数学: ['方程', '函数', '三角形', '几何', '分数', '计算', '求', '面积', '周长', '概率'],
  物理: ['电流', '电压', '电阻', '力', '速度', '浮力', '压强', '透镜', '功率', '磁'],
  化学: ['化学', '溶液', '氧气', '化合价', '方程式', '酸', '碱', '盐', '金属', '燃烧'],
  语文: ['诗', '词', '文言', '成语', '句子', '阅读', '作文', '作者', '修辞'],
  英语: ['word', 'the', 'reading', '时态', '单词', '英语', '从句', '完形'],
}

const guessSubject = (content) => {
  let best = null
  let bestScore = 0
  for (const [subject, hints] of Object.entries(SUBJECT_HINTS)) {
    let score = 0
    for (const h of hints) {
      if (content.includes(h)) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = subject
    }
  }
  return best
}

/**
 * 本地规则分类：根据题干关键词匹配知识点标签。
 * 纯本地计算，绝不调用任何 LLM / 网络。
 *
 * @param {string} content 题干（可含选项拼接）
 * @param {string|null} subject 已知学科，缺省则本地粗判
 * @returns {{ tags: string[], difficulty: number }} difficulty 恒为 3（默认中等，留待回填）
 */
export function classifyQuestionLocally(content, subject = null) {
  const text = String(content || '').trim()
  if (!text) return { tags: ['未分类'], difficulty: 3 }

  const resolvedSubject = subject && SUBJECT_KNOWLEDGE[subject]
    ? subject
    : guessSubject(text)

  const matched = []

  const matchIn = (subj) => {
    const dict = SUBJECT_KNOWLEDGE[subj]
    if (!dict) return
    for (const { tag, keywords } of dict) {
      if (keywords.some(kw => text.includes(kw))) matched.push(tag)
    }
  }

  if (resolvedSubject) {
    matchIn(resolvedSubject)
  } else {
    // 学科未知且粗判失败 → 全学科扫一遍，尽量给出标签
    for (const subj of Object.keys(SUBJECT_KNOWLEDGE)) matchIn(subj)
  }

  const tags = matched.length > 0 ? matched : ['未分类']
  return { tags, difficulty: 3 }
}
