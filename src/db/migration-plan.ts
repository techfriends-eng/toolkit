/**
 * Учёт миграций: какие файлы ещё не применены и в каком порядке.
 * Применённая миграция хранится по имени файла (basename), поэтому один и тот же файл
 * применяется один раз, из какого бы каталога его ни прочитали.
 */

export function migrationName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function isMigrationFile(path: string): boolean {
  return path.endsWith(".sql");
}

/** Неприменённые миграции из `paths` в порядке имени. Не-`.sql` записи отбрасываются. */
export function pendingMigrations(
  paths: Iterable<string>,
  applied: Iterable<string>,
): Array<{ name: string; path: string }> {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}
