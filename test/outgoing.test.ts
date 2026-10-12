import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendOwnerReply } from '../src/channels/private-chat/outgoing.ts'
import { TelegramError } from '../src/telegram.ts'
import { reviewTranslation, type ReviewInput } from '../src/translate/check.ts'
import { TranslationError } from '../src/translate/llm.ts'
import type { OwnerPayload } from '../src/types.ts'
import { CONNECTION_ID, OWNER_ID, PEER_ID } from './helpers.ts'
import { fakeTranslator, setupDeps } from './setup.ts'

function prepared(options: Parameters<typeof setupDeps>[0] = {}) {
  const ctx = setupDeps(options)
  ctx.connectOwner()
  const conversation = ctx.store.createConversation({
    ownerId: OWNER_ID,
    connectionId: CONNECTION_ID,
    peerChatId: PEER_ID,
    peerName: 'Alex Peer',
    lastPeerAt: ctx.deps.now(),
  })
  ctx.store.addReplica(conversation.id, { role: 'peer', original: 'How are you?', translation: 'Как дела?' }, ctx.deps.now())
  return { ...ctx, conversation }
}

const reply: OwnerPayload = { text: 'Отлично, а ты?', media: null, sourceMessageId: 901 }

test('ответ уходит собеседнику от имени владельца, в теме видно, что ушло', async () => {
  const { deps, tg, store, translator, conversation } = prepared()
  const ok = await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(ok, true)

  assert.equal(translator.calls[0]!.target.code, 'en')
  assert.deepEqual(translator.calls[0]!.history, [{ role: 'peer', text: 'How are you?' }])

  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.chatId, PEER_ID)
  assert.equal(toPeer.text, '[en] Отлично, а ты?')
  assert.equal(toPeer.opts.businessConnectionId, CONNECTION_ID)
  assert.equal(toPeer.opts.html, undefined)

  const inTopic = tg.callsOf('sendText').at(-1)!
  assert.equal(inTopic.chatId, OWNER_ID)
  assert.equal(inTopic.text, '<i>Вы:</i> Отлично, а ты?\n→ [en] Отлично, а ты?')
  assert.ok(!tg.callsOf('sendText').some((call) => call.text.startsWith('✓')))

  assert.equal(store.recentReplicas(conversation.id).at(-1)?.role, 'owner')
})

test('отправленное запоминается, чтобы его эхо не повторилось в теме', async () => {
  const { deps, tg, store, conversation } = prepared()
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(store.wasSent(OWNER_ID, PEER_ID, toPeer.id), true)
})

test('ответ вне темы получает «✓ <имя>»', async () => {
  const { deps, tg, conversation } = prepared()
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: true })
  const check = tg.callsOf('sendText').at(-1)!
  assert.equal(check.text, '✓ Alex Peer')
  assert.equal(check.chatId, OWNER_ID)
  assert.equal(check.opts.replyTo, 901)
})

test('перевод не удался — собеседнику ничего, оригинал не уходит, в теме причина', async () => {
  const failing = fakeTranslator(() => {
    throw new TranslationError('модель не ответила за 30 с')
  })
  const { deps, tg, conversation } = prepared({ overrides: { translator: failing.translate } })
  const ok = await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(ok, false)
  assert.equal(tg.sentAsOwner().length, 0)
  assert.ok(!tg.calls.some((call) => call.method === 'sendText' && call.chatId === PEER_ID))
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<b>Не отправлено:</b> перевод не удался — модель не ответила за 30 с')
})

const SETTINGS = 'Настройки → Аккаунт → Автоматизация чатов → этот бот (на Mac — Настройки → Изменить профиль → Автоматизация чатов)'

test('спека: собеседник давно не писал — понятная причина, перевод и кнопки, повтора нет', async () => {
  const { deps, tg, store, conversation } = prepared()
  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
  const ok = await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(ok, false)
  assert.equal(tg.sentAsOwner().length, 1)
  const notice = tg.callsOf('sendText').at(-1)!
  assert.equal(
    notice.text,
    '<b>Не отправлено:</b> от Alex Peer давно не было сообщений, а от вашего имени бот может писать только тем, ' +
      'кто писал вам недавно. Отправьте перевод сами — кнопками ниже. Когда Alex Peer ответит, бот снова будет отправлять сам.\n' +
      'Перевод:\n[en] Отлично, а ты?',
  )
  const draftId = Number(notice.opts.keyboard![0]![0]!.chooseChat)
  assert.deepEqual(notice.opts.keyboard, [
    [{ text: 'Отправить через бота', chooseChat: String(draftId), style: 'success' }],
    [{ text: 'Скопировать', copy: '[en] Отлично, а ты?' }],
  ])
  const draft = store.getDraft(OWNER_ID, draftId, deps.now())!
  assert.equal(draft.conversationId, conversation.id)
  assert.equal(draft.original, 'Отлично, а ты?')
  assert.equal(store.recentReplicas(conversation.id).length, 1)
})

test('спека: бот не видит чат — путь к настройке и кнопки', async () => {
  const { deps, tg, conversation } = prepared()
  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_INVALID'))
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  const notice = tg.callsOf('sendText').at(-1)!
  assert.equal(
    notice.text,
    `<b>Не отправлено:</b> бот не видит чат с Alex Peer — его нет среди чатов, доступных боту. Добавьте его: ${SETTINGS}. ` +
      'Пока отправьте перевод сами — кнопками ниже.\nПеревод:\n[en] Отлично, а ты?',
  )
  assert.equal(notice.opts.keyboard!.length, 2)
})

test('спека: незнакомый отказ — словами Telegram, перевод и кнопки', async () => {
  const { deps, tg, conversation } = prepared()
  tg.failNext('sendText', new TelegramError(403, 'Forbidden: bot was blocked by the user'))
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  const notice = tg.callsOf('sendText').at(-1)!
  assert.equal(
    notice.text,
    '<b>Не отправлено:</b> Telegram не принял сообщение — Forbidden: bot was blocked by the user\nПеревод:\n[en] Отлично, а ты?',
  )
  assert.equal(notice.opts.keyboard!.length, 2)
})

test('спека: нет права отвечать — бот не пробует отправить, в холостом прогоне нет «ушло бы»', async () => {
  for (const dry of [false, true]) {
    const { deps, tg, connectOwner, conversation } = prepared({ overrides: { dry } })
    connectOwner({ canReply: false })
    await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
    assert.equal(tg.sentAsOwner().length, 0)
    const notice = tg.callsOf('sendText').at(-1)!
    assert.equal(
      notice.text,
      `<b>Не отправлено:</b> боту не разрешено отвечать от вашего имени. Включите «Ответы на сообщения»: ${SETTINGS}.\n` +
        'Перевод:\n[en] Отлично, а ты?',
    )
    assert.equal(notice.opts.keyboard!.length, 2)
    assert.ok(!tg.callsOf('sendText').some((call) => call.text.includes('Холостой прогон')))
  }
})

test('бот отключён от аккаунта — не отправляем, говорим почему и как подключить', async () => {
  const { deps, tg, connectOwner, conversation } = prepared()
  connectOwner({ isEnabled: false })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(tg.sentAsOwner().length, 0)
  const notice = tg.callsOf('sendText').at(-1)!
  assert.match(notice.text, /^<b>Не отправлено:<\/b> бот отключён от вашего аккаунта\. Подключите его снова: Настройки → Аккаунт/)
  assert.equal(notice.opts.keyboard!.length, 2)
})

test('Inline Mode выключен — под «Не отправлено» одна «Скопировать»', async () => {
  const { deps, tg, conversation } = prepared({ overrides: { inlineEnabled: async () => false } })
  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.deepEqual(tg.callsOf('sendText').at(-1)!.opts.keyboard, [[{ text: 'Скопировать', copy: '[en] Отлично, а ты?' }]])
})

test('спека: вложение на отказе — не загружается заново, перевод подписи, одна «Скопировать» и подсказка', async () => {
  const { deps, tg, conversation } = prepared()
  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
  await sendOwnerReply(
    deps,
    conversation,
    { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 },
    { outsideTopic: false },
  )
  assert.equal(tg.callsOf('downloadFile').length, 0)
  assert.equal(tg.callsOf('sendMedia').length, 1)
  const notice = tg.callsOf('sendText').at(-1)!
  assert.match(notice.text, /^<b>Не отправлено:<\/b> от Alex Peer давно не было сообщений/)
  assert.match(notice.text, /\n<i>Фото отправьте Alex Peer сами — через кнопку бот отправляет только текст\.<\/i>\nПеревод подписи:\n\[en\] Это тебе$/)
  assert.deepEqual(notice.opts.keyboard, [[{ text: 'Скопировать', copy: '[en] Это тебе' }]])
})

test('стикер на отказе — подсказка отправить самому, без кнопок: переводить нечего', async () => {
  const { deps, tg, conversation } = prepared()
  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
  await sendOwnerReply(deps, conversation, { text: '', media: { kind: 'sticker', fileId: 'S' }, sourceMessageId: 905 }, { outsideTopic: false })
  const notice = tg.callsOf('sendText').at(-1)!
  assert.match(notice.text, /\n<i>Стикер отправьте Alex Peer сами — через кнопку бот отправляет только текст\.<\/i>$/)
  assert.equal(notice.opts.keyboard, undefined)
})

test('прочая ошибка первой ступени — вложение, как и раньше, загружается заново', async () => {
  const { deps, tg, conversation } = prepared()
  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: wrong file identifier'))
  const ok = await sendOwnerReply(
    deps,
    conversation,
    { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 },
    { outsideTopic: false },
  )
  assert.equal(ok, true)
  assert.equal(tg.callsOf('downloadFile').length, 1)
})

test('холостой прогон: от имени владельца ничего не уходит, в теме — «ушло бы»', async () => {
  const { deps, tg, conversation } = prepared({ overrides: { dry: true } })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  await sendOwnerReply(deps, conversation, { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 }, { outsideTopic: false })
  assert.equal(tg.sentAsOwner().length, 0)
  const texts = tg.callsOf('sendText').map((call) => call.text)
  assert.ok(texts.includes('<i>Холостой прогон: ушло бы —</i> [en] Отлично, а ты?'))
  assert.ok(texts.includes('<i>Холостой прогон: ушло бы —</i> [фото] [en] Это тебе'))
  assert.ok(!texts.some((text) => text.includes('ушло бы —</i> Это тебе')))
})

test('фото владельца из темы уходит собеседнику с переведённой подписью', async () => {
  const { deps, tg, conversation } = prepared()
  await sendOwnerReply(
    deps,
    conversation,
    { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 },
    { outsideTopic: false },
  )
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendMedia')
  assert.equal(toPeer.chatId, PEER_ID)
  assert.equal(toPeer.file, 'OWNER_PHOTO_1')
  assert.equal(toPeer.opts.caption, '[en] Это тебе')
  assert.equal(toPeer.opts.html, undefined)
})

test('стикер владельца без текста уходит без вызова модели', async () => {
  const { deps, tg, translator, conversation } = prepared()
  await sendOwnerReply(deps, conversation, { text: '', media: { kind: 'sticker', fileId: 'S' }, sourceMessageId: 905 }, { outsideTopic: false })
  assert.equal(translator.calls.length, 0)
  assert.equal(tg.sentAsOwner().length, 1)
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<i>Вы:</i> [стикер]')
})

test('длинный перевод уходит собеседнику несколькими сообщениями', async () => {
  const long = fakeTranslator(() => 'слово '.repeat(1500))
  const { deps, tg, conversation } = prepared({ overrides: { translator: long.translate } })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  const parts = tg.sentAsOwner()
  assert.ok(parts.length >= 3)
  for (const part of parts) assert.ok(part.method === 'sendText' && part.text.length <= 4096)
})

test('владелец переподключил бота — ответ идёт через текущее подключение, а не через старое', async () => {
  const { deps, tg, store } = prepared()
  const old = store.createConversation({ ownerId: OWNER_ID, connectionId: 'BC_OLD', peerChatId: 200009, peerName: 'Old Peer', lastPeerAt: deps.now() })
  await sendOwnerReply(deps, old, reply, { outsideTopic: false })
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.opts.businessConnectionId, CONNECTION_ID)
})

test('ответ с «<» и «&» уходит собеседнику как есть, а в теме экранирован', async () => {
  const echo = fakeTranslator((request) => request.text)
  const { deps, tg, conversation } = prepared({ overrides: { translator: echo.translate } })
  await sendOwnerReply(deps, conversation, { text: 'Tom & Jerry <3', media: null, sourceMessageId: 906 }, { outsideTopic: false })
  const [toPeer] = tg.sentAsOwner()
  assert.ok(toPeer && toPeer.method === 'sendText')
  assert.equal(toPeer.text, 'Tom & Jerry <3')
  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<i>Вы:</i> Tom &amp; Jerry &lt;3\n→ Tom &amp; Jerry &lt;3')
})

test('перевод ответа не удался дважды — две пометки в теме и одно общее сообщение', async () => {
  let n = 0
  const failing = fakeTranslator(() => {
    n += 1
    throw new TranslationError(`OpenRouter ответил ошибкой 503: overloaded, request ${n === 1 ? 'abc' : 'def'}`)
  })
  const { deps, tg, conversation } = prepared({ overrides: { translator: failing.translate } })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  await sendOwnerReply(deps, conversation, { ...reply, sourceMessageId: 902 }, { outsideTopic: false })
  const sends = tg.callsOf('sendText')
  const general = sends.filter((call) => call.opts.threadId === undefined)
  assert.equal(general.length, 1)
  assert.ok(general[0]!.text.startsWith('Модель не переводит:'))
  const marks = sends.filter((call) => call.opts.threadId !== undefined && call.text.includes('Не отправлено:</b> перевод не удался'))
  assert.equal(marks.length, 2)
})

test('ответ на «✓ <имя>» уходит тому же собеседнику', async () => {
  const { deps, tg, store, conversation } = prepared()
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: true })
  const check = tg.callsOf('sendText').at(-1)!
  assert.equal(store.conversationByBotMessage(OWNER_ID, check.id)?.id, conversation.id)
})

/** Ответ владельца с настоящей проверкой; переводчик по словарю. */
function guarded(answers: Record<string, string>, options: Parameters<typeof setupDeps>[0] = {}) {
  const translator = fakeTranslator((request) => answers[request.text] ?? `[${request.target.code}] ${request.text}`)
  return prepared({ ...options, overrides: { translator: translator.translate, review: reviewTranslation, ...options.overrides } })
}

function ownerSays(text: string): OwnerPayload {
  return { text, media: null, sourceMessageId: 910 }
}

test('спека: перевод ответа вернулся не на языке собеседника — не уходит, в теме причина и перевод', async () => {
  const text = 'Хорошо, созвонимся вечером и всё обсудим.'
  const { deps, tg, store, conversation } = guarded({ [text]: text })
  const ok = await sendOwnerReply(deps, conversation, ownerSays(text), { outsideTopic: true })
  assert.equal(ok, false)
  assert.equal(tg.sentAsOwner().length, 0)
  assert.equal(tg.callsOf('sendText').at(-1)!.text, `<b>Не отправлено:</b> перевод выглядит подозрительно\nПеревод:\n${text}`)
  assert.ok(!tg.callsOf('sendText').some((call) => call.text.startsWith('✓')))
  assert.equal(store.recentReplicas(conversation.id).at(-1)?.role, 'peer')
})

test('дата в ответе владельца сменила форму — ответ всё равно уходит: числа в ответе не сверяются', async () => {
  const { deps, tg, conversation } = guarded({ 'Встреча 05.10 в 15:00': 'Meeting on October 5 at 3 pm' })
  assert.equal(await sendOwnerReply(deps, conversation, ownerSays('Встреча 05.10 в 15:00'), { outsideTopic: false }), true)
  assert.equal(tg.sentAsOwner().length, 1)
})

test('короткий обычный ответ проходит проверку и уходит', async () => {
  const { deps, tg, conversation } = guarded({ 'Ок, до завтра': 'Ok, see you tomorrow' })
  assert.equal(await sendOwnerReply(deps, conversation, ownerSays('Ок, до завтра'), { outsideTopic: false }), true)
  assert.equal(tg.sentAsOwner().length, 1)
})

test('холостой прогон: подозрительный перевод — «Не отправлено», а не «ушло бы»', async () => {
  const text = 'Хорошо, созвонимся вечером и всё обсудим.'
  const { deps, tg, conversation } = guarded({ [text]: text }, { overrides: { dry: true } })
  await sendOwnerReply(deps, conversation, ownerSays(text), { outsideTopic: false })
  const texts = tg.callsOf('sendText').map((call) => call.text)
  assert.ok(texts.at(-1)!.startsWith('<b>Не отправлено:</b> перевод выглядит подозрительно'))
  assert.ok(!texts.some((t) => t.includes('Холостой прогон')))
})

test('фото с подозрительным переводом подписи не уходит', async () => {
  const caption = 'Это тебе, с днём рождения, дорогой друг!'
  const { deps, tg, conversation } = guarded({ [caption]: caption })
  const ok = await sendOwnerReply(
    deps,
    conversation,
    { text: caption, media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 911 },
    { outsideTopic: false },
  )
  assert.equal(ok, false)
  assert.equal(tg.sentAsOwner().length, 0)
})

test('проверка ответа получает направление outgoing, текст владельца, перевод и языки', async () => {
  const seen: ReviewInput[] = []
  const { deps, conversation } = prepared({
    overrides: {
      review: (input) => {
        seen.push(input)
        return { verdict: 'ok', rule: null, commands: false }
      },
    },
  })
  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.direction, 'outgoing')
  assert.equal(seen[0]!.original, 'Отлично, а ты?')
  assert.equal(seen[0]!.translation, '[en] Отлично, а ты?')
  assert.equal(seen[0]!.owner.code, 'ru')
  assert.equal(seen[0]!.target.code, 'en')
})

test('имя собеседника с «<» и «&» в причине «Не отправлено» экранировано', async () => {
  const { deps, tg, store } = prepared()
  const odd = store.createConversation({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, peerChatId: 200007, peerName: 'Tom & <b>Jerry</b>', lastPeerAt: deps.now() })
  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
  await sendOwnerReply(deps, odd, reply, { outsideTopic: false })
  const notice = tg.callsOf('sendText').at(-1)!
  assert.match(notice.text, /^<b>Не отправлено:<\/b> от Tom &amp; &lt;b&gt;Jerry&lt;\/b&gt; давно не было сообщений/)
})
