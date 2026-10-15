import { createAlerts } from '../src/alerts.ts'
import type { Deps } from '../src/deps.ts'
import { resolvePair } from '../src/lang/profiles.ts'
import { createTopics } from '../src/owner/topics.ts'
import { FIRST_RUN_DEFAULTS, createConfig, type Config } from '../src/settings.ts'
import { openStore } from '../src/store.ts'
import type { BusinessConnectionInfo } from '../src/telegram.ts'
import type { Reviewer } from '../src/translate/check.ts'
import type { TranslateRequest, Translator } from '../src/translate/llm.ts'
import { PROVIDERS } from '../src/translate/providers.ts'
import { fakeTelegram } from './fakes.ts'
import { BOT_ID, CONNECTION_ID, OWNER_ID, T0 } from './helpers.ts'

/** Подделка переводчика: «[ru] текст» — сразу видно, на какой язык и что переводили. */
export function fakeTranslator(impl?: (request: TranslateRequest) => string | Promise<string>) {
  const calls: TranslateRequest[] = []
  const translate: Translator = async (request) => {
    calls.push(request)
    return impl ? impl(request) : `[${request.target.code}] ${request.text}`
  }
  return { translate, calls }
}

/**
 * Проверка перевода, которая всё пропускает. Подделка переводчика отвечает «[ru] текст» —
 * настоящая проверка сочла бы это не русским. Тесты доставки проверяют доставку, а тесты
 * защиты передают настоящую проверку сами.
 */
export const passReview: Reviewer = () => ({ verdict: 'ok', rule: null, commands: false })

export const OWNER_CONNECTION: BusinessConnectionInfo = {
  id: CONNECTION_ID,
  userId: OWNER_ID,
  userName: 'Owner Test (@owner_test)',
  userChatId: OWNER_ID,
  canReply: true,
  isEnabled: true,
}

/** Выдуманный ключ OpenRouter нужной формы: настоящих ключей в тестах нет. */
export const TEST_KEY = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`

/** Модель, которую видят тесты с неизменными настройками. */
export const TEST_MODEL: Config['model'] = {
  ok: true,
  provider: PROVIDERS[0]!,
  model: 'anthropic/claude-haiku-5.5',
  apiKey: TEST_KEY,
  keySource: 'env',
  baseUrl: PROVIDERS[0]!.baseUrl,
}

/** Части настроек, которые тест может подменить, не трогая базу. */
type ConfigOverrides = Partial<Config>

/**
 * Зависимости из подделок. Часы стоят на месте, пока тест не сдвинет их сам.
 * По умолчанию настройки неизменны (из overrides или подделок). live: true — настройки
 * читаются из базы, как в боте: так проверяется, что панель меняет их без перезапуска.
 */
export function setupDeps(
  options: { overrides?: Partial<Deps> & ConfigOverrides; connections?: BusinessConnectionInfo[]; live?: boolean } = {},
) {
  let clock = T0
  const now = () => clock
  const store = openStore(':memory:')
  store.ensureDefaults(OWNER_ID, FIRST_RUN_DEFAULTS)
  const tg = fakeTelegram({ connections: options.connections ?? [OWNER_CONNECTION] })
  const printed: string[] = []
  const alerts = createAlerts({ api: tg.api, ownerChatId: OWNER_ID, scrub: (t) => t, now, print: (line) => printed.push(line) })
  const topics = createTopics({ api: tg.api, store, ownerChatId: OWNER_ID, now, scrub: (t) => t })
  const translator = fakeTranslator()
  const pair = resolvePair('ru', 'en')
  if (!pair.ok) throw new Error(pair.problem)

  const { languages, languagesProblem, address, model, translator: translatorOverride, translatorProblem, ...overrides } =
    options.overrides ?? {}
  const fixed: Config = {
    languages: languages === undefined ? pair.pair : languages,
    languagesProblem: languagesProblem ?? null,
    address: address ?? 'as-is',
    model: model ?? TEST_MODEL,
    translator: translatorOverride === undefined ? translator.translate : translatorOverride,
    translatorProblem: translatorProblem ?? null,
  }
  const config = options.live
    ? createConfig({ store, env: { providerKeys: { OPENROUTER_API_KEY: TEST_KEY } }, makeTranslator: () => translator.translate })
    : () => fixed

  const deps: Deps = {
    api: tg.api,
    store,
    alerts,
    topics,
    ownerId: OWNER_ID,
    botId: BOT_ID,
    config,
    review: passReview,
    inlineEnabled: async () => true,
    dry: false,
    now,
    ...overrides,
  }

  return {
    deps,
    store,
    tg,
    translator,
    printed,
    advance(ms: number) {
      clock += ms
    },
    /** Подключение владельца уже сохранено — как после апдейта business_connection. */
    connectOwner(overrides: Partial<{ canReply: boolean; isEnabled: boolean }> = {}) {
      store.saveConnection(
        { id: CONNECTION_ID, ownerId: OWNER_ID, userChatId: OWNER_ID, canReply: true, isEnabled: true, allowed: true, ...overrides },
        clock,
      )
    },
  }
}
