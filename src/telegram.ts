import { GrammyError, InputFile, type Api } from 'grammy'
import type { BusinessConnection } from 'grammy/types'
import type { MediaKind } from './types.ts'

export type InlineButton = { text: string; data: string }

export type SendOptions = {
  /** Тема в чате владельца с ботом */
  threadId?: number
  /** Ответить на это сообщение */
  replyTo?: number
  /** Отправить от имени владельца через подключение к его аккаунту */
  businessConnectionId?: string
  /** parse_mode: HTML — только для текста, который уже прошёл escapeHtml */
  html?: boolean
  keyboard?: InlineButton[][]
}

export type MediaOptions = SendOptions & { caption?: string; fileName?: string }

export type BusinessConnectionInfo = {
  id: string
  userId: number
  /** Имя владельца аккаунта для сообщений: «Имя Фамилия (@username)» */
  userName: string
  userChatId: number
  canReply: boolean
  isEnabled: boolean
}

export type BotInfo = {
  id: number
  username: string
  canConnectToBusiness: boolean
  hasTopicsEnabled: boolean
}

/** Ошибка Telegram в одном виде — и от настоящего API, и от подделки в тестах. */
export class TelegramError extends Error {
  readonly code: number
  readonly description: string

  constructor(code: number, description: string) {
    super(description)
    this.name = 'TelegramError'
    this.code = code
    this.description = description
  }
}

/** Человеческое описание любой ошибки — для пометок в теме и оповещений. */
export function describeError(error: unknown): string {
  if (error instanceof TelegramError) return error.description
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Подмножество Bot API, которое нужно продукту. Шаги работают с этим интерфейсом,
 * а не с grammy напрямую: в тестах его заменяет подделка, записывающая вызовы.
 */
export interface TelegramApi {
  sendText(chatId: number, text: string, opts?: SendOptions): Promise<number>
  sendMedia(chatId: number, kind: MediaKind, file: string | Uint8Array, opts?: MediaOptions): Promise<number>
  createTopic(chatId: number, name: string): Promise<number>
  getBusinessConnection(id: string): Promise<BusinessConnectionInfo>
  downloadFile(fileId: string): Promise<Uint8Array>
  answerCallback(callbackId: string, text?: string): Promise<void>
  editText(chatId: number, messageId: number, text: string): Promise<void>
  deleteMessage(chatId: number, messageId: number): Promise<void>
  getMe(): Promise<BotInfo>
}

export function toConnectionInfo(connection: BusinessConnection): BusinessConnectionInfo {
  const { user } = connection
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return {
    id: connection.id,
    userId: user.id,
    userName: user.username ? `${name} (@${user.username})` : name,
    userChatId: connection.user_chat_id,
    canReply: connection.rights?.can_reply === true,
    isEnabled: connection.is_enabled,
  }
}

const FILE_NAMES: Record<MediaKind, string> = {
  photo: 'photo.jpg',
  video: 'video.mp4',
  animation: 'animation.mp4',
  voice: 'voice.ogg',
  video_note: 'video_note.mp4',
  audio: 'audio.mp3',
  document: 'file',
  sticker: 'sticker.webp',
}

/** Настоящая реализация поверх grammy. token нужен, чтобы скачать файл по ссылке Telegram. */
export function createTelegramApi(api: Api, token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  // Ошибки grammy переводим в TelegramError, чтобы шаги не зависели от библиотеки.
  async function call<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request()
    } catch (error) {
      if (error instanceof GrammyError) throw new TelegramError(error.error_code, error.description)
      throw error
    }
  }

  function other(opts: MediaOptions = {}) {
    return {
      ...(opts.threadId !== undefined && { message_thread_id: opts.threadId }),
      ...(opts.replyTo !== undefined && {
        reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true },
      }),
      ...(opts.businessConnectionId !== undefined && { business_connection_id: opts.businessConnectionId }),
      ...(opts.html && { parse_mode: 'HTML' as const }),
      ...(opts.caption !== undefined && { caption: opts.caption }),
      ...(opts.keyboard && {
        reply_markup: {
          inline_keyboard: opts.keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
        },
      }),
    }
  }

  type Sender = (chatId: number, file: InputFile | string, opts: MediaOptions) => Promise<{ message_id: number }>

  // Тип вложения → метод Bot API. Таблица, а не switch: новый тип — новая строка.
  const senders: Record<MediaKind, Sender> = {
    photo: (chat, file, opts) => api.sendPhoto(chat, file, other(opts)),
    video: (chat, file, opts) => api.sendVideo(chat, file, other(opts)),
    animation: (chat, file, opts) => api.sendAnimation(chat, file, other(opts)),
    voice: (chat, file, opts) => api.sendVoice(chat, file, other(opts)),
    video_note: (chat, file, opts) => api.sendVideoNote(chat, file, other({ ...opts, caption: undefined })),
    audio: (chat, file, opts) => api.sendAudio(chat, file, other(opts)),
    document: (chat, file, opts) => api.sendDocument(chat, file, other(opts)),
    sticker: (chat, file, opts) => api.sendSticker(chat, file, other({ ...opts, caption: undefined })),
  }

  return {
    async sendText(chatId, text, opts) {
      // От имени владельца сообщение должно выглядеть как написанное им самим, с превью;
      // в чате с ботом превью засоряли бы темы.
      const preview = opts?.businessConnectionId === undefined && { link_preview_options: { is_disabled: true } }
      const message = await call(() => api.sendMessage(chatId, text, { ...other(opts), ...preview }))
      return message.message_id
    },

    async sendMedia(chatId, kind, file, opts = {}) {
      const input = typeof file === 'string' ? file : new InputFile(file, opts.fileName ?? FILE_NAMES[kind])
      const message = await call(() => senders[kind](chatId, input, opts))
      return message.message_id
    },

    async createTopic(chatId, name) {
      const topic = await call(() => api.createForumTopic(chatId, name))
      return topic.message_thread_id
    },

    async getBusinessConnection(id) {
      return toConnectionInfo(await call(() => api.getBusinessConnection(id)))
    },

    async downloadFile(fileId) {
      const file = await call(() => api.getFile(fileId))
      if (!file.file_path) throw new TelegramError(400, 'Telegram не отдал путь к файлу')
      const response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
      if (!response.ok) throw new TelegramError(response.status, `файл не скачался: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },

    async answerCallback(callbackId, text) {
      await call(() => api.answerCallbackQuery(callbackId, text ? { text } : undefined))
    },

    async editText(chatId, messageId, text) {
      await call(() => api.editMessageText(chatId, messageId, text))
    },

    async deleteMessage(chatId, messageId) {
      await call(() => api.deleteMessage(chatId, messageId))
    },

    async getMe() {
      const me = await call(() => api.getMe())
      return {
        id: me.id,
        username: me.username,
        canConnectToBusiness: me.can_connect_to_business,
        hasTopicsEnabled: me.has_topics_enabled,
      }
    },
  }
}
