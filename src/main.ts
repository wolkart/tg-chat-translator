import { Bot } from 'grammy'
import { createAlerts, createScrubber } from './alerts.ts'
import { ALLOWED_UPDATES, createApp } from './app.ts'
import { loadEnv } from './env.ts'
import { createTopics } from './owner/topics.ts'
import { FIRST_RUN_DEFAULTS, createConfig } from './settings.ts'
import { createInlineCheck, setupCommands, startupChecks } from './startup.ts'
import { HOUR, openStore } from './store.ts'
import { createTelegramApi, describeError } from './telegram.ts'
import { createAccounts } from './translate/account.ts'
import { reviewTranslation } from './translate/check.ts'
import { PROVIDERS } from './translate/providers.ts'

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
store.ensureDefaults(env.ownerId, FIRST_RUN_DEFAULTS)
const config = createConfig({ store, env })

const bot = new Bot(env.botToken)
const api = createTelegramApi(bot.api, env.botToken)
const scrub = createScrubber(env.secrets)
for (const key of Object.values(store.panelKeys(env.ownerId))) scrub.add(key)
const alerts = createAlerts({ api, ownerChatId: env.ownerId, scrub, now })

let me
try {
  me = await api.getMe()
} catch (error) {
  // Без getMe до владельца не достучаться — остаётся консоль.
  console.error(`\nTelegram не принял токен бота: ${scrub(describeError(error))}\nПроверьте BOT_TOKEN в .env.\n`)
  process.exit(1)
}

const initial = config(env.ownerId)

await startupChecks({
  me,
  alerts,
  languagesProblem: initial.languagesProblem,
  modelProblem: initial.translatorProblem,
})
await setupCommands(api, alerts.log)

const inline = createInlineCheck({ api, initial: me.supportsInlineQueries, now })

const app = createApp({
  api,
  store,
  alerts,
  topics: createTopics({ api, store, ownerChatId: env.ownerId, now, scrub }),
  ownerId: env.ownerId,
  botId: me.id,
  config,
  review: reviewTranslation,
  inlineEnabled: inline,
  onBotInfo: (info) => inline.update(info.supportsInlineQueries),
  accounts: createAccounts(PROVIDERS, { fetchImpl: fetch, now }),
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
await bot.start({ allowed_updates: [...ALLOWED_UPDATES] })
store.close()
