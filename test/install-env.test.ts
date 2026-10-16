import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { parseDotEnv } from '../src/env.ts'
import { backupDatabase } from '../src/install/backup.ts'
import { renderEnv, writeEnvStep } from '../src/install/env-file.ts'
import { main } from '../src/install/setup.ts'
import { TOKEN, fakeClock, fakeFetch, fakeIo, json, setupContext } from './install-fakes.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const noNetwork = fakeFetch(() => new Error('сеть в этом тесте не нужна')).fetchImpl

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'translator-install-'))
}

test('renderEnv: новый файл — пояснение, токен и владелец, больше ничего', () => {
  const text = renderEnv('', { BOT_TOKEN: TOKEN, OWNER_ID: '100001' })
  assert.deepEqual(parseDotEnv(text), { BOT_TOKEN: TOKEN, OWNER_ID: '100001' })
  assert.match(text, /^# .*\/start/)
})

test('renderEnv: в старом файле меняются только наши две строки, остальное на месте', () => {
  const old = ['# мой комментарий', 'BOT_TOKEN=старый', 'DB_PATH=data/other.db', ''].join('\n')
  const text = renderEnv(old, { BOT_TOKEN: TOKEN, OWNER_ID: '100001' })
  assert.deepEqual(parseDotEnv(text), { BOT_TOKEN: TOKEN, DB_PATH: 'data/other.db', OWNER_ID: '100001' })
  assert.match(text, /^# мой комментарий/)
})

test('спека: первая установка — в .env токен и владелец, читать может только этот пользователь', async () => {
  const envPath = join(tempDir(), '.env')
  const { io, output } = fakeIo()
  const ctx = setupContext({
    io,
    fetch: noNetwork,
    envPath,
    answers: { token: TOKEN, ownerId: 100001, tokenChanged: true, ownerChanged: true },
  })
  assert.deepEqual(await writeEnvStep.run(ctx), { ok: true })
  assert.deepEqual(parseDotEnv(readFileSync(envPath, 'utf8')), { BOT_TOKEN: TOKEN, OWNER_ID: '100001' })
  if (process.platform !== 'win32') assert.equal(statSync(envPath).mode & 0o777, 0o600)
  assert.ok(output.some((line) => line.startsWith('✓')))
})

test('спека: пустой .env, созданный заранее (сервер), получает права 600 и значения', async () => {
  const envPath = join(tempDir(), '.env')
  writeFileSync(envPath, '', { mode: 0o644 })
  const { io } = fakeIo()
  const ctx = setupContext({ io, fetch: noNetwork, envPath, answers: { token: TOKEN, ownerId: 7, tokenChanged: true, ownerChanged: true } })
  await writeEnvStep.run(ctx)
  if (process.platform !== 'win32') assert.equal(statSync(envPath).mode & 0o777, 0o600)
  assert.equal(parseDotEnv(readFileSync(envPath, 'utf8')).OWNER_ID, '7')
})

test('спека: .env уже есть и всё принято — файл не трогаем', async () => {
  const envPath = join(tempDir(), '.env')
  const before = `BOT_TOKEN=${TOKEN}\nOWNER_ID=100001\n`
  writeFileSync(envPath, before, { mode: 0o640 })
  const { io, output } = fakeIo()
  const ctx = setupContext({ io, fetch: noNetwork, envPath, answers: { token: TOKEN, ownerId: 100001 } })
  assert.deepEqual(await writeEnvStep.run(ctx), { ok: true })
  assert.equal(readFileSync(envPath, 'utf8'), before)
  assert.equal(statSync(envPath).mode & 0o777, 0o640)
  assert.deepEqual(output, [])
})

const START_SAMPLE = readFileSync(new URL('./fixtures/get-updates-start.json', import.meta.url), 'utf8')

/** Telegram и OpenRouter на месте, бот отвечает, владелец уже написал /start. */
function healthyNetwork() {
  return fakeFetch((url) => {
    if (url.endsWith('/getMe')) return json({ ok: true, result: { username: 'aIrtem_tg_translator_bot' } })
    if (url.endsWith('/getUpdates')) return new Response(START_SAMPLE, { headers: { 'content-type': 'application/json' } })
    return new Response('', { status: 302 })
  })
}

test('спека: setup.ts целиком — связь, токен, владелец, .env; повторный запуск без вопросов', async () => {
  const envPath = join(tempDir(), '.env')
  const first = fakeIo({ masked: [TOKEN], answers: ['нет', 'да'] })
  const clock = fakeClock()
  const code = await main(['--env', envPath], { io: first.io, fetch: healthyNetwork().fetchImpl, ...clock })
  assert.equal(code, 0)
  assert.deepEqual(parseDotEnv(readFileSync(envPath, 'utf8')), { BOT_TOKEN: TOKEN, OWNER_ID: '100001' })

  const again = fakeIo()
  const before = readFileSync(envPath, 'utf8')
  assert.equal(await main(['--env', envPath], { io: again.io, fetch: healthyNetwork().fetchImpl, ...clock }), 0)
  assert.equal(readFileSync(envPath, 'utf8'), before)
  assert.ok(!again.output.some((line) => line.includes('Токен бота: ')))
})

test('setup.ts: нет связи с Telegram — код 1, файл не создан', async () => {
  const envPath = join(tempDir(), '.env')
  const { io, text } = fakeIo()
  const code = await main(['--env', envPath], { io, fetch: noNetwork, ...fakeClock() })
  assert.equal(code, 1)
  assert.match(text(), /Не достучаться до Telegram/)
  assert.equal(existsSync(envPath), false)
})

function databaseWithSetting(path: string): void {
  const db = new DatabaseSync(path)
  db.exec("CREATE TABLE settings (owner_id INTEGER, key TEXT, value TEXT); INSERT INTO settings VALUES (1, 'peer_lang', 'de')")
  db.close()
}

test('backupDatabase: копия открывается и содержит настройки, даже пока база открыта ботом', () => {
  const dir = tempDir()
  const dbPath = join(dir, 'translator.db')
  databaseWithSetting(dbPath)
  const bot = new DatabaseSync(dbPath)
  bot.exec("INSERT INTO settings VALUES (1, 'model', 'anthropic/claude-haiku-5.5')")
  const out = join(dir, 'backup.db')
  backupDatabase(dbPath, out)
  bot.close()
  const copy = new DatabaseSync(out, { readOnly: true })
  assert.deepEqual(
    copy.prepare('SELECT key, value FROM settings ORDER BY key').all().map((row) => ({ ...row })),
    [
      { key: 'model', value: 'anthropic/claude-haiku-5.5' },
      { key: 'peer_lang', value: 'de' },
    ],
  )
  copy.close()
  // В копии ключ модели — она должна быть доступна только владельцу файла.
  if (process.platform !== 'win32') assert.equal(statSync(out).mode & 0o777, 0o600)
})

test('backupDatabase: существующую копию не перезаписывает', () => {
  const dir = tempDir()
  const dbPath = join(dir, 'translator.db')
  databaseWithSetting(dbPath)
  const out = join(dir, 'backup.db')
  writeFileSync(out, 'старая копия')
  assert.throws(() => backupDatabase(dbPath, out), /уже есть/)
  assert.equal(readFileSync(out, 'utf8'), 'старая копия')
})

test('backup.ts из командной строки: код 0 и файл; базы нет — код 1 и понятный текст', () => {
  const dir = tempDir()
  const dbPath = join(dir, 'translator.db')
  databaseWithSetting(dbPath)
  const script = join(ROOT, 'src/install/backup.ts')
  const ok = spawnSync(process.execPath, [script, join(dir, 'copy.db'), dbPath], { encoding: 'utf8' })
  assert.equal(ok.status, 0)
  assert.ok(existsSync(join(dir, 'copy.db')))
  const missing = spawnSync(process.execPath, [script, join(dir, 'copy2.db'), join(dir, 'nope.db')], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /Базы нет/)
})
