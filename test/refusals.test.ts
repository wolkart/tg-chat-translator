import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEND_REFUSALS, isFinalRefusal, refusalText } from '../src/channels/private-chat/refusals.ts'
import { TelegramError } from '../src/telegram.ts'

test('отказы подключения узнаются по коду и называют собеседника', () => {
  const usage = refusalText(new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'), 'Maria')
  assert.match(usage, /^от Maria давно не было сообщений/)
  assert.match(usage, /Когда Maria ответит, бот снова будет отправлять сам\.$/)
  assert.match(refusalText(new TelegramError(400, 'Bad Request: BUSINESS_PEER_INVALID'), 'Maria'), /^бот не видит чат с Maria/)
})

test('незнакомый отказ — словами Telegram', () => {
  assert.equal(refusalText(new TelegramError(429, 'Too Many Requests: retry after 5'), 'Maria'), 'Telegram не принял сообщение — Too Many Requests: retry after 5')
  assert.equal(refusalText('файл больше 20 МБ', 'Maria'), 'Telegram не принял сообщение — файл больше 20 МБ')
})

test('окончательный отказ — только отказ подключения от Telegram', () => {
  assert.equal(isFinalRefusal(new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING')), true)
  assert.equal(isFinalRefusal(new TelegramError(400, 'Bad Request: BUSINESS_PEER_INVALID')), true)
  assert.equal(isFinalRefusal(new TelegramError(400, 'Bad Request: wrong file identifier')), false)
  assert.equal(isFinalRefusal(new Error('BUSINESS_PEER_INVALID')), false)
  assert.equal(SEND_REFUSALS.length, 2)
})
