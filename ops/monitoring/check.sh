#!/usr/bin/env bash
# Проверка состояния хоста. Запускается таймером раз в 15 минут (host-check.timer).
# Тревога уходит в Telegram только при СМЕНЕ состояния проверки (handbook gotchas/monitoring.md#state-change).
#   --summary      сводка по всем проверкам независимо от состояния
#   CHECK_DRY=1    только напечатать результаты (имя=уровень|значение) и выйти: без тревог и записи состояния
#
# Общие проверки — здесь. Проверки проектов — подключаемые файлы $CHECKS_DIR/*.sh (лежат в репо
# своих проектов, ops/checks.d/), им доступны note, grade, grade_low и $DB.
#
# /etc/monitoring.env:
#   MONITORING_DB   БД с job_runs/job_schedule/host_checks (по умолчанию stackradar)
#   MONITOR_UNITS   юниты, которые обязаны быть активны (через пробел)
#   MONITOR_REPOS   рабочие деревья git, где ищутся незапушенные коммиты (через пробел)
#   MONITOR_NAME    имя хоста в сообщениях (по умолчанию hostname)
#   CONSOLE_URL, CONSOLE_EXPECT (по умолчанию 401), CERT_PATH, HC_PING_URL — проверка выключена, если пусто
set -uo pipefail
# shellcheck source=/dev/null  # env хоста, в репо его нет
[ -f /etc/monitoring.env ] && . /etc/monitoring.env

DB="${MONITORING_DB:-stackradar}"
NAME="${MONITOR_NAME:-$(hostname)}"
CHECKS_DIR="${CHECKS_DIR:-/opt/monitoring/checks.d}"
STATE_DIR=/var/lib/monitoring
STATE="$STATE_DIR/state"
SUMMARY_MODE=0
[ "${1:-}" = "--summary" ] && SUMMARY_MODE=1

declare -A SEV VAL HINT
worst=ok

note() { # имя severity значение подсказка
  SEV[$1]=$2
  VAL[$1]=$3
  HINT[$1]=${4:-}
  if [ "$2" = crit ]; then
    worst=crit
  elif [ "$2" = warn ] && [ "$worst" != crit ]; then worst=warn; fi
}

grade() { # значение порог_warn порог_crit -> ok|warn|crit (больше = хуже)
  local v=$1 w=$2 c=$3
  if [ "$v" -ge "$c" ] 2>/dev/null; then
    echo crit
  elif [ "$v" -ge "$w" ] 2>/dev/null; then
    echo warn
  else echo ok; fi
}

grade_low() { # значение порог_warn порог_crit -> ok|warn|crit (меньше = хуже)
  local v=$1 w=$2 c=$3
  if [ "$v" -le "$c" ] 2>/dev/null; then
    echo crit
  elif [ "$v" -le "$w" ] 2>/dev/null; then
    echo warn
  else echo ok; fi
}

psql_db() { sudo -u postgres psql -qtAX -d "$DB" "$@"; }

# --- юниты, которые обязаны быть активны -------------------------------------
for u in ${MONITOR_UNITS:-}; do
  if systemctl is-active --quiet "$u"; then
    note "unit:$u" ok "active"
  else
    note "unit:$u" crit "$(systemctl is-active "$u" 2>&1)" "sudo systemctl status $u --no-pager"
  fi
done

# --- диск --------------------------------------------------------------------
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
note disk "$(grade "$disk" 75 88)" "${disk}%" "du -xh --max-depth=2 / | sort -h | tail -20"

# --- память ------------------------------------------------------------------
mem=$(free -m | awk '/^Mem:/{print $7}')
note mem "$(grade_low "$mem" 300 120)" "${mem} МБ доступно" "ps aux --sort=-%mem | head"

# --- Postgres ----------------------------------------------------------------
t0=$(date +%s)
if psql_db -c 'select 1' >/dev/null 2>&1; then
  t=$(($(date +%s) - t0))
  note pg "$(grade "$t" 2 8)" "select 1 за ${t} с"
else
  note pg crit "нет соединения" "sudo systemctl status postgresql --no-pager"
fi

# --- задачи по расписанию: не пропустили ли свой запуск ----------------------
# Ожидаемый интервал — job_schedule. warn — нет удачного прогона дольше двух интервалов, crit — четырёх.
# Задача без единого прогона — отдельный статус, а не «ok» (gotchas/monitoring.md#never-ran).
while IFS='|' read -r job mins ago_min; do
  [ -z "$job" ] && continue
  ago_min=${ago_min:-99999}
  w=$((mins * 2))
  c=$((mins * 4))
  if [ "$ago_min" = 99999 ]; then
    note "job:$job" ok "прогонов ещё не было"
    continue
  fi
  if [ "$ago_min" -ge "$c" ] 2>/dev/null; then
    sv=crit
  elif [ "$ago_min" -ge "$w" ] 2>/dev/null; then
    sv=warn
  else sv=ok; fi
  note "job:$job" "$sv" "успех $((ago_min / 60)) ч $((ago_min % 60)) мин назад (ждём каждые ${mins} мин)" \
    "sudo -u postgres psql -d $DB -c \"select * from job_runs where job='$job' order by id desc limit 5\""
done < <(psql_db -F'|' -c "
  select s.job, s.interval_min,
         coalesce(round(extract(epoch from now() - max(r.finished_at))/60)::int, 99999)
    from job_schedule s
    left join job_runs r on r.job = s.job and r.exit_code = 0
   where s.enabled
   group by s.job, s.interval_min" 2>/dev/null)

# --- сертификат --------------------------------------------------------------
left=""
if [ -n "${CERT_PATH:-}" ]; then
  if [ -r "$CERT_PATH" ] || sudo test -r "$CERT_PATH"; then
    end=$(sudo openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null | cut -d= -f2)
    left=$((($(date -d "$end" +%s) - $(date +%s)) / 86400))
    note cert "$(grade_low "$left" 21 7)" "${left} дн." "sudo certbot renew --dry-run"
  else
    note cert warn "файл сертификата не прочитан"
  fi
fi

# --- консоль снаружи ---------------------------------------------------------
code=""
if [ -n "${CONSOLE_URL:-}" ]; then
  expect="${CONSOLE_EXPECT:-401}"
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$CONSOLE_URL" || echo 000)
  if [ "$code" = "$expect" ]; then
    note console ok "$code (ожидаемый ответ)"
  elif [ "$code" = "000" ]; then
    note console crit "нет ответа" "sudo systemctl status nginx --no-pager"
  else
    note console warn "код $code вместо $expect" "sudo nginx -t"
  fi
fi

# --- неотправленные коммиты --------------------------------------------------
# Код, который живёт только на хосте, теряется вместе с хостом. Нужен upstream у ветки (@{u}).
unpushed_total=0
unpushed_where=""
for repo in ${MONITOR_REPOS:-}; do
  [ -d "$repo/.git" ] || continue
  n=$(git -C "$repo" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
  n=${n:-0}
  if [ "$n" -gt 0 ] 2>/dev/null; then
    unpushed_total=$((unpushed_total + n))
    unpushed_where="$unpushed_where $(basename "$repo"):$n"
  fi
done
if [ -n "${MONITOR_REPOS:-}" ]; then
  if [ "$unpushed_total" -eq 0 ]; then
    note git_unpushed ok "всё отправлено"
  else
    note git_unpushed warn "$unpushed_total коммитов не в origin -$unpushed_where" \
      "git -C <репо> log --oneline @{u}..HEAD"
  fi
fi

# --- проверки проектов -------------------------------------------------------
for plugin in "$CHECKS_DIR"/*.sh; do
  [ -r "$plugin" ] || continue
  # shellcheck source=/dev/null
  . "$plugin"
done

# --- ошибки в журнале за час -------------------------------------------------
# Только err и выше, без фонового шума: sshd ловит сканы, networkctl ругается на исчезнувшие veth docker.
errs=$(journalctl -p err --since '-1 hour' --no-pager 2>/dev/null |
  grep -vcE 'sshd|networkctl|kex_exchange_identification' || true)
errs=${errs:-0}
note journal "$(grade "$errs" 10 60)" "${errs} ошибок в журнале за час" "sudo journalctl -p err --since '-1 hour' --no-pager"

if [ -n "${CHECK_DRY:-}" ]; then
  for k in $(printf '%s\n' "${!SEV[@]}" | sort); do echo "$k=${SEV[$k]}|${VAL[$k]}"; done
  exit 0
fi

# --- сравнение с прошлым состоянием ------------------------------------------
mkdir -p "$STATE_DIR"
touch "$STATE"
changed=""
: >"$STATE_DIR/state.new"
for k in "${!SEV[@]}"; do
  echo "$k=${SEV[$k]}" >>"$STATE_DIR/state.new"
  prev=$(grep -m1 "^$k=" "$STATE" 2>/dev/null | cut -d= -f2)
  cur=${SEV[$k]}
  [ "$prev" = "$cur" ] && continue
  if [ "$cur" = ok ] && [ -n "$prev" ]; then
    changed="${changed}
🟢 ${k}: снова в норме — ${VAL[$k]}"
  elif [ "$cur" != ok ]; then
    icon=$([ "$cur" = crit ] && echo 🔴 || echo 🟡)
    line="${icon} ${k}: ${VAL[$k]}"
    [ -n "${HINT[$k]}" ] && line="${line}
    → ${HINT[$k]}"
    changed="${changed}
${line}"
  fi
done
sort "$STATE_DIR/state.new" -o "$STATE"
rm -f "$STATE_DIR/state.new"

# --- история в Postgres ------------------------------------------------------
# ingest_age_h заполняет проверка stack-radar; на хосте без неё — null.
psql_db >/dev/null 2>&1 <<SQL
create table if not exists host_checks (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  worst text not null,
  disk_pct int, mem_avail_mb int, ingest_age_h int, cert_days_left int,
  console_code text, journal_errors int
);
insert into host_checks (worst, disk_pct, mem_avail_mb, ingest_age_h, cert_days_left, console_code, journal_errors)
values ('$worst', $disk, $mem, ${ingest_age_h:-null}, ${left:-null}, '${code}', $errs);
SQL

# --- отправка ----------------------------------------------------------------
if [ "$SUMMARY_MODE" = 1 ]; then
  body="📋 Сводка по ${NAME}, $(date '+%d.%m %H:%M')
аптайм: $(uptime -p)
"
  for k in $(printf '%s\n' "${!SEV[@]}" | sort); do
    icon=🟢
    [ "${SEV[$k]}" = warn ] && icon=🟡
    [ "${SEV[$k]}" = crit ] && icon=🔴
    body="${body}${icon} ${k}: ${VAL[$k]}
"
  done
  /opt/monitoring/alert.sh "" "$body"
elif [ -n "$changed" ]; then
  /opt/monitoring/alert.sh "" "Состояние ${NAME} изменилось:${changed}"
fi

# --- внешний свидетель -------------------------------------------------------
# Молчание пинга дольше периода значит, что лёг весь хост и первые два слоя сообщить не могут.
if [ -n "${HC_PING_URL:-}" ]; then
  if [ "$worst" = crit ]; then
    curl -fsS -m 10 --retry 2 "${HC_PING_URL}/fail" >/dev/null 2>&1 || true
  else
    curl -fsS -m 10 --retry 2 "$HC_PING_URL" >/dev/null 2>&1 || true
  fi
fi

echo "worst=$worst disk=${disk}% mem=${mem}MB ingest=${ingest_age_h:-?}h cert=${left:-?}d console=${code:-?} errs=$errs"
