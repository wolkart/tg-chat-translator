import { Bot } from 'grammy'
import { createAlerts, createScrubber } from './alerts.ts'
import { createApp } from './app.ts'
import { loadEnv } from './env.ts'
import { createTopics } from './owner/topics.ts'
import { loadSettings, startupChecks } from './startup.ts'
import { HOUR, LANGUAGE_DEFAULTS, openStore } from './store.ts'
import { createTelegramApi, describeError } from './telegram.ts'
import { createTranslator } from './translate/llm.ts'
import { PROVIDER_DEFAULTS } from './translate/providers.ts'

const result = loadEnv()
if (!result.ok) {
  console.error(
    `\nНе заполнены обязательные переменные в .env:\n` +
      result.missing.map((name) => `  - ${name}`).join('\n') +
      `\n\nСкопируйте .env.example в .env и заполните.\n`,
  )
  process.exit(1)
}

const env = result.env
const dry = process.argv.includes('--dry')
const now = () => Date.now()

const store = openStore(env.dbPath)
store.ensureDefaults(env.ownerId, { ...LANGUAGE_DEFAULTS, ...PROVIDER_DEFAULTS })

const bot = new Bot(env.botToken)
const api = createTelegramApi(bot.api, env.botToken)
const scrub = createScrubber(env.secrets)
const alerts = createAlerts({ api, ownerChatId: env.ownerId, scrub, now })

let me
try {
  me = await api.getMe()
} catch (error) {
  // Без getMe до владельца не достучаться — остаётся консоль.
  console.error(`\nTelegram не принял токен бота: ${scrub(describeError(error))}\nПроверьте BOT_TOKEN в .env.\n`)
  process.exit(1)
}

const { pair, model } = loadSettings(store, env.ownerId, env)

await startupChecks({
  me,
  alerts,
  languagesProblem: pair.ok ? null : pair.problem,
  modelProblem: model.ok ? null : model.problem,
})

const app = createApp({
  api,
  store,
  alerts,
  topics: createTopics({ api, store, ownerChatId: env.ownerId, now, scrub }),
  ownerId: env.ownerId,
  botId: me.id,
  languages: pair.ok ? pair.pair : null,
  languagesProblem: pair.ok ? null : pair.problem,
  translator: model.ok
    ? createTranslator({ baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.model, label: model.provider.label })
    : null,
  translatorProblem: model.ok ? null : model.problem,
  translatorInfo: model.ok ? `${model.provider.label} · ${model.model}` : model.problem,
  dry,
  now,
})

bot.use((ctx) => app.handleUpdate(ctx.update))
bot.catch((error) => {
  void alerts.general('bot', `Сбой бота: ${describeError(error.error)}`)
})

// Служебные записи (обработанные апдейты, «Кому?», эхо) чистим раз в час, а ещё раз — при старте:
// при частых перезапусках час не успевал бы пройти, и чистка не случалась бы никогда.
store.cleanup(now())
setInterval(() => store.cleanup(now()), HOUR).unref()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void bot.stop()
  })
}

alerts.log(dry ? `@${me.username}: холостой прогон — собеседникам ничего не уходит` : `@${me.username} запущен`)
await bot.start({ allowed_updates: ['business_connection', 'business_message', 'message', 'callback_query'] })
store.close()
