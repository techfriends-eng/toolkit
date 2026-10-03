export function ingestLookbackDays(): number {
  const parsed = Number(process.env.INGEST_LOOKBACK_DAYS ?? 14);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 90) : 14;
}

export function publishedAtFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const day = path.match(/\/(20\d{2})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])(?:\/|$)/);
    if (day) return new Date(`${day[1]}-${day[2]}-${day[3]}T12:00:00Z`).toISOString();
    const month = path.match(/\/(20\d{2})\/(0[1-9]|1[0-2])(?:\/|$)/);
    if (month) return new Date(`${month[1]}-${month[2]}-01T12:00:00Z`).toISOString();
  } catch {
    return null;
  }
  return null;
}

/**
 * Hugo и подобные генераторы отдают для статических страниц
 * "Mon, 01 Jan 0001 00:00:00" — JS парсит это как 2001 год.
 * Всё, что старше этого порога, считаем отсутствующей датой.
 */
const EARLIEST_REAL_POST = Date.parse("2005-01-01T00:00:00Z");

export function resolvePublishedAt(
  publishedAt: string | null | undefined,
  url: string,
): string | null {
  if (publishedAt) {
    const ts = Date.parse(publishedAt);
    if (!Number.isNaN(ts) && ts >= EARLIEST_REAL_POST) return new Date(ts).toISOString();
  }
  return publishedAtFromUrl(url);
}

export function isWithinLookback(
  publishedAt: string | null | undefined,
  lookbackDays = ingestLookbackDays(),
  now = Date.now(),
): boolean {
  if (!publishedAt) return false;
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return false;
  return now - ts <= lookbackDays * 24 * 60 * 60 * 1000;
}

export type FeedFreshness = {
  stale: boolean;
  newestYear: number | null;
  oldInTop: number;
  datedInTop: number;
  reason?: string;
};

/** Даты вида "Mon, 01 Jan 0001" в лентах — мусор, а не архив. */
const MIN_SANE_YEAR = 2005;

export function staleFeedDays(): number {
  const parsed = Number(process.env.INGEST_STALE_FEED_DAYS ?? 180);
  return Number.isFinite(parsed) && parsed >= 30 ? Math.min(parsed, 3650) : 180;
}

/**
 * Лента архивная, если самый свежий материал в её начале старше порога.
 * Редкий, но живой блог (Trino: 3 поста за год) остаётся источником;
 * элементы без даты или с заведомо мусорной датой не учитываются.
 */
export function assessFeedFreshness(
  items: Array<{ publishedAt?: string | null; url: string }>,
  now = Date.now(),
  topN = 10,
  maxAgeDays = staleFeedDays(),
): FeedFreshness {
  const currentYear = new Date(now).getUTCFullYear();
  const stamps = items
    .slice(0, topN)
    .map((item) => {
      const iso = resolvePublishedAt(item.publishedAt ?? null, item.url);
      if (!iso) return null;
      const ts = Date.parse(iso);
      if (Number.isNaN(ts)) return null;
      if (new Date(ts).getUTCFullYear() < MIN_SANE_YEAR) return null;
      return ts;
    })
    .filter((ts): ts is number => ts != null);

  if (stamps.length === 0) {
    return { stale: false, newestYear: null, oldInTop: 0, datedInTop: 0 };
  }

  const newest = Math.max(...stamps);
  const newestYear = new Date(newest).getUTCFullYear();
  const oldInTop = stamps.filter((ts) => new Date(ts).getUTCFullYear() < currentYear).length;
  const ageDays = Math.floor((now - newest) / (24 * 60 * 60 * 1000));
  if (ageDays > maxAgeDays) {
    return {
      stale: true,
      newestYear,
      oldInTop,
      datedInTop: stamps.length,
      reason: `лента архивная: последний материал от ${new Date(newest).toISOString().slice(0, 10)}, это ${ageDays} дн. назад`,
    };
  }
  return { stale: false, newestYear, oldInTop, datedInTop: stamps.length };
}
