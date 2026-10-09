import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THROTTLE_MS, createAlerts, createScrubber } from '../src/alerts.ts'
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
