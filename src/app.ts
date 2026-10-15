import type { CallbackQuery, Message, Update } from 'grammy/types'
import { SETTINGS_PATH, isAllowedOwner, onBusinessConnection } from './channels/private-chat/connection.ts'
import { onBusinessMessage } from './channels/private-chat/incoming.ts'
import { sendOwnerReply } from './channels/private-chat/outgoing.ts'
import type { Deps } from './deps.ts'
import { extractMedia, unsupportedLabel } from './media.ts'
import { answerInline, newPeerDraft } from './owner/manual-send.ts'
import { STRAY_TOPIC, askWhom, onChoice, routeOwnerMessage } from './owner/routing.ts'
import { TelegramError, describeError, toConnectionInfo } from './telegram.ts'
import type { Connection } from './types.ts'

/**
 * Какие апдейты просить у Telegram. Без inline_query кнопка «Отправить через бота» молча не
 * сработала бы: Telegram не прислал бы боту запрос, и выбор чата закончился бы пустотой.
 */
export const ALLOWED_UPDATES = ['business_connection', 'business_message', 'message', 'callback_query', 'inline_query'] as const

export const CANT_FORWARD = 'Такое бот переслать не умеет — отправьте это собеседнику в личке сами.'

/** Нет записи — бот ещё не видел подключения; запись выключена — владелец отключил бота. */
function connectionLine(connection: Connection | undefined): string {
  if (!connection) {
    return `бот его ещё не видел. Если уже подключили — появится с первым сообщением в личке; если нет — ${SETTINGS_PATH}`
  }
  return connection.isEnabled ? 'есть' : `нет — подключите бота: ${SETTINGS_PATH}`
}

export const WRITE_FIRST_HINT =
  'Написать первым: отправьте текст сюда вне тем — бот переведёт и даст кнопку «Отправить через бота»'

/** Статус по /start: по нему владелец видит, работает ли перевод и что включить. */
export function statusText(deps: Deps): string {
  const connection = deps.store.ownerConnection(deps.ownerId)
  const connected = connection?.isEnabled === true
  const config = deps.config(deps.ownerId)
  const languages = config.languages
    ? `${config.languages.owner.nameRu} ↔ ${config.languages.peer.nameRu}`
    : (config.languagesProblem ?? 'не настроены')
  const model = config.model.ok ? `${config.model.provider.label} · ${config.model.title}` : config.model.problem
  return [
    'Статус переводчика',
    `• Подключение к аккаунту: ${connectionLine(connection)}`,
    `• Право отвечать от вашего имени: ${
      !connected ? '—' : connection.canReply ? 'есть' : `нет — включите «Ответы на сообщения» (раздел «Сообщения»): ${SETTINGS_PATH}`
    }`,
    `• Языки: ${languages}`,
    `• Модель: ${model}`,
    `• ${WRITE_FIRST_HINT}`,
    ...(deps.dry ? ['• Холостой прогон: собеседникам ничего не уходит'] : []),
  ].join('\n')
}

/** Сообщение в чате с ботом. Обрабатываем только владельца: чужие не получают ни ответа, ни записи в базе. */
async function onOwnerMessage(deps: Deps, message: Message): Promise<void> {
  if (message.chat.type !== 'private' || !isAllowedOwner(message.from?.id ?? 0, deps.ownerId)) return

  if (message.text?.startsWith('/start')) {
    await deps.api.sendText(deps.ownerId, statusText(deps))
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

async function onCallback(deps: Deps, callback: CallbackQuery): Promise<void> {
  if (!isAllowedOwner(callback.from.id, deps.ownerId) || !callback.data) return
  // Вопрос «Кому?» сам служит подтверждением, поэтому «✓ <имя>» здесь не нужно.
  await onChoice(deps, { id: callback.id, data: callback.data }, (conversation, payload) =>
    sendOwnerReply(deps, conversation, payload, { outsideTopic: false }),
  )
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
      run: (u) => onOwnerMessage(deps, u.message!),
      failure: OWN_MESSAGE_FAILURE,
    },
    {
      name: 'кнопка',
      match: (u) => u.callback_query !== undefined,
      run: (u) => onCallback(deps, u.callback_query!),
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
