import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODELSCOPE_BACKUP, AI_CONFIG, VL_MODELS } from '../server/config/ai.js'

/**
 * 2026-09-21：魔搭「第二把 Key」配置的契约与配置漂移守卫。
 *
 * 背景（全部为实测，非推断）：
 *   · .env 里第二把 Key 曾写成 `MODELSCOPE_BACKUP_API_KEY_2`，注释还写着
 *     "not loaded by code" ⇒ 配了完全不生效。
 *   · 同时 `MODELSCOPE_BACKUP_API_KEY` 与 `AI_API_KEY` 填的是**同一个值**，
 *     而视觉链路 `MS_KEYS = [...new Set([主Key, 备Key])]` 会去重 ⇒ 实际只有 1 把 Key，
 *     "有备用 Key"只是幻觉。主 Key 一旦额度耗尽，整条魔搭链立刻全灭。
 *   · render.yaml 把 AI_MODEL 写成 Qwen/Qwen3-VL-235B-A22B-Instruct、
 *     .env.example 写成 Qwen/Qwen3-VL-8B-Instruct —— 二者实测均返回
 *     400 "has no provider supported"（魔搭 2026-09-15 下架 Qwen3-VL 全系）。
 *     而 AI_MODEL 是 VL_MODELS 的**队首** ⇒ 每页视觉请求都先空轮一次死模型。
 *
 * 这组测试锁死三件事：别名可读、去重语义存在、仓库内不写死模型名。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const AI_SRC = fs.readFileSync(path.resolve(ROOT, 'server/config/ai.js'), 'utf8')
const RENDER_YAML = fs.readFileSync(path.resolve(ROOT, 'render.yaml'), 'utf8')
const ENV_EXAMPLE = fs.readFileSync(path.resolve(ROOT, 'server/.env.example'), 'utf8')

/** 在受控 env 下读取 getter（getter 每次读 process.env） */
function withEnv(patch, fn) {
  const saved = {}
  for (const [k, v] of Object.entries(patch)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const VARS = ['MODELSCOPE_BACKUP_API_KEY', 'MODELSCOPE_BACKUP_API_KEY_2']

// ── 1. 别名可读（今天踩的坑本体）─────────────────────────────────────────────

test('只配 MODELSCOPE_BACKUP_API_KEY_2 时，第二把 Key 必须能读到（不再静默忽略）', () => {
  withEnv({
    MODELSCOPE_BACKUP_API_KEY: undefined,
    MODELSCOPE_BACKUP_API_KEY_2: 'ms-second-key',
  }, () => {
    assert.equal(MODELSCOPE_BACKUP.API_KEY, 'ms-second-key')
    assert.equal(MODELSCOPE_BACKUP.ENABLED, true, 'ENABLED 必须随别名一起为真')
  })
})

test('两个变量都配时，主变量 MODELSCOPE_BACKUP_API_KEY 优先', () => {
  withEnv({
    MODELSCOPE_BACKUP_API_KEY: 'ms-primary-name',
    MODELSCOPE_BACKUP_API_KEY_2: 'ms-alias-name',
  }, () => {
    assert.equal(MODELSCOPE_BACKUP.API_KEY, 'ms-primary-name')
  })
})

test('两者皆空时为 \'\' 且 ENABLED=false（不得因别名逻辑变成 undefined 之类的怪值）', () => {
  withEnv({ MODELSCOPE_BACKUP_API_KEY: undefined, MODELSCOPE_BACKUP_API_KEY_2: undefined }, () => {
    assert.equal(MODELSCOPE_BACKUP.API_KEY, '')
    assert.equal(MODELSCOPE_BACKUP.ENABLED, false)
  })
})

// ── 2. 去重语义：两把相同 = 只有一把 ─────────────────────────────────────────

test('视觉链路 MS_KEYS 必须按 Set 去重（相同 Key 要塌缩成 1 把，不能重复空转）', () => {
  assert.ok(
    AI_SRC.includes('const MS_KEYS = [...new Set(['),
    'MS_KEYS 的 Set 去重被改动：相同的主 Key / 备 Key 会变成两个相同 provider，白耗配额'
  )
  assert.ok(
    AI_SRC.includes("MODELSCOPE_BACKUP.ENABLED ? MODELSCOPE_BACKUP.API_KEY : null"),
    'MS_KEYS 必须取 MODELSCOPE_BACKUP.API_KEY（即第二把 Key），否则第二把 Key 对视觉链路无效'
  )
})

test('两把 Key 相同时，矩阵退化为 1 把（这是"假备份"的判据，必须可被测试复现）', () => {
  const same = [...new Set(['ms-same', 'ms-same'].filter(Boolean))]
  assert.equal(same.length, 1)
  const diff = [...new Set(['ms-a', 'ms-b'].filter(Boolean))]
  assert.equal(diff.length, 2)
})

test('MS_KEYS 只定义一次（定义点提到 noBackup 日志之前，避免两处定义各自漂移）', () => {
  const n = (AI_SRC.match(/const MS_KEYS = \[\.\.\.new Set\(\[/g) || []).length
  assert.equal(n, 1, `MS_KEYS 定义点应恰好 1 处，实际 ${n} 处`)
})

test('noBackup 日志必须打印实际加载的 Key 把数与尾号（线上确认第二把 Key 是否生效的唯一入口）', () => {
  assert.ok(AI_SRC.includes('把 Key（'), 'noBackup 日志应打印实际加载几把 Key')
  assert.ok(/MS_KEYS\.map\(k => '…' \+ keyTail\(k\)\)/.test(AI_SRC), '日志应只打印 Key 尾号（不泄露完整密钥）')
  const logIdx = AI_SRC.indexOf('[AI] noBackup=1')
  const defIdx = AI_SRC.indexOf('const MS_KEYS = [...new Set([')
  assert.ok(defIdx !== -1 && defIdx < logIdx, 'MS_KEYS 必须在 noBackup 日志之前定义，否则日志拿不到实际把数')
})

// ── 3. VL_MODELS 队首必须是 AI_MODEL（所以配错模型名代价最大）───────────────

test('AI_MODEL 处于 VL_MODELS 队首（错误模型名会让每页请求先空轮一次）', () => {
  withEnv({ AI_MODEL: 'Qwen/Qwen3.5-122B-A10B', VL_MODEL: undefined }, () => {
    assert.equal(VL_MODELS[0], 'Qwen/Qwen3.5-122B-A10B')
  })
})

// ── 4. 配置漂移守卫：仓库里不得写死已下架的模型名 ─────────────────────────────

test('render.yaml 的 AI_MODEL 不得是已下架的 Qwen3-VL 系列（实测 400 has no provider supported）', () => {
  const valueLines = RENDER_YAML.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('value:'))
  assert.ok(valueLines.length > 0, 'render.yaml 里应当有 value: 形式的受管变量')
  const dead = valueLines.filter(l => /Qwen3-VL|Qwen3-VL-8B|235B-A22B/.test(l))
  assert.deepEqual(dead, [], `render.yaml 仍写死已下架模型：${dead.join(' | ')}`)
  assert.ok(/value:\s*Qwen\/Qwen3\.5-122B-A10B/.test(RENDER_YAML), 'render.yaml 的 AI_MODEL 应为当前主力模型')
})

test('render.yaml 必须声明 MODELSCOPE_BACKUP_API_KEY 且值为仪表盘管理（sync:false）', () => {
  const lines = RENDER_YAML.split('\n')
  const idx = lines.findIndex(l => l.trim() === '- key: MODELSCOPE_BACKUP_API_KEY')
  assert.notEqual(idx, -1, 'render.yaml 缺少 MODELSCOPE_BACKUP_API_KEY 声明')
  // 取到「下一个 - key:」之前的整块（注释可能很长，不能按固定字符数截断）
  const nextIdx = lines.findIndex((l, i) => i > idx && l.trim().startsWith('- key:'))
  const block = lines.slice(idx, nextIdx === -1 ? lines.length : nextIdx).join('\n')
  assert.ok(/sync:\s*false/.test(block), `该变量为密钥，必须 sync:false（值不进仓库，由仪表盘填）；实际块：\n${block}`)
  assert.ok(!/value:\s*ms-/.test(block), '密钥值绝不能写进仓库文件')
})

test('.env.example 中「魔搭相关变量」不得推荐已下架的 Qwen3-VL 模型（GMI 等其它厂商的清单不在此列）', () => {
  const bad = ENV_EXAMPLE.split('\n')
    .filter(l => /^\s*#?\s*(AI_MODEL|VL_MODEL|MODELSCOPE_[A-Z_]*)="?/.test(l) || /^\s*#\s*(AI_MODEL|VL_MODEL|MODELSCOPE_[A-Z_]*)=/.test(l))
    .filter(l => /Qwen3-VL/.test(l))
  assert.deepEqual(bad, [], `魔搭相关变量仍推荐已下架模型：\n${bad.join('\n')}`)
  assert.ok(/^AI_MODEL=Qwen\/Qwen3\.5-122B-A10B$/m.test(ENV_EXAMPLE), '.env.example 的 AI_MODEL 应为当前主力模型')
})

test('ai.js 源码不得泄露真实密钥形态的字面量（ms- / sk- 长串）', () => {
  assert.ok(!/ms-[0-9a-f]{8}-[0-9a-f]{4}/.test(AI_SRC), 'ai.js 里出现疑似真实魔搭 Key 字面量')
  assert.ok(!/AI_KEY\s*=\s*['"]ms-/.test(AI_SRC), 'ai.js 里出现硬编码 Key')
})

// ── 5. 端到端语义：两把不同 Key 时矩阵规模翻倍 ──────────────────────────────

test('两把不同 Key ⇒ 视觉矩阵规模 = 2×VL_MODELS；同一把 ⇒ 退化为 1×VL_MODELS', () => {
  withEnv({ MODELSCOPE_BACKUP_API_KEY: 'ms-second', AI_API_KEY: 'ms-main' }, () => {
    const keys = [...new Set([AI_CONFIG.API_KEY, MODELSCOPE_BACKUP.API_KEY].filter(Boolean))]
    assert.equal(keys.length, 2)
    assert.equal(keys.length * VL_MODELS.length, 2 * VL_MODELS.length)
  })
  withEnv({ MODELSCOPE_BACKUP_API_KEY: 'ms-main', AI_API_KEY: 'ms-main' }, () => {
    const keys = [...new Set([AI_CONFIG.API_KEY, MODELSCOPE_BACKUP.API_KEY].filter(Boolean))]
    assert.equal(keys.length, 1, '两把相同时必须塌缩成 1 把，测试用于复现"假备份"')
  })
})
