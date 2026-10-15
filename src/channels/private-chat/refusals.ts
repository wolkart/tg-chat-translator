import { describeError, isTelegramError } from '../../telegram.ts'
import { SETTINGS_PATH } from './connection.ts'

/**
 * Отказ Telegram в отправке от имени владельца, который мы узнаём по коду в описании ошибки.
 * Коды сняты живьём 2026-10-11. Таблица, а не switch: новый код — новая строка.
 */
export type SendRefusal = {
  match: RegExp
  /** Понятная причина: что случилось и что сделать */
  text: (peerName: string) => string
}

export const SEND_REFUSALS: readonly SendRefusal[] = [
  {
    // Правило суток: от имени владельца — только в чат, где недавно писали. Окно открывает и
    // сообщение самого владельца (живая проверка 2026-10-14), поэтому после ручной отправки бот
    // снова пишет сам, не дожидаясь ответа собеседника.
    match: /BUSINESS_PEER_USAGE_MISSING/,
    text: (name) =>
      `от ${name} давно не было сообщений, а от вашего имени бот может писать только тем, кто писал вам недавно. ` +
      'Отправьте перевод сами — кнопками ниже: после этого бот снова будет отправлять сам.',
  },
  {
    // Чата нет среди чатов бота: «Только выбранные чаты» без этого человека.
    match: /BUSINESS_PEER_INVALID/,
    text: (name) =>
      `бот не видит чат с ${name} — его нет среди чатов, доступных боту. Добавьте его в «Выбранные чаты»: ${SETTINGS_PATH}. ` +
      'Пока отправьте перевод сами — кнопками ниже.',
  },
]

/** Права «Ответы на сообщения» нет — бот и не пробует отправлять. */
export const NO_REPLY_RIGHT = `боту не разрешено отвечать от вашего имени. Включите «Ответы на сообщения» (раздел «Сообщения»): ${SETTINGS_PATH}.`

/** Владелец отключил бота от аккаунта — отправлять не через что. */
export const BOT_DISCONNECTED = `бот отключён от вашего аккаунта. Подключите его снова: ${SETTINGS_PATH}.`

/** Отказ подключения: повтор с загрузкой вложения заново ничего не даст. */
export function isFinalRefusal(error: unknown): boolean {
  return SEND_REFUSALS.some((refusal) => isTelegramError(error, refusal.match))
}

/** Причина «Не отправлено»: знакомый отказ — по таблице, незнакомый — словами Telegram. */
export function refusalText(error: unknown, peerName: string): string {
  const description = describeError(error)
  const known = SEND_REFUSALS.find((refusal) => refusal.match.test(description))
  return known ? known.text(peerName) : `Telegram не принял сообщение — ${description}`
}
