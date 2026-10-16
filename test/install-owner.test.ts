import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { POLL_EVERY_MS, WAIT_LIMIT_MS, findStart, ownerStep, type Update } from '../src/install/owner.ts'
import { TOKEN, fakeFetch, fakeIo, json, setupContext } from './install-fakes.ts'
import { OWNER_ID, STRANGER_ID } from './helpers.ts'

/**
 * Ответ getUpdates собран из живых образцов (owner-message-start, owner-message-from-stranger):
 * «hello» от постороннего, /start владельца и /start постороннего — последним.
 */
const SAMPLE = JSON.parse(readFileSync(new URL('./fixtures/get-updates-start.json', import.meta.url), 'utf8')) as {
  ok: true
  result: Update[]
}
const ownerOnly = { ok: true, result: SAMPLE.result.filter((update) => update.message?.from?.id === OWNER_ID) }
const EMPTY = { ok: true, result: [] }

/** getUpdates отвечает по очереди из списка, последний ответ повторяется. */
function telegramWith(answers: (unknown | Error)[]) {
  let i = 0
  return fakeFetch((url) => {
    if (url.endsWith('/deleteWebhook')) return json({ ok: true, result: true })
    const answer = answers[Math.min(i++, answers.length - 1)]
    if (answer instanceof Error) return answer
    const body = answer as { ok: boolean; error_code?: number }
    return json(answer, body.ok ? 200 : body.error_code)
  })
}

function context(io: ReturnType<typeof fakeIo>['io'], fetchImpl: typeof fetch, existing: Record<string, string> = {}) {
  return setupContext({ io, fetch: fetchImpl, existing, answers: { token: TOKEN, botUsername: 'aIrtem_tg_translator_bot' } })
}

test('findStart: последний /start из лички, отвергнутые пропускаются, «hello» — не /start', () => {
  assert.deepEqual(findStart(SAMPLE.result, new Set()), { id: STRANGER_ID, name: 'Stranger Test', username: 'stranger_test' })
  assert.deepEqual(findStart(SAMPLE.result, new Set([STRANGER_ID])), { id: OWNER_ID, name: 'Owner Test', username: 'owner_test' })
  assert.equal(findStart(SAMPLE.result, new Set([STRANGER_ID, OWNER_ID])), null)
})

test('findStart: /start@бот и /start с параметром — тоже /start, «/startup» — нет', () => {
  const make = (text: string): Update => ({
    update_id: 1,
    message: { chat: { type: 'private' }, from: { id: 7, first_name: 'A', is_bot: false }, text },
  })
  assert.ok(findStart([make('/start@aIrtem_tg_translator_bot')], new Set()))
  assert.ok(findStart([make('/start bizChat123')], new Set()))
  assert.equal(findStart([make('/startup')], new Set()), null)
})

test('спека: владелец написал /start — «Это вы: …?», после «да» id записан', async () => {
  const { io, output } = fakeIo({ answers: ['да'] })
  const { fetchImpl, calls } = telegramWith([EMPTY, EMPTY, ownerOnly])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, OWNER_ID)
  assert.ok(output.some((line) => line.includes('откройте @aIrtem_tg_translator_bot') && line.includes('/start')))
  assert.ok(output.includes('Это вы: Owner Test (@owner_test)? (да/нет): '))
  // Тот же /start должен достаться боту после запуска — ни одно сообщение не подтверждаем,
  // и список видов апдейтов не трогаем: Telegram запомнил бы его до первого опроса бота.
  for (const call of calls) assert.deepEqual(call.body, {})
})

test('чужой /start и ответ «нет» — его больше не предлагаем, ждём владельца', async () => {
  const { io, output } = fakeIo({ answers: ['нет', 'Да'] })
  const { fetchImpl } = telegramWith([SAMPLE])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, OWNER_ID)
  assert.deepEqual(
    output.filter((line) => line.startsWith('Это вы')),
    ['Это вы: Stranger Test (@stranger_test)? (да/нет): ', 'Это вы: Owner Test (@owner_test)? (да/нет): '],
  )
})

test('спека: лишний Enter вместо ответа — тот же вопрос ещё раз, человек не отвергается', async () => {
  const { io, output } = fakeIo({ answers: ['', 'да'] })
  const { fetchImpl } = telegramWith([ownerOnly])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, OWNER_ID)
  assert.deepEqual(
    output.filter((line) => line.startsWith('Это вы')),
    ['Это вы: Owner Test (@owner_test)? (да/нет): ', 'Это вы: Owner Test (@owner_test)? (да/нет): '],
  )
  assert.equal(output.some((line) => line.includes('Хорошо, жду дальше')), false)
})

test('непонятный ответ — повторный вопрос про того же, «нет» отвергает, дальше следующий', async () => {
  const { io, output } = fakeIo({ answers: ['может быть', 'нет', 'да'] })
  const { fetchImpl } = telegramWith([SAMPLE])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, OWNER_ID)
  assert.deepEqual(
    output.filter((line) => line.startsWith('Это вы')),
    [
      'Это вы: Stranger Test (@stranger_test)? (да/нет): ',
      'Это вы: Stranger Test (@stranger_test)? (да/нет): ',
      'Это вы: Owner Test (@owner_test)? (да/нет): ',
    ],
  )
})

test('спека: никто не написал за 3 минуты — id числом, не число — вопрос снова', async () => {
  const { io, output } = fakeIo({ answers: ['мой id', '123456789'] })
  const { fetchImpl, calls } = telegramWith([EMPTY])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, 123456789)
  assert.equal(calls.length, WAIT_LIMIT_MS / POLL_EVERY_MS)
  assert.ok(output.some((line) => /За 3 минуты боту никто не написал \/start/.test(line)))
  assert.ok(output.some((line) => /@userinfobot/.test(line)))
  assert.ok(output.includes('Нужно число, например 123456789.'))
})

test('спека: бот работает в другом месте — установка ждёт дальше, а та копия уснёт сама', async () => {
  const conflict = {
    ok: false,
    error_code: 409,
    description: 'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
  }
  const { io } = fakeIo({ answers: ['да'] })
  const { fetchImpl } = telegramWith([conflict, ownerOnly])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, OWNER_ID)
})

test('вебхук мешает getUpdates — снимаем его, не выбрасывая накопленное', async () => {
  const webhook = {
    ok: false,
    error_code: 409,
    description: "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
  }
  const { io } = fakeIo({ answers: ['да'] })
  const { fetchImpl, calls } = telegramWith([webhook, ownerOnly])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  const deleteCall = calls.find((call) => call.url.endsWith('/deleteWebhook'))
  assert.deepEqual(deleteCall?.body, {})
})

test('сеть мигнула — ждём дальше, а не падаем', async () => {
  const { io } = fakeIo({ answers: ['да'] })
  const { fetchImpl } = telegramWith([new TypeError('fetch failed'), ownerOnly])
  const ctx = context(io, fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, OWNER_ID)
})

test('спека: обновление — id владельца уже в .env, вопросов и запросов нет', async () => {
  const { io, output } = fakeIo()
  const { fetchImpl, calls } = telegramWith([EMPTY])
  const ctx = context(io, fetchImpl, { BOT_TOKEN: TOKEN, OWNER_ID: String(OWNER_ID) })
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  assert.equal(ctx.answers.ownerId, OWNER_ID)
  assert.deepEqual(output, [])
  assert.equal(calls.length, 0)
})

test('имя кандидата с управляющими знаками печатается без них', async () => {
  const ESC = String.fromCharCode(0x1b)
  const LF = String.fromCharCode(10)
  const hostile = {
    ok: true,
    result: [
      {
        update_id: 1,
        message: {
          chat: { type: 'private' },
          from: { id: OWNER_ID, first_name: `Иван${ESC}[2J${LF}Это вы`, username: 'ivan' },
          text: '/start',
        },
      },
    ],
  }
  const { io, output } = fakeIo({ answers: ['да'] })
  const ctx = context(io, telegramWith([hostile]).fetchImpl)
  assert.deepEqual(await ownerStep.run(ctx), { ok: true })
  const question = output.find((line) => line.startsWith('Это вы: '))!
  assert.equal(question, 'Это вы: Иван[2JЭто вы (@ivan)? (да/нет): ')
  for (const char of question) assert.ok(char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
})
