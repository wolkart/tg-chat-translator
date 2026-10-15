import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDotEnv, readEnv } from '../src/env.ts'

test('parseDotEnv: комментарии, кавычки и # внутри значения', () => {
  const values = parseDotEnv(
    [
      '# комментарий',
      '',
      'BOT_TOKEN=123:abc  # пояснение',
      'OWNER_ID="42"',
      "QUOTED='a # b'",
      'HASHED=abc#def',
      'EMPTY=# только комментарий',
      'NOEQ',
    ].join('\n'),
  )
  assert.deepEqual(values, {
    BOT_TOKEN: '123:abc',
    OWNER_ID: '42',
    QUOTED: 'a # b',
    HASHED: 'abc#def',
    EMPTY: '',
  })
})

test('readEnv: список всего, чего не хватает', () => {
  const result = readEnv({})
  assert.deepEqual(result, { ok: false, missing: ['BOT_TOKEN', 'OWNER_ID'] })
})

test('readEnv: OWNER_ID должен быть числом', () => {
  const result = readEnv({ BOT_TOKEN: 't', OWNER_ID: 'me' })
  assert.deepEqual(result, { ok: false, missing: ['OWNER_ID (должно быть числом)'] })
})

test('readEnv: ключи провайдеров и секреты', () => {
  const result = readEnv(
    { BOT_TOKEN: '123456:secret-token', OWNER_ID: '42', OPENROUTER_API_KEY: 'sk-or-123456789', PATH: '/usr/bin' },
    { BOT_TOKEN: '123456:secret-token', TEST_PEER_CHAT_ID: '987654321' },
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.env.ownerId, 42)
  assert.deepEqual(result.env.providerKeys, { OPENROUTER_API_KEY: 'sk-or-123456789' })
  assert.equal(result.env.dbPath, 'data/translator.db')
  assert.ok(result.env.secrets.includes('sk-or-123456789'))
  assert.ok(result.env.secrets.includes('987654321'))
  assert.ok(!result.env.secrets.includes('/usr/bin'))
})

test('запуск без BOT_TOKEN печатает недостающие переменные и выходит с кодом 1', () => {
  const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))
  const emptyDir = mkdtempSync(join(tmpdir(), 'translator-env-'))
  const run = spawnSync(process.execPath, [main], {
    cwd: emptyDir,
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
  })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /BOT_TOKEN/)
  assert.match(run.stderr, /OWNER_ID/)
})

test('.env.example: все переменные на месте и пустые, а ключи модели не обязательны', () => {
  const example = parseDotEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(example).sort(), [
    'BOT_TOKEN',
    'DB_PATH',
    'DEEPSEEK_API_KEY',
    'GROQ_API_KEY',
    'LOCAL_API_KEY',
    'LOCAL_BASE_URL',
    'MOONSHOT_API_KEY',
    'OPENROUTER_API_KEY',
    'OWNER_ID',
  ])
  assert.ok(Object.values(example).every((value) => value === ''))
  const result = readEnv({ ...example, BOT_TOKEN: '123456:token', OWNER_ID: '42' })
  assert.equal(result.ok, true)
})
