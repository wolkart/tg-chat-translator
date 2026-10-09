import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAlerts } from '../src/alerts.ts'
import { BUSINESS_MODE_OFF, TOPICS_OFF, loadSettings, startupChecks } from '../src/startup.ts'
import { LANGUAGE_DEFAULTS, SETTING, openStore } from '../src/store.ts'
import type { BotInfo } from '../src/telegram.ts'
import { PROVIDER_DEFAULTS } from '../src/translate/providers.ts'
import { fakeTelegram } from './fakes.ts'
import { OWNER_ID } from './helpers.ts'

const healthy: BotInfo = { id: 300003, username: 'translator_test_bot', canConnectToBusiness: true, hasTopicsEnabled: true }

function setup() {
  const tg = fakeTelegram()
  const alerts = createAlerts({ api: tg.api, ownerChatId: OWNER_ID, scrub: (t) => t, print: () => {} })
  return { tg, alerts }
}

test('всё включено — владельцу ничего не пишем', async () => {
  const { tg, alerts } = setup()
  await startupChecks({ me: healthy, alerts, languagesProblem: null, modelProblem: null })
  assert.equal(tg.calls.length, 0)
})

test('выключены Business Mode и Threaded Mode — что включить в BotFather', async () => {
  const { tg, alerts } = setup()
  await startupChecks({ me: { ...healthy, canConnectToBusiness: false, hasTopicsEnabled: false }, alerts, languagesProblem: null, modelProblem: null })
  assert.deepEqual(tg.callsOf('sendText').map((call) => call.text), [BUSINESS_MODE_OFF, TOPICS_OFF])
})

test('язык без профиля и нет ключа — оба сообщения', async () => {
  const { tg, alerts } = setup()
  await startupChecks({ me: healthy, alerts, languagesProblem: 'Не поддерживается ваш язык «xx»', modelProblem: 'Нет ключа модели' })
  assert.deepEqual(tg.callsOf('sendText').map((call) => call.text), ['Не поддерживается ваш язык «xx»', 'Нет ключа модели'])
})

test('язык без профиля в базе — разговоры не заводятся, владелец получает список языков', async () => {
  const { tg, alerts } = setup()
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER_ID, { ...LANGUAGE_DEFAULTS, ...PROVIDER_DEFAULTS })
  store.setSetting(OWNER_ID, SETTING.ownerLang, 'xx')
  const { pair } = loadSettings(store, OWNER_ID, { providerKeys: {}, localBaseUrl: undefined })
  assert.equal(pair.ok, false)
  await startupChecks({ me: healthy, alerts, languagesProblem: pair.ok ? null : pair.problem, modelProblem: null })
  const texts = tg.callsOf('sendText').map((call) => call.text)
  assert.equal(texts.length, 1)
  assert.match(texts[0]!, /английский/)
  store.close()
})

test('пустая база после ensureDefaults — пара русский ↔ английский', () => {
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER_ID, { ...LANGUAGE_DEFAULTS, ...PROVIDER_DEFAULTS })
  const { pair } = loadSettings(store, OWNER_ID, { providerKeys: {}, localBaseUrl: undefined })
  assert.equal(pair.ok, true)
  if (pair.ok) assert.deepEqual([pair.pair.owner.code, pair.pair.peer.code].sort(), ['en', 'ru'])
  store.close()
})
