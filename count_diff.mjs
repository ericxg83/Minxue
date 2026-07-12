import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import dotenv from 'dotenv'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })
import { query } from './server/config/neon.js'
const { rows: a } = await query(`SELECT COUNT(*)::int n FROM questions`)
const { rows: b } = await query(`SELECT COUNT(*)::int n FROM questions WHERE difficulty IS NULL`)
const { rows: c } = await query(`SELECT COUNT(*)::int n FROM questions WHERE difficulty IS NULL AND is_complete = TRUE`)
const { rows: d } = await query(`SELECT COUNT(*)::int n FROM questions WHERE difficulty IS NULL AND (is_complete IS NULL OR is_complete = FALSE)`)
console.log('总题数:', a[0].n)
console.log('缺难度(全部):', b[0].n)
console.log('缺难度 且 is_complete=TRUE (回填目标):', c[0].n)
console.log('缺难度 但 is_complete!=TRUE (当前回填条件会跳过):', d[0].n)
process.exit(0)
