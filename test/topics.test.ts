import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from '../src/store.ts'
import { TelegramError } from '../src/telegram.ts'
import {
  createTopics,
  renderAsIs,
  renderDryRun,
  renderIncoming,
  renderNotSent,
  renderNotTranslated,
  renderOwnerDirect,
  renderSent,
  renderUnsupported,
  renderUntranslated,
  topicName,
} from '../src/owner/topics.ts'
import { fakeTelegram } from './fakes.ts'
import { OWNER_ID, PEER_ID, T0 } from './helpers.ts'

function setup() {
  const store = openStore(':memory:')
  const tg = fakeTelegram()
  const topics = createTopics({ api: tg.api, store, ownerChatId: OWNER_ID, now: () => T0, scrub: (t) => t.replace('SECRET-KEY-123', '***') })
  const conversation = store.createConversation({ ownerId: OWNER_ID, connectionId: 'BC', peerChatId: PEER_ID, peerName: 'Timon', now: T0 })
  return { store, tg, topics, conversation }
}

test('первое сообщение создаёт тему с именем собеседника один раз, второе идёт в неё же', async () => {
  const { tg, topics, conversation, store } = setup()
  await topics.postText(conversation, ['первое'])
  await topics.postText(conversation, ['второе'])
  const created = tg.callsOf('createTopic')
  assert.equal(created.length, 1)
  assert.deepEqual(created[0], { method: 'createTopic', chatId: OWNER_ID, name: 'Timon' })
  const [first, second] = tg.callsOf('sendText')
  assert.equal(first!.opts.threadId, second!.opts.threadId)
  assert.equal(store.getConversation(conversation.id)?.topicId, first!.opts.threadId)
})

test('тема из базы используется без создания новой', async () => {
  const { tg, topics, conversation, store } = setup()
  store.setTopic(conversation.id, 77)
  await topics.postText(store.getConversation(conversation.id)!, ['привет'])
  assert.equal(tg.callsOf('createTopic').length, 0)
  assert.equal(tg.callsOf('sendText')[0]!.opts.threadId, 77)
})

test('удалённая тема пересоздаётся, и сообщение доходит', async () => {
  const { tg, topics, conversation, store } = setup()
  store.setTopic(conversation.id, 77)
  tg.failNext('sendText', new TelegramError(400, 'Bad Request: message thread not found'))
  await topics.postText(store.getConversation(conversation.id)!, ['снова привет'])
  assert.equal(tg.callsOf('createTopic').length, 1)
  const sends = tg.callsOf('sendText')
  assert.equal(sends.length, 2)
  assert.equal(sends[1]!.text, 'снова привет')
  assert.notEqual(sends[1]!.opts.threadId, 77)
  assert.equal(store.getConversation(conversation.id)?.topicId, sends[1]!.opts.threadId)
})

test('другая ошибка Telegram не пересоздаёт тему', async () => {
  const { tg, topics, conversation } = setup()
  await topics.ensure(conversation)
  tg.failNext('sendText', new TelegramError(429, 'Too Many Requests'))
  await assert.rejects(topics.postText(conversation, ['x']), TelegramError)
  assert.equal(tg.callsOf('createTopic').length, 1)
})

test('каждое сообщение бота в теме записывается для маршрута «ответ на сообщение»', async () => {
  const { topics, conversation, store } = setup()
  const ids = await topics.postText(conversation, ['часть 1', 'часть 2'])
  for (const id of ids) assert.equal(store.conversationByBotMessage(OWNER_ID, id)?.id, conversation.id)
})

test('вложение уходит в тему, его id тоже записывается', async () => {
  const { tg, topics, conversation, store } = setup()
  const result = await topics.postMedia(conversation, { kind: 'photo', fileId: 'P' }, 'Моя новая машина')
  assert.equal(result.ok, true)
  const sent = tg.callsOf('sendMedia')[0]!
  assert.equal(sent.opts.caption, 'Моя новая машина')
  assert.ok(sent.opts.threadId !== undefined)
  if (result.ok) assert.equal(store.conversationByBotMessage(OWNER_ID, result.messageIds[0]!)?.id, conversation.id)
})

test('вложение в удалённую тему: тема пересоздаётся, вложение доходит', async () => {
  const { tg, topics, conversation, store } = setup()
  store.setTopic(conversation.id, 77)
  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: message thread not found'))
  const result = await topics.postMedia(store.getConversation(conversation.id)!, { kind: 'photo', fileId: 'P' })
  assert.equal(result.ok, true)
  assert.equal(tg.callsOf('createTopic').length, 1)
  assert.equal(tg.callsOf('downloadFile').length, 0)
})

test('секреты в пометке заменяются', async () => {
  const { tg, topics, conversation } = setup()
  await topics.postText(conversation, renderUntranslated('hi', '401 key SECRET-KEY-123'))
  assert.ok(!tg.callsOf('sendText')[0]!.text.includes('SECRET-KEY-123'))
})

test('имя темы: пустое — «Собеседник», длинное обрезается до 128 символов', () => {
  assert.equal(topicName('  '), 'Собеседник')
  assert.equal([...topicName('я'.repeat(200))].length, 128)
})

test('перевод со свёрнутым оригиналом', () => {
  assert.deepEqual(renderIncoming('Увидимся в 7?', 'See you at 7?'), [
    'Увидимся в 7?\n<blockquote expandable>See you at 7?</blockquote>',
  ])
})

test('разметка собеседника видна как текст', () => {
  const [html] = renderIncoming('жирный и ссылка', '<b>hi</b> <a href="http://x">link</a>')
  assert.ok(html!.includes('&lt;b&gt;hi&lt;/b&gt; &lt;a href="http://x"&gt;link&lt;/a&gt;'))
  assert.ok(!html!.includes('<b>hi'))
  assert.ok(!html!.includes('<a '))
})

test('длинный перевод делится на части, ни одна не длиннее 4096', () => {
  const parts = renderIncoming('п'.repeat(5000), 'o'.repeat(5000))
  assert.ok(parts.length >= 4)
  for (const part of parts) assert.ok(part.length <= 4096)
  assert.ok(parts.at(-1)!.startsWith('<blockquote expandable>'))
})

test('перевод не удался — оригинал и причина', () => {
  assert.deepEqual(renderUntranslated('See you', 'модель не ответила за 30 с'), [
    'See you\n<i>Перевод не удался: модель не ответила за 30 с</i>',
  ])
})

test('остальные пометки', () => {
  assert.deepEqual(renderAsIs('спасибо'), ['спасибо'])
  assert.deepEqual(renderOwnerDirect('ok, see you'), ['<i>Вы в личке:</i> ok, see you'])
  assert.deepEqual(renderSent('Отлично, а ты?', 'Great, and you?'), ['<i>Вы:</i> Отлично, а ты?\n→ Great, and you?'])
  assert.deepEqual(renderSent('[фото]', ''), ['<i>Вы:</i> [фото]'])
  assert.deepEqual(renderNotSent('Forbidden: bot was blocked', 'Great'), [
    '<b>Не отправлено.</b> Forbidden: bot was blocked\nПеревод:\nGreat',
  ])
  assert.deepEqual(renderNotTranslated('нет ключа'), ['<b>Не отправлено:</b> перевод не удался — нет ключа'])
  assert.deepEqual(renderUnsupported('Timon', 'геопозицию'), ['Timon прислал геопозицию — посмотрите в личке'])
  assert.deepEqual(renderDryRun('Great'), ['<i>Холостой прогон: ушло бы —</i> Great'])
})

test('длинная причина обрезается', () => {
  const [html] = renderNotTranslated('x'.repeat(1000))
  assert.ok(html!.length < 400)
})

test('имя собеседника с разметкой не ломает пометку', () => {
  assert.deepEqual(renderUnsupported('<b>Boss</b> & Co', 'контакт'), ['&lt;b&gt;Boss&lt;/b&gt; &amp; Co прислал контакт — посмотрите в личке'])
})
