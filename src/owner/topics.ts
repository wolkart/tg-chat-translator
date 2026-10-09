import { MESSAGE_LIMIT, escapeHtml, splitText } from '../html.ts'
import { sendMediaLadder, type LadderResult } from '../media.ts'
import { TelegramError, type TelegramApi } from '../telegram.ts'
import type { Store } from '../store.ts'
import type { Conversation, MediaRef } from '../types.ts'

/** Telegram ограничивает имя темы 128 символами. */
export const TOPIC_NAME_LIMIT = 128

/** Длина куска текста в сообщении. Запас до 4096 — на пометки вроде «Перевод не удался: …». */
const CHUNK = MESSAGE_LIMIT - 512

/** Причина в пометке: ошибки провайдеров бывают длинными, хватит начала. */
const REASON_LIMIT = 300

export function topicName(peerName: string): string {
  return [...(peerName.trim() || 'Собеседник')].slice(0, TOPIC_NAME_LIMIT).join('')
}

export function isThreadNotFound(error: unknown): boolean {
  return error instanceof TelegramError && /thread not found/i.test(error.description)
}

function reason(text: string): string {
  return escapeHtml(text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}…` : text)
}

function chunks(text: string): string[] {
  return splitText(text, CHUNK).map(escapeHtml)
}

/** Перевод, а под ним — свёрнутый оригинал, который раскрывается по нажатию. */
export function renderIncoming(translation: string, original: string): string[] {
  if (translation.length + original.length <= CHUNK) {
    return [`${escapeHtml(translation)}\n<blockquote expandable>${escapeHtml(original)}</blockquote>`]
  }
  return [...chunks(translation), ...chunks(original).map((part) => `<blockquote expandable>${part}</blockquote>`)]
}

/** Перевод не удался — оригинал не теряется, причина видна. */
export function renderUntranslated(original: string, why: string): string[] {
  const parts = chunks(original)
  parts[parts.length - 1] += `\n<i>Перевод не удался: ${reason(why)}</i>`
  return parts
}

/** Реплика на языке владельца или без букв — как есть, без модели. */
export function renderAsIs(original: string): string[] {
  return chunks(original)
}

export function renderOwnerDirect(text: string): string[] {
  const parts = chunks(text)
  parts[0] = `<i>Вы в личке:</i> ${parts[0]}`
  return parts
}

/** Своё вложение владельца без текста: подпись — одна пометка, чтобы оно не выглядело присланным собеседником. */
export function renderOwnerDirectMarker(): string[] {
  return ['<i>Вы в личке</i>']
}

/** Что ушло собеседнику: исходный текст владельца и перевод. */
export function renderSent(original: string, translation: string): string[] {
  const head = chunks(original)
  head[0] = `<i>Вы:</i> ${head[0]}`
  if (!translation) return head
  const tail = chunks(translation)
  tail[0] = `→ ${tail[0]}`
  if (original.length + translation.length <= CHUNK) return [`${head.join('')}\n${tail.join('')}`]
  return [...head, ...tail]
}

/** Telegram не принял отправку: причина и готовый перевод, чтобы ничего не пропало. */
export function renderNotSent(why: string, translation: string): string[] {
  const head = `<b>Не отправлено.</b> ${reason(why)}`
  if (!translation) return [head]
  const parts = chunks(translation)
  if (translation.length <= CHUNK) return [`${head}\nПеревод:\n${parts[0]}`]
  return [`${head}\nПеревод — ниже.`, ...parts]
}

/** Перевод ответа владельца не удался — собеседнику ничего не ушло. */
export function renderNotTranslated(why: string): string[] {
  return [`<b>Не отправлено:</b> перевод не удался — ${reason(why)}`]
}

export function renderUnsupported(peerName: string, label: string): string[] {
  return [`${escapeHtml(peerName)} прислал ${label} — посмотрите в личке`]
}

export function renderOwnerUnsupported(label: string): string[] {
  return [`Вы отправили в личке ${label} — здесь это не показать`]
}

export function renderDryRun(translation: string): string[] {
  const parts = chunks(translation)
  parts[0] = `<i>Холостой прогон: ушло бы —</i> ${parts[0]}`
  return parts
}

/** Подпись к вложению в теме. Не влезла в лимит — лестница отправит её отдельным сообщением. */
export function renderCaption(text: string): string {
  return escapeHtml(text)
}

export type Topics = {
  /** Тема разговора; если её ещё нет — создаётся с именем собеседника. */
  ensure(conversation: Conversation): Promise<number>
  /** Сообщения в тему разговора (уже готовый HTML). Возвращает id сообщений. */
  postText(conversation: Conversation, html: readonly string[]): Promise<number[]>
  /** Вложение в тему разговора по лестнице пересылки. */
  postMedia(conversation: Conversation, media: MediaRef, captionHtml?: string): Promise<LadderResult>
}

export function createTopics(deps: {
  api: TelegramApi
  store: Store
  ownerChatId: number
  now: () => number
  /** Замена секретов: пометки о поломках не должны показывать ключи */
  scrub: (text: string) => string
}): Topics {
  // Кэш: разговор мог получить тему в этом же процессе, а объект Conversation — старый.
  const topicByConversation = new Map<number, number>()

  async function create(conversation: Conversation): Promise<number> {
    const threadId = await deps.api.createTopic(deps.ownerChatId, topicName(conversation.peerName))
    deps.store.setTopic(conversation.id, threadId)
    topicByConversation.set(conversation.id, threadId)
    return threadId
  }

  async function ensure(conversation: Conversation): Promise<number> {
    const known = topicByConversation.get(conversation.id) ?? deps.store.getConversation(conversation.id)?.topicId
    if (known !== undefined && known !== null) return known
    return create(conversation)
  }

  /**
   * Отправка в тему. Владелец мог удалить тему — тогда Telegram ответит «thread not found»:
   * заводим новую с тем же именем и отправляем ещё раз, сообщение не теряется.
   */
  async function inTopic<T>(conversation: Conversation, send: (threadId: number) => Promise<T>): Promise<T> {
    const threadId = await ensure(conversation)
    try {
      return await send(threadId)
    } catch (error) {
      if (!isThreadNotFound(error)) throw error
      return send(await create(conversation))
    }
  }

  function remember(conversation: Conversation, messageIds: number[]): void {
    for (const id of messageIds) deps.store.rememberBotMessage(deps.ownerChatId, id, conversation.id, deps.now())
  }

  return {
    ensure,

    async postText(conversation, html) {
      // Каждая попытка шлёт все части заново: при пересоздании темы старые части остались в удалённой.
      const ids = await inTopic(conversation, async (threadId) => {
        const sent: number[] = []
        for (const part of html) {
          sent.push(await deps.api.sendText(deps.ownerChatId, deps.scrub(part), { threadId, html: true }))
        }
        return sent
      })
      remember(conversation, ids)
      return ids
    },

    async postMedia(conversation, media, captionHtml) {
      const result = await inTopic(conversation, (threadId) =>
        sendMediaLadder(deps.api, deps.ownerChatId, media, {
          threadId,
          html: true,
          ...(captionHtml !== undefined && { caption: deps.scrub(captionHtml) }),
          rethrow: isThreadNotFound,
        }),
      )
      if (result.ok) remember(conversation, result.messageIds)
      return result
    },
  }
}
