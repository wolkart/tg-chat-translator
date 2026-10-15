import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendOwnerReply } from '../src/channels/private-chat/outgoing.ts'
import { FIRST_RUN_DEFAULTS, createConfig } from '../src/settings.ts'
import { SETTING, openStore } from '../src/store.ts'
import { CONNECTION_ID, OWNER_ID, PEER_ID } from './helpers.ts'
import { setupDeps } from './setup.ts'

const reply = { text: 'Отлично, до встречи', media: null, sourceMessageId: 900 }

test('спека: пару сменили в панели — следующий ответ уходит на новый язык без перезапуска', async () => {
  const { deps, store, translator, connectOwner } = setupDeps({ live: true })
  connectOwner()
  const conversation = store.createConversation({
    ownerId: OWNER_ID,
    connectionId: CONNECTION_ID,
    peerChatId: PEER_ID,
    peerName: 'Alex Peer',
    lastPeerAt: deps.now(),
  })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  store.setSetting(OWNER_ID, SETTING.peerLang, 'vi')
  await sendOwnerReply(deps, conversation, { ...reply, sourceMessageId: 901 }, { outsideTopic: false })
  assert.deepEqual(
    translator.calls.map((call) => call.target.code),
    ['en', 'vi'],
  )
})

test('первый запуск: обращение «как в разговоре», а сохранённые пара и модель не меняются', () => {
  const store = openStore(':memory:')
  store.setSetting(OWNER_ID, SETTING.peerLang, 'vi')
  store.setSetting(OWNER_ID, SETTING.model, 'openai/gpt-5.6-luna')
  store.ensureDefaults(OWNER_ID, FIRST_RUN_DEFAULTS)
  assert.equal(store.getSetting(OWNER_ID, SETTING.address), 'as-is')
  assert.equal(store.getSetting(OWNER_ID, SETTING.peerLang), 'vi')
  assert.equal(store.getSetting(OWNER_ID, SETTING.model), 'openai/gpt-5.6-luna')
  store.close()
})

test('настройки: деловое обращение читается из базы', () => {
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER_ID, FIRST_RUN_DEFAULTS)
  const config = createConfig({ store, env: { providerKeys: {} } })
  assert.equal(config(OWNER_ID).address, 'as-is')
  store.setSetting(OWNER_ID, SETTING.address, 'formal')
  assert.equal(config(OWNER_ID).address, 'formal')
  store.close()
})

test('настройки: нет ключа — переводчика нет, причина есть', () => {
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER_ID, FIRST_RUN_DEFAULTS)
  const config = createConfig({ store, env: { providerKeys: {} } })(OWNER_ID)
  assert.equal(config.translator, null)
  assert.match(config.translatorProblem ?? '', /^Нет ключа модели — переводить нечем/)
  store.close()
})

test('настройки: другой владелец — свои настройки', () => {
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER_ID, FIRST_RUN_DEFAULTS)
  store.ensureDefaults(OWNER_ID + 1, FIRST_RUN_DEFAULTS)
  store.setSetting(OWNER_ID + 1, SETTING.peerLang, 'de')
  const config = createConfig({ store, env: { providerKeys: {} } })
  assert.equal(config(OWNER_ID).languages?.peer.code, 'en')
  assert.equal(config(OWNER_ID + 1).languages?.peer.code, 'de')
  store.close()
})
