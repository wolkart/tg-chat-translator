import type { Alerts } from './alerts.ts'
import type { Topics } from './owner/topics.ts'
import type { Config } from './settings.ts'
import type { Store } from './store.ts'
import type { BotInfo, TelegramApi } from './telegram.ts'
import type { Accounts } from './translate/account.ts'
import type { Reviewer } from './translate/check.ts'

/** Почему переводчика нет: причина из настройки или общая фраза. Один текст для всех мест показа. */
export function translatorUnavailable(config: Config): string {
  return config.translatorProblem ?? config.languagesProblem ?? 'переводчик не настроен'
}

/**
 * Всё, что нужно каналам и стороне владельца. Собирается в main.ts,
 * в тестах — из подделок (test/setup.ts).
 */
export type Deps = {
  api: TelegramApi
  store: Store
  alerts: Alerts
  topics: Topics
  /** Владелец из .env — пока единственный, чей аккаунт обслуживаем */
  ownerId: number
  botId: number
  /** Настройки владельца в момент вызова: панель меняет их без перезапуска */
  config: (ownerId: number) => Config
  /** Проверка ответа модели до показа владельцу и до отправки собеседнику */
  review: Reviewer
  /** Включён ли Inline Mode в BotFather: без него у перевода нет кнопки «Отправить через бота» */
  inlineEnabled: () => Promise<boolean>
  /** Свежий getMe из панели: проверка Inline Mode узнаёт и о выключении */
  onBotInfo: (me: BotInfo) => void
  /** Счета провайдеров: остаток, цены, проверка ключа */
  accounts: Accounts
  /** Холостой прогон: собеседнику ничего не уходит */
  dry: boolean
  now: () => number
}
