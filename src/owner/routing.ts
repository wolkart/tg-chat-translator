import type { Deps } from '../deps.ts'
import type { Store } from '../store.ts'
import type { InlineButton } from '../telegram.ts'
import type { Conversation, OwnerPayload } from '../types.ts'

export type Route =
  /** viaTopic — сообщение написано в теме этого разговора */
  | { kind: 'conversation'; conversation: Conversation; viaTopic: boolean }
  | { kind: 'choose'; options: Conversation[] }
  | { kind: 'none' }

/**
 * Кому адресовано сообщение владельца в чате с ботом. Цепочка до первого совпадения:
 * тема → ответ на сообщение бота → единственный активный разговор → «Кому?».
 * Нужна потому, что в ленте «Все» Telegram отправляет сообщение вне темы.
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
    await deps.api.editText(
      deps.ownerId,
      taken.questionMessageId,
      sent ? `Отправлено ${conversation.peerName}` : `Не отправлено ${conversation.peerName} — причина в теме`,
    )
  }
}
