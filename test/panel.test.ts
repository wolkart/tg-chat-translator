import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SETTINGS_PATH } from '../src/channels/private-chat/connection.ts'
import { ACCOUNT_CACHE_MS, NOT_CHANGED, createPanel } from '../src/owner/panel/panel.ts'
import { REFRESH } from '../src/owner/panel/screen.ts'
import { keySetting } from '../src/store.ts'
import { TelegramError } from '../src/telegram.ts'
import { samplePrices } from './fakes.ts'
import { findButton, openPanel } from './panel-helpers.ts'
import { OWNER_ID } from './helpers.ts'
import { TEST_KEY, setupDeps } from './setup.ts'

type Setup = ReturnType<typeof setupDeps>

/** Панель по /start: текст и кнопки нового сообщения. */
async function opened(ctx: Setup) {
  await createPanel(ctx.deps).open(OWNER_ID)
  const sent = ctx.tg.callsOf('sendText').at(-1)!
  return { html: sent.text, lines: sent.text.split('\n'), keyboard: sent.opts.keyboard ?? [], opts: sent.opts }
}

const WRITE_FIRST = 'Написать первым: отправьте текст сюда вне тем — бот переведёт и даст кнопку'

test('спека: всё настроено — строки состояния по порядку', async () => {
  const ctx = setupDeps()
  ctx.connectOwner()
  const { html, opts } = await opened(ctx)
  assert.equal(opts.html, true)
  assert.equal(
    html,
    [
      '<b>⚙️ Переводчик</b>',
      '',
      '✅ Подключён к вашему аккаунту и может отвечать от вашего имени',
      '✅ BotFather: всё включено',
      '✅ Ключ OpenRouter: осталось $6,53, действует до 16 октября',
      '',
      'Языки: русский ↔ английский',
      'Обращение: как в разговоре',
      'Модель: Claude Haiku 5.5 · ≈ $0,14 за 1000 переводов',
      '',
      `${WRITE_FIRST} «Отправить через бота»`,
    ].join('\n'),
  )
})

test('спека: ключа нет — строка с «⚠️» и что нажать', async () => {
  const ctx = setupDeps({ overrides: { model: { ok: false, problem: 'Нет ключа модели' }, translator: null } })
  ctx.connectOwner()
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('⚠️ Ключа модели нет — переводить нечем. Нажмите «🔑 Ключ».'))
  assert.ok(!lines.some((line) => line.startsWith('Модель:')))
})

test('спека: бот не подключён — «⚠️» и путь к настройке', async () => {
  const ctx = setupDeps()
  const { lines } = await opened(ctx)
  const line = lines.find((candidate) => candidate.includes('Подключение к аккаунту'))!
  assert.ok(line.startsWith('⚠️ '))
  assert.ok(line.includes(SETTINGS_PATH))
})

test('спека: нет права отвечать — включить «Ответы на сообщения» по тому же пути', async () => {
  const ctx = setupDeps()
  ctx.connectOwner({ canReply: false })
  const { lines } = await opened(ctx)
  assert.ok(
    lines.includes(
      `⚠️ Бот подключён, но не может отвечать от вашего имени. Включите «Ответы на сообщения» (раздел «Сообщения»): ${SETTINGS_PATH}`,
    ),
  )
})

test('бот отключён от аккаунта — «⚠️» и путь, чтобы подключить снова', async () => {
  const ctx = setupDeps()
  ctx.connectOwner({ isEnabled: false })
  const { lines } = await opened(ctx)
  assert.ok(lines.includes(`⚠️ Бот отключён от вашего аккаунта. Подключите: ${SETTINGS_PATH}`))
})

test('спека: холостой прогон — строка об этом', async () => {
  const ctx = setupDeps({ overrides: { dry: true } })
  const { lines } = await opened(ctx)
  assert.equal(lines.at(-1), 'Холостой прогон: собеседникам ничего не уходит')
})

test('спека: остаток не узнать — ключ есть, остальной экран как обычно', async () => {
  const ctx = setupDeps()
  ctx.accounts.state.balance = null
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('Ключ OpenRouter: есть, остаток сейчас не узнать'))
  assert.ok(lines.includes('Языки: русский ↔ английский'))
})

test('ключ из панели не принят провайдером — «⚠️», вставить новый, «🔑 Ключ» зелёная', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), TEST_KEY)
  ctx.accounts.state.rejected = true
  const { lines, keyboard } = await opened(ctx)
  assert.ok(lines.includes('⚠️ Ключ OpenRouter не принят провайдером — вставьте новый: нажмите «🔑 Ключ».'), lines.join('\n'))
  assert.equal(findButton(keyboard, '🔑 Ключ')?.style, 'success')
})

test('ключ из .env не принят провайдером — проверить переменную в .env', async () => {
  const ctx = setupDeps()
  ctx.accounts.state.rejected = true
  const { lines, keyboard } = await opened(ctx)
  assert.ok(lines.includes('⚠️ Ключ OpenRouter не принят провайдером — проверьте OPENROUTER_API_KEY в .env.'), lines.join('\n'))
  assert.equal(findButton(keyboard, '🔑 Ключ')?.style, 'success')
})

test('ключ бессрочный — так и написано', async () => {
  const ctx = setupDeps()
  ctx.accounts.state.balance = { ...ctx.accounts.state.balance!, expiresAt: null }
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('✅ Ключ OpenRouter: осталось $6,53, бессрочный'))
})

test('спека: проблема в BotFather — только она, с тем, что включить', async () => {
  const ctx = setupDeps({ me: { supportsInlineQueries: false } })
  const { lines } = await opened(ctx)
  const botfather = lines.filter((line) => line.includes('BotFather:'))
  assert.deepEqual(botfather, [
    '⚠️ BotFather: выключен Inline Mode — без него не работает кнопка «Отправить через бота». ' +
      'Откройте @BotFather → Open → этот бот → Bot Settings → Inline Mode и включите переключатель.',
  ])
})

test('спека: подсказка «Написать первым» обещает «Скопировать», если Inline Mode выключен', async () => {
  const ctx = setupDeps({ me: { supportsInlineQueries: false } })
  const { lines } = await opened(ctx)
  assert.ok(lines.includes(`${WRITE_FIRST} «Скопировать»`))
})

test('свежий getMe из панели уходит проверке Inline Mode', async () => {
  const seen: boolean[] = []
  const ctx = setupDeps({ me: { supportsInlineQueries: false }, overrides: { onBotInfo: (me) => seen.push(me.supportsInlineQueries) } })
  await opened(ctx)
  assert.deepEqual(seen, [false])
})

test('getMe не ответил — BotFather «не проверить», кнопку подсказки берём из проверки Inline Mode', async () => {
  const ctx = setupDeps({ overrides: { inlineEnabled: async () => false } })
  ctx.tg.failNext('getMe', new Error('сеть моргнула'))
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('BotFather: не проверить — Telegram не ответил'))
  assert.ok(lines.includes(`${WRITE_FIRST} «Скопировать»`))
})

test('спека: модель уходит — «⚠️» с датой на главном экране', async () => {
  const prices = samplePrices()
  prices.set('anthropic/claude-haiku-5.5', { ...prices.get('anthropic/claude-haiku-5.5')!, expiresAt: Date.parse('2026-10-20') })
  const ctx = setupDeps()
  ctx.accounts.state.prices = prices
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('⚠️ OpenRouter уберёт эту модель 20 октября — выберите другую'))
})

test('цены не узнать — модель без цены', async () => {
  const ctx = setupDeps()
  ctx.accounts.state.prices = null
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('Модель: Claude Haiku 5.5'))
})

test('язык без профиля — «⚠️» с причиной', async () => {
  const ctx = setupDeps({ overrides: { languages: null, languagesProblem: 'Не поддерживается ваш язык «xx»' } })
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('⚠️ Не поддерживается ваш язык «xx»'))
})

test('у провайдера без счёта — просто «ключ есть»', async () => {
  const ctx = setupDeps({
    overrides: {
      model: {
        ok: true,
        provider: { id: 'deepseek', label: 'DeepSeek', baseUrl: '', envKey: 'DEEPSEEK_API_KEY', keysUrl: '', models: [] },
        model: 'deepseek-chat',
        title: 'DeepSeek Chat',
        apiKey: 'k',
        keySource: 'env',
        baseUrl: '',
      },
    },
  })
  const { lines } = await opened(ctx)
  assert.ok(lines.includes('✅ Ключ DeepSeek: есть'))
  assert.ok(lines.includes('Модель: DeepSeek Chat'))
})

test('снимок счёта живёт минуту: повторное открытие не спрашивает провайдера', async () => {
  const ctx = setupDeps()
  const panel = createPanel(ctx.deps)
  await panel.open(OWNER_ID)
  await panel.open(OWNER_ID)
  assert.equal(ctx.accounts.calls.balance.length, 1)
  ctx.advance(ACCOUNT_CACHE_MS)
  await panel.open(OWNER_ID)
  assert.equal(ctx.accounts.calls.balance.length, 2)
})

test('экраны языков, обращения и ключа не спрашивают ни Telegram, ни провайдера; модель — только цены; баланс — без getMe', async () => {
  const ctx = setupDeps({ live: true, envKeys: {} })
  ctx.store.setSetting(OWNER_ID, keySetting('openrouter'), TEST_KEY)
  const panel = await openPanel(ctx)
  assert.equal(ctx.tg.callsOf('getMe').length, 1)
  assert.equal(ctx.accounts.calls.balance.length, 1)
  // Снимок счёта устарел: экран, которому он нужен, спросил бы провайдера заново.
  ctx.advance(ACCOUNT_CACHE_MS)
  for (const data of ['p:lang', 'p:lang:pick:owner', 'p:addr', 'p:addr:set:formal', 'p:key', 'p:key:paste']) {
    await panel.press(data)
    assert.equal(ctx.tg.callsOf('getMe').length, 1, data)
    assert.equal(ctx.accounts.calls.balance.length, 1, data)
  }
  await panel.press('p:model')
  assert.equal(ctx.tg.callsOf('getMe').length, 1)
  assert.equal(ctx.accounts.calls.balance.length, 1)
  await panel.press('p:bal')
  assert.equal(ctx.tg.callsOf('getMe').length, 1)
  assert.equal(ctx.accounts.calls.balance.length, 2)
  // Главный экран — снова с getMe: на нём строка BotFather.
  await panel.press('p:main')
  assert.equal(ctx.tg.callsOf('getMe').length, 2)
})

test('кнопка «🔄 Обновить» — на главном экране', async () => {
  const { keyboard } = await opened(setupDeps())
  assert.deepEqual(keyboard.flat().at(-1), { text: '🔄 Обновить', data: REFRESH })
})

test('спека: «🔄 Обновить» — свежий остаток, экран правится на месте', async () => {
  const ctx = setupDeps()
  const panel = createPanel(ctx.deps)
  await panel.open(OWNER_ID)
  ctx.accounts.state.balance = { ...ctx.accounts.state.balance!, remaining: 5 }
  await panel.onCallback({ id: 'cb1', data: REFRESH, messageId: 1000 }, OWNER_ID)
  const edit = ctx.tg.callsOf('editText')[0]!
  assert.equal(edit.messageId, 1000)
  assert.ok(edit.text.includes('✅ Ключ OpenRouter: осталось $5,00, действует до 16 октября'))
  assert.equal(edit.opts?.html, true)
  assert.equal(ctx.tg.callsOf('sendText').length, 1)
  assert.deepEqual(ctx.tg.callsOf('answerCallback')[0], { method: 'answerCallback', callbackId: 'cb1', text: undefined })
})

test('спека: владелец включил режим в BotFather — «🔄 Обновить» показывает «всё включено»', async () => {
  const me = { hasTopicsEnabled: false }
  const ctx = setupDeps({ me })
  const panel = createPanel(ctx.deps)
  await panel.open(OWNER_ID)
  assert.ok(ctx.tg.callsOf('sendText').at(-1)!.text.includes('⚠️ BotFather: выключен Threaded Mode'))
  me.hasTopicsEnabled = true
  await panel.onCallback({ id: 'cb5', data: REFRESH, messageId: 1000 }, OWNER_ID)
  assert.ok(ctx.tg.callsOf('editText')[0]!.text.includes('✅ BotFather: всё включено'))
})

test('спека: «🔄 Обновить» без изменений — «Без изменений»', async () => {
  const ctx = setupDeps()
  ctx.tg.failNext('editText', new TelegramError(400, 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same'))
  await createPanel(ctx.deps).onCallback({ id: 'cb2', data: REFRESH, messageId: 1000 }, OWNER_ID)
  assert.equal(ctx.tg.callsOf('answerCallback')[0]!.text, NOT_CHANGED)
})

test('другая ошибка правки — тот же экран приходит новым сообщением, нажатие отвечено', async () => {
  const ctx = setupDeps()
  ctx.tg.failNext('editText', new TelegramError(400, 'Bad Request: message to edit not found'))
  await createPanel(ctx.deps).onCallback({ id: 'cb3', data: REFRESH, messageId: 1000 }, OWNER_ID)
  const edit = ctx.tg.callsOf('editText')[0]!
  const sent = ctx.tg.callsOf('sendText')
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.chatId, OWNER_ID)
  assert.equal(sent[0]!.text, edit.text)
  assert.deepEqual(sent[0]!.opts, { html: true, keyboard: edit.opts!.keyboard })
  assert.deepEqual(ctx.tg.callsOf('answerCallback'), [{ method: 'answerCallback', callbackId: 'cb3', text: undefined }])
})

test('и новое сообщение не ушло — нажатие всё равно отвечено, причина в консоли', async () => {
  const ctx = setupDeps()
  ctx.tg.failNext('editText', new TelegramError(400, "Bad Request: message can't be edited"))
  ctx.tg.failNext('sendText', new Error('сеть моргнула'))
  await createPanel(ctx.deps).onCallback({ id: 'cb6', data: 'p:lang', messageId: 1000 }, OWNER_ID)
  assert.deepEqual(ctx.tg.callsOf('answerCallback'), [{ method: 'answerCallback', callbackId: 'cb6', text: undefined }])
  assert.ok(ctx.printed.some((line) => line.includes('сеть моргнула')), ctx.printed.join('\n'))
})

test('незнакомая кнопка панели — ответ на нажатие, экран не трогаем', async () => {
  const ctx = setupDeps()
  await createPanel(ctx.deps).onCallback({ id: 'cb4', data: 'p:nope:x', messageId: 1000 }, OWNER_ID)
  assert.equal(ctx.tg.callsOf('editText').length, 0)
  assert.equal(ctx.tg.callsOf('answerCallback').length, 1)
})
