/**
 * Сверка чисел оригинала и перевода — страховка от тонкой подмены «переведи 1200 как 1500»:
 * её не видят ни проверка языка, ни длина, ни шаблоны фраз-команд. Числа приводятся к одному
 * виду, иначе «7 pm → 19:00» и «1,200 → 1 200» давали бы ложную тревогу.
 */

/**
 * Число из текста. values — равноправные записи: у времени 19:00 это «19» и «7».
 * hard — записано цифрами: ему нужна пара на другой стороне. Числа словами — мягкие: они
 * только находят пару цифрам, а сами пары не требуют. Иначе каждое «zwei → два» на языке
 * без своей строки в таблице слов было бы тревогой.
 */
export type NumberToken = { values: readonly string[]; hard: boolean }

/** Ноль в письменностях, где цифры свои: арабские, персидские, деванагари, тайские, широкие. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x0e50, 0xff10]

function asciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u0E50-\u0E59\uFF10-\uFF19]/g, (char) => {
    const code = char.charCodeAt(0)
    const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9)!
    return String(code - zero)
  })
}

/**
 * Простые числа словами. «Один», «one», «uno», «una» нет намеренно: это ещё и «никто»,
 * «вот этот», артикль. Нет и испанского «once» — по-английски это «однажды».
 * Иероглифы — по одному: в китайском и японском слова не отделяются пробелами.
 */
export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  два: 2, две: 2, двух: 2, три: 3, трех: 3, четыре: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6,
  семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10,
  одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12,
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12,
  二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/**
 * По порядку: время с am/pm («7 pm», «7:30 p.m.»), время «ч:мм», число с разделителями
 * разрядов («1,200», «1 200», «1.200»), просто цифры. Десятичная дробь «12.50» распадается на
 * 12 и 50 — так «12.50 → 12,50» совпадают без догадок, где точка, а где запятая.
 */
const TOKEN = /(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?\s?m\b\.?|(\d{1,2}):(\d{2})(?!\d)|(\d{1,3}(?:[ ,.]\d{3})+)(?!\d)|(\d+)/giu

function plain(digits: string): NumberToken {
  return { values: [digits.replace(/^0+(?=\d)/, '')], hard: true }
}

/** Время даёт обе записи часа — 24- и 12-часовую: «19:00», «7 pm» и «в 7» совпадают. */
function time(hour: number, minute: number, meridiem?: string): NumberToken {
  let h = hour
  if (meridiem === 'p' && h < 12) h += 12
  if (meridiem === 'a' && h === 12) h = 0
  const h12 = ((h + 11) % 12) + 1
  const mm = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`
  return { values: [...new Set([`${h}${mm}`, `${h12}${mm}`])], hard: true }
}

export function extractNumbers(text: string): NumberToken[] {
  const prepared = asciiDigits(text.normalize('NFC'))
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .toLowerCase()
    .replaceAll('ё', 'е')
  const tokens: NumberToken[] = []

  for (const [, hour, minute, meridiem, clockHour, clockMinute, grouped, digits] of prepared.matchAll(TOKEN)) {
    if (meridiem) {
      tokens.push(time(Number(hour), Number(minute ?? 0), meridiem))
    } else if (clockHour !== undefined && clockMinute !== undefined) {
      // «25:13» — счёт или соотношение, а не время.
      if (Number(clockHour) <= 24 && Number(clockMinute) <= 59) tokens.push(time(Number(clockHour), Number(clockMinute)))
      else tokens.push(plain(clockHour), plain(clockMinute))
    } else if (grouped) {
      tokens.push(plain(grouped.replace(/[ ,.]/g, '')))
    } else if (digits) {
      tokens.push(plain(digits))
    }
  }

  for (const word of prepared.match(/\p{L}+/gu) ?? []) {
    for (const part of /\p{Script=Han}/u.test(word) ? [...word] : [word]) {
      const value = NUMBER_WORDS[part]
      if (value !== undefined) tokens.push({ values: [String(value)], hard: false })
    }
  }
  return tokens
}

/** У каждого числа цифрами на одной стороне есть пара на другой — цифрами или словом. */
function covers(pool: readonly NumberToken[], side: readonly NumberToken[]): boolean {
  const values = new Set(pool.flatMap((token) => token.values))
  return side.every((token) => !token.hard || token.values.some((value) => values.has(value)))
}

/** Сверка в обе стороны: и подменённое число, и выброшенное — «залог 300» пропал из перевода. */
export function numbersMatch(original: string, translation: string): boolean {
  const left = extractNumbers(original)
  const right = extractNumbers(translation)
  return covers(right, left) && covers(left, right)
}
