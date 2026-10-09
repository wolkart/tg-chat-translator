import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Message } from 'grammy/types'
import { onBusinessMessage, parseBusinessMessage } from '../src/channels/private-chat/incoming.ts'
import { TranslationError } from '../src/translate/llm.ts'
import { BOT_ID, CONNECTION_ID, OWNER_ID, PEER_ID, messageFixture } from './helpers.ts'
import { fakeTranslator, setupDeps } from './setup.ts'

const ownerConnection = { id: CONNECTION_ID, ownerId: OWNER_ID, userChatId: OWNER_ID, canReply: true, isEnabled: true, allowed: true }

function peerText(text: string, messageId = 600): Message {
  return { ...messageFixture('business-message-peer-text'), text, message_id: messageId }
}

test('разбор: входящее от собеседника', () => {
  const replica = parseBusinessMessage(messageFixture('business-message-peer-text'), ownerConnection, 300003)
  assert.notEqual(replica, 'echo')
  if (replica === 'echo') return
  assert.equal(replica.direction, 'peer')
  assert.equal(replica.peerChatId, PEER_ID)
  assert.equal(replica.peerName, 'Alex Peer')
  assert.equal(replica.text, 'See you at 7?')
  assert.equal(replica.sourceMessageId, 501)
})

test('разбор: своё сообщение владельца из лички', () => {
  const replica = parseBusinessMessage(messageFixture('business-message-owner-direct'), ownerConnection, 300003)
  if (replica === 'echo') return assert.fail('своё сообщение владельца — не эхо')
  assert.equal(replica.direction, 'owner-direct')
  assert.equal(replica.peerChatId, PEER_ID)
})

test('разбор: эхо собственной отправки бота', () => {
  assert.equal(parseBusinessMessage(messageFixture('business-message-echo'), ownerConnection, 300003), 'echo')
})

test('новый собеседник на чужом языке: тема с переводом, история, время последнего сообщения', async () => {
  const { deps, tg, store, translator } = setupDeps()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  const conversation = store.findConversationByPeer(OWNER_ID, PEER_ID)!
  assert.ok(conversation)
  assert.equal(tg.callsOf('createTopic')[0]!.name, 'Alex Peer')
  const posted = tg.callsOf('sendText').at(-1)!
  assert.equal(posted.chatId, OWNER_ID)
  assert.equal(posted.text, '[ru] See you at 7?\n<blockquote expandable>See you at 7?</blockquote>')
  assert.equal(translator.calls[0]!.target.code, 'ru')
  assert.deepEqual(store.recentReplicas(conversation.id), [{ role: 'peer', text: 'See you at 7?' }])
  assert.equal(conversation.lastPeerAt, deps.now())
})

test('друг пишет по-русски: ничего не хранится, модель не вызывается, в Telegram ничего не уходит', async () => {
  const { deps, tg, store, translator, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, peerText('Привет, ты где?'))
  assert.equal(store.findConversationByPeer(OWNER_ID, PEER_ID), undefined)
  assert.equal(translator.calls.length, 0)
  assert.equal(tg.calls.length, 0)
})

test('первое сообщение — фото без подписи: разговор не начинается; следом английский текст — начинается', async () => {
  const { deps, store, translator, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-photo-no-caption'))
  assert.equal(store.findConversationByPeer(OWNER_ID, PEER_ID), undefined)
  assert.equal(translator.calls.length, 0)
  await onBusinessMessage(deps, peerText('Hello, are you there?'))
  assert.ok(store.findConversationByPeer(OWNER_ID, PEER_ID))
})

test('владелец пишет первым — разговор не начинается', async () => {
  const { deps, store, tg, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-owner-direct'))
  assert.equal(store.findConversationByPeer(OWNER_ID, PEER_ID), undefined)
  assert.equal(tg.calls.length, 0)
})

test('эхо не повторяется в теме — ни по sender_business_bot, ни по записи об отправке', async () => {
  const { deps, tg, store, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  const before = tg.calls.length
  await onBusinessMessage(deps, messageFixture('business-message-echo'))
  store.rememberSent(OWNER_ID, PEER_ID, 507, deps.now())
  await onBusinessMessage(deps, messageFixture('business-message-owner-direct'))
  assert.equal(tg.calls.length, before)
})

test('иностранец пишет по-русски в начатом разговоре — как есть, без модели', async () => {
  const { deps, tg, translator, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, peerText('спасибо', 601))
  assert.equal(translator.calls.length, 1)
  assert.equal(tg.callsOf('sendText').at(-1)!.text, 'спасибо')
})

test('перевод не удался — в теме оригинал с пометкой', async () => {
  const failing = fakeTranslator(() => {
    throw new TranslationError('OpenRouter ответил ошибкой 503: overloaded')
  })
  const { deps, tg, connectOwner } = setupDeps({ overrides: { translator: failing.translate } })
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  assert.equal(
    tg.callsOf('sendText').at(-1)!.text,
    'See you at 7?\n<i>Перевод не удался: OpenRouter ответил ошибкой 503: overloaded</i>',
  )
})

test('нет ключа модели — входящее в теме без перевода, с причиной', async () => {
  const { deps, tg, connectOwner } = setupDeps({
    overrides: { translator: null, translatorProblem: 'Нет ключа модели — переводить нечем.' },
  })
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  assert.match(tg.callsOf('sendText').at(-1)!.text, /Перевод не удался: Нет ключа модели/)
})

test('модель видит историю разговора', async () => {
  const { deps, translator, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, peerText('Are you coming?', 602))
  assert.deepEqual(translator.calls[1]!.history, [{ role: 'peer', text: 'See you at 7?' }])
})

test('своё сообщение владельца из лички — «Вы в личке:» в теме и в истории, без модели', async () => {
  const { deps, tg, store, translator, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, messageFixture('business-message-owner-direct'))
  assert.equal(translator.calls.length, 1)
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<i>Вы в личке:</i> ok, see you')
  const conversation = store.findConversationByPeer(OWNER_ID, PEER_ID)!
  assert.deepEqual(store.recentReplicas(conversation.id).at(-1), { role: 'owner', text: 'ok, see you' })
})

test('фото с подписью — в теме фото с переведённой подписью', async () => {
  const { deps, tg, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-photo'))
  const media = tg.callsOf('sendMedia')[0]!
  assert.equal(media.kind, 'photo')
  assert.equal(media.file, 'PHOTO_BIG_1')
  assert.equal(media.opts.caption, '[ru] My new car')
})

test('голосовое — в теме без перевода', async () => {
  const { deps, tg, translator, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, messageFixture('business-message-peer-voice'))
  const media = tg.callsOf('sendMedia')[0]!
  assert.equal(media.kind, 'voice')
  assert.equal(media.opts.caption, undefined)
  assert.equal(translator.calls.length, 1)
})

test('геопозиция — пометка «посмотрите в личке»', async () => {
  const { deps, tg, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, messageFixture('business-message-peer-location'))
  assert.equal(tg.callsOf('sendText').at(-1)!.text, 'Alex Peer прислал геопозицию — посмотрите в личке')
})

test('вложение не переслалось — пометка вместо него', async () => {
  const { deps, tg, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  tg.failNext('sendMedia', new Error('wrong file identifier'))
  tg.failNext('downloadFile', new Error('file is too big'))
  await onBusinessMessage(deps, messageFixture('business-message-peer-voice'))
  assert.equal(tg.callsOf('sendText').at(-1)!.text, 'Alex Peer прислал голосовое — посмотрите в личке')
})

test('язык владельца без профиля — новые разговоры не заводятся', async () => {
  const { deps, store, translator, connectOwner } = setupDeps({
    overrides: { languages: null, languagesProblem: 'Не поддерживается ваш язык «xx»' },
  })
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  assert.equal(store.findConversationByPeer(OWNER_ID, PEER_ID), undefined)
  assert.equal(translator.calls.length, 0)
})

test('подключение постороннего: его сообщения не обрабатываются', async () => {
  const { deps, tg, store, translator } = setupDeps({
    connections: [
      { id: 'BCSTRANGER0001', userId: 400004, userName: 'Stranger', userChatId: 400004, canReply: true, isEnabled: true },
    ],
  })
  const message = { ...messageFixture('business-message-peer-text'), business_connection_id: 'BCSTRANGER0001' }
  await onBusinessMessage(deps, message)
  assert.equal(store.findConversationByPeer(400004, PEER_ID), undefined)
  assert.equal(translator.calls.length, 0)
  assert.equal(tg.callsOf('createTopic').length, 0)
})

test('неизвестное подключение: getBusinessConnection один раз на два сообщения', async () => {
  const { deps, tg } = setupDeps()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, peerText('Second message here', 610))
  assert.equal(tg.callsOf('getBusinessConnection').length, 1)
})


test('эмодзи в начатом разговоре — как есть, без модели', async () => {
  const { deps, tg, translator, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, peerText('👍🔥', 620))
  assert.equal(translator.calls.length, 1)
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '👍🔥')
})
test('перевод не удался дважды — две пометки в теме и одно общее сообщение', async () => {
  const failing = fakeTranslator(() => {
    throw new TranslationError('OpenRouter ответил ошибкой 503: overloaded')
  })
  const { deps, tg, connectOwner } = setupDeps({ overrides: { translator: failing.translate } })
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  await onBusinessMessage(deps, peerText('Are you there?', 630))
  const sent = tg.callsOf('sendText')
  assert.equal(sent.filter((c) => c.opts.threadId !== undefined && /Перевод не удался/.test(c.text)).length, 2)
  const general = sent.filter((c) => c.opts.threadId === undefined)
  assert.equal(general.length, 1)
  assert.match(general[0]!.text, /^Модель не переводит:/)
})

test('следующее сообщение собеседника обновляет время последнего сообщения', async () => {
  const { deps, store, advance, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  const first = store.findConversationByPeer(OWNER_ID, PEER_ID)!.lastPeerAt
  advance(60_000)
  await onBusinessMessage(deps, peerText('Are you coming?', 640))
  const second = store.findConversationByPeer(OWNER_ID, PEER_ID)!.lastPeerAt
  assert.equal(second, deps.now())
  assert.notEqual(second, first)
})


function ownerDirect(extra: Record<string, unknown>, messageId: number): Message {
  const base = { ...messageFixture('business-message-owner-direct'), message_id: messageId } as unknown as Record<string, unknown>
  delete base.text
  return { ...base, ...extra } as unknown as Message
}

test('своё фото владельца без подписи — в теме с пометкой «Вы в личке»', async () => {
  const { deps, tg, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  const photo = (messageFixture('business-message-peer-photo') as unknown as { photo: unknown }).photo
  await onBusinessMessage(deps, ownerDirect({ photo }, 610))
  const media = tg.callsOf('sendMedia')[0]!
  assert.equal(media.kind, 'photo')
  assert.match(String(media.opts.caption), /Вы в личке/)
})

test('свой стикер владельца — пометка «Вы в личке» отдельным сообщением', async () => {
  const { deps, tg, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  const sticker = (messageFixture('business-message-peer-sticker') as unknown as { sticker: unknown }).sticker
  await onBusinessMessage(deps, ownerDirect({ sticker }, 611))
  assert.equal(tg.callsOf('sendMedia')[0]!.kind, 'sticker')
  assert.match(tg.callsOf('sendText').at(-1)!.text, /Вы в личке/)
})

test('фото собеседника не переслалось — пометка содержит переведённую подпись', async () => {
  const { deps, tg, connectOwner } = setupDeps()
  connectOwner()
  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
  tg.failNext('sendMedia', new Error('wrong file identifier'))
  tg.failNext('downloadFile', new Error('file is too big'))
  await onBusinessMessage(deps, messageFixture('business-message-peer-photo'))
  const notice = tg.callsOf('sendText').at(-1)!.text
  assert.match(notice, /прислал фото — посмотрите в личке/)
  assert.match(notice, /\[ru\] My new car/)
})

test('сообщение в чате владельца с самим ботом игнорируется', async () => {
  const { deps, tg, store, connectOwner } = setupDeps()
  connectOwner()
  const before = tg.calls.length
  const message = { ...messageFixture('business-message-peer-text'), chat: { id: BOT_ID, type: 'private', first_name: 'Bot' } } as unknown as Message
  await onBusinessMessage(deps, message)
  assert.equal(tg.calls.length, before)
  assert.equal(store.findConversationByPeer(OWNER_ID, BOT_ID), undefined)
})
