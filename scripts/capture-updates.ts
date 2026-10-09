/**
 * Одноразовый сбор сырых апдейтов для образцов test/fixtures (Task 3 плана).
 *
 * Запуск: node scripts/capture-updates.ts — бот слушает, каждый апдейт ложится
 * в data/captured/ (каталог в .gitignore: там настоящие id и тексты).
 * Команды владельца в чате с ботом:
 *   /post   — бот пишет сообщение в эту же тему: на него потом «Ответить» из ленты «Все»
 *   /button — бот присылает сообщение с кнопкой: нажатие даст образец callback_query
 *   /send   — бот пишет Timon от имени владельца: так в образцы попадает эхо своей отправки
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Bot } from 'grammy'
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

const bot = new Bot(botToken)
mkdirSync('data/captured', { recursive: true })
let counter = 0

bot.use(async (ctx) => {
  const kind = Object.keys(ctx.update).find((key) => key !== 'update_id') ?? 'unknown'
  const file = `data/captured/${String(++counter).padStart(3, '0')}-${kind}.json`
  writeFileSync(file, JSON.stringify(ctx.update, null, 2) + '\n')
  console.log(`сохранён ${file}`)

  const message = ctx.message
  if (message?.from?.id === ownerId && message.text === '/post') {
    await ctx.api.sendMessage(ownerId, 'Сообщение бота — ответьте на него кнопкой «Ответить» из ленты «Все»', {
      ...(message.message_thread_id !== undefined && { message_thread_id: message.message_thread_id }),
    })
  }
  if (message?.from?.id === ownerId && message.text === '/button') {
    await ctx.api.sendMessage(ownerId, 'Нажмите кнопку', {
      reply_markup: { inline_keyboard: [[{ text: 'Нажми', callback_data: 'to:1:1' }]] },
    })
  }
  // Без своей отправки от имени владельца образец эха снять неоткуда: сам Telegram
  // эхо не присылает, пока бот ничего не отправил.
  if (message?.from?.id === ownerId && message.text === '/send') {
    if (!peerChatId || !connectionId) {
      console.error('Для /send нужны TEST_PEER_CHAT_ID и TEST_BUSINESS_CONNECTION_ID в .env')
    } else {
      const sent = await ctx.api.sendMessage(peerChatId, 'Проверка эха — отвечать не нужно', {
        business_connection_id: connectionId,
      })
      console.log(`отправлено Timon от имени владельца, id ${sent.message_id} — ждём эхо`)
    }
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery()
})

console.log('Слушаю апдейты. Остановить — Ctrl+C.')
await bot.start({ allowed_updates: ['business_connection', 'business_message', 'message', 'callback_query'] })
