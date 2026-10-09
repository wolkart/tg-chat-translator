import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Connection, Conversation, HistoryLine, OwnerPayload, Role } from './types.ts'

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

/** Сколько последних реплик разговора видит модель. Остальное удаляется: перевёл и забыл. */
export const HISTORY_WINDOW = 20

/** Ключи настроек в базе. Источник правды — база, значения из кода — дефолт первого запуска. */
export const SETTING = {
  ownerLang: 'owner_lang',
  peerLang: 'peer_lang',
  provider: 'provider',
  model: 'model',
} as const

export const LANGUAGE_DEFAULTS: Record<string, string> = {
  [SETTING.ownerLang]: 'ru',
  [SETTING.peerLang]: 'en',
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    owner_id INTEGER NOT NULL,
    key      TEXT NOT NULL,
    value    TEXT NOT NULL,
    PRIMARY KEY (owner_id, key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS connections (
    id           TEXT PRIMARY KEY,
    owner_id     INTEGER NOT NULL,
    user_chat_id INTEGER NOT NULL,
    can_reply    INTEGER NOT NULL,
    is_enabled   INTEGER NOT NULL,
    allowed      INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS conversations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id      INTEGER NOT NULL,
    connection_id TEXT NOT NULL,
    peer_chat_id  INTEGER NOT NULL,
    peer_name     TEXT NOT NULL,
    topic_id      INTEGER,
    last_peer_at  INTEGER NOT NULL,
    UNIQUE (owner_id, peer_chat_id)
  ) STRICT;

  -- Окно истории для контекста модели. Чаты на языке владельца сюда не попадают.
  CREATE TABLE IF NOT EXISTS replicas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role            TEXT NOT NULL,
    original        TEXT NOT NULL,
    translation     TEXT,
    created_at      INTEGER NOT NULL
  ) STRICT;

  -- Какие сообщения бота в чате владельца относятся к какому разговору.
  -- Только id, без текста: нужно для маршрута «ответ на сообщение».
  CREATE TABLE IF NOT EXISTS bot_messages (
    owner_id        INTEGER NOT NULL,
    message_id      INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (owner_id, message_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS pending_choices (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id            INTEGER NOT NULL,
    payload             TEXT NOT NULL,
    question_message_id INTEGER,
    created_at          INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS processed_updates (
    update_id    INTEGER PRIMARY KEY,
    processed_at INTEGER NOT NULL
  ) STRICT;

  -- Запасной способ узнать эхо своей отправки, если Telegram не пришлёт sender_business_bot.
  CREATE TABLE IF NOT EXISTS sent_echo (
    peer_chat_id INTEGER NOT NULL,
    message_id   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (peer_chat_id, message_id)
  ) STRICT;
`

type Row = Record<string, unknown>

function toConversation(row: Row): Conversation {
  return {
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    connectionId: String(row.connection_id),
    peerChatId: Number(row.peer_chat_id),
    peerName: String(row.peer_name),
    topicId: row.topic_id === null ? null : Number(row.topic_id),
    lastPeerAt: Number(row.last_peer_at),
  }
}

function toConnection(row: Row): Connection {
  return {
    id: String(row.id),
    ownerId: Number(row.owner_id),
    userChatId: Number(row.user_chat_id),
    canReply: row.can_reply === 1,
    isEnabled: row.is_enabled === 1,
    allowed: row.allowed === 1,
  }
}

export type Store = ReturnType<typeof openStore>

export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)

  const q = {
    getSetting: db.prepare('SELECT value FROM settings WHERE owner_id = ? AND key = ?'),
    setSetting: db.prepare(
      'INSERT INTO settings (owner_id, key, value) VALUES (?, ?, ?) ' +
        'ON CONFLICT (owner_id, key) DO UPDATE SET value = excluded.value',
    ),
    insertSettingIfAbsent: db.prepare('INSERT OR IGNORE INTO settings (owner_id, key, value) VALUES (?, ?, ?)'),

    getConnection: db.prepare('SELECT * FROM connections WHERE id = ?'),
    saveConnection: db.prepare(
      'INSERT INTO connections (id, owner_id, user_chat_id, can_reply, is_enabled, allowed, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET ' +
        'owner_id = excluded.owner_id, user_chat_id = excluded.user_chat_id, can_reply = excluded.can_reply, ' +
        'is_enabled = excluded.is_enabled, allowed = excluded.allowed, updated_at = excluded.updated_at',
    ),
    ownerConnection: db.prepare(
      'SELECT * FROM connections WHERE owner_id = ? AND allowed = 1 ORDER BY updated_at DESC LIMIT 1',
    ),

    conversationById: db.prepare('SELECT * FROM conversations WHERE id = ?'),
    conversationByPeer: db.prepare('SELECT * FROM conversations WHERE owner_id = ? AND peer_chat_id = ?'),
    conversationByTopic: db.prepare('SELECT * FROM conversations WHERE owner_id = ? AND topic_id = ?'),
    insertConversation: db.prepare(
      'INSERT INTO conversations (owner_id, connection_id, peer_chat_id, peer_name, topic_id, last_peer_at) ' +
        'VALUES (?, ?, ?, ?, NULL, ?)',
    ),
    setTopic: db.prepare('UPDATE conversations SET topic_id = ? WHERE id = ?'),
    touchPeer: db.prepare('UPDATE conversations SET last_peer_at = ? WHERE id = ?'),
    active: db.prepare(
      'SELECT * FROM conversations WHERE owner_id = ? AND last_peer_at >= ? ORDER BY last_peer_at DESC',
    ),

    addReplica: db.prepare(
      'INSERT INTO replicas (conversation_id, role, original, translation, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    trimReplicas: db.prepare(
      'DELETE FROM replicas WHERE conversation_id = ? AND id NOT IN ' +
        '(SELECT id FROM replicas WHERE conversation_id = ? ORDER BY id DESC LIMIT ?)',
    ),
    recentReplicas: db.prepare(
      'SELECT role, original FROM (SELECT id, role, original FROM replicas WHERE conversation_id = ? ' +
        'ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
    ),
    countReplicas: db.prepare('SELECT COUNT(*) AS n FROM replicas WHERE conversation_id = ?'),

    rememberBotMessage: db.prepare(
      'INSERT OR IGNORE INTO bot_messages (owner_id, message_id, conversation_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    conversationByBotMessage: db.prepare(
      'SELECT c.* FROM bot_messages b JOIN conversations c ON c.id = b.conversation_id ' +
        'WHERE b.owner_id = ? AND b.message_id = ?',
    ),

    createPending: db.prepare('INSERT INTO pending_choices (owner_id, payload, created_at) VALUES (?, ?, ?)'),
    setPendingQuestion: db.prepare('UPDATE pending_choices SET question_message_id = ? WHERE id = ?'),
    // Один запрос и проверяет, и удаляет: второе нажатие на кнопку ничего не найдёт.
    takePending: db.prepare(
      'DELETE FROM pending_choices WHERE id = ? AND owner_id = ? RETURNING payload, question_message_id',
    ),

    isProcessed: db.prepare('SELECT 1 FROM processed_updates WHERE update_id = ?'),
    markProcessed: db.prepare('INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)'),

    rememberSent: db.prepare('INSERT OR IGNORE INTO sent_echo (peer_chat_id, message_id, created_at) VALUES (?, ?, ?)'),
    wasSent: db.prepare('SELECT 1 FROM sent_echo WHERE peer_chat_id = ? AND message_id = ?'),

    cleanPending: db.prepare('DELETE FROM pending_choices WHERE created_at < ?'),
    cleanProcessed: db.prepare('DELETE FROM processed_updates WHERE processed_at < ?'),
    cleanSent: db.prepare('DELETE FROM sent_echo WHERE created_at < ?'),
  }

  return {
    getSetting(ownerId: number, key: string): string | undefined {
      const row = q.getSetting.get(ownerId, key) as Row | undefined
      return row ? String(row.value) : undefined
    },

    setSetting(ownerId: number, key: string, value: string): void {
      q.setSetting.run(ownerId, key, value)
    },

    /** Дефолты первого запуска: пишутся, только если значения ещё нет. */
    ensureDefaults(ownerId: number, defaults: Record<string, string>): void {
      for (const [key, value] of Object.entries(defaults)) q.insertSettingIfAbsent.run(ownerId, key, value)
    },

    getConnection(id: string): Connection | undefined {
      const row = q.getConnection.get(id) as Row | undefined
      return row ? toConnection(row) : undefined
    },

    saveConnection(connection: Connection, now: number): void {
      q.saveConnection.run(
        connection.id,
        connection.ownerId,
        connection.userChatId,
        connection.canReply ? 1 : 0,
        connection.isEnabled ? 1 : 0,
        connection.allowed ? 1 : 0,
        now,
      )
    },

    /** Последнее подключение владельца, прошедшее политику, — для статуса. */
    ownerConnection(ownerId: number): Connection | undefined {
      const row = q.ownerConnection.get(ownerId) as Row | undefined
      return row ? toConnection(row) : undefined
    },

    getConversation(id: number): Conversation | undefined {
      const row = q.conversationById.get(id) as Row | undefined
      return row ? toConversation(row) : undefined
    },

    findConversationByPeer(ownerId: number, peerChatId: number): Conversation | undefined {
      const row = q.conversationByPeer.get(ownerId, peerChatId) as Row | undefined
      return row ? toConversation(row) : undefined
    },

    findConversationByTopic(ownerId: number, topicId: number): Conversation | undefined {
      const row = q.conversationByTopic.get(ownerId, topicId) as Row | undefined
      return row ? toConversation(row) : undefined
    },

    createConversation(input: {
      ownerId: number
      connectionId: string
      peerChatId: number
      peerName: string
      now: number
    }): Conversation {
      const result = q.insertConversation.run(
        input.ownerId,
        input.connectionId,
        input.peerChatId,
        input.peerName,
        input.now,
      )
      return toConversation(q.conversationById.get(Number(result.lastInsertRowid)) as Row)
    },

    setTopic(conversationId: number, topicId: number): void {
      q.setTopic.run(topicId, conversationId)
    },

    touchPeer(conversationId: number, now: number): void {
      q.touchPeer.run(now, conversationId)
    },

    /** Разговоры, где собеседник писал за последние 24 часа, включая ровно 24 часа назад. */
    activeConversations(ownerId: number, now: number): Conversation[] {
      return (q.active.all(ownerId, now - DAY) as Row[]).map(toConversation)
    },

    /** Добавляет реплику и обрезает разговор до окна истории. */
    addReplica(
      conversationId: number,
      replica: { role: Role; original: string; translation: string | null },
      now: number,
    ): void {
      q.addReplica.run(conversationId, replica.role, replica.original, replica.translation, now)
      q.trimReplicas.run(conversationId, conversationId, HISTORY_WINDOW)
    },

    /** Последние реплики разговора, от старых к новым. */
    recentReplicas(conversationId: number, limit = HISTORY_WINDOW): HistoryLine[] {
      return (q.recentReplicas.all(conversationId, limit) as Row[]).map((row) => ({
        role: row.role as Role,
        text: String(row.original),
      }))
    },

    countReplicas(conversationId: number): number {
      return Number((q.countReplicas.get(conversationId) as Row).n)
    },

    rememberBotMessage(ownerId: number, messageId: number, conversationId: number, now: number): void {
      q.rememberBotMessage.run(ownerId, messageId, conversationId, now)
    },

    conversationByBotMessage(ownerId: number, messageId: number): Conversation | undefined {
      const row = q.conversationByBotMessage.get(ownerId, messageId) as Row | undefined
      return row ? toConversation(row) : undefined
    },

    createPending(ownerId: number, payload: OwnerPayload, now: number): number {
      return Number(q.createPending.run(ownerId, JSON.stringify(payload), now).lastInsertRowid)
    },

    setPendingQuestion(pendingId: number, messageId: number): void {
      q.setPendingQuestion.run(messageId, pendingId)
    },

    /** Забирает отложенное сообщение. Второй вызов с тем же id вернёт undefined. */
    takePending(
      pendingId: number,
      ownerId: number,
    ): { payload: OwnerPayload; questionMessageId: number | null } | undefined {
      const row = q.takePending.get(pendingId, ownerId) as Row | undefined
      if (!row) return undefined
      return {
        payload: JSON.parse(String(row.payload)) as OwnerPayload,
        questionMessageId: row.question_message_id === null ? null : Number(row.question_message_id),
      }
    },

    isProcessed(updateId: number): boolean {
      return q.isProcessed.get(updateId) !== undefined
    },

    markProcessed(updateId: number, now: number): void {
      q.markProcessed.run(updateId, now)
    },

    rememberSent(peerChatId: number, messageId: number, now: number): void {
      q.rememberSent.run(peerChatId, messageId, now)
    },

    wasSent(peerChatId: number, messageId: number): boolean {
      return q.wasSent.get(peerChatId, messageId) !== undefined
    },

    /**
     * Чистка служебных записей. Апдейты держим 48 часов: Telegram хранит их 24 часа,
     * запас — на случай, если сервер лежал. Отложенные «Кому?» и эхо живут сутки.
     */
    cleanup(now: number): void {
      q.cleanPending.run(now - DAY)
      q.cleanProcessed.run(now - 2 * DAY)
      q.cleanSent.run(now - DAY)
    },

    close(): void {
      db.close()
    },
  }
}
