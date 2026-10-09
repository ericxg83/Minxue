// 锁死「错题本几何重绘补偿」两道防线（2026-10-09，e7d73b27 案沉淀）：
// 背景：批改流 settle 把初判对的几何资产降级 none（防"判对也花钱"）；之后题被 AI 终裁
// 改错/答案修订重判入册，这些自动路径此前没有复活钩子 ⇒ 错题本里的题永远显示原卷裁片
// （retry_count/last_error 全空，不在 failed 重试预算内，成为永久死角）。
// 防线一（根治）：gradingFinalizer.finalizeRejudgeResult 入册成功后必须调几何复活钩子；
// 防线二（兜底）：pendingTaskRecovery 补偿扫描必须四判据全中 + 限预算，防误捞防烧钱。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── 防线一：改判结算（唯一实现）必须挂几何复活钩子 ──

test('finalizeRejudgeResult 错题入册成功后必须复活几何重绘（自动改判路径的根治钩子）', () => {
  const src = readFileSync(join(root, 'server', 'services', 'gradingFinalizer.js'), 'utf8')
  assert.match(src, /requeueGeometryRedrawOnRejudgeWrong/, '必须 import 几何复活钩子')
  // 钩子必须挂在 wrongQuestionAdded 为真之后（只有真正新增入册才花钱，已在册不重复触发）
  const hookAt = src.indexOf('if (wrongQuestionAdded) {')
  assert.notEqual(hookAt, -1, '钩子必须以 wrongQuestionAdded 为触发条件')
  const callAt = src.indexOf('requeueGeometryRedrawOnRejudgeWrong(question.id', hookAt)
  assert.notEqual(callAt, -1, 'wrongQuestionAdded 分支内必须实际调用钩子')
  assert.ok(callAt - hookAt < 400, '调用必须紧跟入册判定（防挂到无关分支）')
  // 异步钩子绝不阻塞结算主流程：必须 .catch 兜底（改判是老师主操作）
  assert.match(src.slice(callAt, callAt + 200), /\.catch\(/, '钩子必须带 .catch，失败只告警')
})

test('几何复活钩子函数自身必须幂等（completed/pending 跳过，与手动端点不重复花钱）', () => {
  const src = readFileSync(join(root, 'server', 'utils', 'geometryRequeueOnRejudge.js'), 'utf8')
  assert.match(src, /already-completed/, 'completed 必须幂等跳过')
  assert.match(src, /already-pending/, 'pending 必须幂等跳过')
})

// ── 防线二：兜底补偿扫描（覆盖钩子之外的未知死法） ──

const recoverySrc = readFileSync(join(root, 'server', 'pendingTaskRecovery.js'), 'utf8')
const scanBody = recoverySrc.slice(
  recoverySrc.indexOf('async scanGeometryAssets'),
  recoverySrc.indexOf('async scanOverdueGeometry'),
)

test('补偿扫描必须以「在错题本」为硬判据（绝不复活判对的题）', () => {
  assert.match(scanBody, /EXISTS \(SELECT 1 FROM \$\{TABLES\.WRONG_QUESTIONS\}/, '必须 EXISTS 错题本')
})

test('补偿扫描必须排除确定性「不可重绘」结论（last_error 非空不捞，防流程图/表格类重烧）', () => {
  assert.match(scanBody, /COALESCE\(a\.last_error, ''\) = ''/, 'last_error 为空才可复活')
})

test('补偿扫描必须排除已发布产物（幂等：有 dsl- URL 的不再重来）', () => {
  assert.match(scanBody, /clean_geometry_image_url (IS|is) NULL OR .*NOT LIKE '%dsl-%'/, '必须有产物幂等判据')
})

test('补偿扫描必须带 2 小时静默窗 + 预算上限 + 每轮限量（防竞态、防无限烧视觉额度）', () => {
  assert.match(scanBody, /a\.updated_at < NOW\(\) - INTERVAL '2 hours'/, '必须 2 小时静默窗')
  assert.match(scanBody, /COALESCE\(a\.retry_count, 0\) < 2/, '补偿预算必须有限')
  assert.match(scanBody, /LIMIT 5/, '每轮必须限量')
})

test('补偿复活必须递增 retry_count（再失败走 handleRetry 常规预算，终态可收敛）', () => {
  const upd = scanBody.indexOf("SET tikz_status = 'pending', retry_count = $2")
  assert.notEqual(upd, -1, '复活 UPDATE 必须同时置 pending 与递增 retry_count')
  assert.match(scanBody, /\(asset\.rc \|\| 0\) \+ 1/, 'retry_count 必须取 rc+1')
})

test('补偿入队前必须按 assetId 查重（与既有两段同规，web/worker 双进程竞态）', () => {
  assert.match(scanBody, /compensateQueued/, '必须有补偿查重集合')
  assert.match(scanBody, /compensateQueued\.has\(asset\.id\)/, 'add 前必须跳过已在队列的资产')
})
