import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pendingMigrations } from "./migration-plan.ts";

/**
 * Применяет миграции из `dir` к Postgres. Каждый файл выполняется в своей транзакции и
 * записывается в `_migrations`, поэтому повторный запуск безопасен (handbook standards/07-deploy.md).
 *
 * `pg` — peer-зависимость: проекту без БД она не нужна, и toolkit её не тянет.
 * Нет DATABASE_URL — ошибка, а не тихий пропуск: молчаливый успех прячет несконфигурированный хост.
 */
export async function migrate(opts: {
  dir: string | URL;
  databaseUrl?: string;
  log?: (line: string) => void;
}): Promise<{ applied: string[] }> {
  const log = opts.log ?? ((line) => console.log(`[migrate] ${line}`));
  const dir = opts.dir instanceof URL ? fileURLToPath(opts.dir) : opts.dir;
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("migrate: DATABASE_URL не задан");

  const entries = await readdir(dir);
  if (pendingMigrations(entries, []).length === 0) {
    log("миграций нет");
    return { applied: [] };
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const done = (await client.query<{ name: string }>("SELECT name FROM _migrations")).rows.map(
      (r) => r.name,
    );
    for (const { name } of pendingMigrations(entries, done)) {
      const sql = await readFile(join(dir, name), "utf8");
      try {
        await client.query("BEGIN");
        // Простой протокол pg выполняет многооператорный файл целиком.
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
          // ROLLBACK падает, если соединение умерло — исходная ошибка важнее.
        });
        throw Object.assign(new Error(`migrate: ошибка в ${name}: ${(err as Error).message}`), {
          cause: err,
        });
      }
      log(`применена ${name}`);
      applied.push(name);
    }
    log(applied.length ? `готово, применено ${applied.length}` : "схема актуальна");
    return { applied };
  } finally {
    await client.end();
  }
}
