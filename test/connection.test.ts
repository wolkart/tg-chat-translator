import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  CONNECTED,
  DISABLED,
  NO_REPLY,
  ensureConnection,
  isAllowedOwner,
  onBusinessConnection,
} from '../src/channels/private-chat/connection.ts'
import { toConnectionInfo } from '../src/telegram.ts'
import { CONNECTION_ID, OWNER_ID, STRANGER_ID, fixture } from './helpers.ts'
import { setupDeps } from './setup.ts'

function info(name: string) {
  const update = fixture(name)
  if (!update.business_connection) throw new Error(`${name}: нет business_connection`)
  return toConnectionInfo(update.business_connection)
}

function notices(tg: ReturnType<typeof setupDeps>['tg']) {
  return tg.callsOf('sendText').map((call) => call.text)
}

test('политика: обслуживаем только владельца из .env', () => {
  assert.equal(isAllowedOwner(OWNER_ID, OWNER_ID), true)
  assert.equal(isAllowedOwner(STRANGER_ID, OWNER_ID), false)
})

test('подключил владелец — «подключён», подключение сохранено', async () => {
  const { deps, tg, store } = setupDeps()
  await onBusinessConnection(deps, info('business-connection-owner'))
  assert.deepEqual(notices(tg), [CONNECTED])
  assert.deepEqual(store.getConnection(CONNECTION_ID), {
    id: CONNECTION_ID,
    ownerId: OWNER_ID,
    userChatId: OWNER_ID,
    canReply: true,
    isEnabled: true,
    allowed: true,
  })
})

test('то же подключение ещё раз — владельцу ничего нового не пишем', async () => {
  const { deps, tg } = setupDeps()
  await onBusinessConnection(deps, info('business-connection-owner'))
  await onBusinessConnection(deps, info('business-connection-owner'))
  assert.equal(notices(tg).length, 1)
})

test('нет права отвечать — что включить', async () => {
  const { deps, tg } = setupDeps()
  await onBusinessConnection(deps, info('business-connection-no-reply'))
  assert.deepEqual(notices(tg), [NO_REPLY])
  assert.match(NO_REPLY, /Автоматизация чатов/)
  assert.match(NO_REPLY, /Ответы на сообщения/)
})

test('право отвечать включили — «подключён»', async () => {
  const { deps, tg } = setupDeps()
  await onBusinessConnection(deps, info('business-connection-no-reply'))
  await onBusinessConnection(deps, info('business-connection-owner'))
  assert.deepEqual(notices(tg), [NO_REPLY, CONNECTED])
})

test('подключил посторонний — одно сообщение о попытке, подключение не обслуживается', async () => {
  const { deps, tg, store } = setupDeps()
  await onBusinessConnection(deps, info('business-connection-stranger'))
  await onBusinessConnection(deps, info('business-connection-stranger'))
  const sent = notices(tg)
  assert.equal(sent.length, 1)
  assert.match(sent[0]!, /пытался подключить бота/)
  assert.match(sent[0]!, /Stranger Test \(@stranger_test\)/)
  assert.equal(store.getConnection('BCSTRANGER0001')?.allowed, false)
})

test('владелец отключил бота — «переводы остановлены», повтор не дублируется', async () => {
  const { deps, tg } = setupDeps()
  await onBusinessConnection(deps, info('business-connection-owner'))
  await onBusinessConnection(deps, info('business-connection-disabled'))
  await onBusinessConnection(deps, info('business-connection-disabled'))
  assert.deepEqual(notices(tg), [CONNECTED, DISABLED])
})

test('подключение до запуска: первый раз спрашиваем Telegram, второй — нет', async () => {
  const { deps, tg } = setupDeps()
  const first = await ensureConnection(deps, CONNECTION_ID)
  const second = await ensureConnection(deps, CONNECTION_ID)
  assert.equal(tg.callsOf('getBusinessConnection').length, 1)
  assert.equal(first.canReply, true)
  assert.deepEqual(first, second)
  assert.deepEqual(notices(tg), [CONNECTED])
})

test('спека: путь к настройке — «Настройки → Аккаунт → Автоматизация чатов», для Mac — через «Изменить профиль»', () => {
  for (const text of [NO_REPLY, DISABLED]) {
    assert.match(text, /Настройки → Аккаунт → Автоматизация чатов/)
    assert.match(text, /на Mac — Настройки → Изменить профиль → Автоматизация чатов/)
  }
  assert.match(NO_REPLY, /«Ответы на сообщения» \(раздел «Сообщения»\): Настройки → Аккаунт → Автоматизация чатов \(на Mac — Настройки → Изменить профиль → Автоматизация чатов\)\. /)
})

test('пункта «этот бот» на экране нет — в текстах бота его не называем', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.ok(!source.includes('Автоматизация чатов → этот бот'), file)
  }
})

test('старый путь «Настройки → Автоматизация чатов» нигде в текстах бота не остался', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.ok(!source.includes('Настройки → Автоматизация чатов'), file)
  }
})
