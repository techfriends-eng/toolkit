# toolkit

handbook: v0.1

Переиспользуемые модули `techfriends-eng`. Модули перенесены из проектов, где они уже работают
в проде (в первую очередь stack-radar), вместе с тестами. Правила, по которым они написаны, лежат в
[handbook](https://github.com/techfriends-eng/handbook), а ограничения внешних API — в `handbook/gotchas/`.

## Установка

```sh
npm install "github:techfriends-eng/toolkit#v0.4.0"
```

Версия — это git-тег. Проект пинует точный тег, а обновление делается отдельным коммитом с прогоном гейта.
При установке из git npm сам собирает `dist/` (скрипт `prepare`).

## Модули

| Импорт | Что внутри | Источник | Грабли |
|---|---|---|---|
| `@techfriends-eng/toolkit/telegram` | `createTelegram` (call, sendMessage с темой и нарезкой), `splitTelegram`, `escapeHtml`, `verdictOf` / `verdictForCard` (разбор ответа «да/нет») | stack-radar `src/lib/telegram/*` | [telegram](https://github.com/techfriends-eng/handbook/blob/main/gotchas/telegram.md) |
| `@techfriends-eng/toolkit/telegram` (v0.3) | `callbackData`/`parseCallback` (≤64 байт), `inlineKeyboard`, `closeCard` (пометка в конце, entities сохранены), `createPoller` (single-flight, курсор через отброшенные, сохранение до успешного), `fromChat` (чат + тема + автор) | stack-radar `site/pick-card.ts`, `site/pick.ts` | [telegram](https://github.com/techfriends-eng/handbook/blob/main/gotchas/telegram.md) |
| `@techfriends-eng/toolkit/wp` | `createWp({ baseUrl, postType })`: find/create/update/getStatus/publish/uploadMedia/lookupPublished | stack-radar `src/lib/wp/client.ts` | [wordpress](https://github.com/techfriends-eng/handbook/blob/main/gotchas/wordpress.md) |
| `@techfriends-eng/toolkit/filter` | `createTopicMatcher(patterns)`: `match`, `profileHits` (заголовок или ≥2 в теле), `explain` | stack-radar `src/lib/ingest/keywords.ts` | [filters-topics](https://github.com/techfriends-eng/handbook/blob/main/gotchas/filters-topics.md) |
| `@techfriends-eng/toolkit/ingest` | `parseFeed` (RSS/Atom), `parseTelegramChannel` (t.me/s), `fetchText` с таймаутом и лимитом байтов, `sanitizePgText`, свежесть по дате из URL, `canonicalArticleUrl` (дедуп utm) | stack-radar `src/lib/ingest/*` | [filters-topics](https://github.com/techfriends-eng/handbook/blob/main/gotchas/filters-topics.md) |
| `@techfriends-eng/toolkit/llm` | `buildCacheKey` с версией промпта (`LLM_PROMPT_VERSION`); `createChat` (v0.3) — OpenAI-совместимый вызов с повторами на 429/5xx и подключаемым кэшем | stack-radar `src/lib/xai-cache-key.ts` | [llm](https://github.com/techfriends-eng/handbook/blob/main/gotchas/llm.md) |
| `@techfriends-eng/toolkit/db` | `migrate` (файл = транзакция, учёт в `_migrations`), `pendingMigrations`. `pg` — peer-зависимость | stack-radar `scripts/migrate.mjs` | — |
| `@techfriends-eng/toolkit/config` | `readSecret(NAME)`: переменная или файл из `NAME_FILE` | stack-radar `site/pick-card.ts` | — |
| `@techfriends-eng/toolkit/async` | `singleFlight`: не больше одного вызова за раз (поллеры) | stack-radar `src/lib/single-flight.ts` | [telegram](https://github.com/techfriends-eng/handbook/blob/main/gotchas/telegram.md#one-poller) |
| `ops/monitoring/` | общий `check.sh` + подключаемые проверки проектов (`checks.d/`), `runjob.sh`, `alert.sh`, юниты таймеров, `install.sh`; хост ставит с тега: `git clone` в `/opt/toolkit`, `sudo ops/monitoring/install.sh` | stack-radar `ops/monitoring/` | [monitoring](https://github.com/techfriends-eng/handbook/blob/main/gotchas/monitoring.md) |
| `ops/lib/tg.sh` | Telegram для bash: `tg_send_text/photo/document`, `tg_get_updates`, `tg_delete_messages`; ошибки — код 1 и описание в stderr; тесты `ops/lib/tg.test.sh` | wiki_visualizer `scripts/lib/telegram.sh` | [telegram](https://github.com/techfriends-eng/handbook/blob/main/gotchas/telegram.md) |

Пример:

```ts
import { createTelegram } from "@techfriends-eng/toolkit/telegram";
import { readSecret } from "@techfriends-eng/toolkit/config";

const tg = createTelegram({ token: readSecret("TELEGRAM_BOT_TOKEN") });
await tg.sendMessage({ chatId: process.env.BDS_SERVICE_CHAT_ID!, threadId: 620, text: "готово" });
```

## Что ещё не перенесено (план v0.4)

- Перевод поллеров и карточек stack-radar на `createPoller`/`closeCard` — с проверкой на живой карточке.
- `ops/monitoring/check.sh`: общие проверки хоста отдельно от проверок проектов, `install.sh`.
- `ops/lib/telegram.sh` для bash-проектов и перевод на него wiki_visualizer и telegram_bds.
- Шаблон MCP-шлюза хоста (`ops/mcp-gateway`).

## Разработка

```sh
npm install
npm run test:unit && npm run typecheck && npm run lint
```

Правила для изменений — [AGENTS.md](AGENTS.md).
