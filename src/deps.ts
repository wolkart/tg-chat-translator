import type { Alerts } from './alerts.ts'
import type { LanguagePair } from './lang/profiles.ts'
import type { Topics } from './owner/topics.ts'
import type { Store } from './store.ts'
import type { TelegramApi } from './telegram.ts'
import type { Translator } from './translate/llm.ts'

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
  /** null — язык без профиля: новые разговоры не заводятся */
  languages: LanguagePair | null
  languagesProblem: string | null
  /** null — нет ключа модели: входящие показываются без перевода */
  translator: Translator | null
  translatorProblem: string | null
  /** Для статуса: «OpenRouter · openai/gpt-4.1-mini» или причина, почему модели нет */
  translatorInfo: string
  /** Холостой прогон: собеседнику ничего не уходит */
  dry: boolean
  now: () => number
}
