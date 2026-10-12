/** Кто автор реплики в разговоре. */
export type Role = 'peer' | 'owner'

export type MediaKind =
  | 'photo'
  | 'video'
  | 'animation'
  | 'voice'
  | 'video_note'
  | 'audio'
  | 'document'
  | 'sticker'

/** Вложение, которое можно переслать: тип и file_id из апдейта. */
export type MediaRef = {
  kind: MediaKind
  fileId: string
  fileSize?: number
  fileName?: string
}

/** Подключение бота к аккаунту (Business Mode). */
export type Connection = {
  id: string
  ownerId: number
  userChatId: number
  canReply: boolean
  isEnabled: boolean
  /** Аккаунт прошёл политику «чей аккаунт обслуживаем» */
  allowed: boolean
}

/** Разговор владельца с одним собеседником — одна тема в чате с ботом. */
export type Conversation = {
  id: number
  ownerId: number
  connectionId: string
  peerChatId: number
  peerName: string
  topicId: number | null
  /** Когда собеседник писал последний раз, мс. По нему считается «активный разговор». */
  lastPeerAt: number
}

/** Перевод для ручной отправки: владелец сам отправит его кнопкой «Отправить через бота» или скопирует. */
export type Draft = {
  id: number
  ownerId: number
  /** Разговор, для которого готовился перевод; null — новый собеседник */
  conversationId: number | null
  /** Текст владельца */
  original: string
  /** Перевод — ровно то, что уйдёт собеседнику */
  translation: string
  createdAt: number
}

/** Строка истории для контекста модели — в оригинале. */
export type HistoryLine = { role: Role; text: string }

/** Сообщение владельца из чата с ботом, которое надо отправить собеседнику. */
export type OwnerPayload = {
  text: string
  media: MediaRef | null
  /** Сообщение владельца в чате с ботом — на него отвечаем подтверждением */
  sourceMessageId: number
}

/** Итог проверки языка: на языке владельца, на чужом или непонятно. */
export type Verdict = 'native' | 'foreign' | 'unknown'

/**
 * Реплика — общий тип конвейера. Канал разбирает апдейт в реплику,
 * шаги дополняют её: язык, разговор, перевод.
 */
export type Replica = {
  ownerId: number
  connectionId: string
  peerChatId: number
  peerName: string
  /** peer — пишет собеседник; owner-direct — владелец написал прямо в личке */
  direction: 'peer' | 'owner-direct'
  sourceMessageId: number
  /** Текст или подпись к вложению; пустая строка, если их нет */
  text: string
  media: MediaRef | null
  /** Что пришло, если переслать это нельзя: «геопозицию», «контакт» */
  unsupported: string | null
  /** Сообщение владельца отправлено кнопкой «Отправить через бота» (via @бот) */
  viaBot?: boolean
  /** Перевод для ручной отправки, с которым совпал текст владельца */
  draft?: Draft
  verdict?: Verdict
  conversation?: Conversation
  translation?: string | null
  translationError?: string
  /** Итог проверки перевода; нет — перевода не было */
  review?: Review
}

/**
 * Итог проверки ответа модели. not-translation — ответ не похож на перевод (модель
 * выполнила команду, ответила на вопрос, отказалась); numbers — числа не совпали с оригиналом.
 */
export type Review = {
  verdict: 'ok' | 'not-translation' | 'numbers'
  /** Какое правило сработало — для замера и тестов */
  rule: string | null
  /** Во входящем есть фразы-команды для ИИ: сигнал владельцу, а не блокировка */
  commands: boolean
}
