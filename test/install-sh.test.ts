import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir, write } from './helpers.ts'

/**
 * Функции install.sh и uninstall.sh вызываются по одной: скрипт с INSTALL_SH_LIB=1 только
 * объявляет их. Сеть не нужна — архивы и «nodejs.org» лежат во временной папке (file://).
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const skip = process.platform === 'win32'

function bash(script: string, fn: string, args: string[] = [], env: Record<string, string> = {}) {
  const run = spawnSync('bash', ['-c', `INSTALL_SH_LIB=1 source "${join(ROOT, script)}"; ${fn} "$@"`, 'bash', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

const PACKAGE = '{\n  "name": "tg-chat-translator",\n  "version": "0.1.0"\n}\n'

/** Папка с установленным ботом старой версии. */
function installedBot(): string {
  const dir = tempDir('translator-sh-')
  write(join(dir, 'package.json'), PACKAGE)
  write(join(dir, 'src/main.ts'), 'старый main')
  write(join(dir, 'src/old-module.ts'), 'файл, которого в новой версии нет')
  write(join(dir, '.env'), 'BOT_TOKEN=x\nOWNER_ID=1\n')
  write(join(dir, 'data/translator.db'), 'база')
  write(join(dir, 'node/bin/node'), 'свой node')
  return dir
}

/** Распакованная новая версия. */
function newCode(): string {
  const dir = tempDir('translator-sh-')
  write(join(dir, 'package.json'), PACKAGE)
  write(join(dir, 'src/main.ts'), 'новый main')
  write(join(dir, '.dockerignore'), '.env\n')
  return dir
}

test('install.sh: синтаксис bash', { skip }, () => {
  const run = spawnSync('bash', ['-n', join(ROOT, 'install.sh')], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})

test('install.sh: переменная перед русским текстом — в скобках, иначе bash 3.2 на Mac падает', { skip }, () => {
  // «$NODE_MAJOR…» bash 3.2 читает как переменную с многоточием в имени: unbound variable.
  const text = readFileSync(join(ROOT, 'install.sh'), 'utf8')
  assert.deepEqual(text.match(/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/g), null)
})

test('спека: обновление — .env, база и Node на месте, код новый, удалённый файл ушёл', { skip }, () => {
  const dir = installedBot()
  const fresh = newCode()
  const run = bash('install.sh', 'replace_code', [fresh, dir])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(dir, 'src/main.ts'), 'utf8'), 'новый main')
  assert.equal(existsSync(join(dir, 'src/old-module.ts')), false)
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'BOT_TOKEN=x\nOWNER_ID=1\n')
  assert.equal(readFileSync(join(dir, 'data/translator.db'), 'utf8'), 'база')
  assert.equal(readFileSync(join(dir, 'node/bin/node'), 'utf8'), 'свой node')
  assert.ok(existsSync(join(dir, '.dockerignore')), 'файлы с точкой тоже переезжают')
  assert.equal(existsSync(fresh), false)
})

test('домашняя папка с пробелом и кириллицей: обновление и Node работают', { skip }, () => {
  const home = join(tempDir('translator-sh-'), 'Артём Иванов')
  const dir = join(home, 'tg-chat-translator')
  write(join(dir, 'package.json'), PACKAGE)
  write(join(dir, 'src/main.ts'), 'старый')
  write(join(dir, '.env'), 'BOT_TOKEN=x\n')
  const replaced = bash('install.sh', 'replace_code', [newCode(), dir])
  assert.equal(replaced.status, 0, replaced.stderr)
  assert.equal(readFileSync(join(dir, 'src/main.ts'), 'utf8'), 'новый main')
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'BOT_TOKEN=x\n')
  const node = bash('install.sh', 'ensure_node', ['darwin-arm64', join(dir, 'node')], { NODE_DIST: `file://${fakeNodeDist()}` })
  assert.equal(node.status, 0, node.stderr)
  assert.equal(spawnSync(join(dir, 'node/bin/node'), { encoding: 'utf8' }).stdout.trim(), 'v24.99.0')
})

test('replace_code: чужую папку не трогает', { skip }, () => {
  const dir = tempDir('translator-sh-')
  write(join(dir, 'Документы/важное.txt'), 'не удалять')
  const run = bash('install.sh', 'replace_code', [newCode(), dir])
  assert.equal(run.status, 1)
  assert.match(run.stderr, /уже занята чем-то другим/)
  assert.equal(readFileSync(join(dir, 'Документы/важное.txt'), 'utf8'), 'не удалять')
})

test('replace_code: папка, где после оборванной установки только Node, — наша', { skip }, () => {
  const dir = tempDir('translator-sh-')
  write(join(dir, 'node/bin/node'), 'свой node')
  const run = bash('install.sh', 'replace_code', [newCode(), dir])
  assert.equal(run.status, 0, run.stderr)
  assert.ok(existsSync(join(dir, 'src/main.ts')))
  assert.ok(existsSync(join(dir, 'node/bin/node')))
})

test('check_dir: нет папки, пустая, наша — можно; чужая — отказ', { skip }, () => {
  assert.equal(bash('install.sh', 'check_dir', [], { DIR: join(tempDir('translator-sh-'), 'нет-такой') }).status, 0)
  assert.equal(bash('install.sh', 'check_dir', [], { DIR: tempDir('translator-sh-') }).status, 0)
  assert.equal(bash('install.sh', 'check_dir', [], { DIR: installedBot() }).status, 0)
  const foreign = tempDir('translator-sh-')
  write(join(foreign, 'photo.jpg'), 'x')
  assert.equal(bash('install.sh', 'check_dir', [], { DIR: foreign }).status, 1)
})

test('check_dir: клон для разработки (с .git) — не наша папка, файлы целы', { skip }, () => {
  const dir = installedBot()
  write(join(dir, '.git/HEAD'), 'ref: refs/heads/main')
  assert.equal(bash('install.sh', 'check_dir', [], { DIR: dir }).status, 1)
  assert.ok(existsSync(join(dir, '.git/HEAD')))
  assert.ok(existsSync(join(dir, 'src/main.ts')))
})

test('check_dir: папка только с node/ и .DS_Store от Finder — можно', { skip }, () => {
  const dir = tempDir('translator-sh-')
  write(join(dir, 'node/bin/node'), 'свой node')
  write(join(dir, '.DS_Store'), '')
  assert.equal(bash('install.sh', 'check_dir', [], { DIR: dir }).status, 0)
})

test('show_log_tail: токен из .env в журнале заменяется на ***', { skip }, () => {
  const dir = tempDir('translator-sh-')
  write(join(dir, '.env'), 'BOT_TOKEN=123456:SECRET-token_abc\nOWNER_ID=1\n')
  const run = spawnSync(
    'bash',
    ['-c', `INSTALL_SH_LIB=1 source "${join(ROOT, 'install.sh')}"; show_log_tail`],
    {
      encoding: 'utf8',
      env: { ...process.env, DIR: dir },
      input: 'ошибка: https://api.telegram.org/bot123456:SECRET-token_abc/getMe\nещё строка\n',
    },
  )
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /bot\*\*\*\/getMe/)
  assert.doesNotMatch(run.stdout, /SECRET-token_abc/)
})

test('спека: macOS 13.5 и новее — да, старше — нет', { skip }, () => {
  for (const version of ['13.5', '13.5.2', '13.6', '14.0', '15.7.1', '26.0', '27']) {
    assert.equal(bash('install.sh', 'macos_ok', [version]).status, 0, version)
  }
  for (const version of ['12.7.6', '13.4.1', '13', '11.0']) {
    assert.equal(bash('install.sh', 'macos_ok', [version]).status, 1, version)
  }
})

/** «nodejs.org» во временной папке: SHASUMS256.txt и архив с bin/node, который печатает версию. */
function fakeNodeDist(opts: { corrupt?: boolean } = {}): string {
  const dist = tempDir('translator-sh-')
  const folder = join(dist, 'build', 'node-v24.99.0-darwin-arm64')
  write(join(folder, 'bin/node'), '#!/bin/sh\necho v24.99.0\n')
  chmodSync(join(folder, 'bin/node'), 0o755)
  const release = join(dist, 'latest-v24.x')
  mkdirSync(release)
  const file = 'node-v24.99.0-darwin-arm64.tar.gz'
  spawnSync('tar', ['-czf', join(release, file), '-C', join(dist, 'build'), 'node-v24.99.0-darwin-arm64'])
  const sum = createHash('sha256').update(readFileSync(join(release, file))).digest('hex')
  const listed = opts.corrupt ? sum.replace(/^./, sum[0] === 'a' ? 'b' : 'a') : sum
  writeFileSync(
    join(release, 'SHASUMS256.txt'),
    `${'0'.repeat(64)}  node-v24.99.0-darwin-x64.tar.gz\n${listed}  ${file}\n${'1'.repeat(64)}  node-v24.99.0-win-x64.zip\n`,
  )
  return dist
}

test('ensure_node: скачивает, сверяет сумму и кладёт Node в папку бота', { skip }, () => {
  const dest = join(tempDir('translator-sh-'), 'node')
  const run = bash('install.sh', 'ensure_node', ['darwin-arm64', dest], { NODE_DIST: `file://${fakeNodeDist()}` })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(spawnSync(join(dest, 'bin/node'), { encoding: 'utf8' }).stdout.trim(), 'v24.99.0')
})

test('спека: обновление — Node 24 уже на месте, повторно не скачивается', { skip }, () => {
  const dest = join(tempDir('translator-sh-'), 'node')
  bash('install.sh', 'ensure_node', ['darwin-arm64', dest], { NODE_DIST: `file://${fakeNodeDist()}` })
  const again = bash('install.sh', 'ensure_node', ['darwin-arm64', dest], { NODE_DIST: 'file:///nonexistent' })
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /уже на месте/)
})

test('спека: архив Node повреждён — остановка, папки Node нет', { skip }, () => {
  const dest = join(tempDir('translator-sh-'), 'node')
  const run = bash('install.sh', 'ensure_node', ['darwin-arm64', dest], { NODE_DIST: `file://${fakeNodeDist({ corrupt: true })}` })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /Скачанный Node повреждён или подменён — запустите команду ещё раз/)
  assert.equal(existsSync(dest), false)
})

test('ensure_node: nodejs.org недоступен — текст про VPN', { skip }, () => {
  const run = bash('install.sh', 'ensure_node', ['darwin-arm64', join(tempDir('translator-sh-'), 'node')], { NODE_DIST: 'file:///nonexistent' })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /Не скачать Node с nodejs\.org\. Если вы в России — включите VPN/)
})

test('download_code: архив из ARCHIVE распаковывается без верхней папки', { skip }, () => {
  const source = tempDir('translator-sh-')
  write(join(source, 'tg-chat-translator/package.json'), PACKAGE)
  write(join(source, 'tg-chat-translator/src/main.ts'), 'main')
  const archive = join(source, 'code.tar.gz')
  spawnSync('tar', ['-czf', archive, '-C', source, 'tg-chat-translator'])
  const into = tempDir('translator-sh-')
  const run = bash('install.sh', 'download_code', [into], { ARCHIVE: archive })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(readdirSync(into).sort(), ['package.json', 'src'])
})

test('download_code: в архиве не наш код — отказ', { skip }, () => {
  const source = tempDir('translator-sh-')
  write(join(source, 'other/package.json'), '{ "name": "other" }')
  const archive = join(source, 'code.tar.gz')
  spawnSync('tar', ['-czf', archive, '-C', source, 'other'])
  const run = bash('install.sh', 'download_code', [tempDir('translator-sh-')], { ARCHIVE: archive })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /не код переводчика/)
})

test('write_plist: файл автозапуска проходит plutil и указывает на свой Node', { skip: process.platform !== 'darwin' }, () => {
  const home = tempDir('translator-sh-')
  const dir = join(home, 'tg & bot')
  const run = bash('install.sh', 'write_plist', [], { HOME: home, DIR: dir })
  assert.equal(run.status, 0, run.stderr)
  const plist = join(home, 'Library/LaunchAgents/com.github.wolkart.tg-chat-translator.plist')
  assert.equal(spawnSync('plutil', ['-lint', plist]).status, 0)
  const text = readFileSync(plist, 'utf8')
  assert.ok(text.includes(`${home}/tg &amp; bot/node/bin/node`))
  assert.ok(text.includes('<string>src/main.ts</string>'))
})

test('DIR=относительный путь становится абсолютным: Docker не примет его за именованный том', { skip }, () => {
  const cwd = realpathSync(tempDir('translator-sh-'))
  const run = spawnSync('bash', ['-c', `INSTALL_SH_LIB=1 source "${join(ROOT, 'install.sh')}"; printf '%s' "$DIR"`], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, DIR: 'rel' },
  })
  assert.equal(run.stdout, join(cwd, 'rel'))
})
