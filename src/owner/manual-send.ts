import { alertModelFailure } from '../alerts.ts'
import type { Deps } from '../deps.ts'
import { MESSAGE_LIMIT, escapeHtml, splitText } from '../html.ts'
import { TelegramError, describeError, type InlineButton } from '../telegram.ts'
import type { Draft, OwnerPayload } from '../types.ts'

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
export const FIRST_TEXT_ONLY = 'Первым бот отправляет только текст — вложение отправьте собеседнику в личке сами.'
export const DRAFT_EXPIRED = 'Перевод устарел — напишите заново'
/** Подпись варианта в inline-ответе: что будет по нажатию. */
export const INLINE_HINT = 'Нажмите — уйдёт от вашего имени'
/** Заголовок варианта: начало перевода, длиннее Telegram всё равно обрежет. */
const TITLE_LIMIT = 64

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

/** Части HTML в чат владельца вне тем: ответом на его сообщение, кнопки — под последней. */
async function replyToOwner(deps: Deps, replyTo: number, html: readonly string[], keyboard?: InlineButton[][]): Promise<void> {
  for (const [index, part] of html.entries()) {
    const last = index === html.length - 1
    await deps.api.sendText(deps.ownerId, part, {
      html: true,
      ...(index === 0 && { replyTo }),
      ...(last && keyboard && keyboard.length > 0 && { keyboard }),
    })
  }
}

/**
 * «Написать первым»: текст владельца → перевод на язык собеседника из пары → ответ на его
 * сообщение с кнопками ручной отправки. Никому ничего не уходит само. Истории нет: разговора
 * с этим человеком ещё нет, и подсунуть модели закладку из чужих реплик некому. Проверка — та
 * же, что у ответа, который бот отправил бы сам: подозрительный перевод кнопок не получает.
 */
export async function newPeerDraft(deps: Deps, payload: OwnerPayload): Promise<void> {
  if (payload.media) {
    await deps.api.sendText(deps.ownerId, FIRST_TEXT_ONLY, { replyTo: payload.sourceMessageId })
    return
  }
  if (!deps.translator || !deps.languages) {
    const problem = deps.translatorProblem ?? deps.languagesProblem ?? 'переводчик не настроен'
    await replyToOwner(deps, payload.sourceMessageId, renderDraftFailed(problem))
    return
  }

  let translation: string
  try {
    translation = await deps.translator({ target: deps.languages.peer, history: [], text: payload.text })
  } catch (error) {
    await alertModelFailure(deps.alerts, error)
    await replyToOwner(deps, payload.sourceMessageId, renderDraftFailed(describeError(error)))
    return
  }

  const review = deps.review({
    direction: 'outgoing',
    original: payload.text,
    translation,
    owner: deps.languages.owner,
    target: deps.languages.peer,
  })
  if (review.verdict !== 'ok') {
    await replyToOwner(deps, payload.sourceMessageId, renderSuspiciousDraft(translation))
    return
  }

  const draft = deps.store.createDraft({
    ownerId: deps.ownerId,
    conversationId: null,
    original: payload.text,
    translation,
    now: deps.now(),
  })
  await replyToOwner(
    deps,
    payload.sourceMessageId,
    renderDraft(newPeerHead(deps.languages.peer.nameRu), draft.translation),
    manualKeyboard(draft, { inline: await deps.inlineEnabled(), media: false }),
  )
}

/** Ответ Telegram на inline-запрос, на который отвечать уже поздно. */
const STALE_QUERY = /query is too old|query id is invalid/i

function titleOf(translation: string): string {
  const firstLine = translation.split('\n')[0]!
  return firstLine.length > TITLE_LIMIT ? `${firstLine.slice(0, TITLE_LIMIT - 1)}…` : firstLine
}

/**
 * Ответ на inline-запрос «@бот <номер>» — его подставляет кнопка «Отправить через бота».
 * Вызывается только для владельца (фильтр в app.ts), перевод ищется среди его живых. Номера
 * нет — ответ пустой. Номер есть, а перевода нет — вариантов нет, а кнопка
 * над ними ведёт в чат с ботом написать заново.
 */
export async function answerInline(deps: Deps, query: { id: string; query: string }): Promise<void> {
  const text = query.query.trim()
  // «@бот» без номера — владелец просто набирает имя бота: сообщать, что «перевод устарел»,
  // не о чем, и кнопку показывать незачем.
  const numeric = /^\d{1,15}$/.test(text)
  const draft = numeric ? deps.store.getDraft(deps.ownerId, Number(text), deps.now()) : undefined
  try {
    if (!numeric) {
      await deps.api.answerInline(query.id, [])
      return
    }
    if (!draft) {
      await deps.api.answerInline(query.id, [], { button: { text: DRAFT_EXPIRED, startParameter: 'draft' } })
      return
    }
    await deps.api.answerInline(query.id, [
      { id: String(draft.id), title: titleOf(draft.translation), description: INLINE_HINT, text: draft.translation },
    ])
  } catch (error) {
    // После простоя Telegram может доставить старые inline-запросы: отвечать на них поздно,
    // а сообщение владельцу «не удалось ответить» про кнопку, которую он давно нажал, —
    // лишний шум. Любая другая ошибка пробрасывается: владелец должен о ней узнать.
    if (error instanceof TelegramError && STALE_QUERY.test(error.description)) {
      deps.alerts.log('inline-запрос устарел — ответ не нужен')
      return
    }
    throw error
  }
}
