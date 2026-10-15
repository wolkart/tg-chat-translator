import { readFileSync } from 'node:fs'
import type { Message, Update } from 'grammy/types'

/** Выдуманные значения из обезличенных образцов test/fixtures. */
export const OWNER_ID = 100001
export const PEER_ID = 200002
export const BOT_ID = 300003
export const STRANGER_ID = 400004
export const CONNECTION_ID = 'BCOWNER000001'
export const T0 = 1_760_000_000_000

export function fixture(name: string): Update {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Update
}

/** Ответ сети с JSON-телом — для подделок fetch: сеть в тестах не вызывается. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Сообщение из образца: business_message или message. */
export function messageFixture(name: string): Message {
  const update = fixture(name)
  const message = update.business_message ?? update.message
  if (!message) throw new Error(`в образце ${name} нет сообщения`)
  return message
}
