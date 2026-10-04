#!/usr/bin/env bash
# Установка общего мониторинга хоста из этого каталога toolkit. Идемпотентно, запускать от root.
#   sudo ops/monitoring/install.sh
# Проверки проектов ставятся из их репо: sudo install -m 640 -g monitoring ops/checks.d/<проект>.sh /opt/monitoring/checks.d/
# /etc/monitoring.env (640 root:monitoring) заполняется руками по README.md.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo "install.sh: нужен root" >&2; exit 1; }

getent group monitoring >/dev/null || groupadd --system monitoring
install -d -m 755 /opt/monitoring
install -d -m 750 -g monitoring /opt/monitoring/checks.d
install -m 750 -g monitoring "$HERE/check.sh" "$HERE/alert.sh" /opt/monitoring/
install -m 755 "$HERE/runjob.sh" /opt/monitoring/
install -m 644 "$HERE/README.md" "$HERE/req_mon.md" /opt/monitoring/
install -m 644 "$HERE"/alert@.service "$HERE"/host-check.service "$HERE"/host-check.timer \
  "$HERE"/host-summary.service "$HERE"/host-summary.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now host-check.timer host-summary.timer >/dev/null
# Версия комплекта — для сверки, что на хосте стоит то, что в репо.
cp "$HERE/../../VERSION" /opt/monitoring/VERSION 2>/dev/null || true
echo "установлено в /opt/monitoring, версия $(cat /opt/monitoring/VERSION 2>/dev/null || echo ?)"
[ -r /etc/monitoring.env ] || echo "ВНИМАНИЕ: нет /etc/monitoring.env — см. README.md" >&2
