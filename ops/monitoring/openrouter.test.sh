#!/usr/bin/env bash
# A && ok || bad безопасно: ok и bad не падают.
# shellcheck disable=SC2015,SC1091,SC2016,SC2329  # $ в ожидаемых строках — буква; note и grade_low зовёт openrouter.sh
# Тесты сторожа баланса OpenRouter без сети. Запуск: bash ops/monitoring/openrouter.test.sh
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/openrouter.sh"

fails=0
ok() { echo "ok   $1"; }
bad() {
  echo "FAIL $1 — получено: $2"
  fails=$((fails + 1))
}

# Копия grade_low из check.sh: тест не тянет весь check.sh.
grade_low() {
  local v=$1 w=$2 c=$3
  if [ "$v" -le "$c" ] 2>/dev/null; then
    echo crit
  elif [ "$v" -le "$w" ] 2>/dev/null; then
    echo warn
  else echo ok; fi
}
SEV="" VAL=""
note() { SEV=$2 VAL=$3; }

expect() { # название ожидаемый_уровень подстрока_значения
  [ "$SEV" = "$2" ] && [[ "$VAL" == *"$3"* ]] && ok "$1" || bad "$1" "$SEV|$VAL"
}

or_credits_note 200 '{"data":{"total_credits":20,"total_usage":7.5}}' 5 1
expect "остаток 12.50 — ok" ok 'осталось $12.50 (куплено $20.00, потрачено $7.50)'

or_credits_note 200 '{"data":{"total_credits":10,"total_usage":5.4}}' 5 1
expect "остаток 4.60 — warn" warn 'осталось $4.60'

or_credits_note 200 '{"data":{"total_credits":10,"total_usage":9.47}}' 5 1
expect "остаток 0.53 — crit (случай 26.11)" crit 'осталось $0.53'

or_credits_note 200 '{"data":{"total_credits":10,"total_usage":10.2}}' 5 1
expect "перерасход — crit" crit 'осталось $-0.20'

or_credits_note 200 '{"data": {"total_usage": 1.5e1, "total_credits": 2e1}}' 5 1
expect "экспонента и порядок полей" ok 'осталось $5.00'

or_credits_note 200 '{"data":{"total_credits":100,"total_usage":95}}' 10 2
expect "свои пороги" warn 'осталось $5.00'

or_credits_note 403 '{"error":{"message":"Forbidden"}}' 5 1
expect "403 — warn про management-ключ" warn "management-ключ"

or_credits_note 000 '' 5 1
expect "нет ответа — warn" warn "не ответил"

or_credits_note 500 'oops' 5 1
expect "500 — warn с кодом" warn "HTTP 500"

or_credits_note 200 '{"data":{}}' 5 1
expect "нет полей — warn" warn "без total_credits"

tmp=$(mktemp -d)
printf 'FOO=1\nOPENROUTER_API_KEY="sk-or-v1-abc"\n' >"$tmp/env"
[ "$(or_key "$tmp/env")" = sk-or-v1-abc ] && ok "ключ из env-файла" || bad "ключ из env-файла" "$(or_key "$tmp/env")"
printf '\n  sk-or-v1-raw  \n' >"$tmp/raw"
[ "$(or_key "$tmp/raw")" = sk-or-v1-raw ] && ok "ключ первой строкой" || bad "ключ первой строкой" "$(or_key "$tmp/raw")"
printf "export OPENROUTER_API_KEY='sk-q'\n" >"$tmp/exp"
[ "$(or_key "$tmp/exp")" = sk-q ] && ok "export и одинарные кавычки" || bad "export и одинарные кавычки" "$(or_key "$tmp/exp")"
rm -rf "$tmp"

[ "$fails" = 0 ] && echo "все тесты прошли" || echo "провалов: $fails"
exit "$fails"
