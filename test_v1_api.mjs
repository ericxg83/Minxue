import { spawn } from 'child_process'

const PORT = 4123
const BASE = `http://localhost:${PORT}`
const assert = (cond, label) => {
  if (cond) console.log(`  ✅ ${label}`)
  else { console.error(`  ❌ ${label}`); process.exitCode = 1 }
}

const server = spawn('node', ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    // 测试时屏蔽 AI 供应商，让 callTextCompletion 快速失败，避免 LLM 调用挂起。
    // 这样 sync 回填只走「空题判定 + 本地启发式」路径，验证写库逻辑。
    MODELSCOPE_BACKUP_API_KEY: '',
    GEMINI_API_KEY: '',
    AGNES_API_KEY: '',
    SENSENOVA_API_KEY: '',
    FREEMODEL_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let log = ''
server.stdout.on('data', d => { log += d.toString() })
server.stderr.on('data', d => { log += d.toString() })

const waitForHealth = async (timeoutMs = 90000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 1500))
  }
  return false
}

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`)
  return { status: r.status, data: await r.json() }
}

const post = async (path, timeoutMs = 60000) => {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeoutMs)
  try {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', signal: c.signal })
    return { status: r.status, data: await r.json() }
  } finally {
    clearTimeout(t)
  }
}

try {
  console.log(`启动服务器 :${PORT}，等待就绪...`)
  const ok = await waitForHealth()
  assert(ok, '服务器健康检查通过')
  if (!ok) {
    console.log(log.slice(-2000))
    process.exit(1)
  }

  console.log('== 1. GET /api/teaching/error-types ==')
  const et = await get('/api/teaching/error-types')
  assert(et.status === 200 && et.data.success, 'error-types 返回成功')
  console.log(`   ${et.data.errorTypes.map(t => `${t.name}(${t.category})`).join(', ')}`)

  console.log('== 2. GET /api/teaching/diagnosis（本周，全部学科）==')
  const dg = await get('/api/teaching/diagnosis?mode=week&offset=0')
  assert(dg.status === 200 && dg.data.success, 'diagnosis 返回成功')
  console.log(`   本周聚合 ${dg.data.diagnosis.length} 个知识点，按 空题>做错 排序:`)
  for (const d of dg.data.diagnosis.slice(0, 8)) {
    console.log(`   ${d.tag} [${d.subject}] 空题=${d.blankCount} 做错=${d.wrongCount} 涉及${d.studentCount}人 空题占比${d.blankRatio}%`)
  }

  console.log('== 3. GET /api/teaching/diagnosis（subject=数学）==')
  const dgm = await get('/api/teaching/diagnosis?mode=week&offset=0&subject=数学')
  assert(dgm.status === 200 && dgm.data.success, 'diagnosis(subject=数学) 返回成功')
  const allMath = dgm.data.diagnosis.every(d => d.subject === '数学')
  assert(allMath, '过滤后全部为数学')

  console.log('== 4. 下钻：取第一个知识点 ==')
  const first = dg.data.diagnosis[0]
  if (first) {
    const dd = await get(`/api/teaching/diagnosis/${encodeURIComponent(first.tag)}?mode=week&offset=0`)
    assert(dd.status === 200 && dd.data.success, '下钻返回成功')
    assert(Array.isArray(dd.data.sampleQuestions), '下钻返回典型错题（讲义用）')
    console.log(`   知识点「${dd.data.tag}」涉及 ${dd.data.students.length} 个学生，错因分布 ${dd.data.errorDist.length} 项，典型错题 ${dd.data.sampleQuestions.length} 道`)
    for (const s of dd.data.students.slice(0, 6)) {
      console.log(`   ${s.name}${s.grade ? '(' + s.grade + ')' : ''}: 空题=${s.blankCount} 做错=${s.wrongCount}`)
    }
    console.log(`   错因分布（做错题，${dd.data.totalWrong} 道）:`)
    for (const e of dd.data.errorDist.slice(0, 6)) {
      console.log(`   ${e.errorType}: ${e.count}次 (${e.ratio}%)`)
    }
    const sq = dd.data.sampleQuestions[0]
    if (sq) {
      console.log(`   例题样张: ${(sq.content || '').slice(0, 40)} | 作答=${sq.studentAnswer ?? '空'} | 正确=${sq.correctAnswer} | 错因=${sq.errorType || '未标注'}`)
    }
  } else {
    console.log('   ⚠️ 本周无聚合数据（可能是空库），跳过下钻')
  }

  console.log('== 5. 错因回填端点 ==')
  const bf = await post('/api/admin/backfill-diagnosis?sync=1&limit=3')
  assert(bf.status === 200, 'backfill-diagnosis 返回成功')
  console.log(`   进度: ${JSON.stringify(bf.data.progress || bf.data)}`)
} catch (e) {
  console.error('测试异常:', e.message)
  console.log(log.slice(-2000))
  process.exit(1)
} finally {
  server.kill()
}

console.log('\n🎉 V1 后端 HTTP 接口测试完成')
process.exit(process.exitCode || 0)
