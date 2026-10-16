import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

/**
 * uninstall.sh на Mac — целиком, но в подменённой домашней папке: бот, его база и файл
 * автозапуска — во временной папке. launchctl bootout на несуществующее задание безвреден.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const skip = process.platform !== 'darwin'

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

/** Домашняя папка с установленным ботом: свой Node (ссылка на текущий), база, автозапуск. */
function homeWithBot() {
  const home = mkdtempSync(join(tmpdir(), 'translator-home-'))
  const dir = join(home, 'tg-chat-translator')
  write(join(dir, 'package.json'), '{\n  "name": "tg-chat-translator"\n}\n')
  write(join(dir, 'src/main.ts'), '')
  mkdirSync(join(dir, 'src/install'), { recursive: true })
  copyFileSync(join(ROOT, 'src/install/backup.ts'), join(dir, 'src/install/backup.ts'))
  mkdirSync(join(dir, 'node/bin'), { recursive: true })
  symlinkSync(process.execPath, join(dir, 'node/bin/node'))
  mkdirSync(join(dir, 'data'))
  const db = new DatabaseSync(join(dir, 'data/translator.db'))
  db.exec("CREATE TABLE settings (key TEXT, value TEXT); INSERT INTO settings VALUES ('key:openrouter', 'sk-or-v1-test')")
  db.close()
  write(join(dir, '.env'), 'BOT_TOKEN=x\nOWNER_ID=1\n')
  write(join(home, 'Library/LaunchAgents/com.github.wolkart.tg-chat-translator.plist'), '<plist/>')
  return { home, dir }
}

function uninstall(home: string, args: string[] = []) {
  return spawnSync('bash', [join(ROOT, 'uninstall.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, DIR: join(home, 'tg-chat-translator') },
  })
}

test('uninstall.sh: синтаксис bash, переменные перед русским текстом — в скобках', { skip: process.platform === 'win32' }, () => {
  const run = spawnSync('bash', ['-n', join(ROOT, 'uninstall.sh')], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const text = readFileSync(join(ROOT, 'uninstall.sh'), 'utf8')
  assert.deepEqual(text.match(/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/g), null)
})

test('спека: удаление с Mac — копия базы с предупреждением, автозапуска и папки нет', { skip }, () => {
  const { home, dir } = homeWithBot()
  const run = uninstall(home, ['--yes'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(existsSync(dir), false)
  assert.equal(existsSync(join(home, 'Library/LaunchAgents/com.github.wolkart.tg-chat-translator.plist')), false)
  const backups = readdirSync(home).filter((name) => /^tg-chat-translator-backup-.*\.db$/.test(name))
  assert.equal(backups.length, 1)
  const copy = new DatabaseSync(join(home, backups[0]!), { readOnly: true })
  assert.deepEqual({ ...copy.prepare('SELECT value FROM settings').get() }, { value: 'sk-or-v1-test' })
  copy.close()
  assert.match(run.stdout, /Внутри ключ модели — храните этот файл как пароль/)
  assert.match(run.stdout, /cp ".*tg-chat-translator-backup-.*\.db"/)
})

test('спека: ответ не «удалить» (здесь — нет терминала) — ничего не удалено, копии нет', { skip }, () => {
  const { home, dir } = homeWithBot()
  const run = uninstall(home)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /Отменено\. Ничего не тронуто\./)
  assert.ok(existsSync(join(dir, 'data/translator.db')))
  assert.ok(existsSync(join(home, 'Library/LaunchAgents/com.github.wolkart.tg-chat-translator.plist')))
  assert.deepEqual(readdirSync(home).filter((name) => name.includes('backup')), [])
})

test('спека: удалять нечего — «Ничего не найдено», код 0', { skip }, () => {
  const home = mkdtempSync(join(tmpdir(), 'translator-home-'))
  const run = uninstall(home, ['--yes'])
  assert.equal(run.status, 0)
  assert.match(run.stdout, /Ничего не найдено — бот на этой машине не стоит/)
})

test('uninstall.sh: чужая папка с тем же именем не удаляется', { skip }, () => {
  const home = mkdtempSync(join(tmpdir(), 'translator-home-'))
  write(join(home, 'tg-chat-translator/заметки.txt'), 'не удалять')
  const run = uninstall(home, ['--yes'])
  assert.equal(run.status, 0)
  assert.equal(readFileSync(join(home, 'tg-chat-translator/заметки.txt'), 'utf8'), 'не удалять')
})
