import type { BotInfo, BusinessConnectionInfo, InlineAnswerButton, InlineArticle, MediaOptions, TelegramApi } from '../src/telegram.ts'
import type { MediaKind } from '../src/types.ts'

export type Call =
  | { method: 'sendText'; chatId: number; text: string; opts: MediaOptions; id: number }
  | { method: 'sendMedia'; chatId: number; kind: MediaKind; file: string | Uint8Array; opts: MediaOptions; id: number }
  | { method: 'createTopic'; chatId: number; name: string }
  | { method: 'getBusinessConnection'; id: string }
  | { method: 'downloadFile'; fileId: string }
  | { method: 'answerCallback'; callbackId: string; text?: string }
  | { method: 'editText'; chatId: number; messageId: number; text: string }
  | { method: 'deleteMessage'; chatId: number; messageId: number }
  | { method: 'getMe' }
  | { method: 'answerInline'; queryId: string; articles: readonly InlineArticle[]; button?: InlineAnswerButton }

type Method = Call['method']

/**
 * Подделка Telegram API: записывает каждый вызов и умеет падать по сценарию.
 * Вызов записывается до падения — так тест видит и неудачную попытку.
 */
export function fakeTelegram(init: { connections?: BusinessConnectionInfo[]; me?: Partial<BotInfo> } = {}) {
  const calls: Call[] = []
  const failures = new Map<Method, Error[]>()
  const connections = new Map((init.connections ?? []).map((c) => [c.id, c]))
  let nextMessageId = 1000
  let nextThreadId = 500

  function maybeFail(method: Method): void {
    const error = failures.get(method)?.shift()
    if (error) throw error
  }

  const api: TelegramApi = {
    async sendText(chatId, text, opts = {}) {
      const id = nextMessageId++
      calls.push({ method: 'sendText', chatId, text, opts, id })
      maybeFail('sendText')
      return id
    },
    async sendMedia(chatId, kind, file, opts = {}) {
      const id = nextMessageId++
      calls.push({ method: 'sendMedia', chatId, kind, file, opts, id })
      maybeFail('sendMedia')
      return id
    },
    async createTopic(chatId, name) {
      calls.push({ method: 'createTopic', chatId, name })
      maybeFail('createTopic')
      return nextThreadId++
    },
    async getBusinessConnection(id) {
      calls.push({ method: 'getBusinessConnection', id })
      maybeFail('getBusinessConnection')
      const connection = connections.get(id)
      if (!connection) throw new Error(`нет подключения ${id}`)
      return connection
    },
    async downloadFile(fileId) {
      calls.push({ method: 'downloadFile', fileId })
      maybeFail('downloadFile')
      return new Uint8Array([1, 2, 3])
    },
    async answerCallback(callbackId, text) {
      calls.push({ method: 'answerCallback', callbackId, text })
      maybeFail('answerCallback')
    },
    async editText(chatId, messageId, text) {
      calls.push({ method: 'editText', chatId, messageId, text })
      maybeFail('editText')
    },
    async deleteMessage(chatId, messageId) {
      calls.push({ method: 'deleteMessage', chatId, messageId })
      maybeFail('deleteMessage')
    },
    async getMe() {
      calls.push({ method: 'getMe' })
      maybeFail('getMe')
      return {
        id: 300003,
        username: 'translator_test_bot',
        canConnectToBusiness: true,
        hasTopicsEnabled: true,
        supportsInlineQueries: true,
        ...init.me,
      }
    },
    async answerInline(queryId, articles, opts = {}) {
      calls.push({ method: 'answerInline', queryId, articles, ...(opts.button && { button: opts.button }) })
      maybeFail('answerInline')
    },
  }

  return {
    api,
    calls,
    /** Следующий вызов method упадёт с этой ошибкой. Можно поставить несколько подряд. */
    failNext(method: Method, error: Error): void {
      failures.set(method, [...(failures.get(method) ?? []), error])
    },
    callsOf<M extends Method>(method: M): Extract<Call, { method: M }>[] {
      return calls.filter((call): call is Extract<Call, { method: M }> => call.method === method)
    },
    /** Всё, что ушло от имени владельца — через подключение к его аккаунту. */
    sentAsOwner(): Call[] {
      return calls.filter(
        (call) => (call.method === 'sendText' || call.method === 'sendMedia') && call.opts.businessConnectionId !== undefined,
      )
    },
  }
}
