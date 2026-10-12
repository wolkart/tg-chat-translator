import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Api } from 'grammy'
import { createTelegramApi, toInlineKeyboard } from '../src/telegram.ts'

test('кнопки: нажатие боту, копирование, выбор чата и цвет — в формате Bot API', () => {
  assert.deepEqual(
    toInlineKeyboard([
      [{ text: 'Отправить через бота', chooseChat: '42', style: 'success' }],
      [{ text: 'Скопировать', copy: 'Hi!' }],
      [{ text: 'Отмена', data: 'cancel:1' }],
    ]),
    [
      [{ text: 'Отправить через бота', switch_inline_query_chosen_chat: { query: '42', allow_user_chats: true }, style: 'success' }],
      [{ text: 'Скопировать', copy_text: { text: 'Hi!' } }],
      [{ text: 'Отмена', callback_data: 'cancel:1' }],
    ],
  )
})

// Настоящая обёртка с подменённым Api: сеть не нужна, смотрим только на аргументы.
function recordingApi() {
  const calls: { method: string; args: unknown[] }[] = []
  const api = {
    sendMessage: async (...args: unknown[]) => {
      calls.push({ method: 'sendMessage', args })
      return { message_id: 1 }
    },
    answerInlineQuery: async (...args: unknown[]) => {
      calls.push({ method: 'answerInlineQuery', args })
      return true
    },
  } as unknown as Api
  return { calls, tg: createTelegramApi(api, 'TOKEN') }
}

test('sendText: клавиатура уходит в reply_markup в формате Bot API', async () => {
  const { calls, tg } = recordingApi()
  await tg.sendText(1, 'Hi', { keyboard: [[{ text: 'Скопировать', copy: 'Hi' }]] })
  const other = calls[0]!.args[2] as { reply_markup: unknown }
  assert.deepEqual(other.reply_markup, { inline_keyboard: [[{ text: 'Скопировать', copy_text: { text: 'Hi' } }]] })
})

test('answerInline: ответ личный и не кэшируется, даже если вызывающий об этом не просил', async () => {
  const { calls, tg } = recordingApi()
  await tg.answerInline('Q1', [{ id: '7', title: 'Hi there', description: 'Нажмите', text: 'Hi <there>' }])
  const [queryId, results, other] = calls[0]!.args as [string, unknown[], Record<string, unknown>]
  assert.equal(queryId, 'Q1')
  assert.deepEqual(results, [
    { type: 'article', id: '7', title: 'Hi there', description: 'Нажмите', input_message_content: { message_text: 'Hi <there>' } },
  ])
  assert.equal(other.is_personal, true)
  assert.equal(other.cache_time, 0)
  assert.equal('button' in other, false)
})

test('answerInline: кнопка над вариантами открывает чат с ботом', async () => {
  const { calls, tg } = recordingApi()
  await tg.answerInline('Q2', [], { button: { text: 'Перевод устарел — напишите заново', startParameter: 'draft' } })
  const other = calls[0]!.args[2] as Record<string, unknown>
  assert.deepEqual(other.button, { text: 'Перевод устарел — напишите заново', start_parameter: 'draft' })
  assert.equal(other.is_personal, true)
})
