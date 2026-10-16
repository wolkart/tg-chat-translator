import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir, write } from './helpers.ts'

/**
 * Windows-скрипты. Живьём они проверяются на Windows; здесь — то, что можно без неё:
 * - синтаксис без того, чего нет в Windows PowerShell 5.1 (??, тернарный оператор, &&);
 * - функции замены кода и разбора списка сумм — через PowerShell 7 (переменная PWSH или
 *   pwsh в PATH). Нет PowerShell — эти тесты пропускаются.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPTS = ['install.ps1', 'uninstall.ps1', 'run.ps1']
// Скрипты установки и удаления: run.ps1 — надзиратель, к ним не относится.
const SETUP_SCRIPTS = ['install.ps1', 'uninstall.ps1']

function findPwsh(): string | null {
  if (process.env.PWSH) return process.env.PWSH
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' })
  return probe.status === 0 ? 'pwsh' : null
}
const pwsh = findPwsh()
const noPwsh = pwsh === null

/** Код PowerShell без комментариев и строк — для поиска синтаксиса, которого нет в 5.1. */
function codeOnly(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""'))
    .join('\n')
}

test('Windows-скрипты: без синтаксиса PowerShell 7, которого нет в Windows PowerShell 5.1', () => {
  for (const script of SCRIPTS) {
    const code = codeOnly(readFileSync(join(ROOT, script), 'utf8'))
    for (const [label, pattern] of [
      ['??', /\?\?/],
      ['?.', /\?\./],
      ['&& или ||', /&&|\|\|/],
      ['тернарный оператор', /\s\?\s[^:]+\s:\s/],
    ] as const) {
      assert.doesNotMatch(code, pattern, `${script}: ${label}`)
    }
  }
})

test('install.ps1 и uninstall.ps1: exit не вызывается — он закрыл бы окно человека', () => {
  for (const script of SETUP_SCRIPTS) {
    assert.doesNotMatch(codeOnly(readFileSync(join(ROOT, script), 'utf8')), /\bexit\b/i, script)
  }
})

test('run.ps1 — в UTF-8 с BOM, install.ps1 и uninstall.ps1 — без', () => {
  const bom = (name: string) => readFileSync(join(ROOT, name)).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  assert.equal(bom('run.ps1'), true)
  assert.equal(bom('install.ps1'), false)
  assert.equal(bom('uninstall.ps1'), false)
})

function ps(script: string, code: string, env: Record<string, string> = {}) {
  const run = spawnSync(pwsh!, ['-NoProfile', '-NonInteractive', '-Command', `. '${join(ROOT, script)}'; ${code}`], {
    encoding: 'utf8',
    env: { ...process.env, INSTALL_PS1_LIB: '1', DIR: '/nonexistent', ...env },
  })
  return { status: run.status, out: run.stdout + run.stderr }
}

test('Windows-скрипты: PowerShell разбирает их без ошибок', { skip: noPwsh }, () => {
  for (const script of SCRIPTS) {
    const run = spawnSync(
      pwsh!,
      ['-NoProfile', '-NonInteractive', '-Command', `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${join(ROOT, script)}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.ToString() }; exit 1 }`],
      { encoding: 'utf8' },
    )
    assert.equal(run.status, 0, `${script}: ${run.stdout}${run.stderr}`)
  }
})

const PACKAGE = '{\n  "name": "tg-chat-translator"\n}\n'

test('спека: обновление на Windows — .env, база и Node на месте, удалённый файл ушёл', { skip: noPwsh }, () => {
  const dir = tempDir('translator-ps-')
  write(join(dir, 'package.json'), PACKAGE)
  write(join(dir, 'src/main.ts'), 'старый')
  write(join(dir, 'src/old-module.ts'), 'ушёл в новой версии')
  write(join(dir, '.env'), 'BOT_TOKEN=x\n')
  write(join(dir, 'data/translator.db'), 'база')
  write(join(dir, 'node/node.exe'), 'node')
  const fresh = tempDir('translator-ps-new-')
  write(join(fresh, 'package.json'), PACKAGE)
  write(join(fresh, 'src/main.ts'), 'новый')
  write(join(fresh, 'run.ps1'), '')
  const run = ps('install.ps1', `Update-Code '${fresh}' '${dir}'`)
  assert.equal(run.status, 0, run.out)
  assert.equal(readFileSync(join(dir, 'src/main.ts'), 'utf8'), 'новый')
  assert.equal(existsSync(join(dir, 'src/old-module.ts')), false)
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'BOT_TOKEN=x\n')
  assert.equal(readFileSync(join(dir, 'data/translator.db'), 'utf8'), 'база')
  assert.ok(existsSync(join(dir, 'node/node.exe')))
  assert.ok(existsSync(join(dir, 'run.ps1')))
  assert.equal(existsSync(fresh), false)
})

test('Update-Code: чужую папку не трогает', { skip: noPwsh }, () => {
  const dir = tempDir('translator-ps-')
  write(join(dir, 'фото.jpg'), 'не удалять')
  const fresh = tempDir('translator-ps-new-')
  write(join(fresh, 'package.json'), PACKAGE)
  const run = ps('install.ps1', `try { Update-Code '${fresh}' '${dir}' } catch { 'поймано' }`)
  assert.match(run.out, /уже занята чем-то другим/)
  assert.equal(readFileSync(join(dir, 'фото.jpg'), 'utf8'), 'не удалять')
})

test('Update-Code: клон для разработки (с .git) — не наша папка, файлы целы', { skip: noPwsh }, () => {
  const dir = tempDir('translator-ps-')
  write(join(dir, 'package.json'), PACKAGE)
  write(join(dir, 'src/main.ts'), 'мои правки')
  write(join(dir, '.git/HEAD'), 'ref: refs/heads/main')
  const fresh = tempDir('translator-ps-new-')
  write(join(fresh, 'package.json'), PACKAGE)
  const run = ps('install.ps1', `try { Update-Code '${fresh}' '${dir}' } catch { 'поймано' }`)
  assert.match(run.out, /уже занята чем-то другим/)
  assert.equal(readFileSync(join(dir, 'src/main.ts'), 'utf8'), 'мои правки')
  assert.ok(existsSync(join(dir, '.git/HEAD')))
})

test('Test-OnlyKeep: desktop.ini и Thumbs.db Проводника не мешают', { skip: noPwsh }, () => {
  const dir = tempDir('translator-ps-')
  write(join(dir, 'node/node.exe'), 'node')
  write(join(dir, 'desktop.ini'), '')
  write(join(dir, 'Thumbs.db'), '')
  assert.match(ps('install.ps1', `Test-OnlyKeep '${dir}'`).out, /True/)
  write(join(dir, 'фото.jpg'), 'чужое')
  assert.match(ps('install.ps1', `Test-OnlyKeep '${dir}'`).out, /False/)
})

test('автозагрузка Windows: New-Item с -Force на HKCU/RunKey стёр бы чужие записи', () => {
  for (const script of SETUP_SCRIPTS) {
    const code = codeOnly(readFileSync(join(ROOT, script), 'utf8'))
    for (const line of code.split('\n')) {
      if (/New-Item/.test(line) && /(HKCU:|\$RunKey)/.test(line)) assert.doesNotMatch(line, /-Force/, `${script}: ${line}`)
    }
  }
})

test('Find-NodeFile: сумма и имя архива для своей сборки', { skip: noPwsh }, () => {
  const sums = [
    `${'a'.repeat(64)}  node-v24.22.0-darwin-arm64.tar.gz`,
    `${'b'.repeat(64)}  node-v24.22.0-win-arm64.zip`,
    `${'c'.repeat(64)}  node-v24.22.0-win-x64.zip`,
    `${'d'.repeat(64)}  node-v24.22.0-win-x64.7z`,
  ].join('\n')
  const file = join(tempDir('translator-ps-'), 'SHASUMS256.txt')
  writeFileSync(file, sums)
  const run = ps('install.ps1', `$r = Find-NodeFile (Get-Content -Raw '${file}') 'win-x64'; "$($r[0])|$($r[1])"; $n = Find-NodeFile (Get-Content -Raw '${file}') 'win-ia32'; "нет:$($null -eq $n)"`)
  assert.equal(run.status, 0, run.out)
  assert.match(run.out, new RegExp(`${'c'.repeat(64)}\\|node-v24\\.22\\.0-win-x64\\.zip`))
  assert.match(run.out, /нет:True/)
})

test('Get-Code: zip из ARCHIVE распаковывается без верхней папки, чужой архив — отказ', { skip: noPwsh }, () => {
  const source = tempDir('translator-ps-src-')
  write(join(source, 'tg-chat-translator/package.json'), PACKAGE)
  write(join(source, 'tg-chat-translator/src/main.ts'), 'main')
  const zip = join(source, 'code.zip')
  spawnSync('zip', ['-qr', zip, 'tg-chat-translator'], { cwd: source })
  const into = join(tempDir('translator-ps-into-'), 'code')
  const run = ps('install.ps1', `Get-Code '${into}'`, { ARCHIVE: zip })
  assert.equal(run.status, 0, run.out)
  assert.deepEqual(readdirSync(into).sort(), ['package.json', 'src'])
})

test('Get-BotProcessPattern: свой бот — да, папка -old — нет, шаблон не пустой', { skip: noPwsh }, () => {
  for (const script of SETUP_SCRIPTS) {
    const t = 'C:\\Users\\A\\tg-chat-translator'
    const code = `
$p = Get-BotProcessPattern '${t}'
"pattern:$([string]::IsNullOrEmpty($p))"
"own-run:$('powershell.exe -NoProfile -File "C:\\Users\\A\\tg-chat-translator\\run.ps1"' -match $p)"
"own-node:$('\"C:\\Users\\A\\tg-chat-translator\\node/node.exe\" src/main.ts' -match $p)"
"old:$('powershell.exe -File "C:\\Users\\A\\tg-chat-translator-old\\run.ps1"' -match $p)"
"unrelated:$('C:\\Windows\\System32\\notepad.exe' -match $p)"
$t2 = 'C:\\Users\\A\\tg-chat-translator\\'
$p2 = Get-BotProcessPattern $t2
"trailing-slash:$('powershell.exe -NoProfile -File "C:\\Users\\A\\tg-chat-translator\\run.ps1"' -match $p2)"
`
    const run = ps(script, code)
    assert.equal(run.status, 0, run.out)
    assert.match(run.out, /pattern:False/, `${script}: pattern not empty`)
    assert.match(run.out, /own-run:True/, `${script}: matches own run.ps1`)
    assert.match(run.out, /own-node:True/, `${script}: matches own node.exe`)
    assert.match(run.out, /old:False/, `${script}: does not match -old folder`)
    assert.match(run.out, /unrelated:False/, `${script}: does not match unrelated process`)
    assert.match(run.out, /trailing-slash:True/, `${script}: works with trailing slash in target`)
  }
})

test('uninstall.ps1: удалять нечего — «Ничего не найдено»', { skip: noPwsh }, () => {
  const home = tempDir('translator-ps-home-')
  const run = ps('uninstall.ps1', 'Uninstall-Translator -Yes', { DIR: join(home, 'tg-chat-translator'), USERPROFILE: home })
  assert.equal(run.status, 0, run.out)
  assert.match(run.out, /Ничего не найдено — бот на этой машине не стоит/)
})

test('Stop-Bot ждёт выхода процессов, а бот в install.ps1 останавливается после вопросов setup.ts', () => {
  for (const script of SETUP_SCRIPTS) {
    assert.match(codeOnly(readFileSync(join(ROOT, script), 'utf8')), /Wait-Process -Id \$_\.ProcessId -Timeout 10/, script)
  }
  const code = codeOnly(readFileSync(join(ROOT, 'install.ps1'), 'utf8'))
  const afterAnswers = code.indexOf("'src/install/setup.ts'")
  const stops = [...code.matchAll(/^\s*Stop-Bot \$Dir\b/gm)].map((match) => match.index!)
  assert.equal(stops.length, 1)
  assert.ok(stops[0]! > afterAnswers, 'Stop-Bot $Dir должен идти после setup.ts')
})

