# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии по [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

## [0.13.0] — 2026-11-16

### Добавлено
- Журнал расхода LLM (bds-content ADR 0001, п. 5, шаг 5b; таблица `llm.calls` — bds-content `sql/llm_ledger.sql`):
  - `llm`: `createLedger({ project, query, warn })` — `record({ stage, model, provider, site, ref, usage, cached, ok,
    modelsVersion })`. Запрос к БД передаётся параметром (`pool.query`), драйвер не нужен. Без `query` журнал
    выключен; сбой базы — предупреждение, не исключение. Ответ из кэша пишется с cost 0.
  - `ops/lib/llm_ledger.sh` для bash: `llm_ledger_log <stage> <model> [key=value ...]` и
    `llm_ledger_from_openrouter <stage> <ответ.json>` (модель, токены и cost из ответа OpenRouter). DSN —
    `LLM_LEDGER_DB_URL` или `LLM_LEDGER_DB_URL_FILE`; значения уходят в psql переменными, не склейкой SQL.
    Всегда код 0. Тесты без базы — `ops/lib/llm_ledger.test.sh`, в selfcheck и CI.

## [0.12.0] — 2026-11-16

### Добавлено
- Модуль `@techfriends-eng/toolkit/visuals` (bds-content ADR 0001, п. 4c), перенесён из bds-satellites
  `src/lib/visuals` вместе с тестами: `renderScheme` (Mermaid → JPG или PNG по расширению, R5 — перерисовка LR
  для вертикальной схемы), `finalizePreview`, `forceLR`, `generatePreview` (OpenRouter, fallback моделей,
  расход), `parseVisuals` (превью и схемы из `_meta.md`). Команды выполняет `Runner`: `dockerRunner` (контейнер
  с uid хоста, спутники) или `localRunner` (образ wiki_visualizer). Палитра сайта остаётся в проекте: приходит
  готовыми `decorate` и `config`. Новые опции: `width` (`-w` mmdc 11.x), `scale`, `size`, `stripMeta`.
- CLI `toolkit-visuals render` для bash (wiki_visualizer): предупреждение R5 в stderr, если схема осталась
  выше, чем шире.

## [0.11.0] — 2026-11-16

### Добавлено
- CLI `toolkit-wp` (`bin`, `src/cli/wp.ts`) над модулем `wp` для bash-проектов (handbook ADR 0002; bds-content
  ADR 0001, п. 4b): `find`, `status`, `create` (всегда draft, `--only-accepted-meta` сверяет meta со схемой
  REST), `publish [--date-gmt]`, `dates`, `upload-media`, `meta-keys`, `categories`, `raw-content`, `count`.
  Вывод построчный, как у `wordpress.sh` wiki_visualizer. Креды — только файлами, тело — файлом или stdin.
  Коды выхода: 1 — ошибка WP или «не найдено», 2 — аргументы.
- `wp`: `publishEntry(id, creds, { dateGmt })` — публикация с датой, `future` принимается; `entryDates(after,
  creds)` — даты publish и future постранично; `matchCategories(text, { rootId, linkPattern, max })` — рубрики
  по словам текста; `rawContent(id, creds)` — `content.raw`; `countEntries(status, creds)` — число из
  `X-WP-Total`. Название рубрики сравнивается без учёта регистра и для кириллицы (в jq-версии
  `ascii_downcase` кириллицу не понижал).

## [0.10.0] — 2026-11-16

### Добавлено
- `ops/pin_lag.sh [package.json] [max]` — проверка, что пин `@techfriends-eng/toolkit#vX.Y.Z` потребителя отстаёт
  от последнего тега не больше чем на `max` (по умолчанию 2; правило bds-content ADR 0001, п. 7). Теги — через
  `git ls-remote`, без npm и токена: репо публичный. Выход 1 — отставание больше допуска, 2 — пин не найден или
  теги недоступны. Тесты без сети — `ops/pin_lag.test.sh`, в selfcheck и CI.

## [0.9.1] — 2026-11-16

### Исправлено
- `alert.sh`: `ALERT_PROXY` из `/etc/monitoring.env` — тревога идёт через HTTP-прокси. С supan8n (Yandex Cloud)
  `api.telegram.org` напрямую не отвечает (таймаут), тестовая тревога 0.9.0 не дошла; через прокси gate01 по
  Tailscale (`100.64.199.60:8888`, им же пользуется n8n) `getMe` отвечает.

## [0.9.0] — 2026-11-16

### Добавлено
- `install.sh --alert-only`: только тревога об отказе юнита (`alert.sh`, `alert@.service`), без проверок и `runjob`,
  которым нужен Postgres на хосте. Для supan8n, где Postgres живёт в Docker Supabase (вариант А автора 2026-11-16).

## [0.8.0] — 2026-11-16

### Изменено
- Мониторинг: тишина = норма (bds-content ADR 0001 п. 9, решения автора 2026-11-15). В Telegram уходит
  только смена проверки на warn/crit. Возврат в норму пишется в журнал (`logger -t monitoring`) и в
  `host_checks`, человеку не шлётся.

### Удалено
- Ежедневная сводка `host-summary.service`/`.timer` (09:00 МСК) на всех хостах. `install.sh` отключает и
  удаляет её при переустановке. Сводка по запросу осталась: `check.sh --summary`.

## [0.7.0] — 2026-11-03

### Добавлено
- `wp`: `ensureTags(names)` — id меток по именам, недостающие создаются (`term_exists` тоже даёт id).
- `wp`: необязательные `tags` у `createEntry` и `updateEntry`.
- `wp`: `restMetaKeys()` — ключи `meta`, которые тип записи принимает через REST. Без mu-плагина с
  `register_post_meta` поля Yoast WordPress молча выбрасывает, и по этому списку это видно до записи.

### Миграция
- Не требуется: без новых параметров запросы не меняются.

## [0.6.2] — 2026-11-02

### Добавлено
- `wp`: необязательный `featuredMedia` у `updateEntry`. Раньше обложка ставилась только при создании записи,
  и повторная публикация не могла её добавить.

### Миграция
- Не требуется: без параметра обложка записи не меняется.

## [0.6.1] — 2026-11-02

### Добавлено
- `ingest`: необязательный параметр `maxChars` у `htmlToArticleText`. Длинная статья больше не режется
  на 24 000 знаков, если вызывающему нужен весь текст.

### Миграция
- Не требуется: без параметра лимит прежний.

## [0.6.0] — 2026-10-31

### Добавлено
- `llm`: `ChatRequest.body` — дополнительные поля тела запроса провайдера (например,
  `reasoning: {effort}` у OpenRouter: рассуждение Claude 5 выключить нельзя, а `reasoning.max_tokens`
  модель не соблюдает, см. handbook `gotchas/llm.md#claude5-reasoning`).
- `llm`: `completeDetailed(req)` — текст, `finishReason` (`length` — ответ обрезан) и расход: токены,
  токены рассуждения, стоимость `usage.cost`. Обрезанный ответ в кэш не пишется.

### Миграция
- Не требуется: `complete()` работает как раньше.

## [0.5.0] — 2026-10-20

### Изменено
- `ops/monitoring`: утренняя сводка сгруппирована по категориям (`summary.sh`). Проблемы — целиком с
  подсказкой, остальное — одной строкой на группу, задачи cron — «N/M в срок», итог «🟢 N/N в норме»
  или «🔴 x · 🟡 y · 🟢 z». Группы проверок проектов — `MONITOR_GROUPS`, без них — «Прочее».
  Короткое «ок» для малоинформативных проверок — `MONITOR_QUIET`.
- `CHECK_DRY=1 check.sh --summary` печатает сводку вместо отправки.
- `install.sh` ставит `summary.sh`; `selfcheck.sh` гоняет bash-тесты `ops/`.

### Миграция
- Переустановить комплект: `sudo ops/monitoring/install.sh` (без `summary.sh` рядом `check.sh` не стартует).
- По желанию — `MONITOR_GROUPS` и `MONITOR_QUIET` в `/etc/monitoring.env` (пример в README).

## [0.4.1] — 2026-10-05

### Добавлено
- `TgUpdate.channel_post`; `fromChat` проверяет и посты канала (нужно командному поллеру stack-radar).

## [0.4.0] — 2026-10-05

### Добавлено
- `ops/lib/tg.sh` — Telegram для bash-проектов с тестами без сети (`ops/lib/tg.test.sh`): тема только если
  задана, подписи через `--form-string`, ошибка Telegram — код 1, а не «null».
- `ops/monitoring`: `check.sh` с подключаемыми проверками проектов (`checks.d/*.sh`), списки юнитов и репо
  в `MONITOR_UNITS`/`MONITOR_REPOS`, режим `CHECK_DRY=1`; юниты таймеров; `install.sh`.

### Изменено
- `runjob.sh`, `alert.sh`: имя хоста в сообщениях — `MONITOR_NAME` (по умолчанию `hostname`).


## [0.3.0] — 2026-10-04

### Добавлено
- `wp`: `createWp` — клиент WordPress REST с типом записи параметром (posts, encyclopedia).
- `filter`: `createTopicMatcher` — механизм профильного фильтра тем; темы и бизнес-правила — в проекте.
- `llm`: `createChat` — OpenAI-совместимый вызов с повторами (429/5xx/сеть, пауза 15 с × n) и
  подключаемым кэшем; окончательный отказ — `null`.
- `telegram`: карточки (`callbackData`, `parseCallback`, `inlineKeyboard`, `markedText`, `closeCard`) и
  ядро поллера (`createPoller`, `fromChat`).

### Добавлено
- RUNBOOK (выпуск версии, установка в проекте), `ops/selfcheck.sh` (гейт одной командой),
  `deploy/toolkit.env.example` — переменные, которые читают модули.

## [0.2.0] — 2026-10-04

### Изменено
- `ops/monitoring`: имя БД задаётся `MONITORING_DB` (по умолчанию `stackradar`, как на auto08); убраны имя
  и IP хоста, домен консоли — комплект годится для любого хоста. Репо стал публичным.
- CI: gitleaks бинарником вместо `gitleaks-action` (тому для репо организации нужна лицензия).

## [0.1.0] — 2026-10-03

### Добавлено
- `telegram`: `createTelegram` (новый, с темами и нарезкой), `splitTelegram`, `escapeHtml`,
  `verdictOf`/`verdictForCard` — из stack-radar.
- `ingest`: разбор RSS/Atom и t.me/s, загрузка с лимитами, свежесть, дедуп URL — из stack-radar.
- `llm`: ключ кэша с версией промпта. Переменная переименована: `XAI_PROMPT_VERSION` → `LLM_PROMPT_VERSION`.
- `db`: мигратор и план миграций — из stack-radar.
- `config`: `readSecret`.
- `async`: `singleFlight`.
- `ops/monitoring`: `runjob.sh`, `alert.sh`, `alert@.service`, `req_mon.md` — копия из stack-radar.
