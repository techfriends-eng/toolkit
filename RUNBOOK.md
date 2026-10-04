# RUNBOOK: toolkit

Версия: см. `VERSION`. Разделы фиксированные по handbook `standards/09-docs.md`. Это библиотека: часть
разделов «не применимо», эксплуатация модулей описана в RUNBOOK проектов, которые их используют.

## 1. Назначение

Переиспользуемые модули: Telegram, ingest, ключ кэша LLM, мигратор, секреты, single-flight (`src/`), и
комплект мониторинга хоста (`ops/monitoring`). Успех: проект ставит пакет по тегу и удаляет свою копию кода.

## 2. Архитектура

Один npm-пакет `@techfriends-eng/toolkit` с subpath-экспортами. Сборка `dist/` делается при установке из
git (`prepare`). Репо публичный, поэтому npm на хостах ставит его по https без ключей
(handbook `gotchas/typescript-node.md#git-dep-ssh`). Потребители: stack-radar (v0.2.0).

## 3. Карта файлов на хосте

Не разворачивается отдельно: попадает в `node_modules` проекта. `ops/monitoring` на auto08 сейчас стоит
копией из stack-radar (`/opt/monitoring`); установка из toolkit — следующий шаг (README, план v0.3).

## 4. Секреты

Секретов в репо нет. Какие переменные читают модули — `deploy/toolkit.env.example`.

## 5. Данные и БД

`db/migrate` ведёт таблицу `_migrations` в БД проекта. Своих данных нет.

## 6. Деплой

Выпуск версии:

```sh
npm run test:unit && npm run typecheck && npm run lint && npm run build
# CHANGELOG, VERSION и package.json — одна версия; ломающее изменение экспорта = MAJOR
git tag vX.Y.Z && git push origin main --tags
```

В проекте: `npm install "github:techfriends-eng/toolkit#vX.Y.Z"`, гейт проекта, деплой проекта.

## 7. Мониторинг и алерты

Не применимо. CI на каждый push.

## 8. Ежедневное сопровождение

Не применимо.

## 9. Ручная проверка step-by-step

| Шаг | Команда | Ожидаемый результат |
|---|---|---|
| 1 | `ops/selfcheck.sh` | все строки `OK` |
| 2 | в проекте-потребителе: `node -e 'import("@techfriends-eng/toolkit/telegram")'` | модуль грузится |

## 10. Новый хост

Не применимо.

## 11. Аварии

| Симптом | Причина | Действие |
|---|---|---|
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` в тестах | parameter properties, `enum`, `namespace` | handbook `gotchas/typescript-node.md#strip-types` |
| После установки нет `dist/` | npm не выполнил `prepare` | `npm install-scripts approve @techfriends-eng/toolkit` или публикация в GitHub Packages |

## 12. Шпаргалка

```sh
npm run test:unit && npm run typecheck && npm run lint && npm run build
git tag | tail -3
```
