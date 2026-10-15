import { SETTING } from '../store.ts'
import type { Http, ProviderAccount } from './account.ts'
import { createOpenRouterAccount } from './openrouter.ts'

/**
 * Провайдеры моделей. Все говорят на одном языке — формате OpenAI chat/completions,
 * поэтому новый провайдер = новая строка в таблице, кода не нужно.
 * Перенесено из news-reposter; модели подобраны под перевод.
 */
/** Модель в панели: id уходит провайдеру, название и пометку видит владелец. */
export type ModelInfo = { id: string; title: string; note?: string }

export type Provider = {
  id: string
  label: string
  baseUrl: string
  /** Переменная в .env с ключом */
  envKey: string
  /** Куда человек идёт за ключом */
  keysUrl: string
  /** Первая — по умолчанию */
  models: ModelInfo[]
  /**
   * Как выглядит ключ. По нему бот узнаёт ключ, вставленный в чат не по запросу, и не
   * переводит его. Нет — ключ заранее не опознать (локальная модель). Без флага g: шаблон
   * берёт exec, а у шаблона с g exec помнит, где остановился в прошлый раз.
   */
  keyPattern?: RegExp
  /**
   * С чего начинается ключ: его показывает огрызок ключа («sk-or-v1-…a3f9») и подсказка
   * «он начинается с …», когда прислали не ключ
   */
  keyPrefix?: string
  /** Где пополнить баланс */
  topUpUrl?: string
  /** Счёт, который видит бот: остаток, траты, цены. Нет — смотреть в кабинете провайдера. */
  account?: (http: Http) => ProviderAccount
}

/**
 * Ключи DeepSeek и Kimi выглядят одинаково. Шаблон длинный нарочно: «sk-» в обычной фразе
 * («sk-board») ключом не считается.
 */
const SK_KEY = { keyPattern: /\bsk-[A-Za-z0-9]{32,}/, keyPrefix: 'sk-' }

export const PROVIDERS: Provider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    keysUrl: 'https://openrouter.ai/keys',
    keyPattern: /sk-or-v1-[0-9a-f]{64}/,
    keyPrefix: 'sk-or-v1-',
    topUpUrl: 'https://openrouter.ai/settings/credits',
    account: createOpenRouterAccount,
    // Первая — дефолт новой установки: замер 2026-10-12 (scripts/eval-injection.ts) — лучшая
    // стойкость к подмене (62 из 63) и в 4 раза дешевле gpt-4.1-mini. GPT-5.6 Luna (59) и
    // Gemini 3.1 Flash Lite (60) — из того же замера. gemini-2.5-flash OpenRouter убирает
    // 2026-10-20, claude-sonnet-5 для перевода дорог (в 20 раз дороже Haiku), gpt-4.1-mini
    // хуже и дороже новых — их в списке нет. Новый замер на этом списке — шаг 6.
    models: [
      { id: 'anthropic/claude-haiku-5.5', title: 'Claude Haiku 5.5', note: 'лучшая в нашем замере' },
      { id: 'openai/gpt-5.6-luna', title: 'GPT-5.6 Luna', note: 'от OpenAI' },
      { id: 'google/gemini-3.1-flash-lite', title: 'Gemini 3.1 Flash Lite', note: 'от Google' },
      { id: 'deepseek/deepseek-v4-flash', title: 'DeepSeek V4 Flash', note: 'самая дешёвая' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    ...SK_KEY,
    models: [{ id: 'deepseek-chat', title: 'DeepSeek Chat' }],
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/v1',
    envKey: 'MOONSHOT_API_KEY',
    keysUrl: 'https://platform.moonshot.ai/console/api-keys',
    ...SK_KEY,
    models: [{ id: 'kimi-k2-0905-preview', title: 'Kimi K2' }],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    keysUrl: 'https://console.groq.com/keys',
    keyPattern: /\bgsk_[A-Za-z0-9]{40,}/,
    keyPrefix: 'gsk_',
    models: [{ id: 'llama-3.3-70b-versatile', title: 'Llama 3.3 70B' }],
  },
  {
    id: 'local',
    label: 'Локальная модель',
    baseUrl: 'http://localhost:11434/v1',
    envKey: 'LOCAL_API_KEY',
    keysUrl: 'https://ollama.com',
    models: [{ id: 'qwen3:8b', title: 'Qwen3 8B' }],
  },
]

/** Дефолт первого запуска: первый провайдер и его первая модель. */
export const PROVIDER_DEFAULTS: Record<string, string> = {
  [SETTING.provider]: PROVIDERS[0]!.id,
  [SETTING.model]: PROVIDERS[0]!.models[0]!.id,
}

/** Адрес провайдера: у локальной модели его можно поменять в .env (LOCAL_BASE_URL). */
export function providerBaseUrl(provider: Provider, localBaseUrl: string | undefined): string {
  return provider.id === 'local' && localBaseUrl ? localBaseUrl : provider.baseUrl
}

/**
 * Шаблоны ключей для поиска по всему тексту: каждый — один раз (у DeepSeek и Kimi он общий) и
 * с флагом g, без которого matchAll не работает. Собраны заранее, а не на каждое сообщение.
 */
const KEY_SEARCHES = [...new Set(PROVIDERS.flatMap((provider) => provider.keyPattern ?? []))].map(
  (pattern) => new RegExp(pattern.source, `${pattern.flags}g`),
)

/** Все ключи любых провайдеров в тексте, без повторов: их надо укрыть в консоли, даже чужие. */
export function findKeys(text: string): string[] {
  return [...new Set(KEY_SEARCHES.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0])))]
}

/** Ключ любого провайдера по виду: текст, где он есть, бот не переводит и никому не отправляет. */
export function looksLikeKey(text: string): boolean {
  return findKeys(text).length > 0
}

export function getProvider(id: string | undefined): Provider {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0]!
}

/** Откуда ключ: от этого зависят подсказки — «вставьте заново в панели» или «проверьте .env». */
export type KeySource = 'env' | 'panel'

export type ProviderKey = { value: string; source: KeySource }

/**
 * Ключ провайдера. Из .env главнее: так тот, кто ставит руками, точно знает, какой ключ
 * работает. Из панели — если в .env его нет.
 */
export function providerKey(
  provider: Provider,
  envKeys: Record<string, string>,
  panelKeys: Record<string, string>,
): ProviderKey | undefined {
  const fromEnv = envKeys[provider.envKey]
  if (fromEnv) return { value: fromEnv, source: 'env' }
  const fromPanel = panelKeys[provider.id]
  return fromPanel ? { value: fromPanel, source: 'panel' } : undefined
}

export type ResolvedModel =
  | {
      ok: true
      provider: Provider
      /** id модели — его получает провайдер */
      model: string
      /** Название для владельца: «Claude Haiku 5.5» */
      title: string
      apiKey: string
      keySource: KeySource
      baseUrl: string
    }
  | { ok: false; problem: string }

/** Модель, которой есть чем переводить: ключ найден. */
export type ReadyModel = Extract<ResolvedModel, { ok: true }>

/**
 * Какой провайдер и модель использовать. Ключ — из .env или из панели. Если у выбранного
 * провайдера ключа нет, а у другого есть, работает тот, чей ключ задан: установка, где
 * ключ вписан только в .env, работает без панели.
 */
export function resolveModel(
  settings: { provider?: string; model?: string },
  env: { providerKeys: Record<string, string>; localBaseUrl?: string },
  panelKeys: Record<string, string> = {},
): ResolvedModel {
  const chosen = getProvider(settings.provider)
  const keyOf = (provider: Provider) => providerKey(provider, env.providerKeys, panelKeys)
  const provider = keyOf(chosen) ? chosen : PROVIDERS.find((candidate) => keyOf(candidate))
  const key = provider && keyOf(provider)

  if (!provider || !key) {
    return {
      ok: false,
      problem: `Нет ключа модели — переводить нечем. Вставьте ключ: /start → 🔑 Ключ. Ключ берут здесь: ${chosen.keysUrl}`,
    }
  }

  // Сохранённой модели нет в списке (убрали или сменился провайдер) — первая из списка.
  const model = provider.models.find((candidate) => candidate.id === settings.model) ?? provider.models[0]!
  return {
    ok: true,
    provider,
    model: model.id,
    title: model.title,
    apiKey: key.value,
    keySource: key.source,
    baseUrl: providerBaseUrl(provider, env.localBaseUrl),
  }
}
