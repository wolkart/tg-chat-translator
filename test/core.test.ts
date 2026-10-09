import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline, type Step } from '../src/pipeline.ts'
import { TelegramError, describeError } from '../src/telegram.ts'
import { fakeTelegram } from './fakes.ts'

type Item = { trail: string[] }

const step = (name: string, result: 'next' | 'stop' = 'next'): Step<Item> => ({
  name,
  run: (item) => {
    item.trail.push(name)
    return result
  },
})

test('шаги идут по порядку', async () => {
  const item: Item = { trail: [] }
  const outcome = await runPipeline(item, [step('язык'), step('разговор'), step('перевод')])
  assert.equal(outcome, 'done')
  assert.deepEqual(item.trail, ['язык', 'разговор', 'перевод'])
})

test('остановка прерывает цепочку', async () => {
  const item: Item = { trail: [] }
  const outcome = await runPipeline(item, [step('язык'), step('разговор', 'stop'), step('перевод')])
  assert.equal(outcome, 'stopped')
  assert.deepEqual(item.trail, ['язык', 'разговор'])
})

test('дополнительный шаг встаёт в список без правки остальных', async () => {
  const base = [step('язык'), step('перевод')]
  const extended = [...base.slice(0, 1), step('расшифровка голосового'), ...base.slice(1)]
  const item: Item = { trail: [] }
  await runPipeline(item, extended)
  assert.deepEqual(item.trail, ['язык', 'расшифровка голосового', 'перевод'])
})

test('асинхронный шаг дожидается результата', async () => {
  const item: Item = { trail: [] }
  const slow: Step<Item> = {
    name: 'медленный',
    run: async (it) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      it.trail.push('медленный')
      return 'next' as const
    },
  }
  await runPipeline(item, [slow, step('после')])
  assert.deepEqual(item.trail, ['медленный', 'после'])
})

test('describeError: Telegram, Error и прочее', () => {
  assert.equal(describeError(new TelegramError(400, 'Bad Request: message thread not found')), 'Bad Request: message thread not found')
  assert.equal(describeError(new Error('сломалось')), 'сломалось')
  assert.equal(describeError('строка'), 'строка')
})

test('подделка API записывает вызовы и падает по сценарию', async () => {
  const tg = fakeTelegram()
  tg.failNext('sendText', new TelegramError(403, 'Forbidden'))
  await assert.rejects(tg.api.sendText(1, 'a'), TelegramError)
  const id = await tg.api.sendText(1, 'b', { businessConnectionId: 'BC1' })
  assert.equal(typeof id, 'number')
  assert.equal(tg.callsOf('sendText').length, 2)
  assert.equal(tg.sentAsOwner().length, 1)
})
