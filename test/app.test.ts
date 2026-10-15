import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Update } from 'grammy/types'
import { ALLOWED_UPDATES, CANT_FORWARD, UNKNOWN_COMMAND, commandOf, createApp } from '../src/app.ts'
import { CONNECTED } from '../src/channels/private-chat/connection.ts'
import { FIRST_TEXT_ONLY } from '../src/owner/manual-send.ts'
import { STRAY_TOPIC } from '../src/owner/routing.ts'
import { CONNECTION_ID, OWNER_ID, PEER_ID, fixture } from './helpers.ts'
import { TelegramError } from '../src/telegram.ts'
import { fakeTranslator, setupDeps } from './setup.ts'

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

/** Сообщение владельца с командой — как его размечает Telegram. */
function command(text: string, extra: { threadId?: number; updateId?: number } = {}): Update {
  const update = withUpdateId(fixture('owner-message-start'), extra.updateId ?? 1205)
  const name = text.split(' ')[0]!
  update.message!.text = text
  update.message!.entities = [{ type: 'bot_command', offset: 0, length: name.length }]
  if (extra.threadId !== undefined) update.message!.message_thread_id = extra.threadId
  return update
}

test('спека: владелец открывает панель — /start отвечает панелью с кнопками', async () => {
  const { app, tg } = started()
  await app.handleUpdate(fixture('owner-message-start'))
  const [panel] = tg.callsOf('sendText')
  assert.ok(panel!.text.startsWith('<b>⚙️ Переводчик</b>'))
  assert.equal(panel!.opts.html, true)
  assert.ok(panel!.opts.keyboard?.flat().some((button) => button.text === '🔄 Обновить'))
})

test('спека: значок настроек на плашке чата — /start bizChat123 открывает ту же панель', async () => {
  const { app, tg } = started()
  await app.handleUpdate(command('/start bizChat123'))
  assert.ok(tg.callsOf('sendText')[0]!.text.startsWith('<b>⚙️ Переводчик</b>'))
})

test('/start в теме — панель приходит в эту тему', async () => {
  const { app, tg } = started()
  await app.handleUpdate(command('/start', { threadId: 77 }))
  assert.equal(tg.callsOf('sendText')[0]!.opts.threadId, 77)
})

test('спека: посторонний набирает /start — ни ответа, ни записей', async () => {
  const { app, tg, store } = started()
  const update = command('/start', { updateId: 1301 })
  const message = update.message!
  message.from = { ...message.from!, id: 400004 }
  message.chat = { ...message.chat, id: 400004 } as typeof message.chat
  await app.handleUpdate(update)
  assert.equal(tg.calls.length, 0)
  assert.equal(store.isProcessed(1301), false)
})

test('спека: команда в теме собеседнику не уходит — «Такой команды нет» в ту же тему', async () => {
  const { app, tg, store, translator, connectOwner } = started()
  connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const topicId = store.findConversationByPeer(OWNER_ID, PEER_ID)!.topicId!
  const calls = translator.calls.length
  await app.handleUpdate(command('/help', { threadId: topicId, updateId: 1302 }))
  assert.equal(tg.sentAsOwner().length, 0)
  assert.equal(translator.calls.length, calls)
  const answer = tg.callsOf('sendText').at(-1)!
  assert.equal(answer.text, UNKNOWN_COMMAND)
  assert.equal(answer.text, 'Такой команды нет. Настройки и статус — /start.')
  assert.equal(answer.opts.threadId, topicId)
})

test('спека: похожая команда — /startup панель не открывает', async () => {
  const { app, tg } = started()
  await app.handleUpdate(command('/startup'))
  assert.deepEqual(tg.callsOf('sendText').map((call) => call.text), [UNKNOWN_COMMAND])
})

test('разбор команды: имя без «@бот» и параметров; не команда — null', () => {
  const message = (text: string, entities?: { type: 'bot_command'; offset: number; length: number }[]) =>
    ({ ...fixture('owner-message-start').message!, text, entities }) as Parameters<typeof commandOf>[0]
  assert.equal(commandOf(message('/Start@translator_bot draft', [{ type: 'bot_command', offset: 0, length: 21 }])), 'start')
  assert.equal(commandOf(message('/start')), null)
  assert.equal(commandOf(message('привет /start', [{ type: 'bot_command', offset: 7, length: 6 }])), null)
})

test('спека: нажатие кнопки панели через диспетчер — экран правится на месте', async () => {
  const { app, tg } = started()
  await app.handleUpdate(fixture('owner-message-start'))
  const panelId = tg.callsOf('sendText')[0]!.id
  const press = withUpdateId(fixture('callback-choose'), 1303)
  press.callback_query!.data = 'p:refresh'
  press.callback_query!.message = { ...press.callback_query!.message!, message_id: panelId }
  await app.handleUpdate(press)
  const [edit] = tg.callsOf('editText')
  assert.equal(edit!.messageId, panelId)
  assert.ok(edit!.text.startsWith('<b>⚙️ Переводчик</b>'))
  assert.equal(tg.callsOf('sendText').length, 1)
})

test('спека: панель пережила перезапуск — кнопка старой панели работает в новом приложении', async () => {
  const ctx = setupDeps()
  await createApp(ctx.deps).handleUpdate(fixture('owner-message-start'))
  const panelId = ctx.tg.callsOf('sendText')[0]!.id
  const press = withUpdateId(fixture('callback-choose'), 1304)
  press.callback_query!.data = 'p:main'
  press.callback_query!.message = { ...press.callback_query!.message!, message_id: panelId }
  await createApp(ctx.deps).handleUpdate(press)
  assert.equal(ctx.tg.callsOf('editText')[0]!.messageId, panelId)
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
  tg.failNext('answerInline', new TelegramError(500, 'Internal Server Error'))
  await app.handleUpdate(fixture('inline-query-owner'))
  assert.ok(
    tg.callsOf('sendText').some((call) =>
      call.text.startsWith('Не удалось ответить на кнопку «Отправить через бота»: Internal Server Error. Попробуйте ещё раз или нажмите «Скопировать».'),
    ),
  )
})

test('бот просит у Telegram inline-запросы — иначе «Отправить через бота» молча не работает', () => {
  assert.ok(ALLOWED_UPDATES.includes('inline_query'))
})

test('спека: новый собеседник ответил — написать первым, отправить через бота, ответ в той же теме, дальше автоматически', async () => {
  const dictionary: Record<string, string> = {
    'Привет! Я по поводу квартиры': "Hi! I'm writing about the apartment.",
    "Yes, it's still available": 'Да, ещё свободна',
    'Когда можно посмотреть?': 'When can I see it?',
  }
  const translator = fakeTranslator((request) => dictionary[request.text] ?? `[${request.target.code}] ${request.text}`)
  const { app, tg, store, connectOwner } = started({ overrides: { translator: translator.translate } })
  connectOwner()
  const MARIA = 200005

  // 1. Владелец пишет вне тем — перевод с кнопками.
  const first = fixture('owner-message-outside')
  first.message!.text = 'Привет! Я по поводу квартиры'
  await app.handleUpdate(first)
  const draftMessage = tg.callsOf('sendText').at(-1)!
  const draftId = draftMessage.opts.keyboard![0]![0]!.chooseChat!

  // 2. «Отправить через бота» → выбор чата → Telegram спрашивает бота.
  const query = fixture('inline-query-owner')
  query.inline_query!.query = draftId
  await app.handleUpdate(query)
  const [article] = tg.callsOf('answerInline')[0]!.articles
  assert.equal(article!.text, "Hi! I'm writing about the apartment.")

  // 3. Нажатие на вариант: сообщение «via @бот» приходит боту из лички Maria.
  const sent = fixture('business-message-via-bot')
  sent.business_message!.text = article!.text
  await app.handleUpdate(sent)
  const conversation = store.findConversationByPeer(OWNER_ID, MARIA)!
  assert.ok(conversation)

  // 4. Maria отвечает — перевод в ту же тему.
  const answer = withUpdateId(fixture('business-message-peer-text'), 1180)
  answer.business_message!.chat = { id: MARIA, type: 'private', first_name: 'Maria' }
  answer.business_message!.from = { id: MARIA, is_bot: false, first_name: 'Maria' }
  answer.business_message!.message_id = 720
  answer.business_message!.text = "Yes, it's still available"
  await app.handleUpdate(answer)
  assert.equal(tg.callsOf('createTopic').length, 1)
  const topicId = store.findConversationByPeer(OWNER_ID, MARIA)!.topicId!
  const translated = tg.callsOf('sendText').at(-1)!
  assert.equal(translated.opts.threadId, topicId)
  assert.match(translated.text, /^Да, ещё свободна/)

  // 5. Ответ владельца в теме уходит Maria от его имени, сам.
  const reply = withUpdateId(fixture('owner-message-in-topic'), 1181)
  reply.message!.message_thread_id = topicId
  reply.message!.text = 'Когда можно посмотреть?'
  await app.handleUpdate(reply)
  const [toMaria] = tg.sentAsOwner()
  assert.ok(toMaria && toMaria.method === 'sendText')
  assert.equal(toMaria.chatId, MARIA)
  assert.equal(toMaria.text, 'When can I see it?')
  assert.equal(toMaria.opts.businessConnectionId, CONNECTION_ID)
})

test('отправка через бота, доставленная повторно после перезапуска, — одна тема и одна строка «Вы:»', async () => {
  const { app, tg, store, connectOwner, deps } = started()
  connectOwner()
  store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет! Я по поводу квартиры', translation: "Hi! I'm writing about the apartment.", now: deps.now() })
  await app.handleUpdate(fixture('business-message-via-bot'))
  await app.handleUpdate(fixture('business-message-via-bot'))
  assert.equal(tg.callsOf('createTopic').length, 1)
  assert.equal(tg.callsOf('sendText').filter((call) => call.text.startsWith('<i>Вы:</i>')).length, 1)
})
