#!/usr/bin/env bash
# Отправка тревоги в Telegram.
# Вызов 1: alert.sh <имя-юнита>            — из alert@.service по OnFailure
# Вызов 2: alert.sh "" "произвольный текст" — из check.sh
set -uo pipefail
# shellcheck source=/dev/null  # env-файлы хоста, в репо их нет
[ -f /etc/monitoring.env ] && . /etc/monitoring.env
# Общий конфиг служебного чата и тем (T4): отсюда берётся тема Логи,
# если ALERT_THREAD_ID не задан явно.
# shellcheck source=/dev/null
[ -r /etc/bds-telegram.env ] && . /etc/bds-telegram.env

UNIT="${1:-}"
TEXT="${2:-}"

# Повтор тревоги по одному и тому же юниту глушим так же, как у задач: ночь
# из восьми одинаковых сообщений ничего не добавляет к первому.
REPEAT_H="${ALERT_REPEAT_HOURS:-6}"
STAMP_DIR=/var/lib/monitoring/alerts
if [ -n "$UNIT" ] && [ -z "$TEXT" ]; then
  mkdir -p "$STAMP_DIR" 2>/dev/null
  STAMP="$STAMP_DIR/$(echo "$UNIT" | tr -c 'A-Za-z0-9._-' '_')"
  if [ -f "$STAMP" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$STAMP" 2>/dev/null || echo 0) ))
    if [ "$AGE" -lt $(( REPEAT_H * 3600 )) ]; then
      exit 0
    fi
  fi
  : > "$STAMP"
fi

if [ -z "$TEXT" ]; then
  LOG=$(journalctl -u "$UNIT" -n 12 --no-pager 2>/dev/null | tail -12)
  TEXT="🔴 Отказ юнита: ${UNIT}
хост: $(hostname)

${LOG}

Разбор: sudo systemctl status ${UNIT} --no-pager"
fi

# Тема передаётся только когда задана: в General её указывать нельзя,
# Telegram ответит ошибкой. В личном чате темы тоже нет.
THREAD="${ALERT_THREAD_ID:-${BDS_TOPIC_LOGS:-}}"
case "$ALERT_CHAT_ID" in -*) ;; *) THREAD="" ;; esac

curl -sS -m 20 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${ALERT_CHAT_ID}" \
  ${THREAD:+--data-urlencode "message_thread_id=${THREAD}"} \
  --data-urlencode "text=${TEXT}" \
  --data-urlencode "disable_web_page_preview=true" >/dev/null
