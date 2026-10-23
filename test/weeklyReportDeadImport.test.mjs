// 回归锁：src/utils/weeklyReportGenerator.js 不得再 import 未使用的 buildPaperCSS
// 背景：r333 删除了该死导入（grep 全仓 + 文件内核对：weeklyReportGenerator.js 只在
// import 行与 line 1314 注释里出现 buildPaperCSS 字样，从未以 buildPaperCSS(...) 调用；
// 真正的 embedPaperCssInBody 内嵌由 renderFullHTML（serverPdfExporter）内部处理）。
// renderMathInContainer / preloadKatexFonts 仍在本文件被调用（line 1221 / 1228），须保留。
// 属移动端 PDF 产出物赛道死代码清理，行为零变化。
// 反向自检内联合成坏样本（不调 git，规避 Windows EBUSY）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const weeklyReportGeneratorJs = join(__dirname, '..', 'src', 'utils', 'weeklyReportGenerator.js');

// 谓词：weeklyReportGenerator.js 是否仍从 './pdfGenerator' 导入 buildPaperCSS（死导入）
// 仅匹配 import 语句本身，避免 line 1314 注释里的 "buildPaperCSS" 字样误判。
function importsDeadBuildPaperCss(content) {
  const m = content.match(/import\s*\{[^}]*\}\s*from\s*['"]\.\/pdfGenerator['"]/);
  if (!m) return false; // 整条 pdfGenerator import 都没了 -> 由构建/单测兜底，不在此锁范围
  return /(^|[,\s{])buildPaperCSS([,\s}]|$)/.test(m[0]);
}

test('weeklyReportGenerator.js 不得再从 pdfGenerator 导入死符号 buildPaperCSS', () => {
  const content = readFileSync(weeklyReportGeneratorJs, 'utf8');
  assert.equal(
    importsDeadBuildPaperCss(content),
    false,
    'weeklyReportGenerator.js 仍 import 了未使用的 buildPaperCSS'
  );
});

test('反向自检：合成含 buildPaperCSS 的 pdfGenerator import 必须被判红', () => {
  const bad = "import { buildPaperCSS, renderMathInContainer, preloadKatexFonts } from './pdfGenerator';";
  assert.equal(importsDeadBuildPaperCss(bad), true, '锁未生效：合成坏样本应判红');
});

test('反向自检：注释里的 buildPaperCSS 字样不得误判为死导入', () => {
  const onlyComment = [
    "import { renderMathInContainer, preloadKatexFonts } from './pdfGenerator';",
    '// embedPaperCssInBody：把 buildPaperCSS scoped 内嵌到 body',
  ].join('\n');
  assert.equal(importsDeadBuildPaperCss(onlyComment), false, '锁误伤：注释字样不应判红');
});
