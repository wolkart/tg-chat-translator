import { createAlerts } from '../src/alerts.ts'
import type { Deps } from '../src/deps.ts'
import { resolvePair } from '../src/lang/profiles.ts'
import { createTopics } from '../src/owner/topics.ts'
import { openStore } from '../src/store.ts'
import type { BusinessConnectionInfo } from '../src/telegram.ts'
import type { Reviewer } from '../src/translate/check.ts'
import type { TranslateRequest, Translator } from '../src/translate/llm.ts'
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

/** Зависимости из подделок. Часы стоят на месте, пока тест не сдвинет их сам. */
export function setupDeps(options: { overrides?: Partial<Deps>; connections?: BusinessConnectionInfo[] } = {}) {
  let clock = T0
  const now = () => clock
  const store = openStore(':memory:')
  const tg = fakeTelegram({ connections: options.connections ?? [OWNER_CONNECTION] })
  const printed: string[] = []
  const alerts = createAlerts({ api: tg.api, ownerChatId: OWNER_ID, scrub: (t) => t, now, print: (line) => printed.push(line) })
  const topics = createTopics({ api: tg.api, store, ownerChatId: OWNER_ID, now, scrub: (t) => t })
  const translator = fakeTranslator()
  const pair = resolvePair('ru', 'en')
  if (!pair.ok) throw new Error(pair.problem)

  const deps: Deps = {
    api: tg.api,
    store,
    alerts,
    topics,
    ownerId: OWNER_ID,
    botId: BOT_ID,
    languages: pair.pair,
    languagesProblem: null,
    translator: translator.translate,
    translatorProblem: null,
    translatorInfo: 'OpenRouter · openai/gpt-4.1-mini',
    review: passReview,
    dry: false,
    now,
    ...options.overrides,
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
