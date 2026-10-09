import type { Chat, Message } from 'grammy/types'
import { alertModelFailure } from '../../alerts.ts'
import type { Deps } from '../../deps.ts'
import { detectLanguage } from '../../lang/detect.ts'
import { extractMedia, mediaSpec, unsupportedLabel } from '../../media.ts'
import {
  renderAsIs,
  renderCaption,
  renderIncoming,
  renderOwnerDirect,
  renderOwnerDirectMarker,
  renderOwnerUnsupported,
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
      // Разговор начинает только собеседник, пишущий на чужом языке. Друзья, пишущие
      // на языке владельца, не попадают ни в базу, ни к модели.
      name: 'разговор',
      run: (replica) => {
        const existing = deps.store.findConversationByPeer(replica.ownerId, replica.peerChatId)
        if (existing) {
          replica.conversation = existing
          return 'next'
        }
        if (replica.direction !== 'peer' || !deps.languages || replica.verdict !== 'foreign') return 'stop'
        replica.conversation = deps.store.createConversation({
          ownerId: replica.ownerId,
          connectionId: replica.connectionId,
          peerChatId: replica.peerChatId,
          peerName: replica.peerName,
          now: deps.now(),
        })
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
          replica.translationError = deps.translatorProblem ?? deps.languagesProblem ?? 'переводчик не настроен'
          return 'next'
        }
        try {
          replica.translation = await deps.translator({
            target: deps.languages.owner,
            history: deps.store.recentReplicas(replica.conversation!.id),
            text: replica.text,
          })
        } catch (error) {
          replica.translationError = describeError(error)
          // Пометка в теме — у каждого сообщения, а общее сообщение говорит, что сломано и что
          // сделать; троттлинг по постоянному ключу не даёт лавины, пока провайдер лежит.
          await alertModelFailure(deps.alerts, replica.translationError)
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

        deps.store.addReplica(
          conversation.id,
          { role: isPeer ? 'peer' : 'owner', original: historyText(replica), translation: replica.translation ?? null },
          deps.now(),
        )
        if (isPeer) deps.store.touchPeer(conversation.id, deps.now())
        return 'next'
      },
    },
  ]
}

function textFor(replica: Replica): string[] {
  if (replica.direction === 'owner-direct') return renderOwnerDirect(replica.text)
  if (replica.translation) return renderIncoming(replica.translation, replica.text)
  if (replica.translationError) return renderUntranslated(replica.text, replica.translationError)
  return renderAsIs(replica.text)
}

function captionFor(replica: Replica): string {
  if (replica.direction === 'owner-direct') {
    return (replica.text ? renderOwnerDirect(replica.text) : renderOwnerDirectMarker()).join('')
  }
  if (replica.translation) return renderCaption(replica.translation)
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
