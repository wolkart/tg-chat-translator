import type { Message } from 'grammy/types'
import { CAPTION_LIMIT } from './html.ts'
import { describeError, type SendOptions, type TelegramApi } from './telegram.ts'
import type { MediaKind, MediaRef } from './types.ts'

type Extracted = { fileId: string; fileSize?: number; fileName?: string }

/** Тип вложения: как достать файл из сообщения и умеет ли Telegram подпись к нему. */
export type MediaSpec = {
  kind: MediaKind
  /** Как назвать в пометке: «прислал фото» */
  label: string
  caption: boolean
  extract: (message: Message) => Extracted | undefined
}

// Порядок важен: у GIF Telegram заполняет и animation, и document — GIF должен найтись первым.
export const MEDIA: readonly MediaSpec[] = [
  {
    kind: 'photo',
    label: 'фото',
    caption: true,
    extract: (m) => {
      const largest = m.photo?.at(-1)
      return largest && { fileId: largest.file_id, fileSize: largest.file_size }
    },
  },
  {
    kind: 'animation',
    label: 'GIF',
    caption: true,
    extract: (m) => m.animation && { fileId: m.animation.file_id, fileSize: m.animation.file_size, fileName: m.animation.file_name },
  },
  {
    kind: 'video',
    label: 'видео',
    caption: true,
    extract: (m) => m.video && { fileId: m.video.file_id, fileSize: m.video.file_size, fileName: m.video.file_name },
  },
  {
    kind: 'voice',
    label: 'голосовое',
    caption: true,
    extract: (m) => m.voice && { fileId: m.voice.file_id, fileSize: m.voice.file_size },
  },
  {
    kind: 'video_note',
    label: 'кружок',
    caption: false,
    extract: (m) => m.video_note && { fileId: m.video_note.file_id, fileSize: m.video_note.file_size },
  },
  {
    kind: 'audio',
    label: 'аудио',
    caption: true,
    extract: (m) => m.audio && { fileId: m.audio.file_id, fileSize: m.audio.file_size, fileName: m.audio.file_name },
  },
  {
    kind: 'document',
    label: 'файл',
    caption: true,
    extract: (m) => m.document && { fileId: m.document.file_id, fileSize: m.document.file_size, fileName: m.document.file_name },
  },
  {
    kind: 'sticker',
    label: 'стикер',
    caption: false,
    extract: (m) => m.sticker && { fileId: m.sticker.file_id, fileSize: m.sticker.file_size },
  },
]

export function mediaSpec(kind: MediaKind): MediaSpec {
  const spec = MEDIA.find((candidate) => candidate.kind === kind)
  if (!spec) throw new Error(`неизвестный тип вложения ${kind}`)
  return spec
}

export function extractMedia(message: Message): MediaRef | null {
  for (const spec of MEDIA) {
    const found = spec.extract(message)
    if (found) return { kind: spec.kind, ...found }
  }
  return null
}

// Что переслать нельзя. Порядок важен: у места (venue) есть и геопозиция.
const UNSUPPORTED: readonly { has: (m: Message) => boolean; label: string }[] = [
  { has: (m) => m.venue !== undefined, label: 'место на карте' },
  { has: (m) => m.location !== undefined, label: 'геопозицию' },
  { has: (m) => m.contact !== undefined, label: 'контакт' },
  { has: (m) => m.poll !== undefined, label: 'опрос' },
  { has: (m) => m.dice !== undefined, label: 'кубик' },
  { has: (m) => m.game !== undefined, label: 'игру' },
  { has: (m) => m.story !== undefined, label: 'историю' },
  { has: (m) => m.paid_media !== undefined, label: 'платное вложение' },
  { has: (m) => m.invoice !== undefined, label: 'счёт' },
]

/**
 * Что прислали, если показать это в теме нельзя. null — показать можно
 * (есть текст или вложение) или это служебное сообщение, о котором молчим.
 */
export function unsupportedLabel(message: Message): string | null {
  if (message.text || message.caption || extractMedia(message)) return null
  return UNSUPPORTED.find((item) => item.has(message))?.label ?? null
}

/** Больше 20 МБ Bot API скачать не даёт. */
export const DOWNLOAD_LIMIT = 20 * 1024 * 1024

export type LadderResult = { ok: true; messageIds: number[] } | { ok: false; reason: string }

/**
 * Лестница пересылки: по file_id → скачать и загрузить заново → отказ с причиной.
 * Подпись, которая не влезает (или к такому вложению не положена), уходит следом
 * отдельным сообщением — ничего не теряется.
 *
 * rethrow — ошибки, на которых лестница не должна идти дальше: например, «тема
 * не найдена» — её чинит вызывающий, создав новую тему.
 */
export async function sendMediaLadder(
  api: TelegramApi,
  chatId: number,
  media: MediaRef,
  opts: SendOptions & { caption?: string; rethrow?: (error: unknown) => boolean },
): Promise<LadderResult> {
  const { caption, rethrow, ...base } = opts
  const spec = mediaSpec(media.kind)
  const captionFits = Boolean(caption) && spec.caption && caption!.length <= CAPTION_LIMIT
  const mediaOpts = { ...base, ...(captionFits && { caption }) }

  const rungs: (() => Promise<number>)[] = [
    () => api.sendMedia(chatId, media.kind, media.fileId, mediaOpts),
    async () => {
      if (media.fileSize !== undefined && media.fileSize > DOWNLOAD_LIMIT) {
        throw new Error('файл больше 20 МБ — Telegram не даёт боту его скачать')
      }
      const bytes = await api.downloadFile(media.fileId)
      return api.sendMedia(chatId, media.kind, bytes, { ...mediaOpts, fileName: media.fileName })
    },
  ]

  let lastError: unknown
  for (const rung of rungs) {
    let messageId: number
    try {
      messageId = await rung()
    } catch (error) {
      if (rethrow?.(error)) throw error
      lastError = error
      continue
    }
    const messageIds = [messageId]
    if (caption && !captionFits) messageIds.push(await api.sendText(chatId, caption, base))
    return { ok: true, messageIds }
  }
  return { ok: false, reason: describeError(lastError) }
}
