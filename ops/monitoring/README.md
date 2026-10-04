# Мониторинг хоста

Требования к подключению новых сервисов и задач — **`req_mon.md`**. Этот файл описывает
устройство и установку.

## Три слоя

1. **`alert@.service`** — systemd сам сообщает об отказе юнита через `OnFailure=`.
2. **`check.sh` + `host-check.timer`** — проверки состояния раз в 15 минут; тревога
   только при смене состояния. Сюда же входит просрочка cron-задач.
3. **Пинг healthchecks.io** из `check.sh` — молчание дольше периода означает, что лёг
   весь хост и первые два слоя сообщить уже не могут.

## Состав

| Файл | Назначение |
|---|---|
| `alert.sh` | Отправка тревоги в Telegram. Общая для всех слоёв. |
| `check.sh` | Общие проверки: юниты (`MONITOR_UNITS`), диск, память, Postgres, просрочка задач, сертификат, консоль, незапушенные коммиты (`MONITOR_REPOS`), журнал. Проверки проектов — `checks.d/*.sh`. `CHECK_DRY=1` — только напечатать результаты. |
| `checks.d/` | Подключаемые проверки проектов; лежат в репо своих проектов (`ops/checks.d/`), ставятся копированием. |
| `runjob.sh` | Обёртка cron-задач: запись прогона в `job_runs`, тревога при ненулевом коде. |
| `alert@.service` | Шаблон-алертер для `OnFailure`. |
| `host-check.service` / `.timer` | Проверки каждые 15 минут. |
| `host-summary.service` / `.timer` | Сводка в 09:00 по Москве. |
| `install.sh` | Установка всего перечисленного, идемпотентно. |

## Установка

    sudo ops/monitoring/install.sh
    sudo install -m 640 -g monitoring <репо проекта>/ops/checks.d/<проект>.sh /opt/monitoring/checks.d/
    cat <репо проекта>/ops/job_schedule.sql | sudo -u postgres psql -d "$MONITORING_DB"

`/etc/monitoring.env` (640, `root:monitoring`) — не в git:

    TELEGRAM_BOT_TOKEN=...
    ALERT_CHAT_ID=...
    ALERT_THREAD_ID=...           # тема «Логи»
    MONITORING_DB=stackradar
    MONITOR_NAME=auto08
    MONITOR_UNITS="stack-radar nginx postgresql@16-main"
    MONITOR_REPOS="/opt/stack-radar /home/ubuntu/telegram_bds"
    CONSOLE_URL=https://console.example.com/
    CONSOLE_EXPECT=401
    CERT_PATH=/etc/letsencrypt/live/console.example.com/cert.pem
    HC_PING_URL=https://hc-ping.com/...

## Повторные тревоги

Повторную тревогу об одной и той же падающей задаче `runjob.sh` шлёт не чаще, чем раз в
`ALERT_REPEAT_HOURS` (по умолчанию 6). Прогон всё равно пишется в `job_runs` — заглушается
только сообщение.

**Задача из cron, которой нужен `/etc/<app>.env`, обязана запускаться от `<app>`:**
файл имеет права `640 root:<app>`, и строка crontab пользователя `ubuntu` без
`sudo -u <app>` падает на `Permission denied`, а следом на `unauthorized` — без
`CRON_SECRET` роуты отказывают.

## Подключение нового сервиса

    sudo mkdir -p /etc/systemd/system/<юнит>.service.d
    printf '[Unit]\nOnFailure=alert@%%n.service\n' \
      | sudo tee /etc/systemd/system/<юнит>.service.d/onfailure.conf
    sudo systemctl daemon-reload

## Подключение новой задачи по расписанию

    <расписание> /opt/monitoring/runjob.sh <имя> -- <команда> >> <лог> 2>&1

плюс строка в `job_schedule` с ожидаемым интервалом и фрагмент в `logrotate-bds`.
Полный список требований и чек-лист приёмки — `req_mon.md`.

## Проверка

    sudo /opt/monitoring/check.sh            # разовый прогон, печатает итог
    sudo systemctl start host-summary        # прислать сводку сейчас
    sudo cat /var/lib/monitoring/state       # текущее состояние всех проверок
    sudo -u postgres psql -d "${MONITORING_DB:-stackradar}" -c "select * from job_runs order by id desc limit 10"
