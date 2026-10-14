/**
 * Одноразовая разведка inline-режима (изменение add-write-first, живая задача плана).
 *
 * Запуск: node scripts/check-inline.ts — основной бот на это время остановлен, иначе апдейты
 * разойдутся между двумя процессами. Каждый апдейт ложится в data/captured/ (каталог в
 * .gitignore: там настоящие id и тексты).
 *
 * Команды владельца в чате с ботом:
 *   /buttons — в тему Timon: сообщение с зелёной «Отправить через бота» и «Скопировать»,
 *              следом длинный текст в <pre> и в <code> — проверить копирование нажатием.
 * Inline-запрос владельца получает один вариант — текст проверки. Для business_message в
 * консоль печатается, есть ли via_bot: от этого зависит, заведёт ли отправка через бота тему.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Bot } from 'grammy'
import { loadEnv, parseDotEnv } from '../src/env.ts'
import { openStore } from '../src/store.ts'

const result = loadEnv()
if (!result.ok) {
  console.error(`Не заполнено в .env: ${result.missing.join(', ')}`)
  process.exit(1)
}
const { botToken, ownerId, dbPath } = result.env
const raw = parseDotEnv(readFileSync('.env', 'utf8'))
const peerChatId = Number(raw.TEST_PEER_CHAT_ID)

// Тема Timon — из базы основного бота: кнопку надо проверить именно в сообщении внутри темы.
const store = openStore(dbPath)
const threadId = store.findConversationByPeer(ownerId, peerChatId)?.topicId ?? undefined
store.close()

const PROBE = 'Inline check: this text was sent via the bot button — no need to reply'
const LONG = 'This is a long text to check copying by tap. '.repeat(8).trim()

const bot = new Bot(botToken)
mkdirSync('data/captured', { recursive: true })
let counter = 0

bot.use(async (ctx) => {
  const kind = Object.keys(ctx.update).find((key) => key !== 'update_id') ?? 'unknown'
  const file = `data/captured/${String(++counter).padStart(3, '0')}-inline-${kind}.json`
  writeFileSync(file, JSON.stringify(ctx.update, null, 2) + '\n')
  console.log(`сохранён ${file}`)

  const business = ctx.update.business_message
  if (business) {
    console.log(`  business_message от ${business.from?.id === ownerId ? 'владельца' : 'собеседника'}, via_bot: ${business.via_bot ? `@${business.via_bot.username}` : 'нет'}`)
  }

  const message = ctx.message
  if (message?.from?.id === ownerId && message.text === '/buttons') {
    const where = threadId === undefined ? {} : { message_thread_id: threadId }
    if (threadId === undefined) console.log('Темы Timon в базе нет — кнопки уйдут вне тем')
    await ctx.api.sendMessage(ownerId, `Проверка кнопок:\n${PROBE}`, {
      ...where,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Отправить через бота', switch_inline_query_chosen_chat: { query: '1', allow_user_chats: true }, style: 'success' }],
          [{ text: 'Скопировать', copy_text: { text: PROBE } }],
        ],
      },
    })
    await ctx.api.sendMessage(ownerId, `<i>Блок pre — нажмите, чтобы скопировать:</i>\n<pre>${LONG}</pre>`, { ...where, parse_mode: 'HTML' })
    await ctx.api.sendMessage(ownerId, `<i>Блок code — нажмите, чтобы скопировать:</i>\n<code>${LONG}</code>`, { ...where, parse_mode: 'HTML' })
  }

  const inline = ctx.inlineQuery
  if (inline) {
    if (inline.from.id !== ownerId) return
    await ctx.answerInlineQuery(
      [{ type: 'article', id: 'probe', title: PROBE.slice(0, 64), description: 'Нажмите — уйдёт от вашего имени', input_message_content: { message_text: PROBE } }],
      { is_personal: true, cache_time: 0 },
    )
  }
})

console.log('Слушаю апдейты. Владельцу: /buttons в чате с ботом. Остановить — Ctrl+C.')
await bot.start({ allowed_updates: ['business_message', 'message', 'inline_query'] })
