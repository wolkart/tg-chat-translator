import { alertModelFailure } from '../../alerts.ts'
import type { Deps } from '../../deps.ts'
import { escapeHtml, splitText } from '../../html.ts'
import { mediaSpec, sendMediaLadder } from '../../media.ts'
import { manualKeyboard, renderDraft } from '../../owner/manual-send.ts'
import { renderDryRun, renderNotTranslated, renderSent, renderSuspiciousReply } from '../../owner/topics.ts'
import { describeError } from '../../telegram.ts'
import type { Conversation, OwnerPayload } from '../../types.ts'
import { BOT_DISCONNECTED, NO_REPLY_RIGHT, isFinalRefusal, refusalText } from './refusals.ts'

/** Как ответ владельца выглядит в истории и в теме: текст или «[фото]». */
function originalOf(payload: OwnerPayload): string {
  if (payload.text) return payload.text
  return payload.media ? `[${mediaSpec(payload.media.kind).label}]` : ''
}

/**
 * Не ушло: «Не отправлено», причина, готовый перевод и кнопки ручной отправки — владелец
 * отправит сам в два нажатия. Перевод сохраняется: по номеру его найдёт «Отправить через
 * бота», а по тексту бот узнает его, когда владелец отправит его в личке. Вложение через бота
 * не уйдёт, поэтому для него — только «Скопировать» подписи и подсказка отправить самому.
 */
async function notSent(
  deps: Deps,
  conversation: Conversation,
  payload: OwnerPayload,
  why: string,
  translation: string,
): Promise<false> {
  const label = payload.media ? mediaSpec(payload.media.kind).label : null
  const lines = [`<b>Не отправлено:</b> ${escapeHtml(why)}`]
  if (label) {
    const what = label[0]!.toUpperCase() + label.slice(1)
    lines.push(`<i>${what} отправьте ${escapeHtml(conversation.peerName)} сами — через кнопку бот отправляет только текст.</i>`)
  }
  if (!translation) {
    await deps.topics.postText(conversation, [lines.join('\n')])
    return false
  }
  lines.push(label ? 'Перевод подписи:' : 'Перевод:')
  const draft = deps.store.createDraft({
    ownerId: conversation.ownerId,
    conversationId: conversation.id,
    original: payload.text,
    translation,
    now: deps.now(),
  })
  await deps.topics.postText(conversation, renderDraft(lines.join('\n'), draft.translation), {
    keyboard: manualKeyboard(draft, { inline: await deps.inlineEnabled(), media: label !== null }),
  })
  return false
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
    const history = deps.store.recentReplicas(conversation.id)
    try {
      translation = await deps.translator({ target: deps.languages.peer, history, text: payload.text })
    } catch (error) {
      const reason = describeError(error)
      await alertModelFailure(deps.alerts, error)
      await deps.topics.postText(conversation, renderNotTranslated(reason))
      return false
    }
    // Автоотправка от имени владельца — самое дорогое место: подозрительный перевод не уходит,
    // а владелец видит, что вернула модель.
    const review = deps.review({
      direction: 'outgoing',
      original: payload.text,
      translation,
      owner: deps.languages.owner,
      target: deps.languages.peer,
    })
    if (review.verdict !== 'ok') {
      await deps.topics.postText(conversation, renderSuspiciousReply(translation))
      return false
    }
  }

  // Текущее подключение владельца, а не то, что было при начале разговора: владелец мог
  // отключить и снова подключить бота, и старое подключение больше не работает.
  const connection = deps.store.ownerConnection(conversation.ownerId)
  if (!connection?.isEnabled) return notSent(deps, conversation, payload, BOT_DISCONNECTED, translation)
  // Без права отвечать Telegram всё равно откажет — не пробуем. До холостого прогона: иначе
  // «ушло бы» обещало бы то, что не уйдёт.
  if (!connection.canReply) return notSent(deps, conversation, payload, NO_REPLY_RIGHT, translation)

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
      // Отказ подключения (правило суток, чат не виден боту) выходит из лестницы сразу: скачать
      // и загрузить вложение заново — лишняя работа, Telegram откажет так же.
      const result = await sendMediaLadder(deps.api, conversation.peerChatId, payload.media, {
        businessConnectionId: connection.id,
        ...(translation && { caption: translation }),
        rethrow: isFinalRefusal,
      })
      if (!result.ok) return notSent(deps, conversation, payload, refusalText(result.reason, conversation.peerName), translation)
      sent.push(...result.messageIds)
    } else {
      for (const part of splitText(translation)) {
        sent.push(
          await deps.api.sendText(conversation.peerChatId, part, { businessConnectionId: connection.id }),
        )
      }
    }
  } catch (error) {
    return notSent(deps, conversation, payload, refusalText(error, conversation.peerName), translation)
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
