import type { SetupStep } from './run.ts'

export const TELEGRAM_UNREACHABLE =
  'Не достучаться до Telegram. Если вы в России — включите VPN на весь компьютер, не только в браузере, ' +
  'и запустите команду ещё раз.'

export const OPENROUTER_UNREACHABLE =
  '⚠️ OpenRouter недоступен — переводить через него не получится, пока не включите VPN. ' +
  'Установка продолжается: ключ можно взять и у другого провайдера.'

/**
 * Достучались, если сервер хоть что-то ответил: 401 и перенаправление — тоже ответ. Тело не
 * читаем, перенаправлению не следуем — нужна только связь, а не содержимое.
 */
async function reachable(fetchImpl: typeof fetch, url: string): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    await response.body?.cancel()
    return true
  } catch {
    return false
  }
}

/**
 * Связь — до вопросов: без Telegram установка бессмысленна, и человек должен узнать об этом
 * до того, как полезет в BotFather за токеном. OpenRouter — только предупреждение: ключ может
 * быть у другого провайдера.
 */
export const connectivityStep: SetupStep = {
  id: 'connectivity',
  async run(ctx) {
    if (!(await reachable(ctx.fetch, 'https://api.telegram.org/'))) return { ok: false, reason: TELEGRAM_UNREACHABLE }
    if (!(await reachable(ctx.fetch, 'https://openrouter.ai/api/v1/key'))) ctx.io.say(OPENROUTER_UNREACHABLE)
    return { ok: true }
  },
}
