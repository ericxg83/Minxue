/**
 * 试卷题库 · 树形文件夹回归锁（2026-11-07）
 *
 * 需求：左侧做成笔记类 App 的文件夹树，可自由新建、嵌套、拖拽移动；
 *       删除类操作默认不显现。
 *
 * 锁死：
 *   ① 迁移 066 纯加法（只 CREATE TABLE / INDEX IF NOT EXISTS，不碰任何既有表）且已注册；
 *   ② 后端文件夹 CRUD + 防环 + 删文件夹绝不删题目；
 *   ③ folderId 一律走 text 比较（jsonb 裸比较会让整条 SQL 500，见铁律 3）；
 *   ④ 前后端字段名逐字对齐 folder_id / folderId；
 *   ⑤ 主界面不再常驻删除 / 清空按钮。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const MIGRATION = 'server/migrations/066_paper_bank_folders.js'
const ROUTES = 'server/routes/paperBank.js'
const VIEW = 'src/workbench/views/PaperBankWorkbench.vue'
const TREE = 'src/workbench/components/paperBank/PaperBankTree.vue'
const API = 'src/services/apiService.js'
const INDEX = 'server/index.js'

const migrationSrc = stripComments(read(MIGRATION))
const routesSrc = stripComments(read(ROUTES))
const viewSrc = stripComments(read(VIEW))
const treeSrc = stripComments(read(TREE))
const apiSrc = stripComments(read(API))
const indexSrc = stripComments(read(INDEX))

test('迁移 066 是纯加法：只建新表和新索引，不碰任何既有表', () => {
  assert.match(migrationSrc, /CREATE TABLE IF NOT EXISTS paper_bank_folders/)
  assert.match(migrationSrc, /CREATE INDEX IF NOT EXISTS idx_paper_bank_folders_parent/)
  assert.ok(!/ALTER TABLE|DROP TABLE|DROP COLUMN|DELETE FROM/.test(migrationSrc),
    '不得改动或删除任何既有表/数据')
  assert.match(migrationSrc, /information_schema\.columns/, '建完必须实测列数')
  assert.match(indexSrc, /\['migratePaperBankFolders', migratePaperBankFolders\]/,
    '迁移必须注册进启动清单，否则线上永远不建表')
})

test('后端：文件夹增删改查 + 防环，题集归属写 metadata 单键', () => {
  assert.match(routesSrc, /router\.get\('\/folders'/)
  assert.match(routesSrc, /router\.post\('\/folders'/)
  assert.match(routesSrc, /router\.put\('\/folders\/:id'/)
  assert.match(routesSrc, /router\.delete\('\/folders\/:id'/)
  assert.match(routesSrc, /router\.put\('\/papers\/:id\/folder'/)
  assert.match(routesSrc, /async function assertNoCycle/)
  assert.match(routesSrc, /不能把文件夹放进它的子文件夹里/, '树成环必须挡住')
  assert.match(routesSrc, /jsonb_build_object\('folderId', \$2::text\)/,
    '题集归属必须写进已有的 metadata，不新加列')
  assert.match(routesSrc, /folder_id: meta\.folderId/, '/papers 必须把 folder_id 透出给前端')
})

test('删文件夹：子文件夹上移、题集变未归类，一道题都不删', () => {
  assert.match(routesSrc, /UPDATE paper_bank_folders SET parent_id = \$2 WHERE parent_id = \$1/,
    '子文件夹上移一层，不能级联删掉整棵子树')
  assert.match(routesSrc, /metadata = COALESCE\(metadata, '\{\}'::jsonb\) - 'folderId'/)
  assert.ok(!/DELETE FROM resource_questions/.test(routesSrc), '任何路径都不得直接删题目行')
})

test('⛔ folderId 比较必须是 text，不能与裸 jsonb 比较（PG 会 500）', () => {
  assert.match(routesSrc, /metadata->>'folderId' = \$1::text/)
  assert.ok(!/metadata\s*=\s*''/.test(routesSrc), '禁 jsonb 列与空串裸比较')
})

test('前端：树组件承担导航，字段名与后端逐字对齐', () => {
  assert.match(viewSrc, /<PaperBankTree/)
  assert.match(treeSrc, /p\.folder_id/, '树按 folder_id 分组题集')
  assert.match(treeSrc, /f\.parent_id/, '文件夹按 parent_id 组树')
  assert.match(treeSrc, /draggable="true"/, '必须支持拖拽移动')
  assert.match(treeSrc, /isDescendant/, '前端也要挡住把文件夹拖进自己的子树')
  assert.match(treeSrc, /movePaperBankPaper|updatePaperBankFolder/, '移动必须落到 API')
  assert.match(apiSrc, /getPaperBankFolders|createPaperBankFolder|updatePaperBankFolder|deletePaperBankFolder|movePaperBankPaper/)
})

test('删除类操作默认不显现：只在右键/「…」菜单里，且带确认', () => {
  assert.match(treeSrc, /openMenu\(/, '必须有更多操作菜单')
  assert.match(treeSrc, /ElMessageBox\.confirm/, '删除必须二次确认')
  assert.ok(!/class="pb-clear"/.test(viewSrc), '主界面不再常驻「清空全部」')
  assert.ok(!/>删除<\/button>/.test(viewSrc), '题集行不再常驻「删除」按钮')
  assert.ok(!/>删除<\/button>/.test(treeSrc), '树行不再常驻「删除」按钮')
})

test('反向自检：把 folderId 的 text 比较改坏必须判红', () => {
  const broken = routesSrc.replace(/metadata->>'folderId' = \$1::text/, "metadata = ''")
  assert.ok(broken !== routesSrc, '替换点必须命中')
  assert.ok(!/metadata->>'folderId' = \$1::text/.test(broken))
})
