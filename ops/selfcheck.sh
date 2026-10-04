#!/usr/bin/env bash
# Функции проверок вызываются косвенно, через check "$@" — shellcheck этого не видит.
# shellcheck disable=SC2329
# Гейт toolkit одной командой. Выход 0 — можно выпускать. Запуск из корня репо: ops/selfcheck.sh
set -euo pipefail

cd "$(dirname "$0")/.."
fail=0

check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "OK   $name"
  else
    echo "FAIL $name"
    fail=1
  fi
}

versions_agree() {
  [ "$(tr -d '[:space:]' <VERSION)" = "$(node -p 'require("./package.json").version')" ]
}

shellcheck_all() {
  # xargs, а не mapfile: на macOS /usr/bin/env bash — это bash 3.2 без mapfile.
  git ls-files -z '*.sh' '.githooks/*' | xargs -0 shellcheck ops/selfcheck.sh
}

check "test:unit" npm run test:unit
check "typecheck" npm run typecheck
check "lint" npm run lint
check "build (dist)" npm run build
check "shellcheck ops/" shellcheck_all
check "VERSION = package.json" versions_agree

exit "$fail"
