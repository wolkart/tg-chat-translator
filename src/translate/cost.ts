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
