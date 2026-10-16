#!/usr/bin/env bash
#
# Установка tg-chat-translator одной командой — на Mac и на сервер с Linux:
#   curl -fsSL https://raw.githubusercontent.com/wolkart/tg-chat-translator/main/install.sh | bash
#
# Mac — без Docker: своя копия Node в папке бота и автозапуск при входе в систему.
# Сервер — Docker: бот поднимается сам после сбоя и перезагрузки.
# Повторный запуск — обновление: код новый, .env и база остаются на месте.
#
# Спрашивает только токен бота и находит владельца по /start. Остальное — кнопками в боте.
#
# Для проверки до слияния:
#   BRANCH  — ветка (по умолчанию main);
#   DIR     — папка бота (по умолчанию ~/tg-chat-translator);
#   ARCHIVE — локальный архив кода вместо GitHub:
#             git archive --prefix=tg-chat-translator/ -o /tmp/t.tar.gz HEAD

set -euo pipefail

REPO="wolkart/tg-chat-translator"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-$HOME/tg-chat-translator}"
ARCHIVE="${ARCHIVE:-}"
NODE_DIST="${NODE_DIST:-https://nodejs.org/dist}"
NODE_MAJOR=24
LABEL="com.github.wolkart.tg-chat-translator"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RAW="https://raw.githubusercontent.com/$REPO/$BRANCH"
# Что в папке бота живёт дольше кода: обновление их не трогает.
KEEP=".env data node"
NET_HINT="Если вы в России — включите VPN на весь компьютер, не только в браузере, и запустите команду ещё раз."

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

fetch_to() { curl -fsSL --retry 2 --connect-timeout 20 --speed-limit 1024 --speed-time 60 -o "$2" "$1"; }

sha256() {
  if command -v shasum > /dev/null 2>&1; then shasum -a 256 "$1" | awk '{ print $1 }'
  else sha256sum "$1" | awk '{ print $1 }'; fi
}

# Скрипт приходит по конвейеру из curl — вход занят им самим, вопросы читаем с терминала.
# Терминала нет (запуск из другой программы) — вопросы получат пустой ввод и прервутся.
tty_input() {
  if (: < /dev/tty) 2> /dev/null; then echo /dev/tty; else echo /dev/null; fi
}

# --- Папка бота ---

is_ours() {
  # Папка с .git — клон для разработки (cd ~ && git clone даёт ровно такой путь): обновление
  # снесло бы историю и незакоммиченное.
  [ ! -e "$1/.git" ] && [ -f "$1/src/main.ts" ] && [ -f "$1/package.json" ] && grep -q '"name": "tg-chat-translator"' "$1/package.json"
}

# Папка, где лежит только то, что переживает обновление (или ничего), — тоже наша:
# прошлая установка могла оборваться, успев скачать один Node. .DS_Store кладёт Finder, стоит
# открыть папку.
only_keep() {
  local entry
  for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    [ "$(basename "$entry")" = ".DS_Store" ] && continue
    case " $KEEP " in *" $(basename "$entry") "*) ;; *) return 1 ;; esac
  done
  return 0
}

check_dir() {
  [ ! -e "$DIR" ] && return 0
  [ -d "$DIR" ] && { is_ours "$DIR" || only_keep "$DIR"; } && return 0
  die "Папка $DIR уже занята чем-то другим — не трогаю её. Освободите её или запустите команду с DIR=<другая папка>."
}

# Код — архивом с GitHub, а не git clone: на чистом Mac вызов git открывает окно
# «Установить инструменты разработчика», а на голом сервере git нет вовсе.
download_code() {
  local into="$1" archive="$1.tar.gz"
  if [ -n "$ARCHIVE" ]; then
    cp "$ARCHIVE" "$archive" || die "Не прочитать архив $ARCHIVE."
  else
    fetch_to "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" "$archive" ||
      { rm -f "$archive"; die "Не скачать код с GitHub. $NET_HINT"; }
  fi
  tar -xzf "$archive" -C "$into" --strip-components 1 ||
    { rm -f "$archive"; die "Архив с кодом повреждён — запустите команду ещё раз."; }
  rm -f "$archive"
  is_ours "$into" || die "В архиве не код переводчика — проверьте BRANCH или ARCHIVE."
}

# Обновление: из папки бота уходит всё, кроме KEEP, и на место встаёт новый код. Так
# файлы, удалённые в новой версии, не остаются висеть. rm -rf по переменной — самое
# дорогое место для ошибки, поэтому папку проверяем ещё раз прямо здесь.
replace_code() {
  local new="$1" dir="$2" entry name
  if [ -e "$dir" ] && ! { is_ours "$dir" || only_keep "$dir"; }; then
    die "Папка $dir уже занята чем-то другим — не трогаю её."
  fi
  mkdir -p "$dir"
  for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name=$(basename "$entry")
    case " $KEEP " in *" $name "*) continue ;; esac
    rm -rf "$entry"
  done
  for entry in "$new"/* "$new"/.[!.]* "$new"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name=$(basename "$entry")
    case " $KEEP " in *" $name "*) rm -rf "$entry"; continue ;; esac
    mv "$entry" "$dir/"
  done
  rmdir "$new"
}

# Строка «@бот запущен» — её пишет main.ts, когда поднялся. Другие строки со словом
# «запущен» («этот же бот запущен ещё в одном месте») под шаблон не подходят.
STARTED='@[A-Za-z0-9_]+ запущен$'

# Последние строки журнала — без токена, даже если он туда как-то попал.
show_log_tail() {
  local token=""
  [ -f "$DIR/.env" ] && token=$(grep -E '^BOT_TOKEN=' "$DIR/.env" | head -n 1 | cut -d= -f2- || true)
  if [ -n "$token" ]; then sed "s|$token|***|g"; else cat; fi | tail -n 20
}

finish() {
  local first_time="$1" logs="$2"
  printf '\n\033[32m✓ Готово.\033[0m '
  if [ "$first_time" = 1 ]; then
    cat <<TEXT
Бот работает.

Откройте бота в Telegram — панель уже там. Дальше всё кнопками:
ключ модели, языки, обращение. Как подключить бота к своему аккаунту — в УСТАНОВКЕ.
TEXT
  else
    echo "Бот обновлён и перезапущен, настройки на месте."
  fi
  cat <<TEXT

  Обновить:  та же команда, что и для установки
  Удалить:   curl -fsSL $RAW/uninstall.sh | bash
  Журнал:    $logs

TEXT
}

# --- Mac ---

macos_ok() {
  local major rest minor
  major=${1%%.*}
  rest=${1#*.}
  [ "$rest" = "$1" ] && rest=0
  minor=${rest%%.*}
  [ "$major" -gt 13 ] || { [ "$major" -eq 13 ] && [ "$minor" -ge 5 ]; }
}

mac_node_arch() {
  case "$(uname -m)" in
    arm64) echo darwin-arm64 ;;
    x86_64) echo darwin-x64 ;;
    *) return 1 ;;
  esac
}

# Своя копия Node в папке бота — всегда, даже если в системе есть подходящий: Homebrew
# обновит или удалит системный, и бот молча перестанет работать. Права администратора не
# нужны, чужие версии Node не трогаются. Сумма сверяется со списком nodejs.org.
ensure_node() {
  local arch="$1" dest="$2" base work file expected actual
  if [ -x "$dest/bin/node" ] && "$dest/bin/node" --version 2> /dev/null | grep -q "^v$NODE_MAJOR\."; then
    ok "Node $("$dest/bin/node" --version) уже на месте"
    return 0
  fi
  say "Скачиваю Node ${NODE_MAJOR}…"
  base="$NODE_DIST/latest-v$NODE_MAJOR.x"
  work=$(mktemp -d)
  fetch_to "$base/SHASUMS256.txt" "$work/SHASUMS256.txt" ||
    { rm -rf "$work"; die "Не скачать Node с nodejs.org. $NET_HINT"; }
  file=$(grep -oE "node-v[0-9.]+-$arch\.tar\.gz" "$work/SHASUMS256.txt" | head -n 1 || true)
  [ -n "$file" ] || { rm -rf "$work"; die "На nodejs.org нет Node $NODE_MAJOR для этой системы ($arch)."; }
  expected=$(awk -v name="$file" '$2 == name { print $1 }' "$work/SHASUMS256.txt")
  fetch_to "$base/$file" "$work/$file" ||
    { rm -rf "$work"; die "Не скачать Node с nodejs.org. $NET_HINT"; }
  actual=$(sha256 "$work/$file")
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    rm -rf "$work"
    die "Скачанный Node повреждён или подменён — запустите команду ещё раз."
  fi
  mkdir "$work/node"
  tar -xzf "$work/$file" -C "$work/node" --strip-components 1 ||
    { rm -rf "$work"; die "Архив Node не распаковался — запустите команду ещё раз."; }
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  mv "$work/node" "$dest"
  rm -rf "$work"
  ok "Node $("$dest/bin/node" --version) — в папке бота"
}

# Через sed, а не ${text//</&lt;}: в bash 5.2 знак & в замене означает найденный текст,
# и тот, у кого bash из Homebrew, получил бы испорченный путь.
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

write_plist() {
  local dir
  dir=$(xml_escape "$DIR")
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$dir/node/bin/node</string>
    <string>src/main.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$dir</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$dir/data/bot.log</string>
  <key>StandardErrorPath</key>
  <string>$dir/data/bot.log</string>
</dict>
</plist>
PLIST
}

# Автозапуск — LaunchAgent: бот стартует при входе в систему и поднимается после сбоя,
# без прав администратора. Задание перезаписывается при каждой установке.
start_launchd() {
  local domain
  domain="gui/$(id -u)"
  write_plist
  plutil -lint "$PLIST" > /dev/null || die "Не получилось записать файл автозапуска $PLIST."
  if launchctl print "$domain/$LABEL" > /dev/null 2>&1; then
    launchctl bootout "$domain/$LABEL" 2> /dev/null || true
    # bootout возвращается раньше, чем задание снято, и bootstrap сразу за ним иногда
    # падает с «Input/output error» — ждём, пока задание действительно уйдёт. До 25 секунд:
    # launchd даёт заданию до 20 на выход, а бот дожидается идущего перевода.
    for _ in $(seq 1 50); do
      launchctl print "$domain/$LABEL" > /dev/null 2>&1 || break
      sleep 0.5
    done
  fi
  launchctl bootstrap "$domain" "$PLIST" ||
    die "macOS не включила автозапуск бота. Перезагрузите Mac и запустите команду ещё раз."
}

wait_started_mac() {
  local log="$1" from="$2"
  for _ in $(seq 1 30); do
    if [ -f "$log" ] && tail -c +"$((from + 1))" "$log" | grep -E "$STARTED" > /dev/null; then return 0; fi
    sleep 1
  done
  [ -f "$log" ] && tail -c +"$((from + 1))" "$log" | show_log_tail
  die "Бот не запустился за 30 секунд — выше последние строки его журнала."
}

install_mac() {
  local version arch work log from first_time=1
  version=$(sw_vers -productVersion)
  macos_ok "$version" ||
    die "Нужна macOS 13.5 или новее — на этой ($version) бот не запустится. Поставьте его на сервер: инструкция в README."
  arch=$(mac_node_arch) || die "Не знаю такой процессор: $(uname -m). Поставьте бота на сервер: инструкция в README."
  check_dir
  [ -f "$DIR/.env" ] && grep -qE '^OWNER_ID=[0-9]+' "$DIR/.env" && first_time=0

  mkdir -p "$DIR"
  ensure_node "$arch" "$DIR/node"
  export PATH="$DIR/node/bin:$PATH"

  say "Скачиваю бота…"
  work=$(mktemp -d "$HOME/.tg-chat-translator-new.XXXXXX")
  download_code "$work"
  # Зависимости ставим во временную папку: не поставились — старая версия работает дальше.
  (cd "$work" && npm ci --omit=dev --no-audit --no-fund --loglevel=error) > "$work.npm.log" 2>&1 || {
    tail -n 20 "$work.npm.log"
    rm -rf "$work" "$work.npm.log"
    die "Не поставились зависимости бота. $NET_HINT"
  }
  rm -f "$work.npm.log"
  replace_code "$work" "$DIR"
  mkdir -p "$DIR/data"
  ok "Бот — в папке $DIR"

  (cd "$DIR" && node src/install/setup.ts --env "$DIR/.env" < "$(tty_input)") || exit 1

  say "Запускаю…"
  log="$DIR/data/bot.log"
  # Журнал пишет launchd и не обрезает его — обрезаем сами, при каждом обновлении.
  if [ -f "$log" ] && [ "$(wc -c < "$log")" -gt 5000000 ]; then mv "$log" "$log.1"; fi
  from=0
  [ -f "$log" ] && from=$(($(wc -c < "$log")))
  start_launchd
  wait_started_mac "$log" "$from"
  finish "$first_time" "$log"
  if [ "$first_time" = 1 ]; then
    echo "Бот работает, пока Mac не спит. Чтобы переводы шли круглосуточно, поставьте его на сервер — README."
    echo
  fi
}

# --- Сервер (Linux) ---

install_pkg() {
  local pkg="$1"
  say "Ставлю ${pkg}…"
  if command -v apt-get > /dev/null 2>&1; then
    $SUDO apt-get update -qq > /dev/null 2>&1 || true
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg" > /dev/null 2>&1 || true
  elif command -v dnf > /dev/null 2>&1; then
    $SUDO dnf install -y -q "$pkg" > /dev/null 2>&1 || true
  elif command -v yum > /dev/null 2>&1; then
    $SUDO yum install -y -q "$pkg" > /dev/null 2>&1 || true
  else
    die "Не знаю пакетный менеджер этой системы. Поставьте $pkg сами и повторите команду."
  fi
  command -v "$pkg" > /dev/null 2>&1 || die "Не удалось поставить $pkg."
  ok "$pkg поставлен"
}

wait_started_docker() {
  for _ in $(seq 1 30); do
    $DOCKER compose logs --no-log-prefix translator 2> /dev/null | grep -E "$STARTED" > /dev/null && return 0
    sleep 1
  done
  $DOCKER compose logs --no-log-prefix translator 2> /dev/null | show_log_tail
  die "Бот не запустился за 30 секунд — выше последние строки его журнала."
}

install_linux() {
  local work build_log first_time=1
  # Ставить пакеты и говорить с Docker может только root. Вошёл не root — работаем через
  # sudo, а не падаем на середине с «Permission denied».
  SUDO=""
  if [ "$(id -u)" != "0" ]; then
    command -v sudo > /dev/null 2>&1 || die "Не хватает прав. Войдите на сервер под root и запустите команду снова."
    SUDO="sudo"
  fi
  command -v tar > /dev/null 2>&1 || install_pkg tar

  if command -v docker > /dev/null 2>&1; then
    ok "Docker уже стоит"
  else
    say "Ставлю Docker…"
    curl -fsSL https://get.docker.com | $SUDO sh > /dev/null 2>&1 || die "Не удалось поставить Docker."
    ok "Docker поставлен"
  fi
  # Свежий Docker слушается только root. Один раз решаем, каким вызовом работать дальше,
  # и его же печатаем в подсказках — иначе скопированные из них команды не сработают.
  DOCKER="docker"
  if ! docker info > /dev/null 2>&1; then
    if [ -n "$SUDO" ] && $SUDO docker info > /dev/null 2>&1; then
      DOCKER="$SUDO docker"
    else
      die "Docker установлен, но не запущен. Запустите его: ${SUDO:+$SUDO }systemctl start docker — и повторите команду."
    fi
  fi
  $DOCKER compose version > /dev/null 2>&1 || die "Нет docker compose. Обновите Docker до свежей версии."

  check_dir
  [ -f "$DIR/.env" ] && grep -qE '^OWNER_ID=[0-9]+' "$DIR/.env" && first_time=0
  say "Скачиваю бота…"
  work=$(mktemp -d)
  download_code "$work"
  replace_code "$work" "$DIR"
  ok "Бот — в папке $DIR"
  cd "$DIR"

  # Образ Node — отдельным шагом, чтобы отказ Docker Hub узнать по нему, а не по выводу сборки.
  say "Скачиваю образ Node…"
  $DOCKER pull "node:$NODE_MAJOR-slim" > /dev/null 2>&1 ||
    die "Docker Hub недоступен — для серверов в России он закрыт. Возьмите сервер за рубежом."
  say "Собираю бота…"
  build_log=$(mktemp)
  $DOCKER compose build > "$build_log" 2>&1 || {
    tail -n 30 "$build_log"
    die "Сборка не удалась — выше последние строки."
  }
  rm -f "$build_log"

  # Пустой .env — до вопросов: без него Compose не запустит даже одноразовый контейнер.
  [ -f .env ] || { touch .env; chmod 600 .env; }
  # Вопросы — в одноразовом контейнере: Node на сервере есть только в образе. root —
  # потому что образ работает под node, а папка на хосте принадлежит root.
  $DOCKER compose run --rm --no-deps --user root -v "$DIR:/out" translator \
    node src/install/setup.ts --env /out/.env < "$(tty_input)" || exit 1

  say "Запускаю…"
  $DOCKER compose up -d --force-recreate > /dev/null 2>&1 ||
    die "Контейнер не поднялся. Журнал: cd $DIR && $DOCKER compose logs"
  wait_started_docker
  finish "$first_time" "cd $DIR && $DOCKER compose logs -f"
}

main() {
  say "tg-chat-translator — установка"
  case "$(uname -s)" in
    Darwin) install_mac ;;
    Linux) install_linux ;;
    *) die "Этот скрипт ставит бота на Mac и на сервер с Linux. Для Windows — своя команда, она в README." ;;
  esac
}

# INSTALL_SH_LIB=1 — только объявить функции: так их проверяют тесты.
[ "${INSTALL_SH_LIB:-}" = 1 ] || main "$@"
