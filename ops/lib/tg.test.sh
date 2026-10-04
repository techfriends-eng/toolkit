#!/usr/bin/env bash
# A && ok || bad безопасно: ok и bad не падают. tg.sh подключается по пути от скрипта.
# shellcheck disable=SC2015,SC1091
# Тесты ops/lib/tg.sh без сети: curl подменяется скриптом, который пишет аргументы в файл и отдаёт
# заготовленный ответ. Запуск: bash ops/lib/tg.test.sh   (выход 0 — все прошли)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat >"$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$CURL_ARGS"
cat "$CURL_REPLY"
SH
chmod +x "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH" CURL_ARGS="$TMP/args" CURL_REPLY="$TMP/reply"
. "$HERE/tg.sh"

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
reply() { printf '%s' "$1" >"$CURL_REPLY"; }
args_have() { grep -qxF -- "$1" "$CURL_ARGS"; }

export TG_TOKEN=T TG_CHAT_ID=-100

reply '{"ok":true,"result":{"message_id":42}}'
unset TG_THREAD_ID
[ "$(tg_send_text 'привет')" = 42 ] && ok "send_text печатает message_id" || bad "send_text message_id"
grep -q message_thread_id "$CURL_ARGS" && bad "General: тема не должна передаваться" || ok "General: тема не передаётся"
args_have "https://api.telegram.org/botT/sendMessage" && ok "URL метода" || bad "URL метода"

TG_THREAD_ID=620 tg_send_text 'x' 7 >/dev/null
args_have "message_thread_id=620" && args_have "reply_to_message_id=7" && ok "тема и реплай" || bad "тема и реплай"

tg_send_photo /etc/hosts '@не файл' >/dev/null
args_have "--form-string" && args_have "caption=@не файл" && ok "подпись с @ — через --form-string" || bad "подпись с @"

reply '{"ok":false,"description":"Bad Request: message thread not found"}'
if out=$(tg_send_text 'x' 2>"$TMP/err"); then bad "ошибка Telegram должна давать код 1 (вывод: $out)"; else ok "ошибка Telegram — код 1"; fi
grep -q "message thread not found" "$TMP/err" && ok "описание ошибки в stderr" || bad "описание ошибки"

unset TG_TOKEN
printf 'FROMFILE\n' >"$TMP/token"
export TG_TOKEN_FILE="$TMP/token"
reply '{"ok":true,"result":[]}'
[ "$(tg_get_updates 5)" = "[]" ] && ok "get_updates печатает массив" || bad "get_updates"
args_have "https://api.telegram.org/botFROMFILE/getUpdates" && ok "токен из TG_TOKEN_FILE без перевода строки" || bad "токен из файла"

reply '{"ok":true,"result":true}'
tg_delete_messages $(seq 1 150) >/dev/null
ids=$(grep '^message_ids=' "$CURL_ARGS" | cut -d= -f2-)
[ "$(printf '%s' "$ids" | jq length)" = 100 ] && ok "deleteMessages режет до 100 id" || bad "deleteMessages 100"
[ "$(tg_delete_messages)" = false ] && ok "пустой список — false без запроса" || bad "пустой delete"

unset TG_TOKEN_FILE
if tg_send_text x 2>/dev/null; then bad "без токена должна быть ошибка"; else ok "без токена — ошибка"; fi

[ "$fails" -eq 0 ] && echo "все прошли" || { echo "провалов: $fails"; exit 1; }
