import test from 'node:test'
import assert from 'node:assert/strict'
import { checkFigureNumberConsistency } from '../server/utils/figureNumberGuard.js'

const BP_FIGURE = '星期|一|二|三|四|五\n增减/mmHg|+20|-30|-20|+15|+30'
const BP_STEM = '某病人每天下午需测量血压，该病人上周日收缩压120mmHg，下表是该病人这周与前一天相比较收缩压的变化情况，则本周星期五的收缩压是______mmHg.'

// 血压题原案（2026-10-27）：引擎把 −20 误读成 −25，解析算式内部自洽但数据是错的
test('flags a figure value cited in analysis that does not exist in stem/figure', () => {
  const r = checkFigureNumberConsistency({
    analysis: '以上周日120mmHg为基准，将周一到周五的变化量累加：+20-30-25+15+30=+10，所以周五收缩压为120+10=130mmHg。答案为 130',
    content: BP_STEM,
    figureTexts: [BP_FIGURE],
  })
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ['25'])
  assert.ok(r.checked >= 6)
})

test('passes the corrected analysis of the same question', () => {
  const r = checkFigureNumberConsistency({
    analysis: '以上周日120mmHg为基准，将周一到周五的变化量累加：+20-30-20+15+30=+15，所以周五收缩压为120+15=135mmHg。答案为 135',
    content: BP_STEM,
    figureTexts: [BP_FIGURE],
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.missing, [])
})

// 两步应用题：第一步的结果（60）在第二步当数据引用，必须靠 resultsSoFar 放行
test('computed results become legal citations in later chains', () => {
  const r = checkFigureNumberConsistency({
    analysis: '先算每份的量：3×20=60，再算总数：60×3=180。答案为 180',
    content: '把 20 个苹果平均分成 3 堆…',
    figureTexts: ['每堆 20 个'],
  })
  assert.equal(r.ok, true)
})

// 公式常数豁免：周长 (8+5)×2 里的 2 不在数据里，但属于公式常数
test('formula constants do not trigger false alarms', () => {
  const r = checkFigureNumberConsistency({
    analysis: '长方形周长为(8+5)×2=26 厘米。答案为 26',
    content: '长方形的长为 8 厘米，宽为 5 厘米，求周长。',
    figureTexts: ['长 8cm|宽 5cm'],
  })
  assert.equal(r.ok, true)
})

// 解得 x=5 的结论数字可以当后续引用（结论进入 resultsSoFar）
test('conclusion numbers (解得/为) feed forward into later chains', () => {
  const r = checkFigureNumberConsistency({
    analysis: '解方程得 x=5，代入得体积 5×3=15。答案为 15',
    content: '求正方体棱长，再求体积（棱长扩大 3 倍…）',
    figureTexts: ['体积是棱长的 3 倍'],
  })
  assert.equal(r.ok, true)
})

// fail-open：没有图表转录（护栏未就绪/转录失败）一律放行
test('fail-open when no figure transcription exists', () => {
  const r = checkFigureNumberConsistency({
    analysis: '+20-30-25+15+30=+10',
    content: BP_STEM,
    figureTexts: [],
  })
  assert.deepEqual(r, { ok: true, checked: 0, missing: [] })
})

test('fail-open on empty analysis', () => {
  const r = checkFigureNumberConsistency({ analysis: '', content: BP_STEM, figureTexts: [BP_FIGURE] })
  assert.equal(r.ok, true)
})

// 符号不敏感：图中 −20、解析写 20（漏负号不在此闸的射程内，符号闸另有专人）
test('sign-insensitive matching (digit-level guard only)', () => {
  const r = checkFigureNumberConsistency({
    analysis: '变化量累加：+20-30-20+15+30=+15，所以收缩压为 135',
    content: BP_STEM,
    figureTexts: ['+20|-30|20|+15|+30'],
  })
  assert.equal(r.ok, true)
})

// 数据全部只在图里、题干无数字的形态（纯图表题）
test('figure-only data: cites outside the figure are flagged', () => {
  const r = checkFigureNumberConsistency({
    analysis: '从统计图读出：12+15-26+8=9，所以最终为 9',
    content: '根据下图所示的变化过程，求最终结果。',
    figureTexts: ['+12|+15|-8|+8'],
  })
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ['26'])
})

// 小数：4.8 与 24/5 这类等值形态不在本闸射程（数值键按十进制字面归一，分式不算）
test('decimal data in figure matches decimal citation', () => {
  const r = checkFigureNumberConsistency({
    analysis: '总量为 4.8+1.2=6。答案为 6',
    content: '求总量。',
    figureTexts: ['甲 4.8|乙 1.2'],
  })
  assert.equal(r.ok, true)
})

// 纯叙述引用（无算式链）不核对 —— 结论数字可能是计算值，宁漏不误
test('narrative-only citations are out of scope (checked=0)', () => {
  const r = checkFigureNumberConsistency({
    analysis: '由图可知第三周下降了 25，所以答案为 105',
    content: BP_STEM,
    figureTexts: [BP_FIGURE],
  })
  assert.equal(r.checked, 0)
  assert.equal(r.ok, true)
})
