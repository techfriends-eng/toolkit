/**
 * Механизм профильного фильтра тем. Сам список тем и их шаблоны — конфиг проекта
 * (у stack-radar — `src/lib/ingest/keywords.ts`), бизнес-правила поверх (например, «только
 * PostgreSQL — не наша новость») тоже остаются в проекте. Грабли: handbook gotchas/filters-topics.md.
 */

export type TopicItem = {
  title: string;
  summary?: string | null;
  body?: string | null;
  url?: string;
};

export type TopicExplanation<T extends string> = { topic: T; where: string; snippet: string };

export type TopicMatcher<T extends string> = ReturnType<typeof createTopicMatcher<T>>;

function countMatches(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    total += text.match(new RegExp(pattern.source, flags))?.length ?? 0;
  }
  return total;
}

/**
 * `patterns` — шаблоны каждой темы. В JS `\b` работает только с ASCII: для кириллицы границы
 * задаются lookaround (gotchas/filters-topics.md#word-boundaries).
 */
export function createTopicMatcher<T extends string>(
  patterns: Record<T, RegExp[]>,
  opts: { minBodyHits?: number } = {},
) {
  const topics = Object.keys(patterns) as T[];
  const minBodyHits = opts.minBodyHits ?? 2;

  /** Заголовок, анонс и URL — то, что статья заявляет о себе. */
  function headText(item: TopicItem): string {
    return `${item.title}\n${item.summary ?? ""}\n${item.url ?? ""}`;
  }

  return {
    topics,

    /** Все темы, найденные в тексте; ничего — `fallback`. */
    match(text: string, fallback: T[] = []): T[] {
      const hits = topics.filter((topic) => patterns[topic].some((p) => p.test(text)));
      return hits.length > 0 ? hits : [...fallback];
    },

    /**
     * Темы по профилю: тема засчитывается, если она в заголовке/анонсе/URL, либо в теле не меньше
     * `minBodyHits` раз. Одно упоминание в середине статьи — не тема статьи.
     */
    profileHits(item: TopicItem): T[] {
      const head = headText(item);
      const body = item.body ?? "";
      return topics.filter(
        (topic) =>
          patterns[topic].some((p) => p.test(head)) ||
          countMatches(body, patterns[topic]) >= minBodyHits,
      );
    },

    /** Где сработала каждая тема — для разбора «почему эта статья здесь». */
    explain(item: TopicItem): TopicExplanation<T>[] {
      const body = item.body ?? "";
      const out: TopicExplanation<T>[] = [];
      for (const topic of topics) {
        const list = patterns[topic];
        const inTitle = list.find((p) => p.test(item.title));
        const inSummary = list.find((p) => p.test(item.summary ?? ""));
        const bodyCount = countMatches(body, list);
        if (!inTitle && !inSummary && bodyCount === 0) continue;
        const where = [
          inTitle && "заголовок",
          inSummary && "анонс",
          bodyCount > 0 && `тело ×${bodyCount}`,
        ]
          .filter(Boolean)
          .join(", ");
        const source = inTitle ? item.title : inSummary ? (item.summary ?? "") : body;
        const pattern = inTitle ?? inSummary ?? list.find((p) => p.test(body))!;
        const at = source.search(pattern);
        const snippet = source
          .slice(Math.max(0, at - 60), at + 80)
          .replace(/\s+/g, " ")
          .trim();
        out.push({ topic, where, snippet });
      }
      return out;
    },
  };
}
