import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dayMonth, money, plural, roughly, spaced, utcDay } from '../src/format.ts'
import { TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS, translationCost, translationsLeft } from '../src/translate/cost.ts'
import { toPrices } from '../src/translate/openrouter.ts'

test('деньги: с запятой, мелочь — двумя значащими цифрами', () => {
  assert.equal(money(6.5299), '$6,53')
  assert.equal(money(9.80092978), '$9,80')
  assert.equal(money(0.84), '$0,84')
  assert.equal(money(0.14), '$0,14')
  assert.equal(money(0.00014), '$0,00014')
  assert.equal(money(0.005), '$0,005')
  assert.equal(money(0), '$0')
  assert.equal(money(-0.5), '-$0,50')
})

test('склонение: 1, 2, 5, 11, 21, 0 и 111 переводов', () => {
  const forms = ['перевод', 'перевода', 'переводов'] as const
  const cases: [number, string][] = [
    [1, 'перевод'],
    [2, 'перевода'],
    [5, 'переводов'],
    [11, 'переводов'],
    [14, 'переводов'],
    [21, 'перевод'],
    [22, 'перевода'],
    [0, 'переводов'],
    [111, 'переводов'],
  ]
  for (const [n, form] of cases) assert.equal(plural(n, forms), form, String(n))
})

test('«примерно»: две значащие цифры вниз, пробелы между разрядами', () => {
  assert.equal(roughly(43217), 43000)
  assert.equal(roughly(6464), 6400)
  assert.equal(roughly(950), 950)
  assert.equal(roughly(99.9), 99)
  assert.equal(roughly(-3), 0)
  assert.equal(spaced(50000), '50 000')
  assert.equal(spaced(1234567), '1 234 567')
  assert.equal(spaced(950), '950')
})

test('дата: «16 октября» и метка дня — по UTC', () => {
  const at = Date.parse('2026-10-16T20:04:00.002Z')
  assert.equal(dayMonth(at), '16 октября')
  assert.equal(dayMonth(Date.parse('2026-01-01T00:00:00Z')), '1 января')
  assert.equal(utcDay(at), '2026-10-16')
})

test('цена перевода у Haiku по ценам из образца — как посчитано вручную', () => {
  const sample = JSON.parse(readFileSync(new URL('./fixtures/openrouter-models.json', import.meta.url), 'utf8')) as { data: unknown }
  const haiku = toPrices(sample.data).get('anthropic/claude-haiku-5.5')!
  // $0,10 и $0,50 за миллион: 1200 × 0,0000001 + 40 × 0,0000005 = 0,00012 + 0,00002
  assert.equal(TYPICAL_INPUT_TOKENS, 1200)
  assert.equal(TYPICAL_OUTPUT_TOKENS, 40)
  assert.equal(money(translationCost(haiku)), '$0,00014')
  assert.equal(money(translationCost(haiku) * 1000), '$0,14')
})

test('сколько переводов хватит: бесплатная или битая цена — не посчитать', () => {
  const haiku = { input: 0.0000001, output: 0.0000005 }
  assert.equal(translationsLeft(0.84, haiku), 0.84 / translationCost(haiku))
  assert.equal(translationsLeft(0, haiku), 0)
  assert.equal(translationsLeft(0.84, { input: 0, output: 0 }), null)
  assert.equal(translationsLeft(0, { input: 0, output: 0 }), null)
  assert.equal(translationsLeft(0.84, { input: Number.NaN, output: 0 }), null)
  assert.equal(translationsLeft(0.84, { input: -0.000001, output: 0 }), null)
  assert.equal(translationsLeft(Number.POSITIVE_INFINITY, haiku), null)
})
