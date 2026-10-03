# toolkit

handbook: v0.1

Переиспользуемые модули `techfriends-eng`. Модули перенесены из проектов, где они уже работают
в проде (в первую очередь stack-radar), вместе с тестами. Правила, по которым они написаны, лежат в
[handbook](https://github.com/techfriends-eng/handbook), а ограничения внешних API — в `handbook/gotchas/`.

## Установка

```sh
npm install "github:techfriends-eng/toolkit#v0.1.0"
```

Версия — это git-тег. Проект пинует точный тег, а обновление делается отдельным коммитом с прогоном гейта.
При установке из git npm сам собирает `dist/` (скрипт `prepare`).

## Модули

| Импорт | Что внутри | Источник | Грабли |
|---|---|---|---|
| `@techfriends-eng/toolkit/telegram` | `createTelegram` (call, sendMessage с темой и нарезкой), `splitTelegram`, `escapeHtml`, `verdictOf` / `verdictForCard` (разбор ответа «да/нет») | stack-radar `src/lib/telegram/*` | [telegram](https://github.com/techfriends-eng/handbook/blob/main/gotchas/telegram.md) |
| `@techfriends-eng/toolkit/ingest` | `parseFeed` (RSS/Atom), `parseTelegramChannel` (t.me/s), `fetchText` с таймаутом и лимитом байтов, `sanitizePgText`, свежесть по дате из URL, `canonicalArticleUrl` (дедуп utm) | stack-radar `src/lib/ingest/*` | [filters-topics](https://github.com/techfriends-eng/handbook/blob/main/gotchas/filters-topics.md) |
| `@techfriends-eng/toolkit/llm` | `buildCacheKey` с версией промпта (`LLM_PROMPT_VERSION`) | stack-radar `src/lib/xai-cache-key.ts` | [llm](https://github.com/techfriends-eng/handbook/blob/main/gotchas/llm.md) |
| `@techfriends-eng/toolkit/db` | `migrate` (файл = транзакция, учёт в `_migrations`), `pendingMigrations`. `pg` — peer-зависимость | stack-radar `scripts/migrate.mjs` | — |
| `@techfriends-eng/toolkit/config` | `readSecret(NAME)`: переменная или файл из `NAME_FILE` | stack-radar `site/pick-card.ts` | — |
| `@techfriends-eng/toolkit/async` | `singleFlight`: не больше одного вызова за раз (поллеры) | stack-radar `src/lib/single-flight.ts` | [telegram](https://github.com/techfriends-eng/handbook/blob/main/gotchas/telegram.md#one-poller) |
| `ops/monitoring/` | `runjob.sh`, `alert.sh`, `alert@.service`, контракт подключения `req_mon.md` | stack-radar `ops/monitoring/` | [monitoring](https://github.com/techfriends-eng/handbook/blob/main/gotchas/monitoring.md) |

Пример:

```ts
import { createTelegram } from "@techfriends-eng/toolkit/telegram";
import { readSecret } from "@techfriends-eng/toolkit/config";

const tg = createTelegram({ token: readSecret("TELEGRAM_BOT_TOKEN") });
await tg.sendMessage({ chatId: process.env.BDS_SERVICE_CHAT_ID!, threadId: 620, text: "готово" });
```

## Что ещё не перенесено (план v0.2+)

- Поллер `getUpdates` с курсором и фильтром chat+topic+sender, карточки с inline-кнопками
  (stack-radar `telegram/poll.ts`, `site/pick-card.ts`, `site/pick.ts`). Их нужно отвязать от БД
  stack-radar.
- Профильный фильтр тем и ru-relevance (`ingest/keywords.ts`, `telegram/ru-relevance.ts`): фильтр
  получит конфиг тем параметром.
- LLM-вызов с кэшем в Postgres и ретраями (`xai.ts` + ретраи из telegram_bds `llm_caption.sh`).
- `settings` (kv в `app_settings`, env важнее), WordPress-клиент (`wp/*`).
- `ops/monitoring/check.sh` с разделением на общие проверки хоста и доменные плагины,
  `install.sh`, шаблон MCP-шлюза `ops/mcp-gateway`, `ops/lib/telegram.sh` для bash-проектов.
- `ops/monitoring/runjob.sh` пишет в БД `stackradar`. Имя БД нужно вынести в `/etc/monitoring.env`.

## Разработка

```sh
npm install
npm run test:unit && npm run typecheck && npm run lint
```

Правила для изменений — [AGENTS.md](AGENTS.md).
