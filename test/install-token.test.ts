import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callBotApi } from '../src/install/bot-api.ts'
import { OPENROUTER_UNREACHABLE, TELEGRAM_UNREACHABLE, connectivityStep } from '../src/install/connectivity.ts'
import { ENV_TOKEN_REJECTED, TOKEN_REJECTED_TEXT, tokenStep } from '../src/install/token.ts'
import { TOKEN, fakeFetch, fakeIo, json, setupContext } from './install-fakes.ts'

const OTHER_TOKEN = '8123456789:AAF-new-token-9876543210zyxwvutsrqpo'
const GET_ME_OK = () => json({ ok: true, result: { id: 8123456789, is_bot: true, username: 'aIrtem_tg_translator_bot' } })
const UNAUTHORIZED = () => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401)

test('callBotApi: ответ, ошибка Telegram и обрыв сети различаются', async () => {
  const ok = fakeFetch(() => GET_ME_OK())
  assert.deepEqual(await callBotApi(ok.fetchImpl, TOKEN, 'getMe'), {
    kind: 'ok',
    result: { id: 8123456789, is_bot: true, username: 'aIrtem_tg_translator_bot' },
  })
  assert.equal(ok.calls[0]!.url, `https://api.telegram.org/bot${TOKEN}/getMe`)

  const refused = fakeFetch(UNAUTHORIZED)
  assert.deepEqual(await callBotApi(refused.fetchImpl, TOKEN, 'getMe'), { kind: 'error', code: 401, description: 'Unauthorized' })

  const offline = fakeFetch(() => new TypeError('fetch failed'))
  assert.deepEqual(await callBotApi(offline.fetchImpl, TOKEN, 'getMe'), { kind: 'network' })

  const html = fakeFetch(() => new Response('<html>502</html>', { status: 502 }))
  assert.deepEqual(await callBotApi(html.fetchImpl, TOKEN, 'getMe'), { kind: 'error', code: 502, description: '' })
})

test('спека: Telegram недоступен — остановка с текстом про VPN, вопросов нет', async () => {
  const { io, output } = fakeIo()
  const { fetchImpl } = fakeFetch(() => new TypeError('fetch failed'))
  const result = await connectivityStep.run(setupContext({ io, fetch: fetchImpl }))
  assert.deepEqual(result, { ok: false, reason: TELEGRAM_UNREACHABLE })
  assert.equal(
    TELEGRAM_UNREACHABLE,
    'Не достучаться до Telegram. Если вы в России — включите VPN на весь компьютер, не только в браузере, ' +
      'и запустите команду ещё раз.',
  )
  assert.deepEqual(output, [])
})

test('спека: OpenRouter недоступен — предупреждение, установка продолжается', async () => {
  const { io, text } = fakeIo()
  const { fetchImpl } = fakeFetch((url) => (url.includes('openrouter.ai') ? new TypeError('fetch failed') : new Response('', { status: 302 })))
  const result = await connectivityStep.run(setupContext({ io, fetch: fetchImpl }))
  assert.deepEqual(result, { ok: true })
  assert.match(text(), /OpenRouter недоступен — переводить через него не получится, пока не включите VPN/)
  assert.ok(text().includes(OPENROUTER_UNREACHABLE))
})

test('связь: любой ответ сервера — значит, достучались, даже 401 и перенаправление', async () => {
  const { io, output } = fakeIo()
  const { fetchImpl, calls } = fakeFetch((url) => (url.includes('openrouter') ? json({ error: 'no auth' }, 401) : new Response('', { status: 302 })))
  assert.deepEqual(await connectivityStep.run(setupContext({ io, fetch: fetchImpl })), { ok: true })
  assert.deepEqual(output, [])
  // Запросы идут одновременно, порядок в записи не гарантирован.
  assert.deepEqual(
    calls.map((call) => call.url).sort(),
    ['https://api.telegram.org/', 'https://openrouter.ai/api/v1/key'],
  )
})

test('спека: верный токен — подсказка, звёздочки, «✓ Бот @… найден»', async () => {
  const { io, output, text } = fakeIo({ masked: [TOKEN] })
  const { fetchImpl } = fakeFetch(() => GET_ME_OK())
  const ctx = setupContext({ io, fetch: fetchImpl })
  assert.deepEqual(await tokenStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.token, TOKEN)
  assert.equal(ctx.answers.botUsername, 'aIrtem_tg_translator_bot')
  assert.match(text(), /@BotFather/)
  assert.ok(output.includes('Токен бота: '))
  assert.ok(output.includes('✓ Бот @aIrtem_tg_translator_bot найден'))
  assert.doesNotMatch(text(), new RegExp(TOKEN.split(':')[1]!))
})

test('спека: неверный токен — «Telegram не принял токен…», вопрос снова', async () => {
  const { io, output } = fakeIo({ masked: [OTHER_TOKEN, TOKEN] })
  const { fetchImpl } = fakeFetch((url) => (url.includes(OTHER_TOKEN) ? UNAUTHORIZED() : GET_ME_OK()))
  const ctx = setupContext({ io, fetch: fetchImpl })
  assert.deepEqual(await tokenStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.token, TOKEN)
  assert.equal(output.filter((line) => line === 'Токен бота: ').length, 2)
  assert.ok(output.includes(TOKEN_REJECTED_TEXT))
  assert.equal(TOKEN_REJECTED_TEXT, 'Telegram не принял токен. Скопируйте его из @BotFather целиком и вставьте снова.')
})

test('токен не того вида в Telegram не уходит: в адрес запроса попадает только проверенное', async () => {
  const { io, output } = fakeIo({ masked: ['https://evil.example/?x', '', TOKEN] })
  const { fetchImpl, calls } = fakeFetch(() => GET_ME_OK())
  const ctx = setupContext({ io, fetch: fetchImpl })
  assert.deepEqual(await tokenStep.run(ctx), { ok: true })
  assert.equal(calls.length, 1)
  assert.ok(output.includes(TOKEN_REJECTED_TEXT))
})

test('токен: нет сети при проверке — остановка с текстом про VPN, без повтора вопроса', async () => {
  const { io, output } = fakeIo({ masked: [TOKEN] })
  const { fetchImpl } = fakeFetch(() => new TypeError('fetch failed'))
  const result = await tokenStep.run(setupContext({ io, fetch: fetchImpl }))
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.reason : '', /Не достучаться до Telegram/)
  assert.equal(output.filter((line) => line === 'Токен бота: ').length, 1)
})

test('токен: Telegram ответил 502 — остановка «попробуйте через минуту»', async () => {
  const { io } = fakeIo({ masked: [TOKEN] })
  const { fetchImpl } = fakeFetch(() => new Response('', { status: 502 }))
  const result = await tokenStep.run(setupContext({ io, fetch: fetchImpl }))
  assert.deepEqual(result, { ok: false, reason: 'Telegram ответил ошибкой 502 — попробуйте через минуту.' })
})

test('спека: обновление — токен из .env принят, вопросов нет, .env не переписывается', async () => {
  const { io, output } = fakeIo()
  const { fetchImpl } = fakeFetch(() => GET_ME_OK())
  const ctx = setupContext({ io, fetch: fetchImpl, existing: { BOT_TOKEN: TOKEN, OWNER_ID: '42' } })
  assert.deepEqual(await tokenStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.token, TOKEN)
  assert.equal(ctx.answers.token, ctx.existing.BOT_TOKEN)
  assert.deepEqual(output, ['✓ Бот @aIrtem_tg_translator_bot'])
})

test('спека: токен в .env отозван — установщик просит новый', async () => {
  const { io, output } = fakeIo({ masked: [OTHER_TOKEN] })
  const { fetchImpl } = fakeFetch((url) => (url.includes(TOKEN) ? UNAUTHORIZED() : GET_ME_OK()))
  const ctx = setupContext({ io, fetch: fetchImpl, existing: { BOT_TOKEN: TOKEN, OWNER_ID: '42' } })
  assert.deepEqual(await tokenStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.token, OTHER_TOKEN)
  assert.notEqual(ctx.answers.token, ctx.existing.BOT_TOKEN)
  assert.equal(output[0], ENV_TOKEN_REJECTED)
})

test('связь: Telegram и OpenRouter проверяются одновременно, а не по очереди', async () => {
  let started = 0
  let bothStarted = false
  const fetchImpl = (async () => {
    started++
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (started === 2) bothStarted = true
    return new Response('', { status: 200 })
  }) as unknown as typeof fetch
  await connectivityStep.run(setupContext({ io: fakeIo().io, fetch: fetchImpl }))
  // По очереди второй запрос стартовал бы после ответа первого: к ответу первого started был бы 1.
  assert.equal(bothStarted, true)
})
