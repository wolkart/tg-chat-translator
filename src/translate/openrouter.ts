import {
  ACCOUNT_TIMEOUT_MS,
  forbiddenReason,
  type Balance,
  type Http,
  type KeyCheck,
  type ModelPrice,
  type ProviderAccount,
} from './account.ts'

const API = 'https://openrouter.ai/api/v1'

/** Цены меняются редко, а список моделей OpenRouter — сотни записей: хватит раза в час. */
export const PRICES_TTL_MS = 60 * 60 * 1000

type Json = Record<string, unknown>

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function timeOrNull(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/** Объект data из ответа или null: разбор терпит любые пропуски — хуже «не узнать» он не ошибается. */
async function dataOf(response: Response): Promise<Json | null> {
  try {
    const body = (await response.json()) as { data?: unknown }
    return body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? (body.data as Json) : null
  } catch {
    return null
  }
}

/**
 * Баланс из ответов /key и /credits. Остаток — меньшее из того, что известно: у ключа может
 * быть свой лимит трат, у счёта — свой баланс, и перевод встаёт, когда кончилось любое.
 */
export function toBalance(key: Json, credits: Json | null, creditsStatus: number | null): Balance {
  const keyLeft = key.limit === null ? null : numberOrNull(key.limit_remaining)
  const total = numberOrNull(credits?.total_credits)
  const used = numberOrNull(credits?.total_usage)
  const account = total !== null && used !== null ? total - used : null
  const known = [account, keyLeft].filter((value): value is number => value !== null)
  return {
    remaining: known.length > 0 ? Math.min(...known) : null,
    account,
    accountHidden: creditsStatus === 403,
    keyLeft,
    spentToday: numberOrNull(key.usage_daily),
    spentMonth: numberOrNull(key.usage_monthly),
    expiresAt: timeOrNull(key.expires_at),
  }
}

/**
 * Цена за токен — строка из /models. Пустая, null и «-1» (так OpenRouter помечает роутеры:
 * цена зависит от того, куда уйдёт запрос) — не цена. Number(null) и Number('') дают 0, и
 * без этой проверки модель стала бы бесплатной.
 */
function priceOrNull(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const price = Number(value)
  return Number.isFinite(price) && price >= 0 ? price : null
}

/** Цены из /models: за токен, как их отдаёт OpenRouter, и дата ухода модели. */
export function toPrices(data: unknown): Map<string, ModelPrice> {
  const prices = new Map<string, ModelPrice>()
  if (!Array.isArray(data)) return prices
  for (const item of data as Json[]) {
    const pricing = (item.pricing ?? {}) as Json
    const input = priceOrNull(pricing.prompt)
    const output = priceOrNull(pricing.completion)
    if (typeof item.id !== 'string' || input === null || output === null) continue
    prices.set(item.id, { input, output, expiresAt: timeOrNull(item.expiration_date) })
  }
  return prices
}

/**
 * Счёт OpenRouter:
 * - ключ проверяется через /key — /models открыт без ключа и принял бы любую строку;
 * - баланс счёта (/credits) по документации требует ключ управления, а на деле (2026-10-15)
 *   отдаётся и обычному ключу. Если OpenRouter начнёт отказывать (403), остаток считается
 *   по лимиту ключа с пометкой, что счёт не виден.
 */
export function createOpenRouterAccount(http: Http): ProviderAccount {
  let cached: { at: number; prices: Map<string, ModelPrice> } | null = null

  async function get(path: string, key?: string): Promise<Response | null> {
    try {
      return await http.fetchImpl(`${API}${path}`, {
        ...(key && { headers: { authorization: `Bearer ${key}` } }),
        signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
      })
    } catch {
      return null
    }
  }

  async function check(key: string): Promise<KeyCheck> {
    const [keyResponse, creditsResponse] = await Promise.all([get('/key', key), get('/credits', key)])
    if (!keyResponse) return { verdict: 'unknown', reason: 'нет связи с OpenRouter' }
    if (keyResponse.status === 401) return { verdict: 'rejected' }
    if (keyResponse.status === 403) return { verdict: 'unknown', reason: forbiddenReason('OpenRouter') }
    const data = keyResponse.ok ? await dataOf(keyResponse) : null
    if (!data) return { verdict: 'unknown', reason: `OpenRouter ответил ошибкой ${keyResponse.status}` }
    const credits = creditsResponse?.ok ? await dataOf(creditsResponse) : null
    return { verdict: 'ok', balance: toBalance(data, credits, creditsResponse?.status ?? null) }
  }

  return {
    verify: check,
    async balance(key) {
      const result = await check(key)
      return result.verdict === 'ok' ? result.balance : null
    },
    async prices() {
      if (cached && http.now() - cached.at < PRICES_TTL_MS) return cached.prices
      // Неудачу не кэшируем: следующий показ панели спросит снова.
      const response = await get('/models')
      if (!response?.ok) return null
      let body: { data?: unknown }
      try {
        body = (await response.json()) as { data?: unknown }
      } catch {
        return null
      }
      const prices = toPrices(body.data)
      cached = { at: http.now(), prices }
      return prices
    },
  }
}
