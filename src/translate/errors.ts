import type { Provider } from './providers.ts'

/** Перевод не удался — текст сообщения показывается владельцу как причина. */
export class TranslationError extends Error {
  /** Что сделать владельцу; нет — общий совет про ключ и баланс */
  readonly hint: string | undefined
  /** Сырой ответ провайдера — только для консоли, владельцу не показывается */
  readonly detail: string | undefined

  constructor(message: string, extra: { hint?: string; detail?: string } = {}) {
    super(message)
    this.name = 'TranslationError'
    this.hint = extra.hint
    this.detail = extra.detail
  }
}

/** Что о провайдере нужно тексту ошибки: имя, переменная с ключом и где ключ взять. */
export type ProviderInfo = Pick<Provider, 'label' | 'envKey' | 'keysUrl'>

/** Ошибка провайдера для владельца: что случилось и что сделать. */
type ProviderErrorText = { reason: string; hint: string }

type ErrorRow = {
  match: (status: number) => boolean
  text: (provider: ProviderInfo) => ProviderErrorText
}

/** Совет, когда код ответа ничего не говорит о причине. */
export const DEFAULT_HINT = 'Проверьте ключ и баланс у провайдера.'

/**
 * Код ответа провайдера → понятная причина и подсказка. Таблица, а не switch: новый код —
 * новая строка. Сырой ответ сюда не попадает: «User not found» покупателю ничего не скажет.
 */
const PROVIDER_ERRORS: readonly ErrorRow[] = [
  {
    match: (status) => status === 401,
    text: (p) => ({ reason: `${p.label}: ключ не подходит`, hint: `Проверьте ${p.envKey} в .env — ключ берут здесь: ${p.keysUrl}` }),
  },
  {
    match: (status) => status === 402,
    text: (p) => ({ reason: `${p.label}: на балансе закончились деньги`, hint: `Пополните баланс у ${p.label}.` }),
  },
  {
    match: (status) => status === 429,
    text: (p) => ({
      reason: `${p.label} просит подождать — слишком много запросов`,
      hint: 'Обычно это проходит само за минуту-другую.',
    }),
  },
  {
    match: (status) => status >= 500 && status < 600,
    text: (p) => ({ reason: `${p.label} временно не работает`, hint: 'Обычно это проходит само — подождите.' }),
  },
]

export function describeProviderError(provider: ProviderInfo, status: number): ProviderErrorText {
  const row = PROVIDER_ERRORS.find((candidate) => candidate.match(status))
  return row ? row.text(provider) : { reason: `${provider.label} ответил ошибкой ${status}`, hint: DEFAULT_HINT }
}
