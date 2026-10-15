import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Api } from 'grammy'
import { TelegramError, createTelegramApi, isNotModified, toInlineKeyboard } from '../src/telegram.ts'

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
    editMessageText: async (...args: unknown[]) => {
      calls.push({ method: 'editMessageText', args })
      return true
    },
    setMyCommands: async (...args: unknown[]) => {
      calls.push({ method: 'setMyCommands', args })
      return true
    },
    getMe: async () => ({
      id: 300003,
      is_bot: true,
      first_name: 'Translator',
      username: 'translator_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: true,
      can_connect_to_business: true,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: true,
    }),
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

test('editText без параметров — как раньше: ни разметки, ни кнопок', async () => {
  const { calls, tg } = recordingApi()
  await tg.editText(1, 7, 'Отправлено Anna')
  assert.deepEqual(calls[0]!.args, [1, 7, 'Отправлено Anna', undefined])
})

test('editText с разметкой и кнопками — parse_mode, reply_markup и без превью ссылок', async () => {
  const { calls, tg } = recordingApi()
  await tg.editText(1, 7, '<b>Панель</b>', { html: true, keyboard: [[{ text: '← Назад', data: 'p:main' }]] })
  assert.deepEqual(calls[0]!.args[3], {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'p:main' }]] },
    link_preview_options: { is_disabled: true },
  })
})

test('setCommands — список команд уходит в setMyCommands', async () => {
  const { calls, tg } = recordingApi()
  await tg.setCommands([{ command: 'start', description: 'Настройки и статус' }])
  assert.deepEqual(calls[0], { method: 'setMyCommands', args: [[{ command: 'start', description: 'Настройки и статус' }]] })
})

test('getMe — разрешено ли пользователям создавать темы', async () => {
  const { tg } = recordingApi()
  assert.equal((await tg.getMe()).allowsUsersToCreateTopics, true)
})

test('isNotModified узнаёт «message is not modified» и только его', () => {
  assert.equal(
    isNotModified(new TelegramError(400, 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same')),
    true,
  )
  assert.equal(isNotModified(new TelegramError(400, 'Bad Request: message to edit not found')), false)
  assert.equal(isNotModified(new Error('message is not modified')), false)
})
