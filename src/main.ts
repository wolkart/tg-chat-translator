import { setTimeout as sleep } from 'node:timers/promises'
import { Bot } from 'grammy'
import { createAlerts, createScrubber } from './alerts.ts'
import { ALLOWED_UPDATES, createApp } from './app.ts'
import { loadEnv } from './env.ts'
import { connectTelegram, createBackground, placeName, runPolling, sleepForever } from './lifecycle.ts'
import { createTopics } from './owner/topics.ts'
import { scheduleWarnings } from './owner/warnings.ts'
import type { Deps } from './deps.ts'
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

// Без getMe до владельца не достучаться — о сети и токене пишем только в журнал. С
// отвергнутым токеном бот засыпает, а не падает: иначе надзиратель поднимал бы его по кругу.
const me =
  (await connectTelegram({ getMe: () => api.getMe(), sleep: (ms) => sleep(ms), log: alerts.log })) ??
  (await sleepForever())

const initial = config(env.ownerId)

await startupChecks({
  me,
  alerts,
  languagesProblem: initial.languagesProblem,
  modelProblem: initial.translatorProblem,
})
// Меню команд — не повод держать запуск: сбой setupCommands ловит сам, строкой в консоль.
void setupCommands(api, alerts.log)

const inline = createInlineCheck({ api, initial: me.supportsInlineQueries, now })

const deps: Deps = {
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
  addSecret: scrub.add,
  dry,
  now,
}
const app = createApp(deps)
const background = createBackground()
scheduleWarnings(deps, env.ownerId, background)

bot.use((ctx) => app.handleUpdate(ctx.update))
bot.catch((error) => {
  void alerts.general('bot', `Сбой бота: ${describeError(error.error)}`)
})

// Служебные записи (обработанные апдейты, «Кому?», эхо) чистим раз в час, а ещё раз — при старте:
// при частых перезапусках час не успевал бы пройти, и чистка не случалась бы никогда.
store.cleanup(now())
background.every(() => store.cleanup(now()), HOUR)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void bot.stop()
  })
}

// Строку «@бот запущен» ждёт установщик: по ней он понимает, что бот поднялся. Пишем её из
// onStart, а не заранее: grammY зовёт его после проверки токена и снятия вебхука, перед
// первым опросом, — упавший init или 409 не должен успеть превратиться в «✓ Готово».
const started = () =>
  alerts.log(dry ? `@${me.username}: холостой прогон — собеседникам ничего не уходит` : `@${me.username} запущен`)
const outcome = await runPolling({
  start: () => bot.start({ allowed_updates: [...ALLOWED_UPDATES], onStart: started }),
  alerts,
  place: placeName(),
})
if (outcome === 'sleep') {
  // Уснувшая копия молчит: предупреждения по её старой базе («ключ истекает») были бы ложными.
  background.stopAll()
  await sleepForever()
}
store.close()
