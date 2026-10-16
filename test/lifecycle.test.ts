import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GrammyError, HttpError } from 'grammy'
import { createAlerts } from '../src/alerts.ts'
import {
  RETRY_DELAYS_MS,
  TOKEN_REJECTED,
  classifyStop,
  conflictText,
  connectTelegram,
  placeName,
  runPolling,
} from '../src/lifecycle.ts'
import { TelegramError, type BotInfo } from '../src/telegram.ts'
import { fakeTelegram } from './fakes.ts'
import { OWNER_ID } from './helpers.ts'

const me: BotInfo = {
  id: 300003,
  username: 'translator_test_bot',
  canConnectToBusiness: true,
  hasTopicsEnabled: true,
  supportsInlineQueries: true,
  allowsUsersToCreateTopics: false,
}

/** Ошибка grammY в том виде, в каком её бросает bot.start(). */
function grammyError(code: number, description: string): GrammyError {
  return new GrammyError(
    "Call to 'getUpdates' failed!",
    { ok: false, error_code: code, description },
    'getUpdates',
    {},
  )
}

const CONFLICT = grammyError(409, 'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running')
const WEBHOOK = grammyError(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first")
const NETWORK = new HttpError("Network request for 'getMe' failed!", new Error('getaddrinfo ENOTFOUND api.telegram.org'))

test('classifyStop: второй экземпляр бота — уснуть', () => {
  assert.equal(classifyStop(CONFLICT), 'sleep-conflict')
})

test('classifyStop: токен отвергнут — уснуть, и от grammY, и от нашей обёртки', () => {
  assert.equal(classifyStop(grammyError(401, 'Unauthorized')), 'sleep-token')
  assert.equal(classifyStop(new TelegramError(401, 'Unauthorized')), 'sleep-token')
  // Токен не того вида Telegram отвергает кодом 404.
  assert.equal(classifyStop(new TelegramError(404, 'Not Found')), 'sleep-token')
})

test('classifyStop: нет сети и сбой на стороне Telegram — повторить', () => {
  assert.equal(classifyStop(NETWORK), 'retry')
  assert.equal(classifyStop(new TelegramError(502, 'Bad Gateway')), 'retry')
  assert.equal(classifyStop(new TelegramError(429, 'Too Many Requests: retry after 5')), 'retry')
})

test('classifyStop: 409 из-за вебхука и незнакомая ошибка — упасть, надзиратель поднимет', () => {
  assert.equal(classifyStop(WEBHOOK), 'crash')
  assert.equal(classifyStop(new Error('что-то совсем другое')), 'crash')
})

test('placeName: Mac и Windows — с именем компьютера, Linux — сервер', () => {
  assert.equal(placeName('darwin', 'Artems-MacBook-Pro.local'), 'Mac (Artems-MacBook-Pro)')
  assert.equal(placeName('win32', 'DESKTOP-7Q1'), 'Windows (DESKTOP-7Q1)')
  assert.equal(placeName('linux', '3f2a9c1b7d0e'), 'сервере')
})

test('спека: текст про второй экземпляр называет место', () => {
  assert.equal(
    conflictText('Mac (Artems-MacBook-Pro)'),
    'Бот остановился на Mac (Artems-MacBook-Pro): этот же бот запущен ещё в одном месте. ' +
      'Работать должна одна копия. Нужна эта — удалите другую командой из README и запустите здесь ' +
      'команду установки ещё раз: бот проснётся. Нужна другая — удалите эту.',
  )
})

function connectSetup(answers: (BotInfo | Error)[]) {
  const sleeps: number[] = []
  const logs: string[] = []
  let calls = 0
  const deps = {
    getMe: async () => {
      const answer = answers[calls++]
      if (answer === undefined) throw new Error('getMe вызван лишний раз')
      if (answer instanceof Error) throw answer
      return answer
    },
    sleep: async (ms: number) => {
      sleeps.push(ms)
    },
    log: (text: string) => {
      logs.push(text)
    },
  }
  return { deps, sleeps, logs, calls: () => calls }
}

test('спека: компьютер проснулся без сети — бот ждёт связь и стартует сам', async () => {
  const { deps, sleeps, logs } = connectSetup([NETWORK, NETWORK, me])
  const result = await connectTelegram(deps)
  assert.equal(result, me)
  assert.deepEqual(sleeps, [RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]])
  // Одна строка о том, что связи нет, а не по строке на каждую попытку.
  assert.equal(logs.filter((line) => /Нет связи с Telegram/.test(line)).length, 1)
})

test('connectTelegram: пауза растёт до минуты и дальше не растёт', async () => {
  const { deps, sleeps } = connectSetup([NETWORK, NETWORK, NETWORK, NETWORK, NETWORK, NETWORK, me])
  await connectTelegram(deps)
  assert.deepEqual(sleeps, [5_000, 10_000, 30_000, 60_000, 60_000, 60_000])
})

test('спека: токен отозван — без повторов, причина в журнале', async () => {
  const { deps, sleeps, logs, calls } = connectSetup([new TelegramError(401, 'Unauthorized')])
  const result = await connectTelegram(deps)
  assert.equal(result, null)
  assert.equal(calls(), 1)
  assert.deepEqual(sleeps, [])
  assert.deepEqual(logs, [TOKEN_REJECTED])
})

test('connectTelegram: незнакомая ошибка не глотается', async () => {
  const { deps } = connectSetup([new Error('сломалось')])
  await assert.rejects(connectTelegram(deps), /сломалось/)
})

function pollingSetup() {
  const tg = fakeTelegram()
  const printed: string[] = []
  const alerts = createAlerts({ api: tg.api, ownerChatId: OWNER_ID, scrub: (t) => t, print: (line) => printed.push(line) })
  return { tg, alerts, printed }
}

test('спека: сначала Mac, потом сервер — копия на Mac пишет владельцу один раз и засыпает', async () => {
  const { tg, alerts } = pollingSetup()
  let starts = 0
  const outcome = await runPolling({
    start: async () => {
      starts++
      throw CONFLICT
    },
    alerts,
    place: 'Mac (Artems-MacBook-Pro)',
  })
  assert.equal(outcome, 'sleep')
  assert.equal(starts, 1)
  assert.deepEqual(
    tg.callsOf('sendText').map((call) => [call.chatId, call.text]),
    [[OWNER_ID, conflictText('Mac (Artems-MacBook-Pro)')]],
  )
})

test('спека: токен отозван во время работы — строка в журнал, владельцу написать нечем', async () => {
  const { tg, alerts, printed } = pollingSetup()
  const outcome = await runPolling({
    start: async () => {
      throw grammyError(401, 'Unauthorized')
    },
    alerts,
    place: 'сервере',
  })
  assert.equal(outcome, 'sleep')
  assert.equal(tg.calls.length, 0)
  assert.ok(printed.some((line) => line.endsWith(TOKEN_REJECTED)))
})

test('runPolling: обычная остановка — stopped, сбой — наружу, надзиратель поднимет', async () => {
  const { alerts } = pollingSetup()
  assert.equal(await runPolling({ start: async () => {}, alerts, place: 'сервере' }), 'stopped')
  await assert.rejects(
    runPolling({
      start: async () => {
        throw WEBHOOK
      },
      alerts,
      place: 'сервере',
    }),
    GrammyError,
  )
})
