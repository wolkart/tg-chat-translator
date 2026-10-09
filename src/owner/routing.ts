import type { Deps } from '../deps.ts'
import type { Store } from '../store.ts'
import type { InlineButton } from '../telegram.ts'
import type { Conversation, OwnerPayload } from '../types.ts'

export type Route =
  /** viaTopic — сообщение написано в теме этого разговора */
  | { kind: 'conversation'; conversation: Conversation; viaTopic: boolean }
  | { kind: 'choose'; options: Conversation[] }
  | { kind: 'none' }
  /** Тема, которой нет в базе: осталась с прошлой установки. */
  | { kind: 'stray-topic' }

/**
 * Кому адресовано сообщение владельца в чате с ботом. Цепочка до первого совпадения:
 * тема → ответ на сообщение бота → единственный активный разговор → «Кому?».
 * Нужна потому, что в ленте «Все» Telegram отправляет сообщение вне темы.
 * Исключение: сообщение в теме, которой база не знает, дальше по цепочке не идёт —
 * иначе после удаления базы текст из старой темы ушёл бы не тому человеку.
 */
export function routeOwnerMessage(
  input: { threadId?: number; replyToMessageId?: number },
  store: Store,
  ownerId: number,
  now: number,
): Route {
  if (input.threadId !== undefined) {
    const conversation = store.findConversationByTopic(ownerId, input.threadId)
    if (conversation) return { kind: 'conversation', conversation, viaTopic: true }
    return { kind: 'stray-topic' }
  }
  if (input.replyToMessageId !== undefined) {
    const conversation = store.conversationByBotMessage(ownerId, input.replyToMessageId)
    if (conversation) return { kind: 'conversation', conversation, viaTopic: false }
  }
  const active = store.activeConversations(ownerId, now)
  if (active.length === 1) return { kind: 'conversation', conversation: active[0]!, viaTopic: false }
  if (active.length > 1) return { kind: 'choose', options: active }
  return { kind: 'none' }
}

export const NO_TARGET = 'Не понял, кому отправить — ответьте в теме собеседника.'
export const STRAY_TOPIC =
  'Эту тему бот не узнаёт — похоже, она осталась с прошлой установки. Сообщение никуда не ушло. ' +
  'Напишите в теме собеседника; если её ещё нет, она появится, когда он напишет снова. Эту тему можно удалить.'
export const ALREADY_HANDLED = 'Уже обработано'

/** callback_data ограничена 64 байтами: «to:<pending>:<conv>» влезает с запасом. */
export function chooseKeyboard(pendingId: number, options: readonly Conversation[]): InlineButton[][] {
  return [
    ...options.map((conversation) => [{ text: conversation.peerName, data: `to:${pendingId}:${conversation.id}` }]),
    [{ text: 'Отмена', data: `cancel:${pendingId}` }],
  ]
}

export type Choice = { kind: 'to'; pendingId: number; conversationId: number } | { kind: 'cancel'; pendingId: number }

export function parseChoice(data: string): Choice | null {
  const to = /^to:(\d+):(\d+)$/.exec(data)
  if (to) return { kind: 'to', pendingId: Number(to[1]), conversationId: Number(to[2]) }
  const cancel = /^cancel:(\d+)$/.exec(data)
  if (cancel) return { kind: 'cancel', pendingId: Number(cancel[1]) }
  return null
}

/** Несколько активных разговоров: сообщение откладывается, бот спрашивает «Кому?». */
export async function askWhom(deps: Deps, payload: OwnerPayload, options: readonly Conversation[]): Promise<void> {
  const pendingId = deps.store.createPending(deps.ownerId, payload, deps.now())
  const questionId = await deps.api.sendText(deps.ownerId, 'Кому?', {
    replyTo: payload.sourceMessageId,
    keyboard: chooseKeyboard(pendingId, options),
  })
  deps.store.setPendingQuestion(pendingId, questionId)
}

/**
 * Нажатие кнопки под «Кому?». Отложенное сообщение забирается из базы одним запросом,
 * поэтому повторное нажатие ничего не найдёт и второй раз ничего не отправит.
 */
export async function onChoice(
  deps: Deps,
  callback: { id: string; data: string },
  send: (conversation: Conversation, payload: OwnerPayload) => Promise<boolean>,
): Promise<void> {
  const choice = parseChoice(callback.data)
  if (!choice) {
    await deps.api.answerCallback(callback.id)
    return
  }

  const taken = deps.store.takePending(choice.pendingId, deps.ownerId)
  if (!taken) {
    await deps.api.answerCallback(callback.id, ALREADY_HANDLED)
    return
  }

  if (choice.kind === 'cancel') {
    await deps.api.answerCallback(callback.id)
    if (taken.questionMessageId !== null) await deps.api.deleteMessage(deps.ownerId, taken.questionMessageId)
    return
  }

  const conversation = deps.store.getConversation(choice.conversationId)
  await deps.api.answerCallback(callback.id)
  if (!conversation) return

  const sent = await send(conversation, taken.payload)
  if (taken.questionMessageId !== null) {
    // Вопрос стал подтверждением «Отправлено <имя>»: ответ на него адресован этому собеседнику.
    if (sent) deps.store.rememberBotMessage(deps.ownerId, taken.questionMessageId, conversation.id, deps.now())
    await deps.api.editText(
      deps.ownerId,
      taken.questionMessageId,
      sent ? `Отправлено ${conversation.peerName}` : `Не отправлено ${conversation.peerName} — причина в теме`,
    )
  }
}
