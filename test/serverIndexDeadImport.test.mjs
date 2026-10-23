// 回归锁：server/index.js 不得再 import 未使用的 replaceResourceAnswers
// 背景：r331 删除了该死导入（全仓零引用，仅 neonService 定义 + resources.js 直连导入，
// 无任何文件从 ./index.js 反向导入），属服务端基础设施赛道死代码清理。
// 反向自检内联合成坏样本（不调 git，规避 Windows EBUSY）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexJs = join(__dirname, '..', 'server', 'index.js');

// 谓词：server/index.js 是否仍从 neonService 导入 replaceResourceAnswers（死导入）
function importsDeadSymbol(content) {
  const flat = content.replace(/\s+/g, ' ');
  return flat.includes('replaceResourceAnswers') && flat.includes("from './services/neonService.js'");
}

test('server/index.js 不得再从 neonService 导入死符号 replaceResourceAnswers', () => {
  const content = readFileSync(indexJs, 'utf8');
  assert.equal(
    importsDeadSymbol(content),
    false,
    'server/index.js 仍 import 了未使用的 replaceResourceAnswers'
  );
});

test('反向自检：合成含 replaceResourceAnswers 的 index 必须被判红', () => {
  const bad = "import { createJudgement, replaceResourceAnswers } from './services/neonService.js';";
  assert.equal(importsDeadSymbol(bad), true, '锁未生效：合成坏样本应判红');
});
