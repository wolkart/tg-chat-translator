import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DAY, HISTORY_WINDOW, LANGUAGE_DEFAULTS, SETTING, openStore } from '../src/store.ts'

const OWNER = 100001
const T0 = 1_760_000_000_000

function conversation(store: ReturnType<typeof openStore>, peerChatId = 200002, now = T0) {
  return store.createConversation({ ownerId: OWNER, connectionId: 'BC1', peerChatId, peerName: 'Alex Peer', now })
}

test('первый запуск: на пустой базе записывается пара «русский ↔ английский»', () => {
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER, LANGUAGE_DEFAULTS)
  assert.equal(store.getSetting(OWNER, SETTING.ownerLang), 'ru')
  assert.equal(store.getSetting(OWNER, SETTING.peerLang), 'en')
})

test('дефолт не перезаписывает значение, которое уже есть в базе', () => {
  const store = openStore(':memory:')
  store.setSetting(OWNER, SETTING.peerLang, 'vi')
  store.ensureDefaults(OWNER, LANGUAGE_DEFAULTS)
  assert.equal(store.getSetting(OWNER, SETTING.peerLang), 'vi')
  assert.equal(store.getSetting(OWNER, SETTING.ownerLang), 'ru')
})

test('окно истории: после 21-й реплики в базе 20 и самой старой нет', () => {
  const store = openStore(':memory:')
  const conv = conversation(store)
  for (let i = 1; i <= HISTORY_WINDOW + 1; i++) {
    store.addReplica(conv.id, { role: i % 2 ? 'peer' : 'owner', original: `реплика ${i}`, translation: null }, T0 + i)
  }
  assert.equal(store.countReplicas(conv.id), HISTORY_WINDOW)
  const history = store.recentReplicas(conv.id)
  assert.equal(history.length, HISTORY_WINDOW)
  assert.equal(history[0]!.text, 'реплика 2')
  assert.equal(history.at(-1)!.text, 'реплика 21')
  assert.ok(!history.some((line) => line.text === 'реплика 1'))
})

test('разговор: поиск по собеседнику и по теме', () => {
  const store = openStore(':memory:')
  const conv = conversation(store)
  assert.equal(conv.topicId, null)
  store.setTopic(conv.id, 77)
  assert.equal(store.findConversationByPeer(OWNER, 200002)?.id, conv.id)
  assert.equal(store.findConversationByTopic(OWNER, 77)?.id, conv.id)
  assert.equal(store.findConversationByTopic(OWNER, 78), undefined)
})

test('активный разговор: ровно 24 часа — ещё активен, на миллисекунду больше — нет', () => {
  const store = openStore(':memory:')
  const edge = conversation(store, 1, T0 - DAY)
  conversation(store, 2, T0 - DAY - 1)
  const active = store.activeConversations(OWNER, T0)
  assert.deepEqual(active.map((c) => c.id), [edge.id])
})

test('сообщения бота ведут к разговору', () => {
  const store = openStore(':memory:')
  const conv = conversation(store)
  store.rememberBotMessage(OWNER, 600, conv.id, T0)
  assert.equal(store.conversationByBotMessage(OWNER, 600)?.id, conv.id)
  assert.equal(store.conversationByBotMessage(OWNER, 601), undefined)
})

test('отложенное «Кому?» забирается только один раз', () => {
  const store = openStore(':memory:')
  const id = store.createPending(OWNER, { text: 'привет', media: null, sourceMessageId: 903 }, T0)
  store.setPendingQuestion(id, 950)
  const first = store.takePending(id, OWNER)
  assert.deepEqual(first, { payload: { text: 'привет', media: null, sourceMessageId: 903 }, questionMessageId: 950 })
  assert.equal(store.takePending(id, OWNER), undefined)
})

test('подключение: сохранение, обновление и подключение владельца', () => {
  const store = openStore(':memory:')
  const connection = { id: 'BC1', ownerId: OWNER, userChatId: OWNER, canReply: false, isEnabled: true, allowed: true }
  store.saveConnection(connection, T0)
  assert.deepEqual(store.getConnection('BC1'), connection)
  store.saveConnection({ ...connection, canReply: true }, T0 + 1)
  assert.equal(store.getConnection('BC1')?.canReply, true)
  assert.equal(store.ownerConnection(OWNER)?.id, 'BC1')
  store.saveConnection({ ...connection, id: 'BC2', ownerId: 400004, allowed: false }, T0 + 2)
  assert.equal(store.ownerConnection(400004), undefined)
})

test('чистка: апдейты живут 48 часов, «Кому?» и эхо — сутки', () => {
  const store = openStore(':memory:')
  store.markProcessed(1, T0 - 2 * DAY - 1)
  store.markProcessed(2, T0 - 2 * DAY + 1)
  store.rememberSent(OWNER, 200002, 10, T0 - DAY - 1)
  store.rememberSent(OWNER, 200002, 11, T0)
  const old = store.createPending(OWNER, { text: 'a', media: null, sourceMessageId: 1 }, T0 - DAY - 1)
  store.cleanup(T0)
  assert.equal(store.isProcessed(1), false)
  assert.equal(store.isProcessed(2), true)
  assert.equal(store.wasSent(OWNER, 200002, 10), false)
  assert.equal(store.wasSent(OWNER, 200002, 11), true)
  assert.equal(store.takePending(old, OWNER), undefined)
})

test('эхо одного владельца не считается эхом другого', () => {
  const store = openStore(':memory:')
  const OTHER_OWNER = 100002
  store.rememberSent(OWNER, 200002, 10, T0)
  assert.equal(store.wasSent(OWNER, 200002, 10), true)
  assert.equal(store.wasSent(OTHER_OWNER, 200002, 10), false)
})

test('ownerConnection: рабочее подключение важнее позднего апдейта выключенного', () => {
  const store = openStore(':memory:')
  const base = { ownerId: OWNER, userChatId: OWNER, canReply: true, allowed: true }
  store.saveConnection({ ...base, id: 'LIVE', isEnabled: true }, T0)
  store.saveConnection({ ...base, id: 'OLD', isEnabled: false }, T0 + 1000)
  assert.equal(store.ownerConnection(OWNER)?.id, 'LIVE')
})
