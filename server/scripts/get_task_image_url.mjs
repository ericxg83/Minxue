import { query, TABLES } from '../config/neon.js'

const { rows } = await query(
  `SELECT id, image_url, images, original_name
   FROM ${TABLES.TASKS} WHERE id = $1`,
  ['5107a87c-25c4-442a-a348-6543eb719b01']
)
console.log(JSON.stringify(rows[0], null, 2))
process.exit(0)
