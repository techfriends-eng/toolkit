import { stripHtml } from "./parse-feed.ts";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; StackRadar/1.0; article-archive; +https://grok.com)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export function sanitizePgText(value: string, max = 160_000): string {
  return value.replaceAll("\u0000", "").replace(/\r\n/g, "\n").slice(0, max);
}

export async function fetchText(
  url: string,
  timeoutMs = 15000,
  maxBytes = 800_000,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
  } catch (error) {
    const status = (error as { status?: number })?.status;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(status ? `HTTP ${status} ${url}` : `fetch ${url}: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  const buf = new Uint8Array(await response.arrayBuffer());
  const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  return sanitizePgText(new TextDecoder("utf-8", { fatal: false }).decode(slice), maxBytes);
}

function pickMain(html: string): string {
  const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i);
  if (article) return article[0];
  const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i);
  if (main) return main[0];
  const role = html.match(/<[^>]+role=["']main["'][^>]*>[\s\S]*?<\/[a-z0-9]+>/i);
  if (role) return role[0];
  return html
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");
}

export function htmlToArticleText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return sanitizePgText(stripHtml(pickMain(cleaned)), 24_000);
}

export async function downloadArticle(
  url: string,
  timeoutMs = 15000,
): Promise<{ text: string; wordCount: number; html: string }> {
  const html = await fetchText(url, timeoutMs, 800_000);
  const text = htmlToArticleText(html);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return { text, wordCount, html: sanitizePgText(html, 160_000) };
}
