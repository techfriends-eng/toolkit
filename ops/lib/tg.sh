# shellcheck shell=bash
# Telegram Bot API для bash-проектов. Подключается через source; функции печатают результат в stdout,
# при ошибке пишут описание Telegram в stderr и возвращают 1 (а не печатают «null»).
#
# Конфиг — переменные окружения (значение или путь к файлу через *_FILE):
#   TG_TOKEN / TG_TOKEN_FILE      токен бота
#   TG_CHAT_ID / TG_CHAT_ID_FILE  чат
#   TG_THREAD_ID                  тема супергруппы; пусто — General (поле не передаётся вовсе)
#   TG_API                        по умолчанию https://api.telegram.org (подмена в тестах)
#
# Грабли (handbook gotchas/telegram.md): тема для General не передаётся (#general-topic); подписи и
# тексты — через --form-string/--data-urlencode: curl -F принимает значение, начинающееся с @ или <,
# за путь к файлу; sendDocument не пережимает картинку (#send-document); deleteMessages — до 100 id
# и только моложе 48 часов (#delete-limits). Требует curl и jq.

_tg_secret() { # _tg_secret NAME — значение NAME или содержимое файла из NAME_FILE
  local name=$1 file_var="${1}_FILE"
  if [ -n "${!name:-}" ]; then
    printf '%s' "${!name}"
  elif [ -n "${!file_var:-}" ] && [ -r "${!file_var}" ]; then
    tr -d '\n' <"${!file_var}"
  else
    echo "tg: не задан ${name} (или ${file_var})" >&2
    return 1
  fi
}

_tg_url() { # _tg_url METHOD
  local token
  token=$(_tg_secret TG_TOKEN) || return 1
  printf '%s/bot%s/%s' "${TG_API:-https://api.telegram.org}" "$token" "$1"
}

_tg_result() { # _tg_result JQ_ARGS... — читает ответ из stdin; при ok:false — описание в stderr, код 1
  local body
  body=$(cat)
  if [ "$(printf '%s' "$body" | jq -r '.ok // false' 2>/dev/null)" != "true" ]; then
    echo "tg: $(printf '%s' "$body" | jq -r '.description // "ответ не JSON"' 2>/dev/null)" >&2
    return 1
  fi
  printf '%s' "$body" | jq -r "$@"
}

_tg_thread_args() { # аргументы темы и реплая для curl; печатает по одному на строку
  local mode=$1 reply_to=${2:-}
  if [ -n "${TG_THREAD_ID:-}" ] && [ "${TG_THREAD_ID}" != "0" ]; then
    printf '%s\n%s\n' "$mode" "message_thread_id=${TG_THREAD_ID}"
  fi
  if [ -n "$reply_to" ]; then
    printf '%s\n%s\n' "$mode" "reply_to_message_id=${reply_to}"
  fi
}

# tg_send_text TEXT [REPLY_TO] — печатает message_id. TG_PARSE_MODE (например HTML) — по желанию.
tg_send_text() {
  local text=$1 reply_to=${2:-} chat url
  chat=$(_tg_secret TG_CHAT_ID) || return 1
  url=$(_tg_url sendMessage) || return 1
  local args=(--data-urlencode "chat_id=${chat}" --data-urlencode "text=${text}")
  [ -n "${TG_PARSE_MODE:-}" ] && args+=(--data-urlencode "parse_mode=${TG_PARSE_MODE}")
  while IFS= read -r a; do args+=("$a"); done < <(_tg_thread_args --data-urlencode "$reply_to")
  curl -sS -m 30 "$url" "${args[@]}" | _tg_result '.result.message_id'
}

_tg_send_file() { # _tg_send_file METHOD FIELD PATH CAPTION [REPLY_TO]
  local method=$1 field=$2 path=$3 caption=$4 reply_to=${5:-} chat url
  chat=$(_tg_secret TG_CHAT_ID) || return 1
  url=$(_tg_url "$method") || return 1
  local args=(--form-string "chat_id=${chat}" -F "${field}=@${path}" --form-string "caption=${caption}")
  [ -n "${TG_PARSE_MODE:-}" ] && args+=(--form-string "parse_mode=${TG_PARSE_MODE}")
  while IFS= read -r a; do args+=("$a"); done < <(_tg_thread_args --form-string "$reply_to")
  curl -sS -m 60 "$url" "${args[@]}" | _tg_result '.result.message_id'
}

# tg_send_photo PATH CAPTION [REPLY_TO] — печатает message_id. Telegram пережимает JPEG.
tg_send_photo() { _tg_send_file sendPhoto photo "$@"; }

# tg_send_document PATH CAPTION [REPLY_TO] — печатает message_id. Без пережатия: для схем и скриншотов.
tg_send_document() { _tg_send_file sendDocument document "$@"; }

# tg_get_updates OFFSET [ALLOWED_JSON] — печатает JSON-массив апдейтов. Курсор двигает вызывающий:
# offset = max(update_id)+1 по ВСЕМ апдейтам, включая отброшенные фильтром (#admin-sees-all).
tg_get_updates() {
  local offset=$1 allowed=${2:-'["message"]'} url
  url=$(_tg_url getUpdates) || return 1
  curl -sS -m 30 "$url" --data-urlencode "offset=${offset}" --data-urlencode "allowed_updates=${allowed}" \
    | _tg_result -c '.result'
}

# tg_delete_messages ID [ID...] — до 100 id за вызов; печатает true/false. Уборка, а не критичный
# шаг: отказ Telegram не превращается в ошибку скрипта.
tg_delete_messages() {
  local ids chat url
  ids=$(printf '%s\n' "$@" | jq -R 'select(length>0) | tonumber' | jq -s -c '.[0:100]')
  [ "$ids" = "[]" ] && { echo false; return 0; }
  chat=$(_tg_secret TG_CHAT_ID) || return 1
  url=$(_tg_url deleteMessages) || return 1
  curl -sS -m 30 "$url" --data-urlencode "chat_id=${chat}" --data-urlencode "message_ids=${ids}" \
    | jq -r '.ok // false'
}
