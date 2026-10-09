/**
 * Живая проверка вложений (Task 3 плана, пункт 2.1 из tasks.md).
 *
 * Timon присылает владельцу в личку фото, голосовое и стикер. Для каждого скрипт
 * пробует первую ступень лестницы — отправку по file_id:
 *   1) в тему «Проверка вложений» в чате владельца с ботом;
 *   2) от имени владельца обратно Timon.
 * Потом ждёт эхо: приходит ли business_message на отправленное ботом и есть ли в нём
 * sender_business_bot. Итог — в консоль и в ту же тему.
 *
 * Запуск: node scripts/check-media.ts. Нужны TEST_PEER_CHAT_ID и
 * TEST_BUSINESS_CONNECTION_ID в .env.
 */
import { readFileSync } from 'node:fs'
import { Bot, GrammyError } from 'grammy'
import type { Message } from 'grammy/types'
import { loadEnv, parseDotEnv } from '../src/env.ts'

const result = loadEnv()
if (!result.ok) {
  console.error(`Не заполнено в .env: ${result.missing.join(', ')}`)
  process.exit(1)
}
const { botToken, ownerId } = result.env
const raw = parseDotEnv(readFileSync('.env', 'utf8'))
const peerChatId = Number(raw.TEST_PEER_CHAT_ID)
const connectionId = raw.TEST_BUSINESS_CONNECTION_ID
if (!peerChatId || !connectionId) {
  console.error('Нужны TEST_PEER_CHAT_ID и TEST_BUSINESS_CONNECTION_ID в .env')
  process.exit(1)
}

const bot = new Bot(botToken)
const topic = await bot.api.createForumTopic(ownerId, 'Проверка вложений')
const threadId = topic.message_thread_id
const sentToPeer = new Map<number, string>()

type Kind = 'photo' | 'voice' | 'sticker'

function mediaOf(message: Message): { kind: Kind; fileId: string } | null {
  const photo = message.photo?.at(-1)
  if (photo) return { kind: 'photo', fileId: photo.file_id }
  if (message.voice) return { kind: 'voice', fileId: message.voice.file_id }
  if (message.sticker) return { kind: 'sticker', fileId: message.sticker.file_id }
  return null
}

function send(kind: Kind, chatId: number, fileId: string, other: { message_thread_id?: number; business_connection_id?: string }) {
  if (kind === 'photo') return bot.api.sendPhoto(chatId, fileId, other)
  if (kind === 'voice') return bot.api.sendVoice(chatId, fileId, other)
  return bot.api.sendSticker(chatId, fileId, other)
}

function why(error: unknown): string {
  return error instanceof GrammyError ? `${error.error_code} ${error.description}` : String(error)
}

async function report(line: string): Promise<void> {
  console.log(line)
  await bot.api.sendMessage(ownerId, line, { message_thread_id: threadId })
}

bot.on('business_message', async (ctx) => {
  const message = ctx.businessMessage

  // Эхо узнаём и по sender_business_bot, и по id своей отправки: эхо без
  // sender_business_bot иначе выглядело бы как «своё сообщение владельца» и молча
  // отсеялось бы фильтром ниже — а именно этот случай проверка и должна поймать.
  const sentKind = sentToPeer.get(message.message_id)
  if (message.sender_business_bot || sentKind) {
    const kind = sentKind ?? `сообщение ${message.message_id}`
    const marker = message.sender_business_bot
      ? `sender_business_bot = @${message.sender_business_bot.username}`
      : 'БЕЗ sender_business_bot'
    await report(`Эхо пришло: ${kind}, ${marker}`)
    return
  }
  if (message.chat.id !== peerChatId || message.from?.id === ownerId) return

  const media = mediaOf(message)
  if (!media) return

  try {
    await send(media.kind, ownerId, media.fileId, { message_thread_id: threadId })
    await report(`${media.kind} → тема владельца по file_id: принято`)
  } catch (error) {
    await report(`${media.kind} → тема владельца по file_id: отказ — ${why(error)}`)
  }

  try {
    const sent = await send(media.kind, peerChatId, media.fileId, { business_connection_id: connectionId })
    sentToPeer.set(sent.message_id, media.kind)
    await report(`${media.kind} → Timon от имени владельца по file_id: принято (id ${sent.message_id}), жду эхо…`)
  } catch (error) {
    await report(`${media.kind} → Timon от имени владельца по file_id: отказ — ${why(error)}`)
  }
})

await report('Готов. Пусть Timon пришлёт в личку фото, голосовое и стикер. Остановить — Ctrl+C.')
await bot.start({ allowed_updates: ['business_message'] })
