import { callBotApi } from './bot-api.ts'
import { TELEGRAM_UNREACHABLE } from './connectivity.ts'
import type { SetupContext, SetupStep, StepResult } from './run.ts'

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

type Check = { kind: 'ok'; username: string } | { kind: 'rejected' } | { kind: 'failed'; result: StepResult }

async function checkToken(ctx: SetupContext, token: string): Promise<Check> {
  if (!TOKEN_PATTERN.test(token)) return { kind: 'rejected' }
  const answer = await callBotApi<{ username: string }>(ctx.fetch, token, 'getMe')
  if (answer.kind === 'ok') return { kind: 'ok', username: answer.result.username }
  if (answer.kind === 'network') return { kind: 'failed', result: { ok: false, reason: TELEGRAM_UNREACHABLE } }
  // Токен не того вида Telegram отвергает кодом 404, неверный — 401.
  if (answer.code === 401 || answer.code === 404) return { kind: 'rejected' }
  return { kind: 'failed', result: { ok: false, reason: `Telegram ответил ошибкой ${answer.code} — попробуйте через минуту.` } }
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
      if (check.kind === 'failed') return check.result
      ctx.io.say(ENV_TOKEN_REJECTED)
    } else {
      ctx.io.say(TOKEN_HINT)
    }

    for (;;) {
      const token = await ctx.io.askMasked('Токен бота: ')
      if (!token) continue
      const check = await checkToken(ctx, token)
      if (check.kind === 'failed') return check.result
      if (check.kind === 'rejected') {
        ctx.io.say(TOKEN_REJECTED_TEXT)
        continue
      }
      ctx.answers.token = token
      ctx.answers.tokenChanged = true
      ctx.answers.botUsername = check.username
      ctx.io.say(`✓ Бот @${check.username} найден`)
      return { ok: true }
    }
  },
}
