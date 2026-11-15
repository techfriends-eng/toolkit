#!/usr/bin/env bash
# A && ok || bad безопасно: ok и bad не падают.
# shellcheck disable=SC2015
# Тесты ops/pin_lag.sh без сети: теги подаются через PIN_LAG_TAGS.
# Запуск: bash ops/pin_lag.test.sh   (выход 0 — все прошли)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
pkg() { printf '{\n  "dependencies": {\n    "@techfriends-eng/toolkit": "%s"\n  }\n}\n' "$1" >"$TMP/package.json"; }
run() { PIN_LAG_TAGS=$1 bash "$HERE/pin_lag.sh" "$TMP/package.json" "${2:-2}" >"$TMP/out" 2>&1; }

TAGS="v0.6.2 v0.7.0 v0.8.0 v0.9.0 v0.9.1 v0.10.0 junk v1.0.0-rc1"

pkg "github:techfriends-eng/toolkit#v0.10.0"
run "$TAGS" && grep -q 'отставание 0' "$TMP/out" && ok "последняя — 0" || bad "последняя — 0"

pkg "github:techfriends-eng/toolkit#v0.8.0"
rc=0; run "$TAGS" || rc=$?
[ "$rc" = 1 ] && grep -q 'FAIL.*отставание 3' "$TMP/out" && ok "v0.8.0 при допуске 2 — провал" ||
  bad "v0.8.0 при допуске 2 — провал"

pkg "github:techfriends-eng/toolkit#v0.9.0"
run "$TAGS" && grep -q 'отставание 2 (последняя v0.10.0' "$TMP/out" && ok "сортировка по версии: 0.10 > 0.9, ровно 2 — OK" ||
  bad "сортировка по версии: 0.10 > 0.9, ровно 2 — OK"

pkg "github:techfriends-eng/toolkit#v0.8.0"
run "$TAGS" 5 && ok "свой допуск" || bad "свой допуск"

pkg "github:techfriends-eng/toolkit#v0.5.0"
rc=0; run "$TAGS" || rc=$?
[ "$rc" = 2 ] && ok "пина нет среди тегов — выход 2" || bad "пина нет среди тегов — выход 2"

pkg "^0.9.0"
rc=0; run "$TAGS" || rc=$?
[ "$rc" = 2 ] && ok "пин не тег — выход 2" || bad "пин не тег — выход 2"

echo "fails: $fails"
exit "$fails"
