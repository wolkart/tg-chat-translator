import type { CallbackQuery, Message, Update } from 'grammy/types'
import { isAllowedOwner, onBusinessConnection } from './channels/private-chat/connection.ts'
import { onBusinessMessage } from './channels/private-chat/incoming.ts'
import { sendOwnerReply } from './channels/private-chat/outgoing.ts'
import type { Deps } from './deps.ts'
import { extractMedia, unsupportedLabel } from './media.ts'
import { answerInline, newPeerDraft } from './owner/manual-send.ts'
import { createPanel, type Panel } from './owner/panel/panel.ts'
import { PANEL_PREFIX } from './owner/panel/screen.ts'
import { STRAY_TOPIC, askWhom, onChoice, routeOwnerMessage } from './owner/routing.ts'
import { TelegramError, describeError, toConnectionInfo } from './telegram.ts'

/**
 * Какие апдейты просить у Telegram. Без inline_query кнопка «Отправить через бота» молча не
 * сработала бы: Telegram не прислал бы боту запрос, и выбор чата закончился бы пустотой.
 */
export const ALLOWED_UPDATES = ['business_connection', 'business_message', 'message', 'callback_query', 'inline_query'] as const

export const CANT_FORWARD = 'Такое бот переслать не умеет — отправьте это собеседнику в личке сами.'

export const UNKNOWN_COMMAND = 'Такой команды нет. Настройки и статус — /start.'

/**
 * Команда в начале сообщения: «/start», «/start bizChat123», «/help@бот». Telegram сам
 * размечает её сущностью bot_command — по ней, а не по startsWith: иначе «/startup» сошёл бы
 * за «/start», а «/help» ушёл бы собеседнику переводом.
 */
export function commandOf(message: Message): string | null {
  const entity = message.entities?.[0]
  if (!message.text || entity?.type !== 'bot_command' || entity.offset !== 0) return null
  return message.text.slice(1, entity.length).split('@')[0]!.toLowerCase()
}

type Command = (deps: Deps, panel: Panel, message: Message) => Promise<void>

/** Реестр команд. Новая команда — новая строка; меню команд — BOT_COMMANDS в startup.ts. */
const COMMANDS: Readonly<Record<string, Command>> = {
  start: (deps, panel, message) => panel.open(deps.ownerId, { threadId: message.message_thread_id }),
}

/** Сообщение в чате с ботом. Обрабатываем только владельца: чужие не получают ни ответа, ни записи в базе. */
async function onOwnerMessage(deps: Deps, panel: Panel, message: Message): Promise<void> {
  if (message.chat.type !== 'private' || !isAllowedOwner(message.from?.id ?? 0, deps.ownerId)) return

  const command = commandOf(message)
  if (command !== null) {
    // Команда собеседнику не уходит никогда — ни в теме, ни вне тем.
    const run = COMMANDS[command]
    if (run) await run(deps, panel, message)
    else {
      await deps.api.sendText(deps.ownerId, UNKNOWN_COMMAND, {
        replyTo: message.message_id,
        ...(message.message_thread_id !== undefined && { threadId: message.message_thread_id }),
      })
    }
    return
  }

  const payload = { text: message.text ?? message.caption ?? '', media: extractMedia(message), sourceMessageId: message.message_id }
  if (!payload.text && !payload.media) {
    // Геопозиция, контакт и прочее — честно говорим, что переслать не можем. Служебные — молча.
    if (unsupportedLabel(message)) await deps.api.sendText(deps.ownerId, CANT_FORWARD, { replyTo: message.message_id })
    return
  }

  const route = routeOwnerMessage(
    { threadId: message.message_thread_id, replyToMessageId: message.reply_to_message?.message_id },
    deps.store,
    deps.ownerId,
    deps.now(),
  )
  if (route.kind === 'conversation') {
    await sendOwnerReply(deps, route.conversation, payload, { outsideTopic: !route.viaTopic })
  } else if (route.kind === 'stray-topic') {
    await deps.api.sendText(deps.ownerId, STRAY_TOPIC, { threadId: message.message_thread_id })
  } else if (route.kind === 'choose') {
    await askWhom(deps, payload, route.options)
  } else {
    // Активных разговоров нет: владелец пишет первым или тому, кто давно молчит, — от его
    // имени бот туда всё равно не напишет (правило суток), поэтому сразу перевод с кнопками.
    await newPeerDraft(deps, payload)
  }
}

type CallbackRoute = { prefix: string; run: (deps: Deps, panel: Panel, callback: CallbackQuery & { data: string }) => Promise<void> }

/** Реестр нажатий по префиксу данных: первое совпадение. Пустой префикс — «Кому?», как было. */
const CALLBACKS: readonly CallbackRoute[] = [
  {
    prefix: PANEL_PREFIX,
    run: (deps, panel, callback) =>
      panel.onCallback({ id: callback.id, data: callback.data, messageId: callback.message?.message_id }, deps.ownerId),
  },
  {
    prefix: '',
    // Вопрос «Кому?» сам служит подтверждением, поэтому «✓ <имя>» здесь не нужно.
    run: (deps, _panel, callback) =>
      onChoice(deps, { id: callback.id, data: callback.data }, (conversation, payload) =>
        sendOwnerReply(deps, conversation, payload, { outsideTopic: false }),
      ),
  },
]

async function onCallback(deps: Deps, panel: Panel, callback: CallbackQuery): Promise<void> {
  const data = callback.data
  if (!isAllowedOwner(callback.from.id, deps.ownerId) || !data) return
  const route = CALLBACKS.find((candidate) => data.startsWith(candidate.prefix))!
  await route.run(deps, panel, { ...callback, data })
}

type Handler = {
  name: string
  match: (update: Update) => boolean
  run: (update: Update) => Promise<unknown>
  /** Что сказать владельцу при поломке: что случилось и что сделать — у каждого источника своё. */
  failure: (reason: string) => string
}

const OWN_MESSAGE_FAILURE = (reason: string) =>
  `Не удалось обработать ваше сообщение: ${reason}. Ответ мог не уйти — проверьте личку и отправьте снова.`

export function createApp(deps: Deps): { handleUpdate(update: Update): Promise<void> } {
  const panel = createPanel(deps)
  // Реестр обработчиков. Режим через бота и группа встанут сюда новыми строками.
  const handlers: Handler[] = [
    {
      name: 'подключение к аккаунту',
      match: (u) => u.business_connection !== undefined,
      run: (u) => onBusinessConnection(deps, toConnectionInfo(u.business_connection!)),
      failure: (reason) => `Не удалось обработать изменение подключения: ${reason}. Отправьте /start, чтобы проверить статус.`,
    },
    {
      name: 'личка',
      match: (u) => u.business_message !== undefined,
      run: (u) => onBusinessMessage(deps, u.business_message!),
      failure: (reason) =>
        `Не удалось обработать сообщение из лички: ${reason}. Оно могло не попасть в тему — посмотрите его в личке. Следующие сообщения обрабатываются как обычно.`,
    },
    {
      name: 'чат с ботом',
      match: (u) => u.message !== undefined,
      run: (u) => onOwnerMessage(deps, panel, u.message!),
      failure: OWN_MESSAGE_FAILURE,
    },
    {
      name: 'кнопка',
      match: (u) => u.callback_query !== undefined,
      run: (u) => onCallback(deps, panel, u.callback_query!),
      failure: OWN_MESSAGE_FAILURE,
    },
    {
      // Кнопка «Отправить через бота» подставляет в выбранный чат «@бот <номер перевода>».
      name: 'inline-запрос',
      match: (u) => u.inline_query !== undefined,
      run: (u) => answerInline(deps, { id: u.inline_query!.id, query: u.inline_query!.query }),
      failure: (reason) =>
        `Не удалось ответить на кнопку «Отправить через бота»: ${reason}. Попробуйте ещё раз или нажмите «Скопировать».`,
    },
  ]

  return {
    async handleUpdate(update) {
      // Посторонний не оставляет в базе ничего — даже номера апдейта: спека «ничего не сохраняет».
      // Inline-запрос постороннего («@бот 12» в любом чате) остаётся без ответа: переводы — только владельцу.
      const from = update.message?.from ?? update.callback_query?.from ?? update.inline_query?.from
      if (from && !isAllowedOwner(from.id, deps.ownerId)) return
      // После перезапуска Telegram может прислать уже обработанный апдейт — второй раз не отправляем.
      if (deps.store.isProcessed(update.update_id)) return
      const handler = handlers.find((candidate) => candidate.match(update))
      try {
        if (handler) await handler.run(update)
      } catch (error) {
        // Одно сломанное сообщение не должно останавливать бота.
        const kind = error instanceof TelegramError ? `telegram ${error.code}` : error instanceof Error ? error.name : 'unknown'
        await deps.alerts.general(
          `update:${handler?.name ?? 'неизвестно'}:${kind}`,
          handler ? handler.failure(describeError(error)) : `Не удалось обработать апдейт: ${describeError(error)}.`,
        )
      } finally {
        deps.store.markProcessed(update.update_id, deps.now())
      }
    },
  }
}
