import { describeError, type TelegramApi } from './telegram.ts'

/** Короче — не секрет, а слово вроде «true»: заменять такое значит портить текст. */
const SECRET_MIN_LENGTH = 9

/**
 * Замена секретов на ***. Ошибки внешних сервисов иногда цитируют запрос целиком —
 * вместе с ключом или токеном в адресе. Владелец и консоль их видеть не должны.
 */
export function createScrubber(secrets: readonly string[]): (text: string) => string {
  const values = [...new Set(secrets.filter((value) => value.length >= SECRET_MIN_LENGTH))].sort(
    (a, b) => b.length - a.length,
  )
  return (text) => values.reduce((result, value) => result.split(value).join('***'), text)
}

/** Одинаковое общее сообщение — не чаще раза в 10 минут: лёгший провайдер не должен засыпать чат. */
export const THROTTLE_MS = 10 * 60 * 1000

export type Alerts = {
  /** Общая поломка — в чат с ботом вне тем, одинаковые по ключу не чаще раза в 10 минут */
  general(key: string, text: string): Promise<void>
  /** Сообщение владельцу вне тем без троттлинга: подключение, отключение — события, а не поломки */
  notify(text: string): Promise<void>
  /** Поломка внутри разговора — в его тему, без троттлинга */
  inTopic(threadId: number, text: string): Promise<void>
  /** Строка в консоль — через ту же замену секретов */
  log(text: string): void
}

export function createAlerts(deps: {
  api: TelegramApi
  ownerChatId: number
  scrub: (text: string) => string
  now?: () => number
  print?: (line: string) => void
}): Alerts {
  const now = deps.now ?? Date.now
  const print = deps.print ?? ((line: string) => console.log(line))
  const lastSent = new Map<string, number>()

  const log = (text: string) => print(`[${new Date(now()).toISOString()}] ${deps.scrub(text)}`)

  // Оповещение не должно ронять бота: если Telegram недоступен, остаётся консоль.
  async function send(text: string, threadId?: number): Promise<void> {
    const clean = deps.scrub(text)
    log(clean)
    try {
      await deps.api.sendText(deps.ownerChatId, clean, threadId === undefined ? {} : { threadId })
    } catch (error) {
      log(`не удалось отправить оповещение владельцу: ${describeError(error)}`)
    }
  }

  return {
    async general(key, text) {
      const last = lastSent.get(key)
      if (last !== undefined && now() - last < THROTTLE_MS) {
        log(`(повтор, владельцу не отправлено) ${text}`)
        return
      }
      lastSent.set(key, now())
      await send(text)
    },
    notify: (text) => send(text),
    inTopic: (threadId, text) => send(text, threadId),
    log,
  }
}
