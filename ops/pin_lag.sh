#!/usr/bin/env bash
# Отставание пина toolkit от последнего релиза. Выход 0 — отстаёт не больше чем на max тегов.
# Правило «пин отстаёт не больше чем на 2 версии»: bds-content ADR 0001, п. 7.
#   bash node_modules/@techfriends-eng/toolkit/ops/pin_lag.sh [package.json] [max]
# По умолчанию ./package.json и max=2. Версии — теги vX.Y.Z репо toolkit, считается каждый тег.
# TOOLKIT_REPO — другой адрес репо; PIN_LAG_TAGS — список тегов вместо git ls-remote (тесты).
set -euo pipefail

PKG=${1:-package.json}
MAX=${2:-2}
REPO=${TOOLKIT_REPO:-https://github.com/techfriends-eng/toolkit.git}

pin=$(grep -o '"@techfriends-eng/toolkit": *"[^"]*"' "$PKG" | sed -n 's/.*#v\([0-9][0-9.]*\)"$/\1/p')
[ -n "$pin" ] || { echo "pin_lag: в $PKG нет пина @techfriends-eng/toolkit вида #vX.Y.Z" >&2; exit 2; }

if [ -n "${PIN_LAG_TAGS:-}" ]; then
  tags=$PIN_LAG_TAGS
else
  tags=$(git ls-remote --tags --refs "$REPO" | sed 's|.*refs/tags/||') ||
    { echo "pin_lag: теги $REPO недоступны" >&2; exit 2; }
fi
versions=$(printf '%s\n' "$tags" | tr ' ' '\n' | sed -n 's/^v\([0-9]*\.[0-9]*\.[0-9]*\)$/\1/p' | sort -uV)
printf '%s\n' "$versions" | grep -qxF "$pin" || { echo "pin_lag: тега v$pin нет в $REPO" >&2; exit 2; }

lag=$(printf '%s\n' "$versions" | sed -n "/^${pin//./\\.}\$/,\$p" | tail -n +2 | grep -c . || true)
latest=$(printf '%s\n' "$versions" | tail -1)
msg="toolkit v$pin: отставание $lag (последняя v$latest, допуск $MAX)"
if [ "$lag" -gt "$MAX" ]; then
  echo "FAIL $msg" >&2
  exit 1
fi
echo "OK   $msg"
