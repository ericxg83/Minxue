import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import dotenv from 'dotenv'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, 'server/.env') })
import { query } from './server/config/neon.js'
// 95 incomplete-missing-difficulty: how many have real content?
const { rows: empty } = await query(`SELECT COUNT(*)::int n FROM questions WHERE difficulty IS NULL AND (is_complete IS NULL OR is_complete=FALSE) AND (content IS NULL OR length(trim(content))<5)`)
const { rows: withContent } = await query(`SELECT COUNT(*)::int n FROM questions WHERE difficulty IS NULL AND (is_complete IS NULL OR is_complete=FALSE) AND content IS NOT NULL AND length(trim(content))>=5`)
console.log('95中内容为空/极短(<5字):', empty[0].n)
console.log('95中有实际内容(>=5字):', withContent[0].n)
const { rows: samples } = await query(`SELECT id, is_complete, question_type, left(content, 40) c FROM questions WHERE difficulty IS NULL AND (is_complete IS NULL OR is_complete=FALSE) AND content IS NOT NULL AND length(trim(content))>=5 LIMIT 6`)
console.log('样例:'); samples.forEach(s=>console.log(`  ${String(s.id).slice(0,8)} complete=${s.is_complete} type=${s.question_type} | ${s.c}`))
process.exit(0)
