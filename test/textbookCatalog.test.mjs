import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TEXTBOOK_CATALOG,
  buildChapterTree,
  getCatalogForGrade,
  normalizeCatalogKey,
  resolveChapter,
} from '../server/config/textbookCatalog.js'

test('标准教材目录：八、九年级数学逐章逐节存在，且 id 唯一', () => {
  const grades = TEXTBOOK_CATALOG.map(c => c.grade).sort()
  assert.deepEqual(grades, ['初三', '初二'])
  const ids = new Set()
  for (const catalog of TEXTBOOK_CATALOG) {
    assert.equal(catalog.subject, '数学')
    assert.equal(catalog.edition, '上海五四制')
    for (const n of catalog.nodes) {
      assert.ok(!ids.has(n.id), `章节 id 重复: ${n.id}`)
      ids.add(n.id)
    }
  }
  assert.ok(getCatalogForGrade('初三').nodes.length >= 4, '九年级至少覆盖第27~30章')
  assert.ok(getCatalogForGrade('初二').nodes.length >= 4, '八年级至少覆盖第18~22章')
})

test('resolveChapter：OCR / 任务名的编号映射到标准节点，不输出 OCR 标题', () => {
  // 0292 题干里的 27.2(3) 映射到标准课时
  const hit1 = resolveChapter('初三', '27.2(3)', '27.2(3)形如y=a(x+m)²的二次函数的图像与性质', '')
  assert.equal(hit1?.id, 'g9-c27-s2-3')
  assert.equal(hit1?.name, '27.2(3) 形如y=a(x+m)²的图像与性质')
  // 任务名带 27.4（1）→ 标准节
  const hit2 = resolveChapter('初三', '', '', '27.4（1）二次函数与一元二次方程（1）')
  assert.equal(hit2?.id, 'g9-c27-s4')
  // 28.1(3) 的 OCR 乱标题会被编号归到标准节点，而不是展示乱标题
  const hit3 = resolveChapter('初三', '28.1(3)', '平分线分线段成比例定理 2', '')
  assert.equal(hit3?.id, 'g9-c28-s1-3')
  assert.equal(hit3?.name, '28.1(3) 平行线分线段成比例定理的推论')
  // 未识别返回 null
  assert.equal(resolveChapter('初三', '', '', '数学 · 九上上海作业答案'), null)
  assert.equal(resolveChapter('初三', '未知', '', '第01周'), null)
})

test('buildChapterTree：树形结构包含年级根、章、节，按教材顺序排序', () => {
  const tree = buildChapterTree('初三')
  assert.equal(tree[0].value, 'g9')
  const chapters = tree[0].children
  assert.deepEqual(chapters.map(c => c.value), ['g9-c27', 'g9-c28', 'g9-c29', 'g9-c30'])
  const c27 = chapters[0]
  assert.equal(c27.label, '第27章 二次函数')
  const s2 = c27.children.find(c => c.value === 'g9-c27-s2')
  assert.deepEqual(s2.children.map(c => c.value), [
    'g9-c27-s2-1',
    'g9-c27-s2-2',
    'g9-c27-s2-3',
    'g9-c27-s2-4',
    'g9-c27-s2-5',
  ])
})

test('normalizeCatalogKey：全角括号、上标、空白归一', () => {
  assert.equal(normalizeCatalogKey('27.2（3）y=a(x+m)²'), '27.2(3)y=a(x+m)2')
  assert.equal(normalizeCatalogKey(' 27 . 4 ( 1 ) '), '27.4(1)')
})
