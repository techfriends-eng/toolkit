import assert from "node:assert/strict";
import test from "node:test";
import {
  assessFeedFreshness,
  isWithinLookback,
  publishedAtFromUrl,
  resolvePublishedAt,
} from "./freshness.ts";

test("reads calendar path from Trino/Flink-style URLs", () => {
  const iso = publishedAtFromUrl("https://trino.io/blog/2023/04/06/the-definitive-guide-2-pl.html");
  assert.ok(iso);
  assert.equal(iso.slice(0, 10), "2023-04-06");
});

test("undated item is not fresh", () => {
  assert.equal(isWithinLookback(null, 14), false);
});

test("2023 post is stale in 2026", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  assert.equal(isWithinLookback("2023-05-25T00:00:00Z", 14, now), false);
});

test("two-week-old post is still news", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  assert.equal(isWithinLookback("2026-08-28T00:00:00Z", 14, now), true);
});

test("falls back from missing RSS date to URL", () => {
  const resolved = resolvePublishedAt(
    null,
    "https://flink.apache.org/2023/05/25/flink-1.16.2.html",
  );
  assert.equal(resolved?.slice(0, 10), "2023-05-25");
});

test("top-10 from 2023-2025 marks the source stale in 2026", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  const items = [
    { url: "https://trino.io/blog/2023/04/06/guide.html", publishedAt: "2023-04-06T00:00:00Z" },
    { url: "https://trino.io/blog/2024/01/01/old.html", publishedAt: "2024-01-01T00:00:00Z" },
    { url: "https://trino.io/blog/2025/06/01/still-old.html", publishedAt: "2025-06-01T00:00:00Z" },
    { url: "https://trino.io/blog/2025/07/01/x.html", publishedAt: "2025-07-01T00:00:00Z" },
  ];
  const v = assessFeedFreshness(items, now);
  assert.equal(v.stale, true);
  assert.equal(v.newestYear, 2025);
  assert.match(v.reason ?? "", /2025|2026/);
});

test("current-year lead in top-10 keeps the source", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  const items = [
    {
      url: "https://clickhouse.com/blog/2026/09/01/release.html",
      publishedAt: "2026-09-01T00:00:00Z",
    },
    { url: "https://clickhouse.com/blog/2025/01/01/old.html", publishedAt: "2025-01-01T00:00:00Z" },
  ];
  assert.equal(assessFeedFreshness(items, now).stale, false);
});

test("мусорные даты 0001 не делают ленту архивной", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  const items = [
    {
      url: "https://flink.apache.org/documentation/flink-stable/",
      publishedAt: "0001-01-01T00:00:00Z",
    },
    {
      url: "https://flink.apache.org/getting-started/with-flink/",
      publishedAt: "0001-01-01T00:00:00Z",
    },
  ];
  assert.equal(assessFeedFreshness(items, now).stale, false);
});

test("редкий, но живой блог остаётся источником", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  const items = [
    { url: "https://trino.io/blog/2026/07/18/x.html", publishedAt: "2026-07-18T00:00:00Z" },
    { url: "https://trino.io/blog/2025/03/27/y.html", publishedAt: "2025-03-27T00:00:00Z" },
    { url: "https://trino.io/blog/2025/03/03/z.html", publishedAt: "2025-03-03T00:00:00Z" },
    { url: "https://trino.io/blog/2025/02/10/w.html", publishedAt: "2025-02-10T00:00:00Z" },
    { url: "https://trino.io/blog/2025/01/10/v.html", publishedAt: "2025-01-10T00:00:00Z" },
    { url: "https://trino.io/blog/2024/12/10/u.html", publishedAt: "2024-12-10T00:00:00Z" },
    { url: "https://trino.io/blog/2024/11/10/t.html", publishedAt: "2024-11-10T00:00:00Z" },
    { url: "https://trino.io/blog/2024/10/10/s.html", publishedAt: "2024-10-10T00:00:00Z" },
  ];
  assert.equal(assessFeedFreshness(items, now).stale, false);
});

test("заброшенная лента ловится по возрасту свежего материала", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  const items = [
    { url: "https://example.com/blog/2024/01/01/a.html", publishedAt: "2024-01-01T00:00:00Z" },
  ];
  const v = assessFeedFreshness(items, now);
  assert.equal(v.stale, true);
  assert.match(v.reason ?? "", /архивная/);
});

test("дата 0001 из Hugo-ленты не считается датой", () => {
  assert.equal(
    resolvePublishedAt(
      "Mon, 01 Jan 0001 00:00:00 +0000",
      "https://flink.apache.org/documentation/",
    ),
    null,
  );
});
