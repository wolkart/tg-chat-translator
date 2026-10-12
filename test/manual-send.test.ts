import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COPY_LIMIT,
  DRAFT_EXPIRED,
  FIRST_TEXT_ONLY,
  answerInline,
  manualKeyboard,
  newPeerDraft,
  newPeerHead,
  renderDraft,
  renderDraftFailed,
  renderSuspiciousDraft,
} from '../src/owner/manual-send.ts'
import { DRAFT_TTL } from '../src/store.ts'
import { reviewTranslation } from '../src/translate/check.ts'
import { TranslationError } from '../src/translate/llm.ts'
import type { OwnerPayload } from '../src/types.ts'
import { OWNER_ID } from './helpers.ts'
import { fakeTranslator, setupDeps } from './setup.ts'

const short = { id: 42, translation: "Hi! I'm writing about the apartment." }
const long = { id: 43, translation: 'word '.repeat(60).trim() }

test('спека: короткий перевод — зелёная «Отправить через бота» и «Скопировать» в двух строках', () => {
  assert.deepEqual(manualKeyboard(short, { inline: true, media: false }), [
    [{ text: 'Отправить через бота', chooseChat: '42', style: 'success' }],
    [{ text: 'Скопировать', copy: "Hi! I'm writing about the apartment." }],
  ])
})

test('спека: перевод длиннее 256 символов — без «Скопировать»', () => {
  assert.ok(long.translation.length > COPY_LIMIT)
  assert.deepEqual(manualKeyboard(long, { inline: true, media: false }), [
    [{ text: 'Отправить через бота', chooseChat: '43', style: 'success' }],
  ])
})

test('ровно 256 символов — «Скопировать» ещё есть', () => {
  const edge = { id: 44, translation: 'a'.repeat(COPY_LIMIT) }
  assert.equal(manualKeyboard(edge, { inline: false, media: false }).length, 1)
})

test('спека: Inline Mode выключен — одна «Скопировать»', () => {
  assert.deepEqual(manualKeyboard(short, { inline: false, media: false }), [[{ text: 'Скопировать', copy: short.translation }]])
})

test('подпись к вложению — одна «Скопировать»: через бота ушёл бы текст без вложения', () => {
  assert.deepEqual(manualKeyboard(short, { inline: true, media: true }), [[{ text: 'Скопировать', copy: short.translation }]])
})

test('перевод длиннее 4096 — без «Отправить через бота»: в одно сообщение не влезет', () => {
  assert.deepEqual(manualKeyboard({ id: 45, translation: 'a'.repeat(4097) }, { inline: true, media: false }), [])
})

test('спека: перевод для нового собеседника — заголовок с языком и перевод обычным текстом', () => {
  assert.deepEqual(renderDraft(newPeerHead('английский'), short.translation), [
    "<i>Перевод для нового собеседника (английский):</i>\nHi! I'm writing about the apartment.",
  ])
})

test('спека: длинный перевод — в блоке кода с подсказкой «Нажмите на перевод, чтобы скопировать»', () => {
  assert.deepEqual(renderDraft('<b>Заголовок</b>', long.translation), [
    `<b>Заголовок</b>\n<i>Нажмите на перевод, чтобы скопировать:</i>\n<pre>${long.translation}</pre>`,
  ])
})

test('очень длинный перевод — по сообщению на кусок, подсказка в первом', () => {
  const parts = renderDraft('<b>З</b>', 'слово '.repeat(1500))
  assert.ok(parts.length >= 3)
  assert.ok(parts[0]!.startsWith('<b>З</b>\n<i>Нажмите на перевод'))
  for (const part of parts) assert.ok(part.length <= 4096 && part.includes('<pre>'))
})

test('перевод с «<b>» и «&» экранирован и не становится разметкой', () => {
  assert.deepEqual(renderDraft('<i>З</i>', 'Tom & <b>Jerry</b>'), ['<i>З</i>\nTom &amp; &lt;b&gt;Jerry&lt;/b&gt;'])
})

test('длинный перевод с «</pre>» и «&» — экранирован, блок кода не ломается', () => {
  const tricky = `${'x '.repeat(140)}</pre><b>&`
  const [html] = renderDraft('<b>З</b>', tricky)
  assert.ok(html!.endsWith('&lt;/pre&gt;&lt;b&gt;&amp;</pre>'))
  assert.equal(html!.match(/<\/pre>/g)!.length, 1)
})

test('спека: подозрительный перевод — с пометкой, без кнопок; не удался — причина', () => {
  assert.deepEqual(renderSuspiciousDraft('Привет <3'), [
    '<i>⚠️ Перевод выглядит подозрительно — отправлять его не предлагаю</i>\nПривет &lt;3',
  ])
  assert.deepEqual(renderDraftFailed('OpenRouter: ключ не подходит'), ['<i>Перевод не удался: OpenRouter: ключ не подходит</i>'])
})

const hello: OwnerPayload = { text: 'Привет! Я по поводу квартиры', media: null, sourceMessageId: 903 }
const apartment = fakeTranslator(() => "Hi! I'm writing about the apartment.")

test('спека: написать первым — перевод на язык собеседника без истории, ответом на сообщение, с кнопками', async () => {
  const translator = fakeTranslator(() => "Hi! I'm writing about the apartment.")
  const { deps, tg, store } = setupDeps({ overrides: { translator: translator.translate } })
  await newPeerDraft(deps, hello)

  assert.equal(translator.calls[0]!.target.code, 'en')
  assert.deepEqual(translator.calls[0]!.history, [])
  assert.equal(tg.sentAsOwner().length, 0)

  const [reply] = tg.callsOf('sendText')
  assert.equal(reply!.chatId, OWNER_ID)
  assert.equal(reply!.opts.replyTo, 903)
  assert.equal(reply!.opts.threadId, undefined)
  assert.equal(reply!.text, "<i>Перевод для нового собеседника (английский):</i>\nHi! I'm writing about the apartment.")
  const draftId = Number(reply!.opts.keyboard![0]![0]!.chooseChat)
  assert.deepEqual(store.getDraft(OWNER_ID, draftId, deps.now()), {
    id: draftId,
    ownerId: OWNER_ID,
    conversationId: null,
    original: 'Привет! Я по поводу квартиры',
    translation: "Hi! I'm writing about the apartment.",
    createdAt: deps.now(),
  })
  assert.equal(reply!.opts.keyboard![1]![0]!.copy, "Hi! I'm writing about the apartment.")
})

test('спека: Inline Mode выключен — перевод с одной «Скопировать»', async () => {
  const { deps, tg } = setupDeps({ overrides: { translator: apartment.translate, inlineEnabled: async () => false } })
  await newPeerDraft(deps, hello)
  assert.deepEqual(tg.callsOf('sendText')[0]!.opts.keyboard, [[{ text: 'Скопировать', copy: "Hi! I'm writing about the apartment." }]])
})

test('спека: холостой прогон — перевод с кнопками как обычно', async () => {
  const { deps, tg } = setupDeps({ overrides: { translator: apartment.translate, dry: true } })
  await newPeerDraft(deps, hello)
  assert.equal(tg.callsOf('sendText')[0]!.opts.keyboard!.length, 2)
})

test('спека: первым — только текст: вложение не переводится', async () => {
  const translator = fakeTranslator()
  const { deps, tg } = setupDeps({ overrides: { translator: translator.translate } })
  await newPeerDraft(deps, { text: 'Это тебе', media: { kind: 'photo', fileId: 'P' }, sourceMessageId: 904 })
  assert.equal(translator.calls.length, 0)
  assert.deepEqual(
    tg.callsOf('sendText').map((call) => [call.text, call.opts.replyTo]),
    [[FIRST_TEXT_ONLY, 904]],
  )
  assert.equal(FIRST_TEXT_ONLY, 'Первым бот отправляет только текст — вложение отправьте собеседнику в личке сами.')
})

test('спека: модель недоступна — «Перевод не удался: <причина>» без кнопок, перевод не сохраняется', async () => {
  const failing = fakeTranslator(() => {
    throw new TranslationError('OpenRouter временно не работает', { hint: 'Обычно это проходит само — подождите.' })
  })
  const { deps, tg } = setupDeps({ overrides: { translator: failing.translate } })
  await newPeerDraft(deps, hello)
  const reply = tg.callsOf('sendText').find((call) => call.opts.replyTo === 903)!
  assert.equal(reply.text, '<i>Перевод не удался: OpenRouter временно не работает</i>')
  assert.equal(reply.opts.keyboard, undefined)
  assert.ok(tg.callsOf('sendText').some((call) => call.text.startsWith('Модель не переводит: OpenRouter временно не работает')))
})

test('нет ключа модели — причина без кнопок', async () => {
  const { deps, tg } = setupDeps({ overrides: { translator: null, translatorProblem: 'Нет ключа модели — переводить нечем.' } })
  await newPeerDraft(deps, hello)
  assert.equal(tg.callsOf('sendText')[0]!.text, '<i>Перевод не удался: Нет ключа модели — переводить нечем.</i>')
})

test('спека: ответ модели не на языке собеседника — пометка и никаких кнопок', async () => {
  const echo = fakeTranslator((request) => request.text)
  const { deps, tg, store } = setupDeps({ overrides: { translator: echo.translate, review: reviewTranslation } })
  await newPeerDraft(deps, { ...hello, text: 'Хорошо, созвонимся вечером и всё обсудим.' })
  const [reply] = tg.callsOf('sendText')
  assert.equal(reply!.text, '<i>⚠️ Перевод выглядит подозрительно — отправлять его не предлагаю</i>\nХорошо, созвонимся вечером и всё обсудим.')
  assert.equal(reply!.opts.keyboard, undefined)
  assert.equal(store.findDraftByTranslation(OWNER_ID, 'Хорошо, созвонимся вечером и всё обсудим.', deps.now()), undefined)
})

test('inline-запрос с номером живого перевода — один вариант, перевод обычным текстом', async () => {
  const { deps, tg, store } = setupDeps()
  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi <there> & bye', now: deps.now() })
  await answerInline(deps, { id: 'Q1', query: String(draft.id) })
  assert.deepEqual(tg.callsOf('answerInline'), [
    {
      method: 'answerInline',
      queryId: 'Q1',
      articles: [{ id: String(draft.id), title: 'Hi <there> & bye', description: 'Нажмите — уйдёт от вашего имени', text: 'Hi <there> & bye' }],
    },
  ])
})

test('заголовок варианта — первая строка перевода, длинная обрезается', async () => {
  const { deps, tg, store } = setupDeps()
  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'x', translation: `${'a'.repeat(100)}\nвторая`, now: deps.now() })
  await answerInline(deps, { id: 'Q', query: String(draft.id) })
  const title = tg.callsOf('answerInline')[0]!.articles[0]!.title
  assert.equal(title.length, 64)
  assert.ok(title.endsWith('…'))
})

test('спека: перевод устарел — вариантов нет, кнопка «Перевод устарел — напишите заново»', async () => {
  const { deps, tg, store, advance } = setupDeps()
  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi', now: deps.now() })
  advance(DRAFT_TTL + 1)
  await answerInline(deps, { id: 'Q2', query: String(draft.id) })
  assert.deepEqual(tg.callsOf('answerInline'), [
    { method: 'answerInline', queryId: 'Q2', articles: [], button: { text: DRAFT_EXPIRED, startParameter: 'draft' } },
  ])
})

test('чужой номер, пустой и мусорный запрос — тоже без вариантов', async () => {
  const { deps, tg, store } = setupDeps()
  const foreign = store.createDraft({ ownerId: 100002, conversationId: null, original: 'x', translation: 'secret', now: deps.now() })
  for (const query of [String(foreign.id), '', 'hello', '1e3', '99999999999999999999']) {
    await answerInline(deps, { id: 'Q', query })
  }
  assert.ok(tg.callsOf('answerInline').every((call) => call.articles.length === 0))
})
