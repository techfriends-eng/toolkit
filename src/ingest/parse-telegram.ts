import type { FeedItem } from "./parse-feed.ts";

/**
 * Пост в публичном превью канала (t.me/s/<channel>), а не RSS. Ценность —
 * в материале, на который указывает пост, а не в самом посте: URL карточки —
 * первая внешняя ссылка из текста (Telegram сам оборачивает голый URL в
 * <a href>, так что достаточно посмотреть на href, не выбирая формат текста).
 * Если внешней ссылки нет, пост сам себе материал — url это постоянная
 * ссылка на сообщение.
 *
 * decodeEntities не переиспользован из parse-feed.ts: та функция не
 * экспортирована и тянет за собой рантайм-импорт через алиас "@/", который
 * не резолвится при прямом прогоне теста через node --experimental-strip-types
 * (алиас понимает только Vite). Дублировать 4 строки дешевле, чем городить
 * относительные импорты в parse-feed.ts.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

const NON_EXTERNAL_HOST = /(^|\.)t(?:elegram)?\.(?:me|org)$/i;

function isExternalHref(href: string): boolean {
  try {
    return !NON_EXTERNAL_HOST.test(new URL(href).hostname);
  } catch {
    return false;
  }
}

function extractLinks(html: string): string[] {
  const links: string[] = [];
  const re = /<a\b[^>]*href="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = match[1];
    if (href && href.startsWith("http") && isExternalHref(href)) links.push(href);
  }
  return links;
}

/** <br> становится границей строки, остальные теги снимаются без замены. */
function textLines(html: string): string[] {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  const noTags = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeEntities(noTags)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function parseTelegramChannel(html: string, channel: string): FeedItem[] {
  const parts = html.split(/(?=<div class="tgme_widget_message[^"]*"[^>]*data-post=")/);
  const items: FeedItem[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const post = part.match(/data-post="([^"]+)"/)?.[1];
    if (!post || seen.has(post)) continue;
    seen.add(post);

    const textBlock = part.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    )?.[1];
    if (!textBlock) continue; // медиа без подписи — нечего показать

    const lines = textLines(textBlock);
    if (lines.length === 0) continue;

    const publishedAt = part.match(/<time\b[^>]*datetime="([^"]+)"/)?.[1] ?? null;
    const links = extractLinks(textBlock);
    const postId = post.split("/").pop() ?? "";
    const permalink = `https://t.me/${channel}/${postId}`;
    const body = lines.join(" ").slice(0, 20000);

    items.push({
      title: lines[0].slice(0, 300),
      url: links[0] || permalink,
      summary: body.slice(0, 1200),
      body,
      publishedAt,
      author: `@${channel}`,
    });
  }
  return items;
}
