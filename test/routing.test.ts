import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DAY } from '../src/store.ts'
import { ALREADY_HANDLED, askWhom, chooseKeyboard, onChoice, parseChoice, routeOwnerMessage } from '../src/owner/routing.ts'
import type { Conversation, OwnerPayload } from '../src/types.ts'
import { CONNECTION_ID, OWNER_ID, T0 } from './helpers.ts'
import { setupDeps } from './setup.ts'

function withConversations(...peers: { id: number; name: string; lastPeerAt: number }[]) {
  const ctx = setupDeps()
  const conversations = peers.map((peer) =>
    ctx.store.createConversation({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, peerChatId: peer.id, peerName: peer.name, lastPeerAt: peer.lastPeerAt }),
  )
  return { ...ctx, conversations }
}

test('ответ в теме уходит этому собеседнику', () => {
  const { store, conversations } = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 - 3 * DAY })
  store.setTopic(conversations[0]!.id, 77)
  const route = routeOwnerMessage({ threadId: 77 }, store, OWNER_ID, T0)
  assert.deepEqual(route, { kind: 'conversation', conversation: { ...conversations[0]!, topicId: 77 }, viaTopic: true })
})

test('ответ кнопкой «Ответить» на перевод — собеседнику этого перевода', () => {
  const { store, conversations } = withConversations(
    { id: 1, name: 'Timon', lastPeerAt: T0 },
    { id: 2, name: 'Anna', lastPeerAt: T0 },
  )
  store.rememberBotMessage(OWNER_ID, 600, conversations[1]!.id, T0)
  const route = routeOwnerMessage({ replyToMessageId: 600 }, store, OWNER_ID, T0)
  assert.equal(route.kind === 'conversation' && route.conversation.peerName, 'Anna')
})

test('спека: вне тем при одном активном разговоре — тоже «Кому?», бот адресата не угадывает', () => {
  const { store } = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 - DAY }, { id: 2, name: 'Old', lastPeerAt: T0 - DAY - 1 })
  const route = routeOwnerMessage({}, store, OWNER_ID, T0)
  assert.equal(route.kind, 'choose')
  if (route.kind === 'choose') assert.deepEqual(route.options.map((c) => c.peerName), ['Timon'])
})

test('вне тем при нескольких активных — «Кому?»', () => {
  const { store } = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 }, { id: 2, name: 'Anna', lastPeerAt: T0 - 1 })
  const route = routeOwnerMessage({}, store, OWNER_ID, T0)
  assert.equal(route.kind, 'choose')
  if (route.kind === 'choose') assert.deepEqual(route.options.map((c) => c.peerName), ['Timon', 'Anna'])
})

test('спека: активных нет — перевод для нового собеседника', () => {
  const { store } = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 - DAY - 1 })
  assert.deepEqual(routeOwnerMessage({}, store, OWNER_ID, T0), { kind: 'new' })
})

test('незнакомая тема — никому, даже при одном активном разговоре', () => {
  const { store, conversations } = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 })
  assert.equal(routeOwnerMessage({ threadId: 999 }, store, OWNER_ID, T0).kind, 'stray-topic')
  store.rememberBotMessage(OWNER_ID, 5000, conversations[0]!.id, T0)
  assert.equal(routeOwnerMessage({ threadId: 999, replyToMessageId: 5000 }, store, OWNER_ID, T0).kind, 'stray-topic')
})

test('кнопки «Кому?»: имена, «Отмена», данные влезают в 64 байта', () => {
  const conversation = { id: 123456789, peerName: 'Anna' } as Conversation
  const keyboard = chooseKeyboard(987654321, [conversation])
  assert.deepEqual(keyboard, [[{ text: 'Anna', data: 'to:987654321:123456789' }], [{ text: 'Отмена', data: 'cancel:987654321' }]])
  for (const row of keyboard) for (const button of row) assert.ok(Buffer.byteLength(button.data) <= 64)
})

test('кнопки «Кому?» для текста: имена, «Новому собеседнику», «Отмена»', () => {
  const conversation = { id: 5, peerName: 'Timon' } as Conversation
  assert.deepEqual(chooseKeyboard(9, [conversation], { newPeer: true }), [
    [{ text: 'Timon', data: 'to:9:5' }],
    [{ text: 'Новому собеседнику', data: 'new:9' }],
    [{ text: 'Отмена', data: 'cancel:9' }],
  ])
})

test('parseChoice', () => {
  assert.deepEqual(parseChoice('new:7'), { kind: 'new', pendingId: 7 })
  assert.deepEqual(parseChoice('to:1:2'), { kind: 'to', pendingId: 1, conversationId: 2 })
  assert.deepEqual(parseChoice('cancel:3'), { kind: 'cancel', pendingId: 3 })
  assert.equal(parseChoice('to:x:1'), null)
  assert.equal(parseChoice('other'), null)
})

const payload: OwnerPayload = { text: 'Привет!', media: null, sourceMessageId: 903 }

async function asked() {
  const ctx = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 }, { id: 2, name: 'Anna', lastPeerAt: T0 })
  await askWhom(ctx.deps, payload, ctx.conversations)
  const question = ctx.tg.callsOf('sendText')[0]!
  const sent: { conversation: Conversation; payload: OwnerPayload }[] = []
  const send = async (conversation: Conversation, p: OwnerPayload) => {
    sent.push({ conversation, payload: p })
    return true
  }
  return { ...ctx, question, sent, send }
}

test('«Кому?» — вопрос с кнопками в ответ на сообщение владельца, ничего не отправлено', async () => {
  const { question, sent, tg } = await asked()
  assert.equal(question.text, 'Кому?')
  assert.equal(question.opts.replyTo, 903)
  assert.deepEqual(
    question.opts.keyboard!.map((row) => row[0]!.text),
    ['Timon', 'Anna', 'Новому собеседнику', 'Отмена'],
  )
  assert.equal(sent.length, 0)
  assert.equal(tg.sentAsOwner().length, 0)
})

test('выбор адресата: сообщение уходит ему, вопрос превращается в «Отправлено <имя>»', async () => {
  const { deps, question, sent, send, tg } = await asked()
  const annaButton = question.opts.keyboard![1]![0]!
  await onChoice(deps, { id: 'CB1', data: annaButton.data! }, send)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.conversation.peerName, 'Anna')
  assert.deepEqual(sent[0]!.payload, payload)
  assert.deepEqual(tg.callsOf('editText')[0], { method: 'editText', chatId: OWNER_ID, messageId: question.id, text: 'Отправлено Anna' })
})

test('повторное нажатие ничего не отправляет', async () => {
  const { deps, question, sent, send, tg } = await asked()
  const button = question.opts.keyboard![0]![0]!
  await onChoice(deps, { id: 'CB1', data: button.data! }, send)
  await onChoice(deps, { id: 'CB2', data: button.data! }, send)
  assert.equal(sent.length, 1)
  assert.equal(tg.callsOf('answerCallback').at(-1)!.text, ALREADY_HANDLED)
})

test('«Отмена» ничего не отправляет и удаляет вопрос', async () => {
  const { deps, question, sent, send, tg } = await asked()
  const cancel = question.opts.keyboard!.at(-1)![0]!
  await onChoice(deps, { id: 'CB1', data: cancel.data! }, send)
  assert.equal(sent.length, 0)
  assert.deepEqual(tg.callsOf('deleteMessage')[0], { method: 'deleteMessage', chatId: OWNER_ID, messageId: question.id })
})

test('не ушло — вопрос говорит об этом', async () => {
  const { deps, question, tg } = await asked()
  await onChoice(deps, { id: 'CB1', data: question.opts.keyboard![0]![0]!.data! }, async () => false)
  assert.equal(tg.callsOf('editText')[0]!.text, 'Не отправлено Timon — причина в теме')
})

test('отложенное «Кому?» старше суток чистится', async () => {
  const { deps, store, question, sent, send } = await asked()
  store.cleanup(T0 + DAY + 1)
  await onChoice(deps, { id: 'CB1', data: question.opts.keyboard![0]![0]!.data! }, send)
  assert.equal(sent.length, 0)
})

test('ответ на «Отправлено <имя>» (бывший «Кому?») уходит выбранному собеседнику', async () => {
  const { deps, question, send } = await asked()
  const annaButton = question.opts.keyboard![1]![0]!
  await onChoice(deps, { id: 'CB1', data: annaButton.data! }, send)
  const route = routeOwnerMessage({ replyToMessageId: question.id }, deps.store, OWNER_ID, deps.now())
  assert.equal(route.kind, 'conversation')
  if (route.kind === 'conversation') assert.equal(route.conversation.peerName, 'Anna')
})

test('«Кому?» для вложения — без «Новому собеседнику»: первым бот отправляет только текст', async () => {
  const ctx = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 })
  await askWhom(ctx.deps, { text: 'Это тебе', media: { kind: 'photo', fileId: 'P' }, sourceMessageId: 904 }, ctx.conversations)
  assert.deepEqual(ctx.tg.callsOf('sendText')[0]!.opts.keyboard!.map((row) => row[0]!.text), ['Timon', 'Отмена'])
})

test('спека: «Новому собеседнику» — вопрос меняется, перевод с кнопками, собеседникам ничего', async () => {
  const { deps, question, sent, send, tg, translator } = await asked()
  const fresh = question.opts.keyboard!.find((row) => row[0]!.text === 'Новому собеседнику')![0]!
  await onChoice(deps, { id: 'CB1', data: fresh.data! }, send)
  assert.equal(sent.length, 0)
  assert.equal(tg.sentAsOwner().length, 0)
  assert.deepEqual(tg.callsOf('editText')[0], { method: 'editText', chatId: OWNER_ID, messageId: question.id, text: 'Новому собеседнику' })
  assert.deepEqual(translator.calls[0]!.history, [])
  const draft = tg.callsOf('sendText').at(-1)!
  assert.equal(draft.opts.replyTo, 903)
  assert.equal(draft.text, '<i>Перевод для нового собеседника (английский):</i>\n[en] Привет!')
  assert.equal(draft.opts.keyboard![0]![0]!.text, 'Отправить через бота')
})

test('спека: повторное нажатие «Новому собеседнику» — второго перевода нет', async () => {
  const { deps, question, send, translator } = await asked()
  const fresh = question.opts.keyboard!.find((row) => row[0]!.text === 'Новому собеседнику')![0]!
  await onChoice(deps, { id: 'CB1', data: fresh.data! }, send)
  await onChoice(deps, { id: 'CB2', data: fresh.data! }, send)
  assert.equal(translator.calls.length, 1)
})
