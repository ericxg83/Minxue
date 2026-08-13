// ============================================================
// 讲义 Word 导出 —— type-summary 回归测试
// 跑法：node test/handout_docx_typesummary.mjs
//
// 验证：题型归纳 block（content 为对象数组）能被 handoutDocxService 正确渲染，
// 不再落入 default 分支输出「[object Object]」乱码，且导出过程不抛错。
// 不依赖网络：构造的讲义不带错题图片。
// ============================================================

import { buildHandoutDocx } from '../server/services/handoutDocxService.js'

const handout = {
  title: '回归测试讲义',
  subject: '数学',
  templateLabel: '备课讲义',
  pages: [
    {
      name: '一元一次方程 · 题型归纳',
      blocks: [
        { type: 'section', content: '本知识点"换着样考"的题型' },
        {
          type: 'type-summary',
          content: [
            {
              type: '一元一次方程 - 应用题',
              description: '通常以解答题出现，设置实际情境列方程',
              example: '某校组织春游，……设未知数列方程',
              tip: '先设元再等量关系，注意单位统一',
            },
            {
              type: '一元一次方程 - 含参方程',
              description: '给定解满足条件，求参数值',
              example: '若 x=2 是方程 ax+3=11 的解，求 a',
              tip: '把解代回方程求参数',
            },
          ],
        },
        { type: 'note', content: '' },
      ],
    },
  ],
}

let failures = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.log(`  ❌ ${name}\n     期望: ${e}\n     实际: ${a}`)
  }
}

let buf
try {
  buf = await buildHandoutDocx(handout)
} catch (e) {
  console.log('  ❌ buildHandoutDocx 抛错:', e.message)
  process.exit(1)
}

check('导出返回 Buffer', Buffer.isBuffer(buf), true)
check('导出的 docx 非空（>2KB）', Buffer.isBuffer(buf) && buf.length > 2000, true)

// 打包后的正文在 zip 的 word/document.xml 里，用 jszip 解压提取后再校验
import JSZip from 'jszip'

let xml = ''
try {
  const zip = await JSZip.loadAsync(buf)
  xml = await zip.file('word/document.xml').async('string')
} catch (e) {
  console.log('  ❌ 无法解压 docx:', e.message)
  process.exit(1)
}

check('正文包含题型名「一元一次方程 - 应用题」', xml.includes('一元一次方程 - 应用题'), true)
check('正文包含「怎么考」字段', xml.includes('怎么考'), true)
check('正文不包含 [object Object] 乱码', !xml.includes('[object Object]'), true)

console.log(failures === 0 ? '\n🎉 Word 导出 type-summary 回归通过' : `\n💥 ${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
