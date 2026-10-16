import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** Записать файл, создав недостающие папки. */
export function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

/** Новая временная папка с понятным префиксом. */
export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Текст функции скрипта — от строки с заголовком до первой строки, равной «}». Нужен стражам
 * от расхождения копий: одна и та же защита папки живёт в паре install/uninstall.
 */
export function functionText(source: string, header: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.startsWith(header))
  if (start < 0) throw new Error(`нет функции: ${header}`)
  const end = lines.indexOf('}', start)
  if (end < 0) throw new Error(`функция не закрыта: ${header}`)
  return lines.slice(start, end + 1).join('\n')
}
