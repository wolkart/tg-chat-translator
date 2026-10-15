import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Update } from 'grammy/types'
import { createApp } from '../src/app.ts'
import { KEY_GUARD, KEY_GUARD_NOT_DELETED, KEY_NOT_DELETED, KEY_WAIT_MS, maskKey } from '../src/owner/panel/key-input.ts'
import { createPanel } from '../src/owner/panel/panel.ts'
import { SETTING, keySetting } from '../src/store.ts'
import { TelegramError } from '../src/telegram.ts'
import { OWNER_ID, PEER_ID, fixture } from './helpers.ts'
import { findButton, openPanel } from './panel-helpers.ts'
import { setupDeps } from './setup.ts'

/** Синтетический ключ OpenRouter нужной формы. */
const KEY = `sk-or-v1-${'0123456789abcdef'.repeat(3)}${'fedcba9876543210'}`
const NEW_KEY = `sk-or-v1-${'a1'.repeat(32)}`

let updateId = 5000

/** Сообщение владельца в чате с ботом: вне тем или в теме. */
function ownerText(text: string, threadId?: number): Update {
  const update = fixture('owner-message-outside')
  update.update_id = ++updateId
  update.message!.message_id = updateId
  update.message!.text = text
  if (threadId !== undefined) update.message!.message_thread_id = threadId
  return update
}

/** Панель и приложение на одних зависимостях: ключ приходит обычным сообщением через диспетчер. */
async function keyFlow(options: Parameters<typeof setupDeps>[0] = {}) {
  const ctx = setupDeps({ live: true, envKeys: {}, ...options })
  const app = createApp(ctx.deps)
  await app.handleUpdate(fixture('owner-message-start'))
  const panelId = ctx.tg.callsOf('sendText').at(-1)!.id
  let pressed = 0
  async function press(data: string) {
    const update = fixture('callback-choose')
    update.update_id = ++updateId
    update.callback_query!.id = `cb${++pressed}`
    update.callback_query!.data = data
    update.callback_query!.message = { ...update.callback_query!.message!, message_id: panelId }
    await app.handleUpdate(update)
    return ctx.tg.callsOf('editText').at(-1)!
  }
  return { ...ctx, app, press }
}

test('спека: экран ключа — ключ из панели огрызком, целиком нигде', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), KEY)
  const panel = await openPanel(ctx)
  const screen = await panel.tap('🔑 Ключ')
  assert.ok(screen.html.includes(`Ключ OpenRouter: ${maskKey(KEY)} · вставлен в панели`))
  assert.equal(maskKey(KEY), 'sk-or-v1-…3210')
  assert.ok(findButton(screen.keyboard, 'Вставить ключ'))
  const everything = ctx.tg.calls.map((call) => JSON.stringify(call)).join('\n')
  assert.ok(!everything.includes(KEY))
})

test('спека: ключ в .env — «🔒», кнопки «Вставить ключ» нет', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  const screen = await panel.tap('🔑 Ключ')
  assert.ok(screen.html.includes('Ключ OpenRouter: 🔒 задан в .env — кнопкой не меняется'))
  assert.equal(findButton(screen.keyboard, 'Вставить ключ'), undefined)
})

test('спека: ключа нет — «🔑 Ключ» на главном экране зелёная', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  const panel = await openPanel(ctx)
  assert.equal(findButton(panel.screen.keyboard, '🔑 Ключ')?.style, 'success')
  const screen = await panel.tap('🔑 Ключ')
  assert.ok(screen.html.includes('Ключ OpenRouter: не задан'))
  assert.equal(findButton(screen.keyboard, 'Вставить ключ')?.style, 'success')
})

test('спека: «Вставить ключ» — где взять, что сообщение удалится, совет про лимит, «Отмена»', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  const panel = await openPanel(ctx)
  await panel.tap('🔑 Ключ')
  const screen = await panel.tap('Вставить ключ')
  assert.ok(screen.html.includes('Пришлите ключ OpenRouter одним сообщением. Ключ берут здесь: https://openrouter.ai/keys.'))
  assert.ok(screen.html.includes('Сообщение с ключом бот сразу удалит из переписки.'))
  assert.ok(screen.html.includes('Совет: выпустите ключ с лимитом трат — если утечёт, ущерб ограничен суммой.'))
  assert.deepEqual(screen.keyboard, [[{ text: 'Отмена', data: 'p:key:cancel' }]])
})

test('спека: ключ принят — сообщение удалено, ключ сохранён, новая панель с итогом', async () => {
  const ctx = await keyFlow()
  await ctx.press('p:key:paste')
  const message = ownerText(KEY)
  await ctx.app.handleUpdate(message)
  assert.deepEqual(ctx.tg.callsOf('deleteMessage'), [{ method: 'deleteMessage', chatId: OWNER_ID, messageId: message.message!.message_id }])
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), KEY)
  assert.deepEqual(ctx.accounts.calls.verify, [{ provider: 'openrouter', key: KEY }])
  const panel = ctx.tg.callsOf('sendText').at(-1)!
  assert.ok(panel.text.startsWith('✅ Ключ сохранён: sk-or-v1-…3210. Осталось $6,53, действует до 16 октября.'))
  assert.ok(panel.text.includes('<b>⚙️ Переводчик</b>'))
  assert.equal(ctx.translator.calls.length, 0)
  assert.ok(ctx.secrets.includes(KEY))
})

test('ключ с текстом вокруг — сохраняется только ключ', async () => {
  const ctx = await keyFlow()
  await ctx.press('p:key:paste')
  await ctx.app.handleUpdate(ownerText(`вот мой ключ:\n${KEY}.`))
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), KEY)
  assert.deepEqual(ctx.accounts.calls.verify, [{ provider: 'openrouter', key: KEY }])
})

test('спека: ключ не подходит — удалён, не сохранён, ожидание продолжается', async () => {
  const ctx = await keyFlow()
  ctx.accounts.state.verify = { verdict: 'rejected' }
  await ctx.press('p:key:paste')
  await ctx.app.handleUpdate(ownerText(KEY))
  assert.equal(ctx.tg.callsOf('deleteMessage').length, 1)
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), undefined)
  assert.equal(
    ctx.tg.callsOf('sendText').at(-1)!.text,
    '❌ OpenRouter не принял ключ — проверьте, что скопировали его целиком. Пришлите ключ ещё раз или нажмите «Отмена».',
  )
  // Отвергнутый ключ тоже укрыт: ответ провайдера мог бы его процитировать.
  assert.ok(ctx.secrets.includes(KEY))
  ctx.accounts.state.verify = { verdict: 'ok', balance: null }
  await ctx.app.handleUpdate(ownerText(NEW_KEY))
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), NEW_KEY)
  assert.ok(ctx.tg.callsOf('sendText').at(-1)!.text.startsWith('✅ Ключ сохранён: sk-or-v1-…a1a1.\n\n'))
})

test('спека: нет связи — ключ не сохранён, просьба прислать ещё раз', async () => {
  const ctx = await keyFlow()
  ctx.accounts.state.verify = { verdict: 'unknown', reason: 'нет связи с OpenRouter' }
  await ctx.press('p:key:paste')
  await ctx.app.handleUpdate(ownerText(KEY))
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), undefined)
  assert.equal(
    ctx.tg.callsOf('sendText').at(-1)!.text,
    'Не удалось проверить ключ: нет связи с OpenRouter. Ключ не сохранён — пришлите его ещё раз.',
  )
})

test('спека: удалить сообщение с ключом не вышло — просьба удалить самому', async () => {
  const ctx = await keyFlow()
  ctx.tg.failNext('deleteMessage', new TelegramError(400, "Bad Request: message can't be deleted"))
  await ctx.press('p:key:paste')
  await ctx.app.handleUpdate(ownerText(KEY))
  assert.ok(ctx.tg.callsOf('sendText').some((call) => call.text === KEY_NOT_DELETED))
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), KEY)
})

test('спека: замена ключа без перезапуска — следующий перевод с новым ключом', async () => {
  const ctx = await keyFlow()
  ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), KEY)
  await ctx.press('p:key:paste')
  await ctx.app.handleUpdate(ownerText(NEW_KEY))
  const model = ctx.deps.config(OWNER_ID).model
  assert.equal(model.ok && model.apiKey, NEW_KEY)
})

test('спека: прислали обычный текст — подсказка, ничего не переводится и не сохраняется', async () => {
  const ctx = await keyFlow()
  await ctx.press('p:key:paste')
  await ctx.app.handleUpdate(ownerText('привет'))
  assert.equal(
    ctx.tg.callsOf('sendText').at(-1)!.text,
    'Это не похоже на ключ OpenRouter — он начинается с sk-or-v1-. Пришлите ключ ещё раз или нажмите «Отмена».',
  )
  assert.equal(ctx.translator.calls.length, 0)
  assert.equal(ctx.tg.callsOf('deleteMessage').length, 0)
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), undefined)
})

test('спека: ожидание истекло — обычный текст идёт обычным путём', async () => {
  const ctx = await keyFlow()
  ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), KEY)
  await ctx.press('p:key:paste')
  ctx.advance(KEY_WAIT_MS + 1)
  await ctx.app.handleUpdate(ownerText('привет'))
  assert.equal(ctx.translator.calls.length, 1)
})

test('любая кнопка панели и /start снимают ожидание ключа', async () => {
  for (const cancel of ['button', 'start'] as const) {
    const ctx = await keyFlow()
    ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), KEY)
    await ctx.press('p:key:paste')
    if (cancel === 'button') await ctx.press('p:main')
    else await ctx.app.handleUpdate({ ...fixture('owner-message-start'), update_id: ++updateId })
    await ctx.app.handleUpdate(ownerText('привет'))
    assert.equal(ctx.translator.calls.length, 1, cancel)
  }
})

test('ключ в теме во время ожидания — не ключ для панели, а страховка: не уходит собеседнику', async () => {
  const ctx = await keyFlow()
  ctx.connectOwner()
  await ctx.app.handleUpdate(fixture('business-message-peer-text'))
  const topicId = ctx.store.findConversationByPeer(OWNER_ID, PEER_ID)!.topicId!
  await ctx.press('p:key:paste')
  await ctx.app.handleUpdate(ownerText(KEY, topicId))
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('openrouter')), undefined)
  assert.equal(ctx.tg.sentAsOwner().length, 0)
})

test('спека: ключ вставлен в тему — собеседнику ничего, модель не вызвана, подсказка в теме', async () => {
  const ctx = setupDeps()
  const app = createApp(ctx.deps)
  ctx.connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const topicId = ctx.store.findConversationByPeer(OWNER_ID, PEER_ID)!.topicId!
  const calls = ctx.translator.calls.length
  await app.handleUpdate(ownerText(`вот ${KEY}`, topicId))
  assert.equal(ctx.tg.sentAsOwner().length, 0)
  assert.equal(ctx.translator.calls.length, calls)
  assert.equal(ctx.tg.callsOf('deleteMessage').length, 1)
  const hint = ctx.tg.callsOf('sendText').at(-1)!
  assert.equal(hint.text, KEY_GUARD)
  assert.equal(
    KEY_GUARD,
    'Похоже на ключ — бот не переводит его и никому не отправляет, сообщение удалено. Чтобы сохранить ключ: /start → 🔑 Ключ → Вставить ключ.',
  )
  assert.equal(hint.opts.threadId, topicId)
})

test('ключ вне тем без ожидания — не перевод для нового собеседника, а страховка', async () => {
  const ctx = setupDeps()
  const app = createApp(ctx.deps)
  await app.handleUpdate(ownerText(KEY))
  assert.equal(ctx.translator.calls.length, 0)
  assert.equal(ctx.tg.callsOf('sendText').at(-1)!.text, KEY_GUARD)
})

test('ключ в подписи к фото — тоже страховка; не удалилось — просьба удалить самому', async () => {
  const ctx = setupDeps()
  const app = createApp(ctx.deps)
  const update = fixture('owner-message-photo-in-topic')
  update.message!.caption = KEY
  ctx.tg.failNext('deleteMessage', new TelegramError(400, "Bad Request: message can't be deleted"))
  await app.handleUpdate(update)
  assert.equal(ctx.tg.sentAsOwner().length, 0)
  assert.equal(ctx.tg.callsOf('sendText').at(-1)!.text, KEY_GUARD_NOT_DELETED)
})

test('спека: обычный текст с «sk-» уходит как обычно', async () => {
  const ctx = setupDeps()
  const app = createApp(ctx.deps)
  ctx.connectOwner()
  await app.handleUpdate(fixture('business-message-peer-text'))
  const topicId = ctx.store.findConversationByPeer(OWNER_ID, PEER_ID)!.topicId!
  await app.handleUpdate(ownerText('скинь ссылку на sk-board', topicId))
  assert.equal(ctx.tg.sentAsOwner().length, 1)
})

test('ожидание ключа помнит провайдера: «Вставить ключ» у текущего провайдера', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  ctx.store.setSetting(OWNER_ID, SETTING.provider, 'groq')
  const panel = await openPanel(ctx)
  await panel.tap('🔑 Ключ')
  const screen = await panel.tap('Вставить ключ')
  assert.ok(screen.html.includes('Пришлите ключ Groq одним сообщением'))
  await createPanel(ctx.deps).onText(OWNER_ID, { text: 'привет', messageId: 1 })
  // Новая панель — новое ожидание: старое осталось в той, где нажали «Вставить ключ».
  await panel.panel.onText(OWNER_ID, { text: 'привет', messageId: 2 })
  assert.match(ctx.tg.callsOf('sendText').at(-1)!.text, /^Это не похоже на ключ Groq — он начинается с gsk_\./)
})
