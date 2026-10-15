/**
 * Числа и даты для текстов владельцу: деньги с запятой, склонение, круглые «примерно».
 * Пробелы в числах — обычные, без неразрывных: невидимый символ легко потерять при правке.
 */

/** Деньги: «$6,53», мелочь — двумя значащими цифрами: «$0,00014». */
export function money(usd: number): string {
  if (usd < 0) return `-${money(-usd)}`
  if (usd === 0) return '$0'
  if (usd >= 0.01) return `$${usd.toFixed(2).replace('.', ',')}`
  const decimals = Math.min(10, 1 - Math.floor(Math.log10(usd)))
  return `$${usd.toFixed(decimals).replace(/0+$/, '').replace('.', ',')}`
}

/** Склонение: plural(5, ['перевод', 'перевода', 'переводов']) → «переводов». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const tens = Math.abs(n) % 100
  const units = tens % 10
  if (tens >= 11 && tens <= 14) return forms[2]
  if (units === 1) return forms[0]
  if (units >= 2 && units <= 4) return forms[1]
  return forms[2]
}

/** «50000» → «50 000». */
export function spaced(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Округление вниз до двух значащих цифр: «примерно 43 000», а не «43 217» — это оценка. */
export function roughly(n: number): number {
  if (n < 100) return Math.max(0, Math.floor(n))
  const magnitude = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.floor(n / magnitude) * magnitude
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** «16 октября» — по UTC: так OpenRouter отдаёт сроки, и так же сервер в Docker считает время. */
export function dayMonth(ms: number): string {
  const date = new Date(ms)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** Дата по UTC, «2026-10-15»: метка «сегодня уже предупреждали». */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
