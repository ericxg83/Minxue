// 回归锁：test/checkSkillRefsScope.test.mjs 不得再 import 未使用的 PLACEHOLDER / EXTERNAL_PATH_LINE
// 背景：r334 删除了这两个死导入（grep 全仓 + 文件内核对：该测试文件只在 import 行与
// 历史注释里出现这两个字样；代码用的是本文件内本地正则 OLD_PLACEHOLDER（line 148）与
// line 182 的源码锁字符串匹配，从未以 PLACEHOLDER(...) / EXTERNAL_PATH_LINE(...) 调用）。
// MARKED / isEphemeralRef / classifyMissingRef 仍在本文件被调用，须保留。
// 属测试套件门禁基线（仓库卫生与门禁基线赛道）死代码清理，行为零变化。
// 反向自检内联合成坏样本（不调 git，规避 Windows EBUSY）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = join(__dirname, '..', 'test', 'checkSkillRefsScope.test.mjs');

// 谓词：该测试文件的 skillRefsKit import 块里是否含某一死说明符（仅匹配 import {} 内独立说明符，
// 避免注释 / 本地 OLD_PLACEHOLDER 正则 / line 182 源码锁字符串里的字样误判）。
function importBlock(content) {
  const m = content.match(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/scripts\/skillRefsKit\.mjs['"]/);
  return m ? m[0] : null;
}
function hasDeadSpec(content, name) {
  const block = importBlock(content);
  if (!block) return false; // 整条 import 都没了 -> 由构建/单测兜底，不在此锁范围
  return new RegExp('(^|[\\s,{])' + name + '([\\s,}]|$)').test(block);
}

test('checkSkillRefsScope.test.mjs 不得再从 skillRefsKit 导入死符号 PLACEHOLDER', () => {
  const content = readFileSync(target, 'utf8');
  assert.equal(hasDeadSpec(content, 'PLACEHOLDER'), false, '仍 import 了未使用的 PLACEHOLDER');
});

test('checkSkillRefsScope.test.mjs 不得再从 skillRefsKit 导入死符号 EXTERNAL_PATH_LINE', () => {
  const content = readFileSync(target, 'utf8');
  assert.equal(hasDeadSpec(content, 'EXTERNAL_PATH_LINE'), false, '仍 import 了未使用的 EXTERNAL_PATH_LINE');
});

test('反向自检：合成含 PLACEHOLDER 的 skillRefsKit import 必须被判红', () => {
  const bad = "import {\n  PLACEHOLDER, MARKED, EXTERNAL_PATH_LINE, isEphemeralRef, classifyMissingRef\n} from '../scripts/skillRefsKit.mjs';";
  assert.equal(hasDeadSpec(bad, 'PLACEHOLDER'), true, '锁未生效：合成坏样本应判红');
  assert.equal(hasDeadSpec(bad, 'EXTERNAL_PATH_LINE'), true, '锁未生效：合成坏样本应判红');
});

test('反向自检：注释 / 本地正则里的 PLACEHOLDER 字样不得误判为死导入', () => {
  const onlyMentions = [
    "import {",
    "  MARKED, isEphemeralRef, classifyMissingRef",
    "} from '../scripts/skillRefsKit.mjs';",
    "const OLD_PLACEHOLDER = /xxx|0nn|placeholder|example/i;",
    "assert.match(src, /if \\(PLACEHOLDER\\.test\\(tok\\)\\)/);",
  ].join('\n');
  assert.equal(hasDeadSpec(onlyMentions, 'PLACEHOLDER'), false, '锁误伤：注释/本地正则里的字样不应判红');
  assert.equal(hasDeadSpec(onlyMentions, 'EXTERNAL_PATH_LINE'), false, '锁误伤：未出现的死符号不应判红');
});
