#!/usr/bin/env bash
# Сводка по хосту, сгруппированная по категориям. Подключается из check.sh (--summary).
# Вход: ассоциативные массивы SEV/VAL/HINT (имя проверки -> уровень/значение/подсказка), NAME.
#
# Формат:
#   шапка: хост · дата · аптайм
#   итог:  «🟢 N/N в норме» или «🔴 x · 🟡 y · 🟢 z»
#   проблемы целиком, с подсказкой
#   группы — одной строкой, только проверки в норме; задачи cron схлопнуты в «N/M в срок»
#
# Группы проверок проектов — в /etc/monitoring.env, без них проверка попадает в «Прочее»:
#   MONITOR_GROUPS="📥 Сбор=ingest,sources;🎯 Отбор=pick_*,tg_poll_*;📢 Публикация=tg_queue"
# Шаблоны — glob. Группы из MONITOR_GROUPS проверяются раньше встроенных.
# Проверки, у которых в норме значение неинтересно, — короткое «имя ок» (pg и console — всегда):
#   MONITOR_QUIET="pick_stuck tg_poll_conflict"
#
# SUMMARY_NOW / SUMMARY_UPTIME_S — подмена даты и аптайма для тестов.

summary_group_of() { # имя проверки -> название группы
  local k=$1 spec name pats pat
  local IFS=';'
  for spec in ${MONITOR_GROUPS:-}; do
    name=${spec%%=*}
    pats=${spec#*=}
    IFS=','
    for pat in $pats; do
      # shellcheck disable=SC2053  # шаблон — glob намеренно
      [[ $k == $pat ]] && { echo "$name"; return; }
    done
    IFS=';'
  done
  case $k in
    unit:* | pg | console) echo "⚙️ Сервисы" ;;
    job:*) echo "⏱ Джобы" ;;
    disk | mem | cert | journal | git_unpushed) echo "🖥 Сервер" ;;
    *) echo "🧩 Прочее" ;;
  esac
}

summary_short() { # имя значение -> короткая форма для строки группы
  local k=$1 v=$2 q
  for q in pg console ${MONITOR_QUIET:-}; do
    [ "$k" = "$q" ] && { echo "$k ок"; return; }
  done
  case $k in
    disk) echo "диск $v" ;;
    mem) echo "RAM ${v%% *} МБ" ;;
    cert) echo "cert ${v%.}" ;;
    journal) echo "журнал ${v%% *} ошибок" ;;
    git_unpushed) echo "git: $v" ;;
    *) echo "$k: $v" ;;
  esac
}

summary_uptime() { # секунды -> «6д 23ч» / «5ч 12м»
  local s=$1 d h m
  d=$((s / 86400))
  h=$((s % 86400 / 3600))
  m=$((s % 3600 / 60))
  if [ "$d" -gt 0 ]; then
    echo "${d}д ${h}ч"
  else echo "${h}ч ${m}м"; fi
}

render_summary() {
  local k sev icon g n_ok=0 n_warn=0 n_crit=0 total=0
  local up problems=""
  local -A LINE
  local -a units=()
  local jobs_total=0 jobs_ok=0 jobs_never=""

  up=${SUMMARY_UPTIME_S:-$(cut -d. -f1 /proc/uptime 2>/dev/null || echo 0)}

  for k in $(printf '%s\n' "${!SEV[@]}" | sort); do
    sev=${SEV[$k]}
    total=$((total + 1))
    case $sev in
      crit) n_crit=$((n_crit + 1)) ;;
      warn) n_warn=$((n_warn + 1)) ;;
      *) n_ok=$((n_ok + 1)) ;;
    esac

    if [[ $k == job:* ]]; then
      jobs_total=$((jobs_total + 1))
      if [ "$sev" = ok ]; then
        jobs_ok=$((jobs_ok + 1))
        [[ ${VAL[$k]} == "прогонов ещё не было"* ]] && jobs_never="$jobs_never, ${k#job:}"
      fi
    fi

    if [ "$sev" != ok ]; then
      icon=🟡
      [ "$sev" = crit ] && icon=🔴
      problems="${problems}${icon} ${k}: ${VAL[$k]}
"
      [ -n "${HINT[$k]:-}" ] && problems="${problems}    → ${HINT[$k]}
"
      continue
    fi

    if [[ $k == unit:* ]]; then
      units+=("${k#unit:}")
      continue
    fi
    [[ $k == job:* ]] && continue

    g=$(summary_group_of "$k")
    LINE[$g]="${LINE[$g]:+${LINE[$g]} · }$(summary_short "$k" "${VAL[$k]}")"
  done

  # юниты — в начало группы «Сервисы», задачи — своей строкой
  if [ "${#units[@]}" -gt 0 ]; then
    local u_line
    u_line="$(
      IFS=,
      echo "${units[*]}"
    ) — active"
    u_line=${u_line//,/, }
    g="⚙️ Сервисы"
    LINE[$g]="$u_line${LINE[$g]:+ · ${LINE[$g]}}"
  fi
  if [ "$jobs_total" -gt 0 ]; then
    g="⏱ Джобы"
    LINE[$g]="${jobs_ok}/${jobs_total} в срок"
    [ -n "$jobs_never" ] && LINE[$g]="${LINE[$g]} · без прогонов: ${jobs_never#, }"
  fi

  # порядок: встроенные, затем MONITOR_GROUPS, затем «Прочее»
  local sorted=() name spec
  for name in "🖥 Сервер" "⚙️ Сервисы" "⏱ Джобы"; do
    [ -n "${LINE[$name]+x}" ] && sorted+=("$name")
  done
  local IFS_OLD=$IFS
  IFS=';'
  for spec in ${MONITOR_GROUPS:-}; do
    name=${spec%%=*}
    [ -n "${LINE[$name]+x}" ] && sorted+=("$name")
  done
  IFS=$IFS_OLD
  name="🧩 Прочее"
  [ -n "${LINE[$name]+x}" ] && sorted+=("$name")

  local status
  if [ "$n_ok" = "$total" ]; then
    status="🟢 ${total}/${total} в норме"
  else
    status=""
    [ "$n_crit" -gt 0 ] && status="🔴 $n_crit"
    [ "$n_warn" -gt 0 ] && status="${status:+$status · }🟡 $n_warn"
    status="${status} · 🟢 $n_ok"
  fi

  echo "📋 ${NAME:-$(hostname)} · ${SUMMARY_NOW:-$(date '+%d.%m %H:%M')} · up $(summary_uptime "$up")"
  echo "$status"
  [ -n "$problems" ] && printf '\n%s' "$problems"
  echo
  for name in "${sorted[@]}"; do
    echo "${name} — ${LINE[$name]}"
  done
}
