import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COPY_LIMIT,
  manualKeyboard,
  newPeerHead,
  renderDraft,
  renderDraftFailed,
  renderSuspiciousDraft,
} from '../src/owner/manual-send.ts'

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
