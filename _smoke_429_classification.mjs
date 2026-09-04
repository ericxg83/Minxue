// 429 分类回归测试：只跑纯函数，不打网络。
// 事故背景（2026-09-04）：旧 isQuotaExhaustedError 匹配面过宽，把
//   `Too Many Requests` / `too many requests` 这类通用 429 reason-phrase
// 当成"账号额度耗尽"，SenseNova 一次并发风暴就把 deepseek-v4-pro
// 按「Key+模型+自然日」拉黑一整天，12/19 题被迫降级到 glm-5.2。
import path from 'path'
import { pathToFileURL } from 'url'

const ROOT = path.resolve('D:/Minxue_App_V3')
const ai = await import(pathToFileURL(path.join(ROOT, 'server/config/ai.js')).href + `?t=${Date.now()}`)

const mk429 = (message) => ({ response: { status: 429, data: { error: { message } } } })

const cases = [
  // [描述, err, 期望 isQuotaExhausted, 期望 isTransientRateLimit]
  ['SenseNova 真·5h 额度耗尽: "usage exceeds frequency limit"',
    mk429('usage exceeds frequency limit'), true, false],
  ['ModelScope 真·当日额度: "exceeded today\'s quota for model X"',
    mk429('exceeded today\'s quota for model Qwen/Qwen3-VL-8B-Instruct'), true, false],
  ['聚合网关余额不足: "insufficient balance"',
    mk429('insufficient balance, please top up'), true, false],
  ['额度耗尽语义: "quota exhausted"',
    mk429('user quota exhausted'), true, false],
  ['HTTP 429 reason-phrase (旧版事故根因): "Too Many Requests"',
    mk429('Too Many Requests'), false, true],
  ['小写 too many requests',
    mk429('too many requests, please slow down'), false, true],
  ['裸 rate limit（无 reached/exceeded）',
    mk429('rate limit exceeded'), false, true],
  // 注意：`rate limit exceeded` 语义上更像瞬时限流（RPM/TPM），收紧后归 transient。
  // 如果哪天发现 SenseNova/MS 真把"额度耗尽"也报成这个字串，再针对性挪回去。
  ['retry after N seconds',
    mk429('Please retry after 30s'), false, true],
  ['非 429 状态一律非额度耗尽也非瞬时限流',
    { response: { status: 500, data: { error: { message: 'internal error' } } } }, false, false],
]

let failed = 0
for (const [desc, err, wantQuota, wantTransient] of cases) {
  const gotQ = ai.isQuotaExhaustedError(err)
  const gotT = ai.isTransientRateLimit(err)
  const ok = gotQ === wantQuota && gotT === wantTransient
  if (!ok) failed += 1
  console.log(`  ${ok ? '✅' : '❌'}  ${desc}\n      quota=${gotQ} (期望 ${wantQuota})  transient=${gotT} (期望 ${wantTransient})`)
}

console.log(`\n===== 分类：TTL 版冷却 =====`)
const fakeKey = 'sk-fake-ttl-test-key-00001'
const fakeModel = 'deepseek-v4-pro'
// 直接调用导出（isModelExhaustedToday 别名指向 isModelExhausted）
if (ai.isModelExhaustedToday(fakeModel, fakeKey)) {
  console.log('  ❌  初始不应处于冷却')
  failed += 1
} else {
  console.log('  ✅  初始不在冷却')
}
// markModelExhausted 是内部函数，只能通过 postWith429Retry 间接触发；
// 这里改成用 cooldownAnswerEngineKey 校验 Key 级冷却独立存在（回归旧行为不变）
ai.cooldownAnswerEngineKey(fakeKey)
console.log(`  ✅  cooldownAnswerEngineKey 仍可用: cooling=${ai.isAnswerEngineKeyCooling(fakeKey)}`)
if (!ai.isAnswerEngineKeyCooling(fakeKey)) failed += 1

console.log(`\n${failed === 0 ? '🎉 全部通过' : `❌ ${failed} 项失败`}`)
process.exit(failed === 0 ? 0 : 1)
