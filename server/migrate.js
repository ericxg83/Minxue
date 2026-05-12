import 'dotenv/config'
import { query } from './config/neon.js'

const migrations = [
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS subject VARCHAR(50)`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_tags JSONB DEFAULT '[]'`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS manual_tags JSONB DEFAULT '[]'`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS tags_source VARCHAR(10) DEFAULT 'ai'`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS block_coordinates JSONB`,
]

async function run() {
  console.log('Running database migrations...')
  for (const sql of migrations) {
    try {
      await query(sql)
      console.log(`  ✅ ${sql.substring(0, 60)}...`)
    } catch (err) {
      if (err.code === '42701') {
        console.log(`  ⏭️  Column already exists (skipping)`)
      } else {
        console.error(`  ❌ Failed: ${err.message}`)
      }
    }
  }
  console.log('Done.')
  process.exit(0)
}

run()
