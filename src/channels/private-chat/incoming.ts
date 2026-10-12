import type { Chat, Message } from 'grammy/types'
import { alertModelFailure } from '../../alerts.ts'
import { translatorUnavailable, type Deps } from '../../deps.ts'
import { detectLanguage } from '../../lang/detect.ts'
import { extractMedia, mediaSpec, unsupportedLabel } from '../../media.ts'
import {
  renderAsIs,
  renderCaption,
  renderIncoming,
  renderOwnerDirect,
  renderOwnerDirectMarker,
  renderOwnerUnsupported,
  renderSent,
  renderUnsupported,
  renderUntranslated,
} from '../../owner/topics.ts'
import { runPipeline, type Step, type StepResult } from '../../pipeline.ts'
import { describeError } from '../../telegram.ts'
import type { Connection, Replica } from '../../types.ts'
import { ensureConnection } from './connection.ts'

export function chatName(chat: Chat): string {
  if (chat.type !== 'private') return chat.title
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ')
  return name || (chat.username ? `@${chat.username}` : 'Собеседник')
}

/**
 * Разбор business_message в реплику. 'echo' — сообщение, которое бот сам отправил
 * от имени владельца: оно уже есть в теме, второй раз показывать незачем.
 */
export function parseBusinessMessage(message: Message, connection: Connection, botId: number): Replica | 'echo' {
  if (message.sender_business_bot?.id === botId) return 'echo'
  const text = message.text ?? message.caption ?? ''
  const media = extractMedia(message)
  return {
    ownerId: connection.ownerId,
    connectionId: connection.id,
    peerChatId: message.chat.id,
    peerName: chatName(message.chat),
    direction: message.from?.id === connection.ownerId ? 'owner-direct' : 'peer',
    sourceMessageId: message.message_id,
    text,
    media,
    unsupported: unsupportedLabel(message),
    viaBot: message.via_bot?.id === botId,
  }
}

/** Как реплика выглядит в истории для модели: подпись или «[фото]». */
function historyText(replica: Replica): string {
  if (replica.text) return replica.text
  if (replica.media) return `[${mediaSpec(replica.media.kind).label}]`
  return `[${replica.unsupported ?? 'сообщение'}]`
}

export function incomingSteps(deps: Deps): Step<Replica>[] {
  return [
    {
      name: 'язык',
      run: (replica) => {
        replica.verdict = deps.languages ? detectLanguage(replica.text, deps.languages.owner) : 'unknown'
        return 'next'
      },
    },
    {
      // Разговор начинает собеседник, пишущий на чужом языке, — или владелец, отправивший
      // перевод через бота. Друзья, пишущие на языке владельца, не попадают ни в базу, ни к модели.
      name: 'разговор',
      run: (replica) => {
        const existing = deps.store.findConversationByPeer(replica.ownerId, replica.peerChatId)
        if (existing) {
          replica.conversation = existing
          return 'next'
        }
        // Только по via_bot, а не по совпадению текста: короткий перевод («OK», «Thanks!»)
        // совпал бы с обычным сообщением другу, и у друга появилась бы тема. lastPeerAt = 0:
        // пока собеседник не ответил, разговор не активен и в «Кому?» не попадает.
        if (replica.direction === 'owner-direct' && replica.viaBot) {
          replica.conversation = deps.store.createConversation({
            ownerId: replica.ownerId,
            connectionId: replica.connectionId,
            peerChatId: replica.peerChatId,
            peerName: replica.peerName,
            lastPeerAt: 0,
          })
          return 'next'
        }
        if (replica.direction !== 'peer' || !deps.languages || replica.verdict !== 'foreign') return 'stop'
        replica.conversation = deps.store.createConversation({
          ownerId: replica.ownerId,
          connectionId: replica.connectionId,
          peerChatId: replica.peerChatId,
          peerName: replica.peerName,
          lastPeerAt: deps.now(),
        })
        return 'next'
      },
    },
    {
      // Перевод, который владелец отправил сам — кнопкой «Отправить через бота» или вставив
      // скопированное, — узнаём по тексту: в теме он покажется ответом с оригиналом, а не
      // «Вы в личке» на чужом языке. Только текст: вложение через бота не уходит.
      // Ищем среди переводов этого же разговора, и только после шага «разговор»: короткий
      // перевод («Thanks!»), сделанный для одного человека, иначе пометил бы набранное вручную
      // сообщение другому и подсунул бы его модели как оригинал, которого владелец не писал.
      // Перевод без разговора (для нового собеседника) считается своим лишь при отправке
      // через бота — по тексту одному «OK» верить нельзя.
      name: 'черновик',
      run: (replica) => {
        if (replica.direction === 'owner-direct' && replica.text && !replica.media && replica.conversation) {
          replica.draft = deps.store.findDraftByTranslation(replica.ownerId, replica.text, deps.now(), {
            conversationId: replica.conversation.id,
            includeNewPeer: replica.viaBot === true,
          })
        }
        return 'next'
      },
    },
    {
      name: 'перевод',
      run: async (replica): Promise<StepResult> => {
        replica.translation = null
        // Модель зовём только для чужого языка: своё сообщение владельца, реплика на его
        // языке или «ok» показываются как есть — бесплатно и без лишней отправки текста наружу.
        if (replica.direction !== 'peer' || !replica.text || replica.verdict !== 'foreign') return 'next'
        if (!deps.translator || !deps.languages) {
          replica.translationError = translatorUnavailable(deps)
          return 'next'
        }
        const history = deps.store.recentReplicas(replica.conversation!.id)
        try {
          replica.translation = await deps.translator({ target: deps.languages.owner, history, text: replica.text })
        } catch (error) {
          replica.translationError = describeError(error)
          // Пометка в теме — у каждого сообщения, а общее сообщение говорит, что сломано и что
          // сделать; троттлинг по постоянному ключу не даёт лавины, пока провайдер лежит.
          await alertModelFailure(deps.alerts, error)
        }
        if (replica.translation) {
          replica.review = deps.review({
            direction: 'incoming',
            original: replica.text,
            translation: replica.translation,
            owner: deps.languages.owner,
            target: deps.languages.owner,
          })
        }
        return 'next'
      },
    },
    {
      name: 'доставка',
      run: async (replica): Promise<StepResult> => {
        const conversation = replica.conversation!
        const isPeer = replica.direction === 'peer'

        if (replica.media) {
          // Своё вложение владельца без пометки выглядело бы в теме так, будто его прислал
          // собеседник, поэтому у owner-direct подпись есть всегда — хотя бы «Вы в личке».
          const caption = replica.text || replica.direction === 'owner-direct' ? captionFor(replica) : undefined
          const result = await deps.topics.postMedia(conversation, replica.media, caption)
          if (!result.ok) {
            const label = mediaSpec(replica.media.kind).label
            const notice = isPeer ? renderUnsupported(conversation.peerName, label) : renderOwnerUnsupported(label)
            // Подпись уже переведена (и оплачена): без вложения перевод остался бы единственным, что можно прочесть.
            if (caption) notice[0] += `\n${caption}`
            await deps.topics.postText(conversation, notice)
          }
        } else if (replica.unsupported) {
          await deps.topics.postText(
            conversation,
            isPeer ? renderUnsupported(conversation.peerName, replica.unsupported) : renderOwnerUnsupported(replica.unsupported),
          )
        } else if (replica.text) {
          await deps.topics.postText(conversation, textFor(replica))
        } else {
          return 'stop'
        }

        // То, что не похоже на перевод, переводом и не храним. Отправленный вручную перевод —
        // в истории как обычный ответ владельца: его текст и перевод.
        const translation = replica.review?.verdict === 'not-translation' ? null : (replica.translation ?? null)
        deps.store.addReplica(
          conversation.id,
          replica.draft
            ? { role: 'owner', original: replica.draft.original, translation: replica.draft.translation }
            : { role: isPeer ? 'peer' : 'owner', original: historyText(replica), translation },
          deps.now(),
        )
        if (isPeer) deps.store.touchPeer(conversation.id, deps.now())
        return 'next'
      },
    },
  ]
}

function textFor(replica: Replica): string[] {
  if (replica.draft) return renderSent(replica.draft.original, replica.draft.translation)
  if (replica.direction === 'owner-direct') return renderOwnerDirect(replica.text)
  if (replica.translation) return renderIncoming(replica.translation, replica.text, replica.review)
  if (replica.translationError) return renderUntranslated(replica.text, replica.translationError)
  return renderAsIs(replica.text)
}

function captionFor(replica: Replica): string {
  if (replica.direction === 'owner-direct') {
    return (replica.text ? renderOwnerDirect(replica.text) : renderOwnerDirectMarker()).join('')
  }
  if (replica.translation) {
    // Обычный перевод подписи — без оригинала, как раньше. С пометкой — как текст: оригинал рядом.
    const review = replica.review
    return review && (review.verdict !== 'ok' || review.commands)
      ? renderIncoming(replica.translation, replica.text, review).join('\n')
      : renderCaption(replica.translation)
  }
  if (replica.translationError) return renderUntranslated(replica.text, replica.translationError).join('')
  return renderCaption(replica.text)
}

/** Апдейт business_message: подключение → эхо → конвейер. */
export async function onBusinessMessage(deps: Deps, message: Message): Promise<void> {
  if (!message.business_connection_id) return
  // Если владелец разрешил боту «все личные чаты», чат с самим ботом не должен становиться разговором.
  if (message.chat.id === deps.botId) return
  const connection = await ensureConnection(deps, message.business_connection_id)
  if (!connection.allowed || !connection.isEnabled) return
  if (deps.store.wasSent(connection.ownerId, message.chat.id, message.message_id)) return

  const replica = parseBusinessMessage(message, connection, deps.botId)
  if (replica === 'echo') return
  await runPipeline(replica, incomingSteps(deps))
}
