import { callBotApi } from './bot-api.ts'
import type { SetupStep } from './run.ts'

/** Сколько ждём /start, прежде чем спросить id числом. */
export const WAIT_LIMIT_MS = 3 * 60_000
export const POLL_EVERY_MS = 2_000

const YES = /^(да|д|yes|y)$/i
const NO = /^(нет|н|no|n)$/i

/** Ровно то из апдейта, что нужно установщику. */
export type Update = {
  update_id: number
  message?: {
    chat: { type: string }
    from?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
    text?: string
  }
}

export type Candidate = { id: number; name: string; username: string | undefined }

/** Последний /start из лички от живого человека, кроме тех, кто уже сказал «не я». */
export function findStart(updates: readonly Update[], rejected: ReadonlySet<number>): Candidate | null {
  for (let i = updates.length - 1; i >= 0; i--) {
    const message = updates[i]!.message
    const from = message?.from
    if (!message || !from || from.is_bot || message.chat.type !== 'private') continue
    // /start, /start@бот, /start <параметр> — да; /startup — нет.
    if (!/^\/start(@\w+)?(\s|$)/.test(message.text ?? '')) continue
    if (rejected.has(from.id)) continue
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ')
    return { id: from.id, name, username: from.username }
  }
  return null
}

function label(candidate: Candidate): string {
  return candidate.username ? `${candidate.name} (@${candidate.username})` : candidate.name
}

/**
 * Владелец — тот, кто написал боту /start. Опрос getUpdates:
 * - без offset — ни одно сообщение не подтверждаем: бот после запуска получит тот же /start и
 *   ответит панелью, а business_connection (если бота уже подключили к аккаунту) не сгорит;
 * - без allowed_updates — Telegram запоминает этот список до следующего вызова, и наш отрезал
 *   бы ему апдейты из лички до первого опроса;
 * - коротким опросом раз в 2 секунды: с неподтверждёнными апдейтами долгий опрос возвращался
 *   бы сразу, и цикл крутился бы вхолостую.
 * Если тот же бот работает в другом месте, наш опрос выбьет ту копию: она напишет владельцу и
 * уснёт, а установка пойдёт дальше — новая установка главнее.
 */
export const ownerStep: SetupStep = {
  id: 'owner',
  async run(ctx) {
    const saved = ctx.existing.OWNER_ID
    if (saved && /^\d+$/.test(saved)) {
      ctx.answers.ownerId = Number(saved)
      return { ok: true }
    }

    const token = ctx.answers.token!
    ctx.io.say(
      `\nТеперь откройте @${ctx.answers.botUsername} в Telegram и отправьте ему /start — ` +
        'так бот узнает, что вы его владелец.\nЖду ваше сообщение…',
    )
    const rejected = new Set<number>()
    const deadline = ctx.now() + WAIT_LIMIT_MS
    let webhookCleared = false

    while (ctx.now() < deadline) {
      const answer = await callBotApi<Update[]>(ctx.fetch, token, 'getUpdates')
      if (answer.kind === 'error' && answer.code === 409 && /webhook/i.test(answer.description) && !webhookCleared) {
        // Вебхук от прошлой жизни бота. Без drop_pending_updates — накопленное не выбрасываем.
        webhookCleared = true
        await callBotApi(ctx.fetch, token, 'deleteWebhook')
        continue
      }
      if (answer.kind === 'ok') {
        const candidate = findStart(answer.result, rejected)
        if (candidate) {
          // Лишний Enter или опечатка — не «нет»: отвергнутого человека больше не предлагаем,
          // и случайный Enter не должен выбросить настоящего владельца. Спрашиваем заново.
          let yes: boolean | null = null
          while (yes === null) {
            const reply = (await ctx.io.ask(`Это вы: ${label(candidate)}? (да/нет): `)).trim()
            if (YES.test(reply)) yes = true
            else if (NO.test(reply)) yes = false
          }
          if (yes) {
            ctx.answers.ownerId = candidate.id
            ctx.io.say('✓ Владелец найден')
            return { ok: true }
          }
          rejected.add(candidate.id)
          ctx.io.say('Хорошо, жду дальше…')
          continue
        }
      }
      // Сеть мигнула, Telegram ответил ошибкой или /start ещё нет — просто ждём дальше.
      await ctx.sleep(POLL_EVERY_MS)
    }

    // Запасной путь: /start мог утонуть в сотне старых апдейтов давно живущего бота.
    ctx.io.say('\nЗа 3 минуты боту никто не написал /start.')
    for (;;) {
      const raw = await ctx.io.ask('Введите свой id в Telegram числом — его показывает бот @userinfobot: ')
      if (/^\d{4,}$/.test(raw)) {
        ctx.answers.ownerId = Number(raw)
        return { ok: true }
      }
      ctx.io.say('Нужно число, например 123456789.')
    }
  },
}
