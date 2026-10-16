import type { Deps } from '../deps.ts'
import { dayMonth, money, utcDay } from '../format.ts'
import { DAY, HOUR, warnedSetting } from '../store.ts'
import { describeError } from '../telegram.ts'
import type { Balance, ModelPrice } from '../translate/account.ts'
import { translationsPhrase } from '../translate/cost.ts'
import type { KeySource, Provider, ReadyModel } from '../translate/providers.ts'

/** За сколько предупреждать: ключ — за 3 дня, модель — за 14, деньги — когда меньше $1. */
export const KEY_EXPIRY_MS = 3 * DAY
export const MODEL_LEAVING_MS = 14 * DAY
export const LOW_BALANCE_USD = 1

/**
 * Как часто проверять. Чаще суток нарочно: интервал в 24 часа, запущенный в 23:00, перешагнул
 * бы следующий день. Повторов это не даёт — каждое предупреждение уходит раз в сутки.
 */
export const WARNINGS_INTERVAL_MS = 6 * HOUR

export type WarningInput = {
  provider: Provider
  keySource: KeySource
  modelTitle: string
  balance: Balance | null
  price: ModelPrice | undefined
  now: number
}

/** Вход предупреждений из модели, которая переводит, и счёта её провайдера: одна сборка для лички и экрана баланса. */
export function warningInput(
  model: ReadyModel,
  balance: Balance | null,
  prices: ReadonlyMap<string, ModelPrice> | null,
  now: number,
): WarningInput {
  return {
    provider: model.provider,
    keySource: model.keySource,
    modelTitle: model.title,
    balance,
    price: prices?.get(model.model),
    now,
  }
}

/** Предупреждение — строка реестра: вид (для «сегодня уже было») и текст, null — повода нет. */
export type AccountWarning = { kind: string; text(input: WarningInput): string | null }

/** «— это примерно 6 000 переводов»; цены нет или перевод не посчитать — без этой части. */
function leftPart(usd: number, price: ModelPrice | undefined): string {
  const phrase = price ? translationsPhrase(usd, price) : null
  return phrase ? ` — это примерно ${phrase}` : ''
}

const KEY_EXPIRY: AccountWarning = {
  kind: 'key-expiry',
  text({ provider, keySource, balance, now }) {
    const at = balance?.expiresAt
    if (at === null || at === undefined || at - now > KEY_EXPIRY_MS) return null
    // Ключ из .env панель не заменит: он главнее, и подсказка ведёт туда, где его меняют.
    const how =
      keySource === 'env'
        ? `впишите его в .env вместо старого (${provider.envKey}) и перезапустите бота`
        : 'вставьте его: /start → 🔑 Ключ'
    return `Ключ ${provider.label} истекает ${dayMonth(at)} — после этого переводы остановятся. Выпустите новый ключ: ${provider.keysUrl} — и ${how}.`
  },
}

const LOW_BALANCE: AccountWarning = {
  kind: 'low-balance',
  text({ provider, balance, price }) {
    if (!balance || balance.remaining === null || balance.remaining >= LOW_BALANCE_USD) return null
    // Кончается лимит ключа, а не деньги на счёте — пополнять счёт бесполезно.
    if (balance.keyLeft !== null && (balance.account === null || balance.keyLeft < balance.account)) {
      return `У ключа ${provider.label} до лимита осталось ${money(balance.keyLeft)}${leftPart(balance.keyLeft, price)}. Поднимите лимит ключа или выпустите новый: ${provider.keysUrl}`
    }
    return `На ${provider.label} осталось ${money(balance.remaining)}${leftPart(balance.remaining, price)}. Пополните баланс: ${provider.topUpUrl ?? provider.keysUrl}`
  },
}

const MODEL_LEAVING: AccountWarning = {
  kind: 'model-leaving',
  text({ provider, modelTitle, price, now }) {
    const at = price?.expiresAt
    if (at === null || at === undefined || at - now > MODEL_LEAVING_MS) return null
    return `${provider.label} уберёт модель ${modelTitle} ${dayMonth(at)} — после этого переводы остановятся. Выберите другую: /start → 🤖 Модель.`
  },
}

/** Реестр предупреждений: и в личку владельцу, и на экран баланса. */
export const ACCOUNT_WARNINGS: readonly AccountWarning[] = [KEY_EXPIRY, LOW_BALANCE, MODEL_LEAVING]

export function warningTexts(input: WarningInput): string[] {
  return ACCOUNT_WARNINGS.flatMap((warning) => warning.text(input) ?? [])
}

/**
 * Проверка у провайдера: срок ключа, остаток, дата ухода модели. Каждое предупреждение — не
 * чаще раза в сутки, и через перезапуски тоже: день по UTC лежит в базе. Не дошло до
 * владельца — не считается отправленным, следующая проверка попробует снова.
 */
export async function checkWarnings(deps: Deps, ownerId: number): Promise<void> {
  const { model } = deps.config(ownerId)
  if (!model.ok) return
  const account = deps.accounts.of(model.provider)
  if (!account) return
  const [balance, prices] = await Promise.all([account.balance(model.apiKey), account.prices()])
  const input = warningInput(model, balance, prices, deps.now())
  const today = utcDay(input.now)
  for (const warning of ACCOUNT_WARNINGS) {
    const text = warning.text(input)
    if (!text) continue
    const key = warnedSetting(warning.kind)
    if (deps.store.getSetting(ownerId, key) === today) continue
    if (await deps.alerts.notify(text)) deps.store.setSetting(ownerId, key, today)
  }
}

/**
 * При старте и дальше каждые 6 часов. Сбой проверки — строка в консоль, бот работает дальше.
 * Возвращает остановку: уснувшая копия (её место занял другой запуск) не должна слать
 * предупреждения по своей старой базе.
 */
export function scheduleWarnings(deps: Deps, ownerId: number): () => void {
  const run = () =>
    checkWarnings(deps, ownerId).catch((error: unknown) => deps.alerts.log(`предупреждения не проверены: ${describeError(error)}`))
  void run()
  const timer = setInterval(run, WARNINGS_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}
