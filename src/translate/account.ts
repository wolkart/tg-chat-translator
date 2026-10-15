import type { Provider } from './providers.ts'

/**
 * Счёт у провайдера модели: остаток, траты, цены и срок ключа. Видит его бот не у всех
 * провайдеров — у кого видит, у того в таблице провайдеров есть поле account.
 */

/** Сеть для запросов к провайдеру: в тестах подменяется. */
export type Http = { fetchImpl: typeof fetch; now: () => number }

export type Balance = {
  /** Сколько реально можно потратить: меньшее из баланса счёта и остатка до лимита ключа; null — не узнать */
  remaining: number | null
  /** Баланс счёта; null — не узнать */
  account: number | null
  /** Счёт этим ключом не виден: провайдер отказал (403) */
  accountHidden: boolean
  /** Сколько осталось до лимита ключа; null — лимита нет */
  keyLeft: number | null
  /** Траты ключа за сегодня и за месяц (у OpenRouter — по UTC) */
  spentToday: number | null
  spentMonth: number | null
  /** Срок ключа, мс; null — бессрочный */
  expiresAt: number | null
}

/** Цена модели за один токен, $, и когда провайдер её уберёт (мс; null — не собирается). */
export type ModelPrice = { input: number; output: number; expiresAt: number | null }

/** Итог проверки ключа: принят (с балансом, если провайдер его отдаёт), не принят или не проверить. */
export type KeyCheck = { verdict: 'ok'; balance: Balance | null } | { verdict: 'rejected' } | { verdict: 'unknown'; reason: string }

export type ProviderAccount = {
  /** Своя проверка ключа; нет — общая, по списку моделей */
  verify?(key: string): Promise<KeyCheck>
  /** null — не узнать: нет связи или ключ не принят */
  balance(key: string): Promise<Balance | null>
  /** Цены моделей по id; null — не узнать */
  prices(): Promise<ReadonlyMap<string, ModelPrice> | null>
}

/** Сколько ждать провайдера на служебных запросах: дольше владелец ждать панель не станет. */
export const ACCOUNT_TIMEOUT_MS = 10_000

/**
 * Общая проверка ключа для OpenAI-совместимых провайдеров: список моделей с этим ключом.
 * Принят — 2xx, не принят — 401 и 403, остальное — «не проверить». У OpenRouter так нельзя:
 * его список моделей открыт без ключа и примет любую строку, поэтому у него своя проверка.
 */
export async function checkKeyByModels(provider: Provider, key: string, baseUrl: string, http: Http): Promise<KeyCheck> {
  let response: Response
  try {
    response = await http.fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
    })
  } catch {
    return { verdict: 'unknown', reason: `нет связи с ${provider.label}` }
  }
  if (response.ok) return { verdict: 'ok', balance: null }
  if (response.status === 401 || response.status === 403) return { verdict: 'rejected' }
  return { verdict: 'unknown', reason: `${provider.label} ответил ошибкой ${response.status}` }
}

/** Счета провайдеров и проверка ключа — одна точка для панели и предупреждений. */
export type Accounts = {
  verify(provider: Provider, key: string, baseUrl: string): Promise<KeyCheck>
  /** undefined — счёт этого провайдера бот не видит */
  of(provider: Provider): ProviderAccount | undefined
}

/**
 * Счета создаются один раз: у счёта OpenRouter свой кэш цен, и он должен жить между
 * показами панели.
 */
export function createAccounts(providers: readonly Provider[], http: Http): Accounts {
  const accounts = new Map(
    providers.flatMap((provider) => (provider.account ? [[provider.id, provider.account(http)] as const] : [])),
  )
  return {
    async verify(provider, key, baseUrl) {
      const own = accounts.get(provider.id)?.verify
      return own ? own(key) : checkKeyByModels(provider, key, baseUrl, http)
    },
    of(provider) {
      return accounts.get(provider.id)
    },
  }
}
