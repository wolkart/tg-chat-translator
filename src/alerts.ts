import { describeError, type TelegramApi } from './telegram.ts'

/** Короче — не секрет, а слово вроде «true»: заменять такое значит портить текст. */
const SECRET_MIN_LENGTH = 9

/**
 * Замена секретов на ***. Ошибки внешних сервисов иногда цитируют запрос целиком —
 * вместе с ключом или токеном в адресе. Владелец и консоль их видеть не должны.
 * Укрывает как исходные значения, так и URL-кодированные варианты (`:` → `%3A`).
 * Объединяет перекрывающиеся или соседние диапазоны в один `***`.
 */
export function createScrubber(secrets: readonly string[]): (text: string) => string {
  // Собираем все варианты: исходные и URL-кодированные.
  const variants = new Set<string>()
  for (const value of secrets) {
    if (value.length >= SECRET_MIN_LENGTH) {
      variants.add(value)
      const encoded = encodeURIComponent(value)
      if (encoded !== value) {
        variants.add(encoded)
      }
    }
  }

  return (text) => {
    if (variants.size === 0) return text

    // Находим все вхождения всех вариантов и собираем диапазоны [start, end).
    const ranges: Array<[number, number]> = []
    for (const variant of variants) {
      let index = 0
      while ((index = text.indexOf(variant, index)) !== -1) {
        ranges.push([index, index + variant.length])
        index += 1
      }
    }

    if (ranges.length === 0) return text

    // Сортируем по началу, затем объединяем перекрывающиеся или соседние диапазоны.
    ranges.sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = [ranges[0]!]
    for (let i = 1; i < ranges.length; i++) {
      const current = ranges[i]!
      const last = merged[merged.length - 1]!
      if (current[0] <= last[1]) {
        // Перекрытие или соседство: объединяем.
        last[1] = Math.max(last[1], current[1])
      } else {
        // Зазор: добавляем новый диапазон.
        merged.push(current)
      }
    }

    // Строим результат, заменяя каждый диапазон на ***.
    let result = ''
    let lastEnd = 0
    for (const [start, end] of merged) {
      result += text.slice(lastEnd, start) + '***'
      lastEnd = end
    }
    result += text.slice(lastEnd)
    return result
  }
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
  // Возвращает true, если отправка прошла, false если упала.
  async function send(text: string, threadId?: number): Promise<boolean> {
    const clean = deps.scrub(text)
    log(clean)
    try {
      await deps.api.sendText(deps.ownerChatId, clean, threadId === undefined ? {} : { threadId })
      return true
    } catch (error) {
      log(`не удалось отправить оповещение владельцу: ${describeError(error)}`)
      return false
    }
  }

  return {
    async general(key, text) {
      const last = lastSent.get(key)
      if (last !== undefined && now() - last < THROTTLE_MS) {
        log(`(повтор, владельцу не отправлено) ${text}`)
        return
      }
      // Сорвавшаяся отправка не должна включать троттлинг: если владелец не получил
      // сообщение, повтор не должен быть подавлен. Только успешная отправка начинает
      // отсчёт 10-минутного окна.
      const previousTimestamp = lastSent.get(key)
      lastSent.set(key, now())
      const sent = await send(text)
      if (!sent) {
        // Отправка упала: восстанавливаем предыдущее состояние.
        if (previousTimestamp === undefined) {
          lastSent.delete(key)
        } else {
          lastSent.set(key, previousTimestamp)
        }
      }
    },
    async notify(text) {
      await send(text)
    },
    async inTopic(threadId, text) {
      await send(text, threadId)
    },
    log,
  }
}

/** Модель не перевела: общее сообщение вне тем. Пометка в теме — отдельно, у каждого сообщения. */
export function alertModelFailure(alerts: Alerts, reason: string): Promise<void> {
  // Ключ постоянный: текст ошибки провайдера меняется от запроса к запросу (id запроса, имя
  // провайдера, время сброса лимита), и ключ из него не дал бы троттлингу сработать.
  return alerts.general(
    'model',
    `Модель не переводит: ${reason}. Пока это так, входящие идут в темы без перевода, ` +
      'а ответы собеседникам не уходят. Проверьте ключ и баланс у провайдера.',
  )
}
