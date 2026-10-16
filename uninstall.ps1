# Удаление tg-chat-translator с Windows одной командой — в PowerShell:
#   irm https://raw.githubusercontent.com/wolkart/tg-chat-translator/main/uninstall.ps1 | iex
#
# Снимает только этого бота: автозапуск, процессы бота и папку бота. Перед удалением
# сохраняет копию базы: в ней ключ модели и настройки панели. Node в системе и другие
# программы не трогает. Пишется под Windows PowerShell 5.1, как install.ps1.

$ErrorActionPreference = 'Stop'

$Dir = if ($env:DIR) { $env:DIR } else { Join-Path $env:USERPROFILE 'tg-chat-translator' }
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName = 'tg-chat-translator'
$Raw = 'https://raw.githubusercontent.com/wolkart/tg-chat-translator/main'
$UserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }

function Say($text) { Write-Host ''; Write-Host $text -ForegroundColor White }
function Ok($text) { Write-Host "  ✓ $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }

# Не exit: скрипт исполняется через iex прямо в окне человека, exit закрыл бы окно.
function Fail($text) {
  Write-Host ''
  Write-Host "✗ $text" -ForegroundColor Red
  Write-Host ''
  throw 'tg-chat-translator: stop'
}

function Test-Ours($Path) {
  $package = Join-Path $Path 'package.json'
  (Test-Path -LiteralPath (Join-Path $Path 'src/main.ts')) -and (Test-Path -LiteralPath $package) -and
    ((Get-Content -LiteralPath $package -Raw) -match '"name": "tg-chat-translator"')
}

function Get-BackupPath {
  $path = Join-Path $UserHome ("tg-chat-translator-backup-{0}.db" -f (Get-Date -Format 'yyyy-MM-dd'))
  if (Test-Path -LiteralPath $path) {
    $path = Join-Path $UserHome ("tg-chat-translator-backup-{0}.db" -f (Get-Date -Format 'yyyy-MM-dd-HHmmss'))
  }
  $path
}

# Надзиратель — первым, иначе он поднимет node снова.
function Stop-Bot($Target) {
  $pattern = [regex]::Escape($Target.TrimEnd('\\', '\/') + '\\')
  foreach ($name in @('powershell.exe', 'node.exe')) {
    Get-CimInstance Win32_Process -Filter "Name='$name'" |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Test-Autostart {
  $null -ne (Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue)
}

# Копия — своим же Node из папки бота: VACUUM INTO даёт целую базу, даже пока бот пишет.
function Save-Backup($Target) {
  $db = Join-Path $Target 'data/translator.db'
  $node = Join-Path $Target 'node/node.exe'
  if (-not ((Test-Path -LiteralPath $db) -and (Test-Path -LiteralPath $node))) { return $null }
  $backup = Get-BackupPath
  Push-Location -LiteralPath $Target
  try {
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $node 'src/install/backup.ts' $backup 'data/translator.db' 2>$null | Out-Null
    $ErrorActionPreference = $saved
  } finally { Pop-Location }
  if ((Test-Path -LiteralPath $backup) -and (Get-Item -LiteralPath $backup).Length -gt 0) { return $backup }
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  return $null
}

function Uninstall-Translator([switch]$Yes) {
  Say 'tg-chat-translator — удаление'
  $agent = Test-Autostart
  $folder = Test-Ours $Dir
  if (-not $agent -and -not $folder) {
    Ok 'Ничего не найдено — бот на этой машине не стоит.'
    Write-Host ''
    return
  }

  Say 'Нашёл вот это:'
  if ($agent) { Write-Host "  автозапуск  $RunName (Параметры → Приложения → Автозагрузка)" }
  if ($folder) { Write-Host "  папка       $Dir  (вместе с .env и базой)" }

  $backup = $null
  if ($folder) {
    Write-Host ''
    $backup = Save-Backup $Dir
    if ($backup) {
      Ok "Настройки сохранены: $backup"
      Warn 'Внутри ключ модели — храните этот файл как пароль.'
    } else {
      Warn 'Копию настроек снять не удалось — ключ и языки после новой установки придётся вставить заново.'
    }
  }

  # Не «y»: его жмут не глядя. Слово целиком заставляет прочитать список выше. Копию базы
  # сняли до вопроса — на отказе её убираем, иначе «ничего не тронуто» было бы неправдой.
  if (-not $Yes) {
    Write-Host ''
    $answer = Read-Host 'Удалить всё перечисленное? Напишите слово удалить'
    if ("$answer".Trim() -ne 'удалить') {
      if ($backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
      Fail 'Отменено. Ничего не тронуто.'
    }
  }

  Say 'Удаляю…'
  Stop-Bot $Dir
  if ($agent) {
    Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
    Ok 'Автозапуск снят, бот остановлен'
  }
  if ($folder) {
    # node.exe отпускает файлы не мгновенно после остановки.
    for ($i = 0; $i -lt 10; $i++) {
      try { Remove-Item -LiteralPath $Dir -Recurse -Force; break }
      catch { Start-Sleep -Milliseconds 500 }
    }
    if (Test-Path -LiteralPath $Dir) { Fail "Папку $Dir удалить не вышло — закройте программы, которые её держат, и повторите команду." }
    Ok 'Папка бота удалена вместе с .env'
  }

  Write-Host ''
  Write-Host '✓ Готово. Бот снят с этого компьютера.' -ForegroundColor Green
  Write-Host ''
  Write-Host 'Не тронуто ничего за пределами папки бота: Node в системе и другие программы.'
  Write-Host ''
  Write-Host 'Поставить заново:'
  Write-Host "  [Net.ServicePointManager]::SecurityProtocol='Tls12'; irm $Raw/install.ps1 | iex"
  if ($backup) {
    Write-Host ''
    Write-Host 'Вернуть настройки — до новой установки положите копию на место, затем команда установки:'
    Write-Host "  New-Item -ItemType Directory -Force '$Dir\data'; Copy-Item '$backup' '$Dir\data\translator.db'"
  }
  Write-Host ''
}

# INSTALL_PS1_LIB=1 — только объявить функции: так их проверяют тесты.
if ($env:INSTALL_PS1_LIB -ne '1') {
  try { Uninstall-Translator }
  catch { if ("$_" -ne 'tg-chat-translator: stop') { Write-Host "✗ $_" -ForegroundColor Red } }
}
