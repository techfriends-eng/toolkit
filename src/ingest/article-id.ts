import { createHash } from "node:crypto";

export function articleIdFromUrl(url: string): string {
  return `a_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

/**
 * Одна статья приходит из разных лент с разными utm-метками: на Хабре лента
 * хаба даёт utm_campaign=<id>, лента блога компании - utm_campaign=corporate_blog.
 * Без нормализации это две строки в articles и две карточки отбора. Срезаем
 * только utm_* и якорь: остальные параметры у некоторых сайтов и есть адрес (?p=123).
 */
export function canonicalArticleUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  return parsed.toString();
}
