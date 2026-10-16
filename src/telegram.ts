import { GrammyError, HttpError, InputFile, type Api } from 'grammy'
import type { BusinessConnection, InlineKeyboardButton } from 'grammy/types'
import type { MediaKind } from './types.ts'

/** Цвет кнопки (Bot API 9.4): зелёный — главное действие экрана, красный — «Отключить»/«Удалить». */
export type ButtonStyle = 'success' | 'primary' | 'danger'

type ButtonBase = { text: string; style?: ButtonStyle }

/**
 * Кнопка под сообщением. Вид задаёт заполненное поле, ровно одно: иначе `{ text }` без
 * действия проходил бы проверку типов, а в Telegram уходил бы с пустым callback_data.
 * - data — нажатие приходит боту;
 * - copy — текст ложится в буфер обмена (copy_text: Telegram принимает до 256 символов);
 * - chooseChat — выбор личного чата и inline-запрос «@бот <chooseChat>» в нём
 *   (switch_inline_query_chosen_chat).
 */
export type InlineButton = ButtonBase &
  (
    | { data: string; copy?: never; chooseChat?: never }
    | { copy: string; data?: never; chooseChat?: never }
    | { chooseChat: string; data?: never; copy?: never }
  )

/** Вариант в ответе на inline-запрос: нажатие отправляет text обычным сообщением. */
export type InlineArticle = { id: string; title: string; description: string; text: string }

/** Кнопка над вариантами inline-ответа: открывает чат с ботом с /start <startParameter>. */
export type InlineAnswerButton = { text: string; startParameter: string }

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

/** Правка сообщения: html — разметка (текст уже прошёл escapeHtml), keyboard — новые кнопки. */
export type EditOptions = { html?: boolean; keyboard?: InlineButton[][] }

/** Команда в меню бота: «/start — Настройки и статус». */
/** Область меню команд: общая или только личные чаты. */
export type CommandScope = 'default' | 'all_private_chats'
export type BotCommand = { command: string; description: string }

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
  /** Inline Mode в BotFather: без него не работает кнопка «Отправить через бота» */
  supportsInlineQueries: boolean
  /** Пользователям разрешено создавать темы — так появляются темы, которых бот не знает */
  allowsUsersToCreateTopics: boolean
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

/**
 * Токен отвергнут: неверный Telegram отвергает кодом 401, а токен не того вида — кодом 404.
 * Повторять с тем же токеном бессмысленно.
 */
export function isTokenRejected(code: number): boolean {
  return code === 401 || code === 404
}

/**
 * Ошибка приходит в двух видах: от нашей обёртки (getMe при старте) и от grammY напрямую
 * (bot.start бросает GrammyError, когда перестаёт опрашивать). Распознавание живёт здесь, а не
 * в ядре, чтобы остальной код не зависел от библиотеки.
 */
export function telegramFailure(error: unknown): { code: number; description: string } | null {
  if (error instanceof TelegramError) return { code: error.code, description: error.description }
  if (error instanceof GrammyError) return { code: error.error_code, description: error.description }
  return null
}

/** Запрос не дошёл до Telegram (нет сети, обрыв) — ответа с кодом нет вовсе. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof HttpError
}

/** Человеческое описание любой ошибки — для пометок в теме и оповещений. */
export function describeError(error: unknown): string {
  if (error instanceof TelegramError) return error.description
  if (error instanceof Error) return error.message
  return String(error)
}

/** Ошибка Bot API, чьё описание подходит под шаблон: коды отказов Telegram узнаём по тексту. */
export function isTelegramError(error: unknown, pattern: RegExp): boolean {
  return error instanceof TelegramError && pattern.test(error.description)
}

/**
 * Telegram отвечает ошибкой, если правка ничего не меняет. Для панели это не поломка:
 * «🔄 Обновить» при том же состоянии и должен оставить экран прежним.
 */
export function isNotModified(error: unknown): boolean {
  return isTelegramError(error, /message is not modified/i)
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
  editText(chatId: number, messageId: number, text: string, opts?: EditOptions): Promise<void>
  deleteMessage(chatId: number, messageId: number): Promise<void>
  getMe(): Promise<BotInfo>
  /** Меню команд в чате с ботом */
  setCommands(commands: readonly BotCommand[], scope?: CommandScope): Promise<void>
  /** Ответ на inline-запрос: виден только тому, кто спросил, и не кэшируется */
  answerInline(queryId: string, articles: readonly InlineArticle[], opts?: { button?: InlineAnswerButton }): Promise<void>
}

/** Кнопки в формате Bot API. Вынесено из обёртки, чтобы преобразование проверялось тестом. */
export function toInlineKeyboard(keyboard: readonly (readonly InlineButton[])[]): InlineKeyboardButton[][] {
  return keyboard.map((row) =>
    row.map((button): InlineKeyboardButton => {
      const style = button.style && { style: button.style }
      if (button.copy !== undefined) return { text: button.text, copy_text: { text: button.copy }, ...style }
      if (button.chooseChat !== undefined) {
        // Только личные чаты с людьми: перевод адресован собеседнику, а не группе или боту.
        return {
          text: button.text,
          switch_inline_query_chosen_chat: { query: button.chooseChat, allow_user_chats: true },
          ...style,
        }
      }
      return { text: button.text, callback_data: button.data, ...style }
    }),
  )
}

/**
 * Параметры правки сообщения. Без opts — ничего лишнего: так правятся «Кому?» и подтверждения,
 * как и раньше. С opts — разметка, кнопки и без превью ссылок: в панели есть адреса
 * (openrouter.ai/keys), и карточка сайта под экраном только мешала бы.
 */
export function editOptions(opts?: EditOptions) {
  if (!opts) return undefined
  return {
    ...(opts.html && { parse_mode: 'HTML' as const }),
    ...(opts.keyboard && { reply_markup: { inline_keyboard: toInlineKeyboard(opts.keyboard) } }),
    link_preview_options: { is_disabled: true },
  }
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
      ...(opts.keyboard && { reply_markup: { inline_keyboard: toInlineKeyboard(opts.keyboard) } }),
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

    async editText(chatId, messageId, text, opts) {
      await call(() => api.editMessageText(chatId, messageId, text, editOptions(opts)))
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
        supportsInlineQueries: me.supports_inline_queries,
        allowsUsersToCreateTopics: me.allows_users_to_create_topics,
      }
    },

    async setCommands(commands, scope = 'default') {
      await call(() => (scope === 'default' ? api.setMyCommands([...commands]) : api.setMyCommands([...commands], { scope: { type: scope } })))
    },

    async answerInline(queryId, articles, opts) {
      const results = articles.map((article) => ({
        type: 'article' as const,
        id: article.id,
        title: article.title,
        description: article.description,
        // Без parse_mode: у собеседника перевод выглядит обычным текстом владельца.
        input_message_content: { message_text: article.text },
      }))
      await call(() =>
        api.answerInlineQuery(queryId, results, {
          // Без is_personal Telegram отдал бы закэшированный ответ другому человеку с тем же
          // запросом — а в ответе перевод владельца.
          is_personal: true,
          cache_time: 0,
          ...(opts?.button && { button: { text: opts.button.text, start_parameter: opts.button.startParameter } }),
        }),
      )
    },
  }
}
