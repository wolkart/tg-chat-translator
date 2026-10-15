import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendOwnerReply } from '../src/channels/private-chat/outgoing.ts'
import { createPanel } from '../src/owner/panel/panel.ts'
import { SETTING, keySetting } from '../src/store.ts'
import { PROVIDERS } from '../src/translate/providers.ts'
import { SAMPLE_BALANCE, samplePrices } from './fakes.ts'
import { CONNECTION_ID, OWNER_ID, PEER_ID } from './helpers.ts'
import { findButton, openPanel } from './panel-helpers.ts'
import { setupDeps } from './setup.ts'

const KEY = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`

test('спека: на главном экране шесть кнопок по две в ряд', async () => {
  const panel = await openPanel(setupDeps({ live: true }))
  assert.deepEqual(
    panel.screen.keyboard.map((row) => row.map((button) => button.text)),
    [
      ['🌐 Языки', '🗣 Обращение'],
      ['🤖 Модель', '🔑 Ключ'],
      ['💰 Баланс', '🔄 Обновить'],
    ],
  )
})

test('экран модели: модели OpenRouter с ценой за 1000 переводов, текущая отмечена', async () => {
  const panel = await openPanel(setupDeps({ live: true }))
  const screen = await panel.tap('🤖 Модель')
  assert.ok(screen.html.startsWith('<b>🤖 Модель</b> · OpenRouter\n\nСейчас: Claude Haiku 5.5'))
  assert.ok(screen.html.includes('• Claude Haiku 5.5 — лучшая в нашем замере'))
  assert.ok(screen.html.includes('Цена — за 1000 переводов, по нынешним ценам OpenRouter.'))
  assert.deepEqual(
    screen.keyboard.slice(0, 4).map((row) => row[0]!.text),
    ['✅ Claude Haiku 5.5 · $0,14', 'GPT-5.6 Luna · $0,29', 'Gemini 3.1 Flash Lite · $0,36', 'DeepSeek V4 Flash · $0,12'],
  )
})

test('спека: владелец выбирает другую модель — следующий перевод через неё', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  await panel.tap('🤖 Модель')
  const chosen = await panel.tap(/^GPT-5\.6 Luna/)
  assert.equal(chosen.toast, 'Модель: GPT-5.6 Luna')
  assert.ok(findButton(chosen.keyboard, /^✅ GPT-5\.6 Luna/))
  const model = ctx.deps.config(OWNER_ID).model
  assert.equal(model.ok && model.model, 'openai/gpt-5.6-luna')
  const main = await panel.tap('← Назад')
  assert.ok(main.html.includes('Модель: GPT-5.6 Luna · ≈ $0,29 за 1000 переводов'))
})

test('спека: цены не узнать — модели без цен, выбор работает', async () => {
  const ctx = setupDeps({ live: true })
  ctx.accounts.state.prices = null
  const panel = await openPanel(ctx)
  const screen = await panel.tap('🤖 Модель')
  assert.equal(screen.keyboard[1]![0]!.text, 'GPT-5.6 Luna')
  assert.ok(!screen.html.includes('Цена —'))
  await panel.tap('GPT-5.6 Luna')
  assert.equal(ctx.store.getSetting(OWNER_ID, SETTING.model), 'openai/gpt-5.6-luna')
})

test('спека: модель уходит — «⚠️» с датой на экране модели и на главном', async () => {
  const ctx = setupDeps({ live: true })
  const prices = samplePrices()
  prices.set('anthropic/claude-haiku-5.5', { ...prices.get('anthropic/claude-haiku-5.5')!, expiresAt: Date.parse('2026-10-20') })
  ctx.accounts.state.prices = prices
  const panel = await openPanel(ctx)
  assert.ok(panel.screen.html.includes('⚠️ OpenRouter уберёт эту модель 20 октября — выберите другую'))
  const screen = await panel.tap('🤖 Модель')
  assert.ok(screen.html.includes('⚠️ OpenRouter уберёт эту модель 20 октября — выберите другую'))
  assert.ok(findButton(screen.keyboard, /^✅ Claude Haiku 5\.5 · \$0,14 ⚠️$/))
})

test('спека: у провайдера есть ключ — включается сразу с первой моделью', async () => {
  const ctx = setupDeps({ live: true, envKeys: { OPENROUTER_API_KEY: KEY, DEEPSEEK_API_KEY: `sk-${'a'.repeat(32)}` } })
  ctx.connectOwner()
  const panel = await openPanel(ctx)
  await panel.tap('🤖 Модель')
  const providers = await panel.tap('Сменить провайдера')
  assert.ok(findButton(providers.keyboard, '✅ OpenRouter'))
  assert.ok(findButton(providers.keyboard, 'DeepSeek'))
  assert.ok(findButton(providers.keyboard, 'Groq 🔑'))
  const switched = await panel.tap('DeepSeek')
  assert.equal(switched.toast, 'Теперь DeepSeek')
  assert.ok(switched.html.startsWith('<b>🤖 Модель</b> · DeepSeek'))
  const model = ctx.deps.config(OWNER_ID).model
  assert.equal(model.ok && `${model.provider.id} ${model.model}`, 'deepseek deepseek-chat')
})

test('спека: у провайдера нет ключа — бот просит ключ, а переводы идут через прежнего', async () => {
  const ctx = setupDeps({ live: true })
  ctx.connectOwner()
  const panel = await openPanel(ctx)
  await panel.tap('🤖 Модель')
  await panel.tap('Сменить провайдера')
  const screen = await panel.tap('DeepSeek 🔑')
  assert.ok(screen.html.includes('Пришлите ключ DeepSeek одним сообщением'))
  const model = ctx.deps.config(OWNER_ID).model
  assert.equal(model.ok && model.provider.id, 'openrouter')
  // Ключ принят — только теперь провайдер переключается.
  ctx.accounts.state.verify = { verdict: 'ok', balance: null }
  await panel.panel.onText(OWNER_ID, { text: `sk-${'b'.repeat(32)}`, messageId: 77 })
  const after = ctx.deps.config(OWNER_ID).model
  assert.equal(after.ok && `${after.provider.id} ${after.model}`, 'deepseek deepseek-chat')
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('deepseek')), `sk-${'b'.repeat(32)}`)
})

test('спека: баланс — остаток меньше лимита, траты, цена, сколько хватит, срок ключа', async () => {
  const panel = await openPanel(setupDeps({ live: true }))
  const screen = await panel.tap('💰 Баланс')
  assert.equal(
    screen.html,
    [
      '<b>💰 Баланс OpenRouter</b>',
      '',
      'Осталось: $6,53 — меньшее из баланса счёта ($6,53) и лимита ключа ($9,80)',
      'Потрачено ключом: сегодня $0, в этом месяце $0,20',
      'Модель Claude Haiku 5.5: $0,10 за 1 млн токенов на вход, $0,50 на выход',
      'Один перевод ≈ $0,00014 — на остаток хватит примерно на 46 000 переводов',
      'Ключ действует до 16 октября',
    ].join('\n'),
  )
  assert.deepEqual(screen.keyboard.map((row) => row[0]!.text), ['🔄 Обновить', '← Назад'])
})

test('спека: ключ без лимита — остаток по счёту, «лимита у ключа нет»', async () => {
  const ctx = setupDeps({ live: true })
  ctx.accounts.state.balance = { ...SAMPLE_BALANCE, keyLeft: null }
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.ok(screen.html.includes('Осталось: $6,53 — баланс счёта, лимита у ключа нет'))
})

test('спека: баланс счёта не виден — остаток по лимиту ключа', async () => {
  const ctx = setupDeps({ live: true })
  ctx.accounts.state.balance = { ...SAMPLE_BALANCE, account: null, accountHidden: true, remaining: SAMPLE_BALANCE.keyLeft }
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.ok(screen.html.includes('Осталось: $9,80 — до лимита ключа; баланс счёта этим ключом не виден'))
})

test('спека: OpenRouter не ответил — «Остаток сейчас не узнать» и «🔄 Обновить»', async () => {
  const ctx = setupDeps({ live: true })
  ctx.accounts.state.balance = null
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.equal(screen.html, '<b>💰 Баланс OpenRouter</b>\n\nОстаток сейчас не узнать: нет связи с OpenRouter')
  assert.ok(findButton(screen.keyboard, '🔄 Обновить'))
})

test('спека: другой провайдер — ссылка на кабинет', async () => {
  const ctx = setupDeps({ live: true, envKeys: { DEEPSEEK_API_KEY: `sk-${'a'.repeat(32)}` } })
  ctx.store.setSetting(OWNER_ID, SETTING.provider, 'deepseek')
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.equal(
    screen.html,
    '<b>💰 Баланс</b>\n\nБаланс DeepSeek бот не видит — смотрите в кабинете провайдера: https://platform.deepseek.com/api_keys',
  )
})

test('спека: OpenRouter изменил цену — «🔄 Обновить» показывает новую без обновления бота', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  await panel.tap('💰 Баланс')
  const prices = samplePrices()
  prices.set('anthropic/claude-haiku-5.5', { input: 0.0000002, output: 0.000001, expiresAt: null })
  ctx.accounts.state.prices = prices
  const screen = await panel.tap('🔄 Обновить')
  assert.ok(screen.html.includes('Модель Claude Haiku 5.5: $0,20 за 1 млн токенов на вход, $1,00 на выход'))
})

test('данные каждой кнопки панели — не больше 64 байт', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  const panel = await openPanel(ctx)
  const seen: string[] = []
  const collect = (keyboard: typeof panel.screen.keyboard) =>
    keyboard.flat().forEach((button) => button.data && seen.push(button.data))
  collect(panel.screen.keyboard)
  for (const data of ['p:lang', 'p:lang:pick:owner', 'p:lang:pick:peer', 'p:addr', 'p:model', 'p:model:prov', 'p:key', 'p:key:paste', 'p:bal']) {
    collect((await panel.press(data)).keyboard)
  }
  assert.ok(seen.length > 60)
  for (const data of seen) assert.ok(Buffer.byteLength(data) <= 64, data)
})

test('название с «<» и «&» не ломает разметку', async () => {
  const model = {
    ok: true as const,
    provider: { ...PROVIDERS[0]!, label: 'Open<b>Router & Co' },
    model: 'x',
    title: 'A<b>&</b>',
    apiKey: KEY,
    keySource: 'env' as const,
    baseUrl: '',
  }
  const ctx = setupDeps({ overrides: { model } })
  await createPanel(ctx.deps).open(OWNER_ID)
  const html = ctx.tg.callsOf('sendText').at(-1)!.text
  assert.ok(html.includes('Модель: A&lt;b&gt;&amp;&lt;/b&gt;'))
  assert.ok(html.includes('Ключ Open&lt;b&gt;Router &amp; Co'))
})

test('ответ после смены модели — через новую модель (живые настройки)', async () => {
  const ctx = setupDeps({ live: true })
  ctx.connectOwner()
  const conversation = ctx.store.createConversation({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, peerChatId: PEER_ID, peerName: 'Alex', lastPeerAt: ctx.deps.now() })
  const panel = await openPanel(ctx)
  await panel.tap('🤖 Модель')
  await panel.tap(/^DeepSeek V4 Flash/)
  await sendOwnerReply(ctx.deps, conversation, { text: 'Привет', media: null, sourceMessageId: 1 }, { outsideTopic: false })
  const model = ctx.deps.config(OWNER_ID).model
  assert.equal(model.ok && model.model, 'deepseek/deepseek-v4-flash')
  assert.equal(ctx.tg.sentAsOwner().length, 1)
})

test('бесплатная модель — «Один перевод ≈ $0» без «хватит на N переводов»', async () => {
  const ctx = setupDeps({ live: true })
  const prices = samplePrices()
  prices.set('anthropic/claude-haiku-5.5', { input: 0, output: 0, expiresAt: null })
  ctx.accounts.state.prices = prices
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.ok(screen.html.includes('\nОдин перевод ≈ $0\n'), screen.html)
})

test('ссылка на кабинет на экране баланса проходит escapeHtml', async () => {
  const provider = { ...PROVIDERS[1]!, keysUrl: 'https://example.test/keys?a=1&b=<2>' }
  const model = { ok: true as const, provider, model: 'deepseek-chat', title: 'DeepSeek Chat', apiKey: 'k', keySource: 'env' as const, baseUrl: '' }
  const screen = await (await openPanel(setupDeps({ overrides: { model, provider } }))).tap('💰 Баланс')
  assert.ok(screen.html.endsWith('смотрите в кабинете провайдера: https://example.test/keys?a=1&amp;b=&lt;2&gt;'), screen.html)
})

test('выбор провайдера, который уже включён, ничего не меняет — модель владельца остаётся', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  await panel.tap('🤖 Модель')
  await panel.tap(/^GPT-5\.6 Luna/)
  await panel.tap('Сменить провайдера')
  const screen = await panel.tap('✅ OpenRouter')
  assert.equal(screen.toast, 'Уже OpenRouter')
  assert.ok(screen.html.startsWith('<b>🤖 Модель</b> · OpenRouter\n\nСейчас: GPT-5.6 Luna'), screen.html)
  assert.equal(ctx.store.getSetting(OWNER_ID, SETTING.model), 'openai/gpt-5.6-luna')
})

test('старая кнопка модели другого провайдера — ничего не сохраняется, просьба выбрать ещё раз', async () => {
  const ctx = setupDeps({ live: true, envKeys: { OPENROUTER_API_KEY: KEY, DEEPSEEK_API_KEY: `sk-${'a'.repeat(32)}` } })
  const panel = await openPanel(ctx)
  await panel.tap('🤖 Модель')
  // Экран моделей OpenRouter остался в чате, а провайдера тем временем сменили.
  ctx.store.setSetting(OWNER_ID, SETTING.provider, 'deepseek')
  const stale = await panel.tap(/Claude Haiku 5\.5/)
  assert.equal(stale.toast, 'Список моделей обновился — выберите ещё раз')
  assert.equal(ctx.store.getSetting(OWNER_ID, SETTING.model), 'anthropic/claude-haiku-5.5')
  assert.ok(stale.html.startsWith('<b>🤖 Модель</b> · DeepSeek'), stale.html)
})

test('кнопка модели без номера, с чужим или лишним номером — ничего не сохраняется', async () => {
  const ctx = setupDeps({ live: true })
  ctx.store.setSetting(OWNER_ID, SETTING.model, 'openai/gpt-5.6-luna')
  const panel = await openPanel(ctx)
  for (const data of ['p:model:set:openrouter:', 'p:model:set:', 'p:model:set:openrouter:9', 'p:model:set:openrouter:1x', 'p:model:set:deepseek:0']) {
    const screen = await panel.press(data)
    assert.equal(screen.toast, 'Список моделей обновился — выберите ещё раз', data)
    assert.equal(ctx.store.getSetting(OWNER_ID, SETTING.model), 'openai/gpt-5.6-luna', data)
  }
})

test('«Отмена» на просьбе ключа после «Сменить провайдера» — назад к провайдерам, ожидание снято', async () => {
  const ctx = setupDeps({ live: true })
  const panel = await openPanel(ctx)
  await panel.tap('🤖 Модель')
  await panel.tap('Сменить провайдера')
  const ask = await panel.tap('DeepSeek 🔑')
  assert.deepEqual(ask.keyboard, [[{ text: 'Отмена', data: 'p:model:prov' }]])
  const back = await panel.tap('Отмена')
  assert.ok(back.html.startsWith('<b>Провайдер моделей</b>'), back.html)
  await panel.panel.onText(OWNER_ID, { text: `sk-${'b'.repeat(32)}`, messageId: 77 })
  assert.equal(ctx.store.getSetting(OWNER_ID, keySetting('deepseek')), undefined)
})

test('ключ из панели не принят провайдером — экран баланса так и говорит', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), KEY)
  ctx.accounts.state.rejected = true
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.equal(screen.html, '<b>💰 Баланс OpenRouter</b>\n\nOpenRouter не принял ключ — остаток не узнать. Вставьте новый ключ: «🔑 Ключ».')
  assert.deepEqual(screen.keyboard.map((row) => row.map((button) => button.text)), [['🔄 Обновить'], ['← Назад']])
})

test('ключ из .env не принят провайдером — экран баланса ведёт в .env', async () => {
  const ctx = setupDeps({ live: true })
  ctx.accounts.state.rejected = true
  const screen = await (await openPanel(ctx)).tap('💰 Баланс')
  assert.equal(screen.html, '<b>💰 Баланс OpenRouter</b>\n\nOpenRouter не принял ключ — остаток не узнать. Проверьте OPENROUTER_API_KEY в .env.')
  assert.deepEqual(screen.keyboard.map((row) => row.map((button) => button.text)), [['🔄 Обновить'], ['← Назад']])
})
