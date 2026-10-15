import { resolvePair, type LanguagePair } from './lang/profiles.ts'
import { ADDRESS_DEFAULTS, LANGUAGE_DEFAULTS, SETTING, type Store } from './store.ts'
import { createTranslator, type Translator } from './translate/llm.ts'
import {
  PROVIDERS,
  PROVIDER_DEFAULTS,
  getProvider,
  providerKey,
  resolveModel,
  type Provider,
  type ProviderKey,
  type ResolvedModel,
} from './translate/providers.ts'
import type { Address } from './types.ts'

/** Всё, что пишется в базу при первом запуске. Дальше источник правды — база, её правит панель. */
export const FIRST_RUN_DEFAULTS: Record<string, string> = { ...LANGUAGE_DEFAULTS, ...PROVIDER_DEFAULTS, ...ADDRESS_DEFAULTS }

/** Настройки владельца на этот момент: пара языков, обращение, модель и готовый переводчик. */
export type Config = {
  /** null — язык без профиля: новые разговоры не заводятся */
  languages: LanguagePair | null
  languagesProblem: string | null
  address: Address
  /** Провайдер, выбранный в панели. Переводит он же, если у него есть ключ, — иначе model скажет кто */
  provider: Provider
  /** Ключи по id провайдера: какой и откуда — из .env или из панели */
  keys: Readonly<Record<string, ProviderKey>>
  /** Адрес локальной модели из .env */
  localBaseUrl: string | undefined
  model: ResolvedModel
  /** null — нет ключа модели: входящие показываются без перевода */
  translator: Translator | null
  translatorProblem: string | null
}

export type ConfigEnv = { providerKeys: Record<string, string>; localBaseUrl?: string }

type ReadyModel = Extract<ResolvedModel, { ok: true }>

function realTranslator(model: ReadyModel, fetchImpl?: typeof fetch): Translator {
  return createTranslator({
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
    provider: { ...model.provider, keySource: model.keySource },
    ...(fetchImpl && { fetchImpl }),
  })
}

/**
 * Включить провайдера. У каждого провайдера свои модели — после переключения работает первая
 * из его списка: модель прежнего провайдера у нового не найдётся. Одна точка для «Сменить
 * провайдера» и для ключа, принятого после неё, чтобы правило не разошлось.
 */
export function switchProvider(store: Store, ownerId: number, provider: Provider): void {
  store.setSetting(ownerId, SETTING.provider, provider.id)
  store.setSetting(ownerId, SETTING.model, provider.models[0]!.id)
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
  /** Подмены в тестах: модель и сеть там не вызываются */
  makeTranslator?: (model: ReadyModel) => Translator
  fetchImpl?: typeof fetch
}): (ownerId: number) => Config {
  const makeTranslator = deps.makeTranslator ?? ((model: ReadyModel) => realTranslator(model, deps.fetchImpl))
  return (ownerId) => {
    const get = (key: string) => deps.store.getSetting(ownerId, key)
    const pair = resolvePair(
      get(SETTING.ownerLang) ?? LANGUAGE_DEFAULTS[SETTING.ownerLang]!,
      get(SETTING.peerLang) ?? LANGUAGE_DEFAULTS[SETTING.peerLang]!,
    )
    const panelKeys = deps.store.panelKeys(ownerId)
    const model = resolveModel({ provider: get(SETTING.provider), model: get(SETTING.model) }, deps.env, panelKeys)
    const keys: Record<string, ProviderKey> = {}
    for (const provider of PROVIDERS) {
      const key = providerKey(provider, deps.env.providerKeys, panelKeys)
      if (key) keys[provider.id] = key
    }
    return {
      languages: pair.ok ? pair.pair : null,
      languagesProblem: pair.ok ? null : pair.problem,
      address: get(SETTING.address) === 'formal' ? 'formal' : 'as-is',
      provider: getProvider(get(SETTING.provider)),
      keys,
      localBaseUrl: deps.env.localBaseUrl,
      model,
      translator: model.ok ? makeTranslator(model) : null,
      translatorProblem: model.ok ? null : model.problem,
    }
  }
}
