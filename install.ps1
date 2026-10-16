# Установка tg-chat-translator на Windows одной командой — в PowerShell:
#   [Net.ServicePointManager]::SecurityProtocol='Tls12'; irm https://raw.githubusercontent.com/wolkart/tg-chat-translator/main/install.ps1 | iex
#
# Без Docker и без прав администратора: своя копия Node в папке бота и автозапуск при входе
# в Windows, без окна. Повторный запуск — обновление: код новый, .env и база на месте.
# Пробная установка: проверена меньше, чем Mac и сервер.
#
# Для проверки до слияния — переменные окружения BRANCH, DIR и ARCHIVE (zip из
# git archive --format=zip --prefix=tg-chat-translator/), как у install.sh.
#
# Пишется под Windows PowerShell 5.1 — он есть в каждой Windows 10 и 11: без ??, без
# тернарного оператора и без && в конвейере.

$ErrorActionPreference = 'Stop'
# Полоса прогресса в PowerShell 5.1 замедляет Invoke-WebRequest в разы.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'wolkart/tg-chat-translator'
$Branch = if ($env:BRANCH) { $env:BRANCH } else { 'main' }
$Dir = if ($env:DIR) { $env:DIR } else { Join-Path $env:USERPROFILE 'tg-chat-translator' }
$Archive = $env:ARCHIVE
$NodeDist = if ($env:NODE_DIST) { $env:NODE_DIST } else { 'https://nodejs.org/dist' }
$NodeMajor = 24
# Что в папке бота живёт дольше кода: обновление их не трогает.
$Keep = @('.env', 'data', 'node')
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName = 'tg-chat-translator'
$Raw = "https://raw.githubusercontent.com/$Repo/$Branch"
$NetHint = 'Если вы в России — включите VPN на весь компьютер, не только в браузере, и запустите команду ещё раз.'
$Started = '@[A-Za-z0-9_]+ запущен$'

function Say($text) { Write-Host ''; Write-Host $text -ForegroundColor White }
function Ok($text) { Write-Host "  ✓ $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }

# Не exit: скрипт исполняется через iex прямо в окне человека, и exit закрыл бы окно
# вместе с текстом ошибки. Бросаем исключение, его ловит последняя строка файла.
function Fail($text) {
  Write-Host ''
  Write-Host "✗ $text" -ForegroundColor Red
  Write-Host ''
  throw 'tg-chat-translator: stop'
}

# Внешние программы (npm, tar) пишут предупреждения в stderr, а PowerShell 5.1 при Stop
# превращает первую же такую строку в ошибку и обрывает установку.
function Invoke-Native([scriptblock]$Block) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block } finally { $ErrorActionPreference = $saved }
}

function Test-Ours($Path) {
  $package = Join-Path $Path 'package.json'
  # Папка с .git — клон для разработки, а не установка: обновление снесло бы историю и
  # незакоммиченное.
  (-not (Test-Path -LiteralPath (Join-Path $Path '.git'))) -and (Test-Path -LiteralPath (Join-Path $Path 'src/main.ts')) -and (Test-Path -LiteralPath $package) -and
    ((Get-Content -LiteralPath $package -Raw) -match '"name": "tg-chat-translator"')
}

# Папка, где лежит только то, что переживает обновление (или ничего), — тоже наша.
# desktop.ini и Thumbs.db Проводник кладёт сам, стоит открыть папку.
function Test-OnlyKeep($Path) {
  $ignored = @('desktop.ini', 'Thumbs.db')
  $foreign = @(Get-ChildItem -LiteralPath $Path -Force | Where-Object { ($Keep -notcontains $_.Name) -and ($ignored -notcontains $_.Name) })
  $foreign.Count -eq 0
}

function Assert-OurDir($Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  if ((Test-Path -LiteralPath $Path -PathType Container) -and ((Test-Ours $Path) -or (Test-OnlyKeep $Path))) { return }
  Fail "Папка $Path уже занята чем-то другим — не трогаю её. Освободите её или задайте другую: `$env:DIR='<папка>'."
}

# tar.exe есть в Windows 10 с 2018 года и распаковывает zip в разы быстрее Expand-Archive.
function Expand-Zip($Zip, $Into) {
  $tar = if ($env:SystemRoot) { Join-Path $env:SystemRoot 'System32/tar.exe' } else { '' }
  if ($tar -and (Test-Path -LiteralPath $tar)) {
    Invoke-Native { & $tar -xf $Zip -C $Into 2>$null }
    if ($LASTEXITCODE -eq 0) { return }
  }
  Expand-Archive -LiteralPath $Zip -DestinationPath $Into -Force
}

function New-TempDir {
  $path = Join-Path ([IO.Path]::GetTempPath()) ('tg-chat-translator-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $path | Out-Null
  $path
}

# Строка списка сумм nodejs.org для нашей сборки → @(сумма, имя файла) или $null.
function Find-NodeFile([string]$Sums, $Arch) {
  $line = ($Sums -split "`n") | Where-Object { $_ -match "^[0-9a-f]{64}\s+node-v[\d.]+-$Arch\.zip\s*$" } | Select-Object -First 1
  if (-not $line) { return $null }
  , ($line.Trim() -split '\s+')
}

# Своя копия Node в папке бота — всегда: системный кто-то обновит или удалит, и бот молча
# перестанет работать. Прав администратора не нужно. Сумма сверяется со списком nodejs.org.
function Install-Node($Arch, $Dest) {
  $exe = Join-Path $Dest 'node.exe'
  if (Test-Path -LiteralPath $exe) {
    $version = Invoke-Native { & $exe --version }
    if ("$version" -like "v$NodeMajor.*") { Ok "Node $version уже на месте"; return }
  }
  Say "Скачиваю Node ${NodeMajor}…"
  $base = "$NodeDist/latest-v$NodeMajor.x"
  $work = New-TempDir
  try {
    try { $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content }
    catch { Fail "Не скачать Node с nodejs.org. $NetHint" }
    $found = Find-NodeFile "$sums" $Arch
    if (-not $found) { Fail "На nodejs.org нет Node $NodeMajor для этой системы ($Arch)." }
    $expected, $file = $found
    $zip = Join-Path $work $file
    try { Invoke-WebRequest -Uri "$base/$file" -OutFile $zip -UseBasicParsing }
    catch { Fail "Не скачать Node с nodejs.org. $NetHint" }
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) { Fail 'Скачанный Node повреждён или подменён — запустите команду ещё раз.' }
    Expand-Zip $zip $work
    $unpacked = Join-Path $work ($file -replace '\.zip$', '')
    if (Test-Path -LiteralPath $Dest) {
      # Бот останавливается только здесь: node.exe работающего бота заперт, и заменить Node
      # под ним Windows не даст. Раньше нельзя — не скачалось бы, и бот остался бы стоять.
      Stop-Bot (Split-Path -Parent $Dest)
      Remove-Item -LiteralPath $Dest -Recurse -Force
    }
    Move-Item -LiteralPath $unpacked -Destination $Dest
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
  $version = Invoke-Native { & $exe --version }
  Ok "Node $version — в папке бота"
}

# Код — архивом с GitHub, git не нужен.
function Get-Code($Into) {
  $work = New-TempDir
  try {
    $zip = Join-Path $work 'code.zip'
    if ($Archive) { Copy-Item -LiteralPath $Archive -Destination $zip }
    else {
      try { Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $zip -UseBasicParsing }
      catch { Fail "Не скачать код с GitHub. $NetHint" }
    }
    $unpack = Join-Path $work 'unpack'
    New-Item -ItemType Directory -Path $unpack | Out-Null
    Expand-Zip $zip $unpack
    $top = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
    if (-not $top) { Fail 'Архив с кодом повреждён — запустите команду ещё раз.' }
    Move-Item -LiteralPath $top.FullName -Destination $Into
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Ours $Into)) { Fail 'В архиве не код переводчика — проверьте BRANCH или ARCHIVE.' }
}

# Обновление: из папки бота уходит всё, кроме $Keep, и на место встаёт новый код. Удаление
# по переменной — самое дорогое место для ошибки, поэтому папку проверяем ещё раз здесь.
function Update-Code($New, $Target) {
  Assert-OurDir $Target
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
  Get-ChildItem -LiteralPath $Target -Force | Where-Object { $Keep -notcontains $_.Name } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
  Get-ChildItem -LiteralPath $New -Force | Where-Object { $Keep -notcontains $_.Name } |
    ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $Target }
  Remove-Item -LiteralPath $New -Recurse -Force
}

# Шаблон для поиска процессов бота: путь к папке с обратным слэшем на конце, чтобы не
# задеть соседнюю папку вроде tg-chat-translator-old.
function Get-BotProcessPattern($Target) {
  [regex]::Escape($Target.TrimEnd('\', '/') + '\')
}

# Надзиратель и бот находятся по пути к папке бота в командной строке процесса: чужие
# процессы node и PowerShell так не задеть. Надзиратель — первым, иначе он поднимет node.
function Stop-Bot($Target) {
  $pattern = Get-BotProcessPattern $Target
  foreach ($name in @('powershell.exe', 'node.exe')) {
    Get-CimInstance Win32_Process -Filter "Name='$name'" |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Get-RunCommand($Target) {
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Target 'run.ps1')`""
}

# Автозапуск — запись Run в разделе пользователя: прав администратора не нужно, видна в
# «Параметры → Приложения → Автозагрузка». Планировщик заданий не подошёл: задание «при
# входе» без прав администратора создаётся ненадёжно, а перезапуск после падения всё равно
# делает run.ps1.
function Register-Autostart($Target) {
  # Без -Force: на разделе реестра он пересоздаёт его пустым и стирает чужую автозагрузку
  # покупателя (OneDrive, Teams, Telegram Desktop).
  if (-not (Test-Path -LiteralPath $RunKey)) { New-Item -Path $RunKey | Out-Null }
  Set-ItemProperty -Path $RunKey -Name $RunName -Value (Get-RunCommand $Target)
}

function Start-Bot($Target) {
  $runner = Join-Path $Target 'run.ps1'
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$runner`""
  ) | Out-Null
}

function Get-LogLines($Log) {
  if (Test-Path -LiteralPath $Log) { @(Get-Content -LiteralPath $Log -Encoding UTF8) } else { @() }
}

function Wait-Started($Log, $Before) {
  for ($i = 0; $i -lt 30; $i++) {
    $fresh = @(Get-LogLines $Log | Select-Object -Skip $Before)
    if ($fresh -match $Started) { return }
    Start-Sleep -Seconds 1
  }
  $token = ''
  $envFile = Join-Path $Dir '.env'
  if (Test-Path -LiteralPath $envFile) {
    $tokenLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^BOT_TOKEN=' } | Select-Object -First 1
    if ($tokenLine) { $token = $tokenLine.Substring('BOT_TOKEN='.Length) }
  }
  Get-LogLines $Log | Select-Object -Skip $Before | Select-Object -Last 20 | ForEach-Object {
    if ($token) { $_.Replace($token, '***') } else { $_ }
  } | Write-Host
  Fail 'Бот не запустился за 30 секунд — выше последние строки его журнала.'
}

function Install-Translator {
  Say 'tg-chat-translator — установка'

  $os = [Environment]::OSVersion.Version
  if ($os.Major -lt 10 -or -not [Environment]::Is64BitOperatingSystem) {
    Fail 'Нужна 64-разрядная Windows 10 или новее — на этой бот не запустится. Поставьте его на сервер: инструкция в README.'
  }
  $arch = 'win-x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'win-arm64' }

  Assert-OurDir $Dir
  $firstTime = $true
  $envFile = Join-Path $Dir '.env'
  if ((Test-Path -LiteralPath $envFile) -and (Select-String -LiteralPath $envFile -Pattern '^OWNER_ID=\d+' -Quiet)) { $firstTime = $false }

  New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  Install-Node $arch (Join-Path $Dir 'node')
  $env:Path = (Join-Path $Dir 'node') + ';' + $env:Path

  Say 'Скачиваю бота…'
  $work = Join-Path ([IO.Path]::GetTempPath()) ('tg-chat-translator-code-' + [Guid]::NewGuid().ToString('N'))
  Get-Code $work
  # Зависимости ставим во временной папке: не поставились — старая версия на месте.
  $npm = Join-Path $Dir 'node/npm.cmd'
  $npmLog = "$work.npm.log"
  Push-Location -LiteralPath $work
  try { Invoke-Native { & $npm ci --omit=dev --no-audit --no-fund --loglevel=error *> $npmLog } }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath $npmLog -Tail 20 | Write-Host
    Remove-Item -LiteralPath $work, $npmLog -Recurse -Force -ErrorAction SilentlyContinue
    Fail "Не поставились зависимости бота. $NetHint"
  }
  Remove-Item -LiteralPath $npmLog -Force -ErrorAction SilentlyContinue
  # Бот останавливается только теперь, когда всё нужное скачано: не вышло скачать — старая
  # версия работает дальше. Файлы .ts и node_modules под работающим node удаляются: node
  # их не держит.
  Stop-Bot $Dir
  Update-Code $work $Dir
  New-Item -ItemType Directory -Path (Join-Path $Dir 'data') -Force | Out-Null
  Ok "Бот — в папке $Dir"

  $node = Join-Path $Dir 'node/node.exe'
  Push-Location -LiteralPath $Dir
  try { Invoke-Native { & $node 'src/install/setup.ts' '--env' $envFile } }
  finally { Pop-Location }
  # Причину setup.ts уже сказал сам.
  if ($LASTEXITCODE -ne 0) { throw 'tg-chat-translator: stop' }

  Say 'Запускаю…'
  $log = Join-Path $Dir 'data/bot.log'
  # Журнал больше 5 МБ run.ps1 переносит в .1 при старте; если не сделать этого до подсчёта
  # строк, счёт собьётся и «запущен» будет пропущен.
  if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
  }
  $before = (Get-LogLines $log).Count
  Register-Autostart $Dir
  Start-Bot $Dir
  Wait-Started $log $before

  Write-Host ''
  if ($firstTime) {
    Write-Host '✓ Готово. Бот работает.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Откройте бота в Telegram — панель уже там. Дальше всё кнопками:'
    Write-Host 'ключ модели, языки, обращение. Как подключить бота к своему аккаунту — в УСТАНОВКЕ.'
    Write-Host ''
    Write-Host 'Бот работает, пока компьютер не спит. Чтобы переводы шли круглосуточно, поставьте его на сервер — README.'
  } else {
    Write-Host '✓ Готово. Бот обновлён и перезапущен, настройки на месте.' -ForegroundColor Green
  }
  Write-Host ''
  Write-Host '  Обновить:  та же команда, что и для установки'
  Write-Host "  Удалить:   [Net.ServicePointManager]::SecurityProtocol='Tls12'; irm $Raw/uninstall.ps1 | iex"
  Write-Host "  Журнал:    $log"
  Write-Host ''
}

# INSTALL_PS1_LIB=1 — только объявить функции: так их проверяют тесты.
if ($env:INSTALL_PS1_LIB -ne '1') {
  try { Install-Translator }
  catch { if ("$_" -ne 'tg-chat-translator: stop') { Write-Host "✗ $_" -ForegroundColor Red } }
}
