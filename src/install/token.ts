import { callBotApi } from './bot-api.ts'
import { TELEGRAM_UNREACHABLE } from './connectivity.ts'
import { isTokenRejected } from '../telegram.ts'
import type { SetupContext, SetupStep } from './run.ts'

/** Токен бота: число, двоеточие, 35 знаков. Всё прочее в адрес запроса не попадает. */
export const TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/

export const TOKEN_HINT = [
  '',
  'Токен бота — это пароль от бота. Его выдаёт @BotFather, когда вы создаёте бота.',
  'Он выглядит так: 8123456789:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'При вставке вместо знаков появятся звёздочки — так и задумано: токен не виден на экране.',
  '',
].join('\n')

export const TOKEN_REJECTED_TEXT = 'Telegram не принял токен. Скопируйте его из @BotFather целиком и вставьте снова.'

export const ENV_TOKEN_REJECTED =
  'Telegram не принял токен, записанный раньше, — его отозвали или заменили в @BotFather. Вставьте новый.'

type Check = { kind: 'ok'; username: string } | { kind: 'rejected' } | { kind: 'failed'; reason: string }

/** Повторы при временном сбое: паузы по 3 секунды, всего до двух повторов. */
const RETRY_PAUSE_MS = 3_000
const RETRIES = 2

/**
 * Один мигнувший запрос не должен останавливать установку: человек уже вставил токен и
 * ждёт. Повторяем только то, что проходит само (обрыв, 429, 5xx); 401/404 — токен
 * действительно не тот, повтор ничего не изменит.
 */
async function checkToken(ctx: SetupContext, token: string): Promise<Check> {
  if (!TOKEN_PATTERN.test(token)) return { kind: 'rejected' }
  let check: Check
  for (let attempt = 0; ; attempt++) {
    const answer = await callBotApi<{ username?: unknown }>(ctx.fetch, token, 'getMe')
    let transient = false
    if (answer.kind === 'ok') {
      // Ответ без имени бота — обрыв по дороге, а не «найден»: имя пойдёт в сообщения и ссылки.
      if (typeof answer.result?.username === 'string') return { kind: 'ok', username: answer.result.username }
      check = { kind: 'failed', reason: TELEGRAM_UNREACHABLE }
    } else if (answer.kind === 'network') {
      transient = true
      check = { kind: 'failed', reason: TELEGRAM_UNREACHABLE }
    } else if (isTokenRejected(answer.code)) {
      return { kind: 'rejected' }
    } else {
      transient = answer.code === 429 || answer.code >= 500
      check = { kind: 'failed', reason: `Telegram ответил ошибкой ${answer.code} — попробуйте через минуту.` }
    }
    if (!transient || attempt >= RETRIES) return check
    await ctx.sleep(RETRY_PAUSE_MS)
  }
}

/**
 * Токен: из .env, если Telegram его принимает (обновление), иначе — вопрос. Отозванный токен
 * спрашивается заново: повторный запуск команды — и есть способ его заменить.
 */
export const tokenStep: SetupStep = {
  id: 'token',
  async run(ctx) {
    const saved = ctx.existing.BOT_TOKEN
    if (saved) {
      const check = await checkToken(ctx, saved)
      if (check.kind === 'ok') {
        ctx.answers.token = saved
        ctx.answers.botUsername = check.username
        ctx.io.say(`✓ Бот @${check.username}`)
        return { ok: true }
      }
      if (check.kind === 'failed') return { ok: false, reason: check.reason }
      ctx.io.say(ENV_TOKEN_REJECTED)
    } else {
      ctx.io.say(TOKEN_HINT)
    }

    for (;;) {
      const token = await ctx.io.askMasked('Токен бота: ')
      if (!token) continue
      const check = await checkToken(ctx, token)
      if (check.kind === 'failed') return { ok: false, reason: check.reason }
      if (check.kind === 'rejected') {
        ctx.io.say(TOKEN_REJECTED_TEXT)
        continue
      }
      ctx.answers.token = token
      ctx.answers.botUsername = check.username
      ctx.io.say(`✓ Бот @${check.username} найден`)
      return { ok: true }
    }
  },
}
