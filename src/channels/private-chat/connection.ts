import type { Deps } from '../../deps.ts'
import type { BusinessConnectionInfo } from '../../telegram.ts'
import type { Connection } from '../../types.ts'

/**
 * Чей аккаунт обслуживаем. Сейчас — только владельца из .env: иначе любой, кто
 * подключит бота к себе, тратил бы ключ модели владельца. Для своего сервиса
 * здесь появится список владельцев — остальной код не меняется.
 */
export function isAllowedOwner(userId: number, ownerId: number): boolean {
  return userId === ownerId
}

/**
 * Где настройка подключения. Так пункт называется на деле (живая проверка 2026-10-12): между
 * «Настройки» и «Автоматизацией чатов» есть «Аккаунт», а на Mac — «Изменить профиль».
 */
const PHONE_PATH = 'Настройки → Аккаунт → Автоматизация чатов'
const MAC_HINT = '(на Mac — Настройки → Изменить профиль → Автоматизация чатов)'

export const SETTINGS_PATH = `${PHONE_PATH} ${MAC_HINT}`

/** Та же настройка, но уже для подключённого бота. */
export const BOT_SETTINGS_PATH = `${PHONE_PATH} → этот бот ${MAC_HINT}`

export const CONNECTED =
  'Бот подключён к вашему аккаунту — переводы включены. Когда вам напишут на другом языке, ' +
  'здесь появится тема с переводом.'

export const NO_REPLY =
  'Бот подключён, но ему не разрешено отвечать от вашего имени: переводы входящих будут приходить, ' +
  `а ваши ответы не уйдут. Включите «Ответы на сообщения» (раздел «Сообщения»): ${BOT_SETTINGS_PATH}. ` +
  'Если на компьютере галочка не сохраняется, попробуйте с телефона.'

export const DISABLED = `Бот отключён от вашего аккаунта — переводы остановлены. Чтобы включить снова, выберите этого бота: ${SETTINGS_PATH}.`

export function strangerNotice(userName: string): string {
  return `Кто-то пытался подключить бота к своему аккаунту: ${userName}. Его сообщения бот не обрабатывает и модели не отдаёт.`
}

/**
 * Что сказать владельцу о подключении. null — сказать нечего: состояние не изменилось,
 * а повторять одно и то же при каждом апдейте незачем.
 */
export function connectionNotice(previous: Connection | undefined, next: Connection, userName: string): string | null {
  if (!next.allowed) return previous ? null : strangerNotice(userName)
  if (!next.isEnabled) return previous && !previous.isEnabled ? null : DISABLED
  const wasWorking = previous?.isEnabled === true
  if (!next.canReply) return wasWorking && !previous?.canReply ? null : NO_REPLY
  return wasWorking && previous?.canReply ? null : CONNECTED
}

/** Апдейт business_connection: сохранить, проверить политику и право отвечать, сказать владельцу. */
export async function onBusinessConnection(deps: Deps, info: BusinessConnectionInfo): Promise<Connection> {
  const previous = deps.store.getConnection(info.id)
  const connection: Connection = {
    id: info.id,
    ownerId: info.userId,
    userChatId: info.userChatId,
    canReply: info.canReply,
    isEnabled: info.isEnabled,
    allowed: isAllowedOwner(info.userId, deps.ownerId),
  }
  deps.store.saveConnection(connection, deps.now())

  const notice = connectionNotice(previous, connection, info.userName)
  if (notice) await deps.alerts.notify(notice)
  return connection
}

/**
 * Подключение, сделанное до запуска бота, приходит без апдейта business_connection:
 * узнаём о нём по первому сообщению и сами спрашиваем у Telegram.
 */
export async function ensureConnection(deps: Deps, connectionId: string): Promise<Connection> {
  const known = deps.store.getConnection(connectionId)
  if (known) return known
  return onBusinessConnection(deps, await deps.api.getBusinessConnection(connectionId))
}
