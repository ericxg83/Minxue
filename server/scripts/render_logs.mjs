// scripts/render_logs.mjs
// 从 Render API 拉取生产环境日志
//
// 用法：
//   1) 在 Render 控制台 Account Settings → API Keys 创建 API Key
//   2) 设置环境变量：
//        RENDER_API_KEY=rnd_xxxxxxxxxxxx
//        RENDER_OWNER_ID=tea-xxxxxxxxxxxx    (workspace/team ID)
//        RENDER_SERVICE_ID=srv-xxxxxxxxxxxx  (web service ID)
//   3) 运行：node scripts/render_logs.mjs [minutes_ago] [keyword]
//      例：node scripts/render_logs.mjs 30 3116
//      例：node scripts/render_logs.mjs 60 Workbook
//      例：node scripts/render_logs.mjs 120

const API_KEY = process.env.RENDER_API_KEY
const OWNER_ID = process.env.RENDER_OWNER_ID
const SERVICE_ID = process.env.RENDER_SERVICE_ID
const MINUTES_AGO = parseInt(process.argv[2] || '30', 10)
const KEYWORD = process.argv[3] || ''

if (!API_KEY || !OWNER_ID || !SERVICE_ID) {
  console.error('❌ 缺少环境变量：')
  console.error('   RENDER_API_KEY=rnd_xxx')
  console.error('   RENDER_OWNER_ID=tea-xxx')
  console.error('   RENDER_SERVICE_ID=srv-xxx')
  console.error()
  console.error('获取方式：')
  console.error('  API Key:   https://dashboard.render.com/account/api-keys')
  console.error('  Owner ID:  https://dashboard.render.com/settings (workspace name 下方的 ID)')
  console.error('  Service ID: 在你的 service URL 路径中，例如 dashboard.render.com/web/srv-xxxxx')
  process.exit(1)
}

const BASE_URL = 'https://api.render.com/v1'
const HEADERS = {
  accept: 'application/json',
  authorization: `Bearer ${API_KEY}`,
}

async function fetchLogs({ startTime, endTime, direction = 'backward', limit = 100, text = '' } = {}) {
  const params = new URLSearchParams({
    ownerId: OWNER_ID,
    resource: SERVICE_ID,
    type: 'app', // 只取应用日志（排除 request/build）
    limit: String(Math.min(limit, 100)),
    direction,
  })
  if (startTime) params.set('startTime', startTime)
  if (endTime) params.set('endTime', endTime)
  if (text) params.set('text', text)

  const url = `${BASE_URL}/logs?${params}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json()
}

function formatTime(iso) {
  return iso.replace('T', ' ').replace(/\\.\\d+Z$/, '').replace('Z', '')
}

async function main() {
  const now = new Date()
  const start = new Date(now.getTime() - MINUTES_AGO * 60 * 1000)
  console.log(`📡 拉取 Render 日志：${formatTime(start.toISOString())} ~ ${formatTime(now.toISOString())}`)
  console.log(`   Service: ${SERVICE_ID}`)
  if (KEYWORD) console.log(`   关键词过滤: ${KEYWORD}`)
  console.log()

  let allLogs = []
  let hasMore = true
  let startTime = start.toISOString()
  let page = 0

  while (hasMore && page < 10) {
    page++
    const data = await fetchLogs({ startTime, endTime: now.toISOString(), text: KEYWORD })
    if (data.logs?.length) {
      allLogs = allLogs.concat(data.logs)
    }
    hasMore = data.hasMore === true
    if (hasMore && data.nextEndTime) {
      startTime = data.nextEndTime
    }
  }

  // 按时间正序展示
  allLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))

  console.log(`📋 共 ${allLogs.length} 条日志`)
  console.log('─'.repeat(80))

  for (const log of allLogs) {
    const ts = formatTime(log.timestamp)
    const level = log.labels?.find(l => l.name === 'level')?.value || ''
    const levelTag = level ? `[${level.toUpperCase()}]` : ''
    console.log(`${ts} ${levelTag} ${log.message}`)
  }

  console.log('─'.repeat(80))
  console.log(`✅ 拉取完成 (${allLogs.length} 条)`)
}

main().catch(e => {
  console.error('❌ 失败:', e.message)
  process.exit(1)
})
