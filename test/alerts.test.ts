import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THROTTLE_MS, alertModelFailure, createAlerts, createScrubber } from '../src/alerts.ts'
import { TranslationError } from '../src/translate/llm.ts'
import { TelegramError } from '../src/telegram.ts'
import { fakeTelegram } from './fakes.ts'

const OWNER = 100001
const KEY = 'sk-or-v1-abcdef123456'

function setup() {
  const tg = fakeTelegram()
  let clock = 1_760_000_000_000
  const printed: string[] = []
  const alerts = createAlerts({
    api: tg.api,
    ownerChatId: OWNER,
    scrub: createScrubber([KEY, '123456:bot-token-value', 'short']),
    now: () => clock,
    print: (line) => printed.push(line),
  })
  return { tg, alerts, printed, advance: (ms: number) => (clock += ms) }
}

test('ключ в тексте ошибки заменяется на ***', async () => {
  const { tg, alerts, printed } = setup()
  await alerts.general('model', `OpenRouter 401: invalid key ${KEY}`)
  const sent = tg.callsOf('sendText')[0]!
  assert.equal(sent.text, 'OpenRouter 401: invalid key ***')
  assert.ok(!printed.join('\n').includes(KEY))
})

test('короткие значения не считаются секретами', () => {
  const scrub = createScrubber(['short', 'true'])
  assert.equal(scrub('short and true'), 'short and true')
})

test('общее сообщение — в чат вне тем; повтор за 10 минут подавлен, после — снова уходит', async () => {
  const { tg, alerts, advance } = setup()
  await alerts.general('provider-down', 'Провайдер недоступен')
  advance(THROTTLE_MS - 1)
  await alerts.general('provider-down', 'Провайдер недоступен')
  assert.equal(tg.callsOf('sendText').length, 1)
  assert.equal(tg.callsOf('sendText')[0]!.opts.threadId, undefined)
  advance(1)
  await alerts.general('provider-down', 'Провайдер недоступен')
  assert.equal(tg.callsOf('sendText').length, 2)
})

test('разные ключи не мешают друг другу', async () => {
  const { tg, alerts } = setup()
  await alerts.general('a', 'первое')
  await alerts.general('b', 'второе')
  assert.equal(tg.callsOf('sendText').length, 2)
})

test('пометки внутри разговора не подавляются и идут в тему', async () => {
  const { tg, alerts } = setup()
  await alerts.inTopic(77, 'Не удалось доставить перевод')
  await alerts.inTopic(77, 'Не удалось доставить перевод')
  const sent = tg.callsOf('sendText')
  assert.equal(sent.length, 2)
  assert.equal(sent[0]!.opts.threadId, 77)
})

test('notify не троттлится', async () => {
  const { tg, alerts } = setup()
  await alerts.notify('Бот подключён')
  await alerts.notify('Бот подключён')
  assert.equal(tg.callsOf('sendText').length, 2)
})

test('если Telegram не принял оповещение, бот не падает, а пишет в консоль', async () => {
  const { tg, alerts, printed } = setup()
  tg.failNext('sendText', new TelegramError(502, 'Bad Gateway'))
  await alerts.general('x', 'что-то сломалось')
  assert.ok(printed.some((line) => line.includes('Bad Gateway')))
})

test('консоль идёт через ту же замену секретов', () => {
  const { alerts, printed } = setup()
  alerts.log('token=123456:bot-token-value')
  assert.ok(printed[0]!.endsWith('token=***'))
})

test('сорвавшаяся отправка не включает троттлинг: повтор пытается отправить снова', async () => {
  const { tg, alerts } = setup()
  tg.failNext('sendText', new TelegramError(502, 'Bad Gateway'))
  await alerts.general('error-key', 'ошибка раз')
  // Первая попытка упала, но мы вызовем её с тем же ключом ещё раз.
  tg.failNext('sendText', new TelegramError(502, 'Bad Gateway'))
  await alerts.general('error-key', 'ошибка два')
  // Вторая попытка тоже упала, но заметим: если б первая уважалась для троттлинга,
  // второй вызов был бы подавлен. Вместо этого мы видим две попытки в очереди вызовов.
  const calls = tg.callsOf('sendText')
  assert.equal(calls.length, 2, 'обе попытки были сделаны, так как первая упала')
  assert.equal(calls[0]!.text, 'ошибка раз')
  assert.equal(calls[1]!.text, 'ошибка два')
})

test('секрет в URL-кодировке тоже скрыт', () => {
  const scrub = createScrubber(['123456789:ABCdefGHIjkl'])
  // Token с : становится 123456789%3AABCdefGHIjkl в URL.
  const result = scrub('Token 123456789%3AABCdefGHIjkl in query')
  assert.equal(result, 'Token *** in query')
  // Исходная форма тоже скрыта.
  const result2 = scrub('Token 123456789:ABCdefGHIjkl in header')
  assert.equal(result2, 'Token *** in header')
})

test('перекрывающиеся секреты заменяются одним ***', () => {
  const scrub = createScrubber(['AAAAAAAAAXYZ', 'XYZBBBBBBBBB'])
  // Когда AAAAAAAAAXYZ и XYZBBBBBBBBB встречаются подряд, их диапазоны перекрываются в AAAAAAAAA|XYZ|BBBBBBBBB.
  // Должно получиться один *** вместо двух.
  const result = scrub('Prefix AAAAAAAAAXYZBBBBBBBBB Suffix')
  assert.equal(result, 'Prefix *** Suffix')
  // Убедимся, что ни AAAA ни BBBB не прошли.
  assert.ok(!result.includes('AAAA'))
  assert.ok(!result.includes('BBBB'))
})

test('сбой модели: разные причины в пределах 10 минут — одно сообщение, с первой причиной', async () => {
  const { tg, alerts, advance } = setup()
  await alertModelFailure(alerts, 'ошибка 503, request abc')
  advance(60_000)
  await alertModelFailure(alerts, 'ошибка 503, request def')
  const sent = tg.callsOf('sendText')
  assert.equal(sent.length, 1)
  assert.match(sent[0]!.text, /^Модель не переводит: ошибка 503, request abc\./)
})

test('спека: неверный ключ — причина и подсказка из ошибки, сырой ответ только в консоли и без ключа', async () => {
  const tg = fakeTelegram()
  const printed: string[] = []
  const alerts = createAlerts({
    api: tg.api,
    ownerChatId: 1,
    scrub: createScrubber(['sk-or-v1-secret-key']),
    print: (line) => printed.push(line),
  })
  await alertModelFailure(
    alerts,
    new TranslationError('OpenRouter: ключ не подходит', {
      hint: 'Проверьте OPENROUTER_API_KEY в .env — ключ берут здесь: https://openrouter.ai/keys',
      detail: '401: {"error":{"message":"User not found.","key":"sk-or-v1-secret-key"}}',
    }),
  )
  const [sent] = tg.callsOf('sendText')
  assert.equal(
    sent!.text,
    'Модель не переводит: OpenRouter: ключ не подходит. Пока это так, входящие идут в темы без перевода, ' +
      'а ответы собеседникам не уходят. Проверьте OPENROUTER_API_KEY в .env — ключ берут здесь: https://openrouter.ai/keys',
  )
  assert.ok(!sent!.text.includes('User not found'))
  const raw = printed.find((line) => line.includes('User not found'))
  assert.ok(raw)
  assert.ok(!raw.includes('sk-or-v1-secret-key'))
})

test('спека: ключ из панели в тексте ошибки — *** и владельцу, и в консоли', async () => {
  const tg = fakeTelegram()
  const printed: string[] = []
  const scrub = createScrubber(['123456:bot-token-value'])
  const alerts = createAlerts({ api: tg.api, ownerChatId: 1, scrub, print: (line) => printed.push(line) })
  const panelKey = 'sk-or-v1-вставлен-в-панели-после-старта'
  scrub.add(panelKey)
  await alerts.general('model', `OpenRouter: ${panelKey} не подходит`)
  assert.equal(tg.callsOf('sendText')[0]!.text, 'OpenRouter: *** не подходит')
  assert.ok(printed.every((line) => !line.includes(panelKey)))
})

test('замена секретов: короткое значение, добавленное на ходу, не заменяется', () => {
  const scrub = createScrubber([])
  scrub.add('short')
  assert.equal(scrub('short text'), 'short text')
})
