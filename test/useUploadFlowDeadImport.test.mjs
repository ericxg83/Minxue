// 回归锁：src/hooks/useUploadFlow.js 不得再 import 未使用的 apiRequest
// 背景：r332 删除了该死导入（grep 全仓 src/ 仅 import 行命中、零调用；
// apiService 内 apiRequest 仍被 App.jsx / RetryTask / answerOCR 等多处活引用，删除不影响其定义）。
// 属移动端 App 体验赛道死代码清理，行为零变化。
// 反向自检内联合成坏样本（不调 git，规避 Windows EBUSY）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const useUploadFlowJs = join(__dirname, '..', 'src', 'hooks', 'useUploadFlow.js');

// 谓词：useUploadFlow.js 是否仍从 apiService 导入 apiRequest（死导入）
function importsDeadApiRequest(content) {
  const flat = content.replace(/\s+/g, ' ');
  return flat.includes('apiRequest') && flat.includes("from '../services/apiService'");
}

test('useUploadFlow.js 不得再从 apiService 导入死符号 apiRequest', () => {
  const content = readFileSync(useUploadFlowJs, 'utf8');
  assert.equal(
    importsDeadApiRequest(content),
    false,
    'useUploadFlow.js 仍 import 了未使用的 apiRequest'
  );
});

test('反向自检：合成含 apiRequest 的 import 必须被判红', () => {
  const bad = "import { apiRequest, clearStudentCaches, invalidateCache } from '../services/apiService';";
  assert.equal(importsDeadApiRequest(bad), true, '锁未生效：合成坏样本应判红');
});
