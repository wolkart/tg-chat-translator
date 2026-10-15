import { resolvePair, type LanguagePair } from './lang/profiles.ts'
import { ADDRESS_DEFAULTS, LANGUAGE_DEFAULTS, SETTING, type Store } from './store.ts'
import { createTranslator, type Translator } from './translate/llm.ts'
import { PROVIDER_DEFAULTS, resolveModel, type ResolvedModel } from './translate/providers.ts'
import type { Address } from './types.ts'

/** Всё, что пишется в базу при первом запуске. Дальше источник правды — база, её правит панель. */
export const FIRST_RUN_DEFAULTS: Record<string, string> = { ...LANGUAGE_DEFAULTS, ...PROVIDER_DEFAULTS, ...ADDRESS_DEFAULTS }

/** Настройки владельца на этот момент: пара языков, обращение, модель и готовый переводчик. */
export type Config = {
  /** null — язык без профиля: новые разговоры не заводятся */
  languages: LanguagePair | null
  languagesProblem: string | null
  address: Address
  model: ResolvedModel
  /** null — нет ключа модели: входящие показываются без перевода */
  translator: Translator | null
  translatorProblem: string | null
}

export type ConfigEnv = { providerKeys: Record<string, string>; localBaseUrl?: string }

type ReadyModel = Extract<ResolvedModel, { ok: true }>

function defaultTranslator(model: ReadyModel): Translator {
  return createTranslator({ baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.model, provider: model.provider })
}

/**
 * Настройки читаются из базы в момент вызова, а не один раз при старте: так изменение в
 * панели действует со следующего перевода, без перезапуска. Кэша нет намеренно — забытый
 * сброс кэша дал бы ровно ту поломку, которую тесты не ловят, а чтение — несколько строк
 * SQLite по ключу. ownerId — потому что одна программа должна уметь обслуживать многих.
 */
export function createConfig(deps: {
  store: Store
  env: ConfigEnv
  /** Подмена в тестах: модель и сеть там не вызываются */
  makeTranslator?: (model: ReadyModel) => Translator
}): (ownerId: number) => Config {
  const makeTranslator = deps.makeTranslator ?? defaultTranslator
  return (ownerId) => {
    const get = (key: string) => deps.store.getSetting(ownerId, key)
    const pair = resolvePair(
      get(SETTING.ownerLang) ?? LANGUAGE_DEFAULTS[SETTING.ownerLang]!,
      get(SETTING.peerLang) ?? LANGUAGE_DEFAULTS[SETTING.peerLang]!,
    )
    const model = resolveModel({ provider: get(SETTING.provider), model: get(SETTING.model) }, deps.env)
    return {
      languages: pair.ok ? pair.pair : null,
      languagesProblem: pair.ok ? null : pair.problem,
      address: get(SETTING.address) === 'formal' ? 'formal' : 'as-is',
      model,
      translator: model.ok ? makeTranslator(model) : null,
      translatorProblem: model.ok ? null : model.problem,
    }
  }
}
