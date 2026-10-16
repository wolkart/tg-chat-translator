import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { tempDir, write } from './helpers.ts'

/**
 * uninstall.sh на Mac — целиком, но в подменённой домашней папке: бот, его база и файл
 * автозапуска — во временной папке. launchctl подменяется на stub: настоящий не вызывается.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const skip = process.platform !== 'darwin'

/** Заглушка launchctl: логирует вызовы, выход 1 для 'print', 0 иначе. */
function fakeLaunchctl(): { bin: string; logFile: string } {
  const bin = tempDir('translator-launchctl-')
  const logFile = join(bin, 'launchctl.log')
  const script = `#!/bin/bash
echo "$@" >> "${logFile}"
[ "$1" = "print" ] && exit 1
exit 0`
  const exe = join(bin, 'launchctl')
  writeFileSync(exe, script)
  chmodSync(exe, 0o755)
  return { bin, logFile }
}

/** Домашняя папка с установленным ботом: свой Node (ссылка на текущий), база, автозапуск. */
function homeWithBot() {
  const home = tempDir('translator-home-')
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

function uninstall(home: string, args: string[] = [], env: Record<string, string> = {}) {
  const { bin, logFile } = fakeLaunchctl()
  const run = spawnSync('bash', [join(ROOT, 'uninstall.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, DIR: join(home, 'tg-chat-translator'), PATH: `${bin}:${process.env.PATH}`, UNINSTALL_TTY: '/dev/null', ...env },
  })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, logFile }
}

test('uninstall.sh: синтаксис bash, переменные перед русским текстом — в скобках', { skip: process.platform === 'win32' }, () => {
  const run = spawnSync('bash', ['-n', join(ROOT, 'uninstall.sh')], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const text = readFileSync(join(ROOT, 'uninstall.sh'), 'utf8')
  assert.deepEqual(text.match(/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/g), null)
})

test('спека: удаление с Mac — копия базы с предупреждением, автозапуска и папки нет', { skip }, () => {
  const { home, dir } = homeWithBot()
  const result = uninstall(home, ['--yes'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(dir), false)
  assert.equal(existsSync(join(home, 'Library/LaunchAgents/com.github.wolkart.tg-chat-translator.plist')), false)
  const backups = readdirSync(home).filter((name) => /^tg-chat-translator-backup-.*\.db$/.test(name))
  assert.equal(backups.length, 1)
  const copy = new DatabaseSync(join(home, backups[0]!), { readOnly: true })
  assert.deepEqual({ ...copy.prepare('SELECT value FROM settings').get() }, { value: 'sk-or-v1-test' })
  copy.close()
  assert.match(result.stdout, /Внутри ключ модели — храните этот файл как пароль/)
  assert.match(result.stdout, /cp ".*tg-chat-translator-backup-.*\.db"/)
  // Проверка, что launchctl bootout был вызван (из лога заглушки)
  const log = readFileSync(result.logFile, 'utf8')
  assert.match(log, /bootout.*com\.github\.wolkart\.tg-chat-translator/)
})

test('спека: пустой ответ вместо «удалить» — ничего не удалено, копии нет', { skip }, () => {
  const { home, dir } = homeWithBot()
  const result = uninstall(home)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Отменено\. Ничего не тронуто\./)
  assert.ok(existsSync(join(dir, 'data/translator.db')))
  assert.ok(existsSync(join(home, 'Library/LaunchAgents/com.github.wolkart.tg-chat-translator.plist')))
  assert.deepEqual(readdirSync(home).filter((name) => name.includes('backup')), [])
})

test('спека: база есть, Node нет — предупреждение о неудачной копии', { skip }, () => {
  const { home, dir } = homeWithBot()
  // Удаляем Node, оставляя базу
  const nodeDir = join(dir, 'node')
  rmSync(nodeDir, { recursive: true })
  const result = uninstall(home, ['--yes'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(dir), false)
  assert.match(result.stdout, /Копию настроек снять не удалось/)
})

test('спека: удалять нечего — «Ничего не найдено», код 0', { skip }, () => {
  const home = tempDir('translator-home-')
  const result = uninstall(home, ['--yes'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Ничего не найдено — бот на этой машине не стоит/)
})

test('uninstall.sh: чужая папка с тем же именем не удаляется', { skip }, () => {
  const home = tempDir('translator-home-')
  write(join(home, 'tg-chat-translator/заметки.txt'), 'не удалять')
  const result = uninstall(home, ['--yes'])
  assert.equal(result.status, 0)
  assert.equal(readFileSync(join(home, 'tg-chat-translator/заметки.txt'), 'utf8'), 'не удалять')
})

test('спека: папка оборванной установки (только .env и node) — удаляется, токен не остаётся', { skip }, () => {
  const home = tempDir('translator-home-')
  write(join(home, 'tg-chat-translator/.env'), 'BOT_TOKEN=x\n')
  write(join(home, 'tg-chat-translator/node/bin/node'), 'свой node')
  const result = uninstall(home, ['--yes'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(home, 'tg-chat-translator')), false)
})

test('uninstall.sh: пустая папка с тем же именем своей не считается', { skip }, () => {
  const home = tempDir('translator-home-')
  mkdirSync(join(home, 'tg-chat-translator'))
  const result = uninstall(home, ['--yes'])
  assert.match(result.stdout, /Ничего не найдено/)
})

test('uninstall.sh: ветка сервера печатает команду возврата копии в том Docker', () => {
  // Ветка Linux ходит в Docker, в тесте её не запустить — проверяем по тексту скрипта.
  const text = readFileSync(join(ROOT, 'uninstall.sh'), 'utf8')
  const linux = text.slice(text.indexOf('uninstall_linux()'))
  assert.match(linux, /compose stop && \$\{DOCKER\} compose run --rm --no-deps --user root -v "\$\{BACKUP\}:\/in\.db:ro" translator sh -c/)
  assert.match(linux, /chown node:node \/app\/data\/translator\.db' && \$\{DOCKER\} compose start/)
  assert.match(linux, /cd \$\{DIR\} && /)
})
