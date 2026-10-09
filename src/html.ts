/**
 * Экранирование перед вставкой в сообщение с parse_mode: HTML.
 *
 * Текст пишет собеседник, а переписывает модель — управляем им не мы. Один
 * символ `<` заставит Telegram отклонить сообщение целиком, и перевод
 * потеряется; а специально составленный текст протащил бы свою разметку и ссылки.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Лимит Telegram на видимый текст одного сообщения. */
export const MESSAGE_LIMIT = 4096

/** Лимит Telegram на подпись к вложению. */
export const CAPTION_LIMIT = 1024

const SEPARATORS = ['\n\n', '\n', ' ']

/**
 * Делит текст на части не длиннее limit: сначала по абзацам, потом по строкам,
 * потом по пробелам. Разделитель остаётся в конце части, поэтому склейка частей
 * даёт исходный текст символ в символ — ничего не теряется.
 */
export function splitText(text: string, limit = MESSAGE_LIMIT): string[] {
  const parts: string[] = []
  let rest = text

  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = 0
    for (const separator of SEPARATORS) {
      const at = window.lastIndexOf(separator)
      if (at > 0) {
        cut = at + separator.length
        break
      }
    }
    if (cut === 0) {
      cut = limit
      // Не режем эмодзи пополам: половинка суррогатной пары превращается в «�».
      const code = rest.charCodeAt(cut - 1)
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1
    }
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }

  parts.push(rest)
  return parts
}
