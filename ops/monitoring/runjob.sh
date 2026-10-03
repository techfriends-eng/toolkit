#!/usr/bin/env bash
# Обёртка для cron-задач: фиксирует прогон, сообщает о падении.
#
#   /opt/monitoring/runjob.sh <имя> -- <команда...>
#
# Вывод команды идёт как обычно в stdout/stderr, поэтому редиректы
# в crontab продолжают писать те же логи. Дополнительно пишется строка
# в таблицу job_runs базы stackradar, а при ненулевом коде возврата
# уходит тревога в Telegram с хвостом вывода.
set -uo pipefail

NAME="${1:-}"
shift || true
[ "${1:-}" = "--" ] && shift
if [ -z "$NAME" ] || [ $# -eq 0 ]; then
  echo "usage: runjob.sh <имя> -- <команда...>" >&2
  exit 2
fi

TMP=$(mktemp /tmp/runjob.XXXXXX)
trap 'rm -f "$TMP"' EXIT
START=$(date +%s)

# Вывод одновременно наружу (в лог задачи) и в файл — для тревоги.
"$@" > >(tee -a "$TMP") 2> >(tee -a "$TMP" >&2)
CODE=$?
DUR=$(( $(date +%s) - START ))

sudo -u postgres psql -qtAX -d stackradar >/dev/null 2>&1 <<SQL
create table if not exists job_runs (
  id bigserial primary key,
  job text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  duration_s int not null,
  exit_code int not null
);
create index if not exists job_runs_job_idx on job_runs (job, finished_at desc);
insert into job_runs (job, started_at, duration_s, exit_code)
values ('${NAME//\'/}', to_timestamp($START), $DUR, $CODE);
SQL

# Повторную тревогу об одной и той же падающей задаче шлём не чаще, чем раз в
# ALERT_REPEAT_HOURS. Ночь из восьми одинаковых сообщений про pick_poll ничего
# не добавила к первому: состояние не менялось, а лента тревог обесценилась.
REPEAT_H="${ALERT_REPEAT_HOURS:-6}"
should_alert() {
  [ "$CODE" -eq 0 ] && return 1
  local recent
  recent=$(sudo -u postgres psql -qtAX -d stackradar -c \
    "select count(*) from job_runs
      where job = '${NAME//\'/}' and exit_code <> 0
        and finished_at > now() - interval '${REPEAT_H} hours'" 2>/dev/null | tr -d ' ')
  # только что записанный прогон уже в таблице, поэтому порог не 0, а 1
  [ "${recent:-1}" -le 1 ]
}

if should_alert; then
  TAIL=$(tail -c 1200 "$TMP")
  /opt/monitoring/alert.sh "" "🔴 Задача ${NAME} упала (код ${CODE}, ${DUR} с)
хост: auto08

${TAIL}

Разбор: sudo -u postgres psql -d stackradar -c \"select * from job_runs where job='${NAME}' order by id desc limit 5\"
Повторные тревоги по этой задаче заглушены на ${REPEAT_H} ч."
fi

exit "$CODE"
