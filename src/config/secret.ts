import { readFileSync } from "node:fs";

/**
 * Секрет из переменной NAME или из файла по пути NAME_FILE (handbook standards/05-config-secrets.md).
 * Файл удобен для токенов, которые монтируются в контейнер или лежат в /etc/<app>/secrets.
 * Нет ни того, ни другого — пустая строка: решать, ошибка это или «функция выключена», должен
 * вызывающий код.
 */
export function readSecret(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const direct = env[name];
  if (direct && direct.trim()) return direct.replace(/\s+$/, "");
  const path = env[`${name}_FILE`];
  if (path && path.trim()) {
    try {
      return readFileSync(path.trim(), "utf8").replace(/\s+$/, "");
    } catch (err) {
      // Без падения: недоступный файл секрета не должен ронять процесс, но обязан быть виден в логе.
      console.error(`readSecret: не прочитать ${name}_FILE (${path}):`, err);
      return "";
    }
  }
  return "";
}
