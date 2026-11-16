# shellcheck shell=bash
# Журнал расхода LLM для bash-проектов: одна строка в llm.calls на вызов (схема — bds-content
# sql/llm_ledger.sql; TS-версия — @techfriends-eng/toolkit/llm createLedger). Подключается через source.
#
# Конфиг — переменные окружения (значение или путь к файлу через *_FILE):
#   LLM_LEDGER_DB_URL / LLM_LEDGER_DB_URL_FILE   DSN роли llm_writer; нет — журнал молча выключен
#   LLM_LEDGER_PROJECT                           проект по умолчанию (как в models.yaml)
#
# Функции ВСЕГДА возвращают 0: сбой журнала — строка в stderr, вызов модели и конвейер не падают.
# Значения уходят в psql переменными (-v), а не склейкой SQL: кавычки в ref или модели не ломают запрос.
# Требует psql; llm_ledger_from_openrouter — ещё jq.

_llm_ledger_dsn() {
  if [ -n "${LLM_LEDGER_DB_URL:-}" ]; then
    printf '%s' "$LLM_LEDGER_DB_URL"
  elif [ -n "${LLM_LEDGER_DB_URL_FILE:-}" ] && [ -s "$LLM_LEDGER_DB_URL_FILE" ]; then
    cat "$LLM_LEDGER_DB_URL_FILE"
  fi
}

# llm_ledger_log <stage> <model> [key=value ...]
#   ключи: project provider site ref prompt completion reasoning cost cached(true|false) ok(true|false)
#          models_version
llm_ledger_log() {
  local stage="${1:-}" model="${2:-}" dsn kv k v
  shift 2 || true
  dsn="$(_llm_ledger_dsn)"
  [ -n "$dsn" ] || return 0
  if [ -z "$stage" ] || [ -z "$model" ]; then
    echo "llm_ledger_log: нужны stage и model" >&2
    return 0
  fi
  local project="${LLM_LEDGER_PROJECT:-}" provider="" site="" ref="" prompt="" completion="" reasoning=""
  local cost=0 cached=false ok=true models_version=""
  for kv in "$@"; do
    k="${kv%%=*}" v="${kv#*=}"
    case "$k" in
      project) project="$v" ;; provider) provider="$v" ;; site) site="$v" ;; ref) ref="$v" ;;
      prompt) prompt="$v" ;; completion) completion="$v" ;; reasoning) reasoning="$v" ;;
      cost) cost="$v" ;; cached) cached="$v" ;; ok) ok="$v" ;; models_version) models_version="$v" ;;
      *) echo "llm_ledger_log: неизвестный ключ $k" >&2 ;;
    esac
  done
  if [ -z "$project" ]; then
    echo "llm_ledger_log: нет project (ключ project= или LLM_LEDGER_PROJECT)" >&2
    return 0
  fi
  [ "$cached" = true ] && cost=0
  # nullif(:'x', '') — пустое значение уходит NULL; числа приводятся в SQL, мусор даёт ошибку psql → stderr.
  if ! psql "$dsn" -X -q -v ON_ERROR_STOP=1 \
    -v project="$project" -v stage="$stage" -v model="$model" -v provider="$provider" -v site="$site" \
    -v ref="$ref" -v prompt="$prompt" -v completion="$completion" -v reasoning="$reasoning" \
    -v cost="${cost:-0}" -v cached="$cached" -v ok="$ok" -v models_version="$models_version" \
    >/dev/null 2>"${TMPDIR:-/tmp}/llm_ledger.$$.err" <<'SQL'
insert into llm.calls (project, stage, model, provider, site, ref, prompt_tokens, completion_tokens,
  reasoning_tokens, cost_usd, cached, ok, models_version)
values (:'project', :'stage', :'model', nullif(:'provider', ''), nullif(:'site', ''), nullif(:'ref', ''),
  nullif(:'prompt', '')::int, nullif(:'completion', '')::int, nullif(:'reasoning', '')::int,
  coalesce(nullif(:'cost', '')::numeric, 0), :'cached'::boolean, :'ok'::boolean, nullif(:'models_version', ''));
SQL
  then
    echo "llm_ledger_log: $project/$stage: запись не удалась: $(tr '\n' ' ' <"${TMPDIR:-/tmp}/llm_ledger.$$.err")" >&2
  fi
  rm -f "${TMPDIR:-/tmp}/llm_ledger.$$.err"
  return 0
}

# llm_ledger_from_openrouter <stage> <response_json_file> [key=value ...] — строка журнала из ответа
# OpenRouter chat/completions: model, usage.prompt_tokens, completion_tokens, reasoning_tokens, usage.cost
# (cost есть, если в запросе был usage: {include: true}). Ответ без usage — строка с нулями и ok=false,
# если в нём нет choices: запрос всё равно мог стоить денег, лучше видеть его в журнале.
llm_ledger_from_openrouter() {
  local stage="${1:-}" file="${2:-}"
  shift 2 || true
  [ -n "$(_llm_ledger_dsn)" ] || return 0
  [ -s "$file" ] || { echo "llm_ledger_from_openrouter: нет файла ответа $file" >&2; return 0; }
  local fields
  fields="$(jq -r '[
      (.model // "unknown"),
      (.usage.prompt_tokens // "" | tostring), (.usage.completion_tokens // "" | tostring),
      (.usage.completion_tokens_details.reasoning_tokens // "" | tostring),
      (.usage.cost // 0 | tostring),
      (if (.choices // []) | length > 0 then "true" else "false" end)
    ] | join("\u001f")' "$file" 2>/dev/null)" || { echo "llm_ledger_from_openrouter: ответ не JSON" >&2; return 0; }
  # Разделитель \x1f, а не таб: таб — пробельный для IFS, и read склеил бы пустые поля, сдвинув значения.
  local model prompt completion reasoning cost ok
  IFS=$'\x1f' read -r model prompt completion reasoning cost ok <<<"$fields"
  llm_ledger_log "$stage" "$model" provider=openrouter prompt="$prompt" completion="$completion" \
    reasoning="$reasoning" cost="$cost" ok="$ok" "$@"
}
