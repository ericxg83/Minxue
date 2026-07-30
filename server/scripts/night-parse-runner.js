/**
 * 夜间自动补解析——手动 CLI 入口
 *
 * 定时触发已内置在后端程序里（services/nightParseService.js，随 index.js 启动注册，
 * 每日 NIGHT_PARSE_TIME 默认 01:23 自动执行），本脚本仅供手动立即跑一轮或演练：
 *
 *   node scripts/night-parse-runner.js [--dry-run]
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
process.env.DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL

const { runNightParse } = await import('../services/nightParseService.js')

await runNightParse({ dryRun: process.argv.includes('--dry-run') })
process.exit(0)
