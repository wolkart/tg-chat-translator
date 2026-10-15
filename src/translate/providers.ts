import { SETTING } from '../store.ts'

/**
 * Провайдеры моделей. Все говорят на одном языке — формате OpenAI chat/completions,
 * поэтому новый провайдер = новая строка в таблице, кода не нужно.
 * Перенесено из news-reposter; модели подобраны под перевод.
 */
export type Provider = {
  id: string
  label: string
  baseUrl: string
  /** Переменная в .env с ключом */
  envKey: string
  /** Куда человек идёт за ключом */
  keysUrl: string
  /** Первая — по умолчанию */
  models: string[]
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    keysUrl: 'https://openrouter.ai/keys',
    // Первая — дефолт новой установки: замер 2026-10-12 (scripts/eval-injection.ts) — лучшая
    // стойкость к подмене (62 из 63) и в 4 раза дешевле gpt-4.1-mini.
    models: ['anthropic/claude-haiku-5.5', 'openai/gpt-4.1-mini', 'google/gemini-2.5-flash', 'anthropic/claude-sonnet-5', 'deepseek/deepseek-chat'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-chat'],
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/v1',
    envKey: 'MOONSHOT_API_KEY',
    keysUrl: 'https://platform.moonshot.ai/console/api-keys',
    models: ['kimi-k2-0905-preview'],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    keysUrl: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile'],
  },
  {
    id: 'local',
    label: 'Локальная модель',
    baseUrl: 'http://localhost:11434/v1',
    envKey: 'LOCAL_API_KEY',
    keysUrl: 'https://ollama.com',
    models: ['qwen3:8b'],
  },
]

/** Дефолт первого запуска: первый провайдер и его первая модель. */
export const PROVIDER_DEFAULTS: Record<string, string> = {
  [SETTING.provider]: PROVIDERS[0]!.id,
  [SETTING.model]: PROVIDERS[0]!.models[0]!,
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
  | { ok: true; provider: Provider; model: string; apiKey: string; keySource: KeySource; baseUrl: string }
  | { ok: false; problem: string }

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

  const model = settings.model && provider.models.includes(settings.model) ? settings.model : provider.models[0]!
  const baseUrl = provider.id === 'local' && env.localBaseUrl ? env.localBaseUrl : provider.baseUrl
  return { ok: true, provider, model, apiKey: key.value, keySource: key.source, baseUrl }
}
