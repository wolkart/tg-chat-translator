import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendOwnerReply } from '../src/channels/private-chat/outgoing.ts'
import { TelegramError } from '../src/telegram.ts'
import { TranslationError } from '../src/translate/llm.ts'
import type { OwnerPayload } from '../src/types.ts'
import { CONNECTION_ID, OWNER_ID, PEER_ID } from './helpers.ts'
import { fakeTranslator, setupDeps } from './setup.ts'

function prepared(options: Parameters<typeof setupDeps>[0] = {}) {
  const ctx = setupDeps(options)
  ctx.connectOwner()
  const conversation = ctx.store.createConversation({
    ownerId: OWNER_ID,
    connectionId: CONNECTION_ID,
    peerChatId: PEER_ID,
    peerName: 'Alex Peer',
    now: ctx.deps.now(),
  })
  ctx.store.addReplica(conversation.id, { role: 'peer', original: 'How are you?', translation: 'Как дела?' }, ctx.deps.now())
  return { ...ctx, conversation }
}

const reply: OwnerPayload = { text: 'Отлично, а ты?', media: null, sourceMessageId: 901 }

test('ответ уходит собеседнику от имени владельца, в теме видно, что ушло', async () => {
  const { deps, tg, store, translator, conversation } = prepared()
  const ok = await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(ok, true)

  assert.equal(translator.calls[0]!.target.code, 'en')
  assert.deepEqual(translator.calls[0]!.history, [{ role: 'peer', text: 'How are you?' }])

  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.chatId, PEER_ID)
  assert.equal(toPeer.text, '[en] Отлично, а ты?')
  assert.equal(toPeer.opts.businessConnectionId, CONNECTION_ID)
  assert.equal(toPeer.opts.html, undefined)

  const inTopic = tg.callsOf('sendText').at(-1)!
  assert.equal(inTopic.chatId, OWNER_ID)
  assert.equal(inTopic.text, '<i>Вы:</i> Отлично, а ты?\n→ [en] Отлично, а ты?')
  assert.ok(!tg.callsOf('sendText').some((call) => call.text.startsWith('✓')))

  assert.equal(store.recentReplicas(conversation.id).at(-1)?.role, 'owner')
})

test('отправленное запоминается, чтобы его эхо не повторилось в теме', async () => {
  const { deps, tg, store, conversation } = prepared()
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(store.wasSent(OWNER_ID, PEER_ID, toPeer.id), true)
})

test('ответ вне темы получает «✓ <имя>»', async () => {
  const { deps, tg, conversation } = prepared()
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: true })
  const check = tg.callsOf('sendText').at(-1)!
  assert.equal(check.text, '✓ Alex Peer')
  assert.equal(check.chatId, OWNER_ID)
  assert.equal(check.opts.replyTo, 901)
})

test('перевод не удался — собеседнику ничего, оригинал не уходит, в теме причина', async () => {
  const failing = fakeTranslator(() => {
    throw new TranslationError('модель не ответила за 30 с')
  })
  const { deps, tg, conversation } = prepared({ overrides: { translator: failing.translate } })
  const ok = await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(ok, false)
  assert.equal(tg.sentAsOwner().length, 0)
  assert.ok(!tg.calls.some((call) => call.method === 'sendText' && call.chatId === PEER_ID))
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<b>Не отправлено:</b> перевод не удался — модель не ответила за 30 с')
})

test('Telegram отказал — «Не отправлено», причина и перевод, повтора нет', async () => {
  const { deps, tg, store, conversation } = prepared()
  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
  const ok = await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(ok, false)
  assert.equal(tg.sentAsOwner().length, 1)
  assert.equal(
    tg.callsOf('sendText').at(-1)!.text,
    '<b>Не отправлено.</b> Bad Request: BUSINESS_PEER_USAGE_MISSING\nПеревод:\n[en] Отлично, а ты?',
  )
  assert.equal(store.recentReplicas(conversation.id).length, 1)
})

test('бот отключён от аккаунта — не отправляем, говорим почему', async () => {
  const { deps, tg, connectOwner, conversation } = prepared()
  connectOwner({ isEnabled: false })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(tg.sentAsOwner().length, 0)
  assert.match(tg.callsOf('sendText').at(-1)!.text, /Не отправлено\.<\/b> бот отключён/)
})

test('холостой прогон: от имени владельца ничего не уходит, в теме — «ушло бы»', async () => {
  const { deps, tg, conversation } = prepared({ overrides: { dry: true } })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  await sendOwnerReply(deps, conversation, { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 }, { outsideTopic: false })
  assert.equal(tg.sentAsOwner().length, 0)
  const texts = tg.callsOf('sendText').map((call) => call.text)
  assert.ok(texts.includes('<i>Холостой прогон: ушло бы —</i> [en] Отлично, а ты?'))
  assert.ok(texts.includes('<i>Холостой прогон: ушло бы —</i> [фото] [en] Это тебе'))
  assert.ok(!texts.some((text) => text.includes('ушло бы —</i> Это тебе')))
})

test('фото владельца из темы уходит собеседнику с переведённой подписью', async () => {
  const { deps, tg, conversation } = prepared()
  await sendOwnerReply(
    deps,
    conversation,
    { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 },
    { outsideTopic: false },
  )
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendMedia')
  assert.equal(toPeer.chatId, PEER_ID)
  assert.equal(toPeer.file, 'OWNER_PHOTO_1')
  assert.equal(toPeer.opts.caption, '[en] Это тебе')
  assert.equal(toPeer.opts.html, undefined)
})

test('стикер владельца без текста уходит без вызова модели', async () => {
  const { deps, tg, translator, conversation } = prepared()
  await sendOwnerReply(deps, conversation, { text: '', media: { kind: 'sticker', fileId: 'S' }, sourceMessageId: 905 }, { outsideTopic: false })
  assert.equal(translator.calls.length, 0)
  assert.equal(tg.sentAsOwner().length, 1)
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<i>Вы:</i> [стикер]')
})

test('длинный перевод уходит собеседнику несколькими сообщениями', async () => {
  const long = fakeTranslator(() => 'слово '.repeat(1500))
  const { deps, tg, conversation } = prepared({ overrides: { translator: long.translate } })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  const parts = tg.sentAsOwner()
  assert.ok(parts.length >= 3)
  for (const part of parts) assert.ok(part.method === 'sendText' && part.text.length <= 4096)
})

test('владелец переподключил бота — ответ идёт через текущее подключение, а не через старое', async () => {
  const { deps, tg, store } = prepared()
  const old = store.createConversation({ ownerId: OWNER_ID, connectionId: 'BC_OLD', peerChatId: 200009, peerName: 'Old Peer', now: deps.now() })
  await sendOwnerReply(deps, old, reply, { outsideTopic: false })
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.opts.businessConnectionId, CONNECTION_ID)
})

test('ответ с «<» и «&» уходит собеседнику как есть, а в теме экранирован', async () => {
  const echo = fakeTranslator((request) => request.text)
  const { deps, tg, conversation } = prepared({ overrides: { translator: echo.translate } })
  await sendOwnerReply(deps, conversation, { text: 'Tom & Jerry <3', media: null, sourceMessageId: 906 }, { outsideTopic: false })
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.text, 'Tom & Jerry <3')
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<i>Вы:</i> Tom &amp; Jerry &lt;3\n→ Tom &amp; Jerry &lt;3')
})

test('перевод ответа не удался дважды — две пометки в теме и одно общее сообщение', async () => {
  let n = 0
  const failing = fakeTranslator(() => {
    n += 1
    throw new TranslationError(`OpenRouter ответил ошибкой 503: overloaded, request ${n === 1 ? 'abc' : 'def'}`)
  })
  const { deps, tg, conversation } = prepared({ overrides: { translator: failing.translate } })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  await sendOwnerReply(deps, conversation, { ...reply, sourceMessageId: 902 }, { outsideTopic: false })
  const sends = tg.callsOf('sendText')
  const general = sends.filter((call) => call.opts.threadId === undefined)
  assert.equal(general.length, 1)
  assert.ok(general[0]!.text.startsWith('Модель не переводит:'))
  const marks = sends.filter((call) => call.opts.threadId !== undefined && call.text.includes('Не отправлено:</b> перевод не удался'))
  assert.equal(marks.length, 2)
})

test('ответ на «✓ <имя>» уходит тому же собеседнику', async () => {
  const { deps, tg, store, conversation } = prepared()
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: true })
  const check = tg.callsOf('sendText').at(-1)!
  assert.equal(store.conversationByBotMessage(OWNER_ID, check.id)?.id, conversation.id)
})
