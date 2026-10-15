import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DAY, keySetting } from '../src/store.ts'
import { checkWarnings, warningTexts } from '../src/owner/warnings.ts'
import { getProvider } from '../src/translate/providers.ts'
import { SAMPLE_BALANCE, samplePrices } from './fakes.ts'
import { OWNER_ID, T0 } from './helpers.ts'
import { openPanel } from './panel-helpers.ts'
import { setupDeps } from './setup.ts'

const KEY = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`
const EXPIRES = Date.parse('2026-10-16T20:04:00.002Z')

/** Настройки из базы, ключ OpenRouter — из панели (или из .env), часы — на 14 октября 2026. */
function warned(options: { keyFrom?: 'panel' | 'env'; at?: string } = {}) {
  const fromEnv = options.keyFrom === 'env'
  const ctx = setupDeps({ live: true, envKeys: fromEnv ? { OPENROUTER_API_KEY: KEY } : {} })
  if (!fromEnv) ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), KEY)
  ctx.advance(Date.parse(options.at ?? '2026-10-14T10:00:00Z') - T0)
  const sent = () => ctx.tg.callsOf('sendText').map((call) => call.text)
  return { ...ctx, sent }
}

test('спека: ключ из панели истекает через два дня — что сделать', async () => {
  const ctx = warned()
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [
    'Ключ OpenRouter истекает 16 октября — после этого переводы остановятся. Выпустите новый ключ: https://openrouter.ai/keys — и вставьте его: /start → 🔑 Ключ.',
  ])
})

test('спека: ключ из .env истекает — вписать в .env и перезапустить', async () => {
  const ctx = warned({ keyFrom: 'env' })
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [
    'Ключ OpenRouter истекает 16 октября — после этого переводы остановятся. Выпустите новый ключ: https://openrouter.ai/keys — и впишите его в .env вместо старого (OPENROUTER_API_KEY) и перезапустите бота.',
  ])
})

test('ключ истекает через 4 дня — рано предупреждать', async () => {
  const ctx = warned({ at: '2026-10-12T20:00:00Z' })
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [])
})

test('спека: деньги кончаются — пополнить баланс, примерно сколько переводов осталось', async () => {
  const ctx = warned({ at: '2026-09-01T10:00:00Z' })
  ctx.accounts.state.balance = { ...SAMPLE_BALANCE, account: 0.84, remaining: 0.84, keyLeft: 5 }
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [
    'На OpenRouter осталось $0,84 — это примерно 6 000 переводов. Пополните баланс: https://openrouter.ai/settings/credits',
  ])
})

test('спека: лимит ключа почти исчерпан — поднять лимит или выпустить новый ключ', async () => {
  const ctx = warned({ at: '2026-09-01T10:00:00Z' })
  ctx.accounts.state.balance = { ...SAMPLE_BALANCE, account: 6.53, remaining: 0.84, keyLeft: 0.84 }
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [
    'У ключа OpenRouter до лимита осталось $0,84 — это примерно 6 000 переводов. Поднимите лимит ключа или выпустите новый: https://openrouter.ai/keys',
  ])
})

test('остаток ровно $1 — не предупреждаем', async () => {
  const ctx = warned({ at: '2026-09-01T10:00:00Z' })
  ctx.accounts.state.balance = { ...SAMPLE_BALANCE, account: 1, remaining: 1 }
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [])
})

test('спека: модель уходит через 12 дней — выбрать другую', async () => {
  const ctx = warned({ at: '2026-10-20T10:00:00Z' })
  ctx.accounts.state.balance = { ...SAMPLE_BALANCE, expiresAt: null }
  const prices = samplePrices()
  prices.set('anthropic/claude-haiku-5.5', { ...prices.get('anthropic/claude-haiku-5.5')!, expiresAt: Date.parse('2026-11-01') })
  ctx.accounts.state.prices = prices
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [
    'OpenRouter уберёт модель Claude Haiku 5.5 1 ноября — после этого переводы остановятся. Выберите другую: /start → 🤖 Модель.',
  ])
})

test('модель уходит через 15 дней — рано', async () => {
  const ctx = warned({ at: '2026-10-17T10:00:00Z' })
  ctx.accounts.state.balance = { ...SAMPLE_BALANCE, expiresAt: null }
  const prices = samplePrices()
  prices.set('anthropic/claude-haiku-5.5', { ...prices.get('anthropic/claude-haiku-5.5')!, expiresAt: Date.parse('2026-11-01') })
  ctx.accounts.state.prices = prices
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.deepEqual(ctx.sent(), [])
})

test('спека: без повторов в тот же день, в том числе после перезапуска; назавтра — снова', async () => {
  const ctx = warned()
  await checkWarnings(ctx.deps, OWNER_ID)
  await checkWarnings(ctx.deps, OWNER_ID)
  // Перезапуск: новые зависимости, та же база.
  const restarted = { ...ctx.deps, config: ctx.deps.config }
  await checkWarnings(restarted, OWNER_ID)
  assert.equal(ctx.sent().length, 1)
  ctx.advance(DAY)
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.equal(ctx.sent().length, 2)
})

test('не дошло до владельца — не считается отправленным', async () => {
  const ctx = warned()
  ctx.tg.failNext('sendText', new Error('Telegram недоступен'))
  await checkWarnings(ctx.deps, OWNER_ID)
  await checkWarnings(ctx.deps, OWNER_ID)
  assert.equal(ctx.tg.callsOf('sendText').length, 2)
})

test('провайдер без счёта или нет ключа — проверять нечего', async () => {
  const noKey = setupDeps({ live: true, envKeys: {} })
  await checkWarnings(noKey.deps, OWNER_ID)
  const deepseek = setupDeps({ live: true, envKeys: { DEEPSEEK_API_KEY: `sk-${'a'.repeat(32)}` } })
  deepseek.store.setSetting(OWNER_ID, 'provider', 'deepseek')
  await checkWarnings(deepseek.deps, OWNER_ID)
  assert.equal(noKey.tg.calls.length + deepseek.tg.calls.length, 0)
  assert.equal(noKey.accounts.calls.balance.length + deepseek.accounts.calls.balance.length, 0)
})

test('спека: экран баланса показывает те же предупреждения', async () => {
  const ctx = warned()
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.ok(
    screen.html.includes(
      '⚠️ Ключ OpenRouter истекает 16 октября — после этого переводы остановятся. Выпустите новый ключ: https://openrouter.ai/keys — и вставьте его: /start → 🔑 Ключ.',
    ),
  )
})

test('реестр: без повода — ни одного предупреждения', () => {
  assert.deepEqual(
    warningTexts({
      provider: getProvider('openrouter'),
      keySource: 'panel',
      modelTitle: 'Claude Haiku 5.5',
      balance: SAMPLE_BALANCE,
      price: samplePrices().get('anthropic/claude-haiku-5.5'),
      now: EXPIRES - 10 * DAY,
    }),
    [],
  )
})
