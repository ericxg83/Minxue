// 回归测试：frontendHealth.mjs 的判据必须真能分辨「瞬时中间态」与「持续缺陷」
// 反向自检：把 EDIT_WINDOW_MS 调成 0 → classifyByMtime 应对所有情况都返回 persistent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByMtime, moduleUrlToSource } from '../scripts/frontendHealth.mjs';

test('classifyByMtime：刚写过的文件判为 transient-edit（刷新即好）', () => {
  const now = 1_000_000_000;
  assert.equal(classifyByMtime(now - 5_000, now), 'transient-edit');
  assert.equal(classifyByMtime(now - 60_000, now), 'transient-edit');
});

test('classifyByMtime：很久没动的文件判为 persistent（刷新无用，要改代码）', () => {
  const now = 1_000_000_000;
  assert.equal(classifyByMtime(now - 10 * 60_000, now), 'persistent');
  assert.equal(classifyByMtime(now - 86_400_000, now), 'persistent');
});

test('classifyByMtime：窗口边界取闭区间（正好等于窗口仍算瞬时）', () => {
  const now = 1_000_000_000;
  const w = 120_000;
  assert.equal(classifyByMtime(now - w, now, w), 'transient-edit');
  assert.equal(classifyByMtime(now - w - 1, now, w), 'persistent');
});

test('classifyByMtime：拿不到 mtime 时保守判 persistent，绝不误报成瞬时', () => {
  // 反向自检要点：判据宁可多报缺陷，也不能把真缺陷说成「刷新就好」——
  // 那会让持续白屏被当成偶发而漏掉。
  assert.equal(classifyByMtime(null, 1_000_000_000), 'persistent');
  assert.equal(classifyByMtime(undefined, 1_000_000_000), 'persistent');
  assert.equal(classifyByMtime(NaN, 1_000_000_000), 'persistent');
  // 时钟抖动：mtime 在未来，不可当瞬时
  assert.equal(classifyByMtime(1_000_000_000 + 60_000, 1_000_000_000), 'persistent');
});

test('classifyByMtime：反向自检 —— 窗口设为 0 时全部落persistent', () => {
  const now = 1_000_000_000;
  for (const age of [0, 1, 5_000, 60_000]) {
    assert.equal(classifyByMtime(now - age, now, 0), 'persistent',
      `age=${age}ms 在窗口 0 下必须是 persistent`);
  }
});

test('moduleUrlToSource：剥 query 后映射到仓库内路径，非 /src/ 返回 null', () => {
  const p = moduleUrlToSource('/src/App.jsx?t=1791108179424');
  assert.ok(p && p.replace(/\\/g, '/').endsWith('/src/App.jsx'), `实际=${p}`);
  assert.equal(moduleUrlToSource('/node_modules/.vite/deps/react.js'), null);
  assert.equal(moduleUrlToSource('/@vite/client'), null);
  assert.equal(moduleUrlToSource('/src/不存在的文件.jsx'), null);
});
