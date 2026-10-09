import type { Alerts } from './alerts.ts'
import { resolvePair } from './lang/profiles.ts'
import { LANGUAGE_DEFAULTS, SETTING, type Store } from './store.ts'
import type { BotInfo } from './telegram.ts'
import { resolveModel } from './translate/providers.ts'

export const BUSINESS_MODE_OFF =
  'В BotFather выключен Business Mode — без него бот не видит вашу личку. ' +
  'Откройте @BotFather → /mybots → этот бот → Bot Settings → Business Mode → Turn on.'

export const TOPICS_OFF =
  'В BotFather выключен Threaded Mode — без него бот не может завести темы для собеседников. ' +
  'Откройте @BotFather → /mybots → этот бот → Bot Settings → Threaded Mode → Turn on.'

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
  if (input.languagesProblem) await alerts.general('languages', input.languagesProblem)
  if (input.modelProblem) await alerts.general('model', input.modelProblem)
}
