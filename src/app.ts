import type { CallbackQuery, Message, Update } from 'grammy/types'
import { isAllowedOwner, onBusinessConnection } from './channels/private-chat/connection.ts'
import { onBusinessMessage } from './channels/private-chat/incoming.ts'
import { sendOwnerReply } from './channels/private-chat/outgoing.ts'
import type { Deps } from './deps.ts'
import { extractMedia, unsupportedLabel } from './media.ts'
import { NO_TARGET, askWhom, onChoice, routeOwnerMessage } from './owner/routing.ts'
import { TelegramError, describeError, toConnectionInfo } from './telegram.ts'
import type { Connection } from './types.ts'

export const CANT_FORWARD = 'Такое бот переслать не умеет — отправьте это собеседнику в личке сами.'

/** Нет записи — бот ещё не видел подключения; запись выключена — владелец отключил бота. */
function connectionLine(connection: Connection | undefined): string {
  if (!connection) {
    return 'бот его ещё не видел. Если уже подключили — появится с первым сообщением в личке; ' +
      'если нет — Настройки → Автоматизация чатов'
  }
  return connection.isEnabled ? 'есть' : 'нет — подключите бота: Настройки → Автоматизация чатов'
}

/** Статус по /start: по нему владелец видит, работает ли перевод и что включить. */
export function statusText(deps: Deps): string {
  const connection = deps.store.ownerConnection(deps.ownerId)
  const connected = connection?.isEnabled === true
  const languages = deps.languages
    ? `${deps.languages.owner.nameRu} ↔ ${deps.languages.peer.nameRu}`
    : (deps.languagesProblem ?? 'не настроены')
  return [
    'Статус переводчика',
    `• Подключение к аккаунту: ${connectionLine(connection)}`,
    `• Право отвечать от вашего имени: ${
      !connected ? '—' : connection.canReply ? 'есть' : 'нет — включите «Ответы на сообщения»: Настройки → Автоматизация чатов → этот бот'
    }`,
    `• Языки: ${languages}`,
    `• Модель: ${deps.translatorInfo}`,
    ...(deps.dry ? ['• Холостой прогон: собеседникам ничего не уходит'] : []),
  ].join('\n')
}

/** Сообщение в чате с ботом. Обрабатываем только владельца: чужие не получают ни ответа, ни записи в базе. */
async function onOwnerMessage(deps: Deps, message: Message): Promise<void> {
  if (message.chat.type !== 'private' || message.from?.id !== deps.ownerId) return

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
  } else if (route.kind === 'choose') {
    await askWhom(deps, payload, route.options)
  } else {
    await deps.api.sendText(deps.ownerId, NO_TARGET, { replyTo: message.message_id })
  }
}

async function onCallback(deps: Deps, callback: CallbackQuery): Promise<void> {
  if (callback.from.id !== deps.ownerId || !callback.data) return
  // Вопрос «Кому?» сам служит подтверждением, поэтому «✓ <имя>» здесь не нужно.
  await onChoice(deps, { id: callback.id, data: callback.data }, (conversation, payload) =>
    sendOwnerReply(deps, conversation, payload, { outsideTopic: false }),
  )
}

type Handler = { name: string; match: (update: Update) => boolean; run: (update: Update) => Promise<unknown> }

export function createApp(deps: Deps): { handleUpdate(update: Update): Promise<void> } {
  // Реестр обработчиков. Режим через бота и группа встанут сюда новыми строками.
  const handlers: Handler[] = [
    {
      name: 'подключение к аккаунту',
      match: (u) => u.business_connection !== undefined,
      run: (u) => onBusinessConnection(deps, toConnectionInfo(u.business_connection!)),
    },
    { name: 'личка', match: (u) => u.business_message !== undefined, run: (u) => onBusinessMessage(deps, u.business_message!) },
    { name: 'чат с ботом', match: (u) => u.message !== undefined, run: (u) => onOwnerMessage(deps, u.message!) },
    { name: 'кнопка', match: (u) => u.callback_query !== undefined, run: (u) => onCallback(deps, u.callback_query!) },
  ]

  return {
    async handleUpdate(update) {
      // Посторонний не оставляет в базе ничего — даже номера апдейта: спека «ничего не сохраняет».
      const from = update.message?.from ?? update.callback_query?.from
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
          `Не удалось обработать сообщение (${handler?.name ?? 'неизвестный апдейт'}): ${describeError(error)}`,
        )
      } finally {
        deps.store.markProcessed(update.update_id, deps.now())
      }
    },
  }
}
