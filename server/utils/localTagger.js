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
    { tag: '词汇辨析', keywords: ['词汇', '单词', '词义辨析'] },
    { tag: '名词', keywords: ['名词', '复数', '可数', '不可数'] },
    { tag: '冠词', keywords: ['冠词', 'a/an', 'the'] },
    { tag: '代词', keywords: ['代词', '人称代词', '物主代词'] },
    { tag: '形容词', keywords: ['形容词', '比较级', '最高级'] },
    { tag: '介词', keywords: ['介词'] },
    { tag: '动词时态', keywords: ['时态', '一般现在时', '过去时', '将来时', '进行时', '完成时'] },
    { tag: '被动语态', keywords: ['被动语态', '被动'] },
    { tag: '非谓语动词', keywords: ['非谓语', '不定式', '动名词', '分词'] },
    { tag: '情态动词', keywords: ['情态动词', 'can', 'must', 'should'] },
    { tag: '从句', keywords: ['从句', '定语从句', '状语从句', '宾语从句'] },
    { tag: '完形填空', keywords: ['完形填空'] },
    { tag: '阅读理解', keywords: ['阅读理解', 'reading'] },
    { tag: '书面表达', keywords: ['书面表达', '作文', 'writing'] },
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
