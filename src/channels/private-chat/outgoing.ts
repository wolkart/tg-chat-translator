import { alertModelFailure } from '../../alerts.ts'
import type { Deps } from '../../deps.ts'
import { splitText } from '../../html.ts'
import { mediaSpec, sendMediaLadder } from '../../media.ts'
import { renderDryRun, renderNotSent, renderNotTranslated, renderSent } from '../../owner/topics.ts'
import { describeError } from '../../telegram.ts'
import type { Conversation, OwnerPayload } from '../../types.ts'

/** Как ответ владельца выглядит в истории и в теме: текст или «[фото]». */
function originalOf(payload: OwnerPayload): string {
  if (payload.text) return payload.text
  return payload.media ? `[${mediaSpec(payload.media.kind).label}]` : ''
}

/**
 * Ответ владельца → перевод на язык собеседника → отправка от имени владельца.
 * Оригинал собеседнику не уходит никогда: не перевелось — не отправляем.
 * Не ушло — владелец видит причину и готовый перевод; сами не повторяем.
 *
 * outsideTopic — ответ написан вне темы: на него придёт короткое «✓ <имя>».
 * Возвращает true, если сообщение ушло собеседнику.
 */
export async function sendOwnerReply(
  deps: Deps,
  conversation: Conversation,
  payload: OwnerPayload,
  opts: { outsideTopic: boolean },
): Promise<boolean> {
  const original = originalOf(payload)

  let translation = ''
  if (payload.text) {
    if (!deps.translator || !deps.languages) {
      await deps.topics.postText(
        conversation,
        renderNotTranslated(deps.translatorProblem ?? deps.languagesProblem ?? 'переводчик не настроен'),
      )
      return false
    }
    try {
      translation = await deps.translator({
        target: deps.languages.peer,
        history: deps.store.recentReplicas(conversation.id),
        text: payload.text,
      })
    } catch (error) {
      const reason = describeError(error)
      await alertModelFailure(deps.alerts, reason)
      await deps.topics.postText(conversation, renderNotTranslated(reason))
      return false
    }
  }

  // Текущее подключение владельца, а не то, что было при начале разговора: владелец мог
  // отключить и снова подключить бота, и старое подключение больше не работает.
  const connection = deps.store.ownerConnection(conversation.ownerId)
  if (!connection?.isEnabled) {
    await deps.topics.postText(conversation, renderNotSent('бот отключён от вашего аккаунта', translation))
    return false
  }

  if (deps.dry) {
    // Владелец проверяет, что уйдёт собеседнику, — оригинала подписи там быть не должно,
    // иначе прогон выглядит как утечка русского текста.
    const shown = payload.media
      ? `[${mediaSpec(payload.media.kind).label}]${translation ? ` ${translation}` : ''}`
      : translation
    await deps.topics.postText(conversation, renderDryRun(shown))
    return false
  }

  const sent: number[] = []
  try {
    if (payload.media) {
      // Собеседнику — обычный текст без разметки: так сообщение выглядит как написанное владельцем.
      const result = await sendMediaLadder(deps.api, conversation.peerChatId, payload.media, {
        businessConnectionId: connection.id,
        ...(translation && { caption: translation }),
      })
      if (!result.ok) {
        await deps.topics.postText(conversation, renderNotSent(result.reason, translation))
        return false
      }
      sent.push(...result.messageIds)
    } else {
      for (const part of splitText(translation)) {
        sent.push(
          await deps.api.sendText(conversation.peerChatId, part, { businessConnectionId: connection.id }),
        )
      }
    }
  } catch (error) {
    await deps.topics.postText(conversation, renderNotSent(describeError(error), translation))
    return false
  }

  const now = deps.now()
  for (const messageId of sent) deps.store.rememberSent(conversation.ownerId, conversation.peerChatId, messageId, now)
  deps.store.addReplica(conversation.id, { role: 'owner', original, translation: translation || null }, now)
  await deps.topics.postText(conversation, renderSent(original, translation))
  if (opts.outsideTopic) {
    const checkId = await deps.api.sendText(deps.ownerId, `✓ ${conversation.peerName}`, { replyTo: payload.sourceMessageId })
    // «Ответить» на подтверждение — это ответ тому же собеседнику, а не повод спрашивать «Кому?».
    deps.store.rememberBotMessage(deps.ownerId, checkId, conversation.id, deps.now())
  }
  return true
}
