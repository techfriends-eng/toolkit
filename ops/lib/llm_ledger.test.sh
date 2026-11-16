#!/usr/bin/env bash
# A && ok || bad безопасно: ok и bad не падают. llm_ledger.sh подключается по пути от скрипта.
# shellcheck disable=SC2015,SC1091
# Тесты ops/lib/llm_ledger.sh без базы: psql подменяется скриптом, который пишет аргументы и SQL в файл.
# Запуск: bash ops/lib/llm_ledger.test.sh   (выход 0 — все прошли)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat >"$TMP/bin/psql" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$PSQL_ARGS"
cat >"$PSQL_ARGS.sql"
[ -e "$PSQL_FAIL" ] && { echo "connection refused" >&2; exit 2; }
exit 0
SH
chmod +x "$TMP/bin/psql"
export PATH="$TMP/bin:$PATH" PSQL_ARGS="$TMP/args" PSQL_FAIL="$TMP/fail" TMPDIR="$TMP"
. "$HERE/llm_ledger.sh"

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
has() { grep -qxF -- "$2" "$PSQL_ARGS" && ok "$1" || bad "$1: нет '$2' в $(tr '\n' ' ' <"$PSQL_ARGS")"; }

unset LLM_LEDGER_DB_URL LLM_LEDGER_DB_URL_FILE
llm_ledger_log caption deepseek/deepseek-chat project=telegram_bds
[ ! -e "$PSQL_ARGS" ] && ok "без DSN — psql не вызывается" || bad "без DSN вызван psql"

printf 'postgresql://llm_writer.t:p@h:5432/postgres' >"$TMP/dsn"
export LLM_LEDGER_DB_URL_FILE="$TMP/dsn" LLM_LEDGER_PROJECT=wiki_visualizer
llm_ledger_log prompt_refine "deepseek/deepseek-chat" ref="o'reilly_kafka" prompt=120 completion=80 cost=0.0003
has "DSN из файла" "postgresql://llm_writer.t:p@h:5432/postgres"
has "проект по умолчанию" "project=wiki_visualizer"
has "ref с кавычкой — переменной, не в SQL" "ref=o'reilly_kafka"
has "токены" "prompt=120"
has "стоимость" "cost=0.0003"
grep -q "insert into llm.calls" "$PSQL_ARGS.sql" && ok "SQL — insert в llm.calls" || bad "SQL"
grep -q "o'reilly" "$PSQL_ARGS.sql" && bad "значение попало в текст SQL" || ok "значения не в тексте SQL"

llm_ledger_log write m project=bds-satellites cached=true cost=0.5
has "кэш — cost 0" "cost=0"
has "кэш — cached true" "cached=true"
has "проект из ключа сильнее умолчания" "project=bds-satellites"

touch "$PSQL_FAIL"
out="$(llm_ledger_log write m 2>&1; echo "rc=$?")"
rm -f "$PSQL_FAIL"
[[ "$out" == *"запись не удалась: connection refused"* ]] && ok "сбой базы — строка в stderr" || bad "сбой базы: $out"
[[ "$out" == *"rc=0" ]] && ok "сбой базы — код 0" || bad "сбой базы: код не 0"

rm -f "$PSQL_ARGS"
llm_ledger_log "" m
[ ! -e "$PSQL_ARGS" ] && ok "без stage — не пишем" || bad "без stage записали"

cat >"$TMP/resp.json" <<'JSON'
{"model":"openai/gpt-4o-mini","choices":[{"message":{"content":"x"}}],
 "usage":{"prompt_tokens":500,"completion_tokens":60,"cost":0.00012,"completion_tokens_details":{"reasoning_tokens":7}}}
JSON
llm_ledger_from_openrouter prompt_refine "$TMP/resp.json" ref=kafka
has "openrouter: фактическая модель ответа" "model=openai/gpt-4o-mini"
has "openrouter: provider" "provider=openrouter"
has "openrouter: reasoning" "reasoning=7"
has "openrouter: cost" "cost=0.00012"
has "openrouter: ok" "ok=true"
has "openrouter: доп. ключ" "ref=kafka"

echo '{"error":{"message":"no balance"}}' >"$TMP/err.json"
llm_ledger_from_openrouter image "$TMP/err.json"
has "ответ без choices — ok false" "ok=false"
has "ответ без модели — unknown" "model=unknown"

[[ $fails -eq 0 ]] && echo "llm_ledger: все проверки прошли" || { echo "llm_ledger: провалов $fails"; exit 1; }
