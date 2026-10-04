# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии по [SemVer](https://semver.org/lang/ru/).

## [Unreleased]

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
