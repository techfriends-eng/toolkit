#!/usr/bin/env node
/**
 * toolkit-wp — CLI над `@techfriends-eng/toolkit/wp` для bash-проектов (handbook ADR 0002: bash —
 * обвязка, HTTP и разбор JSON — в toolkit). Вывод построчный, как у прежних bash-функций
 * wiki_visualizer `wordpress.sh`, чтобы обёртки остались совместимыми.
 *
 * Адрес сайта — `--base-url` или `WP_BASE_URL`. Креды — только файлами (`--user-file`,
 * `--pass-file`): секрет в argv виден в `ps`. Тело записи — `--content-file` (`-` — stdin).
 * Код выхода: 0 — успех, 1 — ошибка WordPress или «не найдено», 2 — неверные аргументы.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runWpCli } from "./wp-run.ts";

const io = {
  argv: process.argv.slice(2),
  env: process.env,
  readFile: (path: string) => (path === "-" ? readStdin() : readFile(path, "utf8")),
  out: (s: string) => process.stdout.write(s),
  err: (s: string) => process.stderr.write(s),
  parseArgs,
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

process.exitCode = await runWpCli(io);
