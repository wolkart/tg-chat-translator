import { plural, roughly, spaced } from '../format.ts'
import type { ModelPrice } from './account.ts'

/**
 * Типичный размер одного перевода в токенах. Замер 2026-10-15: настоящий промпт переводчика
 * (`buildPrompt`) с историей из 10 реплик и сообщением в одно предложение, три запроса к
 * anthropic/claude-haiku-5.5 через OpenRouter, `usage` из ответа: входящее на русский —
 * 1426 на вход (с примерами), ответ на английский — 881, он же на «вы» — 997; на выход —
 * 26–42. Взято с запасом: оценка не должна обещать больше переводов, чем выйдет.
 */
export const TYPICAL_INPUT_TOKENS = 1200
export const TYPICAL_OUTPUT_TOKENS = 40

/** Примерная цена одного перевода, $. */
export function translationCost(price: Pick<ModelPrice, 'input' | 'output'>): number {
  return price.input * TYPICAL_INPUT_TOKENS + price.output * TYPICAL_OUTPUT_TOKENS
}

/**
 * Сколько переводов хватит на сумму. null — не посчитать: у бесплатной модели деление на ноль
 * дало бы «примерно NaN переводов» или бесконечность. Одна точка для предупреждений и экрана
 * баланса — иначе проверку забудут в одном из мест.
 */
export function translationsLeft(usd: number, price: Pick<ModelPrice, 'input' | 'output'>): number | null {
  const cost = translationCost(price)
  if (!(cost > 0)) return null
  const left = usd / cost
  return Number.isFinite(left) ? left : null
}

/**
 * «46 000 переводов» — сколько хватит на сумму, круглым числом: это оценка. null — не
 * посчитать (см. translationsLeft). Приставку («хватит примерно на», «это примерно») каждый
 * текст ставит свою.
 */
export function translationsPhrase(usd: number, price: Pick<ModelPrice, 'input' | 'output'>): string | null {
  const left = translationsLeft(usd, price)
  if (left === null) return null
  const n = roughly(left)
  return `${spaced(n)} ${plural(n, ['перевод', 'перевода', 'переводов'])}`
}
