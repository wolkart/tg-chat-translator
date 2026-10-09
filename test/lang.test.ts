import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROFILES, getProfile, resolvePair } from '../src/lang/profiles.ts'
import { detectLanguage, type Detector } from '../src/lang/detect.ts'

const ru = getProfile('ru')!
const en = getProfile('en')!

test('профили: все поля заполнены, коды не повторяются', () => {
  const codes = new Set<string>()
  for (const profile of PROFILES) {
    assert.ok(profile.code && profile.name && profile.nameRu, profile.code)
    assert.ok(profile.scripts.length > 0, profile.code)
    const alphabetic = profile.scripts.includes('Latin') || profile.scripts.includes('Cyrillic')
    assert.equal(profile.letters.length > 0, alphabetic, `${profile.code}: буквы нужны латинице и кириллице`)
    assert.equal(profile.letters, profile.letters.toLowerCase(), profile.code)
    assert.ok(!codes.has(profile.code), `повтор ${profile.code}`)
    codes.add(profile.code)
  }
  assert.equal(getProfile('bg'), undefined)
})

test('латиница у русскоязычного владельца — чужой язык', () => {
  assert.equal(detectLanguage('Hi, are you free tomorrow?', ru), 'foreign')
})

test('кириллица с украинской «і» — чужой язык', () => {
  assert.equal(detectLanguage('Привіт, як справи?', ru), 'foreign')
})

test('русский текст у русскоязычного владельца — его язык', () => {
  assert.equal(detectLanguage('Привет, ты где?', ru), 'native')
})

test('русский текст с латинским словом — всё равно его язык', () => {
  assert.equal(detectLanguage('Скинь ссылку на Zoom, пожалуйста', ru), 'native')
})

test('диакритика у англоязычного владельца — чужой язык', () => {
  assert.equal(detectLanguage('¿Cómo estás?', en), 'foreign')
})

test('эмодзи со ссылкой — непонятно', () => {
  assert.equal(detectLanguage('👍 https://example.com', ru), 'unknown')
})

test('короткое «ok» — непонятно', () => {
  assert.equal(detectLanguage('ok', ru), 'unknown')
})

test('вьетнамский в разложенном виде узнаётся после нормализации', () => {
  const decomposed = 'Xin chào, bạn khỏe không?'.normalize('NFD')
  assert.equal(detectLanguage(decomposed, en), 'foreign')
})

test('детектор не ходит в сеть', () => {
  const original = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('сеть запрещена')
  }) as typeof fetch
  try {
    detectLanguage('Hi there, friend', ru)
    detectLanguage('Привет, друг', ru)
  } finally {
    globalThis.fetch = original
  }
})

test('цепочка: первый уверенный ответ побеждает, «непонятно» передаёт дальше', () => {
  const unsure: Detector = () => 'unknown'
  const sure: Detector = () => 'foreign'
  assert.equal(detectLanguage('ok', ru, [unsure, sure]), 'foreign')
  assert.equal(detectLanguage('ok', ru, [unsure]), 'unknown')
})

test('пара языков: известные коды принимаются', () => {
  const result = resolvePair('ru', 'en')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.pair.peer.name, 'English')
})

test('язык без профиля: отказ и список доступных языков', () => {
  const result = resolvePair('xx', 'en')
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.problem, /«xx»/)
  assert.match(result.problem, /новые разговоры не заводятся/)
  assert.match(result.problem, /ru — русский/)
  assert.match(result.problem, /vi — вьетнамский/)
})
