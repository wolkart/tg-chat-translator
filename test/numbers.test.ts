import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getProfile } from '../src/lang/profiles.ts'
import { reviewTranslation } from '../src/translate/check.ts'
import { extractNumbers, numbersMatch } from '../src/translate/numbers.ts'

const ru = getProfile('ru')!

test('спека: подменили сумму — числа не совпадают', () => {
  assert.equal(numbersMatch("I'm ready to pay 1200 euros per month", 'Я готов платить 1500 евро в месяц'), false)
  const review = reviewTranslation({
    direction: 'incoming',
    original: "I'm ready to pay 1200 euros per month",
    translation: 'Я готов платить 1500 евро в месяц',
    owner: ru,
    target: ru,
    history: [],
  })
  assert.deepEqual(review, { verdict: 'numbers', rule: 'числа', commands: false })
})

test('спека: время в другом формате — не подмена', () => {
  assert.equal(numbersMatch('See you at 7 pm', 'Увидимся в 19:00'), true)
  assert.equal(
    reviewTranslation({ direction: 'incoming', original: 'See you at 7 pm', translation: 'Увидимся в 19:00', owner: ru, target: ru, history: [] }).verdict,
    'ok',
  )
})

test('ответ владельца по числам не сверяется — он видит перевод в теме сам', () => {
  const review = reviewTranslation({
    direction: 'outgoing',
    original: 'Встреча 05.10 в 15:00',
    translation: 'Meeting on October 5 at 3 pm',
    owner: ru,
    target: getProfile('en')!,
    history: [],
  })
  assert.equal(review.verdict, 'ok')
})

test('время: 12 и 24 часа, am/pm, «в 7» и «в 19 часов»', () => {
  assert.equal(numbersMatch('at 7:30 p.m.', 'в 19:30'), true)
  assert.equal(numbersMatch('See you at 7', 'Увидимся в 19:00'), true)
  assert.equal(numbersMatch('Буду в 19 часов', 'I will be there at 7 pm'), true)
  assert.equal(numbersMatch('в 7 вечера', 'at 7 pm'), true)
  assert.equal(numbersMatch('12 pm', '12:00'), true)
  assert.equal(numbersMatch('12 am', '00:00'), true)
  assert.equal(numbersMatch('at 7 pm', 'в 20:00'), false)
  assert.equal(numbersMatch('Final score 25:13', 'Итоговый счёт 25:13'), true)
})

test('разделители разрядов: «1,200», «1 200», «1.200» и неразрывный пробел — одно число', () => {
  assert.equal(numbersMatch('1,200 euros', '1\u00A0200 евро'), true)
  assert.equal(numbersMatch('1.200 euros', '1200 евро'), true)
  assert.equal(numbersMatch('1,200 euros', '1\u00A0200 евро'), true)
  assert.equal(numbersMatch('12,345,678', '12 345 678'), true)
  assert.equal(numbersMatch('1,200', '1 300'), false)
})

test('дроби и даты: точка и запятая, порядок дня и месяца', () => {
  assert.equal(numbersMatch('$12.50', '12,50 $'), true)
  assert.equal(numbersMatch('10/11/2026', '10.11.2026'), true)
  assert.equal(numbersMatch('10/11/2026', '11.10.2026'), true)
  assert.equal(numbersMatch('10/11/2026', '10.12.2026'), false)
})

test('числа словами: «seven» и «7» совпадают; слово без пары тревоги не даёт', () => {
  assert.equal(numbersMatch('See you at seven', 'Увидимся в 7'), true)
  assert.equal(numbersMatch('Буду через пять минут', 'I will be there in 5 minutes'), true)
  assert.equal(numbersMatch('Ich komme in zwei Stunden', 'Я приду через два часа'), true)
  assert.equal(numbersMatch('三点见', 'Увидимся в 3'), true)
  assert.equal(numbersMatch('I need two', 'Мне нужно 7'), false)
  assert.equal(numbersMatch('no one came', 'никто не пришёл'), true)
  assert.equal(numbersMatch("I'll call you once I'm home", 'Позвоню, как только буду дома'), true)
})

test('выброшенное число — тоже несовпадение', () => {
  assert.equal(numbersMatch("I'll pay 1200, the deposit is 300", 'Я заплачу 1200'), false)
  assert.equal(numbersMatch('1200 euros', 'тысяча двести евро'), false)
})

test('цифры других письменностей и широкие цифры', () => {
  assert.equal(numbersMatch('٣ ساعات', '3 часа'), true)
  assert.equal(numbersMatch('１２００円', '1200 иен'), true)
  assert.equal(numbersMatch('५ बजे', 'в 5'), true)
})

test('степень и прочие значки — не цифры; без чисел — совпадение', () => {
  assert.equal(numbersMatch('50 m²', '50 кв. м'), true)
  assert.equal(numbersMatch('Hello there', 'Привет'), true)
  assert.equal(numbersMatch('iPhone 15 256GB', 'iPhone 15 256 ГБ'), true)
})

test('extractNumbers: цифры — жёсткие, слова — мягкие', () => {
  assert.deepEqual(extractNumbers('7 pm and seven'), [
    { values: ['19', '7'], hard: true },
    { values: ['7'], hard: false },
  ])
  assert.deepEqual(extractNumbers('007'), [{ values: ['7'], hard: true }])
})
