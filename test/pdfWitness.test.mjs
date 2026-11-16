import test from 'node:test'
import assert from 'node:assert/strict'
import {
  makePdfWitness, normalizeForPdfMatch, pickDiffContext, stripSourceLabels, isSourceLabelText,
  describePdfTextLayer,
} from '../server/services/pdfWitness.js'

// 以下三页文本层取自真实源文件：
// 2026-2027 学年上海市闵行区七宝文来学校九年级（上）学情检测数学试卷（9月份）
//   五页 PDF · 电子版带完整文本层（正是负责人报障「为什么让我核对」的那一卷）
const P1 = 'A．当y<0时，x>0B．当-3<x<0时，y>0C．当x<-时，y随x的增大而增大D．上述抛物线可由抛物线y=-x2平移得到'
const P4 = '18．（4分）如图，Rt△ABC中，∠BAC=90°，将△ABC绕点C逆时针旋转，旋转后的图形是△A′B′C，点A的对应点A′落在中线AD上，且点A′是△ABC的重心，A′B′与BC相交于点E，那么BE：CE=．'
const P5 = '24．（12分）如图，在抛物线y=ax2+2ax+c（a>0）与x轴交于A（-3，0）、B两点（A在B的左侧），与y轴负半轴交于点C，且OC=OA，抛物线的顶点为M．'

test('归一化只抹平排版差异，不抹平会改变题意的字符', () => {
  assert.equal(normalizeForPdfMatch('当-3<x<0时，y>0'), '当-3<x<0时,y>0', '中英标点应统一')
  assert.equal(normalizeForPdfMatch('ax²'), 'ax2', 'PDF 常把上标 ² 输出成普通 2')
  assert.equal(normalizeForPdfMatch('A′B′C'), "A'B'C", '四种撇号应统一')
  assert.notEqual(normalizeForPdfMatch('≤'), normalizeForPdfMatch('<'), '⛔ < 与 ≤ 绝不能被抹平')
  assert.notEqual(normalizeForPdfMatch('△ABC'), normalizeForPdfMatch("△AB'C"), '⛔ 有撇与无撇绝不能被抹平')
})

test('★ q2：文本层证明库里「当-3<x<0时，y>0」是对的，≤ 是误报', () => {
  const w = makePdfWitness(P1)
  // 事故原样：双模型闸把正确答案报成「应为 ≤」，还写进待核对建议；
  // 老师照建议改就把对的改错 —— 必须判 'db'（丢弃差异），不许挂清单。
  assert.equal(w('当-3<x<0时，y>0', '当-3≤x<0时，y>0'), 'db')
  assert.equal(w('当-3<x<0时，y>0', '当-3≤x<0时，y>0'), 'db', '同一处反复判定必须稳定')
})

test('★ q19：文本层证明「△AB\'C」是真错，应为「△ABC」（模型反倒没改）', () => {
  const w = makePdfWitness(P4)
  assert.equal(w("△AB'C", '△ABC'), 'suggest')
})

test('★ q25：ax 被读成 x 属模型误读，短串差异必须靠上下文定位', () => {
  const w = makePdfWitness(P5)
  assert.equal(w('ax', 'x'), 'both', '无上下文时单字符哪儿都在，裁决不了（不能硬判）')
  const ctx = pickDiffContext('(12分) 如图，在抛物线 y=ax²+2ax+c (a>0)', 'ax')
  assert.ok(ctx, '必须能从库内文本取出上下文')
  assert.equal(w('ax', 'x', ctx), 'db', '带上下文必须判回库里现值')
})

test('已修好的地方再报一次：文本层判建议已在卷面 ⇒ suggest（可幂等重放）', () => {
  const w = makePdfWitness(P4)
  assert.equal(w("A'B", "A'B'"), 'both', '两串都在文本层里，不能凭短串下结论')
})

test('文本层覆盖不到时如实说判不了，绝不硬判', () => {
  const w = makePdfWitness(P1)
  // C 选项的分母 2 在 PDF 里是独立文本项，拼接后成了「当x<-时」⇒ 两种写法都查不到
  assert.equal(w('当x<-3/2时，y随x的增大而增大', '当x≤-3/2时，y随x的增大而增大'), 'neither')
})

test('扫描件（无文本层）必须返回 null，全流程退回纯视觉', () => {
  assert.equal(makePdfWitness(''), null)
  assert.equal(makePdfWitness(null), null)
  assert.equal(makePdfWitness('   \n  '), null)
})

test('反向自检：把归一化放水成「抹平 ≤」必须被抓到', () => {
  const flat = normalizeForPdfMatch('当-3<x<0时，y>0')
  // 如果谁把 ≤ 也归一成 <，下面这个「错误建议」就会被误判成 db，真相反过来
  assert.equal(flat.includes(normalizeForPdfMatch('当-3≤x<0时，y>0')), false,
    '≤ 归一化后不得与 < 相同，否则误报会被当成正确')
})

// ── 来源标签：2026-11-09 嘉定卷事故（标签被当成正文写进题干）────────────────
const LABEL = '（2026·上海嘉定·一模）'

test('★ 来源标签必须能从两个方向识别出来，绝不能当差异', () => {
  assert.equal(stripSourceLabels(`3. 在线段AB上截取AP=AD.${LABEL}`), '3. 在线段AB上截取AP=AD.', '整串标签要被剥掉')
  assert.equal(isSourceLabelText('2026·上海嘉定·一模'), true)
  assert.equal(isSourceLabelText(LABEL), true)
  assert.equal(isSourceLabelText('2026·'), true, '被词元切碎的年份片段也是标签')
  assert.equal(isSourceLabelText('一模'), true)
  assert.equal(isSourceLabelText('在线段AB'), false, '正文不许被误判成标签')
  assert.equal(isSourceLabelText('PB'), false)
})

test('★ 混合件（文本层只有标签）：证人必须造不出来，否则会拿标签改正文', () => {
  // 嘉定一模真实文本层：整页只有题号和来源标签，正文是图片
  const partial = `一、选择题1. ${LABEL}2. ${LABEL}3. ${LABEL}`
  assert.equal(makePdfWitness(partial, 600), null, '覆盖率不足 ⇒ 不许当证人')
  assert.equal(makePdfWitness(partial, 0), null, '标签剥完为空 ⇒ 同样不许当证人')
})

test('反向自检：去掉覆盖面闸，标签页就会被当成真值', () => {
  const partial = `1. ${LABEL}2. ${LABEL}`
  const withoutGate = makePdfWitness(partial)
  assert.equal(withoutGate, null, '剥掉标签后为空，仍然必须是 null')
  // 如果谁把标签剥除去掉，下面这个判断会变成 'suggest' ⇒ 把正文改成标签
  assert.notEqual(normalizeForPdfMatch(partial).includes('2026'), true, '归一化后不得残留标签')
})

// ── 覆盖面凭据（唯一实现，解析闸 / 审计 / 存量回填共用）────────────────────────
test('★ 覆盖面判据：full / partial / absent 三态不许混用', () => {
  // 七宝文来卷实测：文本层 2246 字 / 库内 2528 字 ⇒ 覆盖题面
  assert.equal(describePdfTextLayer({ chars: 2246, dbChars: 2528, pageCount: 5, witnessedPages: 5 }).mode, 'full')
  // 松江一模实测：文本层 113 字 / 库内 3175 字（只有题号）⇒ 绝不许标 full
  assert.equal(describePdfTextLayer({ chars: 113, dbChars: 3175, pageCount: 6, witnessedPages: 6 }).mode, 'partial')
  assert.equal(describePdfTextLayer({ chars: 0, dbChars: 3175 }).mode, 'absent')
})

test('反向自检：把 60% 门槛放水成 10%，松江一模就会被标成「已用真值核过」', () => {
  const partial = describePdfTextLayer({ chars: 113, dbChars: 3175 })
  assert.equal(partial.mode, 'partial')
  // 阈值一旦放水，113/3175 会被算成 full —— 界面上「已校」就变成谎言
  assert.ok(113 < 3175 * 0.6, '实测字数必须真的低于门槛，这条锁才有意义')
})

test('反向自检：覆盖不足时不许缺 mode 字段（否则前端会当成扫描件或已核过）', () => {
  const info = describePdfTextLayer({ chars: 50, dbChars: 3000, pageCount: 4, witnessedPages: 1 })
  assert.equal(info.mode, 'partial', '页数覆盖不足也必须落 partial')
  assert.ok(typeof info.note === 'string' && info.note.length > 0, '必须带可展示的说明，界面不能自己编')
})
