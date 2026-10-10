/**
 * 「下载PDF」落盘链路的回归锁（2026-10-10）
 *
 * 背景（真实事故）：负责人点移动端打印预览页的「下载PDF」按钮，**没有任何文件被保存**。
 * 根因是 2026-10-02 的「死代码清理」批次（commit 4a0fcf6）删掉了这一行：
 *
 *     const { savedTo } = await saveFileToDevice(result.pdfBlob, filename)
 *
 * 它被删的理由是「解构出来的 savedTo 没人读」——eslint no-unused-vars 判定为死声明。
 * 但**这一行的价值在副作用**：它是「下载PDF」按钮唯一真正的落盘动作。
 * 删掉之后，handleExportPDF 只剩 `if (result && result.pdfBlob) → Toast('已下载')`，
 * 于是按钮变成「弹个成功提示、文件从未保存」的假功能。
 * 随后 nativeDownload.js 因「无任何调用方」在 2026-10-04（commit d9ef881）被整模块删除。
 *
 * ⛔ 本锁盯三件事（缺一即判红）：
 *   ① handleExportPDF 里必须真的 `await saveFileToDevice(...)`（不是只生成 blob）；
 *   ② 它的返回值必须被消费（否则会被死代码清理器再次误删 —— 事故的成因就在这里）；
 *   ③ nativeDownload.js 必须同时保留原生（Capacitor Filesystem）与 Web（file-saver）两条落盘分支。
 *
 * ⚠️ 判据是「纯函数探测器 + 反向自检」：见文件末尾，故意喂修复前的写法必须判红，
 *    证明这把锁不是空锁（本仓源码锁纪律，见 test/sourceLockFailClosed.test.mjs）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { anchoredRange } from './sourceLockKit.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 去掉注释：本文件与被锁源码的注释里都会提到这些符号，不能靠注释命中判据 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

const LABEL = 'PrintPreview.handleExportPDF 落盘接线'
const PREVIEW = stripComments(read('src/pages/PrintPreview/index.jsx'))
const DOWNLOAD_PATH = 'src/utils/nativeDownload.js'
const DOWNLOAD = existsSync(join(ROOT, DOWNLOAD_PATH)) ? stripComments(read(DOWNLOAD_PATH)) : ''

/**
 * 纯函数探测器：返回问题清单（空数组 = 接线完好）。抽成纯函数是为了能喂坏样本做反向自检。
 * @param {string} code         PrintPreview 源码（已去注释）
 * @param {string} downloadSrc  nativeDownload.js 源码（已去注释；空串 = 文件不存在）
 * @returns {string[]}
 */
export function scanDownloadWiring(code, downloadSrc) {
  const fails = []

  // ① + ② handleExportPDF 区块内必须真的落盘，且返回值被消费
  const block = anchoredRange(code, 'const handleExportPDF = async () => {', 'const renderPaperHTML', LABEL, fails)
  if (block !== null) {
    const callAt = block.indexOf('await saveFileToDevice(')
    if (callAt < 0) {
      fails.push(`${LABEL}：handleExportPDF 里没有 await saveFileToDevice(...) —— 点「下载PDF」只生成 blob、文件从不落盘`)
    } else if (!/savedTo/.test(block.slice(callAt))) {
      fails.push(`${LABEL}：saveFileToDevice 的返回值没被读取 —— 会被死代码清理器再次整行误删（这正是 2026-10-02 事故成因）`)
    }
  }

  // ③ 落盘工具本身：两条分支都不能少
  if (!downloadSrc.includes('export async function saveFileToDevice')) {
    fails.push(`${DOWNLOAD_PATH}：未导出 saveFileToDevice`)
  } else {
    if (!downloadSrc.includes('Filesystem.writeFile')) {
      fails.push(`${DOWNLOAD_PATH}：丢了原生落盘分支（Capacitor Filesystem）—— App 里下载会弹 PDF 查看器/打印框`)
    }
    if (!downloadSrc.includes('saveAs(blob, filename)')) {
      fails.push(`${DOWNLOAD_PATH}：丢了 Web 落盘分支（file-saver saveAs）—— 浏览器里下载会彻底没反应`)
    }
  }

  return fails
}

// ─────────────────────────── ① 当前树必须零问题 ───────────────────────────

test('⛔ 「下载PDF」必须真的把 PDF 落盘（不许只弹成功提示）', () => {
  assert.deepEqual(
    scanDownloadWiring(PREVIEW, DOWNLOAD),
    [],
    '打印预览页的「下载PDF」落盘链路断了 —— 点按钮会只弹「已下载」但文件从未保存'
  )
})

test('⛔ 落盘工具必须保留原生 + Web 两条分支', () => {
  assert.ok(existsSync(join(ROOT, DOWNLOAD_PATH)),
    `${DOWNLOAD_PATH} 不存在 —— 它是「下载PDF」唯一的落盘实现，曾被当死模块删除过，不许再删`)
})

test('PrintPreview 必须 import 落盘工具（不然调用是未定义符号）', () => {
  assert.match(PREVIEW, /import \{ saveFileToDevice \} from '\.\.\/\.\.\/utils\/nativeDownload'/,
    'PrintPreview 没有引入 saveFileToDevice')
})

// ─────────────────────────── ② 反向自检：探测器非空锁 ───────────────────────────

test('锁健全性：修复前的写法（只生成 blob + 弹提示）必须判红', () => {
  // 2026-10-02 事故后的真实代码形态：没有 saveFileToDevice 调用
  const broken = [
    'const handleExportPDF = async () => {',
    '  const result = await generatePDF(questions)',
    '  if (result && result.pdfBlob) {',
    "    setPdfStage('正在保存到文件…')",
    "    Toast.show({ icon: 'success', content: '已下载到设备文件' })",
    '  }',
    '}',
    'const renderPaperHTML = async () => {}',
  ].join('\n')
  assert.ok(scanDownloadWiring(broken, DOWNLOAD).some((f) => f.includes('没有 await saveFileToDevice')),
    '探测器没抓到「只生成 blob 不落盘」—— 本锁是空锁')
})

test('锁健全性：返回值没被消费的写法必须判红', () => {
  const broken = [
    'const handleExportPDF = async () => {',
    '  const result = await generatePDF(questions)',
    '  if (result && result.pdfBlob) {',
    "    await saveFileToDevice(result.pdfBlob, 'x.pdf')",
    "    Toast.show({ icon: 'success', content: '已下载' })",
    '  }',
    '}',
    'const renderPaperHTML = async () => {}',
  ].join('\n')
  assert.ok(scanDownloadWiring(broken, DOWNLOAD).some((f) => f.includes('返回值没被读取')),
    '探测器没抓到「返回值未消费」—— 这种写法会被死代码清理器再删一次')
})

test('锁健全性：锚点改名必须判红，不得静默通过', () => {
  const renamed = 'const handleExportPDFRenamed = async () => {}\nconst renderPaperHTML = async () => {}'
  assert.ok(scanDownloadWiring(renamed, DOWNLOAD).length > 0,
    'handleExportPDF 锚点不在时必须判红（fail-closed），否则改名即可绕过本锁')
})
