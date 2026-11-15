#!/usr/bin/env bash
# Установка общего мониторинга хоста из этого каталога toolkit. Идемпотентно, запускать от root.
#   sudo ops/monitoring/install.sh               всё: тревоги, проверки каждые 15 минут, runjob
#   sudo ops/monitoring/install.sh --alert-only  только тревога об отказе юнита (OnFailure=alert@%n.service):
#                                                для хоста без Postgres на самом хосте (supan8n — Postgres в Docker)
# Проверки проектов ставятся из их репо: sudo install -m 640 -g monitoring ops/checks.d/<проект>.sh /opt/monitoring/checks.d/
# /etc/monitoring.env (640 root:monitoring) заполняется руками по README.md.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo "install.sh: нужен root" >&2; exit 1; }

getent group monitoring >/dev/null || groupadd --system monitoring
install -d -m 755 /opt/monitoring

if [ "${1:-}" = "--alert-only" ]; then
  # Слой 1 без проверок и учёта задач: им нужен Postgres на хосте (sudo -u postgres psql).
  install -m 750 -g monitoring "$HERE/alert.sh" /opt/monitoring/
  install -m 644 "$HERE/README.md" /opt/monitoring/
  install -m 644 "$HERE"/alert@.service /etc/systemd/system/
  systemctl daemon-reload
  cp "$HERE/../../VERSION" /opt/monitoring/VERSION 2>/dev/null || true
  echo "установлено (только тревоги) в /opt/monitoring, версия $(cat /opt/monitoring/VERSION 2>/dev/null || echo ?)"
  [ -r /etc/monitoring.env ] || echo "ВНИМАНИЕ: нет /etc/monitoring.env — см. README.md" >&2
  exit 0
fi
install -d -m 750 -g monitoring /opt/monitoring/checks.d
install -m 750 -g monitoring "$HERE/check.sh" "$HERE/summary.sh" "$HERE/alert.sh" /opt/monitoring/
install -m 755 "$HERE/runjob.sh" /opt/monitoring/
install -m 644 "$HERE/README.md" "$HERE/req_mon.md" /opt/monitoring/
install -m 644 "$HERE"/alert@.service "$HERE"/host-check.service "$HERE"/host-check.timer /etc/systemd/system/
# Ежедневная сводка убрана в 0.8.0: тишина = норма, в Telegram только смена на warn/crit.
if [ -e /etc/systemd/system/host-summary.timer ]; then
  systemctl disable --now host-summary.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/host-summary.timer /etc/systemd/system/host-summary.service
fi
systemctl daemon-reload
systemctl enable --now host-check.timer >/dev/null
# Версия комплекта — для сверки, что на хосте стоит то, что в репо.
cp "$HERE/../../VERSION" /opt/monitoring/VERSION 2>/dev/null || true
echo "установлено в /opt/monitoring, версия $(cat /opt/monitoring/VERSION 2>/dev/null || echo ?)"
[ -r /etc/monitoring.env ] || echo "ВНИМАНИЕ: нет /etc/monitoring.env — см. README.md" >&2
