import type { Alerts } from './alerts.ts'
import { resolvePair } from './lang/profiles.ts'
import { LANGUAGE_DEFAULTS, SETTING, type Store } from './store.ts'
import type { BotInfo, TelegramApi } from './telegram.ts'
import { resolveModel } from './translate/providers.ts'

export const BUSINESS_MODE_OFF =
  'В BotFather выключен Business Mode — без него бот не видит вашу личку. ' +
  'Откройте @BotFather → /mybots → этот бот → Bot Settings → Business Mode → Turn on.'

export const TOPICS_OFF =
  'В BotFather выключен Threaded Mode — без него бот не может завести темы для собеседников. ' +
  'Откройте @BotFather → /mybots → этот бот → Bot Settings → Threaded Mode → Turn on.'

export const INLINE_OFF =
  'В BotFather выключен Inline Mode — без него не работает кнопка «Отправить через бота». ' +
  'Откройте @BotFather → /mybots → этот бот → Bot Settings → Inline Mode → Turn on.'

/** Как часто переспрашивать Telegram, пока Inline Mode выключен: владелец мог включить его в BotFather. */
export const INLINE_RECHECK_MS = 60 * 1000

/**
 * Включён ли Inline Mode. Включённый не перепроверяем. Выключенный переспрашиваем у Telegram,
 * но не чаще раза в минуту: так включение в BotFather бот замечает без перезапуска, а
 * лишних запросов на каждый перевод нет.
 */
export function createInlineCheck(deps: { api: TelegramApi; initial: boolean; now: () => number }): () => Promise<boolean> {
  let enabled = deps.initial
  // Стартовый getMe только что был — первый повтор не раньше чем через минуту.
  let checkedAt = deps.now()
  return async () => {
    if (enabled) return true
    if (deps.now() - checkedAt < INLINE_RECHECK_MS) return false
    checkedAt = deps.now()
    try {
      enabled = (await deps.api.getMe()).supportsInlineQueries
    } catch {
      // Сеть моргнула — считаем, что по-прежнему выключено, спросим через минуту.
    }
    return enabled
  }
}

/** Языки и модель из базы. Вынесено из main.ts, чтобы выбор на старте покрывался тестами. */
export function loadSettings(
  store: Store,
  ownerId: number,
  env: { providerKeys: Record<string, string>; localBaseUrl?: string },
) {
  const pair = resolvePair(
    store.getSetting(ownerId, SETTING.ownerLang) ?? LANGUAGE_DEFAULTS[SETTING.ownerLang]!,
    store.getSetting(ownerId, SETTING.peerLang) ?? LANGUAGE_DEFAULTS[SETTING.peerLang]!,
  )
  const model = resolveModel(
    { provider: store.getSetting(ownerId, SETTING.provider), model: store.getSetting(ownerId, SETTING.model) },
    env,
  )
  return { pair, model }
}

/**
 * Проверки при старте: всё, без чего этот шаг не работает, владелец узнаёт сразу
 * и понятным текстом, а не по молчанию бота. Полная самопроверка с панелью — позже.
 */
export async function startupChecks(input: {
  me: BotInfo
  alerts: Alerts
  languagesProblem: string | null
  modelProblem: string | null
}): Promise<void> {
  const { me, alerts } = input
  if (!me.canConnectToBusiness) await alerts.general('botfather:business', BUSINESS_MODE_OFF)
  if (!me.hasTopicsEnabled) await alerts.general('botfather:topics', TOPICS_OFF)
  if (!me.supportsInlineQueries) await alerts.general('botfather:inline', INLINE_OFF)
  if (input.languagesProblem) await alerts.general('languages', input.languagesProblem)
  if (input.modelProblem) await alerts.general('model', input.modelProblem)
}
