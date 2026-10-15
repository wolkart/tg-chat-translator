import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendOwnerReply } from '../src/channels/private-chat/outgoing.ts'
import { PROFILES } from '../src/lang/profiles.ts'
import { SETTING } from '../src/store.ts'
import { CONNECTION_ID, OWNER_ID, PEER_ID } from './helpers.ts'
import { findButton, openPanel } from './panel-helpers.ts'
import { setupDeps } from './setup.ts'

const reply = { text: 'Отлично, до встречи', media: null, sourceMessageId: 900 }

function conversationOf(ctx: ReturnType<typeof setupDeps>) {
  return ctx.store.createConversation({
    ownerId: OWNER_ID,
    connectionId: CONNECTION_ID,
    peerChatId: PEER_ID,
    peerName: 'Alex Peer',
    lastPeerAt: ctx.deps.now(),
  })
}

test('спека: переход и возврат — один и тот же экран правится, новых сообщений нет', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  const languages = await panel.tap('🌐 Языки')
  assert.ok(languages.html.startsWith('<b>🌐 Языки</b>'))
  const main = await panel.tap('← Назад')
  assert.ok(main.html.startsWith('<b>⚙️ Переводчик</b>'))
  assert.equal(ctx.tg.callsOf('sendText').length, 1)
  assert.ok(ctx.tg.callsOf('editText').every((call) => call.messageId === panel.messageId))
})

test('экран языков: какой язык чей и что бывает с третьим языком', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  const { html } = await panel.tap('🌐 Языки')
  assert.equal(
    html,
    [
      '<b>🌐 Языки</b>',
      '',
      'Ваш язык: русский — на него переводятся входящие.',
      'Язык собеседника: английский — на него уходят ваши ответы.',
      '',
      'Если собеседник пишет на третьем языке, бот всё равно переведёт его вам.',
    ].join('\n'),
  )
})

test('спека: владелец меняет язык собеседника — ответ уходит на немецком без перезапуска', async () => {
  const ctx = setupDeps({ live: true })
  ctx.connectOwner()
  const panel = await openPanel(ctx)
  await panel.tap('🌐 Языки')
  await panel.tap('Язык собеседника: английский')
  const done = await panel.tap('немецкий')
  assert.equal(done.toast, 'Язык собеседника: немецкий')
  assert.ok(done.html.includes('Язык собеседника: немецкий — на него уходят ваши ответы.'))
  await sendOwnerReply(ctx.deps, conversationOf(ctx), reply, { outsideTopic: false })
  assert.equal(ctx.translator.calls.at(-1)!.target.code, 'de')
})

test('спека: тот же язык с обеих сторон не выбирается', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  await panel.tap('🌐 Языки')
  await panel.tap('Язык собеседника: английский')
  const refused = await panel.tap('русский')
  assert.equal(refused.toast, 'Русский уже ваш язык — выберите другой')
  assert.equal(ctx.store.getSetting(OWNER_ID, SETTING.peerLang), 'en')
})

test('спека: в списке все языки, которые бот различает, и только они; текущий отмечен', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  await panel.tap('🌐 Языки')
  const list = await panel.tap('Ваш язык: русский')
  const names = list.keyboard.flat().filter((button) => button.text !== '← Назад').map((button) => button.text.replace('✅ ', ''))
  assert.deepEqual(names, PROFILES.map((profile) => profile.nameRu))
  assert.ok(findButton(list.keyboard, '✅ русский'))
  assert.ok(list.keyboard.slice(0, -1).every((row) => row.length <= 3))
})

test('кнопка с неизвестным языком — ничего не сохраняется', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  await panel.press('p:lang:set:peer:xx')
  await panel.press('p:lang:set:moon:de')
  assert.equal(ctx.store.getSetting(OWNER_ID, SETTING.peerLang), 'en')
})

test('спека: владелец включает деловое обращение — «✅», главный экран и следующий ответ', async () => {
  const ctx = setupDeps({ live: true })
  ctx.connectOwner()
  const panel = await openPanel(ctx)
  const screen = await panel.tap('🗣 Обращение')
  assert.ok(findButton(screen.keyboard, '✅ Как в разговоре'))
  const chosen = await panel.tap('Деловое, на вы')
  assert.equal(chosen.toast, 'Обращение: деловое, на вы')
  assert.ok(findButton(chosen.keyboard, '✅ Деловое, на вы'))
  const main = await panel.tap('← Назад')
  assert.ok(main.html.includes('Обращение: деловое, на вы'))
  await sendOwnerReply(ctx.deps, conversationOf(ctx), reply, { outsideTopic: false })
  assert.equal(ctx.translator.calls.at(-1)!.address, 'formal')
})

test('экран обращения объясняет, что это только про ответы владельца', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  const { html } = await panel.tap('🗣 Обращение')
  assert.ok(html.includes('как звучат ваши ответы собеседнику'))
  assert.ok(html.includes('Входящие переводятся как есть.'))
})
