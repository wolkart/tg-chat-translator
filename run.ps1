# Файл сохранён в UTF-8 с BOM: без него Windows PowerShell 5.1 читает скрипт в кодировке
# Windows, а не UTF-8.
#
# Надзиратель бота на Windows: запускает node, а после выхода ждёт 10 секунд и запускает
# снова — так бот поднимается после сбоя. Его скрыто, без окна, зовёт запись автозагрузки
# (HKCU\...\Run), которую делает install.ps1. Остановить — uninstall.ps1 или повторная
# установка: они находят этот процесс по пути к папке бота.

$ErrorActionPreference = 'Continue'
# node пишет в UTF-8, а PowerShell читает вывод программ в кодировке консоли — без этой
# строки русский текст в журнале превратился бы в кракозябры.
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$dir = $PSScriptRoot
Set-Location -LiteralPath $dir
$node = Join-Path $dir 'node/node.exe'
$log = Join-Path $dir 'data/bot.log'
New-Item -ItemType Directory -Path (Join-Path $dir 'data') -Force | Out-Null

while ($true) {
  # Журнал никто, кроме нас, не обрезает.
  if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
  }
  # Построчно через Add-Content: строка сразу на диске — установщик ждёт в журнале строку
  # «запущен». "$_" — чтобы строка из stderr легла текстом, а не ошибкой PowerShell.
  & $node 'src/main.ts' 2>&1 | ForEach-Object { Add-Content -LiteralPath $log -Value "$_" -Encoding UTF8 }
  Start-Sleep -Seconds 10
}
