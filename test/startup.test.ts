import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAlerts } from '../src/alerts.ts'
import {
  BUSINESS_MODE_OFF,
  INLINE_OFF,
  INLINE_RECHECK_MS,
  TOPICS_OFF,
  createInlineCheck,
  startupChecks,
} from '../src/startup.ts'
import { FIRST_RUN_DEFAULTS, createConfig } from '../src/settings.ts'
import { SETTING, openStore } from '../src/store.ts'
import type { BotInfo } from '../src/telegram.ts'
import { fakeTelegram } from './fakes.ts'
import { OWNER_ID } from './helpers.ts'

const healthy: BotInfo = { id: 300003, username: 'translator_test_bot', canConnectToBusiness: true, hasTopicsEnabled: true, supportsInlineQueries: true }

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
  store.ensureDefaults(OWNER_ID, FIRST_RUN_DEFAULTS)
  store.setSetting(OWNER_ID, SETTING.ownerLang, 'xx')
  const config = createConfig({ store, env: { providerKeys: {} } })(OWNER_ID)
  assert.equal(config.languages, null)
  await startupChecks({ me: healthy, alerts, languagesProblem: config.languagesProblem, modelProblem: null })
  const texts = tg.callsOf('sendText').map((call) => call.text)
  assert.equal(texts.length, 1)
  assert.match(texts[0]!, /английский/)
  store.close()
})

test('пустая база после ensureDefaults — пара русский ↔ английский', () => {
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER_ID, FIRST_RUN_DEFAULTS)
  const { languages } = createConfig({ store, env: { providerKeys: {} } })(OWNER_ID)
  assert.deepEqual([languages?.owner.code, languages?.peer.code].sort(), ['en', 'ru'])
  store.close()
})

test('спека: Inline Mode выключен — что включить в BotFather', async () => {
  const { tg, alerts } = setup()
  await startupChecks({ me: { ...healthy, supportsInlineQueries: false }, alerts, languagesProblem: null, modelProblem: null })
  assert.deepEqual(tg.callsOf('sendText').map((call) => call.text), [INLINE_OFF])
  assert.equal(
    INLINE_OFF,
    'В BotFather выключен Inline Mode — без него не работает кнопка «Отправить через бота». ' +
      'Откройте @BotFather → Open → этот бот → Bot Settings → Inline Mode и включите переключатель.',
  )
})

test('Inline Mode включили без перезапуска — бот замечает, но спрашивает Telegram не чаще раза в минуту', async () => {
  let clock = 0
  const tg = fakeTelegram({ me: { supportsInlineQueries: true } })
  const enabled = createInlineCheck({ api: tg.api, initial: false, now: () => clock })
  assert.equal(await enabled(), false)
  assert.equal(tg.callsOf('getMe').length, 0)
  clock += INLINE_RECHECK_MS
  assert.equal(await enabled(), true)
  assert.equal(tg.callsOf('getMe').length, 1)
  clock += INLINE_RECHECK_MS
  assert.equal(await enabled(), true)
  assert.equal(tg.callsOf('getMe').length, 1)
})

test('Inline Mode всё ещё выключен — повторный вопрос только через минуту', async () => {
  let clock = 0
  const tg = fakeTelegram({ me: { supportsInlineQueries: false } })
  const enabled = createInlineCheck({ api: tg.api, initial: false, now: () => clock })
  clock += INLINE_RECHECK_MS
  assert.equal(await enabled(), false)
  clock += INLINE_RECHECK_MS - 1
  assert.equal(await enabled(), false)
  assert.equal(tg.callsOf('getMe').length, 1)
})

test('проверка Inline Mode: сбой getMe — по-прежнему выключено, бот не падает', async () => {
  let clock = 0
  const tg = fakeTelegram({ me: { supportsInlineQueries: true } })
  tg.failNext('getMe', new Error('сеть моргнула'))
  const enabled = createInlineCheck({ api: tg.api, initial: false, now: () => clock })
  clock += INLINE_RECHECK_MS
  assert.equal(await enabled(), false)
  clock += INLINE_RECHECK_MS
  assert.equal(await enabled(), true)
})
