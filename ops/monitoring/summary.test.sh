#!/usr/bin/env bash
# A && ok || bad безопасно: ok и bad не падают.
# shellcheck disable=SC2015,SC1091,SC2034
# Тесты render_summary на снимке auto08 от 06.10. Запуск: bash ops/monitoring/summary.test.sh
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/summary.sh"

fails=0
ok() { echo "ok   $1"; }
bad() {
  echo "FAIL $1"
  fails=$((fails + 1))
}
has() { grep -qF -- "$2" <<<"$1"; }

declare -A SEV VAL HINT
NAME=auto08
export SUMMARY_NOW="06.10 09:00" SUMMARY_UPTIME_S=$((6 * 86400 + 23 * 3600 + 42 * 60))
export MONITOR_GROUPS="📥 Сбор=ingest,sources;🎯 Отбор=pick_*,tg_poll_*;📢 Публикация=tg_queue"
export MONITOR_QUIET="pick_stuck tg_poll_conflict"

set_ok() { SEV[$1]=ok VAL[$1]=$2 HINT[$1]=""; }
set_ok cert "66 дн."
set_ok console "401 (ожидаемый ответ)"
set_ok disk "34%"
set_ok git_unpushed "всё отправлено"
set_ok ingest "3 ч назад"
for j in check_approvals daily_digest gwiki_sync news_publish_due pick_cycle pick_ideas \
  render_diagrams request_publish scan_and_draft telegram_post; do
  set_ok "job:$j" "успех 0 ч 10 мин назад (ждём каждые 60 мин)"
done
set_ok journal "0 ошибок в журнале за час"
set_ok mem "2927 МБ доступно"
set_ok pg "select 1 за 0 с"
set_ok pick_flow "за 7 дней карточек 45 из 37 загруженных"
set_ok pick_stuck "нет зависших"
set_ok sources "2 из 20 с ошибкой"
set_ok tg_poll_age "опрос отбора 0 мин назад"
set_ok tg_poll_conflict "Conflict за час нет"
set_ok tg_queue "4 статей ждёт анонса, старейшая 25 ч публикации"
for u in nginx postgresql@16-main stack-radar tailscaled watermarks-remover; do set_ok "unit:$u" active; done

out=$(render_summary)
echo "--- все в норме ---"
echo "$out"
echo "---"
has "$out" "📋 auto08 · 06.10 09:00 · up 6д 23ч" && ok "шапка" || bad "шапка"
has "$out" "🟢 29/29 в норме" && ok "итог" || bad "итог"
has "$out" "⏱ Джобы — 10/10 в срок" && ok "джобы схлопнуты" || bad "джобы схлопнуты"
has "$out" "⚙️ Сервисы — nginx, postgresql@16-main, stack-radar, tailscaled, watermarks-remover — active · console ок · pg ок" &&
  ok "сервисы" || bad "сервисы"
has "$out" "🖥 Сервер — cert 66 дн · диск 34% · git: всё отправлено · журнал 0 ошибок · RAM 2927 МБ" && ok "сервер" || bad "сервер"
has "$out" "📥 Сбор — ingest: 3 ч назад · sources: 2 из 20 с ошибкой" && ok "группа из MONITOR_GROUPS" || bad "группа из MONITOR_GROUPS"
has "$out" "pick_stuck ок · tg_poll_age: опрос отбора 0 мин назад · tg_poll_conflict ок" && ok "MONITOR_QUIET" || bad "MONITOR_QUIET"
has "$out" "Прочее" && bad "лишняя группа «Прочее»" || ok "без «Прочее»"
[ "$(grep -c 'job:' <<<"$out")" = 0 ] && ok "нет строк job:*" || bad "строки job:* в норме"

SEV[job:scan_and_draft]=crit
VAL[job:scan_and_draft]="успех 4 ч 0 мин назад (ждём каждые 60 мин)"
HINT[job:scan_and_draft]="select * from job_runs"
SEV[disk]=warn VAL[disk]="80%"
set_ok new_check "что-то"
out=$(render_summary)
echo "--- с проблемами ---"
echo "$out"
echo "---"
has "$out" "🔴 1 · 🟡 1 · 🟢 28" && ok "итог с проблемами" || bad "итог с проблемами"
has "$out" "🔴 job:scan_and_draft: успех 4 ч 0 мин назад" && has "$out" "    → select * from job_runs" &&
  ok "проблема целиком с подсказкой" || bad "проблема целиком"
has "$out" "⏱ Джобы — 9/10 в срок" && ok "джобы 9/10" || bad "джобы 9/10"
has "$out" "диск 34%" && bad "диск в warn не должен быть в группе" || ok "warn не дублируется в группе"
has "$out" "🧩 Прочее — new_check: что-то" && ok "неизвестная проверка — в «Прочее»" || bad "«Прочее»"

[ "$fails" = 0 ] && echo "все тесты прошли" || echo "провалов: $fails"
exit "$fails"
