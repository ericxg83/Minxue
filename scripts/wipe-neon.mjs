#!/usr/bin/env node
/**
 * 清空线上 Neon 数据库全部业务数据
 *
 * 用法：
 *   NEON_DATABASE_URL='postgresql://...' node scripts/wipe-neon.mjs
 *
 * 行为：
 *   1. 列出所有 public schema 下的表 + 每张表的当前行数（清空前快照）
 *   2. 一次 TRUNCATE ... CASCADE 把所有表清空（依赖顺序由 CASCADE 自动处理）
 *   3. 再打印一遍行数确认全为 0
 *
 * 注意：此操作不可恢复。被脚本要求输入 'YES-WIPE' 才执行。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// pg 是 server 的依赖（不在根 node_modules），从 server/node_modules 加载。
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../server/node_modules/pg/package.json'))
const pg = require('pg')

const url = process.env.NEON_DATABASE_URL
if (!url) {
  console.error('❌ 缺少 NEON_DATABASE_URL 环境变量')
  console.error('   用法: NEON_DATABASE_URL=postgres://... node scripts/wipe-neon.mjs')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

const tablesRes = await (async () => {
  await client.connect()
  return client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '\\_%' ESCAPE '\\'
    ORDER BY tablename
  `)
})().catch((e) => {
  console.error('❌ 连接或查询失败:', e.message)
  process.exit(2)
})

const tables = tablesRes.rows.map(r => r.tablename)
if (tables.length === 0) {
  console.error('❌ 未找到任何 public 表（库是空的或权限不足）')
  await client.end()
  process.exit(2)
}

console.log(`\n找到 ${tables.length} 张 public 表，开始统计行数：\n`)
const counts = {}
for (const t of tables) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
  counts[t] = rows[0].n
  console.log(`  ${t.padEnd(36)} ${rows[0].n}`)
}

const total = Object.values(counts).reduce((a, b) => a + b, 0)
console.log(`\n合计: ${total} 行\n`)

if (total === 0) {
  console.log('已经是空的，无需清空。')
  await client.end()
  process.exit(0)
}

if (process.argv[2] !== 'YES-WIPE') {
  console.log('⚠️  确认要清空以上全部数据？此操作不可恢复。')
  console.log(`   重新执行: NEON_DATABASE_URL=... node scripts/wipe-neon.mjs YES-WIPE\n`)
  await client.end()
  process.exit(0)
}

console.log('🚨 开始 TRUNCATE … CASCADE …\n')
const quoted = tables.map(t => `"${t}"`).join(', ')
await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`)

console.log('验证清空结果：\n')
for (const t of tables) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)
  const status = rows[0].n === 0 ? '✓' : '✗ 仍有数据'
  console.log(`  ${t.padEnd(36)} ${rows[0].n}  ${status}`)
}

await client.end()
console.log('\n✅ 完成。')