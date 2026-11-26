# shellcheck shell=bash
# Баланс OpenRouter. Подключается из check.sh, когда задан OPENROUTER_KEY_FILE; нужны note и grade_low.
#
# Зачем: 24–26.11 у OpenRouter кончились деньги, и встали все, кто через него ходит (спутники, правки,
# обложки). Снаружи это выглядело как «модель не ответила», а мониторинг увидел беду только через двое
# суток — по тишине прогонов (sat_run crit). Сторож баланса видит её до отказа.
#
# /etc/monitoring.env:
#   OPENROUTER_KEY_FILE  файл с ключом (root, 600): сам ключ первой строкой или строка OPENROUTER_API_KEY=...
#                        — подойдёт и env-файл проекта, например /etc/stack-radar.env
#   OPENROUTER_WARN_USD  warn при остатке меньше этого, по умолчанию 5
#   OPENROUTER_CRIT_USD  crit при остатке меньше этого, по умолчанию 1
#
# GET /api/v1/credits отдаёт total_credits и total_usage аккаунта. По документации OpenRouter для него
# нужен management-ключ; обычный ключ на части аккаунтов тоже проходит. Ответ 401/403 — warn с подсказкой.

# Ключ из файла: строка OPENROUTER_API_KEY=… (кавычки снимаются) или первая непустая строка.
or_key() {
  local f=$1 line
  line=$(grep -m1 -E '^(export +)?OPENROUTER_API_KEY=' "$f" 2>/dev/null)
  if [ -n "$line" ]; then
    line=${line#*=}
    line=${line%\"}
    line=${line#\"}
    line=${line%\'}
    line=${line#\'}
  else
    line=$(grep -m1 -v '^[[:space:]]*$' "$f" 2>/dev/null)
  fi
  printf '%s' "$line" | tr -d '[:space:]'
}

# Число из JSON по имени поля: "total_credits": 12.5 -> 12.5. Пусто, если поля нет.
or_field() {
  grep -oE "\"$1\"[[:space:]]*:[[:space:]]*-?[0-9.]+([eE][-+]?[0-9]+)?" <<<"$2" | head -1 | sed -E 's/.*:[[:space:]]*//'
}

# Доллары -> целые центы (для grade_low): 4.999 -> 499, 5 -> 500.
or_cents() { awk -v v="$1" 'BEGIN { printf "%d", v * 100 + (v < 0 ? -0.5 : 0.5) }'; }

# Оценка по коду и телу ответа /credits. Пороги — в долларах.
or_credits_note() { # http_code тело warn_usd crit_usd
  local code=$1 body=$2 warn=$3 crit=$4 total used left cents
  local hint="https://openrouter.ai/settings/credits"
  case "$code" in
    200) ;;
    000)
      note openrouter_credits warn "openrouter.ai не ответил" "curl -sI https://openrouter.ai/api/v1/credits"
      return
      ;;
    401 | 403)
      note openrouter_credits warn "ключ не даёт /credits (HTTP $code) — нужен management-ключ" \
        "https://openrouter.ai/settings/management-keys → OPENROUTER_KEY_FILE"
      return
      ;;
    *)
      note openrouter_credits warn "/credits ответил HTTP $code" "$hint"
      return
      ;;
  esac
  total=$(or_field total_credits "$body")
  used=$(or_field total_usage "$body")
  if [ -z "$total" ] || [ -z "$used" ]; then
    note openrouter_credits warn "/credits без total_credits/total_usage" "$hint"
    return
  fi
  left=$(awk -v t="$total" -v u="$used" 'BEGIN { printf "%.2f", t - u }')
  cents=$(or_cents "$left")
  # grade_low срабатывает на «не больше», порог — «меньше»: ровно $5 ещё ok.
  note openrouter_credits "$(grade_low "$cents" $(($(or_cents "$warn") - 1)) $(($(or_cents "$crit") - 1)))" \
    "осталось \$$left (куплено \$$(printf '%.2f' "$total"), потрачено \$$(printf '%.2f' "$used"))" "$hint"
}

# Запрос и оценка. Ключ уходит в curl через stdin (-H @-), а не аргументом: в ps его не видно.
openrouter_check() {
  local key code body tmp
  if ! [ -r "$OPENROUTER_KEY_FILE" ]; then
    note openrouter_credits warn "нет доступа к $OPENROUTER_KEY_FILE"
    return
  fi
  key=$(or_key "$OPENROUTER_KEY_FILE")
  if [ -z "$key" ]; then
    note openrouter_credits warn "в $OPENROUTER_KEY_FILE нет ключа"
    return
  fi
  tmp=$(mktemp)
  code=$(printf 'Authorization: Bearer %s\n' "$key" |
    curl -s -m 20 -o "$tmp" -w '%{http_code}' -H @- https://openrouter.ai/api/v1/credits 2>/dev/null) || code=000
  body=$(head -c 2000 "$tmp")
  rm -f "$tmp"
  or_credits_note "${code:-000}" "$body" "${OPENROUTER_WARN_USD:-5}" "${OPENROUTER_CRIT_USD:-1}"
}
