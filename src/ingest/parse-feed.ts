import { publishedAtFromUrl } from "./freshness.ts";

export type FeedItem = {
  title: string;
  url: string;
  summary: string;
  body: string;
  publishedAt: string | null;
  author: string;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function innerXml(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    const raw = match[1] ?? "";
    const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    out.push(cdata ? cdata[1] : raw);
  }
  return out;
}

function firstText(block: string, tags: string[]): string {
  for (const tag of tags) {
    const values = innerXml(block, tag);
    if (values[0]) return stripHtml(values[0]).trim();
  }
  return "";
}

function firstHtml(block: string, tags: string[]): string {
  for (const tag of tags) {
    const values = innerXml(block, tag);
    if (values[0]) return values[0].trim();
  }
  return "";
}

function atomHref(block: string): string {
  const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (href?.[1]) return href[1].trim();
  return firstText(block, ["link", "id"]);
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const asRss = Date.parse(raw);
  if (!Number.isNaN(asRss)) return new Date(asRss).toISOString();
  const iso = raw.match(
    /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/,
  );
  if (iso) {
    const parsed = Date.parse(iso[0].replace(" ", "T"));
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi");
  return xml.match(re) ?? [];
}

export function parseFeed(xml: string): FeedItem[] {
  const itemBlocks = blocks(xml, "item");
  const isAtom = itemBlocks.length === 0;
  const entries = isAtom ? blocks(xml, "entry") : itemBlocks;

  return entries
    .map((block) => {
      const title = firstText(block, ["title"]);
      const url = isAtom ? atomHref(block) : firstText(block, ["link", "guid"]) || atomHref(block);
      const htmlBody = firstHtml(block, ["content:encoded", "content"]);
      const summaryHtml = firstHtml(block, [
        "description",
        "summary",
        "content:encoded",
        "content",
      ]);
      const summary = stripHtml(summaryHtml).slice(0, 1200);
      const body = stripHtml(htmlBody || (summary.length > 400 ? summaryHtml : "")).slice(0, 20000);
      const publishedAt =
        parseDate(firstText(block, ["pubDate", "published", "updated", "dc:date"])) ||
        publishedAtFromUrl(url);
      const author = firstText(block, ["dc:creator", "author", "name"]).slice(0, 160);
      return { title: title.slice(0, 300), url: url.trim(), summary, body, publishedAt, author };
    })
    .filter((item) => item.title && item.url.startsWith("http"));
}

export function extractHtmlLinks(html: string, pattern: RegExp): FeedItem[] {
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  const hrefRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html))) {
    const href = decodeEntities(match[1] ?? "")
      .split("#")[0]
      .split("?")[0];
    if (!pattern.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = stripHtml(match[2] ?? "").slice(0, 280);
    const slug = href.replace(/\/+$/, "").split("/").pop()?.replace(/-/g, " ") ?? "";
    items.push({
      title: title || slug,
      url: href.startsWith("http") ? href : href,
      summary: "",
      body: "",
      publishedAt: publishedAtFromUrl(href),
      author: "",
    });
  }
  return items;
}
