import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Update } from 'grammy/types'
import { ALLOWED_UPDATES, CANT_FORWARD, createApp, statusText } from '../src/app.ts'
import { CONNECTED } from '../src/channels/private-chat/connection.ts'
import { FIRST_TEXT_ONLY } from '../src/owner/manual-send.ts'
import { STRAY_TOPIC } from '../src/owner/routing.ts'
import { CONNECTION_ID, OWNER_ID, PEER_ID, fixture } from './helpers.ts'
import { TelegramError } from '../src/telegram.ts'
import { setupDeps } from './setup.ts'

function withUpdateId(update: Update, updateId: number): Update {
  return { ...update, update_id: updateId }
}

function started(options: Parameters<typeof setupDeps>[0] = {}) {
  const ctx = setupDeps(options)
  return { ...ctx, app: createApp(ctx.deps) }
}

test('подключение, входящее и ответ в теме — весь путь через диспетчер', async () => {
  const { app, tg, store } = started()
  await app.handleUpdate(fixture('business-connection-owner'))
  await app.handleUpdate(fixture('business-message-peer-text'))
  const conversation = store.findConversationByPeer(OWNER_ID, PEER_ID)!
  const reply = fixture('owner-message-in-topic')
  reply.message!.message_thread_id = conversation.topicId!
  await app.handleUpdate(reply)

  assert.equal(tg.callsOf('sendText')[0]!.text, CONNECTED)
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.text, '[en] Отлично, а ты?')
  assert.equal(toPeer.opts.businessConnectionId, CONNECTION_ID)
})

test('один и тот же апдейт ответа владельца дважды — одна отправка собеседнику', async () => {
  const { app, tg, store, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const reply = fixture('owner-message-in-topic')
  reply.message!.message_thread_id = store.findConversationByPeer(OWNER_ID, PEER_ID)!.topicId!
  await app.handleUpdate(reply)
  await app.handleUpdate(reply)
  assert.equal(tg.sentAsOwner().length, 1)
})

test('ошибка в одном апдейте — оповещение, следующий обрабатывается как обычно', async () => {
  const { app, tg, store, connectOwner } = started()
  connectOwner()
  tg.failNext('createTopic', new Error('сеть моргнула'))
  await app.handleUpdate(fixture('business-message-peer-text'))
  const alert = tg.callsOf('sendText').find((call) => call.text.startsWith('Не удалось обработать сообщение'))
  assert.ok(alert)
  assert.match(alert.text, /сеть моргнула/)
  assert.equal(store.isProcessed(1101), true)

  const next = withUpdateId(fixture('business-message-peer-text'), 1150)
  next.business_message!.message_id = 650
  await app.handleUpdate(next)
  assert.equal(tg.callsOf('createTopic').length, 2)
  assert.match(tg.callsOf('sendText').at(-1)!.text, /^\[ru\] See you at 7\?/)
})

test('посторонний пишет боту — ни вызовов API, ни модели, ни записей в базе', async () => {
  const { app, tg, store, translator, deps } = started()
  await app.handleUpdate(fixture('owner-message-from-stranger'))
  assert.equal(tg.calls.length, 0)
  assert.equal(translator.calls.length, 0)
  assert.equal(store.activeConversations(400004, deps.now()).length, 0)
  assert.equal(store.ownerConnection(400004), undefined)
  assert.equal(store.isProcessed(1206), false)
})

test('кнопку нажал не владелец — ничего не происходит', async () => {
  const { app, tg, store } = started()
  const update = fixture('callback-choose')
  update.callback_query!.from = { ...update.callback_query!.from, id: 400004 }
  await app.handleUpdate(update)
  assert.equal(tg.calls.length, 0)
  assert.equal(store.isProcessed(1301), false)
})

test('/start — статус без подключения', async () => {
  const { app, tg } = started()
  await app.handleUpdate(fixture('owner-message-start'))
  const status = tg.callsOf('sendText')[0]!.text
  assert.match(status, /Подключение к аккаунту: бот его ещё не видел/)
  assert.match(status, /Языки: русский ↔ английский/)
  assert.match(status, /Модель: OpenRouter · openai\/gpt-4\.1-mini/)
})

test('спека: в статусе — как написать первым и точный путь к настройке', async () => {
  const { app, tg } = started()
  await app.handleUpdate(fixture('owner-message-start'))
  const status = tg.callsOf('sendText')[0]!.text
  assert.match(
    status,
    /• Написать первым: отправьте текст сюда вне тем — бот переведёт и даст кнопку «Отправить через бота»/,
  )
  assert.match(status, /если нет — Настройки → Аккаунт → Автоматизация чатов \(на Mac — Настройки → Изменить профиль/)
})

test('/start — подключение выключено', () => {
  const { deps, connectOwner } = setupDeps()
  connectOwner({ isEnabled: false })
  assert.match(statusText(deps), /Подключение к аккаунту: нет — подключите бота/)
})

test('/start — статус с подключением без права отвечать', async () => {
  const { deps, connectOwner } = setupDeps()
  connectOwner({ canReply: false })
  const status = statusText(deps)
  assert.match(status, /Подключение к аккаунту: есть/)
  assert.match(status, /Ответы на сообщения/)
})

test('/start — статус показывает, что ключа нет и что прогон холостой', () => {
  const { deps } = setupDeps({ overrides: { translatorInfo: 'Нет ключа модели — переводить нечем.', dry: true } })
  const status = statusText(deps)
  assert.match(status, /Модель: Нет ключа модели/)
  assert.match(status, /Холостой прогон/)
})

test('спека: вне тем без активных разговоров — перевод для нового собеседника с кнопками, никому ничего не уходит', async () => {
  const { app, tg, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('owner-message-outside'))
  assert.equal(tg.sentAsOwner().length, 0)
  const [reply] = tg.callsOf('sendText')
  assert.equal(reply!.text, '<i>Перевод для нового собеседника (английский):</i>\n[en] Привет!')
  assert.equal(reply!.opts.replyTo, 903)
  assert.deepEqual(reply!.opts.keyboard!.map((row) => row[0]!.text), ['Отправить через бота', 'Скопировать'])
})

test('спека: фото вне тем без активных разговоров — «Первым бот отправляет только текст», модель не вызывается', async () => {
  const { app, tg, translator, connectOwner } = started()
  connectOwner()
  const photo = fixture('owner-message-photo-in-topic')
  delete photo.message!.message_thread_id
  delete photo.message!.reply_to_message
  await app.handleUpdate(photo)
  assert.equal(translator.calls.length, 0)
  assert.equal(tg.callsOf('sendText')[0]!.text, FIRST_TEXT_ONLY)
})

test('ответ «Ответить» в ленте «Все» уходит собеседнику без «✓»', async () => {
  const { app, tg, store, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const reply = fixture('owner-message-reply-all-view')
  reply.message!.message_thread_id = store.findConversationByPeer(OWNER_ID, PEER_ID)!.topicId!
  await app.handleUpdate(reply)
  assert.equal(tg.sentAsOwner().length, 1)
  assert.ok(!tg.callsOf('sendText').some((call) => call.text.startsWith('✓')))
})

test('спека: вне темы при одном активном разговоре — «Кому?» с ним, «Новому собеседнику» и «Отмена»', async () => {
  const { app, tg, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  await app.handleUpdate(fixture('owner-message-outside'))
  assert.equal(tg.sentAsOwner().length, 0)
  const question = tg.callsOf('sendText').at(-1)!
  assert.equal(question.text, 'Кому?')
  assert.deepEqual(question.opts.keyboard!.map((row) => row[0]!.text), ['Alex Peer', 'Новому собеседнику', 'Отмена'])
})

test('несколько активных разговоров: «Кому?» → кнопка → отправка и «Отправлено <имя>»', async () => {
  const { app, tg, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const second = withUpdateId(fixture('business-message-peer-text'), 1160)
  second.business_message!.chat = { id: 200003, type: 'private', first_name: 'Anna' }
  second.business_message!.from = { id: 200003, is_bot: false, first_name: 'Anna' }
  second.business_message!.message_id = 700
  await app.handleUpdate(second)

  await app.handleUpdate(fixture('owner-message-outside'))
  const question = tg.callsOf('sendText').find((call) => call.text === 'Кому?')!
  const annaButton = question.opts.keyboard!.find((row) => row[0]!.text === 'Anna')![0]!
  const press = fixture('callback-choose')
  press.callback_query!.data = annaButton.data
  await app.handleUpdate(press)

  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.chatId, 200003)
  assert.equal(tg.callsOf('editText')[0]!.text, 'Отправлено Anna')
})

test('геопозицию из чата с ботом переслать нельзя — так и говорим', async () => {
  const { app, tg } = started()
  const update = fixture('owner-message-outside')
  delete update.message!.text
  ;(update.message as unknown as Record<string, unknown>).location = { latitude: 1, longitude: 2 }
  await app.handleUpdate(update)
  assert.equal(tg.callsOf('sendText')[0]!.text, CANT_FORWARD)
})

test('фото владельца в теме уходит собеседнику', async () => {
  const { app, tg, store, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const photo = fixture('owner-message-photo-in-topic')
  photo.message!.message_thread_id = store.findConversationByPeer(OWNER_ID, PEER_ID)!.topicId!
  await app.handleUpdate(photo)
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendMedia')
  assert.equal(toPeer.opts.caption, '[en] Это тебе')
})

test('входящее, доставленное повторно после перезапуска, не дублируется в теме', async () => {
  const { app, tg, translator, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const posted = tg.callsOf('sendText').length
  await app.handleUpdate(fixture('business-message-peer-text'))
  assert.equal(tg.callsOf('sendText').length, posted)
  assert.equal(translator.calls.length, 1)
})

test('разные поломки в одном обработчике — два оповещения, одинаковая — одно', async () => {
  const { app, tg, connectOwner } = started()
  connectOwner()
  const failing = (updateId: number, messageId: number) => {
    const update = withUpdateId(fixture('business-message-peer-text'), updateId)
    update.business_message!.message_id = messageId
    return update
  }
  const alerts = () => tg.callsOf('sendText').filter((call) => call.text.startsWith('Не удалось обработать сообщение'))

  tg.failNext('createTopic', new Error('сеть моргнула'))
  await app.handleUpdate(failing(1170, 710))
  tg.failNext('createTopic', new TelegramError(500, 'Internal Server Error'))
  await app.handleUpdate(failing(1171, 711))
  assert.equal(alerts().length, 2)

  tg.failNext('createTopic', new TelegramError(500, 'Internal Server Error'))
  await app.handleUpdate(failing(1172, 712))
  assert.equal(alerts().length, 2)
})


test('сообщение в незнакомой теме — никому, подсказка в эту тему', async () => {
  const { app, tg, translator, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const translated = translator.calls.length
  const reply = fixture('owner-message-in-topic')
  reply.message!.message_thread_id = 999
  await app.handleUpdate(reply)
  assert.equal(tg.sentAsOwner().length, 0)
  assert.equal(translator.calls.length, translated)
  assert.ok(tg.callsOf('sendText').some((call) => call.text === STRAY_TOPIC && call.opts.threadId === 999))
})

test('поломка в чате с ботом — сказано, что ответ мог не уйти', async () => {
  const { app, tg, store, connectOwner } = started()
  connectOwner()
  store.findConversationByTopic = () => {
    throw new Error('база недоступна')
  }
  const reply = fixture('owner-message-in-topic')
  reply.message!.message_thread_id = 70
  await app.handleUpdate(reply)
  assert.ok(tg.callsOf('sendText').some((call) => call.text.includes('Ответ мог не уйти')))
})

test('поломка при подключении — сказано отправить /start', async () => {
  const { app, tg, store } = started()
  store.getConnection = () => {
    throw new Error('база недоступна')
  }
  await app.handleUpdate(fixture('business-connection-owner'))
  assert.ok(tg.callsOf('sendText').some((call) => call.text.includes('/start')))
})

test('спека: посторонний набирает «@бот 12» — ни ответа, ни записей, ни модели', async () => {
  const { app, tg, store, translator, deps } = started()
  store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi', now: deps.now() })
  const update = fixture('inline-query-owner')
  update.inline_query!.from = { ...update.inline_query!.from, id: 400004 }
  await app.handleUpdate(update)
  assert.equal(tg.calls.length, 0)
  assert.equal(translator.calls.length, 0)
  assert.equal(store.isProcessed(1401), false)
})

test('inline-запрос владельца — ответ с его переводом', async () => {
  const { app, tg, store, deps } = started()
  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi', now: deps.now() })
  const update = fixture('inline-query-owner')
  update.inline_query!.query = String(draft.id)
  await app.handleUpdate(update)
  const [answer] = tg.callsOf('answerInline')
  assert.equal(answer!.queryId, 'IQ1')
  assert.deepEqual(answer!.articles.map((article) => article.text), ['Hi'])
})

test('inline-ответ не ушёл — владелец знает, что нажать', async () => {
  const { app, tg } = started()
  tg.failNext('answerInline', new TelegramError(400, 'Bad Request: query is too old'))
  await app.handleUpdate(fixture('inline-query-owner'))
  assert.ok(
    tg.callsOf('sendText').some((call) =>
      call.text.startsWith('Не удалось ответить на кнопку «Отправить через бота»: Bad Request: query is too old. Попробуйте ещё раз или нажмите «Скопировать».'),
    ),
  )
})

test('бот просит у Telegram inline-запросы — иначе «Отправить через бота» молча не работает', () => {
  assert.ok(ALLOWED_UPDATES.includes('inline_query'))
})
