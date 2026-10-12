import { MESSAGE_LIMIT, escapeHtml, splitText } from '../html.ts'
import type { InlineButton } from '../telegram.ts'
import type { Draft } from '../types.ts'

/**
 * Ручная отправка: когда бот не может или не должен писать от имени владельца сам —
 * владелец пишет первым или Telegram отказал, — владелец получает готовый перевод с
 * кнопками «Отправить через бота» и «Скопировать» и отправляет его в два нажатия.
 */

/** Telegram принимает в кнопке «Скопировать» не больше 256 символов. */
export const COPY_LIMIT = 256

/** Длина куска перевода в одном сообщении. Запас до 4096 — на заголовок и экранирование. */
const CHUNK = MESSAGE_LIMIT - 512

export const SEND_VIA_BOT = 'Отправить через бота'
export const COPY = 'Скопировать'
export const TAP_TO_COPY = 'Нажмите на перевод, чтобы скопировать'
export const SUSPICIOUS_DRAFT = '⚠️ Перевод выглядит подозрительно — отправлять его не предлагаю'

/**
 * Кнопки под переводом. «Отправить через бота» — главное действие, зелёная и в своей строке:
 * рядом с другой длинная кнопка на телефоне обрезалась бы. Её нет, если:
 * - inline: false — Inline Mode выключен, кнопка не сработала бы;
 * - media: true — перевод — подпись к вложению, а через бота ушёл бы один текст без вложения;
 * - перевод длиннее 4096 — вариант inline-ответа — одно сообщение, больше Telegram не пустит.
 */
export function manualKeyboard(draft: Pick<Draft, 'id' | 'translation'>, opts: { inline: boolean; media: boolean }): InlineButton[][] {
  const rows: InlineButton[][] = []
  if (opts.inline && !opts.media && draft.translation.length <= MESSAGE_LIMIT) {
    rows.push([{ text: SEND_VIA_BOT, chooseChat: String(draft.id), style: 'success' }])
  }
  if (draft.translation.length <= COPY_LIMIT) rows.push([{ text: COPY, copy: draft.translation }])
  return rows
}

/**
 * Заголовок и перевод для ручной отправки (HTML, кнопки вешаются на последнюю часть).
 * Короткий перевод — обычным текстом: его копирует кнопка. Длинный кнопка не примет, поэтому
 * он в блоке кода, который Telegram копирует нажатием, и над ним подсказка.
 * head — уже готовый HTML.
 */
export function renderDraft(head: string, translation: string): string[] {
  if (translation.length <= COPY_LIMIT) return [`${head}\n${escapeHtml(translation)}`]
  const parts = splitText(translation, CHUNK).map((part) => `<pre>${escapeHtml(part)}</pre>`)
  parts[0] = `${head}\n<i>${TAP_TO_COPY}:</i>\n${parts[0]}`
  return parts
}

/** Заголовок перевода для нового собеседника: язык — из пары, на него и переводили. */
export function newPeerHead(languageName: string): string {
  return `<i>Перевод для нового собеседника (${escapeHtml(languageName)}):</i>`
}

/** Перевод не прошёл проверку: показываем, но отправлять не предлагаем. */
export function renderSuspiciousDraft(translation: string): string[] {
  const parts = splitText(translation, CHUNK).map(escapeHtml)
  parts[0] = `<i>${SUSPICIOUS_DRAFT}</i>\n${parts[0]}`
  return parts
}

export function renderDraftFailed(reason: string): string[] {
  return [`<i>Перевод не удался: ${escapeHtml(reason)}</i>`]
}
