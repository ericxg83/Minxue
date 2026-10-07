// 回归测试（r237）：frontendHealth.mjs 的结论文案 —— 「没查」不许说成「正常」
//
// 缺陷（`scripts/frontendHealth.mjs:193`，2026-10-07 实测）：
//   `result.bad.length === 0 && !dom.blank`
//   dom 只有真启动浏览器才带 blank；跑 --no-dom 时 dom = {skipped:true}
//   ⇒ dom.blank === undefined ⇒ !undefined === true ⇒ **真白屏也判「首页正常」exit 0**，
//   结论还替没查的那半边背书「DOM 有内容」。
//
// 反向自检（不看红条数看颜色）：基线的三个输入在「旧判据」下必须判绿（= 洞是真的），
// 同一批输入在新判据下必须判红。基线由探针脚本导出到 R237_OLD_SNIPPET 指向的文件，
// ⛔ 不用 spawnSync 调 git（Windows 稳定 EBUSY）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { decideFrontendVerdict } from '../scripts/frontendHealth.mjs';

const OLD_SNIPPET = process.env.R237_OLD_SNIPPET || '';
const hasBaseline = Boolean(OLD_SNIPPET) && existsSync(OLD_SNIPPET);

const BLANK_TRUE = { blank: true, rootChildren: 0, rootHTMLLen: 0, textLen: 0 };
const BLANK_FALSE = { blank: false, rootChildren: 12, rootHTMLLen: 9000, textLen: 300 };

test('decideFrontendVerdict：--no-dom（dom.skipped）不许判健康，也不许说「DOM 有内容」', () => {
  const r = decideFrontendVerdict([], { skipped: true });
  assert.equal(r.status, 'dom-not-checked');
  assert.equal(r.exitCode, 4);
  assert.ok(!r.headline.includes('首页正常'), `不得替没查的白屏背书，实际=${r.headline}`);
  assert.ok(!r.headline.includes('有内容'), `不得说「DOM 有内容」，实际=${r.headline}`);
  assert.ok(r.headline.includes('没盯') || r.headline.includes('没启动浏览器'), '必须说清这一项等于没盯');
});

test('decideFrontendVerdict：浏览器启动失败（dom.error）同样不许判健康', () => {
  const r = decideFrontendVerdict([], { error: '浏览器启动失败' });
  assert.equal(r.status, 'dom-not-checked');
  assert.equal(r.exitCode, 4);
  assert.ok(!r.headline.includes('首页正常'));
});

test('decideFrontendVerdict：白屏层真跑了且正常 ⇒ 才准给健康 exit 0', () => {
  const r = decideFrontendVerdict([], BLANK_FALSE);
  assert.equal(r.status, 'healthy');
  assert.equal(r.exitCode, 0);
  assert.ok(r.headline.includes('DOM 有内容'));
});

test('decideFrontendVerdict：真白屏（模块链仍全 200）⇒ persistent，绝不喂 healthy', () => {
  const r = decideFrontendVerdict([], BLANK_TRUE);
  assert.equal(r.status, 'persistent');
  assert.equal(r.exitCode, 1);
});

test('decideFrontendVerdict：模块链有 persistent 失败 ⇒ persistent（与白屏层结论不冲突）', () => {
  const r = decideFrontendVerdict([{ verdict: 'persistent' }], BLANK_FALSE);
  assert.equal(r.status, 'persistent');
  assert.equal(r.exitCode, 1);
});

test('decideFrontendVerdict：模块链有 transient-edit 失败 ⇒ transient-edit（刷新即可）', () => {
  const r = decideFrontendVerdict([{ verdict: 'transient-edit' }], BLANK_FALSE);
  assert.equal(r.status, 'transient-edit');
  assert.equal(r.exitCode, 2);
});

// ── 反向自检：旧基线的同一批输入，必须判「绿」= 那三个洞是真的 ────────────────

test('反向自检：基线图样确实就是修复前的旧判据（元判据，防基线抄错）', async (t) => {
  if (!hasBaseline) return t.skip('基线快照不存在（R237_OLD_SNIPPET 未设）');
  const src = readFileSync(OLD_SNIPPET, 'utf8');
  // 旧判据的命门：拿 dom.blank 直接取反，且没有 domChecked 这层门
  assert.ok(src.includes('!dom.blank'), '基线里必须能找到旧判据 !dom.blank');
  assert.ok(!src.includes('dom-not-checked'), '基线必须来自修复前（不该有新的 dom-not-checked 状态）');
  assert.ok(/export function /.test(src), '基线必须把旧判据导出成函数，探针才调得到');
});

test('反向自检：旧判据对「--no-dom + 真白屏」判健康（红），新判据判红', async (t) => {
  if (!hasBaseline) return t.skip('基线快照不存在（R237_OLD_SNIPPET 未设）');
  const mod = await import(pathToFileURL(OLD_SNIPPET).href);
  const oldFn = mod.decideFrontendVerdictOld || mod.decideFrontendVerdict;
  assert.ok(oldFn, '基线必须导出 decided 版本');

  // ① --no-dom：旧版判健康 exit 0（这就是那个洞）
  const oldSkipped = oldFn([], { skipped: true });
  assert.equal(oldSkipped.status, 'healthy', '旧判据在 --no-dom 下必须判健康（证明洞是真的）');
  assert.equal(oldSkipped.exitCode, 0);
  // ② 浏览器启动失败：旧版同样漏
  assert.equal(oldFn([], { error: 'boom' }).status, 'healthy');
  // ③ 同一批输入在新判据下必须红
  assert.equal(decideFrontendVerdict([], { skipped: true }).status, 'dom-not-checked');
  assert.equal(decideFrontendVerdict([], { error: 'boom' }).status, 'dom-not-checked');
});

test('反向自检：--no-dom 场景下旧版结论含「首页正常…DOM 有内容」，新版必须不含', async (t) => {
  if (!hasBaseline) return t.skip('基线快照不存在（R237_OLD_SNIPPET 未设）');
  const src = readFileSync(OLD_SNIPPET, 'utf8');
  assert.ok(
    src.includes('首页正常：模块链全 200，DOM 有内容。'),
    '基线必须逐字含旧的背书文案（证明基线抄对了，不是我编的）',
  );
  const mod = await import(pathToFileURL(OLD_SNIPPET).href);
  const oldFn = mod.decideFrontendVerdictOld || mod.decideFrontendVerdict;
  assert.ok(oldFn([], { skipped: true }).headline.includes('首页正常'));
  assert.ok(!decideFrontendVerdict([], { skipped: true }).headline.includes('首页正常'));
});
