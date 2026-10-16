#!/usr/bin/env bash
#
# Удаление tg-chat-translator одной командой — с Mac и с сервера:
#   curl -fsSL https://raw.githubusercontent.com/wolkart/tg-chat-translator/main/uninstall.sh | bash
#
# Снимает только этого бота: автозапуск и папку бота, на сервере — ещё контейнер, образ и
# том. Перед удалением сохраняет копию базы: в ней ключ модели и настройки панели.
# Ни Docker, ни чужие программы, ни системный Node не трогает.

set -euo pipefail

PROJECT="tg-chat-translator"
DIR="${DIR:-$HOME/tg-chat-translator}"
LABEL="com.github.wolkart.tg-chat-translator"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RAW="https://raw.githubusercontent.com/wolkart/tg-chat-translator/main"
# Терминал для вопроса: в тестах подменяется на /dev/null.
TTY_INPUT="${UNINSTALL_TTY:-/dev/tty}"

ASSUME_YES=0
[ "${1:-}" = "--yes" ] && ASSUME_YES=1

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

# Скрипт может прийти по конвейеру из curl — тогда вход занят, ответ читаем с терминала.
# Терминала нет — ответ пустой, и удаление отменяется: молча удалять нельзя.
ask() {
  local answer=""
  { printf '%s' "$1" > "${TTY_INPUT}"; } 2> /dev/null || printf '%s' "$1" >&2
  { read -r answer < "${TTY_INPUT}"; } 2> /dev/null || true
  printf '%s' "$answer"
}

is_ours() {
  # Папка с .git — клон для разработки, а не установка: её удалять нельзя.
  [ ! -e "$1/.git" ] && [ -f "$1/src/main.ts" ] && [ -f "$1/package.json" ] && grep -q '"name": "tg-chat-translator"' "$1/package.json"
}

backup_path() {
  local path="$HOME/$PROJECT-backup-$(date +%F).db"
  [ -e "$path" ] && path="$HOME/$PROJECT-backup-$(date +%F-%H%M%S).db"
  printf '%s' "$path"
}

BACKUP=""

report_backup() {
  if [ -n "$BACKUP" ] && [ -s "$BACKUP" ]; then
    chmod 600 "$BACKUP" 2> /dev/null || true
    ok "Настройки сохранены: $BACKUP"
    warn "Внутри ключ модели — храните этот файл как пароль."
  else
    rm -f "$BACKUP" 2> /dev/null || true
    BACKUP=""
    warn "Копию настроек снять не удалось — ключ и языки после новой установки придётся вставить заново."
  fi
}

# Не «y»: его жмут не глядя. Слово целиком заставляет прочитать список выше. Копию базы
# сняли до вопроса — на отказе её убираем, иначе «ничего не тронуто» было бы неправдой.
confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  printf '\n'
  if [ "$(ask 'Удалить всё перечисленное? Напишите слово удалить: ')" != "удалить" ]; then
    [ -n "$BACKUP" ] && rm -f "$BACKUP"
    die "Отменено. Ничего не тронуто."
  fi
}

nothing_found() {
  ok "Ничего не найдено — бот на этой машине не стоит."
  printf '\n'
  exit 0
}

# --- Mac ---

uninstall_mac() {
  local domain agent=0 folder=0
  domain="gui/$(id -u)"
  { [ -f "$PLIST" ] || launchctl print "$domain/$LABEL" > /dev/null 2>&1; } && agent=1
  is_ours "$DIR" && folder=1
  [ "$agent$folder" = 00 ] && nothing_found

  say "Нашёл вот это:"
  [ "$agent" = 1 ] && printf '  автозапуск  %s\n' "$PLIST"
  [ "$folder" = 1 ] && printf '  папка       %s  (вместе с .env и базой)\n' "$DIR"

  # Копия — своим же Node из папки бота: VACUUM INTO даёт целую базу, даже пока бот пишет.
  # Если папка наша и база есть, пытаемся сделать копию, если Node доступен.
  if [ "$folder" = 1 ] && [ -f "$DIR/data/translator.db" ]; then
    BACKUP=$(backup_path)
    printf '\n'
    if [ -x "$DIR/node/bin/node" ]; then
      (cd "$DIR" && ./node/bin/node src/install/backup.ts "$BACKUP" data/translator.db) > /dev/null 2>&1 || true
    fi
    report_backup
  fi

  confirm
  say "Удаляю…"
  if [ "$agent" = 1 ]; then
    launchctl bootout "$domain/$LABEL" 2> /dev/null || true
    rm -f "$PLIST"
    ok "Автозапуск снят, бот остановлен"
  fi
  if [ "$folder" = 1 ]; then
    rm -rf "$DIR"
    ok "Папка бота удалена вместе с .env"
  fi

  cat <<TEXT

$(printf '\033[32m✓ Готово. Бот снят с этого Mac.\033[0m')

Не тронуто ничего за пределами папки бота: Node в системе, Homebrew и другие программы.

Поставить заново:
  curl -fsSL $RAW/install.sh | bash
TEXT
  if [ -n "$BACKUP" ]; then
    cat <<TEXT

Вернуть настройки — до новой установки положите копию на место, затем команда установки:
  mkdir -p "$DIR/data" && cp "$BACKUP" "$DIR/data/translator.db"
TEXT
  fi
  printf '\n'
}

# --- Сервер (Linux) ---

uninstall_linux() {
  local filter containers volumes networks images folder=0 container
  SUDO=""
  if [ "$(id -u)" != "0" ]; then
    command -v sudo > /dev/null 2>&1 || die "Не хватает прав. Войдите на сервер под root и запустите команду снова."
    SUDO="sudo"
  fi
  is_ours "$DIR" && folder=1

  DOCKER=""
  if command -v docker > /dev/null 2>&1; then
    if docker info > /dev/null 2>&1; then DOCKER="docker"
    elif [ -n "$SUDO" ] && $SUDO docker info > /dev/null 2>&1; then DOCKER="$SUDO docker"
    else die "Docker установлен, но не запущен. Запустите его: ${SUDO:+$SUDO }systemctl start docker — и повторите команду."
    fi
  fi

  # Ищем по метке, которую Docker сам ставит на всё, что создал проект. Имена не угадываем:
  # хардкод молча не нашёл бы ничего — худший исход для удаления.
  containers="" volumes="" networks="" images=""
  if [ -n "$DOCKER" ]; then
    filter="label=com.docker.compose.project=$PROJECT"
    containers=$($DOCKER ps -aq --filter "$filter" || true)
    volumes=$($DOCKER volume ls -q --filter "$filter" || true)
    networks=$($DOCKER network ls -q --filter "$filter" || true)
    images=$($DOCKER images -q "$PROJECT-translator" || true)
  fi
  [ -z "$containers$volumes$networks$images" ] && [ "$folder" = 0 ] && nothing_found

  say "Нашёл вот это:"
  [ -n "$containers" ] && $DOCKER ps -a --filter "$filter" --format '  контейнер  {{.Names}}  ({{.Status}})'
  [ -n "$images" ] && printf '  образ      %s\n' "$PROJECT-translator"
  [ -n "$volumes" ] && printf '  том        %s  (база)\n' $volumes
  [ -n "$networks" ] && $DOCKER network ls --filter "$filter" --format '  сеть       {{.Name}}'
  [ "$folder" = 1 ] && printf '  папка      %s  (вместе с .env)\n' "$DIR"

  # Пытаемся сделать копию: если том есть, пытаемся, если образ есть; иначе предупреждаем.
  if [ -n "$volumes" ]; then
    BACKUP=$(backup_path)
    printf '\n'
    if [ -n "$images" ]; then
      # Одноразовый контейнер из своего же образа: том подключается к нему, а работает ли
      # бот сейчас — неважно, VACUUM INTO снимет целую копию. root — чтобы записать в $HOME.
      $DOCKER run --rm --user root \
        -v "$(printf '%s' "$volumes" | head -n 1):/app/data" -v "$(dirname "$BACKUP"):/out" \
        "$PROJECT-translator" node src/install/backup.ts "/out/$(basename "$BACKUP")" data/translator.db \
        > /dev/null 2>&1 || true
      # Если копия создана под sudo, исправляем права: контейнер пишет от root.
      if [ -n "$SUDO" ] && [ -e "$BACKUP" ]; then
        $SUDO chown "$(id -u):$(id -g)" "$BACKUP" 2> /dev/null || true
      fi
    fi
    report_backup
  fi

  confirm
  say "Удаляю…"
  if [ -n "$containers" ]; then
    for container in $containers; do $DOCKER rm -f "$container" > /dev/null 2>&1 || die "Не удалось удалить контейнер."; done
    ok "Контейнер удалён"
  fi
  if [ -n "$volumes" ]; then
    $DOCKER volume rm $volumes > /dev/null 2>&1 || die "Не удалось удалить том с базой."
    ok "Том с базой удалён"
  fi
  if [ -n "$networks" ]; then
    # Сеть могла уйти вместе с контейнером — это не ошибка.
    $DOCKER network rm $networks > /dev/null 2>&1 || true
    ok "Сеть удалена"
  fi
  if [ -n "$images" ]; then
    $DOCKER rmi $images > /dev/null 2>&1 && ok "Образ удалён" || warn "Образ занят чем-то ещё, оставил на месте"
  fi
  if [ "$folder" = 1 ]; then
    rm -rf "$DIR"
    ok "Папка бота удалена вместе с .env"
  fi

  cat <<TEXT

$(printf '\033[32m✓ Готово. Бот снят с этого сервера.\033[0m')

Не тронуто: сам Docker и все остальные контейнеры, образы и тома.

Поставить заново:
  curl -fsSL $RAW/install.sh | bash

TEXT
}

main() {
  say "tg-chat-translator — удаление"
  case "$(uname -s)" in
    Darwin) uninstall_mac ;;
    Linux) uninstall_linux ;;
    *) die "Этот скрипт снимает бота с Mac и с сервера. Для Windows — своя команда, она в README." ;;
  esac
}

# INSTALL_SH_LIB=1 — только объявить функции: так их проверяют тесты.
[ "${INSTALL_SH_LIB:-}" = 1 ] || main "$@"
